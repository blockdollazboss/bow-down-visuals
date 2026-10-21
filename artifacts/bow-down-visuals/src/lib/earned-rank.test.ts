/**
 * earned-rank.test.ts — Creator Rank on the frontend (owner ruling,
 * 2026-10-17: "Make stars earned rank").
 *
 * Pins:
 *  (a) the grandfather rule as pure math (gateStarsFor): exposure is
 *      max(earned, saved pre-rank level) — nobody's controls shrink,
 *      and a saved level can never push exposure past 6 or below 1;
 *  (b) by source, the contract rewiring: the context reads the earned
 *      rank from the server and contains NO star setter and NO
 *      localStorage persistence of a chosen level; the sidebar is a
 *      display (no setStars, no /pricing star locks); the sequencer
 *      gate no longer self-grants; the editor's Pro lock no longer
 *      points at pricing; the World's level watch trusts the
 *      level-check response's earned stars.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gateStarsFor } from "@/lib/creator-rank";

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");

describe("gateStarsFor — the grandfather rule", () => {
  it("earned rank below the saved level keeps the saved exposure", () => {
    expect(gateStarsFor(2, 6)).toBe(6);
    expect(gateStarsFor(1, 4)).toBe(4);
  });

  it("earned rank takes over as soon as it passes the saved level", () => {
    expect(gateStarsFor(5, 3)).toBe(5);
    expect(gateStarsFor(6, 6)).toBe(6);
  });

  it("a brand-new account (floor 1) is purely earned", () => {
    expect(gateStarsFor(1, 1)).toBe(1);
    expect(gateStarsFor(3, 1)).toBe(3);
  });

  it("clamps junk to the 1–6 ladder", () => {
    expect(gateStarsFor(0, 0)).toBe(1);
    expect(gateStarsFor(9, 9)).toBe(6);
    expect(gateStarsFor(Number.NaN, Number.NaN)).toBe(1);
  });
});

describe("the dial is gone — source contract", () => {
  const context = read("../contexts/UserModeContext.tsx");

  it("context reads earned rank from the server rail", () => {
    expect(context).toContain("/api/retention/rank");
    expect(context).toContain("rank?.stars");
  });

  it("context exposes no star setter and persists no chosen level", () => {
    expect(context).not.toContain("setStars");
    /* The only localStorage writes left are the Turbo/Advanced mode
       preference — a display mode, not a rank. */
    expect(context).toContain("bdv_ui_mode_");
    expect(context).not.toMatch(/localStorage\.setItem\(keyFor/);
  });

  it("plan tier no longer caps stars in the context", () => {
    expect(context).not.toContain("plan_tier");
    expect(context).not.toContain("maxStars: StarLevel = ");
    expect(context).toContain("maxStars: 6");
  });

  it("the sidebar rank display cannot set stars or sell them", () => {
    const sidebar = read("../components/layout/app-sidebar.tsx");
    expect(sidebar).not.toContain("setStars");
    expect(sidebar).not.toContain("Upgrade your plan");
    expect(sidebar).toContain("Creator Rank");
    expect(sidebar).toContain("rank.hints");
  });

  it("the floating star widget is display-only", () => {
    const widget = read("../components/layout/floating-star-level.tsx");
    expect(widget).not.toContain("setStars");
    expect(widget).not.toContain("setExpanded");
  });

  it("the sequencer gate explains instead of granting", () => {
    const aiAudio = read("../pages/ai-audio.tsx");
    expect(aiAudio).not.toContain("setStars");
    expect(aiAudio).not.toContain("enableAdvanced");
    expect(aiAudio).toContain("gateStars >= 6");
  });

  it("the editor Pro lock points at rank, not pricing", () => {
    const editor = read("../pages/video-editor.tsx");
    expect(editor).toContain("gateStars >= 4");
    expect(editor).not.toContain("maxStars >= 4");
    expect(editor).toContain('data-testid="editor-mode-pro-locked"');
    const lockedBlock = editor.slice(editor.indexOf('data-testid="editor-mode-pro-locked"') - 400, editor.indexOf('data-testid="editor-mode-pro-locked"'));
    expect(lockedBlock).not.toContain('href="/pricing"');
  });

  it("the World level watch trusts the level-check response's earned stars", () => {
    const world = read("../pages/world.tsx");
    expect(world).toContain("checkData.stars");
    expect(world).not.toContain("level-check?currentLevel=");
  });

  it("store dashboard exposure copy follows gate stars", () => {
    const store = read("../pages/store-dashboard.tsx");
    expect(store).not.toContain("const { stars } = useUserMode();");
    expect(store).toContain("gateStars: stars");
  });
});
