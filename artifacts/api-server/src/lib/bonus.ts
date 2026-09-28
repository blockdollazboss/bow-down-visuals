import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getSupabaseAdmin } from "./supabase-admin";
import { logger } from "./logger";

/* ── Daily login bonus + hourly jackpot wheel ─────────────────────────────
   Bonus credits live in a separate expiring pool on profiles:
   - bonus_credits: spendable bonus balance (deducted FIRST by deductCredits)
   - bonus_credits_expires_at: when the pool expires (48h from grant)
   - daily_streak: consecutive daily claim count
   - last_daily_claim: DATE of last claim (server-side, UTC)
   - last_wheel_spin: TIMESTAMPTZ of last wheel spin (hourly cooldown)

   Economics (pre-redenomination units; the x100 migration scales these):
   - Daily: 2cr (days 1-6), 10cr every 7th day
   - Wheel EV: ~2.85cr/spin, jackpot 200cr at 0.1%
   All bonus credits expire 48h after grant — retention tool, not free tier.
*/

export const DAILY_BONUS_BASE = 2;
export const DAILY_BONUS_STREAK_7 = 10;
export const BONUS_EXPIRY_HOURS = 48;
export const WHEEL_COOLDOWN_MINUTES = 60;

export interface WheelSegment {
  credits: number;
  weight: number;
  label: string;
  isJackpot?: boolean;
}

export const WHEEL_SEGMENTS: WheelSegment[] = [
  { credits: 1, weight: 50, label: "1" },
  { credits: 2, weight: 25, label: "2" },
  { credits: 3, weight: 12, label: "3" },
  { credits: 5, weight: 8, label: "5" },
  { credits: 10, weight: 3.9, label: "10" },
  { credits: 50, weight: 1, label: "50" },
  { credits: 200, weight: 0.1, label: "JACKPOT", isJackpot: true },
];

let bonusColumnsEnsured = false;

/** Idempotent: adds bonus/streak columns to Supabase profiles if missing. */
export async function ensureBonusColumns(): Promise<void> {
  if (bonusColumnsEnsured) return;
  bonusColumnsEnsured = true;
  await db.execute(sql.raw(`
    ALTER TABLE profiles
      ADD COLUMN IF NOT EXISTS bonus_credits INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS bonus_credits_expires_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS daily_streak INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_daily_claim DATE NULL,
      ADD COLUMN IF NOT EXISTS last_wheel_spin TIMESTAMPTZ NULL;
    CREATE TABLE IF NOT EXISTS wheel_spins (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      spun_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      prize_credits INTEGER NOT NULL,
      was_jackpot BOOLEAN NOT NULL DEFAULT FALSE
    );
    CREATE INDEX IF NOT EXISTS idx_wheel_spins_user ON wheel_spins(user_id);
  `));
}

export interface BonusProfile {
  bonusCredits: number;
  bonusExpiresAt: string | null;
  dailyStreak: number;
  lastDailyClaim: string | null;
  lastWheelSpin: string | null;
}

