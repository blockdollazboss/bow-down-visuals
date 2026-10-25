/**
 * The boot's screen fetch can never gate the room's interactivity
 * (owner's live report, 2026-10-25: the website popups work, but
 * inside the World nothing responds).
 *
 * The boot tail armed EVERY interaction tick (the 200 ms station/
 * courtesy poller, peer sync, voice, lips) only after
 * `await loadScreen()` — a fetch with no timeout of its own, on
 * the same waking box this codebase has already caught holding
 * the socket hostage once. A hung fetch meant: socket inside,
 * feed flowing, composer working — and no prompt ever polled, for
 * the whole session. The boot now races the fetch against ten
 * seconds; the screen still lands whenever it lands (loadScreen
 * runs on, the 45 s poll keeps it fresh), it just can't hold the
 * room's interactivity hostage.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { worldDelay } from "./world-client";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("the boot screen gate", () => {
  const page = read("../../pages/world.tsx");

  it("the boot races the screen fetch against a bounded delay", () => {
    expect(page).toContain("await Promise.race([loadScreen(), worldDelay(10_000)]);");
  });

  it("no unbounded screen await remains in the boot path", () => {
    expect(page).not.toContain("await loadScreen();");
  });

  it("the screen poll still refreshes on its own cadence (late landing is by design)", () => {
    expect(page).toContain("screenPoll = setInterval(loadScreen, 45_000);");
  });
});

describe("worldDelay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after the given milliseconds, not before", async () => {
    vi.useFakeTimers();
    let done = false;
    const p = worldDelay(5000).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    await p;
  });
});
