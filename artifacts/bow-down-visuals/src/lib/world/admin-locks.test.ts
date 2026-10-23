/**
 * The World's admin lock verbs, client side (items 92–93).
 *
 * Pinned:
 *  - the DISPLAY gate: only a server-flagged admin member sees the
 *    verbs — a plain member, a guest, an admin-flagged guest and
 *    a signed-out walker never do (the server still rejects
 *    non-admin calls regardless; this gate is honesty, not the
 *    enforcement);
 *  - the verb wire shapes: the four POSTs + the standing-locks
 *    GET hit the routes/world.ts endpoints with the session's
 *    bearer token and exactly the bodies the server parses;
 *  - durations clamp like the server's (default 1h, max 7d);
 *  - a refusal surfaces as a WorldLockVerbError carrying the
 *    server's status, code and words — never silence.
 */
import { describe, it, expect, vi } from "vitest";
import {
  canUseWorldLockVerbs,
  doorLockVerb,
  standingPersonLock,
  worldLockMinutes,
  fetchWorldLocks,
  lockWorldDoor,
  unlockWorldDoor,
  lockWorldPerson,
  unlockWorldPerson,
  WorldLockVerbError,
  WORLD_LOCK_MAX_MINUTES,
} from "./admin-locks";

function fakeFetch(status: number, payload: unknown) {
  const calls: Array<{ url: string; init: any }> = [];
  const fetchFn = vi.fn(async (url: string, init?: any) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    } as Response;
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

describe("canUseWorldLockVerbs — non-admins never see the verbs", () => {
  it("an admin member can; everyone else cannot", () => {
    expect(canUseWorldLockVerbs({ admin: true, guest: false })).toBe(true);
    expect(canUseWorldLockVerbs({ admin: true })).toBe(true);
    expect(canUseWorldLockVerbs({ admin: false, guest: false })).toBe(false);
    expect(canUseWorldLockVerbs({ guest: false })).toBe(false);
    expect(canUseWorldLockVerbs({ admin: true, guest: true })).toBe(false);
    expect(canUseWorldLockVerbs({ admin: false, guest: true })).toBe(false);
    expect(canUseWorldLockVerbs(null)).toBe(false);
    expect(canUseWorldLockVerbs(undefined)).toBe(false);
  });

  it("doorLockVerb follows the directory's locked truth", () => {
    expect(doorLockVerb({ locked: true })).toBe("unlock");
    expect(doorLockVerb({ locked: false })).toBe("lock");
    expect(doorLockVerb({})).toBe("lock");
  });

  it("standingPersonLock finds only the lock on that member in that room", () => {
    const locks = {
      doors: [],
      persons: [
        { roomId: "world:music-hall", userId: "u1", displayName: "Marcus", lockedByEmail: null, createdAt: "x", expiresAt: "y" },
        { roomId: "world:kings-hall", userId: "u1", displayName: "Marcus", lockedByEmail: null, createdAt: "x", expiresAt: "y" },
      ],
    };
    expect(standingPersonLock(locks, "world:music-hall", "u1")?.roomId).toBe("world:music-hall");
    expect(standingPersonLock(locks, "world:music-hall", "u2")).toBeNull();
    expect(standingPersonLock(null, "world:music-hall", "u1")).toBeNull();
  });

  it("worldLockMinutes defaults to an hour and clamps to a week", () => {
    expect(worldLockMinutes(undefined)).toBe(60);
    expect(worldLockMinutes("120")).toBe(60);
    expect(worldLockMinutes(0)).toBe(60);
    expect(worldLockMinutes(45.6)).toBe(46);
    expect(worldLockMinutes(999_999)).toBe(WORLD_LOCK_MAX_MINUTES);
  });
});

describe("the verbs on the wire", () => {
  it("lockWorldDoor posts the room id with the bearer token and returns the fresh directory", async () => {
    const rooms = [{ id: "world:music-hall", name: "Music Hall", count: 1, members: [], live: false, locked: true }];
    const { fetchFn, calls } = fakeFetch(200, { ok: true, door: { roomId: "world:music-hall", locked: true }, rooms });
    const out = await lockWorldDoor("tok-1", "world:music-hall", fetchFn);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/world/locks/door/lock");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers.Authorization).toBe("Bearer tok-1");
    expect(JSON.parse(calls[0]!.init.body)).toEqual({ roomId: "world:music-hall" });
    expect(out.door.locked).toBe(true);
    expect(out.rooms).toEqual(rooms);
  });

  it("unlockWorldDoor posts to the unlock verb", async () => {
    const { fetchFn, calls } = fakeFetch(200, { ok: true, door: { roomId: "world:music-hall", locked: false } });
    const out = await unlockWorldDoor("tok-1", "world:music-hall", fetchFn);
    expect(calls[0]!.url).toBe("/api/world/locks/door/unlock");
    expect(out.door.locked).toBe(false);
  });

  it("lockWorldPerson sends the peer target and the clamped minutes; unlock sends the account", async () => {
    const { fetchFn, calls } = fakeFetch(200, {
      ok: true,
      evicted: true,
      person: { roomId: "world:music-hall", userId: "u1", displayName: "Marcus", expiresAt: "y" },
    });
    const out = await lockWorldPerson("tok-1", { roomId: "world:music-hall", peerId: "peer-9", minutes: 999_999 }, fetchFn);
    expect(calls[0]!.url).toBe("/api/world/locks/person/lock");
    expect(JSON.parse(calls[0]!.init.body)).toEqual({
      roomId: "world:music-hall",
      peerId: "peer-9",
      minutes: WORLD_LOCK_MAX_MINUTES,
    });
    expect(out.evicted).toBe(true);

    const up = fakeFetch(200, { ok: true, person: { roomId: "world:music-hall", userId: "u1", locked: false } });
    await unlockWorldPerson("tok-1", { roomId: "world:music-hall", userId: "u1" }, up.fetchFn);
    expect(up.calls[0]!.url).toBe("/api/world/locks/person/unlock");
    expect(JSON.parse(up.calls[0]!.init.body)).toEqual({ roomId: "world:music-hall", userId: "u1" });
  });

  it("fetchWorldLocks reads the standing locks and tolerates a partial answer", async () => {
    const { fetchFn, calls } = fakeFetch(200, {
      doors: [{ roomId: "world:music-hall", lockedByEmail: "king@example.test", createdAt: "x" }],
      persons: [],
    });
    const out = await fetchWorldLocks("tok-1", fetchFn);
    expect(calls[0]!.url).toBe("/api/world/locks");
    expect(calls[0]!.init.method).toBe("GET");
    expect(out.doors).toHaveLength(1);
    expect(out.persons).toEqual([]);
    const partial = fakeFetch(200, {});
    await expect(fetchWorldLocks("tok-1", partial.fetchFn)).resolves.toEqual({ doors: [], persons: [] });
  });

  it("a refusal throws the server's status, code and words", async () => {
    const { fetchFn } = fakeFetch(403, { error: "Admin only — the World's locks answer to admin accounts.", code: "ADMIN_REQUIRED" });
    const err = await lockWorldDoor("tok-1", "world:music-hall", fetchFn).catch((e) => e);
    expect(err).toBeInstanceOf(WorldLockVerbError);
    expect(err.status).toBe(403);
    expect(err.code).toBe("ADMIN_REQUIRED");
    expect(err.message).toContain("Admin only");
  });

  it("no token means no Authorization header — the server's 401 is the answer, not a crash", async () => {
    const { fetchFn, calls } = fakeFetch(401, { error: "unauthorized" });
    await expect(lockWorldDoor(null, "world:music-hall", fetchFn)).rejects.toMatchObject({ status: 401 });
    expect(calls[0]!.init.headers.Authorization).toBeUndefined();
  });
});
