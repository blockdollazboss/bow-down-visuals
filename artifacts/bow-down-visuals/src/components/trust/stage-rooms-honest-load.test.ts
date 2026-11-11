/**
 * StageRooms (live stage rooms list + open-a-room) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - FIX (this tranche): THE ROOMS LOAD never checked its
 *   response — a failed load whose body was the house JSON
 *   error shape parsed cleanly into `j.rooms ?? []`, so the
 *   panel asserted "No rooms are open right now." over a
 *   load that never proved a single room state. (A non-JSON
 *   failure happened to throw into the error line; the
 *   common JSON failure did not.) The loader now throws on
 *   non-ok into the existing "Could not load rooms." error.
 * - THE CREATE call already gated on ok (the server's
 *   message or "Could not open the room."), and a denied
 *   microphone gets its own truthful line at join — neither
 *   a room nor a mic state is ever claimed unproven.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./StageRooms.tsx");

describe("FIX: the rooms load errors honestly instead of asserting no rooms", () => {
  it("non-ok throws before the payload is read as a room list", () => {
    const gateIdx = src.indexOf('if (!res.ok) throw new Error("rooms load failed");');
    const parseIdx = src.indexOf("setRooms(j.rooms ?? []);");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(parseIdx).toBeGreaterThan(gateIdx);
    expect(src).toContain('setErr("Could not load rooms.");');
    expect(src).toContain("No rooms are open right now.");
  });
});

describe("create and mic states are claimed only when proven", () => {
  it("the create gate and the denial line are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(j, "Could not open the room."));');
    expect(src).toContain('setDenied("Microphone access was denied — check your browser\'s mic permission for this site.");');
  });
});
