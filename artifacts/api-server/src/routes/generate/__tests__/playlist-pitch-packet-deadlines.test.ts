/**
 * Tests for the Playlist Pitcher re-scope (competitor gap G7):
 *
 *  - Pitch packet assembled from the creator's REAL release record +
 *    profile + presave/link stats — with the honesty contract: fields
 *    the record doesn't hold come back null/empty AND named in
 *    `missing`, never filled with plausible text.
 *  - Submission deadline tracking (migration 0199): CRUD + the
 *    drafted → sent → followed_up → answered flow, due-next summary,
 *    overdue math.
 *  - Owner-scoping everywhere: a stranger's release can never be read
 *    as a packet, and a stranger's pitch/release can never be attached
 *    to a deadline; a stranger's deadline can never be read/patched/
 *    deleted.
 *  - The new endpoints are FREE: the credits module is never called.
 *
 * DB access is an in-memory fake in the house style (see
 * artist-vaults-manage.test.ts): drizzle operators are mocked into
 * marker objects the fake's matcher interprets.
 */
import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

/* ── shared fake-db state ─────────────────────────────────────────────── */
const dbState = vi.hoisted(() => ({
  pitchRows: [] as any[],
  deadlineRows: [] as any[],
  releaseRows: [] as any[],
  profileRows: [] as any[],
  followRows: [] as any[],
  shareRows: [] as any[],
  linkRows: [] as any[],
  seq: 0,
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

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const auth = req.headers["authorization"];
    if (!auth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = (req.headers["x-test-user"] as string) || "user-1";
    req.userCredits = 0;
    next();
  },
}));

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 0),
  refundCredits: vi.fn(async () => 0),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: () => ({ chat: { completions: { create: vi.fn() } } }),
  getTextModel: () => "gpt-6-sol",
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@workspace/db", () => {
  const mkTable = (name: string, rowsKey: keyof typeof dbState, cols: string[]) => {
    const t: any = { __table: name, __rowsKey: rowsKey };
    for (const c of cols) t[c] = { __col: c };
    return t;
  };
  const rowsOf = (t: any): any[] => (dbState as any)[t.__rowsKey];
  const setRows = (t: any, rows: any[]) => {
    (dbState as any)[t.__rowsKey] = rows;
  };
  const selectChain = (rows: any[]) => {
    const chain: any = {
      orderBy: (..._o: any[]) => chain,
      limit: (n: number) => Promise.resolve(rows.slice(0, n)),
      then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
    };
    return chain;
  };
  return {
    db: {
      select: (_fields?: any) => ({
        from: (table: any) => ({
          where: (w: any) => selectChain(rowsOf(table).filter((r) => matchRow(r, w))),
        }),
      }),
      insert: (table: any) => ({
        values: (vals: any) => ({
          returning: () => {
            const now = new Date();
            const row = {
              id: `row-${++dbState.seq}`,
              created_at: now,
              updated_at: now,
              ...vals,
            };
            setRows(table, [...rowsOf(table), row]);
            return Promise.resolve([row]);
          },
        }),
      }),
      update: (table: any) => ({
        set: (vals: any) => ({
          where: (w: any) => {
            const hit: any[] = [];
            for (const r of rowsOf(table)) {
              if (matchRow(r, w)) {
                Object.assign(r, vals);
                hit.push(r);
              }
            }
            const chain: any = {
              returning: () => Promise.resolve(hit),
              then: (res: any, rej: any) => Promise.resolve(hit).then(res, rej),
            };
            return chain;
          },
        }),
      }),
      delete: (table: any) => ({
        where: (w: any) => {
          const hit = rowsOf(table).filter((r) => matchRow(r, w));
          setRows(table, rowsOf(table).filter((r) => !matchRow(r, w)));
          const chain: any = {
            returning: () => Promise.resolve(hit),
            then: (res: any, rej: any) => Promise.resolve(hit).then(res, rej),
          };
          return chain;
        },
      }),
    },
    playlistPitchesTable: mkTable("playlist_pitches", "pitchRows", [
      "id", "user_id", "song_title", "artist_name", "curator_name",
      "playlist_name", "status", "notes", "contacted_at", "created_at", "updated_at",
    ]),
    pitchDeadlinesTable: mkTable("pitch_deadlines", "deadlineRows", [
      "id", "user_id", "pitch_id", "release_id", "curator_name",
      "playlist_name", "deadline_at", "status", "notes", "created_at", "updated_at",
    ]),
    distributionReleasesTable: mkTable("distribution_releases", "releaseRows", [
      "id", "user_id", "title", "artist_name", "release_date", "platforms",
      "audio_url", "artwork_url", "metadata", "strategy", "status",
      "credits_charged", "presave_headline", "presave_platform_links",
      "presave_bonus_url", "created_at", "updated_at",
    ]),
    creatorProfilesTable: mkTable("creator_profiles", "profileRows", [
      "id", "userId", "slug", "displayName", "bio", "avatarUrl", "bannerUrl",
      "followerCount", "totalPlays", "socialLinks",
    ]),
    presaveFollowsTable: mkTable("presave_follows", "followRows", ["id", "releaseId", "email"]),
    presaveSharesTable: mkTable("presave_shares", "shareRows", ["id", "releaseId", "channel"]),
    releaseLinkClicksTable: mkTable("release_link_clicks", "linkRows", ["id", "releaseId", "kind"]),
  };
});

