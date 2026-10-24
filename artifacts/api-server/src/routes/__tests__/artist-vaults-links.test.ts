/**
 * Route-level pins for the character-link (co-star) rails:
 *   GET  /api/artist-vaults/:id/links
 *   POST /api/artist-vaults/:id/links
 *
 * Board defects pinned here:
 *  - D1: a soft-deleted co-star was returned as an active cast member
 *    (enrichment ignored deleted_at). Dead links are now filtered out
 *    of the response; restoring the character revives the link.
 *  - D4: POST accepted soft-deleted characters on either side of the
 *    link (ownership check ignored deleted_at) and accepted ANY role
 *    string, which rides verbatim into generation prompts. Deleted
 *    characters now 404; unknown roles now 400.
 *
 * Same fake-DB harness as artist-vaults-manage.test.ts: heavy modules
 * are mocked, the real Express router runs against an ephemeral server.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const dbState = vi.hoisted(() => ({
  vaultRows: [] as any[],
  linkRows: [] as any[],
}));

function matchRow(row: any, where: any): boolean {
  if (!where) return true;
  if (where.__eq) return row[where.col] === where.val;
  if (where.__isNull) return row[where.col] === null || row[where.col] === undefined;
  if (where.__and) return (where.conds as any[]).every((c) => matchRow(row, c));
  if (where.__or) return (where.conds as any[]).some((c) => matchRow(row, c));
  return true;
}

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __eq: true, col: col.__col, val }),
  and: (...conds: any[]) => ({ __and: true, conds }),
  or: (...conds: any[]) => ({ __or: true, conds }),
  isNull: (col: any) => ({ __isNull: true, col: col.__col }),
  asc: (col: any) => ({ __asc: true, col: col.__col }),
  desc: (col: any) => ({ __desc: true, col: col.__col }),
  sql: (strings: any, ...vals: any[]) => ({ __sql: true, strings, vals }),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const auth = req.headers["authorization"];
    if (!auth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = (req.headers["x-test-user"] as string) || "user-1";
    req.log = { info: () => {}, error: () => {} };
    next();
  },
}));

vi.mock("@runwayml/sdk", () => ({
  default: class {
    imageToVideo = { create: vi.fn() };
    tasks = { retrieve: vi.fn() };
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 0),
  refundCredits: vi.fn(async () => {}),
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
}));

vi.mock("../../lib/r2-client", () => ({
  r2Upload: vi.fn(async (path: string) => path),
}));

vi.mock("../../lib/teams", () => ({
  getUserActiveTeam: vi.fn(async () => null),
}));

vi.mock("./generate/clip-pricing", () => ({
  SEEDANCE_720P_CREDITS_PER_SEC_DEFAULT: 300,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => v ?? null),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: vi.fn(async (v: any) => v),
}));

vi.mock("../../lib/video-loop", () => ({
  loopVideoFromUrl: vi.fn(async () => ({ outPath: "", workDir: "" })),
  VideoLoopError: class VideoLoopError extends Error {},
}));

vi.mock("../../lib/character-voice-profile", () => ({
  sanitizeCharacterVoiceProfile: vi.fn((v: any) => v),
}));

vi.mock("@workspace/db", () => {
  const mkTable = (name: string, rowsKey: "vaultRows" | "linkRows", cols: string[]) => {
    const t: any = { __table: name, __rowsKey: rowsKey };
    for (const c of cols) t[c] = { __col: c };
    return t;
  };
  const rowsOf = (t: any): any[] => (dbState as any)[t.__rowsKey];
  const setRows = (t: any, rows: any[]) => {
    (dbState as any)[t.__rowsKey] = rows;
  };
  const chain = (rows: any[]) => ({
    limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    orderBy: (..._o: any[]) => Promise.resolve(rows),
    then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
  });
  return {
    db: {
      select: (_fields?: any) => ({
        from: (table: any) => ({
          where: (w: any) => chain(rowsOf(table).filter((r) => matchRow(r, w))),
        }),
      }),
      insert: (table: any) => ({
        values: (vals: any) => ({
          returning: () => {
            const row = { id: `row-${rowsOf(table).length + 1}`, ...vals };
            setRows(table, [...rowsOf(table), row]);
            return Promise.resolve([row]);
          },
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      }),
      update: (table: any) => ({
        set: (vals: any) => ({
          where: (w: any) => {
            for (const r of rowsOf(table)) if (matchRow(r, w)) Object.assign(r, vals);
            return Promise.resolve([]);
          },
        }),
      }),
      delete: (table: any) => ({
        where: (w: any) => {
          setRows(table, rowsOf(table).filter((r) => !matchRow(r, w)));
          return Promise.resolve([]);
        },
      }),
      execute: () => Promise.resolve({ rows: [] }),
    },
    artistVaultsTable: mkTable("artist_vaults", "vaultRows", [
      "id", "user_id", "team_id", "deleted_at", "created_at", "updated_at",
      "artist_name", "reference_video_url", "reference_video_path",
      "spotlight_order",
    ]),
    artistCharacterLinksTable: mkTable("artist_character_links", "linkRows", [
      "id", "user_id", "character_id", "linked_character_id", "role", "created_at",
    ]),
    CHARACTER_LINK_ROLES: [
      { id: "featured-artist", label: "Featured Artist" },
      { id: "collaborator", label: "Collaborator" },
      { id: "cameo", label: "Cameo" },
      { id: "rival", label: "Rival" },
      { id: "love-interest", label: "Love Interest" },
      { id: "crew", label: "Crew" },
    ],
  };
});

import router from "../artist-vaults";

let server: any;
let baseUrl: string;
const AUTH = { Authorization: "Bearer test-token" };

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const DELETED_AT = new Date("2026-10-01T00:00:00.000Z");
/* UUID-shaped ids: POST validates linkedCharacterId as a uuid. */
const LEAD = "11111111-1111-4111-8111-111111111111";
const LIVE = "22222222-2222-4222-8222-222222222222";
const GONE = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  dbState.vaultRows = [
    { id: LEAD, user_id: "user-1", team_id: null, deleted_at: null, artist_name: "Lead" },
    { id: LIVE, user_id: "user-1", team_id: null, deleted_at: null, artist_name: "Nova Live" },
    { id: GONE, user_id: "user-1", team_id: null, deleted_at: DELETED_AT, artist_name: "Ghost Gone" },
  ];
  dbState.linkRows = [
    { id: "link-live", user_id: "user-1", character_id: LEAD, linked_character_id: LIVE, role: "rival" },
    { id: "link-dead", user_id: "user-1", character_id: LEAD, linked_character_id: GONE, role: "cameo" },
  ];
});

