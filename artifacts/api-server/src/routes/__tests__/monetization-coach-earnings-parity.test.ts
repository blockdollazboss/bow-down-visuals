/* Stack-200 census item 2 — the Money Coach's "Earnings to date" must
 * equal the canonical earnings total, on a basket containing EVERY
 * current source.
 *
 * The coach used to hand-sum only the old four sources (store orders,
 * shop sales, memberships, brand deals) while GET /api/earnings —
 * built on lib/seller-earnings' sellerEarningsSummary — counted
 * seven rails. A creator earning from digital sales, beats,
 * shoutouts, tip-jar tips, or UGC briefs was told a smaller number
 * (or $0) and coached from it. The fix deleted the coach's own
 * source list: it now reads sellerEarningsSummary(userId).totalCents.
 *
 * This suite drives the REAL coach router AND the REAL
 * sellerEarningsSummary against the same doubled database, seeded
 * with a distinct non-zero amount on every current source, and pins:
 *   coach earningsCents === summary totalCents === the hand-summed
 *   basket total. Drop or double-count any one source on either side
 *   and the equality breaks. The asked-tables assertion also proves
 *   the coach's figure really was read from every source table.
 */
import express from "express";
import type { AddressInfo } from "node:net";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const USER = "coach-parity-user-1";
const PROFILE_ID = "coach-parity-profile-1";

/* The basket: one seeded aggregate row per source table, exactly the
 * shape the canonical readers' SQL would return. Every amount is
 * distinct and non-zero so a missing source cannot hide. */
const BASKET = {
  digital_sales: { cents: 111, n: 1 },
  store_orders: { cents: 202, n: 2 },
  shop_events: { cents: 303, n: 3 },
  beat_licenses: { net: 404, gross: 476, commission: 72, n: 4 },
  fan_members: { cents: 505, n: 5 },
  sponsor_payouts: { cents: 606, n: 6 },
  shoutout_requests: { net: 707, gross: 744, n: 7 },
  tip_jar_tips: { cents: 808, n: 8 },
  ugc_briefs: { net: 954, gross: 1004, fee: 50, n: 9 },
  live_stream_tips_vb: 1234,
};
/* store 616 (111+202+303) + beats 404 + memberships 505 + deals 606
 * + shoutouts 707 + tip jar 808 + briefs 954 = 4600. */
const BASKET_TOTAL_CENTS = 4600;

const state = {
  profiles: [{ id: PROFILE_ID, userId: USER }] as Array<{ id: string; userId: string }>,
};

/* Source tables the doubled db was asked about since the last clear —
 * proves the coach's figure was read from every current source. */
const asked = new Set<string>();