import router, {
  buildPitchPacket,
  summarizeDeadlines,
  PITCH_DEADLINE_STATUSES,
} from "../playlist-pitch";
import { chargeCredits, refundCredits } from "../../../lib/credits";

const mockCharge = vi.mocked(chargeCredits);
const mockRefund = vi.mocked(refundCredits);

let server: any;
let baseUrl: string;
const AUTH = { Authorization: "Bearer test" };
const asUser2 = { Authorization: "Bearer test", "x-test-user": "user-2" };

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

const get = (p: string, headers: any = AUTH) => fetch(`${baseUrl}${p}`, { headers });
const post = (p: string, body: any, headers: any = AUTH) =>
  fetch(`${baseUrl}${p}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const patch = (p: string, body: any, headers: any = AUTH) =>
  fetch(`${baseUrl}${p}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const del = (p: string, headers: any = AUTH) =>
  fetch(`${baseUrl}${p}`, { method: "DELETE", headers });

const FULL_RELEASE = {
  id: "rel-1",
  user_id: "user-1",
  title: "Midnight Gold",
  artist_name: "Shark King",
  release_date: "2026-11-01",
  platforms: ["spotify", "apple_music"],
  audio_url: "https://cdn.example/midnight-gold.wav",
  artwork_url: "https://cdn.example/midnight-gold.jpg",
  metadata: {
    description: "A slow-burning alt-R&B confession.",
    genreTags: ["Alt R&B", "Bedroom Pop"],
    titleOptions: ["Midnight Gold"],
  },
  strategy: null,
  status: "packaged",
  credits_charged: 0,
  presave_headline: "Midnight Gold — out Nov 1",
  presave_platform_links: { spotify: "https://open.spotify.com/track/x", apple_music: "" },
  presave_bonus_url: "https://cdn.example/bonus.zip",
  created_at: new Date("2026-10-01T00:00:00Z"),
  updated_at: new Date("2026-10-01T00:00:00Z"),
};

const FULL_PROFILE = {
  id: "prof-1",
  userId: "user-1",
  slug: "shark-king",
  displayName: "Shark King",
  bio: "Alt-R&B from the deep end.",
  avatarUrl: "https://cdn.example/avatar.jpg",
  bannerUrl: "https://cdn.example/banner.jpg",
  followerCount: 1204,
  totalPlays: 55310,
  socialLinks: { instagram: "https://instagram.com/sharkking", spotify: "" },
};

beforeEach(() => {
  vi.clearAllMocks();
  dbState.pitchRows = [
    {
      id: "pitch-own", user_id: "user-1", song_title: "Midnight Gold",
      artist_name: "Shark King", curator_name: null, playlist_name: "Late Night Drive",
      status: "sent", notes: null, contacted_at: null,
      created_at: new Date(), updated_at: new Date(),
    },
    {
      id: "pitch-stranger", user_id: "user-2", song_title: "Not Yours",
      artist_name: "Someone Else", curator_name: null, playlist_name: "Their List",
      status: "sent", notes: null, contacted_at: null,
      created_at: new Date(), updated_at: new Date(),
    },
  ];
  dbState.deadlineRows = [];
  dbState.releaseRows = [
    { ...FULL_RELEASE },
    {
      id: "rel-stranger", user_id: "user-2", title: "Not Yours", artist_name: "Someone Else",
      release_date: null, platforms: [], audio_url: null, artwork_url: null,
      metadata: null, strategy: null, status: "draft", credits_charged: 0,
      presave_headline: null, presave_platform_links: {}, presave_bonus_url: null,
      created_at: new Date(), updated_at: new Date(),
    },
  ];
  dbState.profileRows = [{ ...FULL_PROFILE }];
  dbState.followRows = [
    { id: "f1", releaseId: "rel-1", email: "a@x.io" },
    { id: "f2", releaseId: "rel-1", email: "b@x.io" },
    { id: "f3", releaseId: "rel-1", email: "c@x.io" },
    { id: "f4", releaseId: "rel-stranger", email: "d@x.io" },
  ];
  dbState.shareRows = [
    { id: "s1", releaseId: "rel-1", channel: "x" },
    { id: "s2", releaseId: "rel-1", channel: "instagram" },
  ];
  dbState.linkRows = [
    { id: "l1", releaseId: "rel-1", kind: "view" },
    { id: "l2", releaseId: "rel-1", kind: "view" },
    { id: "l3", releaseId: "rel-1", kind: "click" },
    { id: "l4", releaseId: "rel-1", kind: "click" },
    { id: "l5", releaseId: "rel-1", kind: "click" },
    { id: "l6", releaseId: "rel-stranger", kind: "view" },
  ];
  dbState.seq = 100;
});

/* ── Packet: pure builder ─────────────────────────────────────────────── */

describe("buildPitchPacket", () => {
  it("assembles artist, track, links, genre, stats and press assets from the record", () => {
    const packet = buildPitchPacket({
      release: FULL_RELEASE as any,
      profile: FULL_PROFILE as any,
      stats: { presaves: 3, shares: 2, linkViews: 2, linkClicks: 3 },
    });
    expect(packet.artist.name).toBe("Shark King");
    expect(packet.artist.profileUrl).toBe("/artist/shark-king");
    expect(packet.artist.followerCount).toBe(1204);
    expect(packet.artist.socialLinks).toEqual({ instagram: "https://instagram.com/sharkking" });
    expect(packet.track).toEqual({
      title: "Midnight Gold",
      audioUrl: "https://cdn.example/midnight-gold.wav",
    });
    expect(packet.genre).toEqual(["Alt R&B", "Bedroom Pop"]);
    expect(packet.description).toBe("A slow-burning alt-R&B confession.");
    expect(packet.links.streaming).toEqual({ spotify: "https://open.spotify.com/track/x" });
    expect(packet.stats).toEqual({ presaves: 3, shares: 2, linkViews: 2, linkClicks: 3 });
    expect(packet.pressAssets.artworkUrl).toBe("https://cdn.example/midnight-gold.jpg");
    expect(packet.pressAssets.bannerUrl).toBe("https://cdn.example/banner.jpg");
    expect(packet.missing).toEqual([]);
  });

  it("names every absent field in `missing` instead of inventing it", () => {
    const bare = {
      ...FULL_RELEASE,
      release_date: null,
      audio_url: null,
      artwork_url: null,
      metadata: { titleOptions: ["Midnight Gold"] },
      presave_headline: null,
      presave_platform_links: {},
      presave_bonus_url: null,
    };
    const packet = buildPitchPacket({
      release: bare as any,
      profile: null,
      stats: { presaves: 0, shares: 0, linkViews: 0, linkClicks: 0 },
    });
    expect(packet.genre).toEqual([]);
    expect(packet.description).toBeNull();
    expect(packet.track.audioUrl).toBeNull();
    expect(packet.links.streaming).toEqual({});
    expect(packet.artist.profileUrl).toBeNull();
    expect(packet.artist.followerCount).toBeNull();
    // The artist name falls back to the RELEASE record's own artist
    // field — still real record data, not an invention.
    expect(packet.artist.name).toBe("Shark King");
    expect(packet.missing).toEqual(
      expect.arrayContaining([
        "genre", "description", "releaseDate", "trackAudio",
        "streamingLinks", "artwork", "headline", "artistProfile",
      ]),
    );
    // Zero stats are real values, not missing data.
    expect(packet.stats.presaves).toBe(0);
  });

  it("flags an empty bio on an existing profile as artistBio", () => {
    const packet = buildPitchPacket({
      release: FULL_RELEASE as any,
      profile: { ...FULL_PROFILE, bio: "  " } as any,
      stats: { presaves: 0, shares: 0, linkViews: 0, linkClicks: 0 },
    });
    expect(packet.artist.bio).toBeNull();
    expect(packet.missing).toContain("artistBio");
    expect(packet.missing).not.toContain("artistProfile");
  });
});

/* ── Packet + releases endpoints ──────────────────────────────────────── */

describe("GET /playlist-pitch/packet/:releaseId", () => {
  it("returns the packet for the owner's release, with real stats", async () => {
    const res = await get("/playlist-pitch/packet/rel-1");
    expect(res.status).toBe(200);
    const { packet } = await res.json();
    expect(packet.releaseId).toBe("rel-1");
    expect(packet.stats).toEqual({ presaves: 3, shares: 2, linkViews: 2, linkClicks: 3 });
    expect(packet.missing).toEqual([]);
    expect(mockCharge).not.toHaveBeenCalled();
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("404s for a stranger's release — the packet never leaks", async () => {
    const res = await get("/playlist-pitch/packet/rel-stranger");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.packet).toBeUndefined();
  });

  it("404s for an unknown release id", async () => {
    const res = await get("/playlist-pitch/packet/rel-nope");
    expect(res.status).toBe(404);
  });

  it("requires auth", async () => {
    const res = await fetch(`${baseUrl}/playlist-pitch/packet/rel-1`);
    expect(res.status).toBe(401);
  });
});

describe("GET /playlist-pitch/releases", () => {
  it("lists only the owner's releases", async () => {
    const res = await get("/playlist-pitch/releases");
    expect(res.status).toBe(200);
    const { releases } = await res.json();
    expect(releases.map((r: any) => r.id)).toEqual(["rel-1"]);
    expect(releases[0]).toMatchObject({ title: "Midnight Gold", status: "packaged" });
  });
});

/* ── Deadlines ────────────────────────────────────────────────────────── */

describe("PITCH_DEADLINE_STATUSES", () => {
  it("is the drafted/sent/followed_up/answered workflow", () => {
    expect(PITCH_DEADLINE_STATUSES).toEqual(["drafted", "sent", "followed_up", "answered"]);
  });
});

describe("deadline CRUD + status flow", () => {
  it("creates a deadline (default drafted), lists it, walks the status flow, deletes it", async () => {
    const createRes = await post("/playlist-pitch/deadlines", {
      playlistName: "Late Night Drive",
      curatorName: "DJ Luna",
      deadlineAt: "2999-01-01T23:59:59.999Z",
    });
    expect(createRes.status).toBe(201);
    const { deadline } = await createRes.json();
    expect(deadline.status).toBe("drafted");
    expect(deadline.playlistName).toBe("Late Night Drive");
    expect(deadline.overdue).toBe(false);
    expect(mockCharge).not.toHaveBeenCalled();

    const listRes = await get("/playlist-pitch/deadlines");
    const list = await listRes.json();
    expect(list.deadlines).toHaveLength(1);
    expect(list.dueNext.id).toBe(deadline.id);
    expect(list.overdueCount).toBe(0);

    for (const status of ["sent", "followed_up", "answered"]) {
      const res = await patch(`/playlist-pitch/deadlines/${deadline.id}`, { status });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deadline.status).toBe(status);
    }

    // Answered = closed: nothing is due next anymore.
    const after = await (await get("/playlist-pitch/deadlines")).json();
    expect(after.dueNext).toBeNull();

    const delRes = await del(`/playlist-pitch/deadlines/${deadline.id}`);
    expect(delRes.status).toBe(200);
    const final = await (await get("/playlist-pitch/deadlines")).json();
    expect(final.deadlines).toHaveLength(0);
  });

  it("rejects an invalid status and an invalid date", async () => {
    const badStatus = await post("/playlist-pitch/deadlines", {
      playlistName: "X",
      deadlineAt: "2999-01-01T00:00:00.000Z",
      status: "accepted",
    });
    expect(badStatus.status).toBe(400);

    const badDate = await post("/playlist-pitch/deadlines", {
      playlistName: "X",
      deadlineAt: "not-a-date",
    });
    expect(badDate.status).toBe(400);

    const noName = await post("/playlist-pitch/deadlines", {
      deadlineAt: "2999-01-01T00:00:00.000Z",
    });
    expect(noName.status).toBe(400);
  });

  it("sorts soonest-first; the most overdue open deadline is due next", async () => {
    await post("/playlist-pitch/deadlines", {
      playlistName: "Future List",
      deadlineAt: "2999-06-01T00:00:00.000Z",
    });
    await post("/playlist-pitch/deadlines", {
      playlistName: "Overdue List",
      deadlineAt: "2000-01-01T00:00:00.000Z",
    });
    await post("/playlist-pitch/deadlines", {
      playlistName: "Answered Old List",
      deadlineAt: "1999-01-01T00:00:00.000Z",
      status: "answered",
    });
    const list = await (await get("/playlist-pitch/deadlines")).json();
    expect(list.deadlines.map((d: any) => d.playlistName)).toEqual([
      "Answered Old List",
      "Overdue List",
      "Future List",
    ]);
    expect(list.dueNext.playlistName).toBe("Overdue List");
    expect(list.dueNext.overdue).toBe(true);
    expect(list.overdueCount).toBe(1);
  });

  it("can move a deadline's date via PATCH", async () => {
    const { deadline } = await (
      await post("/playlist-pitch/deadlines", {
        playlistName: "Movable",
        deadlineAt: "2999-01-01T00:00:00.000Z",
      })
    ).json();
    const res = await patch(`/playlist-pitch/deadlines/${deadline.id}`, {
      deadlineAt: "2000-01-01T00:00:00.000Z",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deadline.overdue).toBe(true);
  });
});

describe("deadline owner-scoping", () => {
  it("a stranger cannot see, patch, or delete my deadline", async () => {
    const { deadline } = await (
      await post("/playlist-pitch/deadlines", {
        playlistName: "Mine",
        deadlineAt: "2999-01-01T00:00:00.000Z",
      })
    ).json();

    const strangerList = await (await get("/playlist-pitch/deadlines", asUser2)).json();
    expect(strangerList.deadlines).toHaveLength(0);

    const strangerPatch = await patch(
      `/playlist-pitch/deadlines/${deadline.id}`,
      { status: "answered" },
      asUser2,
    );
    expect(strangerPatch.status).toBe(404);

    const strangerDelete = await del(`/playlist-pitch/deadlines/${deadline.id}`, asUser2);
    expect(strangerDelete.status).toBe(404);

    const mine = await (await get("/playlist-pitch/deadlines")).json();
    expect(mine.deadlines).toHaveLength(1);
    expect(mine.deadlines[0].status).toBe("drafted");
  });

  it("cannot attach a stranger's pitch or release to a deadline", async () => {
    const badPitch = await post("/playlist-pitch/deadlines", {
      playlistName: "X",
      deadlineAt: "2999-01-01T00:00:00.000Z",
      pitchId: "pitch-stranger",
    });
    expect(badPitch.status).toBe(404);

    const badRelease = await post("/playlist-pitch/deadlines", {
      playlistName: "X",
      deadlineAt: "2999-01-01T00:00:00.000Z",
      releaseId: "rel-stranger",
    });
    expect(badRelease.status).toBe(404);

    const ok = await post("/playlist-pitch/deadlines", {
      playlistName: "X",
      deadlineAt: "2999-01-01T00:00:00.000Z",
      pitchId: "pitch-own",
      releaseId: "rel-1",
    });
    expect(ok.status).toBe(201);
    const { deadline } = await ok.json();
    expect(deadline.pitchId).toBe("pitch-own");
    expect(deadline.releaseId).toBe("rel-1");
  });

  it("404s patching/deleting an unknown deadline", async () => {
    expect((await patch("/playlist-pitch/deadlines/nope", { status: "sent" })).status).toBe(404);
    expect((await del("/playlist-pitch/deadlines/nope")).status).toBe(404);
  });
});

describe("summarizeDeadlines", () => {
  it("answered deadlines are never overdue and never due next", () => {
    const now = new Date("2026-10-21T00:00:00Z");
    const rows = [
      {
        id: "d1", pitch_id: null, release_id: null, curator_name: null,
        playlist_name: "Old Answered", deadline_at: new Date("2026-01-01T00:00:00Z"),
        status: "answered", notes: null, created_at: now, updated_at: now,
      },
    ] as any;
    const out = summarizeDeadlines(rows, now);
    expect(out.deadlines[0]!.overdue).toBe(false);
    expect(out.dueNext).toBeNull();
    expect(out.overdueCount).toBe(0);
  });
});
