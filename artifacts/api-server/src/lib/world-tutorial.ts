/**
 * "Your First 10 Minutes" — the tutorial quest line (Ring 3,
 * Phase 6; THE-GAME §4.6 item 6).
 *
 * A new member spawns into the full palace; this line gives their
 * first session a directed path — seven steps, every one a real
 * verb on rails the site already runs:
 *
 *   1. meet-the-king      Walk to the King in the hall (room hook)
 *   2. claim-daily-drop   Claim today's Daily Drop (fact: the
 *                         bonus rail's profiles.last_daily_claim)
 *   3. quest-board        Walk into the Treasury, the quest
 *                         board's room (room hook)
 *   4. make-a-song        Make a song (fact: this week's
 *                         generate-song quest progress ≥ 1 — the
 *                         creation hook fires from the Song Desk
 *                         and the studio alike)
 *   5. publish            Publish a track (fact: a published
 *                         track stands on the member's profile).
 *                         The step's guidance also points at the
 *                         jukebox; the publish is the verifiable
 *                         half (no durable jukebox-play record
 *                         exists to verify against).
 *   6. applaud            Applaud at a show — clap/cheer in a
 *                         stage room while a show holds it, or
 *                         tip the stage (room hooks)
 *   7. claim-quest-reward Claim a quest reward (fact: any claimed
 *                         quest_progress row)
 *
 * Steps complete IN ORDER — the line is a path, not a checklist:
 * a verb only counts while its step is the current one, and fact
 * steps reconcile on every status read, advancing through any
 * consecutive run of satisfied steps. Progress is private (the
 * member's own strip shows it); nothing here announces anything.
 *
 * THE REWARD: finishing the line pays TUTORIAL_REWARD_VB once,
 * ever, and it rides the shared weekly quest pool
 * (lib/quest-pool): if the member's week is already spent, the
 * claim refuses with the pool reason and can land in a later week
 * — the reward waits, it is never issued on top of the envelope.
 */

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import {
  db,
  worldTutorialProgressTable,
  questProgressTable,
  creatorProfilesTable,
  profileTracksTable,
  type WorldTutorialProgress,
} from "@workspace/db";
import { addCreditsAtomic, getSupabaseAdmin } from "./supabase-admin";
import {
  questPoolSpendVb,
  questPoolWeekStart,
  dbQuestPoolStore,
  WEEKLY_QUEST_POOL_VB,
  type QuestPoolStore,
} from "./quest-pool";
import { logger } from "./logger";

/** The completion reward, in VB — paid once per member, ever,
 *  from the shared weekly quest pool. */
export const TUTORIAL_REWARD_VB = 30;

export type TutorialVerb = "meet-king" | "quest-board" | "applaud";

export interface TutorialStepDef {
  n: number;
  key: string;
  /** The room hook that completes this step, when it is one. */
  verb: TutorialVerb | null;
}

export const TUTORIAL_STEPS: readonly TutorialStepDef[] = [
  { n: 1, key: "meet-the-king", verb: "meet-king" },
  { n: 2, key: "claim-daily-drop", verb: null },
  { n: 3, key: "quest-board", verb: "quest-board" },
  { n: 4, key: "make-a-song", verb: null },
  { n: 5, key: "publish", verb: null },
  { n: 6, key: "applaud", verb: "applaud" },
  { n: 7, key: "claim-quest-reward", verb: null },
] as const;

/** The step a verb belongs to (null for an unknown verb). */
export function stepForVerb(verb: TutorialVerb): TutorialStepDef | null {
  return TUTORIAL_STEPS.find((s) => s.verb === verb) ?? null;
}

/** The facts the reconcile reads, all from the site's real rails. */
export interface TutorialFacts {
  /** Today's Daily Drop claimed (UTC day). */
  dailyClaimedToday: boolean;
  /** A song made this week (generate-song quest progress ≥ 1). */
  songMadeThisWeek: boolean;
  /** A published track stands on the member's profile. */
  hasPublishedTrack: boolean;
  /** Any quest reward ever claimed. */
  hasClaimedQuest: boolean;
}

