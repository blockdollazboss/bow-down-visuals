/**
 * Fullscreen helper tests — enter/exit against fake document +
 * element surfaces; the browser's real objects satisfy the same
 * structural minimums.
 */
import { describe, it, expect } from "vitest";
import {
  isFullscreenActive,
  fullscreenSupported,
  toggleFullscreen,
  initialFullscreenRecovery,
  fsRecoveryOnToggle,
  fsRecoveryOnChange,
  fsRecoveryOnReenterClick,
  type FullscreenDocLike,
  type FullscreenElementLike,
  type FullscreenRecoveryState,
} from "./fullscreen";

function fakeDoc() {
  const doc: FullscreenDocLike & { exitCalls: number } = {
    fullscreenElement: null,
    exitCalls: 0,
    exitFullscreen() {
      doc.exitCalls++;
      doc.fullscreenElement = null;
    },
  };
  return doc;
}

function fakeEl(doc: FullscreenDocLike, fail = false): FullscreenElementLike & { calls: number } {
  const el = {
    calls: 0,
    requestFullscreen() {
      el.calls++;
      if (fail) throw new Error("not allowed");
      doc.fullscreenElement = el;
    },
  };
  return el;
}

describe("fullscreen helpers", () => {
  it("support needs both halves of the API", () => {
    const doc = fakeDoc();
    expect(fullscreenSupported(doc, fakeEl(doc))).toBe(true);
    expect(fullscreenSupported(doc, null)).toBe(false);
    expect(fullscreenSupported({ fullscreenElement: null }, fakeEl(doc))).toBe(false);
  });

  it("enter asks the element; exit asks the document", async () => {
    const doc = fakeDoc();
    const el = fakeEl(doc);
    expect(isFullscreenActive(doc)).toBe(false);
    expect(await toggleFullscreen(doc, el)).toBe(true);
    expect(el.calls).toBe(1);
    expect(isFullscreenActive(doc)).toBe(true);
    expect(await toggleFullscreen(doc, el)).toBe(false);
    expect(doc.exitCalls).toBe(1);
    expect(isFullscreenActive(doc)).toBe(false);
  });

  it("a rejected request reports the true state instead of throwing", async () => {
    const doc = fakeDoc();
    const el = fakeEl(doc, true);
    expect(await toggleFullscreen(doc, el)).toBe(false);
    expect(isFullscreenActive(doc)).toBe(false);
  });

  it("no element, no crash — just not fullscreen", async () => {
    const doc = fakeDoc();
    expect(await toggleFullscreen(doc, null)).toBe(false);
  });
});

describe("platform-exit recovery", () => {
  /* Walk a whole session through the machine: the page feeds every
   * fullscreenchange through fsRecoveryOnChange, the toggle button
   * through fsRecoveryOnToggle, and armed clicks through
   * fsRecoveryOnReenterClick. */
  const entered = (): FullscreenRecoveryState =>
    fsRecoveryOnChange(initialFullscreenRecovery, true);

  it("a platform exit (Esc, file chooser, OS gesture) arms the one-click way back", () => {
    const after = fsRecoveryOnChange(entered(), false);
    expect(after.engaged).toBe(false);
    expect(after.armed).toBe(true);
  });

  it("an exit the walker asked for never arms — leaving on purpose is respected", () => {
    const marked = fsRecoveryOnToggle(entered(), true);
    const after = fsRecoveryOnChange(marked, false);
    expect(after.armed).toBe(false);
    expect(after.selfExit).toBe(false);
  });

  it("an exit observed while never engaged arms nothing", () => {
    const after = fsRecoveryOnChange(initialFullscreenRecovery, false);
    expect(after.armed).toBe(false);
  });

  it("(re-)entering settles everything: engaged, unarmed, no stale self-exit mark", () => {
    const armedState = fsRecoveryOnChange(entered(), false);
    expect(armedState.armed).toBe(true);
    const back = fsRecoveryOnChange(armedState, true);
    expect(back).toEqual({ engaged: true, armed: false, selfExit: false });
  });

  it("pressing the toggle to enter supersedes an armed recovery", () => {
    const armedState = fsRecoveryOnChange(entered(), false);
    const after = fsRecoveryOnToggle(armedState, false);
    expect(after.armed).toBe(false);
  });

  it("the armed click re-enters exactly once — the arm is spent either way", () => {
    const armedState = fsRecoveryOnChange(entered(), false);
    const first = fsRecoveryOnReenterClick(armedState);
    expect(first.reenter).toBe(true);
    expect(first.state.armed).toBe(false);
    const second = fsRecoveryOnReenterClick(first.state);
    expect(second.reenter).toBe(false);
  });

  it("a click while unarmed is just a click", () => {
    const { state, reenter } = fsRecoveryOnReenterClick(initialFullscreenRecovery);
    expect(reenter).toBe(false);
    expect(state).toBe(initialFullscreenRecovery);
  });
});