const capturedPrompts: Array<{ role: string; content: string }> = [];

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async (args: { messages: Array<{ role: string; content: string }> }) => {
          capturedPrompts.push(...args.messages);
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    eligibility: [
                      { platform: "YouTube", program: "Partner Program", threshold: "1,000 subs", progress: 40, status: "building", nextStep: "Keep posting" },
                    ],
                    earnings: { rpmNotes: "Music RPM notes", bestFormat: "Shorts", bestCadence: "3x/week" },
                    moneyMoves: ["Move one", "Move two", "Move three"],
                    note: "Estimates — verify terms.",
                  }),
                },
              },
            ],
          };
        },
      },
    },
  }),
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: async () => 99_900,
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsage: async () => undefined,
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.userId = USER;
    req.userCredits = 100_000;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const dialect = new PgDialect();
  const render = (cond: unknown): string[] =>
    ((dialect.sqlToQuery(cond as never).params as unknown[]) ?? []).map(String);

  const rowsFor = (table: unknown, cond: unknown): Array<Record<string, unknown>> => {
    const params = render(cond);
    if (table === actual.creatorProfilesTable) return state.profiles.filter((p) => params.includes(p.userId));
    return [];
  };

  const select = (fields?: Record<string, unknown>) => ({
    from: (table: unknown) => {
      let rows: Array<Record<string, unknown>> = [];
      const chain: Record<string, unknown> = {
        where: (cond: unknown) => {
          const all = rowsFor(table, cond);
          rows = fields && "n" in fields ? [{ n: all.length }] : all;
          return chain;
        },
        orderBy: () => chain,
        limit: (n: number) => Promise.resolve(rows.slice(0, n)),
        then: (resolve: (v: unknown) => void) => resolve(rows),
      };
      return chain;
    },
  });

  const execute = async (q: unknown) => {
    const text = ((q as { queryChunks?: Array<{ value?: unknown }> })?.queryChunks ?? [])
      .map((c) => (Array.isArray(c.value) ? c.value.join(" ") : typeof c.value === "string" ? c.value : ""))
      .join(" ");
    /* The co-seller splits probe: no sale_split_entries storage in
     * this double, so adjustments read zero — as on a pre-0235 db. */
    if (text.includes("information_schema")) return { rows: [] };
    if (text.includes("digital_sales")) { asked.add("digital_sales"); return { rows: [BASKET.digital_sales] }; }
    if (text.includes("store_orders")) { asked.add("store_orders"); return { rows: [BASKET.store_orders] }; }
    if (text.includes("shop_events")) { asked.add("shop_events"); return { rows: [BASKET.shop_events] }; }
    if (text.includes("beat_licenses")) { asked.add("beat_licenses"); return { rows: [BASKET.beat_licenses] }; }
    if (text.includes("fan_members")) { asked.add("fan_members"); return { rows: [BASKET.fan_members] }; }
    if (text.includes("sponsor_payouts")) { asked.add("sponsor_payouts"); return { rows: [BASKET.sponsor_payouts] }; }
    if (text.includes("shoutout_requests")) { asked.add("shoutout_requests"); return { rows: [BASKET.shoutout_requests] }; }
    if (text.includes("tip_jar_tips")) { asked.add("tip_jar_tips"); return { rows: [BASKET.tip_jar_tips] }; }
    if (text.includes("ugc_briefs")) { asked.add("ugc_briefs"); return { rows: [BASKET.ugc_briefs] }; }
    if (text.includes("live_stream_tips")) { asked.add("live_stream_tips"); return { rows: [{ vb: BASKET.live_stream_tips_vb }] }; }
    return { rows: [] };
  };

  return { ...actual, db: { select, execute } };
});

import monetizationCoachRouter from "../generate/monetization-coach";
import { sellerEarningsSummary } from "../../lib/seller-earnings";

let server: ReturnType<express.Express["listen"]>;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(monetizationCoachRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const BODY = {
  niche: "gospel rap",
  platforms: ["youtube"],
  followers: { youtube: 1200 },
  cadence: 3,
};

async function postCoach(): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/monetization-coach`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(BODY),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const systemPrompt = () => capturedPrompts.find((m) => m.role === "system")?.content ?? "";

describe("Stack-200 item 2 — coach earnings parity with the canonical summary", () => {
  it("the canonical summary totals the whole basket, rail by rail", async () => {
    const summary = await sellerEarningsSummary(USER);
    expect(summary.storeSales.totalCents).toBe(616);
    expect(summary.beats.totalCents).toBe(404);
    expect(summary.memberships.totalCents).toBe(505);
    expect(summary.brandDeals.totalCents).toBe(606);
    expect(summary.shoutouts.totalCents).toBe(707);
    expect(summary.tipJar.totalCents).toBe(808);
    expect(summary.ugcBriefs.totalCents).toBe(954);
    expect(summary.totalCents).toBe(BASKET_TOTAL_CENTS);
  });

  it("the coach states exactly the summary's total — every source counted", async () => {
    const summary = await sellerEarningsSummary(USER);
    asked.clear();
    capturedPrompts.length = 0;

    const res = await postCoach();
    expect(res.status).toBe(200);
    expect(res.body.creatorState.earningsCents).toBe(summary.totalCents);
    expect(res.body.creatorState.earningsCents).toBe(BASKET_TOTAL_CENTS);
    expect(systemPrompt()).toContain("Earnings to date on the platform: $46");
    /* Stream tips (Visual Bucs) still ride their own line, unmixed. */
    expect(res.body.creatorState.tipsVb).toBe(BASKET.live_stream_tips_vb);

    for (const table of [
      "digital_sales", "store_orders", "shop_events", "beat_licenses",
      "fan_members", "sponsor_payouts", "shoutout_requests",
      "tip_jar_tips", "ugc_briefs",
    ]) {
      expect(asked.has(table), `the coach's earnings read never touched ${table}`).toBe(true);
    }
  });
});
