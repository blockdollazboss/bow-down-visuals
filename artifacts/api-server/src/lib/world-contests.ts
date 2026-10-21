/**
 * world-contests.ts — World Contests + the Winners' Circle
 * (UPGRADE-PROGRAM 2.24, migration 0158).
 *
 * THE SHAPE: a contest is an EVENT on the palace backbone — a
 * world_events row of kind 'contest' (lib/world-events carries the
 * booking, the public slate and the scheduler's status flips).
 * Its [starts_at, ends_at) window is the ENTRY window: entries
 * open when the contest is created (starts_at = creation) and the
 * deadline is ends_at. The payload is { theme }. What an event row
 * can't hold lives in two tables (lib/db world-contests):
 * world_contest_entries (one member, one work — the UNIQUE is the
 * rule) and world_contest_winners (the honor, frozen with name +
 * work-title snapshots at decision time).
 *
 * THE RULES (v1, honest and simple):
 *  - STAGES: the Throne Hall (world:kings-hall) or the Music Hall
 *    (world:music-hall) — the palace's two stages, nothing else.
 *  - HOSTING mirrors the palace's standing rules for those rooms:
 *    a Throne Hall contest is hosted by a Front Row member (the
 *    King's court — server truth via isKingFrontRowMember) or the
 *    house; a Music Hall contest by any signed-in member. That
 *    makes the Front Row the palace's natural judges: for a Throne
 *    Hall contest the host IS Front Row.
 *  - ENTERING: a member enters ONE of their own PUBLISHED works —
 *    a profile track or a profile video — per contest. Someone
 *    else's work, an unpublished work, a late entry and a second
 *    entry are each refused with the plain reason.
 *  - JUDGING: when the window closes, the HOST (or the house)
 *    names up to three winners from the entries — first, second,
 *    third. No vote math, no invented scores: a named human with
 *    standing picked them, and the record says who decided. One
 *    decision stands forever (no re-judging).
 *  - THE PRIZE is the honor itself: a palace-wide announcement
 *    when the winners land, and a permanent line on the Winners'
 *    Circle board. NO Visual Bucs move for a win in v1 — no prize
 *    rail is invented here.
 *  - A contest holds NO stage: it is a standing competition on the
 *    room's board, so the events route's one-room-one-event rule
 *    exempts contests (a days-long entry window must never lock
 *    the Throne Hall's stage), and the scheduler only flips a
 *    contest's status with its window — it drives no room state.
 *
 * Guests read everything (contests, entries, the Circle) and can
 * enter nothing: entering and hosting are authed routes, full stop.
 */
import {
  CONTEST_MAX_PLACES,
  type WorldContestWinner,
  type WorldEvent,
} from "@workspace/db";
import { WORLD_ROOM_ID, type PalaceAnnouncement } from "./world-room";
import { EVENT_MAX_AHEAD_MS, MUSIC_HALL_ROOM_ID, type BookingPrivilege } from "./world-events";

/* ── Stages + hosting ───────────────────────────────────────────── */

export const THRONE_HALL_ROOM_ID = WORLD_ROOM_ID; // "world:kings-hall"

export const CONTEST_ROOM_IDS: readonly string[] = [THRONE_HALL_ROOM_ID, MUSIC_HALL_ROOM_ID];

export function isContestRoom(roomId: string): boolean {
  return CONTEST_ROOM_IDS.includes(roomId);
}

/** Who may host a contest on this stage — the palace's own standing
 *  rules for the room, reused (Throne Hall stage = Front Row + the
 *  house; Music Hall = any member). */
export function contestPrivilegeForRoom(roomId: string): BookingPrivilege {
  return roomId === THRONE_HALL_ROOM_ID ? "front-row-or-admin" : "member";
}

/* ── The entry window ───────────────────────────────────────────── */

/** Entries need real time to gather: a contest runs at least an
 *  hour, at most the events backbone's own 30-day horizon. */
export const CONTEST_MIN_WINDOW_MS = 3_600_000;

export function contestDeadlineError(now: Date, endsAt: Date): string | null {
  const span = endsAt.getTime() - now.getTime();
  if (!(span > 0)) return "That deadline is already past.";
  if (span < CONTEST_MIN_WINDOW_MS) {
    return "A contest needs at least an hour for entries — set the deadline further out.";
  }
  if (span > EVENT_MAX_AHEAD_MS) return "A contest deadline is at most 30 days out.";
  return null;
}

/* ── Phase (pure) ───────────────────────────────────────────────── */

export type ContestPhase = "announced" | "open" | "judging" | "decided" | "called-off";

/**
 * Where a contest stands, from its event row + whether winners
 * stand. `decided` (the route overlays it when winner rows exist)
 * outranks the clock: a decided contest is history, not judging.
 */
