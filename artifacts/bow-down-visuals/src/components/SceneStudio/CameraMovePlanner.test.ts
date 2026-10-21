/**
 * CameraMovePlanner.test.ts — source pins for the Director's Camera Deck
 * (Wave 9D grown, Higgsfield G1).
 *
 * The contract pinned here:
 *  (a) the deck renders from the server's catalog endpoint, grouped by
 *      category — the client does not hardcode the 47-preset list;
 *  (b) stacking is capped at 3, conflicts are refused client-side with
 *      the rule stated, and the build sends the ordered `moves` stack
 *      (per-move intensity overrides included) on the existing
 *      confirmed 100 VB rail;
 *  (c) the Turbo Shot Designer is a FREE plain-fetch proposal: its
 *      handler never touches the credit-confirm rail, and accepting a
 *      proposal only loads the picks into local state — it never
 *      builds, charges, or writes a scene;
 *  (d) the i18n namespace carries the deck/designer copy.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(new URL("./CameraMovePlanner.tsx", import.meta.url), "utf8");
const en = JSON.parse(
  readFileSync(new URL("../../locales/en.json", import.meta.url), "utf8"),
) as any;
const planner = en.wave9.cameraMovePlanner;

function sliceBetween(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  const j = src.indexOf(end, i + start.length);
  expect(i, `start marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(j, `end marker: ${end}`).toBeGreaterThan(i);
  return src.slice(i, j);
}

describe("camera deck — the catalog comes from the server", () => {
  it("fetches the presets endpoint and renders a grouped deck", () => {
    expect(component).toContain('fetch("/api/wave9d/camera/presets"');
    expect(component).toContain('data-testid="camera-deck"');
    expect(component).toContain("group.presets.map");
  });

  it("keeps an honest fallback to the classic five if the deck can't load", () => {
    expect(component).toContain("LEGACY_IDS");
    expect(component).toContain("setDeckFallback(true)");
    expect(planner.deckFallback).toContain("classic five");
  });
});

describe("camera deck — stacking", () => {
  it("caps the stack at 3 and says so", () => {
    expect(component).toContain("const MAX_STACK = 3");
    expect(component).toContain("stack.length >= MAX_STACK");
    expect(component).toContain("stackFull");
    expect(planner.stackRule).toContain("Stack up to 3 moves");
    expect(planner.stackRule).toContain("stands alone");
  });

  it("refuses conflicts client-side with the rule stated, before any build", () => {
    const toggle = sliceBetween(component, "function togglePreset", "function cycleSlotIntensity");
    expect(toggle).toContain("conflictsWith.includes");
    expect(toggle).toContain("conflictLocked");
    expect(toggle).toContain("conflictOpposite");
    expect(toggle).toContain("setStackMsg");
  });

  it("selection order is performance order (numbered badges + ordered chips)", () => {
    expect(component).toContain("stack.findIndex");
    expect(component).toContain("{order + 1}");
    expect(component).toContain('data-testid="camera-stack"');
  });

  it("build sends the ordered moves stack on the confirmed 100 VB rail", () => {
    const build = sliceBetween(component, "async function handleBuild", "/* Turbo Shot Designer");
    expect(build).toContain('confirmedFetch("/api/wave9d/camera/prompt"');
    expect(build).toContain("moves: stack.map");
    expect(build).toContain("overrideCost: BUILD_CREDITS");
    expect(component).toContain("const BUILD_CREDITS = 100");
  });

  it("per-slot intensity overrides ride the stack picks", () => {
    expect(component).toContain("function cycleSlotIntensity");
    expect(component).toContain("slotIntensityTitle");
    expect(component).toContain("...(s.intensity ? { intensity: s.intensity } : {})");
  });

  it("applying the preview still writes prompt + camera direction into the scene", () => {
    const use = sliceBetween(component, "function handleUseInStudio", "const grouped");
    expect(use).toContain("aiVideoPrompt: preview");
    expect(use).toContain('join(" + ")');
    expect(use).toContain("cameraMovement:");
  });
});

describe("camera deck — Turbo Shot Designer acceptance discipline", () => {
  it("the design call is a plain free fetch — never the credit-confirm rail", () => {
    const design = sliceBetween(component, "async function handleDesign", "function acceptProposal");
    expect(design).toContain('fetch("/api/wave9d/camera/design"');
    expect(design).not.toContain("confirmedFetch");
    expect(design).not.toContain("overrideCost");
  });

  it("accepting a proposal ONLY loads the picks — no build, no charge, no scene write", () => {
    const accept = sliceBetween(component, "function acceptProposal", "function handleUseInStudio");
    expect(accept).toContain("setStack(proposal.moves.map");
    expect(accept).not.toContain("handleBuild");
    expect(accept).not.toContain("confirmedFetch");
    expect(accept).not.toContain("onScenesChange");
    expect(accept).not.toContain("/api/wave9d/camera/prompt");
  });

  it("the proposal card shows a reason per move and the accept/dismiss pair", () => {
    expect(component).toContain('data-testid="designer-proposal"');
    expect(component).toContain("m.reason");
    expect(component).toContain('data-testid="btn-accept-proposal"');
    expect(component).toContain("designerDismiss");
    expect(planner.designerBlurb).toContain("Nothing is applied until you accept it");
  });
});

describe("camera deck — i18n namespace", () => {
  it("carries the deck, stack, and designer copy", () => {
    for (const key of [
      "deckLabel", "deckLoading", "stackLabel", "stackEmpty", "stackFull",
      "stackRule", "conflictLocked", "conflictOpposite", "slotIntensityTitle",
      "designerTitle", "designerButton", "designerAccept", "designerAdjusted",
      "designerError", "noMove",
    ]) {
      expect(planner[key], key).toBeTruthy();
    }
    expect(Object.keys(planner.categories)).toHaveLength(10);
    expect(planner.title).toBe("Director's Camera Deck");
  });
});
