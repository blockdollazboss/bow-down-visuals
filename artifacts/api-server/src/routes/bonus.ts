import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import {
  getBonusProfile,
  claimDailyBonus,
  canClaimDaily,
  crateCooldownSeconds,
  activeBonusBalance,
  WHEEL_SEGMENTS,
  DAILY_BONUS_BASE,
  DAILY_BONUS_STREAK_7,
  WHEEL_COOLDOWN_MINUTES,
  utcToday,
  utcYesterday,
  utcDayBeforeYesterday,
  claimHourlyCrate,
  hourlyCrateStatus,
} from "../lib/bonus";
import { logger } from "../lib/logger";

const router = Router();

/* ── Bonus status ───────────────────────────────────────────────────────
   Powers the daily-claim modal and the wheel page: streak, claim
   availability, wheel cooldown, and active bonus balance.

   PARTIAL-TRUTH DEGRADATION (dashboard law: one bad section never
   takes the whole thing down). The payload is fed by two independent
   stores:
     profile — Supabase `profiles` (streak, claim state, bonus pool)
     crates  — hourly_crate_claims in Render Postgres (wheel cooldown)
   If exactly one read fails, the endpoint still answers 200 with
   everything the surviving store can truthfully provide; the failed
   side's fields are null and `degraded` names the side that is down
   ("profile" | "crates"). Constants (bonus amounts, wheel segments,
   cooldown minutes) are code, not data — always present. If BOTH
   reads fail, the old 500 contract stands: no truth left to serve.
   A degraded answer ALWAYS logs the underlying error at error level
   first — degradation serves partial truth, it never masks the cause. */
router.get("/bonus/status", requireAuth, async (req, res) => {
  const userId = req.userId!;
  const [profile, crate] = await Promise.allSettled([
    getBonusProfile(userId),
    // The crate's real state lives in hourly_crate_claims (written by
    // claimHourlyCrate, the routed spin) — the same source
    // /bonus/hourly-crate-status reads. See crateCooldownSeconds.
    hourlyCrateStatus(),
  ]);
  if (profile.status === "rejected" && crate.status === "rejected") {
    req.log.error({ err: profile.reason }, "bonus/status error");
    req.log.error({ err: crate.reason }, "bonus/status error");
    res.status(500).json({ error: "Failed to load bonus status." });
    return;
  }
  if (profile.status === "rejected") {
    req.log.error({ err: profile.reason }, "bonus/status degraded: profile read failed");
  }
  if (crate.status === "rejected") {
    req.log.error({ err: crate.reason }, "bonus/status degraded: crate read failed");
  }
  const degraded =
    profile.status === "rejected" ? "profile" : crate.status === "rejected" ? "crates" : null;
  const p = profile.status === "fulfilled" ? profile.value : null;
  const crateValue = crate.status === "fulfilled" ? crate.value : null;
  // Effective streak: 0 if the last claim is older than yesterday (missed a day).
  // The stored value only updates on claim, so it can be stale.
  // Manual claim only — no auto-claim. Miss a day, lose the streak,
  // UNLESS exactly one day was missed and a streak freeze is banked —
  // claiming today auto-consumes it and preserves the chain.
  let effectiveStreak: number | null = null;
  let freezeWouldSave: boolean | null = null;
  if (p) {
    effectiveStreak = p.dailyStreak;
    freezeWouldSave = false;
    const last = p.lastDailyClaim;
    if (last && last !== utcToday() && last !== utcYesterday()) {
      effectiveStreak = 0;
      if (last === utcDayBeforeYesterday() && p.streakFreezes > 0) {
        freezeWouldSave = true;
        effectiveStreak = p.dailyStreak;
      }
    }
  }
  res.json({
    streak: effectiveStreak,
    canClaimDaily: p ? canClaimDaily(p.lastDailyClaim) : null,
    lastDailyClaim: p ? p.lastDailyClaim : null,
    streakFreezes: p ? p.streakFreezes : null,
    freezeWouldSave,
    dailyBonusBase: DAILY_BONUS_BASE,
    dailyBonusMilestone: DAILY_BONUS_STREAK_7,
    bonusCredits: p ? activeBonusBalance(p.bonusCredits, p.bonusExpiresAt) : null,
    bonusExpiresAt: p ? p.bonusExpiresAt : null,
    wheelCooldownSeconds: crateValue ? crateCooldownSeconds(crateValue) : null,
    wheelCooldownMinutes: WHEEL_COOLDOWN_MINUTES,
    wheelSegments: WHEEL_SEGMENTS.map((s) => ({ credits: s.credits, label: s.label, isJackpot: !!s.isJackpot })),
    ...(degraded ? { degraded } : {}),
  });
});

/* ── Claim daily login bonus ────────────────────────────────────────────
   Idempotent per UTC day (server-side). Streak increments on consecutive
   days, resets on a miss. Day 7/14/21… pays the milestone bonus. */
router.post("/bonus/claim-daily", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const result = await claimDailyBonus(userId);
    if (!result.claimed) {
      res.json({ claimed: false, reason: result.reason });
      return;
    }
    res.json({
      claimed: true,
      streak: result.streak,
      bonusGranted: result.bonusGranted,
      isStreakMilestone: result.isStreakMilestone,
      freezeUsed: result.freezeUsed,
      freezesEarned: result.freezesEarned,
      streakFreezes: result.streakFreezes,
    });
  } catch (err: unknown) {
    req.log.error({ err }, "bonus/claim-daily error");
    res.status(500).json({ error: "Failed to claim daily bonus." });
  }
});

/* ── Claim the global hourly crate ──────────────────────────────────────
   ONE claim per hour across the entire site — first come, first served.
   Once claimed, it's gone until the next hour. */
router.post("/bonus/spin-wheel", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const result = await claimHourlyCrate(userId);
    if (!result.spun) {
      res.status(429).json({
        spun: false,
        reason: result.reason,
        nextHourIn: result.nextHourIn,
      });
      return;
    }
    const seg = result.segment!;
    logger.info({ userId, prize: seg.credits, jackpot: !!seg.isJackpot }, "[bonus] hourly crate claimed");
    res.json({
      spun: true,
      prize: seg.credits,
      label: seg.label,
      isJackpot: !!seg.isJackpot,
    });
  } catch (err: unknown) {
    req.log.error({ err }, "bonus/spin-wheel error");
    res.status(500).json({ error: "Failed to claim the hourly crate." });
  }
});

/* ── Global hourly crate status ─────────────────────────────────────────
   Is this hour's crate still available? */
router.get("/bonus/hourly-crate-status", async (_req, res) => {
  try {
    const status = await hourlyCrateStatus();
    res.json(status);
  } catch (err: unknown) {
    res.status(500).json({ error: "Failed to check crate status." });
  }
});

export default router;
