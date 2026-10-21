/**
 * Route tests for World Contests (routes/world-contests):
 *   POST /api/world/contests              host a contest
 *   GET  /api/world/contests              the public board
 *   GET  /api/world/contests/:id          detail: entries + winners
 *   POST /api/world/contests/:id/entries  enter your own work
 *   POST /api/world/contests/:id/winners  host/house names winners
 *   GET  /api/world/winners-circle        the honors, public
 *
 * Contract pinned here (UPGRADE-PROGRAM 2.24, v1):
 * - stages are the Throne Hall + Music Hall only; a Throne Hall
 *   contest is hosted by a Front Row member (server truth: a seat
 *   in the KING'S royal_court) or an admin; the Music Hall takes
 *   any member. Guests host nothing and enter nothing.
 * - an entry is ONE of the caller's own PUBLISHED works (track or
 *   video) per contest: another member's work is a 404 (never
 *   leaked), an unpublished work is refused, a second entry and a
 *   post-deadline entry are refused with the plain reason.
 * - judging opens at the deadline; only the host or the house
 *   names the winners; the podium comes from the contest's own
 *   entries; one decision stands forever; the winners' landing
 *   fires the palace announcement hook exactly once.
 * - the board, the detail and the Winners' Circle are PUBLIC —
 *   guests read the honors like everyone else.
 *
 * Fake db mirrors world-events.test.ts: real table objects via
 * importOriginal, rows in the shared _reach-fake-db store.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const FRONT = "00000000-0000-4000-8000-0000000000f1";
const PLAIN = "00000000-0000-4000-8000-0000000000f2";
const NOPROF = "00000000-0000-4000-8000-0000000000f3";
const ADMIN = "00000000-0000-4000-8000-0000000000f4";
const THIRD = "00000000-0000-4000-8000-0000000000f5";
const KING_PROFILE = "11111111-1111-4111-8111-111111111111";
const FRONT_PROFILE = "22222222-2222-4222-8222-222222222222";
const PLAIN_PROFILE = "33333333-3333-4333-8333-333333333333";
const THIRD_PROFILE = "44444444-4444-4444-8444-444444444444";
const PLAIN_TRACK = "55555555-5555-4555-8555-555555555501";
const PLAIN_DRAFT = "55555555-5555-4555-8555-555555555502";
const FRONT_VIDEO = "66666666-6666-4666-8666-666666666601";
const THIRD_DRAFT = "77777777-7777-4777-8777-777777777701";
const THIRD_VIDEO = "77777777-7777-4777-8777-777777777702";
const PAST_CONTEST = "88888888-8888-4888-8888-888888888801";
const PAST_ENTRY_FRONT = "99999999-9999-4999-8999-999999999901";
const PAST_ENTRY_PLAIN = "99999999-9999-4999-8999-999999999902";
const PAST_ENTRY_THIRD = "99999999-9999-4999-8999-999999999903";
const CANCELLED_CONTEST = "88888888-8888-4888-8888-888888888802";
const MUSIC = "world:music-hall";
const THRONE = "world:kings-hall";

const h = vi.hoisted(() => ({ fake: null as any }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(user);
    req.userEmail = req.headers["x-test-email"] ? String(req.headers["x-test-email"]) : undefined;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }) }),
  addCreditsAtomic: async () => undefined,
  addCreditsToProfile: async () => ({ oldCredits: 0 }),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb(
    {
      worldEvents: actual.worldEventsTable,
      worldContestEntries: actual.worldContestEntriesTable,
      worldContestWinners: actual.worldContestWinnersTable,
      creatorProfiles: actual.creatorProfilesTable,
      royalCourt: actual.royalCourtTable,
      profileTracks: actual.profileTracksTable,
      profileVideos: actual.profileVideosTable,
    },
    {
      worldContestEntries: [["eventId", "userId"]],
      worldContestWinners: [["entryId"], ["eventId", "place"]],
    },
  );
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import worldContestsRouter from "../world-contests";
import { registerWorldContestAnnouncer } from "../../lib/world-contests";

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  process.env["ADMIN_EMAILS"] = "king@example.test";
  const app = express();
  app.use(express.json());
  app.use("/api", worldContestsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  registerWorldContestAnnouncer(null);
  await new Promise((r) => server.close(r));
});

const DAY = 24 * 3600_000;
function seedAll() {
  h.fake.seed("creatorProfiles", [
    { id: KING_PROFILE, userId: "00000000-0000-4000-8000-000000000099", slug: "thy-cheat-code", displayName: "Thy Cheat Code", isOfficial: true, isPublic: true },
    { id: FRONT_PROFILE, userId: FRONT, slug: "front", displayName: "Front Row Fran", isOfficial: false, isPublic: true },
    { id: PLAIN_PROFILE, userId: PLAIN, slug: "plain", displayName: "Plain Pat", isOfficial: false, isPublic: true },
    { id: THIRD_PROFILE, userId: THIRD, slug: "third", displayName: "Third Theo", isOfficial: false, isPublic: true },
  ]);
  h.fake.seed("royalCourt", [
    { id: "court-1", ownerProfileId: KING_PROFILE, memberProfileId: FRONT_PROFILE, position: 1 },
  ]);
  h.fake.seed("profileTracks", [
    { id: PLAIN_TRACK, profileId: PLAIN_PROFILE, title: "Plain Anthem", audioUrl: "https://x.test/a.mp3", isPublished: true },
    { id: PLAIN_DRAFT, profileId: PLAIN_PROFILE, title: "Plain Draft", audioUrl: "https://x.test/d.mp3", isPublished: false },
    { id: THIRD_DRAFT, profileId: THIRD_PROFILE, title: "Theo Draft", audioUrl: "https://x.test/t.mp3", isPublished: false },
  ]);
  h.fake.seed("profileVideos", [
    { id: FRONT_VIDEO, profileId: FRONT_PROFILE, title: "Fran's Film", videoUrl: "https://x.test/f.mp4", isPublished: true },
    { id: THIRD_VIDEO, profileId: THIRD_PROFILE, title: "Theo's Reel", videoUrl: "https://x.test/r.mp4", isPublished: true },
  ]);
  const now = Date.now();
  h.fake.seed("worldEvents", [
    {
      id: PAST_CONTEST, kind: "contest", roomId: MUSIC, hostUserId: PLAIN,
      title: "Yesterday's Crown", startsAt: new Date(now - 2 * DAY), endsAt: new Date(now - 3600_000),
      payload: { theme: "Hooks that stop the scroll" }, status: "scheduled", createdAt: new Date(now - 2 * DAY),
    },
    {
      id: CANCELLED_CONTEST, kind: "contest", roomId: MUSIC, hostUserId: PLAIN,
      title: "Called Off Crown", startsAt: new Date(now - DAY), endsAt: new Date(now + DAY),
      payload: { theme: "Hooks" }, status: "cancelled", createdAt: new Date(now - DAY),
    },
  ]);
  h.fake.seed("worldContestEntries", [
    { id: PAST_ENTRY_FRONT, eventId: PAST_CONTEST, userId: FRONT, workKind: "video", workId: FRONT_VIDEO, createdAt: new Date(now - DAY) },
    { id: PAST_ENTRY_PLAIN, eventId: PAST_CONTEST, userId: PLAIN, workKind: "track", workId: PLAIN_TRACK, createdAt: new Date(now - DAY) },
    { id: PAST_ENTRY_THIRD, eventId: PAST_CONTEST, userId: THIRD, workKind: "video", workId: THIRD_VIDEO, createdAt: new Date(now - DAY) },
  ]);
  h.fake.seed("worldContestWinners", []);
}
beforeEach(() => {
  h.fake.clear();
  seedAll();
  registerWorldContestAnnouncer(null);
});

interface CallOpts { user?: string; email?: string; body?: unknown }
async function call(method: string, path: string, opts: CallOpts = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.user) headers["x-test-user"] = opts.user;
  if (opts.email) headers["x-test-email"] = opts.email;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, json };
}

const future = (ms: number) => new Date(Date.now() + ms).toISOString();

async function hostMusicContest(user = PLAIN): Promise<any> {
  const { status, json } = await call("POST", "/api/world/contests", {
    user,
    body: { title: "Best Hook in the Palace", theme: "A hook that stops the scroll", roomId: MUSIC, endsAt: future(2 * DAY) },
  });
  expect(status).toBe(201);
  return json.contest;
}

/* ── Hosting ────────────────────────────────────────────────────── */

