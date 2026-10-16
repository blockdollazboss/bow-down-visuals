/**
 * Route tests for Stack 9 "Reach" (routes/reach) driven like real
 * callers over HTTP against a generic fake db (see _reach-fake-db):
 *   #1 destination keys are write-only (never in any response) and
 *      fan-out verdicts are honest (WebM → codec error, hosted
 *      transport → can't relay, MP4 → live relay started);
 *   #2 premieres withhold the video before start and derive position
 *      from the server clock once live;
 *   #3 raids carry the REAL heartbeat viewer count and refuse dead
 *      targets;
 *   #5 watch accrual is server-measured and drops pay from the
 *      1,000 VB/week stream-drop budget, stopping at the cap;
 *   #6 loyalty menu validation, redeem → pending → decline refunds;
 *   #7 circle management; #8 broadcast one-to-many rules + inbox.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const CREATOR = "00000000-0000-4000-8000-0000000000aa";
const CREATOR_PROFILE = "11111111-1111-4111-8111-111111111111";
const FAN = "00000000-0000-4000-8000-0000000000bb";
const FAN_PROFILE = "11111111-1111-4111-8111-111111111112";
const OTHER = "00000000-0000-4000-8000-0000000000cc";
const OTHER_PROFILE = "11111111-1111-4111-8111-111111111113";
const STREAM = "22222222-2222-4222-8222-222222222222";
const TARGET_STREAM = "22222222-2222-4222-8222-222222222223";
const CLIP = "33333333-3333-4333-8333-333333333333";
const STREAM_KEY = "super-secret-key-xyz";

vi.hoisted(() => {
  process.env["SOCIAL_TOKEN_KEY"] = "b".repeat(64);
});

const h = vi.hoisted(() => ({
  fake: null as any,
  grants: [] as Array<{ userId: string; amount: number }>,
  session: null as { ext: string | null; liveDir: string } | null,
  relayStarts: [] as string[][],
  relayKills: 0,
  now: Date.now(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(u);
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => null,
  addCreditsAtomic: async (userId: string, amount: number) => {
    h.grants.push({ userId, amount });
    return { oldCredits: 0, newCredits: amount, created: false };
  },
  addCreditsToProfile: async (userId: string, amount: number) => {
    h.grants.push({ userId, amount });
    return { oldCredits: 0, newCredits: amount };
  },
}));

vi.mock("../../lib/own-server-live", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getSession: () => h.session };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb(
    {
      creatorProfiles: actual.creatorProfilesTable,
      liveStreams: actual.liveStreamsTable,
      liveDestinationKeys: actual.liveDestinationKeysTable,
      premieres: actual.premieresTable,
      liveRaids: actual.liveRaidsTable,
      streamWatchProgress: actual.streamWatchProgressTable,
      streamDropAwards: actual.streamDropAwardsTable,
      sharkDrops: actual.sharkDropsTable,
      loyaltySettings: actual.loyaltySettingsTable,
      loyaltyBalances: actual.loyaltyBalancesTable,
      loyaltyRedemptions: actual.loyaltyRedemptionsTable,
      closeFriends: actual.closeFriendsTable,
      broadcastChannels: actual.broadcastChannelsTable,
      broadcastMembers: actual.broadcastMembersTable,
      broadcastPosts: actual.broadcastPostsTable,
      generatedClips: actual.generatedClipsTable,
      notifications: actual.notificationsTable,
      follows: actual.followsTable,
    },
    {
      liveDestinationKeys: [["user_id", "platform"]],
      streamDropAwards: [["user_id", "stream_id", "threshold_seconds"]],
      streamWatchProgress: [["user_id", "stream_id"]],
      loyaltyBalances: [["user_id", "profile_id"]],
      loyaltySettings: [["profile_id"]],
      broadcastMembers: [["channel_id", "user_id"]],
      closeFriends: [["owner_user_id", "friend_user_id"]],
      broadcastChannels: [["profile_id"]],
    },
  );
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import router, { __resetWatchTracker } from "../reach";
import { touchViewer, __resetViewerTracker } from "../live-streams";
import { __setRelayFactory, __resetRelays } from "../../lib/multistream";
import { currentWeekStart } from "../../lib/retention";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function call(method: string, path: string, user?: string, body?: unknown) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { "x-test-user": user } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, json, text };
}

function seedBasics() {
  h.fake.seed("creatorProfiles", [
    { id: CREATOR_PROFILE, userId: CREATOR, slug: "raider", displayName: "Raider", avatarUrl: null },
    { id: FAN_PROFILE, userId: FAN, slug: "fan", displayName: "Fan", avatarUrl: null },
    { id: OTHER_PROFILE, userId: OTHER, slug: "other", displayName: "Other", avatarUrl: null },
  ]);
}

function seedLiveStream(over: Record<string, unknown> = {}) {
  h.fake.seed("liveStreams", [
    {
      id: STREAM,
      user_id: CREATOR,
      profile_id: CREATOR_PROFILE,
      title: "Friday set",
      status: "live",
      provider: "own-server",
      provider_input_id: null,
      playback_id: null,
      whip_url: null,
      destinations: [
        { platform: "site", label: "Your profile", status: "active", save_recording: true, vod_url: null, vod_state: null },
        { platform: "youtube", label: "youtube", status: "pending", save_recording: true, vod_url: null, vod_state: null },
      ],
      tip_goal_vb: null,
      viewer_count: 0,
      peak_viewers: 0,
      vod_url: null,
      vod_clip_id: null,
      started_at: new Date(),
      ended_at: null,
      ...over,
    },
  ]);
}

beforeEach(() => {
  h.fake.clear();
  h.grants = [];
  h.session = null;
  h.relayStarts = [];
  h.relayKills = 0;
  h.now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => h.now);
  __resetWatchTracker();
  __resetViewerTracker();
  __resetRelays();
  __setRelayFactory((args: string[]) => {
    h.relayStarts.push(args);
    return {
      kill: () => {
        h.relayKills++;
      },
      onExit: () => undefined,
    };
  });
  seedBasics();
});

/* ── #1 destinations ─────────────────────────────────────────────── */

