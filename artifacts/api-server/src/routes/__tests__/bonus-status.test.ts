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
 *
 * The degradation contract (partial truth): the payload is fed by two
 * independent stores — the Supabase profile read and the crate read.
 * If exactly one fails, the endpoint answers 200 with the surviving
 * side's truth, the failed side's fields null, and `degraded` naming
 * the side that is down ("profile" | "crates"); the underlying error
 * is still logged at error level. If both fail, the old 500 stands.
 * The all-healthy shape carries no `degraded` key and is pinned
 * byte-for-byte below.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  crate: { available: true, nextHourIn: 1800 } as { available: boolean; nextHourIn: number; lastClaimedBy?: string },
  profileFails: false,
  crateFails: false,
  logErrors: [] as unknown[][],
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "11111111-1111-4111-8111-111111111111";
    req.log = { error: (...args: unknown[]) => { h.logErrors.push(args); } };
    next();
  },
}));

vi.mock("../../lib/bonus", () => ({
  getBonusProfile: async () => {
    if (h.profileFails) throw new Error("Failed to read bonus profile: column profiles.streak_freezes does not exist");
    return {
      dailyStreak: 3,
      lastDailyClaim: null,
      streakFreezes: 0,
      bonusCredits: 500,
      bonusExpiresAt: "2026-10-16T00:00:00.000Z",
      // The stale source: no routed spin ever writes this column.
      lastWheelSpin: null,
    };
  },
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
  hourlyCrateStatus: async () => {
    if (h.crateFails) throw new Error("Failed to read hourly crate claims");
    return h.crate;
  },
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
  h.profileFails = false;
  h.crateFails = false;
  h.logErrors = [];
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

describe("GET /bonus/status — all-healthy shape is pinned byte-for-byte", () => {
  it("healthy: every field present with its real value, no degraded key", async () => {
    const res = await fetch(`${base}/api/bonus/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      streak: 3,
      canClaimDaily: true,
      lastDailyClaim: null,
      streakFreezes: 0,
      freezeWouldSave: false,
      dailyBonusBase: 200,
      dailyBonusMilestone: 1000,
      bonusCredits: 500,
      bonusExpiresAt: "2026-10-16T00:00:00.000Z",
      wheelCooldownSeconds: 0,
      wheelCooldownMinutes: 60,
      wheelSegments: [{ credits: 100, label: "100", isJackpot: false }],
    });
    expect("degraded" in body).toBe(false);
    expect(h.logErrors).toEqual([]);
  });
});

describe("GET /bonus/status — partial-truth degradation", () => {
  it("profile side down: 200, degraded=profile, profile fields null, crate truth served", async () => {
    h.profileFails = true;
    h.crate = { available: false, nextHourIn: 1234, lastClaimedBy: "someone-else" };
    const res = await fetch(`${base}/api/bonus/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.degraded).toBe("profile");
    // Profile-side fields are unknown — null, never a guessed number.
    expect(body.streak).toBeNull();
    expect(body.canClaimDaily).toBeNull();
    expect(body.lastDailyClaim).toBeNull();
    expect(body.streakFreezes).toBeNull();
    expect(body.freezeWouldSave).toBeNull();
    expect(body.bonusCredits).toBeNull();
    expect(body.bonusExpiresAt).toBeNull();
    // The surviving crate truth is served in full.
    expect(body.wheelCooldownSeconds).toBe(1234);
    // Constants are code, not data — always present.
    expect(body.dailyBonusBase).toBe(200);
    expect(body.dailyBonusMilestone).toBe(1000);
    expect(body.wheelCooldownMinutes).toBe(60);
    expect(body.wheelSegments).toEqual([{ credits: 100, label: "100", isJackpot: false }]);
    // The root cause is still logged at error level, never masked.
    expect(h.logErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("crate side down: 200, degraded=crates, cooldown null, profile truth served", async () => {
    h.crateFails = true;
    const res = await fetch(`${base}/api/bonus/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.degraded).toBe("crates");
    // The crate-side field is unknown — null, never a guessed 0 ("ready").
    expect(body.wheelCooldownSeconds).toBeNull();
    // The surviving profile truth is served in full.
    expect(body.streak).toBe(3);
    expect(body.canClaimDaily).toBe(true);
    expect(body.lastDailyClaim).toBeNull();
    expect(body.streakFreezes).toBe(0);
    expect(body.freezeWouldSave).toBe(false);
    expect(body.bonusCredits).toBe(500);
    expect(body.bonusExpiresAt).toBe("2026-10-16T00:00:00.000Z");
    expect(body.wheelSegments).toEqual([{ credits: 100, label: "100", isJackpot: false }]);
    expect(h.logErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("both sides down: the old 500 contract stands — no truth left to serve", async () => {
    h.profileFails = true;
    h.crateFails = true;
    const res = await fetch(`${base}/api/bonus/status`);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Failed to load bonus status." });
    expect(h.logErrors.length).toBeGreaterThanOrEqual(1);
  });
});
