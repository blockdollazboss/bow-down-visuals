/**
 * An opened desk must be SEEN to open (owner's live report,
 * 2026-10-25: "I haven't been able to do anything inside of the
 * VR world").
 *
 * The station sheet mounts in page flow BELOW the stage (its root
 * is relative, under the canvas) and nothing ever scrolled to it:
 * pressing E / Open at a desk changed nothing on screen. Worse,
 * the canvas takes pointer lock on click and nothing in the app
 * ever released it, so even a found panel could not be clicked
 * until Esc. The page now, on panel open: releases pointer lock
 * and scrolls the sheet's anchor into view. These pins keep both
 * halves of that behaviour from silently dropping out.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("../../pages/world.tsx");

describe("opening a station panel brings it to the walker", () => {
  it("the panel mount carries the scroll anchor", () => {
    expect(page).toContain("<div ref={panelAnchorRef}>");
  });

  it("on open, pointer lock is released so the panel can be clicked", () => {
    expect(page).toContain("if (document.pointerLockElement) document.exitPointerLock();");
  });

  it("on open, the sheet is scrolled into view", () => {
    expect(page).toContain(
      'panelAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })',
    );
  });

  it("both behaviours hang off the panelTarget effect, not a click handler that can be bypassed", () => {
    const at = page.indexOf("if (document.pointerLockElement) document.exitPointerLock();");
    const effectHead = page.lastIndexOf("useEffect(() => {", at);
    expect(effectHead).toBeGreaterThan(-1);
    expect(page.slice(effectHead, at)).toContain("if (!panelTarget) return;");
    expect(page.slice(at, at + 400)).toContain("}, [panelTarget]);");
  });
});

describe("an interact press with no target is answered, not silent", () => {
  it("the resolver speaks when nothing is in reach", () => {
    expect(page).toContain("Nothing in reach — walk to a gold ring or a standing figure, then press E.");
  });

  it("the note renders where the prompts live and yields to any real prompt", () => {
    expect(page).toContain('data-testid="world-interact-note"');
    expect(page).toContain("interactNote && !nearStation && !nearCourtesy && !panelTarget && !photoMode");
  });

  it("the note retires itself", () => {
    expect(page).toContain("interactNoteTimer.current = setTimeout(() => setInteractNote(null), 4000);");
  });

  it("the controls hint names the interact key", () => {
    expect(page).toContain("E opens what");
  });
});