describe("multistream destination keys — write-only secrets", () => {
  it("PUT stores the key encrypted; GET returns platform/ingest/hasKey and NEVER the key", async () => {
    const put = await call("PUT", "/reach/destinations/youtube", CREATOR, {
      ingestUrl: "rtmp://a.rtmp.youtube.com/live2",
      streamKey: STREAM_KEY,
    });
    expect(put.status).toBe(200);
    expect(put.text).not.toContain(STREAM_KEY);
    const stored = h.fake.store("liveDestinationKeys").rows[0];
    expect(stored.stream_key).not.toBe(STREAM_KEY);
    expect(stored.stream_key).not.toContain(STREAM_KEY);

    const list = await call("GET", "/reach/destinations", CREATOR);
    expect(list.status).toBe(200);
    expect(list.text).not.toContain(STREAM_KEY);
    expect(list.json.destinations).toEqual([
      expect.objectContaining({ platform: "youtube", ingestUrl: "rtmp://a.rtmp.youtube.com/live2", hasKey: true }),
    ]);
    // Another user's list is empty — keys are per-creator.
    const other = await call("GET", "/reach/destinations", FAN);
    expect(other.json.destinations).toEqual([]);
  });

  it("rejects a non-RTMP ingest URL and the site destination", async () => {
    const bad = await call("PUT", "/reach/destinations/youtube", CREATOR, { ingestUrl: "https://example.com/x", streamKey: "k" });
    expect(bad.status).toBe(400);
    const site = await call("PUT", "/reach/destinations/site", CREATOR, { ingestUrl: "rtmp://x.tv/a", streamKey: "k" });
    expect(site.status).toBe(400);
  });
});

