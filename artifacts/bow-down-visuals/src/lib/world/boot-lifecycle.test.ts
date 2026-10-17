/**
 * The world page's boot-effect lifecycle (found by the join-fix-2
 * lane, fixed here). The boot IIFE in pages/world.tsx starts the
 * socket, then awaits the screen fetch — a bare HTTP call with no
 * timeout of its own, on a host that may still be waking. The four
 * boot intervals (screen poll, volume, lips, stations) are armed
 * AFTER that await, and the effect's cleanup can only interleave
 * at an await — so a cleanup landing mid-fetch used to leave a
 * zombie boot behind: it armed all four intervals after the
 * cleanup had already read their slots as null (nothing would
 * ever clear them; they ticked forever against a disposed scene)
 * and went on awaiting the connect promise of a client the
 * cleanup had disconnected.
 *
 * The fix is one guard at exactly that seam: after the screen
 * fetch, a cancelled boot disconnects its own client and returns,
 * arming nothing. These pins hold the seam's shape in the page
 * source (the house pattern for page-level behavior — this suite
 * runs in node, no DOM): the guard sits between the fetch and
 * EVERY interval arming, it disconnects before it returns, and
 * the connect tail is only reached past it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const worldSrc = read("../../pages/world.tsx");

/* The boot's connect segment: from the door starting to the tail
 * await, sliced out so pins can't be satisfied by lookalike code
 * elsewhere in the page (the boot has other cancelled checks —
 * after the scene-chunk import, in the handlers — by design). */
const segStart = worldSrc.indexOf("const connectPromise = client.connect();");
const segEnd = worldSrc.indexOf("await connectPromise;", segStart);
const segment = worldSrc.slice(segStart, segEnd);

describe("world boot lifecycle — a cleaned-up boot arms nothing and holds no socket", () => {
  it("the connect segment exists, fetch first", () => {
    expect(segStart).toBeGreaterThan(-1);
    expect(segEnd).toBeGreaterThan(segStart);
    expect(segment).toContain("await loadScreen();");
  });

  it("a cancelled guard stands between the screen fetch and every interval arming", () => {
    const fetchIdx = segment.indexOf("await loadScreen();");
    const guardIdx = segment.indexOf("if (cancelled) {");
    expect(guardIdx).toBeGreaterThan(fetchIdx);
    for (const arm of [
      "screenPoll = setInterval(",
      "volumeTick = setInterval(",
      "lipTick = setInterval(",
      "stationTick = setInterval(",
    ]) {
      expect(segment.indexOf(arm), arm).toBeGreaterThan(guardIdx);
    }
  });

  it("the guard disconnects the boot's own client before it returns", () => {
    const guardIdx = segment.indexOf("if (cancelled) {");
    const guardBlock = segment.slice(guardIdx, guardIdx + 200);
    const disconnectIdx = guardBlock.indexOf("client.disconnect();");
    const returnIdx = guardBlock.indexOf("return;");
    expect(disconnectIdx).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(disconnectIdx);
  });

  it("the cleanup still disconnects through the ref — both hands let go", () => {
    expect(worldSrc).toContain("clientRef.current?.disconnect();");
  });
});