/** Whether a step's FACT is satisfied; null for verb steps (their
 *  completion is recorded, never derived). */
export function factSatisfied(step: TutorialStepDef, facts: TutorialFacts): boolean | null {
  switch (step.key) {
    case "claim-daily-drop":
      return facts.dailyClaimedToday;
    case "make-a-song":
      return facts.songMadeThisWeek;
    case "publish":
      return facts.hasPublishedTrack;
    case "claim-quest-reward":
      return facts.hasClaimedQuest;
    default:
      return null;
  }
}

/** The status DTO (GET /api/world/tutorial's answer). */
export interface TutorialStatus {
  /** The current step's number (1–7); null once the line is done. */
  currentStep: number | null;
  steps: { n: number; key: string; done: boolean }[];
  completed: boolean;
  reward: { amountVb: number; claimed: boolean };
}

export interface TutorialProgressRow {
  currentStep: number;
  completedSteps: string[];
  completedAt: Date | null;
  rewardAmountVb: number | null;
  rewardClaimedAt: Date | null;
}

export interface TutorialStore {
  getProgress(userId: string): Promise<TutorialProgressRow | null>;
  /** Insert the fresh row (or read the existing one). */
  ensureProgress(userId: string): Promise<TutorialProgressRow>;
  saveProgress(
    userId: string,
    patch: { currentStep: number; completedSteps: string[]; completedAt: Date | null },
  ): Promise<void>;
  /** The conditional reward claim: stamps amount + time only
   *  where the line is complete and the reward unclaimed.
   *  Returns false when the claim was already taken (race). */
  markRewardClaimed(userId: string, amountVb: number, now: Date): Promise<boolean>;
  unmarkRewardClaimed(userId: string): Promise<void>;
  grant(userId: string, amountVb: number): Promise<void>;
  facts(userId: string, todayUtc: string, weekStart: string): Promise<TutorialFacts>;
}

function rowOf(r: WorldTutorialProgress): TutorialProgressRow {
  return {
    currentStep: r.currentStep,
    completedSteps: Array.isArray(r.completedSteps)
      ? (r.completedSteps as unknown[]).filter((k): k is string => typeof k === "string")
      : [],
    completedAt: r.completedAt ? new Date(r.completedAt) : null,
    rewardAmountVb: r.rewardAmountVb ?? null,
    rewardClaimedAt: r.rewardClaimedAt ? new Date(r.rewardClaimedAt) : null,
  };
}