describe("fan-out verdicts — honest transitions", () => {
  async function saveKey() {
    await call("PUT", "/reach/destinations/youtube", CREATOR, { ingestUrl: "rtmp://a.rtmp.youtube.com/live2", streamKey: STREAM_KEY });
  }

  it("WebM session → destination error with the codec reason, no relay started", async () => {
    seedLiveStream();
    await saveKey();
    h.session = { ext: "webm", liveDir: "/tmp/fake-live" };
    const res = await call("POST", `/reach/streams/${STREAM}/fanout`, CREATOR, {});
    expect(res.status).toBe(200);
    expect(res.json.verdicts).toEqual([expect.objectContaining({ platform: "youtube", status: "error" })]);
    expect(res.json.verdicts[0].reason).toMatch(/WebM/);
    expect(h.relayStarts).toHaveLength(0);
    const row = h.fake.store("liveStreams").rows[0];
    const yt = row.destinations.find((d: any) => d.platform === "youtube");
    expect(yt.status).toBe("error");
    expect(yt.error_reason).toMatch(/WebM/);
  });

  it("MP4 session → relay starts (-c copy to the RTMP target) and destination goes live", async () => {
    seedLiveStream();
    await saveKey();
    h.session = { ext: "mp4", liveDir: "/tmp/fake-live" };
    const res = await call("POST", `/reach/streams/${STREAM}/fanout`, CREATOR, {});
    expect(res.json.verdicts).toEqual([expect.objectContaining({ platform: "youtube", status: "live" })]);
    expect(h.relayStarts).toHaveLength(1);
    const args = h.relayStarts[0];
    expect(args).toContain("copy");
    expect(args[args.length - 1]).toBe(`rtmp://a.rtmp.youtube.com/live2/${STREAM_KEY}`);
    const row = h.fake.store("liveStreams").rows[0];
    expect(row.destinations.find((d: any) => d.platform === "youtube").status).toBe("live");
  });

  it("hosted-transport stream → error saying the feed never reaches this server", async () => {
    seedLiveStream({ provider: "cloudflare-stream" });
    await saveKey();
    const res = await call("POST", `/reach/streams/${STREAM}/fanout`, CREATOR, {});
    expect(res.json.verdicts[0].status).toBe("error");
    expect(res.json.verdicts[0].reason).toMatch(/own stage|hosted transport/i);
    expect(h.relayStarts).toHaveLength(0);
  });

  it("no key saved → stays pending (the UI's 'not configured'), nothing started", async () => {
    seedLiveStream();
    h.session = { ext: "mp4", liveDir: "/tmp/fake-live" };
    const res = await call("POST", `/reach/streams/${STREAM}/fanout`, CREATOR, {});
    expect(res.json.verdicts).toEqual([expect.objectContaining({ platform: "youtube", status: "pending" })]);
    expect(h.relayStarts).toHaveLength(0);
  });

  it("only the owner can run fan-out", async () => {
    seedLiveStream();
    const res = await call("POST", `/reach/streams/${STREAM}/fanout`, FAN, {});
    expect(res.status).toBe(403);
  });
});

/* ── #2 premieres ────────────────────────────────────────────────── */