const get = (p: string, headers: any = AUTH) => fetch(`${baseUrl}${p}`, { headers });
const post = (p: string, body: any, headers: any = AUTH) =>
  fetch(`${baseUrl}${p}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("GET /artist-vaults/:id/links", () => {
  it("lists live co-stars with their character data", async () => {
    const res = await get(`/artist-vaults/${LEAD}/links`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { links: any[] };
    const live = data.links.find((l) => l.id === "link-live");
    expect(live?.character?.artist_name).toBe("Nova Live");
    expect(live?.role).toBe("rival");
  });

  it("D1: a soft-deleted co-star is NOT listed as an active cast member", async () => {
    const res = await get(`/artist-vaults/${LEAD}/links`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { links: any[] };
    expect(data.links.some((l) => l.id === "link-dead")).toBe(false);
    expect(JSON.stringify(data)).not.toContain("Ghost Gone");
  });

  it("404s for a character the caller does not own", async () => {
    const res = await get(`/artist-vaults/${LIVE}/links`, {
      Authorization: "Bearer test-token",
      "x-test-user": "user-2",
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /artist-vaults/:id/links", () => {
  it("links a live co-star with a known role", async () => {
    const res = await post(`/artist-vaults/${LEAD}/links`, {
      linkedCharacterId: LIVE,
      role: "featured-artist",
    });
    expect(res.status).toBe(201);
  });

  it("links with the default role when none is given", async () => {
    const res = await post(`/artist-vaults/${LEAD}/links`, {
      linkedCharacterId: LIVE,
    });
    expect(res.status).toBe(201);
  });

  it("D4: linking a soft-deleted co-star 404s", async () => {
    const res = await post(`/artist-vaults/${LEAD}/links`, {
      linkedCharacterId: GONE,
      role: "cameo",
    });
    expect(res.status).toBe(404);
  });

  it("D4: linking FROM a soft-deleted character 404s", async () => {
    const res = await post(`/artist-vaults/${GONE}/links`, {
      linkedCharacterId: LIVE,
      role: "cameo",
    });
    expect(res.status).toBe(404);
  });

  it("D4: an unknown role is a 400, not a silently accepted string", async () => {
    const res = await post(`/artist-vaults/${LEAD}/links`, {
      linkedCharacterId: LIVE,
      role: "arch-nemesis-deluxe",
    });
    expect(res.status).toBe(400);
  });

  it("still refuses a self-link with 400", async () => {
    const res = await post(`/artist-vaults/${LEAD}/links`, {
      linkedCharacterId: LEAD,
      role: "cameo",
    });
    expect(res.status).toBe(400);
  });
});
