/**
 * Flag S-3 (Lane F perf audit): fan-out relays get a process-global cap
 * (MAX_CONCURRENT_RELAYS) with an honest `capped` refusal, and the stop
 * machinery closeOutDestinations relies on (stopAllRelays) really does
 * kill every relay of a stream — the stall/stale end paths now call it
 * the same way the manual /end route always did.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  MAX_CONCURRENT_RELAYS,
  __resetRelays,
  __setRelayFactory,
  activeRelayCount,
  activeRelayPlatforms,
  startRelay,
  stopAllRelays,
  stopRelay,
  type RelayProcess,
} from "../multistream";

class FakeRelay implements RelayProcess {
  killed = false;
  private exitCb: ((code: number | null) => void) | null = null;
  kill(): void {
    this.killed = true;
    this.exitCb?.(null);
  }
  onExit(cb: (code: number | null) => void): void {
    this.exitCb = cb;
  }
}
const fakes: FakeRelay[] = [];

beforeEach(() => {
  __resetRelays();
  fakes.length = 0;
  __setRelayFactory(() => {
    const f = new FakeRelay();
    fakes.push(f);
    return f;
  });
});

describe("multistream global relay cap (S-3)", () => {
  it("the cap fits the 512 MB container story (single digits, not the uncapped 21)", () => {
    expect(MAX_CONCURRENT_RELAYS).toBe(8);
  });

  it("refuses new relays past the cap with capped:true and spawns nothing", () => {
    for (let i = 0; i < MAX_CONCURRENT_RELAYS; i++) {
      const r = startRelay(`stream-${i}`, "youtube", [], () => undefined);
      expect(r.started).toBe(true);
    }
    expect(activeRelayCount()).toBe(MAX_CONCURRENT_RELAYS);
    const refused = startRelay("one-stream-too-many", "youtube", [], () => undefined);
    expect(refused).toEqual({ started: false, capped: true });
    expect(fakes).toHaveLength(MAX_CONCURRENT_RELAYS); // no process spawned for the refusal
  });

  it("a duplicate (stream, platform) is a plain not-started, not a cap refusal", () => {
    startRelay("s1", "youtube", [], () => undefined);
    expect(startRelay("s1", "youtube", [], () => undefined)).toEqual({ started: false });
  });

  it("stopping a relay frees its slot under the cap", () => {
    for (let i = 0; i < MAX_CONCURRENT_RELAYS; i++) startRelay(`stream-${i}`, "youtube", [], () => undefined);
    expect(startRelay("late", "twitch", [], () => undefined).started).toBe(false);
    expect(stopRelay("stream-0", "youtube")).toBe(true);
    expect(startRelay("late", "twitch", [], () => undefined).started).toBe(true);
  });

  it("stopAllRelays (the closeOutDestinations mechanism) kills exactly that stream's relays", () => {
    startRelay("dying", "youtube", [], () => undefined);
    startRelay("dying", "twitch", [], () => undefined);
    startRelay("healthy", "youtube", [], () => undefined);
    expect(stopAllRelays("dying")).toBe(2);
    expect(fakes.filter((f) => f.killed)).toHaveLength(2);
    expect(activeRelayPlatforms("dying")).toEqual([]);
    expect(activeRelayPlatforms("healthy")).toEqual(["youtube"]);
  });
});
