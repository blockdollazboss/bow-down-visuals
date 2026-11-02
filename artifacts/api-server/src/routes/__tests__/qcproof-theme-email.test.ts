/**
 * qcproof-theme-email.test.ts — QC-200 pre-proof (Q140 / Q189 / Q190).
 *
 * Pins the claims the Oct 30 sweep left unpinned:
 *  Q140 — kit customization RESET: an empty mix PUT clears every saved
 *         row (reset-to-pure-pack) instead of silently keeping the old
 *         mix; Elite entitlement unlocks premium kit downloads with no
 *         purchase row (kitUnlocked seam).
 *  Q189 — the four cap constants at their ruled values; the CREATOR
 *         daily cap (500) firing with a 'rate_limited' audit row
 *         (detail creator_daily_cap); the cap-hit audit throttle (at
 *         most one rate_limited row per rule+fan per hour); the
 *         dedupe partial unique index as a DATABASE law (a direct
 *         duplicate 'sent' insert is refused); email re-activation
 *         writes source='keyword_automation' AND a 'captured' audit
 *         row carrying the address.
 *  Q190 — the subtle bridge rule: a subscriber/shop email and a
 *         DIFFERENT account id carrying facts under that same email
 *         string stay TWO fans unless a fan_members row bridges that
 *         exact account to that exact email; member tier/status/
 *         joinedAt materialize exactly; empty sources = all-zero.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { readFileSync } from "node:fs";
import express from "express";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";

const BUYER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userPlan: null as string | null,
  balances: new Map<string, number>(),
  charges: [] as Array<{ userId: string; cost: number; key: string | null }>,
  chargedKeys: new Set<string>(),
}));
const welcome = vi.hoisted(() => ({ calls: [] as Array<{ list: any; subscriber: any }> }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userPlan = h.userPlan;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../../middlewares/require-tier", () => ({
  resolveCreatorTier: async (userId: string) => {
    const { rows } = await h.db.execute(sql.raw(
      `SELECT cs.tier AS tier, cs.status AS status
         FROM creator_profiles cp
         LEFT JOIN creator_subscriptions cs ON cs.profile_id = cp.id
        WHERE cp.user_id = '${userId}' LIMIT 1`,
    ));
    const row = rows[0] as { tier: string | null; status: string | null } | undefined;
    const admitting = row?.status === "active" || row?.status === "trialing";
    return { tier: admitting && row?.tier ? row.tier : "free", profileId: row ? PROFILE : null };
  },
}));

vi.mock("../../lib/credits", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    chargeCredits: vi.fn(async (userId: string, cost: number, _r: unknown, opts?: { idempotencyKey?: string | null }) => {
      const key = opts?.idempotencyKey ?? null;
      if (key && h.chargedKeys.has(key)) return h.balances.get(userId) ?? 0;
      const bal = h.balances.get(userId) ?? 0;
      if (bal < cost) throw new actual.OutOfCreditsError();
      h.balances.set(userId, bal - cost);
      if (key) h.chargedKeys.add(key);
      h.charges.push({ userId, cost, key });
      return bal - cost;
    }),
    refundCredits: vi.fn(async (userId: string, cost: number) => {
      h.balances.set(userId, (h.balances.get(userId) ?? 0) + cost);
    }),
    voidChargeIdempotencyKey: vi.fn(async (key: string) => h.chargedKeys.delete(key)),
  };
});

vi.mock("../../lib/email-campaign-sender", () => ({
  queueWelcomeSequence: vi.fn(async (list: any, subscriber: any) => {
    welcome.calls.push({ list, subscriber });
    return [];
  }),
}));

import themeKitRouter, { kitUnlocked } from "../theme-kit";
import {
  handleKeywordComment,
  handleDmEmailCapture,
  KW_MAX_RULES_PER_CREATOR,
  KW_RULE_HOURLY_SEND_CAP,
  KW_CREATOR_DAILY_SEND_CAP,
  KW_FAN_DAILY_CAP,
} from "../../lib/keyword-automations";
import { buildFanGraph, type FanGraphSources } from "../../lib/fan-graph";
import { createTestDb } from "../../lib/__tests__/test-db";

/* ── Theme-kit harness ─────────────────────────────────────────────── */

