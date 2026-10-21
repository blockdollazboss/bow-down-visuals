/**
 * Home-base command view (social-platforms dossier C3).
 * Five panels over REAL in-tree sources, with the earnings honesty
 * contract: a source with no rows reads 0/empty (status ok); a failed
 * source reads status "error" with null numbers and partial: true —
 * never a fake 0; a panel answers 500 only when ALL its primary
 * sources failed, so the client fails that panel alone.
 * Revenue math reuses the /api/earnings readers (store, memberships,
 * brand deals, tips-in-VB) plus the beats rail net of commission.
 * The brief is draft-only: the model's href is never trusted (the
 * server maps kind → href), the endpoint writes nothing, and the
 * written narrative is the only part the AI provider can kill: a
 * provider failure (no key, a thrown call, unusable output) serves
 * the digest itself with narrativeUnavailable: true — the panel fails
 * only when the digest itself cannot be built at all.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";

const testState = vi.hoisted(() => ({ db: null as any }));
const aiState = vi.hoisted(() => ({
  mode: "ok" as "ok" | "down" | "garbage" | "throws",
  response: null as any,
  lastUserContent: "",
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
    req.userId = String(u); next();
  },
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});
vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  getOpenAI: () => {
    if (aiState.mode === "down") throw new Error("OPENAI_API_KEY is not configured");
    return {
      chat: { completions: { create: async (args: any) => {
        aiState.lastUserContent = args.messages[1].content;
        if (aiState.mode === "throws") throw new Error("provider exploded mid-call");
        if (aiState.mode === "garbage") {
          return { choices: [{ message: { content: "not json at all" } }] };
        }
        return { choices: [{ message: { content: JSON.stringify(aiState.response) } }] };
      } } },
    };
  },
}));

import commandRouter from "../command";
import { __resetTipJarStores } from "../generate/tip-jar";
import { createTestDb } from "../../lib/__tests__/test-db";

const TABLES = `
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text, total_plays integer NOT NULL DEFAULT 0, follower_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE follows (follower_user_id uuid NOT NULL, profile_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE email_lists (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE email_subscribers (id uuid PRIMARY KEY, list_id uuid NOT NULL, unsubscribed_at timestamptz, subscribed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE fan_members (id uuid PRIMARY KEY, user_id uuid NOT NULL, price_cents integer NOT NULL DEFAULT 0, stripe_session_id text, status text NOT NULL DEFAULT 'active', joined_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE store_orders (id uuid PRIMARY KEY, profile_id uuid NOT NULL, creator_amount_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'completed', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE shop_events (id uuid PRIMARY KEY, user_id uuid NOT NULL, event_type text NOT NULL, amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0);
CREATE TABLE sponsor_payouts (id uuid PRIMARY KEY, creator_user_id text NOT NULL, net_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'released');
CREATE TABLE live_stream_tips (id uuid PRIMARY KEY, creator_user_id uuid NOT NULL, amount_vb integer NOT NULL DEFAULT 0, creator_credited_at timestamptz);
CREATE TABLE profile_tracks (id uuid PRIMARY KEY, profile_id uuid NOT NULL, title text, play_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE profile_videos (id uuid PRIMARY KEY, profile_id uuid NOT NULL, title text, view_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE conversations (id uuid PRIMARY KEY, participant_a uuid NOT NULL, participant_b uuid NOT NULL);
CREATE TABLE messages (id uuid PRIMARY KEY, conversation_id uuid NOT NULL, sender_user_id uuid NOT NULL, is_read boolean NOT NULL DEFAULT false);
CREATE TABLE shoutout_requests (id uuid PRIMARY KEY, creator_user_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending_payment');
CREATE TABLE social_accounts (id uuid PRIMARY KEY, user_id uuid NOT NULL, platform text NOT NULL, username text);
CREATE TABLE social_stat_snapshots (id uuid PRIMARY KEY, user_id uuid NOT NULL, platform text NOT NULL, followers integer, recorded_at timestamptz NOT NULL DEFAULT now());
`;
const BEATS_TABLE = `
CREATE TABLE beat_licenses (id uuid PRIMARY KEY, producer_id uuid NOT NULL, price_cents integer NOT NULL DEFAULT 0, commission_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'pending_payment');
`;
const FULL_DDL = TABLES + BEATS_TABLE;
/* Audience primaries (follows / email / fan_members / profiles) gone:
   the audience panel must 500 while revenue still answers. */
