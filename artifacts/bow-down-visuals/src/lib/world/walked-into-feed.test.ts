/**
 * The walked-into feed line — page wiring pins (Stack800 Lane 7,
 * item 4).
 *
 * The scene side has carried the flap guard since the owner's
 * Oct 25 walk (crossingIsFlap, palace-layout — a reversal at the
 * same doorway within the window never re-fires a transfer). The
 * PAGE side had a hole of the same family one layer down: the
 * say log's "You walked into…" line hung unguarded off
 * client.onRoomChanged, and onRoomChanged fires not only for
 * doorway transfers but also for a QUIET-RECONNECT landing in the
 * same room (the client re-homes the page on purpose, so the dead
 * socket's voice mesh tears down — pinned in world-client.test).
 * Every silent reconnect therefore announced a walk that never
 * happened, into the room the walker was already standing in.
 * Refused transfers were already safe (they land on
 * onRoomUnavailable / onRoomLocked and never fire onRoomChanged —
 * pinned client-side too); the reconnect landing was not.
 *
 * The fix is a page-side room memory: feedRoomRef, seeded at the
 * first landing and advanced by the handler itself, gates ONLY
 * the feed line. Everything else the handler does on a re-home —
 * voice teardown, room dressing, the reseat check — still runs
 * on reconnect landings, because the session really is new. These
 * pins lock that shape to the page source, the house style for
 * page wiring.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(__dirname, "../../pages/world.tsx"), "utf8");

const handlerStart = page.indexOf("client.onRoomChanged = ");
const handler = page.slice(handlerStart, handlerStart + 6000);

describe("the walked-into line speaks only for an actual change of room", () => {
  it("the page keeps a feed-room memory, seeded at the first landing", () => {
    expect(page).toContain("const feedRoomRef = useRef<string | null>(null);");
    // Seeded where the header takes its room from — the onStatus
    // inside branch, which the first welcome reaches and a
    // transfer (status never leaves "inside") never re-fires.
    expect(page).toContain("feedRoomRef.current = client.room.id;");
  });

  it("the append is guarded by the room actually changing, and the guard advances the memory", () => {
    const guardAt = handler.indexOf("if (feedRoomRef.current !== room.id) {");
    expect(guardAt).toBeGreaterThan(-1);
    const advanceAt = handler.indexOf("feedRoomRef.current = room.id;", guardAt);
    const appendAt = handler.indexOf("You walked into ${room.name}.", guardAt);
    expect(advanceAt).toBeGreaterThan(guardAt);
    expect(appendAt).toBeGreaterThan(advanceAt);
  });

  it("there is exactly one walked-into append site in the page", () => {
    expect(page.split("You walked into ${room.name}").length - 1).toBe(1);
  });

  it("the voice teardown is NOT behind the guard — a reconnect landing still tears the mesh down", () => {
    const teardownAt = handler.indexOf("teardownVoiceSession()");
    const guardAt = handler.indexOf("if (feedRoomRef.current !== room.id) {");
    expect(teardownAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(teardownAt);
  });
});

describe("the reseat check is wired with the destination room", () => {
  it("the page passes room.id so the rule's membership half can speak", () => {
    expect(page).toContain("transferNeedsReseat(scene.localPose(), client.self, room.id)");
  });
});
