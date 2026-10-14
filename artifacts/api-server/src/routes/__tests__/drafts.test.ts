/**
 * Drafts media mirroring by typed-key convention (routes/drafts.ts).
 *
 * draft_data is an untyped client-assembled blob, so external media URLs
 * are mirrored into permanent storage ONLY under the media keys the
 * draft producers actually save:
 *
 *   • make-video / song-and-video drafts: top-level `audioUrl` (audio),
 *     SceneData `demoClipUrl` (video), `thumbnailUrl` (image),
 *     `locationImageUrl` (image).
 *   • music-lane sessions: bare `url` inside an object carrying a
 *     `storagePath` sibling (pickedVersion / variants[]) — audio.
 *
 * Everything else — lyrics, prompts, specialInstructions, sourceUrl,
 * a bare `url` with no storagePath sibling — must stay byte-identical
 * and must never reach the mirror (deep-mirroring an untyped blob
 * would download arbitrary web links).
 *
 * Fake-db style (mirrors fan-contests-hardening.test.ts): the REAL
 * router + REAL projectDraftsTable column objects (so eq/and render
 * real conditions, read back via PgDialect), with a fake db that
 * implements only the chains these handlers use — insert-upsert keyed
 * on (user_id, workflow_type) exactly like the table's UNIQUE
 * constraint, and selects filtered by the rendered WHERE params.
 * (pg-mem can't serve this route: drizzle's `.returning({…})` uses
 * pg rowMode, which the pg-mem adapter rejects.) Values are JSON
 * round-tripped on write and read, matching jsonb storage semantics.
 * requireAuth is mocked; mirrorExternalMediaUrl is a recording fake
 * (no network, no storage); the two objectStorage functions the route
 * uses are faithful stand-ins.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

interface DraftRow {
  id: string;
  user_id: string;
  workflow_type: string;
  title: string | null;
  draft_data: Record<string, unknown>;
  updated_at: Date;
}

const testState = vi.hoisted(() => ({
  userId: "",
  rows: new Map<string, DraftRow>(),
  mirrorCalls: [] as Array<{ url: string; kind: string; ownerKey: string }>,
}));

const dialect = new PgDialect();
function renderParams(cond: unknown): unknown[] {
  return dialect.sqlToQuery(cond as never).params as unknown[];
}
function renderSql(cond: unknown): string {
  return dialect.sqlToQuery(cond as never).sql;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function buildFakeDb() {
  return {
    insert: (_table: unknown) => ({
      values: (v: Omit<DraftRow, "id">) => ({
        onConflictDoUpdate: (_cfg: unknown) => ({
          returning: async (_sel: unknown) => {
            const rows = testState.rows;
            const key = `${v.user_id}::${v.workflow_type}`;
            const existing = rows.get(key);
            if (existing) {
              existing.title = v.title;
              existing.draft_data = clone(v.draft_data);
              existing.updated_at = v.updated_at;
              return [{ id: existing.id }];
            }
            const row: DraftRow = { id: randomUUID(), ...v, draft_data: clone(v.draft_data) };
            rows.set(key, row);
            return [{ id: row.id }];
          },
        }),
      }),
    }),
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (cond: unknown) => {
          const rows = testState.rows;
          const sqlText = renderSql(cond);
          const params = renderParams(cond);
          let matched: DraftRow[];
          if (sqlText.includes("workflow_type")) {
            const [uid, workflow] = params as [string, string];
            matched = [...rows.values()].filter(
              (r) => r.user_id === uid && r.workflow_type === workflow,
            );
          } else if (sqlText.includes('"id"')) {
            const [id, uid] = params as [string, string];
            matched = [...rows.values()].filter((r) => r.id === id && r.user_id === uid);
          } else {
            const [uid] = params as [string];
            matched = [...rows.values()].filter((r) => r.user_id === uid);
          }
          const out = matched.map((r) => ({ ...r, draft_data: clone(r.draft_data) }));
          const chain: any = {
            orderBy: async (..._args: unknown[]) =>
              out.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime()),
            limit: async (n: number) => out.slice(0, n),
          };
          return chain;
        },
      }),
    }),
    delete: (_table: unknown) => ({
      where: async (_cond: unknown) => undefined,
    }),
  };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = testState.userId;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return buildFakeDb();
    },
  };
});

vi.mock("../../lib/objectStorage", () => {
  /* Same read contract as the real deep refresh: any stored storage
     ref comes back as a fresh playable URL; all other values pass
     through untouched. */
  const refreshDeep = async (value: any): Promise<any> => {
    if (typeof value === "string") {
      return value.startsWith("r2://") || value.startsWith("supabase://")
        ? `https://cdn.example.com/${value}`
        : value;
    }
    if (Array.isArray(value)) {
      return Promise.all(value.map((v) => refreshDeep(v)));
    }
    if (value && typeof value === "object") {
      const entries = await Promise.all(
        Object.entries(value).map(async ([k, v]) => [k, await refreshDeep(v)] as const),
      );
      return Object.fromEntries(entries);
    }
    return value;
  };
  return {
    uploadMediaToSupabaseStorage: vi.fn(async () => "supabase://generated-clips/unused"),
    /* Faithful subset of the real normalizeToStorageRef: refs pass
       through, R2 presigned URLs (virtual-hosted form) collapse to
       their r2:// ref, everything else is not ours → null. */
    normalizeToStorageRef: (value: string | null | undefined): string | null => {
      if (value == null) return null;
      if (value.startsWith("r2://") || value.startsWith("supabase://")) return value;
      try {
        const u = new URL(value);
        if (u.hostname.endsWith(".r2.cloudflarestorage.com")) {
          const parts = u.pathname.replace(/^\/+/, "").split("/");
          const [bucket, ...rest] = parts;
          if (bucket && rest.length > 0) return `r2://${bucket}/${rest.join("/")}`;
        }
      } catch { /* not a URL */ }
      return null;
    },
    refreshSupabaseStorageUrlsDeep: refreshDeep,
  };
});

