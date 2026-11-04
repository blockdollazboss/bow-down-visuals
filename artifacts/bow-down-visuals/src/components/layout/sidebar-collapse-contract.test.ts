import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * sidebar-collapse-contract.test.ts — QC-200 fix #3, the wiring half.
 *
 * Sitting A live-verified the defect: the sidebar auto-collapsed ~3s
 * after load/open and its links stayed in the DOM unclickable until
 * "Show sidebar" was clicked. The behaviour pins live in
 * hooks/use-sidebar-auto-collapse.test.ts; this suite pins the
 * wiring that behaviour depends on, so a future refactor cannot
 * quietly restore the bare timer or the ghost links:
 *
 *   C1 the collapsed offcanvas sidebar is `inert` (no ghost links).
 *   C2 AuthedLayout drives the collapse through the restraint
 *      controller — the old userTouchedSidebar bare timer is gone.
 *   C3 BOTH manual paths (provider open-change and the floating
 *      expand button) cancel the auto-collapse.
 *   C4 the controller listens for focus as well as pointer signals
 *      (the sidebar search box is a keyboard surface).
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const app = read("../../App.tsx");
const sidebarUi = read("../ui/sidebar.tsx");
const hook = read("../../hooks/use-sidebar-auto-collapse.ts");

describe("sidebar collapse contract (QC-200 #3)", () => {
  it("C1: collapsed offcanvas sidebar renders inert — no ghost links", () => {
    expect(sidebarUi).toContain(
      'inert={collapsible === "offcanvas" && state === "collapsed"}',
    );
  });

  it("C2: AuthedLayout uses the restraint controller, not the bare timer", () => {
    expect(app).toContain("useSidebarAutoCollapse");
    expect(app).not.toContain("userTouchedSidebar");
  });

  it("C3: both manual paths cancel the auto-collapse", () => {
    const calls = app.match(/noteManualToggle\(\)/g) ?? [];
    // One in handleOpenChange (provider), one in the expand button.
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("C4: the controller tracks focus and pointer engagement", () => {
    expect(hook).toContain('"focusin"');
    expect(hook).toContain('"pointerover"');
    expect(hook).toContain('"pointerdown"');
    expect(hook).toContain('"keydown"');
    expect(hook).toMatch(/SIDEBAR_INTERACTION_GRACE_MS = 10_000/);
    expect(hook).toMatch(/SIDEBAR_AUTO_COLLAPSE_DELAY_MS = 3000/);
  });
});
