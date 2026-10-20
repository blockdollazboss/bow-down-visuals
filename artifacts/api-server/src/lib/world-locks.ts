/* ─── The World's locks — the durable rail (Lane F, migration 0179) ──
   Two locks, both owner-ruled (Oct 20, 2026: "lock" = BOTH kinds),
   both worked by Thy Cheat Code ONLY on an admin account's command
   through the executor's Tier-4 gate — never on his own judgment:

   - PERSON LOCK: a named member locked out of one room for a time.
     The row in world_person_locks is the truth; the World's join
     path refuses them at that room's door until the time passes or
     an admin lifts it early. A rejoin or a restart never sheds it.
   - DOOR LOCK: a room's door locked. People inside stay, nobody
     new joins; the only bypass is an admin account (standing World
     law: the admin holds ALL controls always).

   This store is the single writer/reader. It keeps an in-memory
   mirror of both tables so the join path (WorldRoom.attach, which
   is synchronous) can ask its question without a DB round-trip:
   the mirror hydrates from the tables at boot (`load()`, wired in
   routes/world.ts registerWorldWs) and every mutation writes the
   table first, then the mirror — a crash between the two loses
   nothing durable, and the next boot rehydrates from the tables.

   The store implements the WorldLockChecker interface the rooms
   consult (lib/world-room.ts) — the rooms themselves stay free of
   any DB knowledge, exactly like every other palace rail. */

import { and, eq } from "drizzle-orm";
import {
  db,
  worldDoorLocksTable,
  worldPersonLocksTable,
} from "@workspace/db";
import type { WorldLockChecker } from "./world-room";
import { logger } from "./logger";

export interface WorldPersonLockState {
  roomId: string;
  userId: string;
  displayName: string;
  lockedByUserId: string;
  lockedByEmail: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface WorldDoorLockState {
  roomId: string;
  lockedByUserId: string;
  lockedByEmail: string | null;
  createdAt: number;
}

const personKey = (roomId: string, userId: string) => `${roomId}:${userId}`;

export class WorldLockStore implements WorldLockChecker {
  private personLocks = new Map<string, WorldPersonLockState>();
  private doorLocks = new Map<string, WorldDoorLockState>();

  /** Hydrate the mirror from the tables (boot). Expired person
   *  locks are not mirrored — and are deleted while we're here, so
   *  the table stays the size of the truth. A failed load leaves
   *  the mirror empty (no locks enforced) and logs loudly: the
   *  World's doors fail OPEN on a broken lock read rather than
   *  locking everyone out of the palace. */
  async load(now = Date.now()): Promise<void> {
    try {
      const personRows = await db.select().from(worldPersonLocksTable);
      this.personLocks.clear();
      for (const row of personRows) {
        const expiresAt = new Date(row.expiresAt).getTime();
        if (expiresAt <= now) {
          await db
            .delete(worldPersonLocksTable)
            .where(eq(worldPersonLocksTable.id, row.id))
            .catch(() => undefined);
          continue;
        }
        this.personLocks.set(personKey(row.roomId, row.userId), {
          roomId: row.roomId,
          userId: row.userId,
          displayName: row.displayName,
          lockedByUserId: row.lockedByUserId,
          lockedByEmail: row.lockedByEmail,
          createdAt: new Date(row.createdAt).getTime(),
          expiresAt,
        });
      }
      const doorRows = await db.select().from(worldDoorLocksTable);
      this.doorLocks.clear();
      for (const row of doorRows) {
        this.doorLocks.set(row.roomId, {
          roomId: row.roomId,
          lockedByUserId: row.lockedByUserId,
          lockedByEmail: row.lockedByEmail,
          createdAt: new Date(row.createdAt).getTime(),
        });
      }
    } catch (err) {
      logger.error({ err }, "[world] lock store load failed — no locks enforced until a successful reload");
      throw err;
    }
  }

  /* ── The checker the rooms consult (synchronous, mirror-only) ── */

  /** The moment this member's lock on this room lifts, or null
   *  when they may enter. An expired lock prunes itself here, so
   *  expiry frees the door even if nobody ever runs a cleanup. */
  personLockedUntil(roomId: string, userId: string, now: number): number | null {
    const lock = this.personLocks.get(personKey(roomId, userId));
    if (!lock) return null;
    if (lock.expiresAt <= now) {
      this.personLocks.delete(personKey(roomId, userId));
      return null;
    }
    return lock.expiresAt;
  }

  isDoorLocked(roomId: string): boolean {
    return this.doorLocks.has(roomId);
  }