vi.mock("../../lib/mirrorMedia", () => ({
  /* The real guards, verbatim semantics (mirrorMedia.ts). */
  isExternalHttpUrl: (value: unknown): boolean =>
    typeof value === "string" && /^https?:\/\//i.test(value.trim()),
  isPermanentMediaValue: (value: unknown): boolean => {
    if (typeof value !== "string") return false;
    const v = value.trim();
    return (
      v.startsWith("r2://") || v.startsWith("supabase://") || v.startsWith("/") || v.startsWith("data:")
    );
  },
  /* Recording fake: returns a deterministic permanent ref per call. */
  mirrorExternalMediaUrl: vi.fn(
    async (v: string, opts: { kind: string; ownerKey: string }) => {
      testState.mirrorCalls.push({ url: v, kind: opts.kind, ownerKey: opts.ownerKey });
      return `r2://generated-clips/mirrored/${opts.kind}-${testState.mirrorCalls.length}.bin`;
    },
  ),
}));

import router from "../drafts";

const USER_A = randomUUID();

let server: ReturnType<typeof express.application.listen>;
let baseUrl = "";
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use(router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  testState.userId = USER_A;
  testState.rows = new Map();
  testState.mirrorCalls = [];
});

async function postDraft(workflowType: string, draftData: Record<string, unknown>, title?: string) {
  const res = await realFetch(`${baseUrl}/drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflowType, title: title ?? null, draftData }),
  });
  expect(res.status).toBe(201);
  return res.json() as Promise<{ id: string }>;
}

function storedDraft(workflowType: string): Record<string, any> {
  const row = testState.rows.get(`${USER_A}::${workflowType}`);
  expect(row).toBeDefined();
  return row!.draft_data as Record<string, any>;
}

describe("POST /drafts — typed-key media mirroring", () => {
  it("mirrors the make-video shape's media keys with the right kinds, and nothing else", async () => {
    const draftData = {
      rawResult: "# plan\nstyle ref: https://example.com/ref-video",
      audioUrl: "https://provider.example.com/song.mp3?sig=abc",
      step: 2,
      timestamp: 1760000000000,
      formValues: {
        artistName: "King",
        lyrics: "sing along https://youtu.be/xyz now",
        specialInstructions: "vibe like https://open.spotify.com/track/123",
      },
      scenes: [
        {
          id: "s1",
          demoClipUrl: "https://runway.example.com/clip1.mp4",
          thumbnailUrl: "https://runway.example.com/thumb1.jpg",
          locationImageUrl: "https://images.example.com/loc.jpg",
          aiVideoPrompt: "a palace scene, see https://example.com/not-media",
        },
        {
          id: "s2",
          demoClipUrl: null,
          thumbnailUrl: "r2://generated-clips/clips/existing.mp4",
          locationImageUrl: null,
        },
      ],
    };

    await postDraft("make-video", draftData);
    const stored = storedDraft("make-video");

    // Media keys were mirrored to permanent refs.
    expect(stored.audioUrl).toMatch(/^r2:\/\/generated-clips\/mirrored\/audio-\d+\.bin$/);
    expect(stored.scenes[0].demoClipUrl).toMatch(/^r2:\/\/generated-clips\/mirrored\/video-\d+\.bin$/);
    expect(stored.scenes[0].thumbnailUrl).toMatch(/^r2:\/\/generated-clips\/mirrored\/image-\d+\.bin$/);
    expect(stored.scenes[0].locationImageUrl).toMatch(/^r2:\/\/generated-clips\/mirrored\/image-\d+\.bin$/);

    // Exactly the four external media URLs reached the mirror, with
    // the right kind and the user as owner.
    expect(testState.mirrorCalls).toHaveLength(4);
    expect(testState.mirrorCalls).toEqual(
      expect.arrayContaining([
        { url: "https://provider.example.com/song.mp3?sig=abc", kind: "audio", ownerKey: USER_A },
        { url: "https://runway.example.com/clip1.mp4", kind: "video", ownerKey: USER_A },
        { url: "https://runway.example.com/thumb1.jpg", kind: "image", ownerKey: USER_A },
        { url: "https://images.example.com/loc.jpg", kind: "image", ownerKey: USER_A },
      ]),
    );

    // Ordinary text/links are byte-identical.
    expect(stored.rawResult).toBe(draftData.rawResult);
    expect(stored.formValues.lyrics).toBe(draftData.formValues.lyrics);
    expect(stored.formValues.specialInstructions).toBe(draftData.formValues.specialInstructions);
    expect(stored.scenes[0].aiVideoPrompt).toBe(draftData.scenes[0].aiVideoPrompt);

    // Already-permanent values and nulls pass through, unmirrored.
    expect(stored.scenes[1].thumbnailUrl).toBe("r2://generated-clips/clips/existing.mp4");
    expect(stored.scenes[1].demoClipUrl).toBeNull();
  });

  it("music-lane shape: bare `url` mirrors only with a storagePath sibling (audio)", async () => {
    const draftData = {
      projectId: "proj-1",
      title: "Lane session",
      pickedVersion: {
        url: "https://provider.example.com/v1.mp3",
        storagePath: "songs/v1.mp3",
        name: "V1",
        durationSec: 30,
      },
      variants: [
        { url: "https://provider.example.com/v2.mp3", storagePath: "songs/v2.mp3", label: "A" },
        { url: "https://provider.example.com/keep.mp3", label: "no storagePath — not an asset entry" },
      ],
      links: { url: "https://example.com/ordinary-page", label: "reference" },
      sourceUrl: "https://youtube.com/watch?v=abc",
    };

    await postDraft("music-lane", draftData);
    const stored = storedDraft("music-lane");

    expect(stored.pickedVersion.url).toMatch(/^r2:\/\/generated-clips\/mirrored\/audio-\d+\.bin$/);
    expect(stored.pickedVersion.storagePath).toBe("songs/v1.mp3");
    expect(stored.variants[0].url).toMatch(/^r2:\/\/generated-clips\/mirrored\/audio-\d+\.bin$/);
    expect(testState.mirrorCalls).toHaveLength(2);
    expect(testState.mirrorCalls.every((c) => c.kind === "audio")).toBe(true);

    // A bare `url` without the storagePath marker, and ordinary link
    // keys, are never mirrored and stay byte-identical.
    expect(stored.variants[1].url).toBe("https://provider.example.com/keep.mp3");
    expect(stored.links.url).toBe("https://example.com/ordinary-page");
    expect(stored.sourceUrl).toBe("https://youtube.com/watch?v=abc");
  });

  it("sponsor-read shape (text only): nothing is mirrored, payload stored byte-identical", async () => {
    const draftData = {
      type: "sponsor-read",
      brandName: "Acme",
      productDescription: "See https://acme.example.com/product",
      keyPoints: ["buy at https://acme.example.com/buy", "no link here"],
      read: {
        hookLine: "hook",
        script: "visit https://acme.example.com now",
        ctaLine: "go",
      },
      createdAt: "2026-10-14T00:00:00.000Z",
    };

    await postDraft("sponsorship-outreach", draftData);
    const stored = storedDraft("sponsorship-outreach");

    expect(testState.mirrorCalls).toHaveLength(0);
    expect(stored).toEqual(draftData);
  });

  it("upsert update path: a second POST for the same workflow re-mirrors and keeps one row", async () => {
    await postDraft("make-video", {
      audioUrl: "https://provider.example.com/first.mp3",
      scenes: [],
    });
    const first = storedDraft("make-video");
    expect(first.audioUrl).toMatch(/^r2:\/\/generated-clips\/mirrored\//);

    await postDraft("make-video", {
      audioUrl: "https://provider.example.com/second.mp3",
      scenes: [{ id: "s1", demoClipUrl: "https://runway.example.com/new.mp4" }],
    });
    const second = storedDraft("make-video");
    expect(testState.rows.size).toBe(1);
    expect(second.audioUrl).toMatch(/^r2:\/\/generated-clips\/mirrored\//);
    expect(second.audioUrl).not.toBe(first.audioUrl);
    expect(second.scenes[0].demoClipUrl).toMatch(/^r2:\/\/generated-clips\/mirrored\/video-\d+\.bin$/);
    expect(testState.mirrorCalls.map((c) => c.url)).toEqual([
      "https://provider.example.com/first.mp3",
      "https://provider.example.com/second.mp3",
      "https://runway.example.com/new.mp4",
    ]);
  });

  it("an own-storage signed URL under a media key never survives as a signed URL", async () => {
    await postDraft("make-video", {
      audioUrl:
        "https://acct123.r2.cloudflarestorage.com/generated-clips/clips/own.mp4?X-Amz-Signature=deadbeef",
      scenes: [],
    });
    const stored = storedDraft("make-video");
    expect(stored.audioUrl).not.toContain("X-Amz-Signature");
    expect(stored.audioUrl).toMatch(/^r2:\/\//);
  });

  it("round-trip: GET returns fresh playable URLs for stored refs; ordinary links untouched", async () => {
    await postDraft("make-video", {
      audioUrl: "https://provider.example.com/song.mp3",
      formValues: { specialInstructions: "vibe like https://open.spotify.com/track/123" },
      scenes: [{ id: "s1", demoClipUrl: "https://runway.example.com/clip.mp4" }],
    });
    const stored = storedDraft("make-video");

    const res = await realFetch(`${baseUrl}/drafts?workflow=make-video`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { drafts: Array<{ draft_data: Record<string, any> }> };
    const read = body.drafts[0].draft_data;

    expect(read.audioUrl).toBe(`https://cdn.example.com/${stored.audioUrl}`);
    expect(read.scenes[0].demoClipUrl).toBe(`https://cdn.example.com/${stored.scenes[0].demoClipUrl}`);
    expect(read.formValues.specialInstructions).toBe("vibe like https://open.spotify.com/track/123");
  });
});
