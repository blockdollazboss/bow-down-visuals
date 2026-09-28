import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import {
  getBonusProfile,
  claimDailyBonus,
  spinWheel,
  canClaimDaily,
  wheelCooldownSeconds,
  activeBonusBalance,
  WHEEL_SEGMENTS,
  DAILY_BONUS_BASE,
  DAILY_BONUS_STREAK_7,
  WHEEL_COOLDOWN_MINUTES,
} from "../lib/bonus";
import { logger } from "../lib/logger";

const router = Router();

/* ── Bonus status ───────────────────────────────────────────────────────
   Powers the daily-claim modal and the wheel page: streak, claim
   availability, wheel cooldown, and active bonus balance. */
router.get("/bonus/status", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const p = await getBonusProfile(userId);
    res.json({
      streak: p.dailyStreak,
      canClaimDaily: canClaimDaily(p.lastDailyClaim),
      dailyBonusBase: DAILY_BONUS_BASE,
      dailyBonusMilestone: DAILY_BONUS_STREAK_7,
      bonusCredits: activeBonusBalance(p.bonusCredits, p.bonusExpiresAt),
      bonusExpiresAt: p.bonusExpiresAt,
      wheelCooldownSeconds: wheelCooldownSeconds(p.lastWheelSpin),
      wheelCooldownMinutes: WHEEL_COOLDOWN_MINUTES,
      wheelSegments: WHEEL_SEGMENTS.map((s) => ({ credits: s.credits, label: s.label, isJackpot: !!s.isJackpot })),
    });
  } catch (err: unknown) {
    req.log.error({ err }, "bonus/status error");
    res.status(500).json({ error: "Failed to load bonus status." });
  }
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
    });
  } catch (err: unknown) {
    req.log.error({ err }, "bonus/claim-daily error");
    res.status(500).json({ error: "Failed to claim daily bonus." });
  }
});

/* ── Spin the hourly jackpot wheel ──────────────────────────────────────
   One spin per hour (server-side cooldown). Weighted random segment;
   prize lands in the expiring bonus pool. */
router.post("/bonus/spin-wheel", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const result = await spinWheel(userId);
    if (!result.spun) {
      res.status(429).json({ spun: false, reason: result.reason, cooldownSeconds: result.cooldownSeconds });
      return;
    }
    const seg = result.segment!;
    logger.info({ userId, prize: seg.credits, jackpot: !!seg.isJackpot }, "[bonus] wheel spin");
    res.json({
      spun: true,
      prize: seg.credits,
      label: seg.label,
      isJackpot: !!seg.isJackpot,
    });
  } catch (err: unknown) {
    req.log.error({ err }, "bonus/spin-wheel error");
    res.status(500).json({ error: "Failed to spin the wheel." });
  }
});

export default router;
