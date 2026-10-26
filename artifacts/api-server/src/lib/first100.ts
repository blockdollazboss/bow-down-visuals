/**
 * First 100 Fans (Stack-200 List 2 #155, TRULY NEW) — a guided
 * in-house path walking a NEW CREATOR to their first 100 REAL fans.
 *
 * THE HONESTY CONTRACT (the item fails without it):
 *  - The fan count is the number of REAL rows in `follows` for the
 *    creator's profile, deduplicated by follower account. Nothing
 *    else is ever counted: no bought fans, no botted fans, no
 *    house-planted fans, no estimates. A creator with 3 follows has
 *    3 fans here, however thin that looks.
 *  - Every guided step is derived from real state (profile fields,
 *    published works, group membership) — never from a checkbox the
 *    creator ticks themselves.
 *  - The early-fans list is the actual first follows, in the order
 *    they happened. Fans without a creator profile of their own are
 *    shown by their fan number, never given an invented name.
 *
 * RECOGNITION, NOT ECONOMY: milestones (1 / 10 / 25 / 50 / 100) are
 * celebrated through the EXISTING notifications rail (kind
 * 'first100_milestone'), exactly once each — the celebrated set in
 * first100_state is the memory that keeps a celebration from firing
 * twice. No charges, no Visual Bucs, no new badge economy: the
 * milestone badge a creator wears is this same derived state,
 * rendered on their First 100 card.
 *
 * SMART LAW: the card surfaces on the dashboard while the journey
 * is live; dismissing it snoozes it for 7 days; a NEW milestone
 * always breaks the snooze (a celebration is not a nag); once 100
 * is reached and celebrated, the program completes and the card
 * retires itself.
 */
import { asc, eq, inArray } from "drizzle-orm";
import {
  db,
  creatorProfilesTable,
  first100StateTable,
  followsTable,
  groupMembersTable,
  notificationsTable,
  profileTracksTable,
  profileVideosTable,
  FIRST100_MILESTONES,
  type First100Milestone,
} from "@workspace/db";
import { logger } from "./logger";

export { FIRST100_MILESTONES };
export type { First100Milestone };

export const FIRST100_GOAL = 100;
export const FIRST100_SNOOZE_DAYS = 7;
export const FIRST100_NOTIFICATION_KIND = "first100_milestone";

/* ─── Raw source shapes (the loader projects rows into these) ────── */

export interface First100FollowRow {
  followerUserId: string;
  createdAt: Date;
}

export interface First100FanCard {
  displayName: string;
  slug: string;
  avatarUrl: string | null;
}

export interface First100Facts {
  hasProfile: boolean;
  /** Bio written AND an avatar set AND a display name — a finished page. */
  profileComplete: boolean;
  /** Public profiles are the ones discovery surfaces can show. */
  isPublic: boolean;
  /** Published tracks + published videos standing on the profile. */
  publishedWorks: number;
  /** Groups the creator belongs to (the rooms). */
  groupCount: number;
}

export interface First100Sources {
  follows: First100FollowRow[];
  fanCards: Map<string, First100FanCard>;
  facts: First100Facts;
}

export interface First100PersistedState {
  celebrated: number[];
  dismissedAt: Date | null;
  snoozeUntil: Date | null;
  completedAt: Date | null;
}

/* ─── The guided steps ───────────────────────────────────────────── */

export const FIRST100_STEP_KEYS = [
  "finish_profile",
  "drop_first_work",
  "go_public",
  "work_the_rooms",
  "reach_100",
] as const;
export type First100StepKey = (typeof FIRST100_STEP_KEYS)[number];

export interface First100StepDef {
  key: First100StepKey;
  title: string;
  blurb: string;
  href: string;
}