export const dbTutorialStore: TutorialStore = {
  async getProgress(userId) {
    const [row] = await db
      .select()
      .from(worldTutorialProgressTable)
      .where(eq(worldTutorialProgressTable.userId, userId))
      .limit(1);
    return row ? rowOf(row) : null;
  },
  async ensureProgress(userId) {
    await db
      .insert(worldTutorialProgressTable)
      .values({ userId })
      .onConflictDoNothing();
    const row = await this.getProgress(userId);
    if (!row) throw new Error("tutorial progress row missing after ensure");
    return row;
  },
  async saveProgress(userId, patch) {
    await db
      .update(worldTutorialProgressTable)
      .set({
        currentStep: patch.currentStep,
        completedSteps: patch.completedSteps,
        completedAt: patch.completedAt,
        updatedAt: new Date(),
      })
      .where(eq(worldTutorialProgressTable.userId, userId));
  },
  async markRewardClaimed(userId, amountVb, now) {
    const updated = await db
      .update(worldTutorialProgressTable)
      .set({ rewardAmountVb: amountVb, rewardClaimedAt: now, updatedAt: now })
      .where(
        and(
          eq(worldTutorialProgressTable.userId, userId),
          isNotNull(worldTutorialProgressTable.completedAt),
          isNull(worldTutorialProgressTable.rewardClaimedAt),
        ),
      )
      .returning({ userId: worldTutorialProgressTable.userId });
    return updated.length > 0;
  },
  async unmarkRewardClaimed(userId) {
    await db
      .update(worldTutorialProgressTable)
      .set({ rewardAmountVb: null, rewardClaimedAt: null, updatedAt: new Date() })
      .where(eq(worldTutorialProgressTable.userId, userId));
  },
  async grant(userId, amountVb) {
    await addCreditsAtomic(userId, amountVb);
  },
  async facts(userId, todayUtc, weekStart) {
    /* The daily claim lives on the Supabase profile (the bonus
     * rail's own record) — read it there, nowhere else. */
    let dailyClaimedToday = false;
    try {
      const admin = getSupabaseAdmin();
      const { data } = await admin
        .from("profiles")
        .select("last_daily_claim")
        .eq("id", userId)
        .maybeSingle();
      dailyClaimedToday =
        (data as { last_daily_claim?: string | null } | null)?.last_daily_claim === todayUtc;
    } catch (err) {
      logger.warn({ err, userId }, "[tutorial] daily-claim fact read failed — step waits");
    }
    const [songRows, claimedRows, profileRows] = await Promise.all([
      db
        .select({ progress: questProgressTable.progress })
        .from(questProgressTable)
        .where(
          and(
            eq(questProgressTable.userId, userId),
            eq(questProgressTable.questKey, "generate-song"),
            eq(questProgressTable.weekStart, weekStart),
          ),
        )
        .limit(1),
      db
        .select({ questKey: questProgressTable.questKey })
        .from(questProgressTable)
        .where(and(eq(questProgressTable.userId, userId), isNotNull(questProgressTable.claimedAt)))
        .limit(1),
      db
        .select({ id: creatorProfilesTable.id })
        .from(creatorProfilesTable)
        .where(eq(creatorProfilesTable.userId, userId))
        .limit(1),
    ]);
    let hasPublishedTrack = false;
    const profileId = profileRows[0]?.id;
    if (profileId) {
      const tracks = await db
        .select({ id: profileTracksTable.id })
        .from(profileTracksTable)
        .where(
          and(eq(profileTracksTable.profileId, profileId), eq(profileTracksTable.isPublished, true)),
        )
        .limit(1);
      hasPublishedTrack = tracks.length > 0;
    }
    return {
      dailyClaimedToday,
      songMadeThisWeek: (songRows[0]?.progress ?? 0) >= 1,
      hasPublishedTrack,
      hasClaimedQuest: claimedRows.length > 0,
    };
  },
};

/** Status DTO from a progress row — pure shaping. */
export function tutorialStatusOf(row: TutorialProgressRow): TutorialStatus {
  const done = new Set(row.completedSteps);
  const completed = row.completedAt !== null;
  return {
    currentStep: completed ? null : row.currentStep,
    steps: TUTORIAL_STEPS.map((s) => ({ n: s.n, key: s.key, done: done.has(s.key) })),
    completed,
    reward: { amountVb: TUTORIAL_REWARD_VB, claimed: row.rewardClaimedAt !== null },
  };
}

/**
 * Advance a progress row through every step that currently
 * holds: verb steps complete only from their recorded key in
 * completedSteps; fact steps from the facts. Pure — returns the
 * next row state (and whether it changed).
 */
export function advanceTutorial(
  row: TutorialProgressRow,
  facts: TutorialFacts,
  now: Date,
): { row: TutorialProgressRow; changed: boolean } {
  if (row.completedAt) return { row, changed: false };
  const completedSteps = [...row.completedSteps];
  const done = new Set(completedSteps);
  let current = row.currentStep;
  let changed = false;
  while (current <= TUTORIAL_STEPS.length) {
    const step = TUTORIAL_STEPS[current - 1]!;
    if (done.has(step.key)) {
      current += 1;
      changed = true;
      continue;
    }
    const fact = factSatisfied(step, facts);
    if (fact === true) {
      completedSteps.push(step.key);
      done.add(step.key);
      current += 1;
      changed = true;
      continue;
    }
    break;
  }
  const completedAt = current > TUTORIAL_STEPS.length ? now : null;
  return {
    row: {
      ...row,
      currentStep: Math.min(current, TUTORIAL_STEPS.length),
      completedSteps,
      completedAt: completedAt ?? row.completedAt,
    },
    changed: changed || completedAt !== null,
  };
}