const THEME_DDL = `
CREATE TABLE theme_pack_purchases (
  user_id text NOT NULL, pack_id text NOT NULL, price_vb integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, pack_id)
);
CREATE TABLE theme_pack_customizations (
  user_id text NOT NULL, pack_id text NOT NULL, component text NOT NULL,
  device text NOT NULL DEFAULT 'all', settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pack_id, component, device)
);
CREATE TABLE creator_theme_packs (
  id uuid PRIMARY KEY, creator_user_id text NOT NULL, name text NOT NULL,
  base_pack_id text NOT NULL, price_vb integer NOT NULL DEFAULT 0,
  mix jsonb NOT NULL DEFAULT '{}'::jsonb, published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id text NOT NULL);
CREATE TABLE creator_subscriptions (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL UNIQUE, tier text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active', stripe_subscription_id text, stripe_customer_id text,
  current_period_end timestamptz, cancel_at_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);`;

let server: ReturnType<typeof express.application.listen>;
let base = "";

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function setTier(tier: string, status: string): Promise<void> {
  await h.db.execute(sql`DELETE FROM creator_subscriptions`);
  if (tier !== "none") {
    await h.db.execute(sql`
      INSERT INTO creator_subscriptions (id, profile_id, tier, status)
      VALUES (${randomUUID()}, ${PROFILE}, ${tier}, ${status})`);
  }
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", themeKitRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
      resolve();
    });
  });
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Q140 — kit customization reset-to-pure-pack + Elite kit unlock", () => {
  beforeEach(async () => {
    const { db, mem } = createTestDb() as any;
    h.db = db;
    mem.public.none(THEME_DDL);
    h.userId = BUYER;
    h.userPlan = null;
    h.balances = new Map();
    h.charges = [];
    h.chargedKeys = new Set();
    await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${PROFILE}, ${BUYER})`);
    await setTier("none", "active");
  });

  it("an empty-mix PUT resets the pack to pure: every saved row is cleared", async () => {
    const mix = {
      cursors: { desktop: { cursorId: "crown" } },
      "accent-color": { all: { accentHex: "#123456" }, phone: { accentHex: "#654321" } },
    };
    const put = await call("PUT", "/theme-packs/customizations/golden-marble", { mix });
    expect(put.status).toBe(200);
    const before = await call("GET", "/theme-packs/customizations/golden-marble");
    expect(before.json.mix.cursors.desktop.cursorId).toBe("crown");
    expect(before.json.mix["accent-color"].phone.accentHex).toBe("#654321");

    const reset = await call("PUT", "/theme-packs/customizations/golden-marble", { mix: {} });
    expect(reset.status).toBe(200);
    expect(reset.json.reset).toBe(true);
    const after = await call("GET", "/theme-packs/customizations/golden-marble");
    expect(after.json.mix).toEqual({});
  });

  it("reset touches only the caller's rows for that pack", async () => {
    const mix = { cursors: { all: { cursorId: "crown" } } };
    await call("PUT", "/theme-packs/customizations/golden-marble", { mix });
    await call("PUT", "/theme-packs/customizations/shark-tank", { mix });
    await call("PUT", "/theme-packs/customizations/golden-marble", { mix: {} });
    const other = await call("GET", "/theme-packs/customizations/shark-tank");
    expect(other.json.mix.cursors.all.cursorId).toBe("crown");
  });

  it("Elite unlocks a premium kit with no purchase row; lapse re-locks it", async () => {
    const req = { userId: BUYER, userPlan: null };
    expect(await kitUnlocked(req as never, "kings-set")).toBe(false);
    expect(await kitUnlocked(req as never, "golden-marble")).toBe(true);
    expect(await kitUnlocked(req as never, "no-such-pack")).toBe(false);
    await setTier("elite", "active");
    expect(await kitUnlocked(req as never, "kings-set")).toBe(true);
    expect(await kitUnlocked(req as never, "arcade-gold")).toBe(true);
    /* Downloads follow the same seam over HTTP while Elite is live. */
    const dl = await call("POST", "/theme-packs/kit/kings-set/download", { kind: "windows", mode: "dark" });
    expect(dl.status).toBe(200);
    /* Lapse: canceled Elite no longer unlocks the unbought pack. */
    await setTier("elite", "canceled");
    expect(await kitUnlocked(req as never, "kings-set")).toBe(false);
    /* …but a pack bought outright stays unlocked after the lapse. */
    await h.db.execute(sql`
      INSERT INTO theme_pack_purchases (user_id, pack_id, price_vb) VALUES (${BUYER}, 'kings-set', 1000)`);
    expect(await kitUnlocked(req as never, "kings-set")).toBe(true);
  });
});

/* ── Keyword-automations harness ───────────────────────────────────── */

const KW_DDL = `
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
const FAN = randomUUID();

describe("Q189 — caps, cap-hit audit rows, dedupe index, re-activation source", () => {
  let t: any;
  beforeEach(() => {
    t = createTestDb();
    t.mem.public.registerFunction({
      name: "gen_random_uuid",
      args: [],
      returns: "uuid" as never,
      impure: true,
      implementation: () => randomUUID(),
    });
    t.mem.public.none(KW_DDL);
    h.db = t.db;
    welcome.calls.length = 0;
  });

  const q = async <T = Record<string, any>>(query: ReturnType<typeof sql>): Promise<T[]> => {
    const res = await t.db.execute(query);
    return res.rows as T[];
  };

  async function makeRule(over: { captureEmail?: boolean; listId?: string | null } = {}): Promise<{ id: string }> {
    const id = randomUUID();
    await t.db.execute(sql`
      INSERT INTO keyword_automation_rules
        (id, creator_user_id, list_id, keyword, surfaces, dm_body, capture_email, enabled, enabled_at)
      VALUES (${id}, ${CREATOR}, ${over.listId ?? null}, 'link', '["post"]'::jsonb,
              'Here is the thing', ${over.captureEmail ?? false}, true, ${new Date(Date.now() - 60_000)})`);
    return { id };
  }

  const comment = (over: Record<string, unknown> = {}) =>
    handleKeywordComment({
      ownerUserId: CREATOR,
      commenterUserId: FAN,
      body: "LINK please!",
      surface: "post",
      surfaceRefId: randomUUID(),
      ...over,
    } as never);

  it("the four caps sit at their ruled values", () => {
    expect(KW_MAX_RULES_PER_CREATOR).toBe(25);
    expect(KW_RULE_HOURLY_SEND_CAP).toBe(60);
    expect(KW_CREATOR_DAILY_SEND_CAP).toBe(500);
    expect(KW_FAN_DAILY_CAP).toBe(3);
    /* The 25-rule cap is enforced on the create route (admin-exempt). */
    const route = readFileSync(new URL("../keyword-automations.ts", import.meta.url), "utf8");
    expect(route).toContain("KW_MAX_RULES_PER_CREATOR");
    expect(route).toContain(">= KW_MAX_RULES_PER_CREATOR");
    expect(route).toContain("isAdminRequest(req)");
  });

  it("creator daily cap (500): the next fire sends nothing and audits creator_daily_cap", async () => {
    const target = await makeRule();
    const other = await makeRule();
    /* 500 sends in the last 24h under the creator's OTHER rule, each
       to a different fan: fan cap and the target rule's hourly cap
       stay untouched, so only the creator cap can trip. */
    const values: string[] = [];
    for (let i = 0; i < KW_CREATOR_DAILY_SEND_CAP; i++) {
      values.push(`('${randomUUID()}', '${other.id}', '${CREATOR}', '${randomUUID()}', 'post', '${randomUUID()}', 'sent')`);
    }
    await t.db.execute(sql.raw(
      `INSERT INTO keyword_automation_events (id, rule_id, creator_user_id, fan_user_id, surface, surface_ref, outcome) VALUES ${values.join(",")}`,
    ));
    await comment();
    expect(await q(sql`SELECT * FROM messages`)).toHaveLength(0);
    const caps = (await q(sql`SELECT * FROM keyword_automation_events WHERE outcome = 'rate_limited'`))
      .filter((e: any) => e.rule_id === target.id);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.detail).toBe("creator_daily_cap");
  });

  it("cap-hit audit rows are throttled: repeated capped fires add no second row within the hour", async () => {
    const rule = await makeRule();
    for (let i = 0; i < KW_FAN_DAILY_CAP; i++) {
      await t.db.execute(sql`
        INSERT INTO keyword_automation_events (rule_id, creator_user_id, fan_user_id, surface, surface_ref, outcome)
        VALUES (${rule.id}, ${CREATOR}, ${FAN}, 'post', ${randomUUID()}, 'sent')`);
    }
    await comment();
    await comment();
    await comment();
    expect(await q(sql`SELECT * FROM messages`)).toHaveLength(0);
    const caps = await q(sql`SELECT * FROM keyword_automation_events WHERE outcome = 'rate_limited'`);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.detail).toBe("fan_daily_cap");
  });

  it("the dedupe ledger is a database law: a duplicate 'sent' insert is refused by the partial unique index", async () => {
    const rule = await makeRule();
    const ref = randomUUID();
    const insert = () => t.db.execute(sql`
      INSERT INTO keyword_automation_events (rule_id, creator_user_id, fan_user_id, surface, surface_ref, outcome)
      VALUES (${rule.id}, ${CREATOR}, ${FAN}, 'post', ${ref}, 'sent')`);
    await insert();
    await expect(insert()).rejects.toThrow();
    /* A non-'sent' row on the same tuple is outside the partial index. */
    await t.db.execute(sql`
      INSERT INTO keyword_automation_events (rule_id, creator_user_id, fan_user_id, surface, surface_ref, outcome)
      VALUES (${rule.id}, ${CREATOR}, ${FAN}, 'post', ${ref}, 'rate_limited')`);
    /* And the shipped migration carries the same index. */
    const migration = readFileSync(
      new URL("../../../../../lib/db/migrations/0232_keyword_automations.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain("keyword_automation_events_dedupe_ux");
    expect(migration).toContain("WHERE outcome = 'sent'");
  });

  it("re-activation: source flips to keyword_automation AND the audit row records 'captured' with the address", async () => {
    const listId = randomUUID();
    await t.db.execute(sql`
      INSERT INTO email_lists (id, user_id, name, handle) VALUES (${listId}, ${CREATOR}, 'Fan List', 'h-qcproof')`);
    const rule = await makeRule({ captureEmail: true, listId });
    await comment();
    const convs = await q(sql`SELECT * FROM conversations`);
    const conversationId = convs[0]!.id as string;
    await t.db.execute(sql`
      INSERT INTO email_subscribers (list_id, email, source, unsubscribed_at)
      VALUES (${listId}, 'fan@example.com', 'landing', now())`);
    await handleDmEmailCapture({ senderUserId: FAN, conversationId, body: "fan@example.com" });
    const subs = await q(sql`SELECT * FROM email_subscribers`);
    expect(subs).toHaveLength(1);
    expect(subs[0]!.unsubscribed_at).toBeNull();
    expect(subs[0]!.source).toBe("keyword_automation");
    const captured = (await q(sql`SELECT * FROM keyword_automation_events WHERE outcome = 'captured'`))
      .filter((e: any) => e.rule_id === rule.id);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.captured_email).toBe("fan@example.com");
    expect(welcome.calls).toHaveLength(0);
  });
});