export const FIRST100_STEPS: readonly First100StepDef[] = [
  {
    key: "finish_profile",
    title: "Finish your profile",
    blurb: "Your photo, your name, a bio that says what you make. Fans follow a person, not a blank page.",
    href: "/artist-setup",
  },
  {
    key: "drop_first_work",
    title: "Drop your first work",
    blurb: "Publish a track or a video. Nobody can be a fan of work they haven't heard yet.",
    href: "/create",
  },
  {
    key: "go_public",
    title: "Be discoverable",
    blurb: "A public profile is what Explore and the discovery surfaces can put in front of new listeners.",
    href: "/artist-setup",
  },
  {
    key: "work_the_rooms",
    title: "Work the rooms",
    blurb: "Join a group, show up, talk to people. The first fans almost always meet you in a room first.",
    href: "/groups",
  },
  {
    key: "reach_100",
    title: "Reach 100 fans",
    blurb: "Every real follow counts. The house marks 1, 10, 25, 50 and 100 with you as they land.",
    href: "/dashboard",
  },
] as const;

/** Whether one step's FACT is satisfied — derived, never self-reported. */
export function stepDone(key: First100StepKey, facts: First100Facts, fanCount: number): boolean {
  switch (key) {
    case "finish_profile":
      return facts.profileComplete;
    case "drop_first_work":
      return facts.publishedWorks > 0;
    case "go_public":
      return facts.hasProfile && facts.isPublic;
    case "work_the_rooms":
      return facts.groupCount > 0;
    case "reach_100":
      return fanCount >= FIRST100_GOAL;
  }
}

/* ─── Pure milestone math ────────────────────────────────────────── */

/**
 * Deduplicate raw follow rows by follower account and order them by
 * follow time (ties broken by account id, so the order — and with it
 * the fan numbers — is stable). The follows table's primary key
 * already forbids duplicate rows; this is the belt on those braces,
 * and it is what the count is computed from, so a duplicated row in
 * any fixture or join can never inflate a creator's fan count.
 */
export function dedupeFollows(rows: readonly First100FollowRow[]): First100FollowRow[] {
  const seen = new Set<string>();
  const out: First100FollowRow[] = [];
  for (const row of rows) {
    if (seen.has(row.followerUserId)) continue;
    seen.add(row.followerUserId);
    out.push(row);
  }
  out.sort((a, b) => {
    const byTime = a.createdAt.getTime() - b.createdAt.getTime();
    if (byTime !== 0) return byTime;
    return a.followerUserId < b.followerUserId ? -1 : a.followerUserId > b.followerUserId ? 1 : 0;
  });
  return out;
}

/** The milestones a fan count has REACHED (count >= milestone). */
export function reachedMilestones(fanCount: number): First100Milestone[] {
  return FIRST100_MILESTONES.filter((m) => fanCount >= m);
}

/**
 * The celebrations still owed: milestones reached but not yet in the
 * celebrated set. This planner is the exactly-once gate — celebrate
 * only ever sends what this returns.
 */
export function planCelebrations(fanCount: number, celebrated: readonly number[]): First100Milestone[] {
  const done = new Set(celebrated);
  return reachedMilestones(fanCount).filter((m) => !done.has(m));
}

export interface First100MilestoneState {
  milestone: First100Milestone;
  reached: boolean;
  celebrated: boolean;
}

export function milestoneStates(fanCount: number, celebrated: readonly number[]): First100MilestoneState[] {
  const done = new Set(celebrated);
  return FIRST100_MILESTONES.map((milestone) => ({
    milestone,
    reached: fanCount >= milestone,
    celebrated: done.has(milestone),
  }));
}

/** The next milestone still ahead, or null at/past 100. */
export function nextMilestone(fanCount: number): First100Milestone | null {
  return FIRST100_MILESTONES.find((m) => fanCount < m) ?? null;
}

/**
 * Smart-law surface decision for the dashboard card.
 *  - Completed (100 reached AND every milestone celebrated): retire.
 *  - An uncelebrated milestone is pending: always surface — the
 *    celebration moment is the one interruption the item sanctions.
 *  - Otherwise respect the snooze; surface when it has lapsed.
 */
