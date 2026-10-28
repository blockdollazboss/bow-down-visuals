/**
 * An opened desk must be SEEN to open (owner's live report,
 * 2026-10-25: "I haven't been able to do anything inside of the
 * VR world").
 *
 * History: the station sheet used to mount in page flow BELOW the
 * stage and rely on a one-shot scrollIntoView — which landed it
 * half below the fold whenever the scroll fell short or the desk's
 * async content grew the sheet after landing (audit §B5; owner's
 * screenshot, 2026-10-27, a Charts sheet clipped at the screen's
 * edge). The sheet is now anchored to the VIEWPORT: StationPanel's
 * root is fixed at the bottom of the screen, capped in dvh and
 * scrolling internally, so it presents over the room the walker is
 * standing in and growth is clamped by the layout itself. The page
 * never scrolls for a panel, so closing one returns the walker to
 * exactly the view they left.
 *
 * The second half of the original defect stands guard here too:
 * the canvas takes pointer lock on click, so on open the page
 * releases it — otherwise even a found panel cannot be clicked
 * until Esc.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("../../pages/world.tsx");
const sheet = read("../../components/world/StationPanel.tsx");

describe("opening a station panel brings it to the walker", () => {
  it("the sheet is anchored to the viewport, not mounted in page flow", () => {
    expect(sheet).toContain("fixed inset-x-0 bottom-0");
    expect(sheet).toContain('data-testid="world-station-panel"');
  });

  it("the sheet is capped in dynamic viewport units and scrolls internally, so growth re-clamps by construction", () => {
    expect(sheet).toContain("max-h-[86dvh]");
    expect(sheet).toContain("overflow-y-auto");
    expect(sheet).toContain("overscroll-contain");
  });

  it("the retired page-flow mechanism is gone: no scroll anchor, no scrollIntoView", () => {
    expect(page).not.toContain("panelAnchorRef");
    expect(page).not.toContain("scrollIntoView");
    expect(sheet).not.toContain("max-h-[62vh]");
  });

  it("on open, pointer lock is released so the panel can be clicked", () => {
    expect(page).toContain("if (document.pointerLockElement) document.exitPointerLock();");
  });

  it("the pointer-lock release hangs off the panelTarget effect, not a click handler that can be bypassed", () => {
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
    expect(page).toContain("interactNoteTimerRef.current = setTimeout(() => setInteractNote(null), 4000);");
  });

  it("the controls hint names the interact key", () => {
    expect(page).toContain("E opens what");
  });
});
