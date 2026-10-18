/**
 * objective-strip.ts — the Objective Strip's slot logic (THE-GAME
 * §5(a), Lane K2): what the always-pinned strip in the world chrome
 * NAMES as the next thing, for each of its three slots.
 *
 * Every input is server truth, read off the rails the site already
 * runs — nothing here invents a number:
 *
 *   QUEST  — GET /api/retention/quests (the same payload Lane B's
 *            Quest Board reads): the first CLAIMABLE quest wins
 *            (it is finished — the next thing is claiming it, in
 *            the Treasury), else the first incomplete quest in
 *            catalog order, named with its progress and the room /
 *            station questDestination() says it completes in.
 *   STREAK — GET /api/retention/streak: the creation-streak rail.
 *            Its `milestones` array (STREAK_MILESTONES server-side:
 *            days → VB, each reached/claimed flagged by the server)
 *            names the next step: a reached-but-unclaimed milestone
 *            is claimable; otherwise the next unreached milestone
 *            and the days left to it.
 *   PALACE — Lane H's slate: GET /api/world/events
 *            (fetchWorldEvents) and/or the directory frame's
 *            per-room events[]. A LIVE event wins; otherwise the
 *            soonest event that hasn't ended; otherwise the slot
 *            says "Nothing on the palace slate" plainly.
 *
 * The strip ALWAYS names the next thing for a member — a slot that
 * came back off / done / empty says so in words, never a blank.
 * Guests hold no hand (access law, owner default 3): they get no
 * quest or streak slot at all — see guest-honest.ts.
 *
 * All shaping is pure and total: a malformed payload normalizes to
 * null and the strip renders its honest loading/error line, never
 * half-invented rows.
 */

import {
  questDestination,
  questObjective,
  type QuestDestination,
  type QuestObjective,
} from "./treasury-quests";

/* ─── Shared guards (the treasury-quests normalization style) ────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/* ─── QUEST slot: /api/retention/quests ──────────────────────────── */