/** Read + reconcile + persist: the status route's whole job. */
export async function getTutorialStatus(
  store: TutorialStore = dbTutorialStore,
  userId: string,
  now = new Date(),
): Promise<TutorialStatus> {
  const before = await store.ensureProgress(userId);
  const facts = await store.facts(userId, now.toISOString().slice(0, 10), questPoolWeekStart(now));
  const { row, changed } = advanceTutorial(before, facts, now);
  if (changed) {
    await store.saveProgress(userId, {
      currentStep: row.currentStep,
      completedSteps: row.completedSteps,
      completedAt: row.completedAt,
    });
  }
  return tutorialStatusOf(row);
}

/**
 * Record a room-hook verb: completes its step ONLY while that
 * step is current, then reconciles forward through any satisfied
 * fact steps. Fire-and-forget by design (the caller is a socket
 * frame); failures are logged, never thrown into the room.
 */
export async function noteTutorialVerb(
  store: TutorialStore,
  userId: string,
  verb: TutorialVerb,
  now = new Date(),
): Promise<void> {
  const step = stepForVerb(verb);
  if (!step) return;
  /* Ensure, not just get: a member can reach the King before any
   * client status read has created their row — the verb must not
   * be lost for arriving early. */
  const row = await store.ensureProgress(userId);
  if (row.completedAt) return;
  if (row.currentStep !== step.n) return;
  if (row.completedSteps.includes(step.key)) return;
  const seeded: TutorialProgressRow = {
    ...row,
    completedSteps: [...row.completedSteps, step.key],
  };
  const facts = await store.facts(userId, now.toISOString().slice(0, 10), questPoolWeekStart(now));
  const { row: next } = advanceTutorial(seeded, facts, now);
  await store.saveProgress(userId, {
    currentStep: next.currentStep,
    completedSteps: next.completedSteps,
    completedAt: next.completedAt,
  });
}

/** The room dep: fire-and-forget verb notes with the db store. */
export function createTutorialActionNotifier(
  store: TutorialStore = dbTutorialStore,
): (userId: string, verb: TutorialVerb) => void {
  return (userId, verb) => {
    void noteTutorialVerb(store, userId, verb).catch((err) => {
      logger.warn({ err, userId, verb }, "[tutorial] verb note failed");
    });
  };
}

export type TutorialClaimResult =
  | { ok: true; amountVb: number }
  | { ok: false; reason: "not-completed" | "already" | "pool" | "error" };

/**
 * Build the completion-reward claim: complete? unclaimed? the
 * week's pool has room? — then the conditional stamp is the
 * idempotency anchor and the grant follows it; a failed grant
 * unstamps so the member can claim again.
 */
export function createTutorialClaimer(
  store: TutorialStore = dbTutorialStore,
  pool: QuestPoolStore = dbQuestPoolStore,
) {
  return async (userId: string, now = new Date()): Promise<TutorialClaimResult> => {
    try {
      /* Reconcile first: a member whose last fact landed since
       * their last read completes here, then claims. */
      await getTutorialStatus(store, userId, now);
      const row = await store.getProgress(userId);
      if (!row || !row.completedAt) return { ok: false, reason: "not-completed" };
      if (row.rewardClaimedAt) return { ok: false, reason: "already" };
      const spentVb = await questPoolSpendVb(pool, userId, questPoolWeekStart(now));
      if (spentVb + TUTORIAL_REWARD_VB > WEEKLY_QUEST_POOL_VB) {
        return { ok: false, reason: "pool" };
      }
      const marked = await store.markRewardClaimed(userId, TUTORIAL_REWARD_VB, now);
      if (!marked) return { ok: false, reason: "already" };
      try {
        await store.grant(userId, TUTORIAL_REWARD_VB);
      } catch (err) {
        await store.unmarkRewardClaimed(userId).catch(() => undefined);
        logger.error({ err, userId }, "[tutorial] reward grant failed — claim unstamped");
        return { ok: false, reason: "error" };
      }
      return { ok: true, amountVb: TUTORIAL_REWARD_VB };
    } catch (err) {
      logger.error({ err, userId }, "[tutorial] claim failed");
      return { ok: false, reason: "error" };
    }
  };
}