describe("hosting a contest", () => {
  it("a member hosts in the Music Hall; the contest opens for entries at once", async () => {
    const contest = await hostMusicContest();
    expect(contest).toMatchObject({
      title: "Best Hook in the Palace",
      theme: "A hook that stops the scroll",
      roomId: MUSIC,
      hostName: "Plain Pat",
      phase: "open",
      entryCount: 0,
      winners: [],
    });
  });

  it("a guest hosts nothing (401)", async () => {
    const { status } = await call("POST", "/api/world/contests", {
      body: { title: "X", theme: "Y", roomId: MUSIC, endsAt: future(DAY) },
    });
    expect(status).toBe(401);
  });

  it("the Throne Hall refuses a plain member (FRONT_ROW_REQUIRED) and takes Front Row + the house", async () => {
    const refused = await call("POST", "/api/world/contests", {
      user: PLAIN,
      body: { title: "Throne Crown", theme: "Royalty", roomId: THRONE, endsAt: future(DAY) },
    });
    expect(refused.status).toBe(403);
    expect(refused.json.error).toBe("FRONT_ROW_REQUIRED");

    const byFront = await call("POST", "/api/world/contests", {
      user: FRONT,
      body: { title: "Throne Crown", theme: "Royalty", roomId: THRONE, endsAt: future(DAY) },
    });
    expect(byFront.status).toBe(201);

    const byAdmin = await call("POST", "/api/world/contests", {
      user: ADMIN,
      email: "king@example.test",
      body: { title: "House Crown", theme: "Royalty", roomId: THRONE, endsAt: future(DAY) },
    });
    expect(byAdmin.status).toBe(201);
  });

  it("only a stage will do: other rooms are refused in plain words", async () => {
    const { status, json } = await call("POST", "/api/world/contests", {
      user: PLAIN,
      body: { title: "Yard Crown", theme: "Grass", roomId: "world:courtyard", endsAt: future(DAY) },
    });
    expect(status).toBe(400);
    expect(json.error).toBe("NOT_A_STAGE");
    expect(json.message).toMatch(/Throne Hall or the Music Hall/);
  });

  it("deadlines have a floor and a horizon", async () => {
    const soon = await call("POST", "/api/world/contests", {
      user: PLAIN,
      body: { title: "Blink", theme: "Fast", roomId: MUSIC, endsAt: future(10 * 60_000) },
    });
    expect(soon.status).toBe(400);
    expect(soon.json.error).toBe("INVALID_DEADLINE");
    const far = await call("POST", "/api/world/contests", {
      user: PLAIN,
      body: { title: "Monument", theme: "Slow", roomId: MUSIC, endsAt: future(40 * DAY) },
    });
    expect(far.status).toBe(400);
    expect(far.json.error).toBe("INVALID_DEADLINE");
  });
});