const NO_AUDIENCE_DDL = `
CREATE TABLE store_orders (id uuid PRIMARY KEY, profile_id uuid NOT NULL, creator_amount_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'completed', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE shop_events (id uuid PRIMARY KEY, user_id uuid NOT NULL, event_type text NOT NULL, amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0);
CREATE TABLE sponsor_payouts (id uuid PRIMARY KEY, creator_user_id text NOT NULL, net_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'released');
CREATE TABLE live_stream_tips (id uuid PRIMARY KEY, creator_user_id uuid NOT NULL, amount_vb integer NOT NULL DEFAULT 0, creator_credited_at timestamptz);
CREATE TABLE social_accounts (id uuid PRIMARY KEY, user_id uuid NOT NULL, platform text NOT NULL, username text);
CREATE TABLE social_stat_snapshots (id uuid PRIMARY KEY, user_id uuid NOT NULL, platform text NOT NULL, followers integer, recorded_at timestamptz NOT NULL DEFAULT now());
` + BEATS_TABLE;

const USER = randomUUID();
const OTHER = randomUUID();
const THIRD = randomUUID();
const PROFILE = randomUUID();
const OTHER_PROFILE = randomUUID();
const LIST = randomUUID();
const CONVO = randomUUID();
const CONVO_OTHER = randomUUID();

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);
const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {} }; next(); });
  app.use(commandRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

function freshDb(ddl = FULL_DDL) {
  const { db, mem } = createTestDb();
  mem.public.none(ddl);
  testState.db = db;
  return db;
}

async function seedAll() {
  const db = testState.db;
  __resetTipJarStores();
  await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, total_plays, follower_count) VALUES (${PROFILE}, ${USER}, 'me', 150, 3)`);
  await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug) VALUES (${OTHER_PROFILE}, ${OTHER}, 'them')`);
  /* Followers: USER 3 (2 this week), OTHER 5. */
  for (const d of [2, 3, 20]) {
    await db.execute(sql`INSERT INTO follows (follower_user_id, profile_id, created_at) VALUES (${randomUUID()}, ${PROFILE}, ${daysAgo(d)})`);
  }
  for (let i = 0; i < 5; i++) {
    await db.execute(sql`INSERT INTO follows (follower_user_id, profile_id, created_at) VALUES (${randomUUID()}, ${OTHER_PROFILE}, ${daysAgo(1)})`);
  }
  /* Email: USER 4 active (1 this week), 1 unsubscribed. */
  await db.execute(sql`INSERT INTO email_lists (id, user_id) VALUES (${LIST}, ${USER})`);
  for (const d of [1, 10, 11, 12]) {
    await db.execute(sql`INSERT INTO email_subscribers (id, list_id, subscribed_at) VALUES (${randomUUID()}, ${LIST}, ${daysAgo(d)})`);
  }
  await db.execute(sql`INSERT INTO email_subscribers (id, list_id, subscribed_at, unsubscribed_at) VALUES (${randomUUID()}, ${LIST}, ${daysAgo(2)}, ${daysAgo(1)})`);
  /* Members: USER active x3 (1 this week), trialing x1, past_due x2, canceled x1. */
  const member = async (status: string, d: number, price = 0, session: string | null = null) => {
    await db.execute(sql`INSERT INTO fan_members (id, user_id, status, joined_at, price_cents, stripe_session_id) VALUES (${randomUUID()}, ${USER}, ${status}, ${daysAgo(d)}, ${price}, ${session})`);
  };
  await member("active", 1, 1000, "sess_1");
  await member("active", 30);
  await member("active", 40);
  await member("trialing", 30, 500, "sess_2");
  await member("past_due", 30);
  await member("past_due", 30);
  await member("canceled", 30);
  /* Revenue. */
  await db.execute(sql`INSERT INTO store_orders (id, profile_id, creator_amount_cents, status) VALUES (${randomUUID()}, ${PROFILE}, 10000, 'completed'), (${randomUUID()}, ${PROFILE}, 2500, 'completed'), (${randomUUID()}, ${PROFILE}, 9999, 'refunded'), (${randomUUID()}, ${OTHER_PROFILE}, 7777, 'completed')`);
  await db.execute(sql`INSERT INTO shop_events (id, user_id, event_type, amount_cents, platform_fee_cents) VALUES (${randomUUID()}, ${USER}, 'sale', 5000, 250), (${randomUUID()}, ${USER}, 'refund', 1000, 0)`);
  await db.execute(sql`INSERT INTO sponsor_payouts (id, creator_user_id, net_cents, status) VALUES (${randomUUID()}, ${USER}, 3000, 'released'), (${randomUUID()}, ${USER}, 999, 'pending')`);
  await db.execute(sql`INSERT INTO beat_licenses (id, producer_id, price_cents, commission_cents, status) VALUES (${randomUUID()}, ${USER}, 10000, 1500, 'completed'), (${randomUUID()}, ${USER}, 5000, 750, 'completed'), (${randomUUID()}, ${USER}, 8000, 1200, 'pending_payment'), (${randomUUID()}, ${USER}, 8000, 1200, 'refunded'), (${randomUUID()}, ${OTHER}, 8000, 1200, 'completed')`);
  await db.execute(sql`INSERT INTO live_stream_tips (id, creator_user_id, amount_vb, creator_credited_at) VALUES (${randomUUID()}, ${USER}, 300, now()), (${randomUUID()}, ${USER}, 200, now()), (${randomUUID()}, ${USER}, 999, NULL)`);
  /* Content. */
  await db.execute(sql`INSERT INTO profile_tracks (id, profile_id, title, play_count) VALUES (${randomUUID()}, ${PROFILE}, 'Top Song', 120), (${randomUUID()}, ${PROFILE}, 'Second', 30)`);
  await db.execute(sql`INSERT INTO profile_videos (id, profile_id, title, view_count) VALUES (${randomUUID()}, ${PROFILE}, 'Top Vid', 900), (${randomUUID()}, ${PROFILE}, 'Other Vid', 10)`);
  /* Actions: unread from OTHER x2; read x1; own unread x1 (excluded). */
  await db.execute(sql`INSERT INTO conversations (id, participant_a, participant_b) VALUES (${CONVO}, ${USER}, ${OTHER}), (${CONVO_OTHER}, ${OTHER}, ${THIRD})`);
  const msg = async (convo: string, sender: string, read: boolean) => {
    await db.execute(sql`INSERT INTO messages (id, conversation_id, sender_user_id, is_read) VALUES (${randomUUID()}, ${convo}, ${sender}, ${read})`);
  };
  await msg(CONVO, OTHER, false); await msg(CONVO, OTHER, false);
  await msg(CONVO, OTHER, true); await msg(CONVO, USER, false);
  await msg(CONVO_OTHER, THIRD, false);
  const shout = async (creator: string, status: string) => {
    await db.execute(sql`INSERT INTO shoutout_requests (id, creator_user_id, status) VALUES (${randomUUID()}, ${creator}, ${status})`);
  };
  await shout(USER, "accepted"); await shout(USER, "in_progress");
  await shout(USER, "pending_payment"); await shout(USER, "delivered");
  await shout(OTHER, "accepted"); await shout(OTHER, "accepted"); await shout(OTHER, "accepted");
  /* Off-platform: connected IG with two snapshots (100 → 130). */
  await db.execute(sql`INSERT INTO social_accounts (id, user_id, platform, username) VALUES (${randomUUID()}, ${USER}, 'instagram', 'me')`);
  await db.execute(sql`INSERT INTO social_stat_snapshots (id, user_id, platform, followers, recorded_at) VALUES (${randomUUID()}, ${USER}, 'instagram', 100, ${daysAgo(6)}), (${randomUUID()}, ${USER}, 'instagram', 130, ${daysAgo(1)})`);
}

