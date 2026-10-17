/* DE-19 — the monetization coach reads the creator's REAL catalog.
 *
 * The plan used to be built from the form alone — identical for a
 * creator with no songs and one with fifty. These tests drive the
 * REAL coach router (with @workspace/db, the model client, credits,
 * and auth doubled) and assert:
 *   1. the prompt sent to the model carries the catalog facts
 *      (counts, latest song, the gap callouts, earnings);
 *   2. the response's structured nextAction walks the chain
 *      (create → distribute → store → membership → promote) from
 *      the seeded state;
 *   3. creatorState in the response matches the seeded rows.
 */
import express from "express";
import type { AddressInfo } from "node:net";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const USER = "coach-user-1";
const PROFILE_ID = "coach-profile-1";

const state = {
  songs: [] as Array<{ user_id: string; title: string; created_at: number }>,
  releases: [] as Array<{ user_id: string; status: string }>,
  profiles: [] as Array<{ id: string; userId: string }>,
  products: [] as Array<{ profileId: string }>,
  tiers: [] as Array<{ user_id: string }>,
  sums: { store_orders: 0, shop_events: 0, fan_members: 0, sponsor_payouts: 0, live_stream_tips: 0 },
};

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
    if (table === actual.songsTable) {
      return state.songs
        .filter((s) => params.includes(s.user_id))
        .sort((a, b) => b.created_at - a.created_at) as unknown as Array<Record<string, unknown>>;
    }
    if (table === actual.distributionReleasesTable) {
      // The submitted-count query adds a status != 'draft' condition.
      const submittedOnly = params.includes("draft");
      return state.releases.filter(
        (r) => params.includes(r.user_id) && (!submittedOnly || r.status !== "draft"),
      ) as unknown as Array<Record<string, unknown>>;
    }
    if (table === actual.creatorProfilesTable) return state.profiles.filter((p) => params.includes(p.userId));
    if (table === actual.storeProductsTable) return state.products.filter((p) => params.includes(p.profileId));
    if (table === actual.fanTiersTable) return state.tiers.filter((t) => params.includes(t.user_id));
    return [];
  };

  const select = (fields?: Record<string, unknown>) => ({
    from: (table: unknown) => {
      let rows: Array<Record<string, unknown>> = [];
      const chain: Record<string, unknown> = {
        where: (cond: unknown) => {
          const all = rowsFor(table, cond);
          // Count selects ask for { n } — synthesize the aggregate row.
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
    if (text.includes("store_orders")) return { rows: [{ cents: state.sums.store_orders }] };
    if (text.includes("shop_events")) return { rows: [{ cents: state.sums.shop_events }] };
    if (text.includes("fan_members")) return { rows: [{ cents: state.sums.fan_members }] };
    if (text.includes("sponsor_payouts")) return { rows: [{ cents: state.sums.sponsor_payouts }] };
    if (text.includes("live_stream_tips")) return { rows: [{ vb: state.sums.live_stream_tips }] };
    return { rows: [] };
  };

  return { ...actual, db: { select, execute } };
});

import monetizationCoachRouter, { nextActionForState } from "../generate/monetization-coach";

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

async function postCoach(): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/monetization-coach`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(BODY),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function reset() {
  state.songs = [];
  state.releases = [];
  state.profiles = [{ id: PROFILE_ID, userId: USER }];
  state.products = [];
  state.tiers = [];
  state.sums = { store_orders: 0, shop_events: 0, fan_members: 0, sponsor_payouts: 0, live_stream_tips: 0 };
  capturedPrompts.length = 0;
}

const BODY = {
  niche: "gospel rap",
  platforms: ["youtube"],
  followers: { youtube: 1200 },
  cadence: 3,
};

const systemPrompt = () => capturedPrompts.find((m) => m.role === "system")?.content ?? "";

describe("DE-19 — coach reads the real catalog", () => {
  it("empty library: prompt says so, next action is make the first song", async () => {
    reset();
    const res = await postCoach();
    expect(res.status).toBe(200);
    expect(res.body.creatorState.songs).toBe(0);
    expect(res.body.nextAction).toEqual({ label: "Make your first song", href: "/make-song" });
    expect(systemPrompt()).toContain("Song library: 0 songs");
    expect(systemPrompt()).toContain("library is EMPTY");
  });

  it("songs but no releases: next action is distribute, prompt names the latest song and the gap", async () => {
    reset();
    state.songs = [
      { user_id: USER, title: "Older One", created_at: 1 },
      { user_id: USER, title: "Midnight Crown", created_at: 2 },
    ];
    const res = await postCoach();
    expect(res.status).toBe(200);
    expect(res.body.creatorState.songs).toBe(2);
    expect(res.body.creatorState.latestSongTitle).toBe("Midnight Crown");
    expect(res.body.nextAction).toEqual({ label: "Distribute your songs", href: "/distribute" });
    expect(systemPrompt()).toContain("Midnight Crown");
    expect(systemPrompt()).toContain("NEVER distributed");
  });

  it("earnings ground the prompt with the earnings view's own totals", async () => {
    reset();
    state.songs = [{ user_id: USER, title: "One", created_at: 1 }];
    state.sums = { store_orders: 10_000, shop_events: 0, fan_members: 5_000, sponsor_payouts: 0, live_stream_tips: 250 };
    const res = await postCoach();
    expect(res.status).toBe(200);
    expect(res.body.creatorState.earningsCents).toBe(15_000);
    expect(res.body.creatorState.tipsVb).toBe(250);
    expect(systemPrompt()).toContain("$150");
    expect(systemPrompt()).toContain("250 Visual Bucs in stream tips");
  });

  it("full catalog: next action is promote", async () => {
    reset();
    state.songs = [{ user_id: USER, title: "One", created_at: 1 }];
    state.releases = [{ user_id: USER, status: "packaged" }];
    state.products = [{ profileId: PROFILE_ID }];
    state.tiers = [{ user_id: USER }];
    const res = await postCoach();
    expect(res.status).toBe(200);
    expect(res.body.creatorState.submittedReleases).toBe(1);
    expect(res.body.nextAction).toEqual({ label: "Promote your latest release", href: "/promote" });
  });
});

describe("DE-19 — nextActionForState ladder", () => {
  const base = {
    songs: 0, latestSongTitle: null, releases: 0, submittedReleases: 0,
    storeProducts: 0, membershipTiers: 0, earningsCents: 0, tipsVb: 0,
  };

  it("points at the store when releases exist but the store is empty", () => {
    expect(nextActionForState({ ...base, songs: 2, releases: 1 })).toEqual({
      label: "Stock your profile store",
      href: "/storefronts/builder",
    });
  });

  it("points at memberships when the store is stocked but no tier exists", () => {
    expect(nextActionForState({ ...base, songs: 2, releases: 1, storeProducts: 3 })).toEqual({
      label: "Launch a fan membership",
      href: "/memberships",
    });
  });

  it("counts a DRAFT release as having started distribution (chain moves on)", () => {
    expect(nextActionForState({ ...base, songs: 2, releases: 1, submittedReleases: 0 }).href).toBe("/storefronts/builder");
  });
});
