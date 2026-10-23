/**
 * S27-49 — GET /api/analytics/overview error handling.
 *
 * The handler used to have NO try/catch: a social_accounts or
 * snapshots failure escaped as an unhandled 500. Now the snapshots
 * read settles on its own (degraded overview: snapshots [], partial:
 * true, live platform data intact) and any other failure returns a
 * controlled 500 in the sibling handlers' { error } shape.
 *
 * The account source returns no rows here, so no provider fetch ever
 * fires — the resilience under test is the DB reads' handling.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  state: {
    accountsFail: false,
    snapshotsFail: false,
    snapshotRows: [] as any[],
  },
  ACCOUNTS: { __table: "social_accounts" },
  SNAPSHOTS: { __table: "social_stat_snapshots" },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(),
  refundCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({ chat: { completions: { create: vi.fn() } } }),
  getTextModel: () => "gpt-6-sol",
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: vi.fn(async () => undefined),
}));

vi.mock("../../lib/social-crypto", () => ({
  decryptToken: vi.fn(),
  encryptToken: vi.fn(),
}));

vi.mock("../../lib/social-tiktok", () => ({
  refreshTikTokTokens: vi.fn(),
  TikTokApiError: class TikTokApiError extends Error {},
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@workspace/db", () => ({
  socialAccountsTable: h.ACCOUNTS,
  socialStatSnapshotsTable: h.SNAPSHOTS,
  db: {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (_cond: unknown) => {
          if (table === h.ACCOUNTS) {
            const chain: any = {
              then: (res: any, rej: any) =>
                Promise.resolve()
                  .then(() => {
                    if (h.state.accountsFail) throw new Error("accounts source down");
                    return [] as any[];
                  })
                  .then(res, rej),
            };
            return chain;
          }
          // Snapshots read: where -> orderBy -> limit.
          const chain: any = {
            orderBy: () => chain,
            limit: async (_n: number) => {
              if (h.state.snapshotsFail) throw new Error("snapshots source down");
              return h.state.snapshotRows;
            },
            then: (res: any, rej: any) =>
              Promise.resolve()
                .then(() => {
                  if (h.state.snapshotsFail) throw new Error("snapshots source down");
                  return h.state.snapshotRows;
                })
                .then(res, rej),
          };
          return chain;
        },
      }),
    }),
  },
}));

import router from "../analytics";

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

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.state.accountsFail = false;
  h.state.snapshotsFail = false;
  h.state.snapshotRows = [];
});

async function getOverview() {
  const r = await realFetch(`${baseUrl}/analytics/overview`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/analytics/overview — controlled failure (S27-49)", () => {
  it("serves the overview with mapped snapshots when sources are healthy", async () => {
    h.state.snapshotRows = [
      { platform: "instagram", followers: 42, recordedAt: new Date("2026-10-20T00:00:00.000Z") },
    ];
    const { status, json } = await getOverview();
    expect(status).toBe(200);
    expect(json.platforms).toEqual([]);
    expect(json.snapshots).toEqual([
      { platform: "instagram", followers: 42, recordedAt: "2026-10-20T00:00:00.000Z" },
    ]);
    expect(json.partial).toBeUndefined();
    expect(typeof json.fetchedAt).toBe("string");
  });

  it("snapshots failing degrades to [] with partial: true — still a 200", async () => {
    h.state.snapshotsFail = true;
    const { status, json } = await getOverview();
    expect(status).toBe(200);
    expect(json.platforms).toEqual([]);
    expect(json.snapshots).toEqual([]);
    expect(json.partial).toBe(true);
  });

  it("social_accounts failing returns a controlled 500, not an unhandled escape", async () => {
    h.state.accountsFail = true;
    const { status, json } = await getOverview();
    expect(status).toBe(500);
    expect(json).toEqual({ error: "Couldn't load your analytics overview — try again." });
  });
});
