/**
 * FrameStallTracker tests (frame-stall.ts) + the BackgroundChanger
 * wiring contract (background-changer.ts).
 *
 * The defect these pin (Oct 18, 2026, from the owner's live
 * screenshot): the Go Live studio showed a silent BLACK canvas with
 * the success copy ("That's your feed in the Camera source…") still
 * up. The camera had started fine — the failure was frame-flow: the
 * default backdrop engine produced zero frames (null mattes,
 * swallowed per-frame inference errors, or a hung inference), and
 * BackgroundChanger._loop had no honest path for it — nothing ever
 * painted, nothing ever said so. Now: ~2s of consecutive
 * no-composite passes trip a stall episode — the loop paints the
 * raw camera via the existing engine-down path and reports ONCE
 * through onEngineStatus ("off") — and the first landed matte ends
 * the episode and restores the live engine status.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { FrameStallTracker, FRAME_STALL_THRESHOLD_MS } from "./frame-stall";

const changerSource = readFileSync(new URL("./background-changer.ts", import.meta.url), "utf8");

describe("FrameStallTracker", () => {
  it("does not trip before the threshold", () => {
    const t = new FrameStallTracker(1_000);
    expect(t.noteMiss(1_000)).toBe(false);
    expect(t.noteMiss(1_000 + FRAME_STALL_THRESHOLD_MS - 1)).toBe(false);
    expect(t.stalled).toBe(false);
  });

  it("trips exactly at the threshold, once per episode", () => {
    const t = new FrameStallTracker(0);
    expect(t.noteMiss(FRAME_STALL_THRESHOLD_MS)).toBe(true);
    expect(t.stalled).toBe(true);
    // Later misses in the same episode never re-report.
    expect(t.noteMiss(FRAME_STALL_THRESHOLD_MS + 500)).toBe(false);
    expect(t.noteMiss(FRAME_STALL_THRESHOLD_MS + 60_000)).toBe(false);
    expect(t.stalled).toBe(true);
  });

  it("measures the stall from the last landed matte, not from start", () => {
    const t = new FrameStallTracker(0);
    t.noteMatte(10_000);
    expect(t.noteMiss(10_000 + FRAME_STALL_THRESHOLD_MS - 1)).toBe(false);
    expect(t.noteMiss(10_000 + FRAME_STALL_THRESHOLD_MS)).toBe(true);
  });

  it("a landed matte restarts the grace clock", () => {
    const t = new FrameStallTracker(0);
    expect(t.noteMiss(1_500)).toBe(false);
    t.noteMatte(1_600);
    // 1_900ms after the matte: still inside the grace window.
    expect(t.noteMiss(3_500)).toBe(false);
    expect(t.noteMiss(3_600)).toBe(true);
  });

  it("noteMatte ends an episode exactly once", () => {
    const t = new FrameStallTracker(0);
    expect(t.noteMiss(FRAME_STALL_THRESHOLD_MS)).toBe(true);
    expect(t.noteMatte(3_000)).toBe(true);
    expect(t.stalled).toBe(false);
    // A matte outside an episode is not an episode end.
    expect(t.noteMatte(3_100)).toBe(false);
  });

  it("a fresh episode can trip (and report) again after recovery", () => {
    const t = new FrameStallTracker(0);
    expect(t.noteMiss(2_000)).toBe(true);
    expect(t.noteMatte(2_500)).toBe(true);
    expect(t.noteMiss(2_500 + FRAME_STALL_THRESHOLD_MS)).toBe(true);
    expect(t.stalled).toBe(true);
  });

  it("reset() re-anchors and forgets an active episode", () => {
    const t = new FrameStallTracker(0);
    expect(t.noteMiss(2_000)).toBe(true);
    t.reset(5_000);
    expect(t.stalled).toBe(false);
    // The new engine/session gets its own full grace window.
    expect(t.noteMiss(5_000 + FRAME_STALL_THRESHOLD_MS - 1)).toBe(false);
    expect(t.noteMiss(5_000 + FRAME_STALL_THRESHOLD_MS)).toBe(true);
  });

  it("honours a custom threshold", () => {
    const t = new FrameStallTracker(0, 500);
    expect(t.noteMiss(499)).toBe(false);
    expect(t.noteMiss(500)).toBe(true);
  });

  it("the shipped threshold is the diagnosed ~2 seconds", () => {
    expect(FRAME_STALL_THRESHOLD_MS).toBe(2_000);
  });
});

describe("BackgroundChanger stall wiring (source contract)", () => {
  it("while stalled: raw ONLY before the first matte — with a matte the effect holds (motion fix, Oct 25, 2026)", () => {
    /* The pre-matte stall case survives: no matte has landed for
       the live engine yet, so the loop paints the live raw
       picture instead of a blank/frozen frame. */
    expect(changerSource).toMatch(/else if \(this\._frameStall\.stalled\) \{/);
    /* The branch ABOVE it is the motion fix: once a matte exists,
       every tick composites the LIVE frame with it — stall or
       not — and the raw room never paints over a live backdrop
       again (the old pin, `if (stalled) this._compositeRaw()`,
       was the owner's "the green screen gets erased" defect). */
    const liveBranch = changerSource.indexOf("if (this._liveMatte && this._liveMatte.epoch === this._engineEpoch)");
    const stallBranch = changerSource.indexOf("else if (this._frameStall.stalled)");
    expect(liveBranch).toBeGreaterThanOrEqual(0);
    expect(stallBranch).toBeGreaterThan(liveBranch);
    const liveBody = changerSource.slice(liveBranch, stallBranch);
    expect(liveBody).toContain("this._compositeLive();");
    expect(liveBody).not.toContain("_compositeRaw");
  });

  it("every frameless pass on the engine path notes a miss", () => {
    // readyState, busy-wait, null matte, inference throw.
    const notes = changerSource.match(/this\._noteFrameMiss\(\);/g) ?? [];
    expect(notes.length).toBeGreaterThanOrEqual(4);
    // …and a landed matte notes the recovery.
    expect(changerSource).toContain("this._noteMatteFrame();");
  });

  it("the stall is reported once, through the engine-status channel, as off", () => {
    const helper = changerSource.slice(changerSource.indexOf("private _noteFrameMiss()"));
    const body = helper.slice(0, helper.indexOf("\n  }"));
    expect(body).toContain("this._frameStall.noteMiss(performance.now())");
    expect(body).toContain('this.config.onEngineStatus("off")');
  });

  it("recovery restores the LIVE engine kind through the same channel", () => {
    const helper = changerSource.slice(changerSource.indexOf("private _noteMatteFrame()"));
    const body = helper.slice(0, helper.indexOf("\n  }"));
    expect(body).toContain("this._frameStall.noteMatte(performance.now())");
    expect(body).toContain("this.config.onEngineStatus(this._engineKind)");
  });

  it("the tracker resets at session start and on every engine swap/teardown", () => {
    const resets = changerSource.match(/this\._frameStall\.reset\(performance\.now\(\)\);/g) ?? [];
    expect(resets.length).toBeGreaterThanOrEqual(3);
  });

  it("the honest start-time errors are untouched", () => {
    expect(changerSource).toContain('"PERMISSION_DENIED"');
    expect(changerSource).toContain('"NO_CAMERA"');
    expect(changerSource).toContain('"UNSUPPORTED"');
  });
});