describe("premieres", () => {
  function seedClip() {
    h.fake.seed("generatedClips", [
      { id: CLIP, user_id: CREATOR, title: "New video", video_url: "https://cdn.example.com/v.mp4", status: "completed" },
    ]);
  }

  it("schedules a finished video; the page withholds the video until start", async () => {
    seedClip();
    const when = new Date(Date.now() + 3600_000).toISOString();
    const created = await call("POST", "/reach/premieres", CREATOR, { clipId: CLIP, title: "Big reveal", durationSeconds: 300, scheduledAt: when });
    expect(created.status).toBe(201);
    expect(created.json.premiere.phase).toBe("scheduled");
    expect(created.json.premiere.videoUrl).toBeNull();
    expect(created.json.premiere.chatStreamId).toBeNull();
    expect(created.json.premiere.kind).toBe("premiere");
  });

  it("refuses unfinished or someone else's video, and past times", async () => {
    seedClip();
    const past = await call("POST", "/reach/premieres", CREATOR, {
      clipId: CLIP,
      title: "x",
      durationSeconds: 60,
      scheduledAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(past.status).toBe(400);
    const notMine = await call("POST", "/reach/premieres", FAN, {
      clipId: CLIP,
      title: "x",
      durationSeconds: 60,
      scheduledAt: new Date(Date.now() + 60000).toISOString(),
    });
    expect(notMine.status).toBe(404);
  });

  it("once live, position comes from the server clock and the chat room exists", async () => {
    const start = new Date(Date.now() - 120_000);
    h.fake.seed("premieres", [
      {
        id: "44444444-4444-4444-8444-444444444444",
        owner_user_id: CREATOR,
        profile_id: CREATOR_PROFILE,
        clip_id: CLIP,
        title: "Live premiere",
        video_url: "https://cdn.example.com/v.mp4",
        duration_seconds: 900,
        scheduled_at: start,
        status: "scheduled",
        stream_id: null,
      },
    ]);
    const res = await call("GET", "/reach/premieres/44444444-4444-4444-8444-444444444444");
    expect(res.status).toBe(200);
    expect(res.json.premiere.phase).toBe("live");
    expect(res.json.premiere.positionSeconds).toBeGreaterThanOrEqual(115);
    expect(res.json.premiere.positionSeconds).toBeLessThanOrEqual(130);
    expect(res.json.premiere.videoUrl).toBe("https://cdn.example.com/v.mp4");
    expect(res.json.premiere.chatStreamId).toBeTruthy();
    // The chat room is a real live_streams row keyed to the premiere.
    const rooms = h.fake.store("liveStreams").rows;
    expect(rooms).toHaveLength(1);
    expect(rooms[0].provider).toBe("premiere");
  });
});

/* ── #3 raids ────────────────────────────────────────────────────── */

describe("raids", () => {
  function seedTarget(status = "live") {
    h.fake.seed("liveStreams", [
      {
        id: TARGET_STREAM,
        user_id: OTHER,
        profile_id: OTHER_PROFILE,
        title: "Target show",
        status,
        provider: "own-server",
        destinations: [],
        viewer_count: 0,
        peak_viewers: 0,
        started_at: new Date(),
        ended_at: null,
      },
    ]);
  }

  it("carries the REAL heartbeat viewer count; target gets alert + notification", async () => {
    seedLiveStream();
    seedTarget();
    touchViewer(STREAM, "sess-1");
    touchViewer(STREAM, "sess-2");
    touchViewer(STREAM, "sess-3");
    const res = await call("POST", `/reach/streams/${STREAM}/raid`, CREATOR, { targetStreamId: TARGET_STREAM });
    expect(res.status).toBe(201);
    expect(res.json.raid.viewerCount).toBe(3);
    const notes = h.fake.store("notifications").rows;
    expect(notes).toHaveLength(1);
    expect(notes[0].userId).toBe(OTHER);
    const out = await call("GET", `/reach/streams/${STREAM}/raid-outgoing`);
    expect(out.json.raid.id).toBe(res.json.raid.id);
  });

  it("refuses to raid a stream that isn't live — honest failure, no raid row", async () => {
    seedLiveStream();
    seedTarget("ended");
    const res = await call("POST", `/reach/streams/${STREAM}/raid`, CREATOR, { targetStreamId: TARGET_STREAM });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("TARGET_NOT_LIVE");
    expect(h.fake.store("liveRaids").rows).toHaveLength(0);
  });

  it("a non-owner can't raid from someone else's stream", async () => {
    seedLiveStream();
    seedTarget();
    const res = await call("POST", `/reach/streams/${STREAM}/raid`, FAN, { targetStreamId: TARGET_STREAM });
    expect(res.status).toBe(403);
  });
});

/* ── #5 drops ────────────────────────────────────────────────────── */

describe("stream-linked drops — server-measured time, capped budget", () => {
  it("crossing 10 minutes of real accrued time pays 100 VB exactly once", async () => {
    seedLiveStream();
    h.fake.seed("streamWatchProgress", [{ id: "p1", user_id: FAN, stream_id: STREAM, seconds_watched: 590 }]);
    const beat1 = await call("POST", `/reach/streams/${STREAM}/watch`, FAN, { sessionId: "session-1" });
    expect(beat1.json.secondsWatched).toBe(590); // first beat measures nothing yet
    h.now += 20_000;
    const beat2 = await call("POST", `/reach/streams/${STREAM}/watch`, FAN, { sessionId: "session-1" });
    expect(beat2.json.secondsWatched).toBe(610);
    expect(beat2.json.justAwarded).toEqual([{ thresholdSeconds: 600, amountVb: 100 }]);
    expect(h.grants).toEqual([{ userId: FAN, amount: 100 }]);
    h.now += 20_000;
    const beat3 = await call("POST", `/reach/streams/${STREAM}/watch`, FAN, { sessionId: "session-1" });
    expect(beat3.json.justAwarded).toEqual([]);
    expect(h.grants).toHaveLength(1);
  });

  it("a lying client can't mint time: one beat claims at most 30 seconds", async () => {
    seedLiveStream();
    await call("POST", `/reach/streams/${STREAM}/watch`, FAN, { sessionId: "session-9" });
    h.now += 3600_000; // an hour "passes" between beats
    const beat = await call("POST", `/reach/streams/${STREAM}/watch`, FAN, { sessionId: "session-9" });
    expect(beat.json.secondsWatched).toBe(30);
  });

  it("the weekly 1,000 VB stream-drop budget stops further awards honestly", async () => {
    seedLiveStream();
    // 900 VB already spent platform-wide this week by other viewers.
    h.fake.seed("streamDropAwards", [
      { id: "a1", user_id: OTHER, stream_id: TARGET_STREAM, threshold_seconds: 600, amount_vb: 500, week_start: currentWeekStart() },
      { id: "a2", user_id: OTHER, stream_id: TARGET_STREAM, threshold_seconds: 1800, amount_vb: 400, week_start: currentWeekStart() },
    ]);
    h.fake.seed("streamWatchProgress", [{ id: "p2", user_id: FAN, stream_id: STREAM, seconds_watched: 1790 }]);
    // First beat: 1790s already crosses the 600s threshold — it pays
    // the last 100 VB of the weekly budget right there.
    const beat1 = await call("POST", `/reach/streams/${STREAM}/watch`, FAN, { sessionId: "session-2" });
    expect(beat1.json.justAwarded).toEqual([{ thresholdSeconds: 600, amountVb: 100 }]);
    h.now += 20_000;
    const beat = await call("POST", `/reach/streams/${STREAM}/watch`, FAN, { sessionId: "session-2" });
    expect(beat.json.secondsWatched).toBe(1810);
    // 1800s threshold (200 VB) can't pay — the budget is spent, and
    // the response says so instead of promising a drop.
    expect(beat.json.justAwarded).toEqual([]);
    expect(beat.json.budgetReached).toBe(true);
    expect(h.grants).toEqual([{ userId: FAN, amount: 100 }]);
  });
});

/* ── #6 loyalty ──────────────────────────────────────────────────── */

describe("loyalty — fixed menu, redeem lifecycle", () => {
  it("settings reject off-menu rates and accept menu rates", async () => {
    const bad = await call("PUT", `/reach/loyalty/${CREATOR_PROFILE}/settings`, CREATOR, {
      watchPointsPer10Min: 7,
      chatPoints: 2,
      tipPointsPer100Vb: 5,
    });
    expect(bad.status).toBe(400);
    const good = await call("PUT", `/reach/loyalty/${CREATOR_PROFILE}/settings`, CREATOR, {
      watchPointsPer10Min: 20,
      chatPoints: 5,
      tipPointsPer100Vb: 10,
      customRewardLabel: "Pick the next game",
      customRewardCost: 2500,
    });
    expect(good.status).toBe(200);
    expect(good.json.perks.map((p: any) => p.kind)).toEqual(["shoutout", "priority_chat", "custom"]);
    expect(good.json.notice).toMatch(/not Visual Bucs/i);
  });

  it("redeem spends points → pending; creator decline refunds in full", async () => {
    h.fake.seed("loyaltyBalances", [{ user_id: FAN, profile_id: CREATOR_PROFILE, points: 600, watch_minutes_credited: 0 }]);
    const redeem = await call("POST", `/reach/loyalty/${CREATOR_PROFILE}/redeem`, FAN, { perkKind: "shoutout" });
    expect(redeem.status).toBe(201);
    expect(redeem.json.myPoints).toBe(100);
    expect(redeem.json.redemption.status).toBe("pending");
    const poor = await call("POST", `/reach/loyalty/${CREATOR_PROFILE}/redeem`, FAN, { perkKind: "priority_chat" });
    expect(poor.status).toBe(400);
    const queue = await call("GET", `/reach/loyalty/${CREATOR_PROFILE}/redemptions`, CREATOR);
    expect(queue.json.redemptions).toHaveLength(1);
    const resolve = await call("POST", `/reach/loyalty/redemptions/${redeem.json.redemption.id}/resolve`, CREATOR, { decision: "declined" });
    expect(resolve.status).toBe(200);
    const after = await call("GET", `/reach/loyalty/${CREATOR_PROFILE}`, FAN);
    expect(after.json.myPoints).toBe(600);
  });

  it("only the channel creator sets rules or resolves redemptions", async () => {
    const res = await call("PUT", `/reach/loyalty/${CREATOR_PROFILE}/settings`, FAN, {
      watchPointsPer10Min: 10,
      chatPoints: 2,
      tipPointsPer100Vb: 5,
    });
    expect(res.status).toBe(403);
  });
});

/* ── #7 circle management ────────────────────────────────────────── */

describe("close-friends circle management", () => {
  it("add → list → remove round-trips; self-add is refused", async () => {
    const add = await call("POST", "/reach/close-friends", CREATOR, { friendProfileId: FAN_PROFILE });
    expect(add.status).toBe(201);
    const list = await call("GET", "/reach/close-friends", CREATOR);
    expect(list.json.friends).toHaveLength(1);
    expect(list.json.friends[0].profile.slug).toBe("fan");
    const self = await call("POST", "/reach/close-friends", CREATOR, { friendProfileId: CREATOR_PROFILE });
    expect(self.status).toBe(400);
    const del = await call("DELETE", `/reach/close-friends/${FAN_PROFILE}`, CREATOR);
    expect(del.status).toBe(200);
    const after = await call("GET", "/reach/close-friends", CREATOR);
    expect(after.json.friends).toEqual([]);
  });
});

/* ── #8 broadcast channels ───────────────────────────────────────── */

describe("broadcast channels — one-to-many, no gates", () => {
  it("create → join → only the creator posts → members read, non-members can't", async () => {
    const created = await call("POST", "/reach/broadcast/channels", CREATOR, { name: "Inner circle news", description: "Drops first" });
    expect(created.status).toBe(201);
    const channelId = created.json.channel.id;
    const dupe = await call("POST", "/reach/broadcast/channels", CREATOR, { name: "Second", description: "" });
    expect(dupe.status).toBe(409);

    const join = await call("POST", `/reach/broadcast/channels/${channelId}/join`, FAN, {});
    expect(join.json.memberCount).toBe(1);

    const memberPost = await call("POST", `/reach/broadcast/channels/${channelId}/posts`, FAN, { body: "let me post" });
    expect(memberPost.status).toBe(403);

    const post = await call("POST", `/reach/broadcast/channels/${channelId}/posts`, CREATOR, { body: "New drop Friday" });
    expect(post.status).toBe(201);

    const memberRead = await call("GET", `/reach/broadcast/channels/${channelId}/posts`, FAN);
    expect(memberRead.status).toBe(200);
    expect(memberRead.json.posts[0].body).toBe("New drop Friday");

    const outsiderRead = await call("GET", `/reach/broadcast/channels/${channelId}/posts`, OTHER);
    expect(outsiderRead.status).toBe(403);
    expect(outsiderRead.json.code).toBe("NOT_A_MEMBER");

    const inbox = await call("GET", "/reach/broadcast/inbox", FAN);
    expect(inbox.json.posts.map((p: any) => p.body)).toContain("New drop Friday");
    expect(inbox.json.posts[0].channelName).toBe("Inner circle news");
  });
});
