/* ─── Creation Streaks + Weekly Quests: shared server logic ────────────────
   Two retention systems sharing the same creation-event hook:
     • Creation Streaks — consecutive days the user CREATED something
       (project save, song, thumbnail, video export). Milestone VB payouts.
     • Weekly Quests — 3 fixed weekly quests, reset Monday (UTC).
   Both honor retention_prefs (creation_streaks_enabled / quests_enabled).
   recordCreation() is fire-and-forget safe: it never throws. */

import { db, creationStreaksTable, questProgressTable, retentionPrefsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { addCreditsToProfile } from "./supabase-admin";
import { logger } from "./logger";

export type CreationKind = "project" | "song" | "thumbnail" | "export";

/* ── Streak milestones: day count → VB payout. Each claimable once. ────── */
export const STREAK_MILESTONES = [
  { days: 3,  reward: 100 },
  { days: 7,  reward: 250 },
  { days: 14, reward: 500 },
  { days: 30, reward: 1000 },
] as const;

/* ── Weekly quests: fixed, simple set. Reset every Monday (UTC). ───────── */
export interface QuestDef {
  key: string;
  target: number;
  reward: number;
  kinds: CreationKind[];
}
export const QUEST_DEFS: QuestDef[] = [
  { key: "make-thumbnail", target: 1, reward: 50,  kinds: ["thumbnail"] },
  { key: "generate-song",  target: 1, reward: 100, kinds: ["song"] },
  { key: "export-video",   target: 1, reward: 150, kinds: ["export"] },
];

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Monday (UTC) of the current week as YYYY-MM-DD. New week ⇒ new quests. */
export function currentWeekStart(): string {
  const now = new Date();
  const dayIdx = (now.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayIdx));
  return monday.toISOString().slice(0, 10);
}

interface Prefs {
  creationStreaksEnabled: boolean;
  questsEnabled: boolean;
  /* Added for Thy Daily Drop + While You Were Away digest. */
  dailyDropEnabled: boolean;
  awayDigestEnabled: boolean;
}

async function getPrefs(userId: string): Promise<Prefs> {
  try {
    const rows = await db
      .select({
        creationStreaksEnabled: retentionPrefsTable.creationStreaksEnabled,
        questsEnabled: retentionPrefsTable.questsEnabled,
        dailyDropEnabled: retentionPrefsTable.dailyDropEnabled,
        awayDigestEnabled: retentionPrefsTable.awayDigestEnabled,
      })
      .from(retentionPrefsTable)
      .where(eq(retentionPrefsTable.userId, userId))
      .limit(1);
    const row = rows[0];
    return {
      creationStreaksEnabled: row?.creationStreaksEnabled ?? true,
      questsEnabled: row?.questsEnabled ?? true,
      dailyDropEnabled: row?.dailyDropEnabled ?? true,
      awayDigestEnabled: row?.awayDigestEnabled ?? true,
    };
  } catch (err) {
    logger.warn({ err, userId }, "[retention] prefs read failed — defaulting to enabled");
    return {
      creationStreaksEnabled: true,
      questsEnabled: true,
      dailyDropEnabled: true,
      awayDigestEnabled: true,
    };
  }
}

/* ── STREAK TRACKING ───────────────────────────────────────────────────── */

async function updateStreak(userId: string): Promise<void> {
  const today = todayKey();
  const rows = await db
    .select()
    .from(creationStreaksTable)
    .where(eq(creationStreaksTable.userId, userId))
    .limit(1);
  const row = rows[0];

  if (!row) {
    await db.insert(creationStreaksTable).values({
      userId,
      currentStreak: 1,
      longestStreak: 1,
      lastCreationDate: today,
      milestonesClaimed: [],
    });
    return;
  }

  const last = row.lastCreationDate; // YYYY-MM-DD or null
  if (last === today) return; // already counted today

  const yesterday = new Date(Date.UTC(
    Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10))
  ) - 86400000).toISOString().slice(0, 10);

  const next = last === yesterday ? (row.currentStreak ?? 0) + 1 : 1;
  const longest = Math.max(row.longestStreak ?? 0, next);

  await db
    .update(creationStreaksTable)
    .set({ currentStreak: next, longestStreak: longest, lastCreationDate: today, updatedAt: new Date() })
    .where(eq(creationStreaksTable.userId, userId));
}

/* ── QUEST TRACKING ────────────────────────────────────────────────────── */

