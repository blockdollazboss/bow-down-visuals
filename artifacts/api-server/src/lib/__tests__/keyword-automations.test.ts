/**
 * Keyword automations (migration 0232, Wave 4 #32) — the trigger +
 * capture engine over pg-mem, DDL mirroring the migration.
 *
 * Pins:
 *  - a comment carrying the keyword (whole word, any case) on an
 *    enabled rule's surface fires exactly one DM from the creator on
 *    the house messages rail + a 'sent' audit row;
 *  - switch OFF = silent (no DM, no audit row); a rule belonging to
 *    another creator never fires; a surface the rule doesn't cover
 *    never fires; a keyword buried inside a longer word never fires;
 *  - loop guards: the creator's own comments never fire their rules;
 *    a fan can never be DM'd twice by the same rule about the same
 *    post (dedupe ledger); the capture rail listens only to the fan;
 *  - rate limits land honestly: fan daily cap, rule hourly cap —
 *    a capped fire records 'rate_limited', sends nothing;
 *  - the DM rail's own gates hold: a blocked conversation and an
 *    unaccepted fan-started request record 'blocked', send nothing;
 *  - email capture: a capture rule's DM carries the ask; the fan's
 *    emailed reply subscribes them to the creator's EXISTING list
 *    exactly once (source 'keyword_automation', welcome sequence
 *    queued), an address already on the list records
 *    'already_on_list', an unsubscribed address re-activates, an
 *    expired pending capture stops listening.
 *
 * Harness note: pg-mem cannot run drizzle's typed selects (rowMode),
 * so — like the lip-sync / booking lanes — this suite speaks raw SQL
 * for seeds and assertions; the engine under test does the same.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { sql, type SQL } from "drizzle-orm";

const h = vi.hoisted(() => ({ db: null as any }));
const welcome = vi.hoisted(() => ({ calls: [] as Array<{ list: any; subscriber: any }> }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../email-campaign-sender", () => ({
  queueWelcomeSequence: vi.fn(async (list: any, subscriber: any) => {
    welcome.calls.push({ list, subscriber });
    return [];
  }),
}));

import {
  handleKeywordComment,
  handleDmEmailCapture,
  queueKeywordComment,
  queueDmEmailCapture,
  normalizeKeyword,
  keywordMatches,
  extractEmail,
  KW_CAPTURE_PROMPT,
  KW_FAN_DAILY_CAP,
  KW_RULE_HOURLY_SEND_CAP,
} from "../keyword-automations";
import { createTestDb, type TestDb } from "./test-db";

const DDL = `
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text, display_name text);
CREATE TABLE follows (follower_user_id uuid NOT NULL, profile_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (follower_user_id, profile_id));
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), participant_a uuid NOT NULL, participant_b uuid NOT NULL,
  status text NOT NULL DEFAULT 'inbox', requested_by uuid, last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL, sender_user_id uuid NOT NULL,
  body text NOT NULL, attachment_url text, attachment_type text, attachment_name text,
  is_read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE email_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL, handle text NOT NULL,
  description text, welcome_subject text, welcome_body text, welcome2_subject text, welcome2_body text,
  welcome3_subject text, welcome3_body text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE email_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), list_id uuid NOT NULL, email text NOT NULL, name text,
  source text NOT NULL DEFAULT 'landing', confirmed boolean NOT NULL DEFAULT true,
  opens integer NOT NULL DEFAULT 0, clicks integer NOT NULL DEFAULT 0,
  unsubscribe_token text, unsubscribed_at timestamptz, subscribed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE keyword_automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creator_user_id uuid NOT NULL,
  list_id uuid REFERENCES email_lists(id) ON DELETE SET NULL,
  keyword text NOT NULL, surfaces jsonb NOT NULL DEFAULT '["post"]'::jsonb, dm_body text NOT NULL,
  capture_email boolean NOT NULL DEFAULT false, enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE keyword_automation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rule_id uuid NOT NULL REFERENCES keyword_automation_rules(id) ON DELETE CASCADE,
  creator_user_id uuid NOT NULL, fan_user_id uuid NOT NULL, surface text NOT NULL, surface_ref text NOT NULL,
  outcome text NOT NULL, dm_message_id uuid, captured_email text, detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX keyword_automation_events_dedupe_ux ON keyword_automation_events (rule_id, fan_user_id, surface, surface_ref) WHERE outcome = 'sent';
CREATE TABLE keyword_automation_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rule_id uuid NOT NULL REFERENCES keyword_automation_rules(id) ON DELETE CASCADE,
  creator_user_id uuid NOT NULL, fan_user_id uuid NOT NULL, conversation_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending', captured_email text,
  created_at timestamptz NOT NULL DEFAULT now(), captured_at timestamptz
);
CREATE UNIQUE INDEX keyword_automation_captures_pending_ux ON keyword_automation_captures (rule_id, fan_user_id) WHERE status = 'pending';
`;

const CREATOR = randomUUID();
const CREATOR2 = randomUUID();
const FAN = randomUUID();
const FAN2 = randomUUID();

let t: TestDb;

beforeEach(() => {
  t = createTestDb();
  t.mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    impure: true,
    implementation: () => randomUUID(),
  });
  t.mem.public.none(DDL);
  h.db = t.db;
  welcome.calls.length = 0;
});

async function q<T = Record<string, any>>(query: SQL): Promise<T[]> {
  const res = await t.db.execute(query);
  return res.rows as T[];
}

interface RuleSeed {
  creatorUserId?: string;
  keyword?: string;
  dmBody?: string;
  surfaces?: string[];
  captureEmail?: boolean;
  listId?: string | null;
  enabled?: boolean;
  enabledAt?: Date | null;
}

async function makeRule(over: RuleSeed = {}) {
  const id = randomUUID();
  const surfaces = JSON.stringify(over.surfaces ?? ["post", "media", "wall", "live"]);
  const enabledAt = over.enabledAt === undefined ? new Date(Date.now() - 60_000) : over.enabledAt;
  await t.db.execute(sql`
    INSERT INTO keyword_automation_rules
      (id, creator_user_id, list_id, keyword, surfaces, dm_body, capture_email, enabled, enabled_at)
    VALUES (${id}, ${over.creatorUserId ?? CREATOR}, ${over.listId ?? null}, ${over.keyword ?? "link"},
            ${surfaces}::jsonb, ${over.dmBody ?? "Here's the thing you asked for: https://example.com/thing"},
            ${over.captureEmail ?? false}, ${over.enabled ?? true}, ${enabledAt})`);
  return { id };
}

async function makeList(owner = CREATOR) {
  const id = randomUUID();
  await t.db.execute(sql`
    INSERT INTO email_lists (id, user_id, name, handle)
    VALUES (${id}, ${owner}, 'Fan List', ${"h-" + randomUUID().slice(0, 8)})`);
  return { id };
}

const comment = (over: Partial<Parameters<typeof handleKeywordComment>[0]> = {}) =>
  handleKeywordComment({
    ownerUserId: CREATOR,
    commenterUserId: FAN,
    body: "LINK please!",
    surface: "post",
    surfaceRefId: randomUUID(),
    ...over,
  });

const allMessages = () => q(sql`SELECT * FROM messages`);
const allEvents = () => q(sql`SELECT * FROM keyword_automation_events`);
const allConvs = () => q(sql`SELECT * FROM conversations`);
const allCaptures = () => q(sql`SELECT * FROM keyword_automation_captures`);
const allSubs = () => q(sql`SELECT * FROM email_subscribers`);

/* ── Pure helpers ─────────────────────────────────────────────────── */