async function get(path: string, user: string | null = USER) {
  const r = await realFetch(`${baseUrl}${path}`, {
    headers: user ? { "x-test-user": user } : {},
  });
  return { status: r.status, body: await r.json().catch(() => ({})) as any };
}

beforeEach(() => {
  aiState.mode = "ok";
  aiState.response = null;
  aiState.lastUserContent = "";
  freshDb();
});

describe("command audience", () => {
  it("rolls up followers, subscribers, members with real 7-day growth, owner-scoped", async () => {
    await seedAll();
    const { status, body } = await get("/command/audience");
    expect(status).toBe(200);
    expect(body.followers).toEqual({ total: 3, new7: 2 });
    expect(body.subscribers).toEqual({ total: 4, new7: 1 });
    expect(body.members).toEqual({ total: 4, new7: 1 });
    expect(body.partial).toBe(false);
  });

  it("off-platform rows come only from connected accounts' own snapshots", async () => {
    await seedAll();
    const mine = await get("/command/audience", USER);
    expect(mine.body.offPlatform.connected).toBe(true);
    expect(mine.body.offPlatform.platforms).toEqual([
      { platform: "instagram", username: "me", followers: 130, delta: 30 },
    ]);
    const theirs = await get("/command/audience", OTHER);
    expect(theirs.body.offPlatform).toEqual({ connected: false, platforms: [] });
  });

  it("a brand-new creator reads honest zeros, not an error", async () => {
    const { status, body } = await get("/command/audience", randomUUID());
    expect(status).toBe(200);
    expect(body.followers).toEqual({ total: 0, new7: 0 });
    expect(body.members).toEqual({ total: 0, new7: 0 });
  });

  it("the panel 500s only when every primary source failed — and revenue still answers", async () => {
    freshDb(NO_AUDIENCE_DDL);
    const aud = await get("/command/audience");
    expect(aud.status).toBe(500);
    expect(aud.body.error).toBe("command_panel_failed");
    const rev = await get("/command/revenue");
    expect(rev.status).toBe(200);
    expect(rev.body.partial).toBe(true);
    expect(rev.body.sources.memberships).toBe("error");
  });
});

