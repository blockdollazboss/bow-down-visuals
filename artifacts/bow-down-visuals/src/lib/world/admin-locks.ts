/**
 * admin-locks.ts — The World's admin lock verbs, client side
 * (items 92–93).
 *
 * The server has enforced the World's locks since Lane F
 * (WorldLockStore, migration 0179): a person lock refuses a named
 * member at one room's door, a door lock refuses everyone new
 * except admins. Until now only Thy Cheat Code's Tier-4 chat
 * commands could write that store, so the in-world surfaces could
 * SHOW a Locked pill but never lock or unlock anything. These are
 * the real client verbs for the REST surface in routes/world.ts:
 *
 *   GET  /api/world/locks               the standing locks
 *   POST /api/world/locks/door/lock     { roomId }
 *   POST /api/world/locks/door/unlock   { roomId }
 *   POST /api/world/locks/person/lock   { roomId, peerId? |
 *                                         targetName? | userId?,
 *                                         displayName?, minutes? }
 *   POST /api/world/locks/person/unlock { roomId, userId? | targetName? }
 *
 * PEACE LAW (hard): only ADMIN accounts fire these — the server
 * gates every verb fail-closed on ADMIN_EMAILS behind requireAuth
 * and rejects non-admin calls regardless of what a client shows.
 * The gating here (`canUseWorldLockVerbs`) is display honesty
 * only: non-admins never SEE the affordances, off the server-
 * resolved `admin` flag on the walker's own presence record —
 * never a client claim the server would trust.
 *
 * Framework-free like the rest of lib/world, so the verbs and the
 * gating are unit-tested in node with a fake fetch.
 */
import type { PalaceDirectoryEntry } from "./world-client";

/** One standing door lock, as GET /api/world/locks serves it. */
export interface WorldDoorLockDto {
  roomId: string;
  lockedByEmail: string | null;
  createdAt: string;
}

/** One standing person lock, as GET /api/world/locks serves it. */
export interface WorldPersonLockDto {
  roomId: string;
  userId: string;
  displayName: string;
  lockedByEmail: string | null;
  createdAt: string;
  expiresAt: string;
}

/** The standing locks, whole — the admin surface's read. */
export interface WorldLocksDto {
  doors: WorldDoorLockDto[];
  persons: WorldPersonLockDto[];
}

/** A person lock's default length and one-call ceiling — the
 *  same bounds the server applies (routes/world.ts): 1 hour
 *  default, 7 days max. The client clamps for display; the
 *  server clamps again for truth. */
export const WORLD_LOCK_DEFAULT_MINUTES = 60;
export const WORLD_LOCK_MAX_MINUTES = 7 * 24 * 60;

/** Pure: a requested lock length in minutes — absent/invalid
 *  reads as the default, anything else rounds and clamps to
 *  [1, WORLD_LOCK_MAX_MINUTES]. Mirrors the server's parse. */
export function worldLockMinutes(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return WORLD_LOCK_DEFAULT_MINUTES;
  }
  return Math.max(1, Math.min(Math.round(raw), WORLD_LOCK_MAX_MINUTES));
}

/** Display gating for every lock affordance: the walker's own
 *  presence record must carry the server-resolved admin flag,
 *  and a guest never counts (guests hold no account — the server
 *  would 401/403 them anyway). Non-admins never see the verbs. */
export function canUseWorldLockVerbs(
  self: { admin?: boolean; guest?: boolean } | null | undefined,
): boolean {
  return self?.admin === true && self?.guest !== true;
}

/** The door verb a room's directory row offers an admin: lock an
 *  open door, unlock a locked one. */
export function doorLockVerb(entry: Pick<PalaceDirectoryEntry, "locked">): "lock" | "unlock" {
  return entry.locked ? "unlock" : "lock";
}

/** The lock a person row offers to lift, when one stands on this
 *  member in this room — null when they're free to walk in. */