/* ── Entering ───────────────────────────────────────────────────── */

describe("entering a work", () => {
  it("members enter their own published track or video; the board counts them", async () => {
    const contest = await hostMusicContest();
    const e1 = await call("POST", `/api/world/contests/${contest.id}/entries`, {
      user: PLAIN,
      body: { workKind: "track", workId: PLAIN_TRACK },
    });
    expect(e1.status).toBe(201);
    expect(e1.json.entry).toMatchObject({ entrantName: "Plain Pat", workKind: "track", workTitle: "Plain Anthem" });

    const e2 = await call("POST", `/api/world/contests/${contest.id}/entries`, {
      user: FRONT,
      body: { workKind: "video", workId: FRONT_VIDEO },
    });
    expect(e2.status).toBe(201);

    const board = await call("GET", "/api/world/contests");
    const listed = board.json.contests.find((c: any) => c.id === contest.id);
    expect(listed.entryCount).toBe(2);
    expect(listed.phase).toBe("open");
  });

  it("a second entry is refused — one entry each", async () => {
    const contest = await hostMusicContest();
    await call("POST", `/api/world/contests/${contest.id}/entries`, {
      user: PLAIN,
      body: { workKind: "track", workId: PLAIN_TRACK },
    });
    const again = await call("POST", `/api/world/contests/${contest.id}/entries`, {
      user: PLAIN,
      body: { workKind: "track", workId: PLAIN_TRACK },
    });
    expect(again.status).toBe(409);
    expect(again.json.error).toBe("ALREADY_ENTERED");
  });

  it("another member's work is a 404 — never leaked, never enterable", async () => {
    const contest = await hostMusicContest();
    const { status, json } = await call("POST", `/api/world/contests/${contest.id}/entries`, {
      user: PLAIN,
      body: { workKind: "video", workId: FRONT_VIDEO },
    });
    expect(status).toBe(404);
    expect(json.error).toBe("WORK_NOT_FOUND");
  });

  it("an unpublished work is refused with the fix named", async () => {
    const contest = await hostMusicContest();
    const { status, json } = await call("POST", `/api/world/contests/${contest.id}/entries`, {
      user: THIRD,
      body: { workKind: "track", workId: THIRD_DRAFT },
    });
    expect(status).toBe(400);
    expect(json.error).toBe("NOT_PUBLISHED");
    expect(json.message).toMatch(/publish it first/i);
  });

  it("guests enter nothing (401); a member with no profile is told to make one", async () => {
    const contest = await hostMusicContest();
    const guest = await call("POST", `/api/world/contests/${contest.id}/entries`, {
      body: { workKind: "track", workId: PLAIN_TRACK },
    });
    expect(guest.status).toBe(401);
    const noprof = await call("POST", `/api/world/contests/${contest.id}/entries`, {
      user: NOPROF,
      body: { workKind: "track", workId: PLAIN_TRACK },
    });
    expect(noprof.status).toBe(403);
    expect(noprof.json.error).toBe("NO_PROFILE");
  });

  it("after the deadline the door is shut — ENTRIES_CLOSED; a called-off contest takes nothing", async () => {
    const late = await call("POST", `/api/world/contests/${PAST_CONTEST}/entries`, {
      user: FRONT,
      body: { workKind: "video", workId: FRONT_VIDEO },
    });
    expect(late.status).toBe(409);
    expect(late.json.error).toBe("ENTRIES_CLOSED");

    const off = await call("POST", `/api/world/contests/${CANCELLED_CONTEST}/entries`, {
      user: PLAIN,
      body: { workKind: "track", workId: PLAIN_TRACK },
    });
    expect(off.status).toBe(409);
    expect(off.json.error).toBe("CONTEST_CALLED_OFF");
  });

  it("an unknown contest is a plain 404", async () => {
    const { status } = await call("POST", "/api/world/contests/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/entries", {
      user: PLAIN,
      body: { workKind: "track", workId: PLAIN_TRACK },
    });
    expect(status).toBe(404);
  });
});