/* ── Q190 — pure merge pins ────────────────────────────────────────── */

const T = (iso: string) => new Date(iso);
function sources(partial: Partial<FanGraphSources>): FanGraphSources {
  return {
    subscribers: [], members: [], follows: [], storeOrders: [], digitalSales: [],
    shopSales: [], liveSales: [], tips: [], profileCards: new Map(),
    ...partial,
  };
}

describe("Q190 — the email bridge exists ONLY via a fan_members row carrying both", () => {
  it("same email in subscribers + shop, different account id in store + member: TWO fans, no merge", () => {
    const { fans, summary } = buildFanGraph(sources({
      subscribers: [
        { email: "shared@x.io", name: "Shared", subscribedAt: T("2026-01-01T00:00:00Z"), unsubscribedAt: null },
      ],
      shopSales: [
        { buyerEmail: "shared@x.io", amountCents: 4000, createdAt: T("2026-02-01T00:00:00Z") },
      ],
      storeOrders: [
        { buyerUserId: "u-bob", amountCents: 2500, createdAt: T("2026-02-02T00:00:00Z") },
      ],
      members: [
        {
          fanLabel: "Bob Ray", fanUserId: "u-bob", tierName: "Gold", status: "active",
          priceCents: 0, hasPaidCheckout: false,
          joinedAt: T("2026-01-15T00:00:00Z"), updatedAt: T("2026-01-15T00:00:00Z"),
        },
      ],
    }));
    expect(summary.totalFans).toBe(2);
    const emailFan = fans.find((f) => f.id === "e:shared@x.io")!;
    expect(emailFan).toBeTruthy();
    expect(emailFan.subscribed).toBe(true);
    expect(emailFan.spentUsdCents).toBe(4000);
    expect(emailFan.member).toBeNull();
    expect(emailFan.sources.sort()).toEqual(["shop", "subscriber"]);
    const acctFan = fans.find((f) => f.id === "u:u-bob")!;
    expect(acctFan).toBeTruthy();
    expect(acctFan.subscribed).toBe(false);
    expect(acctFan.email).toBeNull();
    expect(acctFan.spentUsdCents).toBe(2500);
    expect(acctFan.member).toMatchObject({ tierName: "Gold", status: "active" });
  });

  it("a bridge for ONE account merges only that account — the other account on the same email string stays separate", () => {
    const { fans } = buildFanGraph(sources({
      subscribers: [
        { email: "shared@x.io", name: null, subscribedAt: T("2026-01-01T00:00:00Z"), unsubscribedAt: null },
      ],
      members: [
        {
          fanLabel: "shared@x.io", fanUserId: "u-ann", tierName: "Silver", status: "trialing",
          priceCents: 0, hasPaidCheckout: false,
          joinedAt: T("2026-01-20T00:00:00Z"), updatedAt: T("2026-01-20T00:00:00Z"),
        },
      ],
      storeOrders: [
        { buyerUserId: "u-bob", amountCents: 900, createdAt: T("2026-02-02T00:00:00Z") },
      ],
    }));
    expect(fans).toHaveLength(2);
    const ann = fans.find((f) => f.id === "u:u-ann")!;
    expect(ann.email).toBe("shared@x.io");
    expect(ann.subscribed).toBe(true);
    expect(ann.member).toEqual({
      tierName: "Silver",
      status: "trialing",
      joinedAt: "2026-01-20T00:00:00.000Z",
    });
    const bob = fans.find((f) => f.id === "u:u-bob")!;
    expect(bob.email).toBeNull();
    expect(bob.subscribed).toBe(false);
    expect(bob.spentUsdCents).toBe(900);
  });

  it("empty sources build an empty graph with an all-zero summary", () => {
    const { fans, summary } = buildFanGraph(sources({}));
    expect(fans).toEqual([]);
    expect(summary).toEqual({
      totalFans: 0, followers: 0, subscribers: 0, members: 0, buyers: 0,
      totalSpentUsdCents: 0, totalSpentVb: 0,
    });
  });
});
