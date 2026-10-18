/**
 * contests.ts — World Contests + the Winners' Circle (UPGRADE-
 * PROGRAM 2.24): the client seam for the palace's standing
 * competitions, pure and unit-tested.
 *
 * The server owns the truth (routes/world-contests): a contest is
 * a palace event on a stage (Throne Hall or Music Hall) with a
 * theme and a deadline; a member enters ONE of their own published
 * works; when the window closes the host names up to three
 * winners; the honor lands on the Winners' Circle and is
 * announced palace-wide. This module owns the wire shapes
 * (defensive normalization — DTO drift is this repo's #1 bug
 * family), the request builders, the phase/stage/place words,
 * and the mapping from the server's refusal codes to the plain
 * reason the panel shows. Nothing here invents a standing: "my
 * entry" is derived from the public entries list against the
 * signed-in member's own id, never claimed.
 */
import { MUSIC_HALL_ID, HALL_ROOM_ID } from "./palace-layout";

export type ContestPhase = "announced" | "open" | "judging" | "decided" | "called-off";
export type ContestWorkKind = "track" | "video";

export interface WorldContestWinner {
  id: string;
  entryId: string;
  userId: string;
  place: number;
  winnerName: string;
  workKind: ContestWorkKind;
  workTitle: string;
  decidedAt: string;
}

export interface WorldContest {
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
  winners: WorldContestWinner[];
}

export interface WorldContestEntry {
  id: string;
  userId: string;
  entrantName: string;
  workKind: ContestWorkKind;
  workTitle: string;
  createdAt: string;
}

export interface WinnersCircleHonor {
  id: string;
  place: number;
  winnerName: string;
  workKind: ContestWorkKind;
  workTitle: string;
  contestId: string;
  contestTitle: string;
  roomId: string;
  decidedAt: string;
}

export interface MyContestWork {
  id: string;
  workKind: ContestWorkKind;
  title: string;
  isPublished: boolean;
}

/* ── Defensive reading ──────────────────────────────────────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function workKind(v: unknown): ContestWorkKind {
  return v === "video" ? "video" : "track";
}
const PHASES: readonly string[] = ["announced", "open", "judging", "decided", "called-off"];
function phase(v: unknown, status: string): ContestPhase {
  if (typeof v === "string" && PHASES.includes(v)) return v as ContestPhase;
  return status === "cancelled" ? "called-off" : "open";
}

function winner(v: unknown): WorldContestWinner | null {
  if (!isRecord(v)) return null;
  const id = str(v.id);
  const entryId = str(v.entryId);
  if (!id || !entryId) return null;
  return {
    id,
    entryId,
    userId: str(v.userId),
    place: num(v.place),
    winnerName: str(v.winnerName, "Creator"),
    workKind: workKind(v.workKind),
    workTitle: str(v.workTitle, "Untitled work"),
    decidedAt: str(v.decidedAt),
  };
}

function contest(v: unknown): WorldContest | null {
  if (!isRecord(v)) return null;
  const id = str(v.id);
  const title = str(v.title);
  if (!id || !title) return null;
  const status = str(v.status, "scheduled");
  const winners = Array.isArray(v.winners)
    ? v.winners.map(winner).filter((w): w is WorldContestWinner => w !== null)
    : [];
  return {
    id,
    title,
    theme: str(v.theme),
    roomId: str(v.roomId),
    hostUserId: str(v.hostUserId),
    hostName: str(v.hostName, "Creator"),
    startsAt: str(v.startsAt),
    endsAt: str(v.endsAt),
    status,
    phase: phase(v.phase, status),
    entryCount: num(v.entryCount),
    winners: [...winners].sort((a, b) => a.place - b.place),
  };
}

function entry(v: unknown): WorldContestEntry | null {
  if (!isRecord(v)) return null;
  const id = str(v.id);
  if (!id) return null;
  return {
    id,
    userId: str(v.userId),
    entrantName: str(v.entrantName, "Creator"),
    workKind: workKind(v.workKind),
    workTitle: str(v.workTitle, "Untitled work"),
    createdAt: str(v.createdAt),
  };
}

/** GET /api/world/contests → the board list. */
export function normalizeContests(raw: unknown): WorldContest[] {
  const list = isRecord(raw) && Array.isArray(raw.contests) ? raw.contests : [];
  return list.map(contest).filter((c): c is WorldContest => c !== null);
}

