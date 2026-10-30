/**
 * Lane F1 (QC-200 G2) — the already-bounded half of the census.
 *
 * E4's sweep could not prove every G2-named store is capped on this
 * base. For the stores the Oct 25 OOM fix already bounded, this file
 * pins the proof: (a) the cap mechanism under a fresh-key flood at
 * the helper level, (b) source pins that each named store actually
 * invokes the bound on its write path (the world-presence-lane
 * precedent — a cap nobody calls is not a cap), and (c) a behavioral
 * run of the World creator-room idle demolition, the rooms store's
 * bound: empty rooms are reclaimed, occupied rooms are not, and the
 * fixed palace rooms are never demolished.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { capMapSize } from "../sweep-map";
import { RoomHub } from "../live-ws";
import { WorldPalace, CREATOR_ROOM_IDLE_MS } from "../world-palace";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..");
const readSrc = (rel: string) => readFileSync(join(srcRoot, rel), "utf8");

describe("capMapSize under a fresh-key flood (mechanism)", () => {
  it("12,000 brand-new entries (nothing old enough to sweep) still hold at the cap", () => {
    const map = new Map<string, { at: number }>();
    const now = 1_700_000_000_000;
    for (let i = 0; i < 12_000; i++) {
      map.set(`k-${i}`, { at: now });
      capMapSize(map, 10_000, (e) => e.at);
    }
    expect(map.size).toBe(10_000);
    expect(map.has("k-11999")).toBe(true);
    expect(map.has("k-0")).toBe(false);
  });
});

describe("G2 stores already bounded — write-path pins", () => {
  it("rank cache: TTL sweep + hard cap on every cache write", () => {
    const src = readSrc("lib/creator-rank.ts");
    expect(src).toContain("sweepTtlIfLarge(rankCache, RANK_CACHE_SWEEP_THRESHOLD, RANK_CACHE_TTL_MS");
    expect(src).toContain("capMapSize(rankCache, RANK_CACHE_MAX_ENTRIES");
  });

  it("podcast enclosure cache: TTL sweep + hard cap on every write", () => {
    const src = readSrc("lib/podcast-feed.ts");
    expect(src).toContain("sweepTtlIfLarge(enclosureCache, ENCLOSURE_CACHE_SWEEP_THRESHOLD, ENCLOSURE_CACHE_TTL_MS");
    expect(src).toContain("capMapSize(enclosureCache, ENCLOSURE_CACHE_MAX_ENTRIES");
  });

  it("podcast owner-email cache: TTL sweep + hard cap on every write", () => {
    const src = readSrc("routes/podcast-feed.ts");
    expect(src).toContain("sweepTtlIfLarge(ownerEmailCache, OWNER_EMAIL_SWEEP_THRESHOLD, OWNER_EMAIL_TTL_MS");
    expect(src).toContain("capMapSize(ownerEmailCache, OWNER_EMAIL_MAX_ENTRIES");
  });

  it("live-chat pacing: hard cap behind the age sweep", () => {
    const src = readSrc("routes/live-chat.ts");
    expect(src).toContain("capMapSize(lastPostAt, CHAT_PACING_MAX_ENTRIES");
  });

  it("reach watch pacing: hard cap behind the age sweep", () => {
    const src = readSrc("routes/reach.ts");
    expect(src).toContain("capMapSize(watchLastAt, WATCH_PACING_MAX_ENTRIES");
  });

  it("world palace: creator-room demolition removes rooms from BOTH indexes", () => {
    const src = readSrc("lib/world-palace.ts");
    expect(src).toContain("this.rooms.delete(creatorRoomIdForSlug(slug))");
    expect(src).toContain("this.creatorRooms.delete(slug)");
    expect(src).toContain("this.creatorRoomEmptySince.delete(slug)");
  });
});

describe("World creator rooms: growth is reclaimed by idle demolition", () => {
  it("50 materialized rooms all vanish after the idle window; the hall never does", () => {
    const palace = new WorldPalace(new RoomHub());
    const t0 = Date.now();
    for (let i = 0; i < 50; i++) {
      palace.noteCreatorRoom(`creator-${i}`, `Creator ${i}`);
    }
    expect(palace.creatorRoom("creator-0")).toBeDefined();
    expect(palace.creatorRoom("creator-49")).toBeDefined();

    // First sweep starts the idle clocks; rooms still stand.
    palace.sweepStalePeers(t0);
    expect(palace.creatorRoom("creator-0")).toBeDefined();

    // One tick before the window closes they still stand…
    palace.sweepStalePeers(t0 + CREATOR_ROOM_IDLE_MS - 1);
    expect(palace.creatorRoom("creator-49")).toBeDefined();

    // …and once past it, every one is demolished from both indexes.
    palace.sweepStalePeers(t0 + CREATOR_ROOM_IDLE_MS + 1);
    for (let i = 0; i < 50; i++) {
      expect(palace.creatorRoom(`creator-${i}`)).toBeUndefined();
    }
    expect(palace.hallRoom).toBeDefined();
    expect(palace.plazaRoom).toBeDefined();
  });

  it("an occupied room is not demolished; it gets a full idle window after emptying", () => {
    const palace = new WorldPalace(new RoomHub());
    const t0 = Date.now();
    palace.noteCreatorRoom("busy-room", "Busy Room");

    // A walker stands in the room (socket-level presence).
    const room = palace.creatorRoom("busy-room")!;
    const fakeSocket: any = {
      readyState: 1,
      sent: [] as any[],
      send(data: string) { this.sent.push(JSON.parse(data)); },
      close() { this.readyState = 3; },
      terminate() { this.readyState = 3; },
      ping() {},
      on() { return this; },
    };
    expect(palace.enterHall(fakeSocket, {
      userId: "user-busy",
      displayName: "Busy",
      avatarUrl: null,
      profileSlug: "busy",
    })).toBe(true);
    palace.handleFrame(fakeSocket, JSON.stringify({
      type: "room.enter", roomId: "creator:busy-room", x: 9.5, z: 28.6,
    }), t0);
    expect(room.size()).toBe(1);

    // Sweeps while occupied: no demolition, idle clock stays clear.
    palace.sweepStalePeers(t0 + CREATOR_ROOM_IDLE_MS + 1);
    expect(palace.creatorRoom("busy-room")).toBeDefined();

    // The stale-peer reap empties the room on a later sweep; only
    // THEN does its idle clock run — a full window must pass before
    // demolition, and then it goes like the others.
    palace.sweepStalePeers(t0 + CREATOR_ROOM_IDLE_MS + 2);
    expect(palace.creatorRoom("busy-room")).toBeDefined();
    palace.sweepStalePeers(t0 + CREATOR_ROOM_IDLE_MS + 2 + CREATOR_ROOM_IDLE_MS + 1);
    expect(palace.creatorRoom("busy-room")).toBeUndefined();
  });
});