export function shouldSurfaceFirst100(input: {
  fanCount: number;
  celebrated: readonly number[];
  snoozeUntil: Date | null;
  now: Date;
}): boolean {
  const pending = planCelebrations(input.fanCount, input.celebrated);
  if (input.fanCount >= FIRST100_GOAL && pending.length === 0) return false;
  if (pending.length > 0) return true;
  if (input.snoozeUntil && input.snoozeUntil.getTime() > input.now.getTime()) return false;
  return true;
}

/* ─── The status DTO ─────────────────────────────────────────────── */

export interface First100EarlyFan {
  /** 1-based position in the creator's real follow order. */
  fanNumber: number;
  userId: string;
  displayName: string | null;
  slug: string | null;
  avatarUrl: string | null;
  followedAt: string;
}

export interface First100Status {
  fanCount: number;
  goal: number;
  progressPct: number;
  milestones: First100MilestoneState[];
  /** Highest milestone reached, or null before the first fan. */
  currentMilestone: First100Milestone | null;
  nextMilestone: First100Milestone | null;
  fansToNext: number | null;
  pendingCelebrations: First100Milestone[];
  steps: Array<First100StepDef & { done: boolean }>;
  /** The first unfinished step — the one thing to do next. */
  nextStep: First100StepKey | null;
  /** The FIRST 100 fans, in follow order (all of them, when fewer). */
  earlyFans: First100EarlyFan[];
  surface: boolean;
  completed: boolean;
  completedAt: string | null;
  snoozeUntil: string | null;
}

export function buildFirst100Status(input: {
  sources: First100Sources;
  state: First100PersistedState;
  now: Date;
}): First100Status {
  const fans = dedupeFollows(input.sources.follows);
  const fanCount = fans.length;
  const celebrated = input.state.celebrated;
  const reached = reachedMilestones(fanCount);
  const next = nextMilestone(fanCount);
  const steps = FIRST100_STEPS.map((def) => ({
    ...def,
    done: stepDone(def.key, input.sources.facts, fanCount),
  }));
  const completed = fanCount >= FIRST100_GOAL;
  return {
    fanCount,
    goal: FIRST100_GOAL,
    progressPct: Math.min(100, Math.floor((fanCount / FIRST100_GOAL) * 100)),
    milestones: milestoneStates(fanCount, celebrated),
    currentMilestone: reached.length > 0 ? reached[reached.length - 1] : null,
    nextMilestone: next,
    fansToNext: next === null ? null : next - fanCount,
    pendingCelebrations: planCelebrations(fanCount, celebrated),
    steps,
    nextStep: steps.find((s) => !s.done)?.key ?? null,
    earlyFans: fans.slice(0, FIRST100_GOAL).map((row, i) => {
      const card = input.sources.fanCards.get(row.followerUserId);
      return {
        fanNumber: i + 1,
        userId: row.followerUserId,
        displayName: card?.displayName ?? null,
        slug: card?.slug ?? null,
        avatarUrl: card?.avatarUrl ?? null,
        followedAt: row.createdAt.toISOString(),
      };
    }),
    surface: shouldSurfaceFirst100({
      fanCount,
      celebrated,
      snoozeUntil: input.state.snoozeUntil,
      now: input.now,
    }),
    completed,
    completedAt: input.state.completedAt ? input.state.completedAt.toISOString() : null,
    snoozeUntil: input.state.snoozeUntil ? input.state.snoozeUntil.toISOString() : null,
  };
}

/* ─── Celebration copy (the recognition moment) ──────────────────── */

