/* ─── Creation Streaks + Weekly Quests: shared server logic ────────────────
   Two retention systems sharing the same creation-event hook:
     • Creation Streaks — consecutive days the user CREATED something
       (project save, song, thumbnail, video export). Milestone VB payouts.
     • Weekly Quests — 3 fixed weekly quests, reset Monday (UTC).
   Both honor retention_prefs (creation_streaks_enabled / quests_enabled).
   recordCreation() is fire-and-forget safe: it never throws. */

import { db, creationStreaksTable, questProgressTable, retentionPrefsTable, notificationsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { addCreditsAtomic } from "./supabase-admin";
import { logger } from "./logger";

export type CreationKind = "project" | "song" | "thumbnail" | "export" | "share";

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
/* Weekly quest pool is capped at 300 VB/week (owner-approved 2026-10-09).
   Rebalanced 2026-10-11 per owner approval (option A: fit viral-sharer
   inside the existing pool, zero new spend): 40 + 80 + 120 + 60 = 300. */
export const QUEST_DEFS: QuestDef[] = [
  { key: "make-thumbnail", target: 1, reward: 40,  kinds: ["thumbnail"] },
  { key: "generate-song",  target: 1, reward: 80,  kinds: ["song"] },
  { key: "export-video",   target: 1, reward: 120, kinds: ["export"] },
  { key: "viral-sharer",   target: 3, reward: 60,  kinds: ["share"] },
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
  /* Login-streaks-with-teeth pack: owned here, consumed by sibling systems. */
  loginStreaksEnabled: boolean;
  shareToEarnEnabled: boolean;
  contestsEnabled: boolean;
  fomoFeedEnabled: boolean;
}

async function getPrefs(userId: string): Promise<Prefs> {
  try {
    const rows = await db
      .select({
        creationStreaksEnabled: retentionPrefsTable.creationStreaksEnabled,
        questsEnabled: retentionPrefsTable.questsEnabled,
        dailyDropEnabled: retentionPrefsTable.dailyDropEnabled,
        awayDigestEnabled: retentionPrefsTable.awayDigestEnabled,
        loginStreaksEnabled: retentionPrefsTable.loginStreaksEnabled,
        shareToEarnEnabled: retentionPrefsTable.shareToEarnEnabled,
        contestsEnabled: retentionPrefsTable.contestsEnabled,
        fomoFeedEnabled: retentionPrefsTable.fomoFeedEnabled,
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
      loginStreaksEnabled: row?.loginStreaksEnabled ?? true,
      shareToEarnEnabled: row?.shareToEarnEnabled ?? true,
      contestsEnabled: row?.contestsEnabled ?? true,
      fomoFeedEnabled: row?.fomoFeedEnabled ?? true,
    };
  } catch (err) {
    logger.warn({ err, userId }, "[retention] prefs read failed — defaulting to enabled");
    return {
      creationStreaksEnabled: true,
      questsEnabled: true,
      dailyDropEnabled: true,
      awayDigestEnabled: true,
      loginStreaksEnabled: true,
      shareToEarnEnabled: true,
      contestsEnabled: true,
      fomoFeedEnabled: true,
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

  /* DE-18: landing exactly on an unclaimed milestone day is a
     one-time transition (the streak passes each count once, and a
     claimed milestone is never re-reached unclaimed) — ring the
     bell so the reward doesn't wait silently for a widget visit. */
  const milestone = STREAK_MILESTONES.find((m) => m.days === next);
  if (milestone && !((row.milestonesClaimed ?? []) as number[]).includes(milestone.days)) {
    await notifyStreakMilestone(userId, milestone.days, milestone.reward);
  }
}

/* ── QUEST TRACKING ────────────────────────────────────────────────────── */

/* Quest display names — mirror the QuestsWidget's English titles
   (retention.quest_*_title in locales/en.json); notification copy is
   written server-side, in English, everywhere in the house. */
const QUEST_TITLES: Record<string, string> = {
  "make-thumbnail": "Make a thumbnail",
  "generate-song": "Generate a song",
  "export-video": "Export a video",
  "viral-sharer": "Viral Sharer",
};

/** DE-18: the moment a quest flips to complete, ring the bell. The
 *  reward still waits for the claim tap in the widget — but it no
 *  longer sits there silently if the creator never opens the widget.
 *  Best-effort: a failed insert never breaks the creation hook. */
async function notifyQuestComplete(userId: string, def: QuestDef): Promise<void> {
  try {
    await db.insert(notificationsTable).values({
      userId,
      kind: "quest",
      title: "Quest complete 🏆",
      body: `You finished “${QUEST_TITLES[def.key] ?? def.key}” — ${def.reward} Visual Bucs are waiting. Tap to claim.`,
      link: "/dashboard",
    });
  } catch (err) {
    logger.warn({ err, userId, questKey: def.key }, "[retention] quest-complete notification failed");
  }
}

/** DE-18, streak half: a milestone day reached is the same silent
 *  wait as a completed quest — ring the same bell (the streak widget
 *  with its claim button lives on the same dashboard surface). */
async function notifyStreakMilestone(userId: string, days: number, reward: number): Promise<void> {
  try {
    await db.insert(notificationsTable).values({
      userId,
      kind: "quest",
      title: "Streak milestone 🔥",
      body: `Your creation streak hit ${days} days — ${reward} Visual Bucs are waiting. Tap to claim.`,
      link: "/dashboard",
    });
  } catch (err) {
    logger.warn({ err, userId, days }, "[retention] streak-milestone notification failed");
  }
}

async function updateQuests(userId: string, kind: CreationKind): Promise<void> {
  const weekStart = currentWeekStart();
  const applicable = QUEST_DEFS.filter((q) => q.kinds.includes(kind));
  /* Stack-30 C2: at most ONE quest-completion bell per updateQuests
     call. A single event can finish several quests at once (every def
     whose kinds include this kind flips false → true in this loop);
     each used to ring its own bell for the same one action. The bell
     now names the first quest this call finished — every finished
     quest's reward still waits on the same /dashboard claim surface
     the bell links to, and every quest's progress/completion is
     recorded exactly as before. (Streak-milestone bells ring from
     updateStreak, not here, and are not capped by this.) */
  let bellRung = false;
  for (const q of applicable) {
    /* DE-18: read the row BEFORE the upsert so the completion flip
       (false → true) is observable — the upsert alone can't say
       whether THIS event finished the quest. */
    const [prior] = await db
      .select({ completed: questProgressTable.completed })
      .from(questProgressTable)
      .where(and(
        eq(questProgressTable.userId, userId),
        eq(questProgressTable.questKey, q.key),
        eq(questProgressTable.weekStart, weekStart),
      ))
      .limit(1);
    const [row] = await db
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
      })
      .returning({ completed: questProgressTable.completed });
    if (!prior?.completed && row?.completed && !bellRung) {
      bellRung = true;
      await notifyQuestComplete(userId, q);
    }
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

/* ── SHARE HOOK: call after a share action (POST /api/shares) ────────────
   Unlike recordCreation, a share is NOT a creation event: it never touches
   creation streaks — it only advances the "viral-sharer" quest. Honors
   quests_enabled and the share_to_earn_enabled toggle (owned by the
   login-streaks sibling). Fire-and-forget: never throws. */
export async function recordShareEvent(userId: string): Promise<void> {
  try {
    const prefs = await getPrefs(userId);
    if (!prefs.questsEnabled) return;
    if (!prefs.shareToEarnEnabled) return;
    await updateQuests(userId, "share");
  } catch (err) {
    logger.warn({ err, userId }, "[retention] recordShareEvent failed");
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

  // Mark claimed BEFORE payout so a retry can't double-pay. The append
  // happens IN SQL (milestones_claimed || ARRAY[days]) under the NOT-@>
  // guard — never write back a JS-computed array: a concurrent claim of a
  // DIFFERENT milestone would read the same stale array, and the loser's
  // write would erase the winner's claim marker, making the winner's
  // milestone claimable (and payable) a second time.
  const updated = await db
    .update(creationStreaksTable)
    .set({
      milestonesClaimed: sql`${creationStreaksTable.milestonesClaimed} || ARRAY[${days}]::int[]`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(creationStreaksTable.userId, userId),
        sql`NOT (${creationStreaksTable.milestonesClaimed} @> ARRAY[${days}]::int[])`
      )
    )
    .returning({ userId: creationStreaksTable.userId });
  if (updated.length === 0) throw new Error("Milestone already claimed");

  try {
    await addCreditsAtomic(userId, milestone.reward);
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
  /* The Viral Sharer quest tracks with reward 0 until the owner approves
     how it fits the 300 VB/week pool — refuse to pay anything invented. */
  if (def.reward <= 0) throw new Error("This quest's reward is pending owner approval");
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
    await addCreditsAtomic(userId, def.reward);
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
  login_streaks_enabled: boolean;
  share_to_earn_enabled: boolean;
  contests_enabled: boolean;
  fomo_feed_enabled: boolean;
}> {
  const prefs = await getPrefs(userId);
  return {
    creation_streaks_enabled: prefs.creationStreaksEnabled,
    quests_enabled: prefs.questsEnabled,
    daily_drop_enabled: prefs.dailyDropEnabled,
    away_digest_enabled: prefs.awayDigestEnabled,
    login_streaks_enabled: prefs.loginStreaksEnabled,
    share_to_earn_enabled: prefs.shareToEarnEnabled,
    contests_enabled: prefs.contestsEnabled,
    fomo_feed_enabled: prefs.fomoFeedEnabled,
  };
}

export async function setRetentionPrefs(
  userId: string,
  patch: {
    creation_streaks_enabled?: boolean;
    quests_enabled?: boolean;
    daily_drop_enabled?: boolean;
    away_digest_enabled?: boolean;
    login_streaks_enabled?: boolean;
    share_to_earn_enabled?: boolean;
    contests_enabled?: boolean;
    fomo_feed_enabled?: boolean;
  }
): Promise<{
  creation_streaks_enabled: boolean;
  quests_enabled: boolean;
  daily_drop_enabled: boolean;
  away_digest_enabled: boolean;
  login_streaks_enabled: boolean;
  share_to_earn_enabled: boolean;
  contests_enabled: boolean;
  fomo_feed_enabled: boolean;
}> {
  const current = await getPrefs(userId);
  const next = {
    creation_streaks_enabled: patch.creation_streaks_enabled ?? current.creationStreaksEnabled,
    quests_enabled: patch.quests_enabled ?? current.questsEnabled,
    daily_drop_enabled: patch.daily_drop_enabled ?? current.dailyDropEnabled,
    away_digest_enabled: patch.away_digest_enabled ?? current.awayDigestEnabled,
    login_streaks_enabled: patch.login_streaks_enabled ?? current.loginStreaksEnabled,
    share_to_earn_enabled: patch.share_to_earn_enabled ?? current.shareToEarnEnabled,
    contests_enabled: patch.contests_enabled ?? current.contestsEnabled,
    fomo_feed_enabled: patch.fomo_feed_enabled ?? current.fomoFeedEnabled,
  };
  await db
    .insert(retentionPrefsTable)
    .values({
      userId,
      creationStreaksEnabled: next.creation_streaks_enabled,
      questsEnabled: next.quests_enabled,
      dailyDropEnabled: next.daily_drop_enabled,
      awayDigestEnabled: next.away_digest_enabled,
      loginStreaksEnabled: next.login_streaks_enabled,
      shareToEarnEnabled: next.share_to_earn_enabled,
      contestsEnabled: next.contests_enabled,
      fomoFeedEnabled: next.fomo_feed_enabled,
    })
    .onConflictDoUpdate({
      target: retentionPrefsTable.userId,
      set: {
        creationStreaksEnabled: next.creation_streaks_enabled,
        questsEnabled: next.quests_enabled,
        dailyDropEnabled: next.daily_drop_enabled,
        awayDigestEnabled: next.away_digest_enabled,
        loginStreaksEnabled: next.login_streaks_enabled,
        shareToEarnEnabled: next.share_to_earn_enabled,
        contestsEnabled: next.contests_enabled,
        fomoFeedEnabled: next.fomo_feed_enabled,
        updatedAt: new Date(),
      },
    });
  return next;
}