export interface QuestStatusRow {
  key: string;
  target: number;
  reward: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

export interface QuestsStatusShape {
  enabled: boolean;
  weekStart: string;
  quests: QuestStatusRow[];
}

export function normalizeQuestsStatus(raw: unknown): QuestsStatusShape | null {
  if (!isRecord(raw) || !Array.isArray(raw.quests)) return null;
  const quests: QuestStatusRow[] = [];
  for (const q of raw.quests) {
    if (!isRecord(q)) return null;
    const key = str(q.key);
    const target = num(q.target);
    const reward = num(q.reward);
    const progress = num(q.progress);
    if (!key || target === null || reward === null || progress === null) return null;
    quests.push({
      key,
      target,
      reward,
      progress,
      completed: q.completed === true,
      claimed: q.claimed === true,
    });
  }
  return {
    enabled: raw.enabled !== false,
    weekStart: typeof raw.weekStart === "string" ? raw.weekStart : "",
    quests,
  };
}

export type NextObjective =
  /** Finished, unclaimed: the next thing is the claim (in the Treasury). */
  | {
      kind: "claimable";
      quest: QuestStatusRow;
      objective: QuestObjective;
      destination: QuestDestination | null;
    }
  /** The first quest not yet finished, in catalog order. */
  | {
      kind: "active";
      quest: QuestStatusRow;
      objective: QuestObjective;
      destination: QuestDestination | null;
    }
  /** Every quest claimed — the next slate is next week's. */
  | { kind: "all-done" }
  /** The member switched quests off — said plainly, never faked. */
  | { kind: "off" }
  /** The rail answered with an empty catalog — nothing to name. */
  | { kind: "none" };

export function nextObjective(status: QuestsStatusShape): NextObjective {
  if (!status.enabled) return { kind: "off" };
  if (status.quests.length === 0) return { kind: "none" };
  const claimable = status.quests.find((q) => q.completed && !q.claimed);
  if (claimable) {
    return {
      kind: "claimable",
      quest: claimable,
      objective: questObjective(claimable),
      destination: questDestination(claimable.key),
    };
  }
  const active = status.quests.find((q) => !q.completed && !q.claimed);
  if (active) {
    return {
      kind: "active",
      quest: active,
      objective: questObjective(active),
      destination: questDestination(active.key),
    };
  }
  return { kind: "all-done" };
}

/** The plain place-name a destination reads as in the strip:
 *  a station names its desk and its room; a transfer names the
 *  website door it honestly points at. Unknown quests (destination
 *  null) fall back to the Treasury, where the board lives. */
export function destinationLabel(destination: QuestDestination | null): string {
  if (!destination) return "the Treasury";
  if (destination.kind === "station") {
    return `the ${destination.stationName} in ${destination.roomName}`;
  }
  return "the website";
}

/* ─── STREAK slot: /api/retention/streak ─────────────────────────── */

export interface StreakMilestoneShape {
  days: number;
  reward: number;
  reached: boolean;
  claimed: boolean;
}

export interface StreakStatusShape {
  enabled: boolean;
  currentStreak: number;
  longestStreak: number;
  lastCreationDate: string | null;
  milestonesClaimed: number[];
  milestones: StreakMilestoneShape[];
  /** The server's own next-milestone pointer (first unclaimed). */
  nextMilestone: { days: number; reward: number } | null;
}

export function normalizeStreakStatus(raw: unknown): StreakStatusShape | null {
  if (!isRecord(raw) || !Array.isArray(raw.milestones)) return null;
  const currentStreak = num(raw.currentStreak);
  if (currentStreak === null) return null;
  const milestones: StreakMilestoneShape[] = [];
  for (const m of raw.milestones) {
    if (!isRecord(m)) return null;
    const days = num(m.days);
    const reward = num(m.reward);
    if (days === null || reward === null) return null;
    milestones.push({
      days,
      reward,
      reached: m.reached === true,
      claimed: m.claimed === true,
    });
  }
  milestones.sort((a, b) => a.days - b.days);
  const claimedList = Array.isArray(raw.milestonesClaimed)
    ? raw.milestonesClaimed.filter((d): d is number => typeof d === "number" && Number.isFinite(d))
    : [];
  let nextMilestone: StreakStatusShape["nextMilestone"] = null;
  if (isRecord(raw.nextMilestone)) {
    const days = num(raw.nextMilestone.days);
    const reward = num(raw.nextMilestone.reward);
    if (days !== null && reward !== null) nextMilestone = { days, reward };
  }
  return {
    enabled: raw.enabled !== false,
    currentStreak: currentStreak,
    longestStreak: num(raw.longestStreak) ?? currentStreak,
    lastCreationDate: typeof raw.lastCreationDate === "string" ? raw.lastCreationDate : null,
    milestonesClaimed: claimedList,
    milestones,
    nextMilestone,
  };
}

export type NextStreakStep =
  /** A milestone the streak has reached but not claimed: its VB waits in the Treasury. */
  | { kind: "claimable"; milestone: StreakMilestoneShape; currentStreak: number }
  /** The next milestone ahead, and how many creation days remain. */
  | { kind: "upcoming"; milestone: StreakMilestoneShape; currentStreak: number; daysToGo: number }
  /** Every milestone claimed — the streak runs free now. */
  | { kind: "all-claimed"; currentStreak: number }
  /** The member switched streaks off. */
  | { kind: "off"; currentStreak: number };

export function nextStreakStep(status: StreakStatusShape): NextStreakStep {
  if (!status.enabled) return { kind: "off", currentStreak: status.currentStreak };
  const claimable = status.milestones.find((m) => m.reached && !m.claimed);
  if (claimable) {
    return { kind: "claimable", milestone: claimable, currentStreak: status.currentStreak };
  }
  const upcoming = status.milestones.find((m) => !m.reached && !m.claimed);
  if (upcoming) {
    return {
      kind: "upcoming",
      milestone: upcoming,
      currentStreak: status.currentStreak,
      daysToGo: Math.max(0, upcoming.days - status.currentStreak),
    };
  }
  return { kind: "all-claimed", currentStreak: status.currentStreak };
}

/* ─── PALACE slot: Lane H's slate ────────────────────────────────── */

export interface PalaceSlateEvent {
  id: string;
  kind: string;
  title: string;
  roomId: string;
  hostName: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "live";
}

function slateEvent(v: unknown): PalaceSlateEvent | null {
  if (!isRecord(v)) return null;
  if (v.status !== "scheduled" && v.status !== "live") return null;
  const id = str(v.id);
  const title = str(v.title);
  const startsAt = str(v.startsAt);
  const endsAt = str(v.endsAt);
  if (!id || !title || !startsAt || !endsAt) return null;
  return {
    id,
    kind: typeof v.kind === "string" ? v.kind : "",
    title,
    roomId: typeof v.roomId === "string" ? v.roomId : "",
    hostName: typeof v.hostName === "string" ? v.hostName : "",
    startsAt,
    endsAt,
    status: v.status,
  };
}

/** Normalize a GET /api/world/events payload (or its bare array). */
export function normalizeWorldEventSlate(raw: unknown): PalaceSlateEvent[] {
  const list = isRecord(raw) && Array.isArray(raw.events) ? raw.events : Array.isArray(raw) ? raw : null;
  if (!list) return [];
  const out: PalaceSlateEvent[] = [];
  for (const e of list) {
    const shaped = slateEvent(e);
    if (shaped) out.push(shaped);
  }
  return out;
}

/** Flatten the palace directory frame's per-room slate (the other
 *  Lane H read) into the same event shape — directory events carry
 *  their room on the parent row, not on the event itself. */
export function directorySlate(
  directory: { id: string; events?: unknown }[] | null | undefined,
): PalaceSlateEvent[] {
  if (!Array.isArray(directory)) return [];
  const out: PalaceSlateEvent[] = [];
  for (const room of directory) {
    if (!isRecord(room) || !Array.isArray(room.events)) continue;
    for (const e of room.events) {
      const shaped = slateEvent(e);
      if (shaped) out.push({ ...shaped, roomId: shaped.roomId || room.id });
    }
  }
  return out;
}

/** Merge two slate reads (REST + directory) by event id — the REST
 *  row wins on a clash (it carries the full DTO). */
export function mergeSlates(...slates: PalaceSlateEvent[][]): PalaceSlateEvent[] {
  const byId = new Map<string, PalaceSlateEvent>();
  for (const slate of slates) {
    for (const e of slate) if (!byId.has(e.id)) byId.set(e.id, e);
  }
  return [...byId.values()];
}

export type PalaceSlot =
  | { kind: "live"; event: PalaceSlateEvent }
  | { kind: "next"; event: PalaceSlateEvent }
  | { kind: "none" };

/** The palace slot's pick: a live event beats everything; else the
 *  soonest event that has not ended yet; else honestly nothing. */
export function pickPalaceSlot(events: PalaceSlateEvent[], nowMs: number): PalaceSlot {
  const live = events
    .filter((e) => e.status === "live")
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  if (live[0]) return { kind: "live", event: live[0] };
  const upcoming = events
    .filter((e) => e.status === "scheduled" && Date.parse(e.endsAt) > nowMs)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  if (upcoming[0]) return { kind: "next", event: upcoming[0] };
  return { kind: "none" };
}

/** "Today at the palace" (the Kingdom Board block): everything on
 *  today's slate — live events count as today's whatever their
 *  start date, scheduled ones only when they start today (the
 *  viewer's local day). Live first, then by start time. */
export function eventsToday(events: PalaceSlateEvent[], nowMs: number): PalaceSlateEvent[] {
  const now = new Date(nowMs);
  const sameDay = (iso: string) => {
    const d = new Date(iso);
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  };
  return events
    .filter((e) => e.status === "live" || sameDay(e.startsAt))
    .sort((a, b) => {
      if ((a.status === "live") !== (b.status === "live")) return a.status === "live" ? -1 : 1;
      return Date.parse(a.startsAt) - Date.parse(b.startsAt);
    });
}

/** A start time the strip can say out loud: "today at 7:30 PM",
 *  "tomorrow at 8:00 PM", or "Mon, Oct 19 at 7:30 PM". */
export function formatEventStart(iso: string, nowMs: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const now = new Date(nowMs);
  const dayOf = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (dayOf(d) === dayOf(now)) return `today at ${time}`;
  const tomorrow = new Date(nowMs + 86_400_000);
  if (dayOf(d) === dayOf(tomorrow)) return `tomorrow at ${time}`;
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${day} at ${time}`;
}

/** A clock time alone, for the board's today rows. */
export function formatEventTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/* ─── KINGDOM BOARD: standings shaping ───────────────────────────── */

export interface KingdomStandings {
  /** The weekly creation leaderboard's top rows (at most 5). */
  top: { rank: number; name: string; creations: number; exports: number; score: number; isYou: boolean }[];
  /** The viewer's own rank — ONLY when the rail reports one. */
  viewerRank: number | null;
  viewerScore: number;
  /** True when the viewer's own row is already inside the top 5. */
  viewerInTop: boolean;
}

/** Shape a normalized leaderboard (treasury-quests' guard over
 *  GET /api/retention/leaderboard) into the board's standings block.
 *  The endpoint carries NO Front Row field — there is deliberately
 *  no frontRow key here; the block names that gap instead of
 *  inventing a standing. */
export function kingdomStandings(board: {
  rows: KingdomStandings["top"];
  viewerRank: number | null;
  viewerScore: number;
}): KingdomStandings {
  const top = board.rows.slice(0, 5);
  return {
    top,
    viewerRank: board.viewerRank,
    viewerScore: board.viewerScore,
    viewerInTop: top.some((r) => r.isYou),
  };
}
