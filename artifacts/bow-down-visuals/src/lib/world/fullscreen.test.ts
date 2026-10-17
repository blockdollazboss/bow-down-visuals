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
  type FullscreenDocLike,
  type FullscreenElementLike,
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