/** GET /api/world/contests/:id → one contest + its entries. */
export function normalizeContestDetail(
  raw: unknown,
): { contest: WorldContest; entries: WorldContestEntry[] } | null {
  if (!isRecord(raw)) return null;
  const c = contest(raw.contest);
  if (!c) return null;
  const entries = Array.isArray(raw.entries)
    ? raw.entries.map(entry).filter((e): e is WorldContestEntry => e !== null)
    : [];
  return { contest: c, entries };
}

/** GET /api/world/winners-circle → every honor, newest decision first. */
export function normalizeWinnersCircle(raw: unknown): WinnersCircleHonor[] {
  const list = isRecord(raw) && Array.isArray(raw.honors) ? raw.honors : [];
  const out: WinnersCircleHonor[] = [];
  for (const v of list) {
    if (!isRecord(v)) continue;
    const id = str(v.id);
    if (!id) continue;
    out.push({
      id,
      place: num(v.place),
      winnerName: str(v.winnerName, "Creator"),
      workKind: workKind(v.workKind),
      workTitle: str(v.workTitle, "Untitled work"),
      contestId: str(v.contestId),
      contestTitle: str(v.contestTitle, "Contest"),
      roomId: str(v.roomId),
      decidedAt: str(v.decidedAt),
    });
  }
  return out;
}

/** GET /api/world/contests/my-works → the caller's own works. */
export function normalizeMyWorks(raw: unknown): MyContestWork[] {
  const list = isRecord(raw) && Array.isArray(raw.works) ? raw.works : [];
  const out: MyContestWork[] = [];
  for (const v of list) {
    if (!isRecord(v)) continue;
    const id = str(v.id);
    if (!id) continue;
    out.push({
      id,
      workKind: workKind(v.workKind),
      title: str(v.title, "Untitled work"),
      isPublished: v.isPublished === true,
    });
  }
  return out;
}

/* ── Words ──────────────────────────────────────────────────────── */

export function contestStageName(roomId: string): string {
  if (roomId === HALL_ROOM_ID) return "Throne Hall";
  if (roomId === MUSIC_HALL_ID) return "Music Hall";
  return "The Palace";
}

export function contestPhaseLabel(p: ContestPhase): string {
  switch (p) {
    case "announced":
      return "Announced";
    case "open":
      return "Taking entries";
    case "judging":
      return "With the judges";
    case "decided":
      return "Decided";
    case "called-off":
      return "Called off";
  }
}

export function placeLabel(place: number): string {
  if (place === 1) return "First place";
  if (place === 2) return "Second place";
  if (place === 3) return "Third place";
  return `Place ${place}`;
}

/** "Entries close Fri, Oct 23, 8:00 PM" while the window stands;
 *  after it, the plain past tense. */
export function contestDeadlineLine(c: Pick<WorldContest, "endsAt" | "phase">, nowMs: number): string {
  const ends = Date.parse(c.endsAt);
  if (!Number.isFinite(ends)) return "";
  const when = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ends));
  if (c.phase === "decided") return `Decided — entries closed ${when}`;
  if (c.phase === "judging" || ends <= nowMs) return `Entries closed ${when}`;
  return `Entries close ${when}`;
}

/** The signed-in member's own entry, derived from the public
 *  entries list — never claimed, always computed. */
export function myContestEntry(
  entries: readonly WorldContestEntry[],
  userId: string | null | undefined,
): WorldContestEntry | null {
  if (!userId) return null;
  return entries.find((e) => e.userId === userId) ?? null;
}

/* ── Request builders (pure) ────────────────────────────────────── */

export function buildContestBody(input: {
  title: string;
  theme: string;
  roomId: string;
  endsAtIso: string;
}): { title: string; theme: string; roomId: string; endsAt: string } {
  return {
    title: input.title.trim(),
    theme: input.theme.trim(),
    roomId: input.roomId,
    endsAt: input.endsAtIso,
  };
}

export function buildEntryBody(work: Pick<MyContestWork, "id" | "workKind">): {
  workKind: ContestWorkKind;
  workId: string;
} {
  return { workKind: work.workKind, workId: work.id };
}

/** Podium order is array order: first place first. Blank slots
 *  (the host left a place empty) drop out; duplicates collapse. */
