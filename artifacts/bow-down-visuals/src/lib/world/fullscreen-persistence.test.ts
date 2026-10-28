/**
 * Fullscreen persistence (owner's live report, 2026-10-28: "I
 * shouldn't have to not be in full screen mode. I should stay in
 * full screen mode and be able to do things inside of the VR
 * world.").
 *
 * The browser renders ONLY the fullscreen element's subtree. The
 * World used to fullscreen the ROOM box — while every interactive
 * surface (the station sheet with all its desks, the character /
 * Screen / host panels, the plaza radio dock, the control row)
 * mounts in the page BELOW the room box. In fullscreen those
 * surfaces simply did not exist on screen: walk up to a desk, open
 * it, and the walker had to leave fullscreen to use it.
 *
 * The pins below hold the repair in place: fullscreen targets the
 * PAGE ROOT (the outermost element of the page's JSX, so every
 * mount between its opening tag and the file's final close is its
 * descendant), the platform-exit recovery is wired, and the
 * fullscreenchange handler stays view-state-only — an exit, from
 * any cause, can never tear down in-world state (panels stay open,
 * the session stays inside, nothing disconnects).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("world fullscreen persistence", () => {
  const page = read("../../pages/world.tsx");

  it("fullscreen targets the page root, never the room box", () => {
    expect(page).toContain('data-testid="world-page-root"');
    expect(page).toContain("ref={pageRef}");
    expect(page).toContain("toggleFullscreen(document, pageRef.current)");
    expect(page).not.toContain("toggleFullscreen(document, roomRef");
  });

  it("every interactive surface mounts inside the fullscreen root (DOM ancestry)", () => {
    const rootAt = page.indexOf('data-testid="world-page-root"');
    expect(rootAt).toBeGreaterThan(-1);
    /* The page root is the outermost element of the page's return:
       its closing tag is the last JSX close in the file, so every
       mount positioned between the root's opening tag and that
       close is a descendant of the fullscreen element — rendered
       by the browser while fullscreen, not hidden outside it. */
    expect(page.trimEnd().endsWith("</div>\n  );\n}")).toBe(true);
    const mounts = [
      "{charPanelOpen &&", // the character panel (WalkInAsPicker)
      "{screenPanelOpen &&", // the Screen panel + the live desks
      "{hostPanelOpen &&", // the host panel
      "<StationPanel\n", // the station sheet — every native desk (the \n keeps the type name StationPanelTarget from matching)
      'data-testid="world-plaza-radio"', // the Charts Radio dock
      'data-testid="world-fs-reenter"', // the way-back chip, in the room
    ];
    for (const marker of mounts) {
      const at = page.indexOf(marker);
      expect(at, `mount missing from the page: ${marker}`).toBeGreaterThan(rootAt);
    }
  });

  it("the fullscreenchange handler mirrors view state only — it tears nothing down", () => {
    const start = page.indexOf("const sync = () => {");
    const end = page.indexOf('document.addEventListener("fullscreenchange", sync);');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const syncBody = page.slice(start, end);
    expect(syncBody).toContain("setIsFs(");
    expect(syncBody).toContain("fsRecoveryOnChange(");
    for (const teardown of [
      "setPanelTarget",
      "setCharPanelOpen",
      "setScreenPanelOpen",
      "setHostPanelOpen",
      "setStatus(",
      "disconnect",
      "exitPointerLock",
    ]) {
      expect(syncBody, `fullscreenchange handler must not call ${teardown}`).not.toContain(teardown);
    }
  });

  it("a platform exit arms a one-click way back that never swallows the click", () => {
    expect(page).toContain("fsRecoveryOnToggle(");
    const start = page.indexOf("const onPointer = () => {");
    const end = page.indexOf('document.addEventListener("pointerdown", onPointer, true);');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = page.slice(start, end);
    expect(body).toContain("fsRecoveryOnReenterClick(");
    expect(body).not.toContain("preventDefault");
    expect(body).not.toContain("stopPropagation");
  });
});