async function updateQuests(userId: string, kind: CreationKind): Promise<void> {
  const weekStart = currentWeekStart();
  const applicable = QUEST_DEFS.filter((q) => q.kinds.includes(kind));
  for (const q of applicable) {
    await db
      .insert(questProgressTable)
      .values({
        userId,
        questKey: q.key,
        weekStart,
        progress: 1,
        target: q.target,
        completed: 1 >= q.target,
      })
      .onConflictDoUpdate({
        target: [questProgressTable.userId, questProgressTable.questKey, questProgressTable.weekStart],
        set: {
          progress: sql`LEAST(${questProgressTable.progress} + 1, ${questProgressTable.target})`,
          completed: sql`LEAST(${questProgressTable.progress} + 1, ${questProgressTable.target}) >= ${questProgressTable.target}`,
          updatedAt: new Date(),
        },
      });
  }
}

/* ── THE HOOK: call after any creation event ─────────────────────────────
   Fire-and-forget: callers should .catch() it. Never throws. */
export async function recordCreation(userId: string, kind: CreationKind): Promise<void> {
  try {
    const prefs = await getPrefs(userId);
    if (prefs.creationStreaksEnabled) await updateStreak(userId);
    if (prefs.questsEnabled) await updateQuests(userId, kind);
  } catch (err) {
    logger.warn({ err, userId, kind }, "[retention] recordCreation failed");
  }
}

/* ── READ API (used by routes) ─────────────────────────────────────────── */

export interface MilestoneStatus {
  days: number;
  reward: number;
  reached: boolean;
  claimed: boolean;
}

export interface StreakStatus {
  enabled: boolean;
  currentStreak: number;
  longestStreak: number;
  lastCreationDate: string | null;
  milestonesClaimed: number[];
  milestones: MilestoneStatus[];
  nextMilestone: { days: number; reward: number } | null;
}

export async function getStreakStatus(userId: string): Promise<StreakStatus> {
  const prefs = await getPrefs(userId);
  const rows = await db
    .select()
    .from(creationStreaksTable)
    .where(eq(creationStreaksTable.userId, userId))
    .limit(1);
  const row = rows[0];
  const current = row?.currentStreak ?? 0;
  const claimed = (row?.milestonesClaimed ?? []) as number[];
  const milestones: MilestoneStatus[] = STREAK_MILESTONES.map((m) => ({
    days: m.days,
    reward: m.reward,
    reached: current >= m.days,
    claimed: claimed.includes(m.days),
  }));
  return {
    enabled: prefs.creationStreaksEnabled,
    currentStreak: current,
    longestStreak: row?.longestStreak ?? 0,
    lastCreationDate: row?.lastCreationDate ?? null,
    milestonesClaimed: claimed,
    milestones,
    nextMilestone: milestones.find((m) => !m.claimed) ?? null,
  };
}