describe("command revenue", () => {
  it("sums every rail from the real ledgers; tips stay in VB and out of the USD total", async () => {
    await seedAll();
    const { status, body } = await get("/command/revenue");
    expect(status).toBe(200);
    expect(body.rails.store.totalCents).toBe(17250); // 12500 orders + 4750 net shop sale
    expect(body.rails.store.count).toBe(3);
    expect(body.rails.memberships.totalCents).toBe(1500); // verified paid checkouts only
    expect(body.rails.brandDeals.totalCents).toBe(3000); // released only
    expect(body.rails.beats.totalCents).toBe(12750); // completed, net of commission
    expect(body.rails.beats.count).toBe(2);
    expect(body.totalCents).toBe(34500);
    expect(body.totalTipsVb).toBe(500); // credited only; the uncredited 999 stays out
    expect(body.partial).toBe(false);
  });

  it("a failed rail reads null + error + partial — never a fake 0 — while siblings stay exact", async () => {
    freshDb(TABLES); // no beat_licenses table
    /* seedAll seeds the revenue tables before its beat inserts throw;
       everything the revenue panel needs is already in place. */
    await seedAll().catch(() => {});
    const { status, body } = await get("/command/revenue");
    expect(status).toBe(200);
    expect(body.sources.beats).toBe("error");
    expect(body.rails.beats).toBeNull();
    expect(body.partial).toBe(true);
    expect(typeof body.totalCents).toBe("number");
  });
});

describe("command content", () => {
  it("surfaces totals and the top track/video by their real counts", async () => {
    await seedAll();
    const { status, body } = await get("/command/content");
    expect(status).toBe(200);
    expect(body.hasProfile).toBe(true);
    expect(body.profile.slug).toBe("me");
    expect(body.topTrack).toEqual({ title: "Top Song", playCount: 120 });
    expect(body.topVideo).toEqual({ title: "Top Vid", viewCount: 900 });
    expect(body.totals).toEqual({ trackCount: 2, trackPlays: 150, videoCount: 2, videoViews: 910 });
  });

  it("no profile is an honest absent, not zeros and not an error", async () => {
    await seedAll();
    const { status, body } = await get("/command/content", randomUUID());
    expect(status).toBe(200);
    expect(body.hasProfile).toBe(false);
    expect(body.profile).toBeNull();
    expect(body.topTrack).toBeNull();
  });
});

describe("command actions", () => {
  it("counts only what actually needs the creator: others' unread, past-due, shoutouts awaiting delivery", async () => {
    await seedAll();
    const { status, body } = await get("/command/actions");
    expect(status).toBe(200);
    const byKey = Object.fromEntries(body.items.map((i: any) => [i.key, i]));
    expect(byKey.unreadMessages).toEqual({ key: "unreadMessages", count: 2, href: "/messages" });
    expect(byKey.pastDueMembers.count).toBe(2);
    expect(byKey.shoutoutsToDeliver.count).toBe(2); // accepted + in_progress; pending_payment/delivered excluded
    expect(body.total).toBe(6);
  });
});