export function buildWinnersBody(entryIdsInPodiumOrder: readonly (string | null)[]): {
  entryIds: string[];
} {
  const seen = new Set<string>();
  const entryIds: string[] = [];
  for (const id of entryIdsInPodiumOrder) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    entryIds.push(id);
  }
  return { entryIds };
}

/* ── The server's refusals, in its own words ────────────────────── */

/** A refused contest call: the route's plain-words message is the
 *  copy; the code rides along for tests and logs. */
export class ContestApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const FALLBACK_COPY: Record<string, string> = {
  FRONT_ROW_REQUIRED: "Throne Hall contests are hosted by Front Row members and the house.",
  NOT_A_STAGE: "Contests run on a stage: the Throne Hall or the Music Hall.",
  INVALID_DEADLINE: "That deadline doesn't work — a contest needs at least an hour, at most 30 days.",
  ENTRIES_CLOSED: "Entries closed at the deadline — this contest is with the judges now.",
  ALREADY_ENTERED: "You've already entered this contest — one entry each.",
  NOT_PUBLISHED: "That work isn't published yet — publish it first, then enter it.",
  WORK_NOT_FOUND: "That work isn't on your profile — you can only enter your own work.",
  NOT_THE_HOST: "Only the contest's host or the house names the winners.",
  STILL_OPEN: "Judging opens when the entry window closes.",
  ALREADY_DECIDED: "The winners already stand in the Winners' Circle.",
  ENTRY_NOT_IN_CONTEST: "Every winner must be an entry in this contest.",
  CONTEST_CALLED_OFF: "This contest was called off.",
  NO_PROFILE: "You need a creator profile to enter a contest.",
  NOT_FOUND: "No such contest.",
};

export function contestErrorCopy(code: string | null | undefined, serverMessage?: string): string {
  if (serverMessage && serverMessage.trim()) return serverMessage;
  if (code && FALLBACK_COPY[code]) return FALLBACK_COPY[code]!;
  return "The palace couldn't do that just now — try again.";
}

/* ── Fetchers ───────────────────────────────────────────────────── */

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function authedPost(
  token: string,
  path: string,
  body: unknown,
): Promise<unknown> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await readJson(res);
  if (!res.ok) {
    const rec = isRecord(json) ? json : {};
    throw new ContestApiError(
      str(rec.error, "FAILED"),
      contestErrorCopy(str(rec.error), str(rec.message)),
    );
  }
  return json;
}

export async function fetchContests(signal?: AbortSignal): Promise<WorldContest[]> {
  const res = await fetch("/api/world/contests", { signal });
  if (!res.ok) throw new Error(`contests ${res.status}`);
  return normalizeContests(await readJson(res));
}

export async function fetchContestDetail(
  id: string,
  signal?: AbortSignal,
): Promise<{ contest: WorldContest; entries: WorldContestEntry[] } | null> {
  const res = await fetch(`/api/world/contests/${encodeURIComponent(id)}`, { signal });
  if (!res.ok) throw new Error(`contest ${res.status}`);
  return normalizeContestDetail(await readJson(res));
}

export async function fetchWinnersCircle(signal?: AbortSignal): Promise<WinnersCircleHonor[]> {
  const res = await fetch("/api/world/winners-circle", { signal });
  if (!res.ok) throw new Error(`winners circle ${res.status}`);
  return normalizeWinnersCircle(await readJson(res));
}

export async function fetchMyContestWorks(token: string): Promise<MyContestWork[]> {
  const res = await fetch("/api/world/contests/my-works", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`my works ${res.status}`);
  return normalizeMyWorks(await readJson(res));
}

export async function hostContest(
  token: string,
  body: ReturnType<typeof buildContestBody>,
): Promise<WorldContest | null> {
  const json = await authedPost(token, "/api/world/contests", body);
  return isRecord(json) ? contest(json.contest) : null;
}

export async function enterContestWork(
  token: string,
  contestId: string,
  work: Pick<MyContestWork, "id" | "workKind">,
): Promise<void> {
  await authedPost(
    token,
    `/api/world/contests/${encodeURIComponent(contestId)}/entries`,
    buildEntryBody(work),
  );
}

export async function nameContestWinners(
  token: string,
  contestId: string,
  entryIdsInPodiumOrder: readonly (string | null)[],
): Promise<void> {
  await authedPost(
    token,
    `/api/world/contests/${encodeURIComponent(contestId)}/winners`,
    buildWinnersBody(entryIdsInPodiumOrder),
  );
}
