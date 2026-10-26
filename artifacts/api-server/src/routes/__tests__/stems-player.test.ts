/**
 * N14 Stems Player — route pins (routes/creator-platform):
 *
 *   GET /api/media/track/:id                 → stems = keys+labels or null
 *   GET /api/media/track/:id/stems/playback  → signed URLs, playback only
 *   PUT /api/media/track/:id/stems           → owner attaches a splitter job
 *
 * Pins: a stemless track exposes NO stem data (honest absence); a
 * partial stem set stays exactly partial; stored refs NEVER appear
 * in any response; the playback payload carries no download/export
 * affordance; only the owner can attach, only their own finished
 * job's refs, and only those refs (never the job's signed URLs).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_USER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_ID = "99999999-9999-4999-8999-999999999999";
const TRACK_ID = "33333333-3333-4333-8333-333333333333";
const JOB_ID = "job-abc";

const VOCALS_REF = "r2://generated-clips/stems/owner/job-abc/vocals.wav";
const DRUMS_REF = "r2://generated-clips/stems/owner/job-abc/drums.wav";
const BASS_REF = "supabase://generated-clips/stems/owner/job-abc/bass.wav";

const h = vi.hoisted(() => ({
  state: {
    profiles: [] as Array<Record<string, unknown>>,
    tracks: [] as Array<Record<string, unknown>>,
    playlists: [] as Array<Record<string, unknown>>,
    trackStems: [] as Array<Record<string, unknown>>,
    jobs: new Map<string, any>(),
  },
}));

const dialect = new PgDialect();
function paramsOf(cond: unknown): unknown[] {
  if (!cond) return [];
  return dialect.sqlToQuery(cond as never).params as unknown[];
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = req.headers["x-test-user"] ?? "22222222-2222-4222-8222-222222222222";
    next();
  },
}));

vi.mock("../referrals", () => ({ getRecruiterBadgeForUser: async () => null }));
vi.mock("../generate/milestones", () => ({ computeAchievements: () => [] }));
vi.mock("../generate/stem-splitter", () => ({
  getStemJob: (id: string) => h.state.jobs.get(id),
}));
vi.mock("../../lib/email", () => ({
  sendEmail: async () => undefined,
  emailShell: (x: string) => x,
  emailButton: (href: string, label: string) => `<a href="${href}">${label}</a>`,
  emailDetailBox: (html: string) => html,
  escapeHtml: (s: string) => s,
  isEmailConfigured: () => false,
}));
vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) => typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://")),
}));
vi.mock("../../lib/objectStorage", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    refreshSupabaseStorageUrl: async (v: string) => {
      if (typeof v !== "string") return v;
      if (v.includes("signfail")) return v; // signing failed → raw ref handed back
      const m = v.match(/^(?:r2|supabase):\/\/(?:[^/]+\/)?(.+)$/);
      return m ? `https://signed.example/${m[1]}` : v;
    },
    refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { creatorProfilesTable, profileTracksTable, playlistsTable, trackStemsTable } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    const params = paramsOf(cond);
    if (table === creatorProfilesTable) {
      return state.profiles.filter((p) => params.includes(p["id"]) || params.includes(p["slug"]) || params.includes(p["userId"]));
    }
    if (table === profileTracksTable) {
      const byId = state.tracks.filter((t) => params.includes(t["id"]));
      if (byId.length) return byId;
      return state.tracks.filter((t) => params.includes(t["profileId"]));
    }
    if (table === playlistsTable) {
      return state.playlists.filter((p) => params.includes(p["id"]));
    }
    if (table === trackStemsTable) {
      return state.trackStems.filter((r) => params.includes(r["trackId"]));
    }
    return [];
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const chain: any = {
            limit: async (_n: number) => rowsFor(table, cond),
            orderBy: (..._a: unknown[]) => ({ limit: async (_n: number) => rowsFor(table, cond) }),
            then: (res: any, rej: any) => Promise.resolve(rowsFor(table, cond)).then(res, rej),
          };
          return chain;
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (v: Record<string, unknown>) => {
        if (table === trackStemsTable) state.trackStems.push({ ...v });
        return [];
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async (cond: unknown) => {
          const params = paramsOf(cond);
          if (table === trackStemsTable) {
            for (const r of state.trackStems) if (params.includes(r["trackId"])) Object.assign(r, patch);
          }
          return [];
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async (cond: unknown) => {
        const params = paramsOf(cond);
        if (table === trackStemsTable) {
          state.trackStems = state.trackStems.filter((r) => !params.includes(r["trackId"]));
        }
        return [];
      },
    }),
  };
  return { ...actual, db: fakeDb };
});

import router from "../creator-platform";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

function profileRow() {
  return {
    id: PROFILE_ID, userId: OWNER_USER_ID, slug: "king-creator", displayName: "King Creator",
    vertical: "music", streamSchedule: [], mediaKit: null, bio: "", avatarUrl: null, bannerUrl: null,
    themeId: "gold-lux", themeConfig: {}, sections: [], layoutBlocks: [], featuredMedia: null,
    socialLinks: {}, topCreators: [], merchItems: [], profileEvents: [], series: [], socialPosts: [],
    tipJarEnabled: true, isPublic: true, isVerified: false, isOfficial: false,
    followerCount: 0, totalPlays: 0, pinnedKind: null, pinnedItemId: null,
    collectionVisibility: "public", createdAt: new Date(), updatedAt: new Date(),
  };
}
function trackRow() {
  return {
    id: TRACK_ID, profileId: PROFILE_ID, title: "King Anthem", audioUrl: "audio/king-anthem.mp3",
    artworkUrl: null, genre: "Hip-Hop", tags: [], isrc: null, durationSec: 187,
    downloadPriceCents: 0, pwywEnabled: false, pwywMinCents: 0, playCount: 10, likeCount: 1,
    repostCount: 0, commentCount: 0, isPublished: true, createdAt: new Date(),
  };
}

beforeEach(() => {
  h.state.profiles = [profileRow()];
  h.state.tracks = [trackRow()];
  h.state.playlists = [];
  h.state.trackStems = [];
  h.state.jobs = new Map();
});

async function call(method: string, path: string, body?: unknown, user?: string) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { "x-test-user": user } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any, headers: r.headers };
}

describe("GET /api/media/track/:id — stems field", () => {
  it("a track without stems carries stems: null (no controls data)", async () => {
    const { status, json } = await call("GET", `/media/track/${TRACK_ID}`);
    expect(status).toBe(200);
    expect(json.track.stems).toBeNull();
  });

  it("a track with partial stems lists exactly those, keys+labels only", async () => {
    h.state.trackStems = [{ trackId: TRACK_ID, stems: { vocals: VOCALS_REF, bass: BASS_REF } }];
    const { status, json } = await call("GET", `/media/track/${TRACK_ID}`);
    expect(status).toBe(200);
    expect(json.track.stems).toEqual([
      { key: "vocals", label: "Vocals" },
      { key: "bass", label: "Bass" },
    ]);
    const raw = JSON.stringify(json);
    expect(raw).not.toContain("r2://");
    expect(raw).not.toContain("supabase://");
    expect(raw).not.toContain("stems/owner/job-abc");
  });
});

describe("GET /api/media/track/:id/stems/playback", () => {
  it("stemless track → 200 with an empty stem list", async () => {
    const { status, json } = await call("GET", `/media/track/${TRACK_ID}/stems/playback`);
    expect(status).toBe(200);
    expect(json.stems).toEqual([]);
  });

  it("mints a signed URL per existing stem, in canonical order, partial stays partial", async () => {
    h.state.trackStems = [{ trackId: TRACK_ID, stems: { drums: DRUMS_REF, vocals: VOCALS_REF } }];
    const { status, json, headers } = await call("GET", `/media/track/${TRACK_ID}/stems/playback`);
    expect(status).toBe(200);
    expect(json.stems.map((s: any) => s.key)).toEqual(["vocals", "drums"]);
    expect(json.stems[0].url).toBe("https://signed.example/stems/owner/job-abc/vocals.wav");
    expect(headers.get("cache-control")).toBe("no-store");
    const raw = JSON.stringify(json);
    expect(raw).not.toContain("r2://");
    expect(raw).not.toContain("supabase://");
    // Playback only: no download/export affordance in the payload.
    expect(raw.toLowerCase()).not.toContain("download");
    expect(raw.toLowerCase()).not.toContain("content-disposition");
  });

  it("a stem whose signing fails is dropped, never leaked as a raw ref", async () => {
    h.state.trackStems = [{
      trackId: TRACK_ID,
      stems: { vocals: "r2://generated-clips/stems/owner/signfail/vocals.wav", drums: DRUMS_REF },
    }];
    const { status, json } = await call("GET", `/media/track/${TRACK_ID}/stems/playback`);
    expect(status).toBe(200);
    expect(json.stems.map((s: any) => s.key)).toEqual(["drums"]);
    expect(JSON.stringify(json)).not.toContain("signfail");
  });

  it("404s for a missing track", async () => {
    const { status } = await call("GET", `/media/track/44444444-4444-4444-8444-444444444444/stems/playback`);
    expect(status).toBe(404);
  });
});

describe("PUT /api/media/track/:id/stems", () => {
  function doneJob(userId = OWNER_USER_ID) {
    return {
      id: JOB_ID, userId, status: "done", stemRefs: { vocals: VOCALS_REF, drums: DRUMS_REF },
      stemUrls: { vocals: "https://signed.example/SHOULD-NOT-BE-STORED.wav" },
    };
  }

  it("owner attaches a finished job's refs; response carries no refs/URLs", async () => {
    h.state.jobs.set(JOB_ID, doneJob());
    const { status, json } = await call("PUT", `/media/track/${TRACK_ID}/stems`, { jobId: JOB_ID });
    expect(status).toBe(200);
    expect(json.stems).toEqual([
      { key: "vocals", label: "Vocals" },
      { key: "drums", label: "Drums" },
    ]);
    expect(h.state.trackStems).toHaveLength(1);
    expect(h.state.trackStems[0]!["stems"]).toEqual({ vocals: VOCALS_REF, drums: DRUMS_REF });
    const raw = JSON.stringify(json);
    expect(raw).not.toContain("r2://");
    expect(raw).not.toContain("SHOULD-NOT-BE-STORED");
  });

  it("a non-owner cannot attach stems to someone else's track", async () => {
    h.state.jobs.set(JOB_ID, doneJob(OTHER_USER_ID));
    const { status } = await call("PUT", `/media/track/${TRACK_ID}/stems`, { jobId: JOB_ID }, OTHER_USER_ID);
    expect(status).toBe(403);
    expect(h.state.trackStems).toHaveLength(0);
  });

  it("the owner cannot attach another user's job", async () => {
    h.state.jobs.set(JOB_ID, doneJob(OTHER_USER_ID));
    const { status } = await call("PUT", `/media/track/${TRACK_ID}/stems`, { jobId: JOB_ID });
    expect(status).toBe(404);
    expect(h.state.trackStems).toHaveLength(0);
  });

  it("an unfinished job cannot be attached", async () => {
    h.state.jobs.set(JOB_ID, { ...doneJob(), status: "processing" });
    const { status } = await call("PUT", `/media/track/${TRACK_ID}/stems`, { jobId: JOB_ID });
    expect(status).toBe(409);
  });

  it("clear removes the stems (back to honest absence)", async () => {
    h.state.trackStems = [{ trackId: TRACK_ID, stems: { vocals: VOCALS_REF } }];
    const { status, json } = await call("PUT", `/media/track/${TRACK_ID}/stems`, { clear: true });
    expect(status).toBe(200);
    expect(json.stems).toBeNull();
    expect(h.state.trackStems).toHaveLength(0);
    const detail = await call("GET", `/media/track/${TRACK_ID}`);
    expect(detail.json.track.stems).toBeNull();
  });

  it("rejects an empty body", async () => {
    const { status } = await call("PUT", `/media/track/${TRACK_ID}/stems`, {});
    expect(status).toBe(400);
  });
});