/* ── The picker's read ──────────────────────────────────────────── */

describe("my works (the entry picker)", () => {
  it("a member reads their own tracks + videos, published flagged honestly", async () => {
    const { status, json } = await call("GET", "/api/world/contests/my-works", { user: PLAIN });
    expect(status).toBe(200);
    const byId = new Map(json.works.map((w: any) => [w.id, w]));
    expect(byId.get(PLAIN_TRACK)).toMatchObject({ workKind: "track", title: "Plain Anthem", isPublished: true });
    expect(byId.get(PLAIN_DRAFT)).toMatchObject({ isPublished: false });
    /* Nobody else's work rides along. */
    expect(byId.has(FRONT_VIDEO)).toBe(false);
    expect(byId.has(THIRD_VIDEO)).toBe(false);
  });

  it("guests get 401; a profile-less member gets an honest empty list", async () => {
    expect((await call("GET", "/api/world/contests/my-works")).status).toBe(401);
    const noprof = await call("GET", "/api/world/contests/my-works", { user: NOPROF });
    expect(noprof.status).toBe(200);
    expect(noprof.json.works).toEqual([]);
  });
});

/* ── Judging ────────────────────────────────────────────────────── */

describe("naming the winners", () => {
  it("judging waits for the deadline (STILL_OPEN)", async () => {
    const contest = await hostMusicContest();
    const { status, json } = await call("POST", `/api/world/contests/${contest.id}/winners`, {
      user: PLAIN,
      body: { entryIds: [PAST_ENTRY_PLAIN] },
    });
    expect(status).toBe(409);
    expect(json.error).toBe("STILL_OPEN");
  });

  it("a stranger can't judge (NOT_THE_HOST) — but the house can", async () => {
    const stranger = await call("POST", `/api/world/contests/${PAST_CONTEST}/winners`, {
      user: FRONT,
      body: { entryIds: [PAST_ENTRY_PLAIN] },
    });
    expect(stranger.status).toBe(403);
    expect(stranger.json.error).toBe("NOT_THE_HOST");
  });

  it("the host names the podium from the entries; the record freezes names + titles; the palace hears it once", async () => {
    const spoken: any[] = [];
    registerWorldContestAnnouncer((a: any) => spoken.push(a));

    const { status, json } = await call("POST", `/api/world/contests/${PAST_CONTEST}/winners`, {
      user: PLAIN,
      body: { entryIds: [PAST_ENTRY_PLAIN, PAST_ENTRY_FRONT, PAST_ENTRY_THIRD] },
    });
    expect(status).toBe(201);
    expect(json.winners).toHaveLength(3);
    expect(json.winners[0]).toMatchObject({ place: 1, winnerName: "Plain Pat", workKind: "track", workTitle: "Plain Anthem" });
    expect(json.winners[1]).toMatchObject({ place: 2, winnerName: "Front Row Fran", workKind: "video", workTitle: "Fran's Film" });
    expect(json.winners[2]).toMatchObject({ place: 3, winnerName: "Third Theo", workTitle: "Theo's Reel" });

    expect(spoken).toHaveLength(1);
    expect(spoken[0].kind).toBe("show");
    expect(spoken[0].text).toContain("Plain Pat");
    expect(spoken[0].text).toContain("Yesterday's Crown");
    expect(spoken[0].text.length).toBeLessThanOrEqual(140);

    /* One decision stands forever. */
    const again = await call("POST", `/api/world/contests/${PAST_CONTEST}/winners`, {
      user: PLAIN,
      body: { entryIds: [PAST_ENTRY_FRONT] },
    });
    expect(again.status).toBe(409);
    expect(again.json.error).toBe("ALREADY_DECIDED");
    expect(spoken).toHaveLength(1);
  });

  it("winners must be entries of THIS contest", async () => {
    const { status, json } = await call("POST", `/api/world/contests/${PAST_CONTEST}/winners`, {
      user: PLAIN,
      body: { entryIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] },
    });
    expect(status).toBe(400);
    expect(json.error).toBe("ENTRY_NOT_IN_CONTEST");
  });

  it("the same entry can't hold two places", async () => {
    const { status, json } = await call("POST", `/api/world/contests/${PAST_CONTEST}/winners`, {
      user: PLAIN,
      body: { entryIds: [PAST_ENTRY_PLAIN, PAST_ENTRY_PLAIN] },
    });
    expect(status).toBe(400);
    expect(json.error).toBe("INVALID_WINNERS");
  });
});

