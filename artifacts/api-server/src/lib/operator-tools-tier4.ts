/* ─── Cloud Operator Phase 2, Lane F — Tier-4 admin handlers ───────
   The World's authority verbs, worked by Thy Cheat Code ONLY on an
   admin account's command. The executor's Gate 2 stands in front
   of every handler here: the caller's session email must be on
   ADMIN_EMAILS (fail-closed — an unset allowlist refuses everyone)
   or the handler never runs and the attempt is audited. These
   handlers therefore never re-check authority; they do the work,
   on the SAME rails the World's own host controls ride:

     world.kick          → WorldRoom.removePeer        (admin.remove)
     world.mute          → WorldRoom.setPeerHostMuted  (admin.mute)
     world.herald        → WorldPalace.heraldAsAdmin   (announce.herald)
     world.stage_promote → StageRoom.setRoleByAuthority (role.set)
     world.stage_demote  → StageRoom.setRoleByAuthority (role.set)
     world.lock_person   → WorldLockStore.lockPerson   (0179, NEW)
     world.unlock_person → WorldLockStore.unlockPerson (0179, NEW)
     world.lock_room     → WorldLockStore.lockDoor     (0179, NEW)
     world.unlock_room   → WorldLockStore.unlockDoor   (0179, NEW)

   TARGETS ARE NEVER GUESSED (design §3 + the owner's peace law):
   a name resolves against the palace's presence truth — exactly
   one present person, or the command refuses and asks. Two people
   carrying one name is an ambiguity, not a coin flip. He manages
   the peace automatically (Lane G); he punishes ONLY here, only
   when an admin said so, and the executor audits every attempt.

   IMPORT DISCIPLINE (Lane D's lesson): the World modules load
   LAZILY inside the handlers — the operator registry is imported
   by chat/admin surfaces whose suites partially mock unrelated
   libraries, and a static route/palace graph here would drag it
   into all of them. The mounted palace itself is reached through
   routes/world's getter (dynamic import), the same instance the
   sockets talk to — never a second copy. */

import type { OperatorTool } from "./operator-tools";
import type { WorldPalace, PalacePresentMatch } from "./world-palace";
import type { WorldRoom } from "./world-room";
import type { WorldLockStore } from "./world-locks";
import type { StageRoom, StagePresentMember } from "./stage-room";

type Handler = OperatorTool["handler"];

/** The longest a personal lock may run on one command: a week.
 *  Longer stays possible — an admin re-issues it — but no single
 *  command quietly becomes a banishment. */
export const WORLD_LOCK_MAX_MINUTES = 7 * 24 * 60;

/* ── Lazy world access ──────────────────────────────────────────── */

interface WorldModules {
  palace: WorldPalace;
  roomDefs: ReadonlyArray<{ roomId: string; name: string }>;
  stageRooms: Map<string, StageRoom>;
}

interface LoadedWorldLibs {
  getActiveWorldPalace: () => WorldPalace | null;
  roomDefs: ReadonlyArray<{ roomId: string; name: string }>;
  stageRooms: Map<string, StageRoom>;
}

let worldLibsPromise: Promise<LoadedWorldLibs> | null = null;

function loadWorldLibs(): Promise<LoadedWorldLibs> {
  if (!worldLibsPromise) {
    worldLibsPromise = (async () => {
      const routes = await import("../routes/world");
      const palaceLib = await import("./world-palace");
      const stageLib = await import("./stage-room");
      return {
        getActiveWorldPalace: routes.getActiveWorldPalace,
        roomDefs: palaceLib.PALACE_ROOM_DEFS,
        stageRooms: stageLib.stageRooms,
      };
    })();
  }
  return worldLibsPromise;
}

/** The mounted palace + the stage-room registry. The MODULES load
 *  once; the palace INSTANCE is read fresh on every command — the
 *  getter is the one source, so a re-mounted World is the one the
 *  next command reaches. A process with no World mounted (a test
 *  surface, a worker) has no palace to command — the handlers say
 *  so honestly. */
async function loadWorld(): Promise<WorldModules> {
  const libs = await loadWorldLibs();
  const palace = libs.getActiveWorldPalace();
  if (!palace) {
    throw new Error(
      "The World isn't running in this process right now, so the command can't reach the palace — nothing was changed.",
    );
  }
  return { palace, roomDefs: libs.roomDefs, stageRooms: libs.stageRooms };
}

function lockStoreOf(palace: WorldPalace): WorldLockStore {
  if (!palace.lockStore) {
    throw new Error(
      "The World's locks aren't wired in this process right now, so that command can't land — nothing was changed.",
    );
  }
  return palace.lockStore;
}

/* ── Args ───────────────────────────────────────────────────────── */