  /* ── Reads for the operator + admin surfaces ─────────────────── */

  /** The member's live lock on a room (expiry-aware), or null. */
  personLock(roomId: string, userId: string, now = Date.now()): WorldPersonLockState | null {
    return this.personLockedUntil(roomId, userId, now) !== null
      ? this.personLocks.get(personKey(roomId, userId))!
      : null;
  }

  /** Every live person lock carrying this display name (the unlock
   *  command resolves by name while the person is — by definition
   *  — absent from the room). Case-insensitive exact match. */
  personLocksByName(displayName: string, now = Date.now()): WorldPersonLockState[] {
    const needle = displayName.trim().toLowerCase();
    if (!needle) return [];
    const out: WorldPersonLockState[] = [];
    for (const lock of [...this.personLocks.values()]) {
      if (this.personLockedUntil(lock.roomId, lock.userId, now) === null) continue;
      if (lock.displayName.trim().toLowerCase() === needle) out.push(lock);
    }
    return out;
  }

  doorLock(roomId: string): WorldDoorLockState | null {
    return this.doorLocks.get(roomId) ?? null;
  }

  /* ── Mutations (table first, then the mirror) ────────────────── */

  /** Lock a member out of a room for `minutes`. Re-locking replaces
   *  the standing row — the newest admin command is the truth. */
  async lockPerson(input: {
    roomId: string;
    userId: string;
    displayName: string;
    lockedByUserId: string;
    lockedByEmail?: string | null;
    minutes: number;
    now?: number;
  }): Promise<WorldPersonLockState> {
    const now = input.now ?? Date.now();
    const state: WorldPersonLockState = {
      roomId: input.roomId,
      userId: input.userId,
      displayName: input.displayName,
      lockedByUserId: input.lockedByUserId,
      lockedByEmail: input.lockedByEmail ?? null,
      createdAt: now,
      expiresAt: now + input.minutes * 60_000,
    };
    await db
      .delete(worldPersonLocksTable)
      .where(
        and(
          eq(worldPersonLocksTable.roomId, input.roomId),
          eq(worldPersonLocksTable.userId, input.userId),
        ),
      );
    await db.insert(worldPersonLocksTable).values({
      roomId: state.roomId,
      userId: state.userId,
      displayName: state.displayName,
      lockedByUserId: state.lockedByUserId,
      lockedByEmail: state.lockedByEmail,
      createdAt: new Date(state.createdAt),
      expiresAt: new Date(state.expiresAt),
    });
    this.personLocks.set(personKey(state.roomId, state.userId), state);
    return state;
  }

  /** Lift a person's lock early. Returns true when a live lock was
   *  actually standing (an expired one is pruned and reported as
   *  already gone). */
  async unlockPerson(roomId: string, userId: string, now = Date.now()): Promise<boolean> {
    const standing = this.personLockedUntil(roomId, userId, now) !== null;
    await db
      .delete(worldPersonLocksTable)
      .where(
        and(eq(worldPersonLocksTable.roomId, roomId), eq(worldPersonLocksTable.userId, userId)),
      );
    this.personLocks.delete(personKey(roomId, userId));
    return standing;
  }

  /** Lock a room's door. Locking an already-locked door keeps the
   *  standing row (the first admin's lock is the truth until an
   *  admin unlocks it). */
  async lockDoor(input: {
    roomId: string;
    lockedByUserId: string;
    lockedByEmail?: string | null;
    now?: number;
  }): Promise<WorldDoorLockState> {
    const existing = this.doorLocks.get(input.roomId);
    if (existing) return existing;
    const state: WorldDoorLockState = {
      roomId: input.roomId,
      lockedByUserId: input.lockedByUserId,
      lockedByEmail: input.lockedByEmail ?? null,
      createdAt: input.now ?? Date.now(),
    };
    await db.insert(worldDoorLocksTable).values({
      roomId: state.roomId,
      lockedByUserId: state.lockedByUserId,
      lockedByEmail: state.lockedByEmail,
      createdAt: new Date(state.createdAt),
    });
    this.doorLocks.set(state.roomId, state);
    return state;
  }

  /** Unlock a room's door. Returns true when it was locked. */
  async unlockDoor(roomId: string): Promise<boolean> {
    const standing = this.doorLocks.has(roomId);
    if (!standing) return false;
    await db.delete(worldDoorLocksTable).where(eq(worldDoorLocksTable.roomId, roomId));
    this.doorLocks.delete(roomId);
    return true;
  }
}