export async function getBonusProfile(userId: string): Promise<BonusProfile> {
  await ensureBonusColumns();
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("profiles")
    .select("bonus_credits, bonus_credits_expires_at, daily_streak, last_daily_claim, last_wheel_spin")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to read bonus profile: ${error.message}`);
  return {
    bonusCredits: (data as any)?.bonus_credits ?? 0,
    bonusExpiresAt: (data as any)?.bonus_credits_expires_at ?? null,
    dailyStreak: (data as any)?.daily_streak ?? 0,
    lastDailyClaim: (data as any)?.last_daily_claim ?? null,
    lastWheelSpin: (data as any)?.last_wheel_spin ?? null,
  };
}

/** Adds bonus credits, extending expiry to 48h from now. */
export async function addBonusCredits(userId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  await ensureBonusColumns();
  const admin = getSupabaseAdmin();
  const expiresAt = new Date(Date.now() + BONUS_EXPIRY_HOURS * 3600 * 1000).toISOString();
  // Read-modify-write: add to existing bonus pool, refresh expiry.
  const { data: profile } = await admin
    .from("profiles")
    .select("bonus_credits")
    .eq("id", userId)
    .maybeSingle();
  const current = (profile as any)?.bonus_credits ?? 0;
  const { error } = await admin
    .from("profiles")
    .update({ bonus_credits: current + amount, bonus_credits_expires_at: expiresAt })
    .eq("id", userId);
  if (error) throw new Error(`Failed to grant bonus credits: ${error.message}`);
  logger.info({ userId, amount }, "[bonus] granted bonus credits");
}

/** Returns active (non-expired) bonus balance. */
export function activeBonusBalance(bonusCredits: number, expiresAt: string | null): number {
  if (!bonusCredits || bonusCredits <= 0) return 0;
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) return 0;
  return bonusCredits;
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function utcYesterday(): string {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
}

export interface DailyClaimResult {
  claimed: boolean;
  reason?: "already_claimed";
  streak?: number;
  bonusGranted?: number;
  isStreakMilestone?: boolean;
}

export async function claimDailyBonus(userId: string): Promise<DailyClaimResult> {
  await ensureBonusColumns();
  const admin = getSupabaseAdmin();
  const today = utcToday();

  const { data: profile, error } = await admin
    .from("profiles")
    .select("daily_streak, last_daily_claim")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to read streak: ${error.message}`);

  const lastClaim = (profile as any)?.last_daily_claim as string | null;
  if (lastClaim === today) {
    return { claimed: false, reason: "already_claimed" };
  }

  const prevStreak = (profile as any)?.daily_streak ?? 0;
  // Consecutive day → increment; otherwise reset to 1.
  const newStreak = lastClaim === utcYesterday() ? prevStreak + 1 : 1;
  const isMilestone = newStreak % 7 === 0;
  const bonus = isMilestone ? DAILY_BONUS_STREAK_7 : DAILY_BONUS_BASE;

  const { error: updateErr } = await admin
    .from("profiles")
    .update({ daily_streak: newStreak, last_daily_claim: today })
    .eq("id", userId);
  if (updateErr) throw new Error(`Failed to update streak: ${updateErr.message}`);

  await addBonusCredits(userId, bonus);
  logger.info({ userId, newStreak, bonus }, "[bonus] daily claim");
  return { claimed: true, streak: newStreak, bonusGranted: bonus, isStreakMilestone: isMilestone };
}

export interface WheelSpinResult {
  spun: boolean;
  reason?: "cooldown";
  cooldownSeconds?: number;
  segment?: WheelSegment;
}

/** Weighted random segment selection. */
export function pickWheelSegment(random: number = Math.random()): WheelSegment {
  const total = WHEEL_SEGMENTS.reduce((s, seg) => s + seg.weight, 0);
  let r = random * total;
  for (const seg of WHEEL_SEGMENTS) {
    r -= seg.weight;
    if (r <= 0) return seg;
  }
  return WHEEL_SEGMENTS[0];
}

export async function spinWheel(userId: string): Promise<WheelSpinResult> {
  await ensureBonusColumns();
  const admin = getSupabaseAdmin();

  const { data: profile, error } = await admin
    .from("profiles")
    .select("last_wheel_spin")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to read wheel cooldown: ${error.message}`);

  const lastSpin = (profile as any)?.last_wheel_spin as string | null;
  if (lastSpin) {
    const elapsedMs = Date.now() - new Date(lastSpin).getTime();
    const cooldownMs = WHEEL_COOLDOWN_MINUTES * 60 * 1000;
    if (elapsedMs < cooldownMs) {
      return { spun: false, reason: "cooldown", cooldownSeconds: Math.ceil((cooldownMs - elapsedMs) / 1000) };
    }
  }

  const segment = pickWheelSegment();
  const now = new Date().toISOString();

  const { error: updateErr } = await admin
    .from("profiles")
    .update({ last_wheel_spin: now })
    .eq("id", userId);
  if (updateErr) throw new Error(`Failed to record spin: ${updateErr.message}`);

  await addBonusCredits(userId, segment.credits);

  // Analytics log (best-effort; never blocks the prize).
  try {
    await db.execute(sql.raw(`
      INSERT INTO wheel_spins (user_id, prize_credits, was_jackpot)
      VALUES ('${userId}', ${segment.credits}, ${segment.isJackpot ? "TRUE" : "FALSE"});
    `));
  } catch (e) {
    logger.warn({ userId, err: (e as Error).message }, "[bonus] wheel_spins log failed");
  }

  if (segment.isJackpot) {
    logger.info({ userId, prize: segment.credits }, "[bonus] JACKPOT WIN");
  }
  return { spun: true, segment };
}

/** Seconds until next wheel spin is available (0 if ready). */
export function wheelCooldownSeconds(lastWheelSpin: string | null): number {
  if (!lastWheelSpin) return 0;
  const elapsedMs = Date.now() - new Date(lastWheelSpin).getTime();
  const cooldownMs = WHEEL_COOLDOWN_MINUTES * 60 * 1000;
  return Math.max(0, Math.ceil((cooldownMs - elapsedMs) / 1000));
}

/** Whether the daily bonus can be claimed right now. */
export function canClaimDaily(lastDailyClaim: string | null): boolean {
  return lastDailyClaim !== utcToday();
}