describe("pure helpers", () => {
  it("normalizeKeyword accepts single tokens and rejects the rest", () => {
    expect(normalizeKeyword(" LINK ")).toBe("link");
    expect(normalizeKeyword("My-Link_2")).toBe("my-link_2");
    expect(normalizeKeyword("two words")).toBeNull();
    expect(normalizeKeyword("")).toBeNull();
    expect(normalizeKeyword("x".repeat(41))).toBeNull();
    expect(normalizeKeyword(42)).toBeNull();
  });

  it("keywordMatches is whole-word and case-insensitive", () => {
    expect(keywordMatches("drop the LINK!", "link")).toBe(true);
    expect(keywordMatches("Link, please", "link")).toBe(true);
    expect(keywordMatches("hyperlink energy", "link")).toBe(false);
    expect(keywordMatches("linkin park", "link")).toBe(false);
    expect(keywordMatches("no trigger here", "link")).toBe(false);
  });

  it("extractEmail finds and lowercases the first address", () => {
    expect(extractEmail("hit me at Fan@Example.COM please")).toBe("fan@example.com");
    expect(extractEmail("no address here")).toBeNull();
  });
});

/* ── Firing ───────────────────────────────────────────────────────── */

describe("trigger firing", () => {
  it("fires one DM from the creator + a sent audit row", async () => {
    const rule = await makeRule();
    const postId = randomUUID();
    await comment({ surfaceRefId: postId });
    const msgs = await allMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.sender_user_id).toBe(CREATOR);
    expect(msgs[0]!.body).toContain("Here's the thing");
    expect(msgs[0]!.body).not.toContain(KW_CAPTURE_PROMPT);
    const convs = await allConvs();
    expect(convs).toHaveLength(1);
    /* Not mutual followers → the DM lands as a request, the rail's law. */
    expect(convs[0]!.status).toBe("request");
    expect(convs[0]!.requested_by).toBe(CREATOR);
    const events = await allEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ rule_id: rule.id, fan_user_id: FAN, outcome: "sent", surface: "post", surface_ref: postId });
    expect(events[0]!.dm_message_id).toBe(msgs[0]!.id);
  });

  it("lands in the inbox when creator and fan follow each other", async () => {
    const creatorProfile = randomUUID();
    const fanProfile = randomUUID();
    await t.db.execute(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${creatorProfile}, ${CREATOR}), (${fanProfile}, ${FAN})`);
    await t.db.execute(sql`INSERT INTO follows (follower_user_id, profile_id) VALUES (${CREATOR}, ${fanProfile}), (${FAN}, ${creatorProfile})`);
    await makeRule();
    await comment();
    const convs = await allConvs();
    expect(convs[0]!.status).toBe("inbox");
  });

  it("switch OFF is silent — no DM, no audit row", async () => {
    await makeRule({ enabled: false, enabledAt: null });
    await comment();
    expect(await allMessages()).toHaveLength(0);
    expect(await allEvents()).toHaveLength(0);
  });

  it("never fires on the creator's own comments (no self-trigger)", async () => {
    await makeRule();
    await comment({ commenterUserId: CREATOR });
    expect(await allMessages()).toHaveLength(0);
    expect(await allEvents()).toHaveLength(0);
  });

  it("never fires another creator's rule", async () => {
    await makeRule({ creatorUserId: CREATOR2 });
    await comment();
    expect(await allMessages()).toHaveLength(0);
  });

  it("respects the rule's surface list", async () => {
    await makeRule({ surfaces: ["live"] });
    await comment({ surface: "post" });
    expect(await allMessages()).toHaveLength(0);
    await comment({ surface: "live", surfaceRefId: randomUUID() });
    expect(await allMessages()).toHaveLength(1);
  });

  it("dedupes per (rule, fan, surface, ref): same post twice = one DM", async () => {
    await makeRule();
    const postId = randomUUID();
    await comment({ surfaceRefId: postId });
    await comment({ surfaceRefId: postId });
    expect(await allMessages()).toHaveLength(1);
    expect((await allEvents()).filter((e) => e.outcome === "sent")).toHaveLength(1);
    /* A different post is a different fire. */
    await comment({ surfaceRefId: randomUUID() });
    expect(await allMessages()).toHaveLength(2);
  });

  it("does not fire before the rule was switched on (enabled_at gate)", async () => {
    await makeRule({ enabledAt: new Date(Date.now() + 60_000) });
    await comment();
    expect(await allMessages()).toHaveLength(0);
  });
});

/* ── Rate limits + rail gates ─────────────────────────────────────── */

describe("limits and gates", () => {
  it("fan daily cap: the 4th distinct post records rate_limited, sends nothing", async () => {
    await makeRule();
    for (let i = 0; i < KW_FAN_DAILY_CAP; i++) await comment();
    expect(await allMessages()).toHaveLength(KW_FAN_DAILY_CAP);
    await comment();
    expect(await allMessages()).toHaveLength(KW_FAN_DAILY_CAP);
    const caps = (await allEvents()).filter((e) => e.outcome === "rate_limited");
    expect(caps).toHaveLength(1);
    expect(caps[0]!.detail).toBe("fan_daily_cap");
  });

  it("rule hourly cap: a rule at its cap records rate_limited", async () => {
    const rule = await makeRule();
    for (let i = 0; i < KW_RULE_HOURLY_SEND_CAP; i++) {
      await t.db.execute(sql`
        INSERT INTO keyword_automation_events (rule_id, creator_user_id, fan_user_id, surface, surface_ref, outcome)
        VALUES (${rule.id}, ${CREATOR}, ${randomUUID()}, 'post', ${randomUUID()}, 'sent')`);
    }
    await comment();
    expect(await allMessages()).toHaveLength(0);
    const caps = (await allEvents()).filter((e) => e.outcome === "rate_limited");
    expect(caps).toHaveLength(1);
    expect(caps[0]!.detail).toBe("rule_hourly_cap");
  });

  it("a blocked conversation records blocked and sends nothing", async () => {
    await makeRule();
    const [a, b] = CREATOR < FAN ? [CREATOR, FAN] : [FAN, CREATOR];
    await t.db.execute(sql`
      INSERT INTO conversations (participant_a, participant_b, status, requested_by)
      VALUES (${a}, ${b}, 'blocked', ${CREATOR})`);
    await comment();
    expect(await allMessages()).toHaveLength(0);
    const events = await allEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: "blocked", detail: "blocked" });
  });

  it("an unaccepted fan-started request records blocked and sends nothing", async () => {
    await makeRule();
    const [a, b] = CREATOR < FAN ? [CREATOR, FAN] : [FAN, CREATOR];
    await t.db.execute(sql`
      INSERT INTO conversations (participant_a, participant_b, status, requested_by)
      VALUES (${a}, ${b}, 'request', ${FAN})`);
    await comment();
    expect(await allMessages()).toHaveLength(0);
    const events = await allEvents();
    expect(events[0]).toMatchObject({ outcome: "blocked", detail: "request_pending" });
  });
});

/* ── Email capture ────────────────────────────────────────────────── */

describe("email capture", () => {
  async function firedCapture() {
    const list = await makeList();
    const rule = await makeRule({ captureEmail: true, listId: list.id });
    await comment();
    const convs = await allConvs();
    return { list, rule, conversationId: convs[0]!.id as string };
  }

  it("the DM carries the ask and a pending capture is recorded", async () => {
    await firedCapture();
    const msgs = await allMessages();
    expect(msgs[0]!.body).toContain(KW_CAPTURE_PROMPT);
    const captures = await allCaptures();
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({ fan_user_id: FAN, status: "pending" });
  });

  it("the fan's emailed reply subscribes them to the creator's list exactly once", async () => {
    const { list, conversationId } = await firedCapture();
    await handleDmEmailCapture({ senderUserId: FAN, conversationId, body: "yes! fan@Example.com" });
    const subs = await allSubs();
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ list_id: list.id, email: "fan@example.com", source: "keyword_automation", confirmed: true });
    expect(subs[0]!.unsubscribe_token).toBeTruthy();
    expect(welcome.calls).toHaveLength(1);
    expect(welcome.calls[0]!.list.id).toBe(list.id);
    expect(welcome.calls[0]!.subscriber.email).toBe("fan@example.com");
    const captures = await allCaptures();
    expect(captures[0]).toMatchObject({ status: "captured", captured_email: "fan@example.com" });
    const events = await allEvents();
    expect(events.filter((e) => e.outcome === "captured")).toHaveLength(1);
    /* Capture consumed: a second email in the thread writes nothing. */
    await handleDmEmailCapture({ senderUserId: FAN, conversationId, body: "also other@example.com" });
    expect(await allSubs()).toHaveLength(1);
  });

  it("an address already on the list records already_on_list, never duplicates", async () => {
    const { list, conversationId } = await firedCapture();
    await t.db.execute(sql`
      INSERT INTO email_subscribers (list_id, email, source) VALUES (${list.id}, 'fan@example.com', 'landing')`);
    await handleDmEmailCapture({ senderUserId: FAN, conversationId, body: "fan@example.com" });
    expect(await allSubs()).toHaveLength(1);
    expect(welcome.calls).toHaveLength(0);
    const events = await allEvents();
    expect(events.filter((e) => e.outcome === "already_on_list")).toHaveLength(1);
    const captures = await allCaptures();
    expect(captures[0]!.status).toBe("captured");
  });

  it("an unsubscribed address re-activates (the subscribe door's behavior)", async () => {
    const { list, conversationId } = await firedCapture();
    await t.db.execute(sql`
      INSERT INTO email_subscribers (list_id, email, source, unsubscribed_at)
      VALUES (${list.id}, 'fan@example.com', 'landing', now())`);
    await handleDmEmailCapture({ senderUserId: FAN, conversationId, body: "fan@example.com" });
    const subs = await allSubs();
    expect(subs).toHaveLength(1);
    expect(subs[0]!.unsubscribed_at).toBeNull();
    expect(subs[0]!.source).toBe("keyword_automation");
  });

  it("no pending capture = an emailed DM is just a DM", async () => {
    await handleDmEmailCapture({ senderUserId: FAN2, conversationId: randomUUID(), body: "fan2@example.com" });
    expect(await allSubs()).toHaveLength(0);
  });

  it("a reply without an email changes nothing", async () => {
    const { conversationId } = await firedCapture();
    await handleDmEmailCapture({ senderUserId: FAN, conversationId, body: "thanks!" });
    expect(await allSubs()).toHaveLength(0);
    const captures = await allCaptures();
    expect(captures[0]!.status).toBe("pending");
  });

  it("an expired pending capture stops listening", async () => {
    const { conversationId, rule } = await firedCapture();
    await t.db.execute(sql`
      UPDATE keyword_automation_captures
      SET created_at = ${new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)}
      WHERE rule_id = ${rule.id}`);
    await handleDmEmailCapture({ senderUserId: FAN, conversationId, body: "fan@example.com" });
    expect(await allSubs()).toHaveLength(0);
    const captures = await allCaptures();
    expect(captures[0]!.status).toBe("expired");
  });

  it("the creator's own messages in the thread never capture", async () => {
    const { conversationId } = await firedCapture();
    await handleDmEmailCapture({ senderUserId: CREATOR, conversationId, body: "creator@example.com" });
    expect(await allSubs()).toHaveLength(0);
  });

  it("queued hooks add zero footprint to the calling tick, then still fire", async () => {
    const list = await makeList();
    await makeRule({ captureEmail: true, listId: list.id });
    queueKeywordComment({
      ownerUserId: CREATOR,
      commenterUserId: FAN,
      body: "LINK please!",
      surface: "post",
      surfaceRefId: randomUUID(),
    });
    // The hook has returned but the engine has not run yet: no DM, no
    // audit row, no pending capture in the request's own tick.
    expect(await allMessages()).toHaveLength(0);
    expect(await allEvents()).toHaveLength(0);
    expect(await allCaptures()).toHaveLength(0);
    await vi.waitFor(async () => {
      expect(await allMessages()).toHaveLength(1);
    });
    const convs = await allConvs();
    queueDmEmailCapture({
      senderUserId: FAN,
      conversationId: convs[0]!.id as string,
      body: "fan@example.com",
    });
    await vi.waitFor(async () => {
      expect(await allSubs()).toHaveLength(1);
    });
  });
});
