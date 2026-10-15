/**
 * bonus-status.test.ts — GET /api/bonus/status wheelCooldownSeconds must
 * describe the REAL crate state, not the legacy per-user wheel stamp.
 *
 * The crate the client actually opens is the global hourly crate:
 * POST /bonus/spin-wheel runs claimHourlyCrate(), which records the
 * claim in hourly_crate_claims and never writes profiles.last_wheel_spin
 * (the only writer of that column, spinWheel(), is not routed). So a
 * status derived from last_wheel_spin said "ready" (0s) for the whole
 * hour after anyone claimed the crate — the Mystery Crate showed OPEN,
 * the user tapped, and got a 429.
 *
 * The aligned contract: wheelCooldownSeconds is 0 only while this
 * hour's crate is unclaimed; once claimed it is the seconds until the
 * next hour (hourlyCrateStatus().nextHourIn) — the same shape/value
 * the Mystery Crate client already consumes.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  crate: { available: true, nextHourIn: 1800 } as { available: boolean; nextHourIn: number; lastClaimedBy?: string },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "11111111-1111-4111-8111-111111111111";
    req.log = { error: () => {} };
    next();
  },
}));

vi.mock("../../lib/bonus", () => ({
  getBonusProfile: async () => ({
    dailyStreak: 3,
    lastDailyClaim: null,
    streakFreezes: 0,
    bonusCredits: 0,
    bonusExpiresAt: null,
    // The stale source: no routed spin ever writes this column.
    lastWheelSpin: null,
  }),
  claimDailyBonus: vi.fn(),
  spinWheel: vi.fn(),
  canClaimDaily: () => true,
  // Legacy derivation the route must NOT use for the crate any more:
  // with lastWheelSpin null it always answers 0 ("ready").
  wheelCooldownSeconds: () => 0,
  activeBonusBalance: (n: number) => n,
  WHEEL_SEGMENTS: [{ credits: 100, label: "100", isJackpot: false }],
  DAILY_BONUS_BASE: 200,
  DAILY_BONUS_STREAK_7: 1000,
  WHEEL_COOLDOWN_MINUTES: 60,
  utcToday: () => "2026-10-15",
  utcYesterday: () => "2026-10-14",
  utcDayBeforeYesterday: () => "2026-10-13",
  claimHourlyCrate: vi.fn(),
  hourlyCrateStatus: async () => h.crate,
  crateCooldownSeconds: (s: { available: boolean; nextHourIn: number }) => (s.available ? 0 : s.nextHourIn),
}));

import bonusRouter from "../bonus";

let server: any;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", bonusRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.crate = { available: true, nextHourIn: 1800 };
});

describe("GET /bonus/status — wheelCooldownSeconds follows the hourly crate", () => {
  it("crate still available this hour: cooldown is 0 (ready)", async () => {
    h.crate = { available: true, nextHourIn: 1800 };
    const res = await fetch(`${base}/api/bonus/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.wheelCooldownSeconds).toBe(0);
  });

  it("crate already claimed this hour: cooldown is the wait until next hour, not 0", async () => {
    h.crate = { available: false, nextHourIn: 1234, lastClaimedBy: "someone-else" };
    const res = await fetch(`${base}/api/bonus/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.wheelCooldownSeconds).toBe(1234);
  });
});