export function celebrationCopy(milestone: First100Milestone): { title: string; body: string } {
  switch (milestone) {
    case 1:
      return {
        title: "Your first fan is here 🦈",
        body: "Fan #1 just followed you. Every run to 100 starts with one person who showed up first — the house remembers who it was.",
      };
    case 10:
      return {
        title: "10 fans strong 🦈",
        body: "Ten real people chose to follow your work. That's not a number on a screen — that's your first crowd.",
      };
    case 25:
      return {
        title: "25 fans — a real crowd 🦈",
        body: "A quarter of the way to 100, all of it earned one real follow at a time. Keep dropping work and working the rooms.",
      };
    case 50:
      return {
        title: "Halfway there — 50 fans 🦈",
        body: "Fifty real fans. The second 50 comes faster than the first — your earliest fans are already doing some of the talking.",
      };
    case 100:
      return {
        title: "100 fans! You did it 🦈",
        body: "One hundred real people follow your work. Your first 100 are your founding fans — they're named on your dashboard, because the house doesn't forget who was early.",
      };
  }
}

/* ─── Store (DB) ─────────────────────────────────────────────────── */

export interface First100Store {
  loadSources(userId: string): Promise<First100Sources>;
  loadState(userId: string): Promise<First100PersistedState>;
  saveCelebrated(userId: string, celebrated: number[], completedAt: Date | null): Promise<void>;
  saveDismissal(userId: string, dismissedAt: Date, snoozeUntil: Date): Promise<void>;
  notify(userId: string, milestone: First100Milestone): Promise<void>;
}

async function loadSourcesFromDb(userId: string): Promise<First100Sources> {
  const [profile] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);

  if (!profile) {
    return {
      follows: [],
      fanCards: new Map(),
      facts: { hasProfile: false, profileComplete: false, isPublic: false, publishedWorks: 0, groupCount: 0 },
    };
  }

  const followRows = await db
    .select({ followerUserId: followsTable.followerUserId, createdAt: followsTable.createdAt })
    .from(followsTable)
    .where(eq(followsTable.profileId, profile.id))
    .orderBy(asc(followsTable.createdAt));

  const fans = dedupeFollows(followRows);
  const fanCards = new Map<string, First100FanCard>();
  const firstHundredIds = fans.slice(0, FIRST100_GOAL).map((f) => f.followerUserId);
  if (firstHundredIds.length > 0) {
    const cards = await db
      .select({
        userId: creatorProfilesTable.userId,
        displayName: creatorProfilesTable.displayName,
        slug: creatorProfilesTable.slug,
        avatarUrl: creatorProfilesTable.avatarUrl,
      })
      .from(creatorProfilesTable)
      .where(inArray(creatorProfilesTable.userId, firstHundredIds));
    for (const c of cards) {
      fanCards.set(c.userId, { displayName: c.displayName, slug: c.slug, avatarUrl: c.avatarUrl });
    }
  }

  const [tracks, videos, memberships] = await Promise.all([
    db.select({ id: profileTracksTable.id, isPublished: profileTracksTable.isPublished }).from(profileTracksTable)
      .where(eq(profileTracksTable.profileId, profile.id)),
    db.select({ id: profileVideosTable.id, isPublished: profileVideosTable.isPublished }).from(profileVideosTable)
      .where(eq(profileVideosTable.profileId, profile.id)),
    db.select({ groupId: groupMembersTable.groupId }).from(groupMembersTable)
      .where(eq(groupMembersTable.userId, userId)),
  ]);
  const publishedWorks =
    tracks.filter((t) => t.isPublished).length + videos.filter((v) => v.isPublished).length;

  return {
    follows: followRows,
    fanCards,
    facts: {
      hasProfile: true,
      profileComplete:
        profile.bio.trim().length > 0 && !!profile.avatarUrl && profile.displayName.trim().length > 0,
      isPublic: profile.isPublic,
      publishedWorks,
      groupCount: memberships.length,
    },
  };
}

async function loadStateFromDb(userId: string): Promise<First100PersistedState> {
  const [row] = await db
    .select()
    .from(first100StateTable)
    .where(eq(first100StateTable.userId, userId))
    .limit(1);
  if (!row) return { celebrated: [], dismissedAt: null, snoozeUntil: null, completedAt: null };
  return {
    celebrated: Array.isArray(row.celebratedMilestones) ? row.celebratedMilestones : [],
    dismissedAt: row.dismissedAt,
    snoozeUntil: row.snoozeUntil,
    completedAt: row.completedAt,
  };
}