function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function numArg(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/* ── Resolution: rooms and people, never guessed ────────────────── */

function roomDisplayName(world: WorldModules, roomId: string): string {
  return (
    world.palace.room(roomId)?.roomName ??
    world.roomDefs.find((d) => d.roomId === roomId)?.name ??
    roomId
  );
}

/** Resolve a room the admin named — by room id, by palace-room
 *  name, or by its directory name (creator rooms while occupied). */
function resolveRoom(world: WorldModules, arg: string): WorldRoom | null {
  const direct = world.palace.room(arg);
  if (direct) return direct;
  const needle = arg.trim().toLowerCase();
  const def = world.roomDefs.find(
    (d) => d.name.toLowerCase() === needle || d.roomId.toLowerCase() === needle,
  );
  if (def) return world.palace.room(def.roomId) ?? null;
  const entry = world.palace.directory().find((e) => e.name.toLowerCase() === needle);
  if (entry) return world.palace.room(entry.id) ?? null;
  return null;
}

function mustResolveRoom(world: WorldModules, arg: string): WorldRoom {
  const room = resolveRoom(world, arg);
  if (!room) {
    throw new Error(`I can't find a room called “${arg}” in the palace — name one of its rooms and I'll do it.`);
  }
  return room;
}

/** Resolve a named person against the palace's presence truth.
 *  Exactly one present person, or the command refuses: nobody
 *  home by that name, or the name is shared and no room settled
 *  it. NEVER a guess — a punishment aimed at the wrong person is
 *  the one error this lane exists to make impossible. */
function resolvePresentTarget(
  world: WorldModules,
  targetName: string,
  roomArg?: string,
): PalacePresentMatch {
  let matches = world.palace.findPresentMember(targetName);
  if (roomArg) {
    const room = mustResolveRoom(world, roomArg);
    matches = matches.filter((m) => m.room.roomId === room.roomId);
    if (matches.length === 0) {
      throw new Error(
        `“${targetName}” isn't standing in ${room.roomName} right now — the command only reaches people who are here.`,
      );
    }
  }
  if (matches.length === 0) {
    throw new Error(
      `I can't find anyone named “${targetName}” in the palace right now — the command only reaches people who are here.`,
    );
  }
  if (matches.length > 1) {
    const rooms = matches.map((m) => m.room.roomName).join(", ");
    throw new Error(
      `${matches.length} people named “${targetName}” are in the palace right now (${rooms}) — tell me which room and I'll know exactly who you mean. I won't guess at a punishment.`,
    );
  }
  return matches[0]!;
}

function durationText(minutes: number): string {
  if (minutes < 60) return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  if (minutes < 24 * 60) {
    const h = minutes / 60;
    return Number.isInteger(h) ? (h === 1 ? "1 hour" : `${h} hours`) : `${minutes} minutes`;
  }
  const d = minutes / (24 * 60);
  return Number.isInteger(d) ? (d === 1 ? "1 day" : `${d} days`) : `${minutes} minutes`;
}

function liftText(expiresAt: number): string {
  return new Date(expiresAt).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ── The palace verbs ───────────────────────────────────────────── */

const worldKick: Handler = async (ctx) => {
  const world = await loadWorld();
  const targetName = strArg(ctx.args, "target");
  if (!targetName) throw new Error("Name the person to remove — “kick” needs a who.");
  const { room, member } = resolvePresentTarget(world, targetName, strArg(ctx.args, "room"));
  if (member.userId && member.userId === ctx.userId) {
    throw new Error("That's you — I won't remove the admin who gave the order. If you want out, the door is yours to walk through.");
  }
  if (!room.removePeer(member.peerId, "host")) {
    throw new Error(`${member.displayName} stepped out of ${room.roomName} before the command landed — nothing to remove.`);
  }
  return {
    summary: `Removed ${member.displayName} from ${room.roomName}`,
    target: `${member.displayName} — ${room.roomName}`,
    replyText: `Done — ${member.displayName} is out of ${room.roomName}. 🦈`,
  };
};

const worldMute: Handler = async (ctx) => {
  const world = await loadWorld();
  const targetName = strArg(ctx.args, "target");
  if (!targetName) throw new Error("Name the person — “mute” needs a who.");
  const muted = ctx.args["muted"] === false ? false : true;
  const { room, member } = resolvePresentTarget(world, targetName, strArg(ctx.args, "room"));
  if (member.hostMuted === muted) {
    throw new Error(
      muted
        ? `${member.displayName} is already muted in ${room.roomName} — nothing to change.`
        : `${member.displayName} isn't muted in ${room.roomName} — their voice is already on.`,
    );
  }
  if (!room.setPeerHostMuted(member.peerId, muted)) {
    throw new Error(`${member.displayName} stepped out of ${room.roomName} before the command landed — nothing changed.`);
  }
  return {
    summary: muted
      ? `Muted ${member.displayName} in ${room.roomName}`
      : `Unmuted ${member.displayName} in ${room.roomName}`,
    target: `${member.displayName} — ${room.roomName}`,
    replyText: muted
      ? `Done — ${member.displayName} is muted in ${room.roomName}. Their voice stays off until an admin lifts it. 🦈`
      : `Done — ${member.displayName} can speak in ${room.roomName} again. 🦈`,
  };
};

const worldHerald: Handler = async (ctx) => {
  const world = await loadWorld();
  const text = strArg(ctx.args, "text");
  if (!text) throw new Error("Tell me the announcement — a herald needs the words.");
  const result = world.palace.heraldAsAdmin({ text, limitKey: ctx.userId });
  if (!result.ok) {
    throw new Error(
      result.reason === "empty"
        ? "That announcement came through empty — give me the words and I'll herald them."
        : `The palace just heard a herald a moment ago — give it ${Math.max(1, Math.ceil((result.retryAfterMs ?? 0) / 1000))} seconds and say it again, so the channel stays a herald and not a horn.`,
    );
  }
  return {
    summary: `Heralded to the whole palace: “${text.slice(0, 80)}”`,
    target: "The whole palace",
    replyText: `Done — the whole palace heard it: “${text}” 🦈`,
  };
};

/* ── The stage verbs ────────────────────────────────────────────── */

function resolveStageTarget(
  world: WorldModules,
  targetName: string,
): { room: StageRoom; member: StagePresentMember } {
  const needle = targetName.trim().toLowerCase();
  const matches: Array<{ room: StageRoom; member: StagePresentMember }> = [];
  for (const room of world.stageRooms.values()) {
    for (const member of room.presentMembers()) {
      if (member.displayName.trim().toLowerCase() === needle) matches.push({ room, member });
    }
  }
  if (matches.length === 0) {
    throw new Error(
      `I can't find anyone named “${targetName}” standing in a stage room right now — stage commands only reach people who are in one.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} people named “${targetName}” are standing in stage rooms right now — I won't guess at which one you mean.`,
    );
  }
  return matches[0]!;
}

function stageRoleHandler(role: "speaker" | "listener"): Handler {
  return async (ctx) => {
    const world = await loadWorld();
    const targetName = strArg(ctx.args, "target");
    if (!targetName) throw new Error("Name the person — a stage command needs a who.");
    const { room, member } = resolveStageTarget(world, targetName);
    if (member.role === "host") {
      throw new Error("The host always keeps the stage — that seat isn't mine to move, even on your word.");
    }
    if (member.role === role) {
      throw new Error(
        role === "speaker"
          ? `${member.displayName} is already a speaker on that stage — nothing to change.`
          : `${member.displayName} is already a listener there — nothing to change.`,
      );
    }
    const err = room.setRoleByAuthority(member.peerId, role);
    if (err) throw new Error(err);
    return {
      summary:
        role === "speaker"
          ? `Promoted ${member.displayName} to speaker on the stage`
          : `Demoted ${member.displayName} to listener on the stage`,
      target: `${member.displayName} — stage room`,
      replyText:
        role === "speaker"
          ? `Done — ${member.displayName} is a speaker now; the mic is theirs. 🦈`
          : `Done — ${member.displayName} is back to listening. 🦈`,
    };
  };
}

/* ── The locks (migration 0179) ─────────────────────────────────── */

const worldLockPerson: Handler = async (ctx) => {
  const world = await loadWorld();
  const store = lockStoreOf(world.palace);
  const targetName = strArg(ctx.args, "target");
  if (!targetName) throw new Error("Name the person to lock out — a lock binds a who.");
  /* Presence binds the account: the name resolves to a person
   * standing in the palace, and the lock writes THEIR user id.
   * A name with nobody behind it locks nothing. */
  const present = resolvePresentTarget(world, targetName);
  const { member } = present;
  if (!member.userId) {
    throw new Error(
      `${member.displayName} is a guest — a lock binds a member's account, and a guest has none to bind. Kick is the tool for a guest.`,
    );
  }
  if (member.userId === ctx.userId) {
    throw new Error("That's your own account — I won't lock the admin who gave the order out of their own palace.");
  }
  let minutes = numArg(ctx.args, "minutes") ?? 60;
  if (!Number.isFinite(minutes) || minutes <= 0) minutes = 60;
  minutes = Math.max(1, Math.min(Math.round(minutes), WORLD_LOCK_MAX_MINUTES));
  const roomArg = strArg(ctx.args, "room");
  const room = roomArg ? mustResolveRoom(world, roomArg) : present.room;
  const lock = await store.lockPerson({
    roomId: room.roomId,
    userId: member.userId,
    displayName: member.displayName,
    lockedByUserId: ctx.userId,
    lockedByEmail: ctx.userEmail ?? null,
    minutes,
  });
  /* Standing in the locked room right now? The lock's first
   * moment is the removal — the door refusing them LATER while
   * they stand inside NOW would be a lock in name only. */
  const evicted = present.room.roomId === room.roomId
    ? room.removePeer(member.peerId, "locked")
    : false;
  return {
    summary: `Locked ${member.displayName} out of ${room.roomName} for ${durationText(minutes)}`,
    target: `${member.displayName} — ${room.roomName}`,
    replyText:
      `Done — ${member.displayName} is locked out of ${room.roomName} for ${durationText(minutes)}, ` +
      `until ${liftText(lock.expiresAt)}.${evicted ? " They were standing in it, so they're out now." : ""} ` +
      `The door will refuse them until then, however they come back — an admin can lift it early any time. 🦈`,
  };
};

const worldUnlockPerson: Handler = async (ctx) => {
  const world = await loadWorld();
  const store = lockStoreOf(world.palace);
  const targetName = strArg(ctx.args, "target");
  if (!targetName) throw new Error("Name the person whose lock to lift.");
  /* The locked person is — by definition — NOT standing in the
   * room, so presence can't resolve them. The lock store can:
   * it carries the name the lock landed under. */
  let locks = store.personLocksByName(targetName);
  const roomArg = strArg(ctx.args, "room");
  if (roomArg) {
    const room = mustResolveRoom(world, roomArg);
    locks = locks.filter((l) => l.roomId === room.roomId);
  }
  if (locks.length === 0) {
    throw new Error(
      `There's no standing lock on anyone named “${targetName}”${roomArg ? " in that room" : ""} — nothing to lift.`,
    );
  }
  if (locks.length > 1) {
    const rooms = locks.map((l) => roomDisplayName(world, l.roomId)).join(", ");
    throw new Error(
      `“${targetName}” is locked out of ${locks.length} rooms (${rooms}) — name the room and I'll lift exactly that one.`,
    );
  }
  const lock = locks[0]!;
  await store.unlockPerson(lock.roomId, lock.userId);
  const roomName = roomDisplayName(world, lock.roomId);
  return {
    summary: `Lifted ${lock.displayName}'s lock on ${roomName}`,
    target: `${lock.displayName} — ${roomName}`,
    replyText: `Done — ${lock.displayName} can walk into ${roomName} again, right now. 🦈`,
  };
};

const worldLockRoom: Handler = async (ctx) => {
  const world = await loadWorld();
  const store = lockStoreOf(world.palace);
  const roomArg = strArg(ctx.args, "room");
  if (!roomArg) throw new Error("Name the room whose door to lock.");
  const room = mustResolveRoom(world, roomArg);
  if (store.isDoorLocked(room.roomId)) {
    throw new Error(`${room.roomName}'s door is already locked — nothing to change.`);
  }
  await store.lockDoor({
    roomId: room.roomId,
    lockedByUserId: ctx.userId,
    lockedByEmail: ctx.userEmail ?? null,
  });
  world.palace.refreshDirectory();
  return {
    summary: `Locked the door of ${room.roomName}`,
    target: room.roomName,
    replyText:
      `Done — ${room.roomName}'s door is locked. Everyone inside stays; nobody new joins until an admin unlocks it. ` +
      `Admin accounts can still walk in — the King is never locked out of his own palace. 🦈`,
  };
};

const worldUnlockRoom: Handler = async (ctx) => {
  const world = await loadWorld();
  const store = lockStoreOf(world.palace);
  const roomArg = strArg(ctx.args, "room");
  if (!roomArg) throw new Error("Name the room whose door to unlock.");
  const room = mustResolveRoom(world, roomArg);
  if (!store.isDoorLocked(room.roomId)) {
    throw new Error(`${room.roomName}'s door isn't locked — it's already open.`);
  }
  await store.unlockDoor(room.roomId);
  world.palace.refreshDirectory();
  return {
    summary: `Unlocked the door of ${room.roomName}`,
    target: room.roomName,
    replyText: `Done — ${room.roomName}'s door is open again; people can join as usual. 🦈`,
  };
};

/* ── The registry merge (operator-tools.ts spreads this in) ─────── */

export const TIER4_HANDLERS: Record<string, Handler> = {
  "world.kick": worldKick,
  "world.mute": worldMute,
  "world.herald": worldHerald,
  "world.stage_promote": stageRoleHandler("speaker"),
  "world.stage_demote": stageRoleHandler("listener"),
  "world.lock_person": worldLockPerson,
  "world.unlock_person": worldUnlockPerson,
  "world.lock_room": worldLockRoom,
  "world.unlock_room": worldUnlockRoom,
};