describe("command brief", () => {
  it("returns the summary + ONE move, with the href mapped server-side — the model's href is never trusted", async () => {
    await seedAll();
    aiState.response = {
      summary: "Your list grew this week and two members need a win-back.",
      move: { kind: "winback", title: "Win back 2 members", draft: "Hey — we miss you. Come back home.", href: "https://evil.example/phish" },
    };
    const { status, body } = await get("/command/brief");
    expect(status).toBe(200);
    expect(body.summary).toContain("list grew");
    expect(body.move).toEqual({
      kind: "winback",
      title: "Win back 2 members",
      draft: "Hey — we miss you. Come back home.",
      href: "/memberships",
    });
    /* The digest the model saw carries the real seeded numbers. */
    const digest = JSON.parse(aiState.lastUserContent);
    const pastDue = digest.actions.items.find((i: any) => i.key === "pastDueMembers");
    expect(pastDue.count).toBe(2);
    /* Success shape is exact: no fallback flag, no digest echo. */
    expect(Object.keys(body).sort()).toEqual(["generatedAt", "move", "summary"]);
  });

  it("is draft-only: generating a brief writes nothing anywhere", async () => {
    await seedAll();
    aiState.response = {
      summary: "Steady week.",
      move: { kind: "reply", title: "Answer your messages", draft: "Thanks for reaching out!" },
    };
    const before = rows(await testState.db.execute(sql`SELECT status FROM shoutout_requests`));
    const res = await get("/command/brief");
    expect(res.status).toBe(200);
    const after = rows(await testState.db.execute(sql`SELECT status FROM shoutout_requests`));
    expect(after).toEqual(before);
    const msgs = rows(await testState.db.execute(sql`SELECT COUNT(*)::int AS n FROM messages`));
    expect(msgs[0].n).toBe(5);
  });

  it("a missing AI provider serves the digest, flagged — the panel lives on its data", async () => {
    await seedAll();
    aiState.mode = "down";
    const brief = await get("/command/brief");
    expect(brief.status).toBe(200);
    expect(brief.body.narrativeUnavailable).toBe(true);
    /* The narrative fields are honestly empty — nothing invented. */
    expect(brief.body.summary).toBe("");
    expect(brief.body.move).toBeNull();
    expect(typeof brief.body.generatedAt).toBe("string");
    /* The digest is this request's real data, panel-shaped. */
    expect(brief.body.digest.audience.followers).toEqual({ total: 3, new7: 2 });
    expect(brief.body.digest.revenue.totalCents).toBe(34500);
    const pastDue = brief.body.digest.actions.items.find((i: any) => i.key === "pastDueMembers");
    expect(pastDue.count).toBe(2);
    const aud = await get("/command/audience");
    expect(aud.status).toBe(200);
  });

  it("a provider call that throws serves the digest, flagged", async () => {
    await seedAll();
    aiState.mode = "throws";
    const brief = await get("/command/brief");
    expect(brief.status).toBe(200);
    expect(brief.body.narrativeUnavailable).toBe(true);
    expect(brief.body.summary).toBe("");
    expect(brief.body.move).toBeNull();
    expect(brief.body.digest.content.topTrack).toEqual({ title: "Top Song", playCount: 120 });
  });

  it("unparseable AI output serves the digest, flagged — never an invented brief", async () => {
    await seedAll();
    aiState.mode = "garbage";
    const brief = await get("/command/brief");
    expect(brief.status).toBe(200);
    expect(brief.body.narrativeUnavailable).toBe(true);
    expect(brief.body.summary).toBe("");
    expect(brief.body.move).toBeNull();
    expect(brief.body.digest.audience.subscribers).toEqual({ total: 4, new7: 1 });
  });

  it("a partial digest still serves: surviving panels real, failed panels null", async () => {
    freshDb(NO_AUDIENCE_DDL);
    aiState.mode = "down";
    const brief = await get("/command/brief");
    expect(brief.status).toBe(200);
    expect(brief.body.narrativeUnavailable).toBe(true);
    expect(brief.body.digest.audience).toBeNull();
    expect(brief.body.digest.content).toBeNull();
    expect(brief.body.digest.actions).toBeNull();
    expect(brief.body.digest.revenue).not.toBeNull();
    expect(brief.body.digest.revenue.partial).toBe(true);
  });

  it("the failure state remains only for a digest that cannot be built at all", async () => {
    freshDb("CREATE TABLE unrelated (id int);"); // no real tables: every panel builder fails, the digest is empty
    const brief = await get("/command/brief");
    expect(brief.status).toBe(502);
    expect(brief.body.error).toBe("brief_unavailable");
    expect(brief.body.narrativeUnavailable).toBeUndefined();
    expect(brief.body.digest).toBeUndefined();
  });
});

describe("command auth", () => {
  it("every panel refuses the unauthenticated", async () => {
    await seedAll();
    for (const p of ["/command/audience", "/command/revenue", "/command/content", "/command/actions", "/command/brief"]) {
      const { status } = await get(p, null);
      expect(status).toBe(401);
    }
  });
});

function rows(r: any): any[] {
  return (r.rows ?? []) as any[];
}