/* ── Public reads: the board, the detail, the Circle ───────────── */

describe("public reads", () => {
  it("a guest reads the board, the detail (entries named) and the Circle", async () => {
    await call("POST", `/api/world/contests/${PAST_CONTEST}/winners`, {
      user: PLAIN,
      body: { entryIds: [PAST_ENTRY_FRONT, PAST_ENTRY_PLAIN] },
    });

    const board = await call("GET", "/api/world/contests");
    expect(board.status).toBe(200);
    const past = board.json.contests.find((c: any) => c.id === PAST_CONTEST);
    expect(past).toMatchObject({ phase: "decided", entryCount: 3 });
    expect(past.winners).toHaveLength(2);
    /* The called-off contest never reaches the board. */
    expect(board.json.contests.some((c: any) => c.id === CANCELLED_CONTEST)).toBe(false);

    const detail = await call("GET", `/api/world/contests/${PAST_CONTEST}`);
    expect(detail.status).toBe(200);
    expect(detail.json.entries).toHaveLength(3);
    expect(detail.json.entries[0]).toMatchObject({ entrantName: "Front Row Fran", workTitle: "Fran's Film" });
    expect(detail.json.contest.phase).toBe("decided");

    const circle = await call("GET", "/api/world/winners-circle");
    expect(circle.status).toBe(200);
    expect(circle.json.honors).toHaveLength(2);
    expect(circle.json.honors[0]).toMatchObject({
      place: 1,
      winnerName: "Front Row Fran",
      workTitle: "Fran's Film",
      contestTitle: "Yesterday's Crown",
      roomId: MUSIC,
    });
    expect(circle.json.honors[1]).toMatchObject({ place: 2, winnerName: "Plain Pat" });
  });

  it("an unknown contest detail is a plain 404", async () => {
    const { status } = await call("GET", "/api/world/contests/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(status).toBe(404);
  });
});
