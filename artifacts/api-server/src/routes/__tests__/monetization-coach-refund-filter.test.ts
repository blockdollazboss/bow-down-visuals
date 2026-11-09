/* L7 — the Monetization Coach's earnings figure must exclude refunded
 * memberships, exactly like GET /api/earnings (sellerMemberships).
 *
 * The coach's "earnings" block in routes/generate/monetization-coach.ts
 * sums fan_members.price_cents for the creator; it carried the
 * stripe_session_id (verified checkout) filter but NOT the
 * status <> 'refunded' exclusion, so a refunded membership still
 * inflated the coach's "Earnings to date" while /api/earnings
 * disagreed.
 *
 * Harness: the REAL coach router with @workspace/db doubled, following
 * the monetization-coach-state.test.ts pattern — but the fan_members
 * execute stub computes its sum from seeded member rows and honors the
 * refunded exclusion ONLY when the issued query text actually carries
 * it. Drop the filter from the production query and this suite fails.
 */
import express from "express";
import type { AddressInfo } from "node:net";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const USER = "coach-refund-user-1";
const PROFILE_ID = "coach-refund-profile-1";

const state = {
  profiles: [] as Array<{ id: string; userId: string }>,
  members: [] as Array<{ price_cents: number; status: string; stripe_session_id: string | null }>,
};

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => ({
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
        }),
      },
    },
  }),
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: async () => 99_900,
  buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) => {
    const ck = typeof clientKey === "string" && clientKey.trim().length >= 8 ? clientKey.trim() : null;
    return ck ? `${scope}:${userId}:client:${ck}` : `${scope}:${userId}:${JSON.stringify(intent ?? {})}`;
  },
  voidChargeIdempotencyKey: async () => {},
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
    if (text.includes("fan_members")) {
      /* Verified-checkout filter: present in the production query from
       * the start — manual rows never count. */
      let rows = state.members.filter((m) => m.stripe_session_id !== null);
      /* The refunded exclusion is honored ONLY if the issued query
       * actually carries it — this is the pin. */
      const excludesRefunded =
        /status\s*<>\s*'refunded'/.test(text) ||
        /status\s*!=\s*'refunded'/.test(text) ||
        /status\s+not\s+in/i.test(text);
      if (excludesRefunded) rows = rows.filter((m) => m.status !== "refunded");
      const cents = rows.reduce((sum, m) => sum + m.price_cents, 0);
      return { rows: [{ cents }] };
    }
    if (text.includes("live_stream_tips")) return { rows: [{ vb: 0 }] };
    if (text.includes("store_orders") || text.includes("shop_events") || text.includes("sponsor_payouts")) {
      return { rows: [{ cents: 0 }] };
    }
    return { rows: [] };
  };

  return { ...actual, db: { select, execute } };
});

import monetizationCoachRouter from "../generate/monetization-coach";

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

function reset() {
  state.profiles = [{ id: PROFILE_ID, userId: USER }];
  state.members = [];
}

describe("L7 — coach earnings exclude refunded memberships", () => {
  it("a refunded membership contributes 0 to the coach's earnings; an active paid one counts", async () => {
    reset();
    state.members = [
      { price_cents: 500, status: "active", stripe_session_id: "cs_active" },
      { price_cents: 700, status: "refunded", stripe_session_id: "cs_refunded" },
      /* Manual row (no verified checkout) — never counted. */
      { price_cents: 900, status: "active", stripe_session_id: null },
    ];
    const res = await postCoach();
    expect(res.status).toBe(200);
    expect(res.body.creatorState.earningsCents).toBe(500);
  });

  it("a creator whose only membership was refunded reads $0 of earnings", async () => {
    reset();
    state.members = [{ price_cents: 700, status: "refunded", stripe_session_id: "cs_refunded" }];
    const res = await postCoach();
    expect(res.status).toBe(200);
    expect(res.body.creatorState.earningsCents).toBe(0);
  });
});