export const dbFirst100Store: First100Store = {
  loadSources: loadSourcesFromDb,
  loadState: loadStateFromDb,
  async saveCelebrated(userId, celebrated, completedAt) {
    await db
      .insert(first100StateTable)
      .values({ userId, celebratedMilestones: celebrated, completedAt })
      .onConflictDoUpdate({
        target: first100StateTable.userId,
        set: { celebratedMilestones: celebrated, completedAt, updatedAt: new Date() },
      });
  },
  async saveDismissal(userId, dismissedAt, snoozeUntil) {
    await db
      .insert(first100StateTable)
      .values({ userId, dismissedAt, snoozeUntil })
      .onConflictDoUpdate({
        target: first100StateTable.userId,
        set: { dismissedAt, snoozeUntil, updatedAt: new Date() },
      });
  },
  async notify(userId, milestone) {
    const copy = celebrationCopy(milestone);
    await db.insert(notificationsTable).values({
      userId,
      kind: FIRST100_NOTIFICATION_KIND,
      title: copy.title,
      body: copy.body,
      link: "/dashboard",
    });
  },
};

/* ─── Service ────────────────────────────────────────────────────── */

export async function getFirst100Status(
  userId: string,
  store: First100Store = dbFirst100Store,
  now: Date = new Date(),
): Promise<First100Status> {
  const [sources, state] = await Promise.all([store.loadSources(userId), store.loadState(userId)]);
  return buildFirst100Status({ sources, state, now });
}

/**
 * Fire the recognition for every milestone reached but not yet
 * celebrated, then record them celebrated. Exactly-once rests on
 * planCelebrations + the persisted celebrated set: a milestone is
 * notified only while it is pending, and it leaves pending the
 * moment its notification lands. A notification that fails to send
 * is NOT marked celebrated, so a later call retries it.
 */
export async function celebrateFirst100(
  userId: string,
  store: First100Store = dbFirst100Store,
  now: Date = new Date(),
): Promise<First100Status> {
  const [sources, state] = await Promise.all([store.loadSources(userId), store.loadState(userId)]);
  const fanCount = dedupeFollows(sources.follows).length;
  const pending = planCelebrations(fanCount, state.celebrated);
  if (pending.length === 0) {
    return buildFirst100Status({ sources, state, now });
  }
  const sent: number[] = [];
  for (const milestone of pending) {
    try {
      await store.notify(userId, milestone);
      sent.push(milestone);
    } catch (err) {
      logger.error({ err, userId, milestone }, "[first100] celebration notification failed");
    }
  }
  if (sent.length > 0) {
    const celebrated = [...new Set([...state.celebrated, ...sent])].sort((a, b) => a - b);
    const completedAt =
      state.completedAt ?? (fanCount >= FIRST100_GOAL ? now : null);
    await store.saveCelebrated(userId, celebrated, completedAt);
    return buildFirst100Status({
      sources,
      state: { ...state, celebrated, completedAt },
      now,
    });
  }
  return buildFirst100Status({ sources, state, now });
}

/** Dismiss the card: snooze for FIRST100_SNOOZE_DAYS (smart law). */
export async function dismissFirst100(
  userId: string,
  store: First100Store = dbFirst100Store,
  now: Date = new Date(),
): Promise<First100Status> {
  const snoozeUntil = new Date(now.getTime() + FIRST100_SNOOZE_DAYS * 24 * 60 * 60 * 1000);
  await store.saveDismissal(userId, now, snoozeUntil);
  const [sources, state] = await Promise.all([store.loadSources(userId), store.loadState(userId)]);
  return buildFirst100Status({ sources, state: { ...state, dismissedAt: now, snoozeUntil }, now });
}