export function standingPersonLock(
  locks: WorldLocksDto | null | undefined,
  roomId: string,
  userId: string,
): WorldPersonLockDto | null {
  if (!locks) return null;
  return locks.persons.find((p) => p.roomId === roomId && p.userId === userId) ?? null;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** A refused verb: the server's own words + status + code, so a
 *  panel can show the honest reason instead of a silent failure. */
export class WorldLockVerbError extends Error {
  status: number;
  code: string | null;
  constructor(status: number, message: string, code: string | null) {
    super(message);
    this.name = "WorldLockVerbError";
    this.status = status;
    this.code = code;
  }
}

async function lockVerb<T>(
  path: string,
  token: string | null,
  body: Record<string, unknown> | null,
  fetchFn: FetchLike,
): Promise<T> {
  const res = await fetchFn(path, {
    method: body === null ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
  const parsed = (await res.json().catch(() => null)) as
    | (T & { error?: string; code?: string })
    | null;
  if (!res.ok) {
    throw new WorldLockVerbError(
      res.status,
      parsed?.error ?? `That lock didn't land — the palace answered ${res.status}.`,
      parsed?.code ?? null,
    );
  }
  if (!parsed) throw new WorldLockVerbError(res.status, "That lock didn't land — empty answer.", null);
  return parsed;
}

export interface WorldDoorLockResult {
  ok: boolean;
  door: { roomId: string; locked: boolean; createdAt?: string };
  /** The fresh directory after a door verb — the Locked pill's
   *  new truth, carried on the answer so the row updates at once. */
  rooms?: PalaceDirectoryEntry[];
}

export interface WorldPersonLockResult {
  ok: boolean;
  /** The target was standing in the room and is out now. */
  evicted?: boolean;
  person: {
    roomId: string;
    userId: string;
    displayName?: string;
    locked?: boolean;
    createdAt?: string;
    expiresAt?: string;
  };
}

/** Read the standing locks (admin only on the server). */
export async function fetchWorldLocks(
  token: string | null,
  fetchFn: FetchLike = fetch,
): Promise<WorldLocksDto> {
  const body = await lockVerb<{ doors?: WorldDoorLockDto[]; persons?: WorldPersonLockDto[] }>(
    "/api/world/locks",
    token,
    null,
    fetchFn,
  );
  return {
    doors: Array.isArray(body.doors) ? body.doors : [],
    persons: Array.isArray(body.persons) ? body.persons : [],
  };
}

/** Lock a room's door: people inside stay, nobody new joins. */
export function lockWorldDoor(
  token: string | null,
  roomId: string,
  fetchFn: FetchLike = fetch,
): Promise<WorldDoorLockResult> {
  return lockVerb("/api/world/locks/door/lock", token, { roomId }, fetchFn);
}

/** Unlock a room's door. */
export function unlockWorldDoor(
  token: string | null,
  roomId: string,
  fetchFn: FetchLike = fetch,
): Promise<WorldDoorLockResult> {
  return lockVerb("/api/world/locks/door/unlock", token, { roomId }, fetchFn);
}

export interface LockWorldPersonInput {
  roomId: string;
  /** A peer standing in the room (the host-panel roster's key). */
  peerId?: string;
  /** A display name to resolve against the room's presence. */
  targetName?: string;
  /** An account id — binds a member whether or not they're here. */
  userId?: string;
  /** Required by the server when the member isn't standing there. */
  displayName?: string;
  minutes?: number;
}

/** Lock a member out of a room for a time (default 1 hour, max 7
 *  days — clamped here for display, clamped again server-side). */
export function lockWorldPerson(
  token: string | null,
  input: LockWorldPersonInput,
  fetchFn: FetchLike = fetch,
): Promise<WorldPersonLockResult> {
  return lockVerb(
    "/api/world/locks/person/lock",
    token,
    {
      roomId: input.roomId,
      ...(input.peerId ? { peerId: input.peerId } : {}),
      ...(input.targetName ? { targetName: input.targetName } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.displayName ? { displayName: input.displayName } : {}),
      minutes: worldLockMinutes(input.minutes),
    },
    fetchFn,
  );
}

/** Lift a member's lock on a room early. */
export function unlockWorldPerson(
  token: string | null,
  input: { roomId: string; userId?: string; targetName?: string },
  fetchFn: FetchLike = fetch,
): Promise<WorldPersonLockResult> {
  return lockVerb(
    "/api/world/locks/person/unlock",
    token,
    {
      roomId: input.roomId,
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.targetName ? { targetName: input.targetName } : {}),
    },
    fetchFn,
  );
}