export function contestPhase(
  row: Pick<WorldEvent, "status" | "startsAt" | "endsAt">,
  now: Date,
  decided: boolean,
): ContestPhase {
  if (row.status === "cancelled") return "called-off";
  if (decided) return "decided";
  if (row.status === "done" || now.getTime() >= new Date(row.endsAt).getTime()) return "judging";
  if (now.getTime() >= new Date(row.startsAt).getTime()) return "open";
  return "announced";
}

/** Entries are taken while the window stands open: the contest is
 *  not cancelled, not done, and the deadline has not passed. */
export function contestAcceptsEntries(
  row: Pick<WorldEvent, "status" | "endsAt">,
  now: Date,
): boolean {
  return row.status !== "cancelled" && row.status !== "done" && now.getTime() < new Date(row.endsAt).getTime();
}

/* ── DTOs ───────────────────────────────────────────────────────── */

export interface WorldContestWinnerDto {
  id: string;
  entryId: string;
  userId: string;
  place: number;
  winnerName: string;
  workKind: "track" | "video";
  workTitle: string;
  decidedAt: string;
}

export function toContestWinnerDto(row: WorldContestWinner): WorldContestWinnerDto {
  return {
    id: row.id,
    entryId: row.entryId,
    userId: row.userId,
    place: row.place,
    winnerName: row.winnerName,
    workKind: row.workKind === "video" ? "video" : "track",
    workTitle: row.workTitle,
    decidedAt: new Date(row.createdAt).toISOString(),
  };
}

export interface WorldContestEntryDto {
  id: string;
  userId: string;
  entrantName: string;
  workKind: "track" | "video";
  workTitle: string;
  createdAt: string;
}

export interface WorldContestDto {
  id: string;
  title: string;
  theme: string;
  roomId: string;
  hostUserId: string;
  hostName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  phase: ContestPhase;
  entryCount: number;
  winners: WorldContestWinnerDto[];
}

/** One line on the Winners' Circle board: the honor, the work, the
 *  contest it came from, and when it landed. Built to dock onto
 *  the court record (season marks) at integration. */
export interface WinnersCircleHonorDto {
  id: string;
  place: number;
  winnerName: string;
  workKind: "track" | "video";
  workTitle: string;
  contestId: string;
  contestTitle: string;
  roomId: string;
  decidedAt: string;
}

export function toWinnersCircleHonorDto(
  row: WorldContestWinner,
  contest: Pick<WorldEvent, "id" | "title" | "roomId">,
): WinnersCircleHonorDto {
  return {
    id: row.id,
    place: row.place,
    winnerName: row.winnerName,
    workKind: row.workKind === "video" ? "video" : "track",
    workTitle: row.workTitle,
    contestId: contest.id,
    contestTitle: contest.title,
    roomId: contest.roomId,
    decidedAt: new Date(row.createdAt).toISOString(),
  };
}

/* ── The announcement ───────────────────────────────────────────── */

/** Shrink a quoted piece to fit the palace's 140-character ear. */
function quoted(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * The winners' headline, in plain words, inside the announce
 * channel's 140 characters: who took first, in what contest, with
 * what work. kind "show" — a stage moment — so the client's
 * existing banner/log treatment carries it unchanged.
 */
export function contestWinnersAnnouncement(
  contest: Pick<WorldEvent, "title" | "roomId">,
  winners: readonly WorldContestWinnerDto[],
): PalaceAnnouncement | null {
  const first = [...winners].sort((a, b) => a.place - b.place)[0];
  if (!first) return null;
  const text = `The Winners' Circle grows: ${quoted(first.winnerName, 24)} takes first in “${quoted(
    contest.title,
    30,
  )}” with “${quoted(first.workTitle, 30)}”.`;
  return {
    kind: "show",
    text: text.slice(0, 140),
    roomId: contest.roomId,
    name: first.winnerName,
  };
}

/* ── The announce hook ──────────────────────────────────────────── */

/**
 * The palace instance lives with the socket layer (routes/world);
 * REST routes hold no reference to it. Boot registers the palace's
 * own announce() here (index.ts, next to the scheduler starts) and
 * the contests route speaks through it after the winners land.
 * Unregistered (tests, a palace-less boot) the announcement is
 * simply not spoken — the Winners' Circle rows are the durable
 * record either way; the herald is the moment, not the proof.
 */
export type WorldContestAnnouncer = (announcement: PalaceAnnouncement) => void;

let announcer: WorldContestAnnouncer | null = null;

export function registerWorldContestAnnouncer(fn: WorldContestAnnouncer | null): void {
  announcer = fn;
}

/** Speak a winners' announcement if the palace is wired.
 *  Returns true when the line was spoken. */
export function announceContestWinners(announcement: PalaceAnnouncement): boolean {
  if (!announcer) return false;
  announcer(announcement);
  return true;
}

export { CONTEST_MAX_PLACES };