export interface QuestStatus {
  key: string;
  target: number;
  reward: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

export interface QuestsStatus {
  enabled: boolean;
  weekStart: string;
  quests: QuestStatus[];
}

export async function getQuestsStatus(userId: string): Promise<QuestsStatus> {
  const prefs = await getPrefs(userId);
  const weekStart = currentWeekStart();
  const rows = await db
    .select()
    .from(questProgressTable)
    .where(
      and(
        eq(questProgressTable.userId, userId),
        eq(questProgressTable.weekStart, weekStart),
      )
    );
  const byKey = new Map(rows.map((r) => [r.questKey, r]));
  return {
    enabled: prefs.questsEnabled,
    weekStart,
    quests: QUEST_DEFS.map((q) => {
      const r = byKey.get(q.key);
      return {
        key: q.key,
        target: q.target,
        reward: q.reward,
        progress: r?.progress ?? 0,
        completed: r?.completed ?? false,
        claimed: r?.claimedAt != null,
      };
    }),
  };
}

/* ── CLAIMS ────────────────────────────────────────────────────────────── */

export async function claimStreakMilestone(
  userId: string,
  days: number
): Promise<{ reward: number; currentStreak: number }> {
  const milestone = STREAK_MILESTONES.find((m) => m.days === days);
  if (!milestone) throw new Error("Unknown milestone");
  const status = await getStreakStatus(userId);
  if (!status.enabled) throw new Error("Creation streaks are disabled");
  if (!status.milestones.find((m) => m.days === days)?.reached) {
    throw new Error("Milestone not reached yet");
  }
  if (status.milestonesClaimed.includes(days)) throw new Error("Milestone already claimed");

  // Mark claimed BEFORE payout so a retry can't double-pay.
  const claimed = [...status.milestonesClaimed, days].sort((a, b) => a - b);
  const updated = await db
    .update(creationStreaksTable)
    .set({ milestonesClaimed: claimed, updatedAt: new Date() })
    .where(
      and(
        eq(creationStreaksTable.userId, userId),
        sql`NOT (${creationStreaksTable.milestonesClaimed} @> ARRAY[${days}]::int[])`
      )
    )
    .returning({ userId: creationStreaksTable.userId });
  if (updated.length === 0) throw new Error("Milestone already claimed");

  try {
    await addCreditsToProfile(userId, milestone.reward);
  } catch (err) {
    logger.error({ err, userId, days }, "[retention] CRITICAL: streak milestone marked claimed but VB payout failed");
    throw new Error("Visual Bucs payout failed — contact support");
  }
  logger.info({ userId, days, reward: milestone.reward }, "[retention] streak milestone claimed");
  return { reward: milestone.reward, currentStreak: status.currentStreak };
}

export async function claimQuestReward(
  userId: string,
  questKey: string
): Promise<{ reward: number }> {
  const def = QUEST_DEFS.find((q) => q.key === questKey);
  if (!def) throw new Error("Unknown quest");
  const status = await getQuestsStatus(userId);
  if (!status.enabled) throw new Error("Quests are disabled");
  const q = status.quests.find((s) => s.key === questKey);
  if (!q?.completed) throw new Error("Quest not completed yet");
  if (q.claimed) throw new Error("Quest reward already claimed");

  // Conditional update: only when still unclaimed.
  const updated = await db
    .update(questProgressTable)
    .set({ claimedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(questProgressTable.userId, userId),
        eq(questProgressTable.questKey, questKey),
        eq(questProgressTable.weekStart, status.weekStart),
        sql`${questProgressTable.claimedAt} IS NULL`
      )
    )
    .returning({ userId: questProgressTable.userId });
  if (updated.length === 0) throw new Error("Quest reward already claimed");

  try {
    await addCreditsToProfile(userId, def.reward);
  } catch (err) {
    logger.error({ err, userId, questKey }, "[retention] CRITICAL: quest marked claimed but VB payout failed");
    throw new Error("Visual Bucs payout failed — contact support");
  }
  logger.info({ userId, questKey, reward: def.reward }, "[retention] quest reward claimed");
  return { reward: def.reward };
}

/* ── PREFS ─────────────────────────────────────────────────────────────── */

export async function getRetentionPrefs(userId: string): Promise<{
  creation_streaks_enabled: boolean;
  quests_enabled: boolean;
  daily_drop_enabled: boolean;
  away_digest_enabled: boolean;
}> {
  const prefs = await getPrefs(userId);
  return {
    creation_streaks_enabled: prefs.creationStreaksEnabled,
    quests_enabled: prefs.questsEnabled,
    daily_drop_enabled: prefs.dailyDropEnabled,
    away_digest_enabled: prefs.awayDigestEnabled,
  };
}

export async function setRetentionPrefs(
  userId: string,
  patch: {
    creation_streaks_enabled?: boolean;
    quests_enabled?: boolean;
    daily_drop_enabled?: boolean;
    away_digest_enabled?: boolean;
  }
): Promise<{
  creation_streaks_enabled: boolean;
  quests_enabled: boolean;
  daily_drop_enabled: boolean;
  away_digest_enabled: boolean;
}> {
  const current = await getPrefs(userId);
  const next = {
    creation_streaks_enabled: patch.creation_streaks_enabled ?? current.creationStreaksEnabled,
    quests_enabled: patch.quests_enabled ?? current.questsEnabled,
    daily_drop_enabled: patch.daily_drop_enabled ?? current.dailyDropEnabled,
    away_digest_enabled: patch.away_digest_enabled ?? current.awayDigestEnabled,
  };
  await db
    .insert(retentionPrefsTable)
    .values({
      userId,
      creationStreaksEnabled: next.creation_streaks_enabled,
      questsEnabled: next.quests_enabled,
      dailyDropEnabled: next.daily_drop_enabled,
      awayDigestEnabled: next.away_digest_enabled,
    })
    .onConflictDoUpdate({
      target: retentionPrefsTable.userId,
      set: {
        creationStreaksEnabled: next.creation_streaks_enabled,
        questsEnabled: next.quests_enabled,
        dailyDropEnabled: next.daily_drop_enabled,
        awayDigestEnabled: next.away_digest_enabled,
        updatedAt: new Date(),
      },
    });
  return next;
}
