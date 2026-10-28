/**
 * theme-probe.test.ts — Lane T (stack500) theme-song player resilience.
 *
 * Behavioural pins for the availability state machine extracted into
 * lib/theme-probe.ts (the node harness cannot mount React, so the
 * machine lives outside the component and is driven here with scripted
 * HEAD outcomes + fake timers). The regression being pinned, from
 * theme-player-diagnosis §2: one failed HEAD probe at page load used
 * to brand the theme "missing" for the whole session with no retry,
 * while the track itself was healthy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ThemeProbe, attemptPlay } from "./theme-probe";

/** A HEAD probe whose outcome the test controls call by call. */
function scriptedHead() {
  let calls = 0;
  let impl: () => Promise<boolean> = () => Promise.resolve(true);
  return {
    head: () => {
      calls += 1;
      return impl();
    },
    calls: () => calls,
    succeed: () => {
      impl = () => Promise.resolve(true);
    },
    fail: () => {
      impl = () => Promise.resolve(false);
    },
    reject: () => {
      impl = () => Promise.reject(new Error("network down"));
    },
    hang: () => {
      impl = () => new Promise<boolean>(() => {});
    },
  };
}

/** Flush pending microtasks without moving fake time. */
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

describe("ThemeProbe — availability is never terminal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("boot probe success → ready, onReady fired", async () => {
    const h = scriptedHead();
    h.succeed();
    const ready = vi.fn();
    const probe = new ThemeProbe({ head: h.head, onChange: () => {}, onReady: ready });
    probe.start();
    await flush();
    expect(probe.snapshot.status).toBe("ready");
    expect(probe.snapshot.checking).toBe(false);
    expect(ready).toHaveBeenCalledTimes(1);
    probe.dispose();
  });

  it("probe fail → missing, then reprobe success → ready (fail-then-succeed recovery)", async () => {
    const h = scriptedHead();
    h.fail();
    const ready = vi.fn();
    const probe = new ThemeProbe({ head: h.head, onChange: () => {}, onReady: ready });
    probe.start();
    await flush();
    expect(probe.snapshot.status).toBe("missing");
    expect(ready).not.toHaveBeenCalled();

    h.succeed();
    probe.reprobe();
    await flush();
    expect(probe.snapshot.status).toBe("ready");
    expect(ready).toHaveBeenCalledTimes(1);
    probe.dispose();
  });

  it("a rejected probe counts as missing, not as a terminal state", async () => {
    const h = scriptedHead();
    h.reject();
    const probe = new ThemeProbe({ head: h.head, onChange: () => {} });
    probe.start();
    await flush();
    expect(probe.snapshot.status).toBe("missing");

    h.succeed();
    probe.reprobe();
    await flush();
    expect(probe.snapshot.status).toBe("ready");
    probe.dispose();
  });

  it("opening the widget re-probes immediately and keeps retrying on backoff until success", async () => {
    const h = scriptedHead();
    h.fail();
    const probe = new ThemeProbe({ head: h.head, onChange: () => {} });
    probe.start();
    await flush();
    expect(h.calls()).toBe(1);
    expect(probe.snapshot.status).toBe("missing");

    /* Widget opens: immediate re-probe, no waiting for a timer. */
    probe.setWatching(true);
    await flush();
    expect(h.calls()).toBe(2);

    /* Still failing: backoff steps 2s, then 5s. */
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.calls()).toBe(3);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.calls()).toBe(4);
    expect(probe.snapshot.status).toBe("missing");

    /* Transport heals: the next scheduled probe recovers the session. */
    h.succeed();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(probe.snapshot.status).toBe("ready");

    /* Recovery stops the loop — no further probes while open. */
    const callsAtReady = h.calls();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.calls()).toBe(callsAtReady);
    probe.dispose();
  });

  it("backoff caps at 30s while the widget stays open and the track stays down", async () => {
    const h = scriptedHead();
    h.fail();
    const probe = new ThemeProbe({ head: h.head, onChange: () => {} });
    probe.start();
    await flush();
    probe.setWatching(true);
    await flush();
    expect(h.calls()).toBe(2); // boot + immediate on open

    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.calls()).toBe(3);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.calls()).toBe(4);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.calls()).toBe(5);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.calls()).toBe(6);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.calls()).toBe(7);
    /* Cap holds: another 30s, exactly one more — not a burst. */
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.calls()).toBe(8);
    probe.dispose();
  });

  it("closing the widget stops the retry loop", async () => {
    const h = scriptedHead();
    h.fail();
    const probe = new ThemeProbe({ head: h.head, onChange: () => {} });
    probe.start();
    await flush();
    probe.setWatching(true);
    await flush();
    const callsWhileOpen = h.calls();
    probe.setWatching(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.calls()).toBe(callsWhileOpen);
    probe.dispose();
  });

  it("reprobe is a no-op once ready (availability already proven)", async () => {
    const h = scriptedHead();
    h.succeed();
    const probe = new ThemeProbe({ head: h.head, onChange: () => {} });
    probe.start();
    await flush();
    expect(probe.snapshot.status).toBe("ready");
    probe.reprobe();
    await flush();
    expect(h.calls()).toBe(1);
    probe.dispose();
  });

  it("concurrent reprobes coalesce into a single in-flight probe", async () => {
    const h = scriptedHead();
    h.fail();
    const probe = new ThemeProbe({ head: h.head, onChange: () => {} });
    probe.start();
    await flush();
    h.hang();
    probe.reprobe();
    probe.reprobe();
    probe.reprobe();
    expect(h.calls()).toBe(2); // boot + one coalesced probe
    expect(probe.snapshot.checking).toBe(true);
    probe.dispose();
  });

  it("element error → error state, healed by a later successful probe", async () => {
    const h = scriptedHead();
    h.succeed();
    const ready = vi.fn();
    const probe = new ThemeProbe({ head: h.head, onChange: () => {}, onReady: ready });
    probe.start();
    await flush();
    expect(probe.snapshot.status).toBe("ready");

    probe.reportElementError();
    expect(probe.snapshot.status).toBe("error");

    probe.reprobe();
    await flush();
    expect(probe.snapshot.status).toBe("ready");
    expect(ready).toHaveBeenCalledTimes(2); // boot + recovery
    probe.dispose();
  });
});

describe("attemptPlay — rejections are data, not silence", () => {
  it("resolves true when playback starts", async () => {
    await expect(attemptPlay({ play: () => Promise.resolve() })).resolves.toBe(true);
  });

  it("resolves false when play() rejects (autoplay policy / decode / network)", async () => {
    await expect(
      attemptPlay({ play: () => Promise.reject(new Error("NotAllowedError")) }),
    ).resolves.toBe(false);
  });

  it("resolves false even when play() throws synchronously", async () => {
    await expect(
      attemptPlay({
        play: () => {
          throw new Error("boom");
        },
      }),
    ).resolves.toBe(false);
  });
});
