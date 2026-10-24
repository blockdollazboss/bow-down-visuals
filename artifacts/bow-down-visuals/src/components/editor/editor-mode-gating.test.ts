import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  effectiveMusicMode,
  modeGateForTab,
  musicModeLocked,
  proSwitchShowsUnlocked,
} from "@/lib/editor-mode-gate";

/**
 * Stack-100 #3 Wave 3 Lane 6 — mode-gating honesty pins.
 *
 * Board item (Lane D board-editor.md, "Mode gating"): in Simple mode the
 * Music mode switch was hidden (Manual DAW + Lip Sync unreachable, and a
 * destructive effect rewrote the stored music mode to "auto"), and
 * ExportDoctor was Pro-mode only — features vanished silently instead of
 * reading as gates. The rule now: a gated feature is VISIBLE and locked
 * with its reason, and the unlocking mode actually unlocks it.
 */

const page = readFileSync(new URL("../../pages/video-editor.tsx", import.meta.url), "utf8");
const musicStudio = readFileSync(new URL("./music/MusicStudio.tsx", import.meta.url), "utf8");
const exportSection = readFileSync(new URL("./sections/ExportSection.tsx", import.meta.url), "utf8");

const SIMPLE_VISIBLE = ["music", "clips", "templates", "pre-production", "lip-sync", "timeline", "captions", "promo-clips", "export"];

describe("modeGateForTab — the one gate decision for editor tabs", () => {
  it("Simple: a visible tab is not gated; a hidden tab is gated as advanced", () => {
    for (const tab of SIMPLE_VISIBLE) {
      expect(modeGateForTab(true, tab, SIMPLE_VISIBLE)).toBeNull();
    }
    for (const tab of ["effects", "branding", "studio", "pro-tools", "copilot", "edit-recipes"]) {
      expect(modeGateForTab(true, tab, SIMPLE_VISIBLE)).toBe("advanced");
    }
  });

  it("Advanced: nothing is gated — switching modes actually unlocks", () => {
    for (const tab of [...SIMPLE_VISIBLE, "effects", "branding", "studio", "pro-tools"]) {
      expect(modeGateForTab(false, tab, SIMPLE_VISIBLE)).toBeNull();
    }
  });

  it("the page's SIMPLE_VISIBLE_TABS matches the set this rule is tested against", () => {
    const match = page.match(/const SIMPLE_VISIBLE_TABS: EditorTab\[\] = \[([^\]]+)\]/);
    expect(match).not.toBeNull();
    const listed = [...match![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...SIMPLE_VISIBLE].sort());
  });
});

describe("music mode gate — presentation only, stored mode preserved", () => {
  it("effectiveMusicMode: Simple renders auto, Advanced renders the stored mode", () => {
    expect(effectiveMusicMode(true, "manual")).toBe("auto");
    expect(effectiveMusicMode(true, "lipsync")).toBe("auto");
    expect(effectiveMusicMode(true, "auto")).toBe("auto");
    expect(effectiveMusicMode(false, "manual")).toBe("manual");
    expect(effectiveMusicMode(false, "lipsync")).toBe("lipsync");
    expect(effectiveMusicMode(false, "auto")).toBe("auto");
  });

  it("musicModeLocked: only Manual / Lip Sync lock, and only in Simple", () => {
    expect(musicModeLocked(true, "manual")).toBe(true);
    expect(musicModeLocked(true, "lipsync")).toBe(true);
    expect(musicModeLocked(true, "auto")).toBe(false);
    expect(musicModeLocked(false, "manual")).toBe(false);
    expect(musicModeLocked(false, "lipsync")).toBe(false);
  });

  it("MusicStudio never rewrites the stored mode in Simple (no stranded music)", () => {
    expect(musicStudio).not.toContain('musicStudio: { ...ms, mode: "auto" }');
    expect(musicStudio).toContain("effectiveMusicMode(isSimple, ms.mode)");
    expect(musicStudio).toContain('effectiveMode === "manual"');
    expect(musicStudio).toContain('effectiveMode === "lipsync"');
  });

  it("MusicStudio switcher is always rendered, gated modes locked + labelled", () => {
    expect(musicStudio).not.toContain("{!isSimple && (\n        <div className=\"flex p-1 rounded-xl bg-black");
    expect(musicStudio).toContain('data-mode-gate={locked ? "advanced" : undefined}');
    expect(musicStudio).toContain('data-testid="music-mode-gate-note"');
    expect(musicStudio).toContain("Advanced-mode tools — switch the editor to Advanced in the top bar");
    expect(musicStudio).toContain("musicModeLocked(isSimple, m.id)");
  });

  it("MusicStudio Upload button is locked in Simple instead of pointing at a hidden DAW", () => {
    expect(musicStudio).toContain("disabled={isSimple}");
    expect(musicStudio).toContain("Upload & stem mixing live in the Manual DAW — an Advanced-mode tool");
  });
});

describe("pro switch — gate stars, but never lock a user out of their current mode", () => {
  it("below Creator Level 4 in Simple: locked segment", () => {
    expect(proSwitchShowsUnlocked(1, true)).toBe(false);
    expect(proSwitchShowsUnlocked(3, true)).toBe(false);
  });
  it("at/above Creator Level 4: unlocked in both modes", () => {
    expect(proSwitchShowsUnlocked(4, true)).toBe(true);
    expect(proSwitchShowsUnlocked(6, true)).toBe(true);
    expect(proSwitchShowsUnlocked(4, false)).toBe(true);
  });
  it("already in Advanced below L4: segment renders active (Turbo stays reachable)", () => {
    expect(proSwitchShowsUnlocked(2, false)).toBe(true);
  });
  it("the page uses the helper and keeps the labelled locked segment", () => {
    expect(page).toContain("proSwitchShowsUnlocked(gateStars, isSimple)");
    expect(page).toContain('data-testid="editor-mode-pro-locked"');
    expect(page).toContain("Advanced mode unlocks at Creator Level 4 (Shot Caller)");
    expect(page).not.toContain("Pro is plan-gated");
  });
});

describe("editor rails — gated sections render locked, never filtered away", () => {
  it("the old silent Simple filters are gone from both rails", () => {
    expect(page).not.toContain('(["clips", "templates", "music", "lip-sync", "timeline", "captions"] as string[])');
    expect(page).not.toContain('(["promo-clips", "export"] as string[])');
  });
  it("both rails consult the single gate decision and label the lock", () => {
    const occurrences = page.split('modeGateForTab(isSimple, item.id, SIMPLE_VISIBLE_TABS)').length - 1;
    expect(occurrences).toBe(2);
    expect(page).toContain('data-mode-gate={gated ? "advanced" : undefined}');
    expect(page).toContain("Advanced mode only. Switch the editor to Advanced in the top bar to use it.");
  });
  it("setTab still refuses gated tabs in Simple — but states the reason", () => {
    expect(page).toContain('modeGateForTab(isSimple, t, SIMPLE_VISIBLE_TABS) === "advanced"');
    expect(page).toContain("is an Advanced-mode section");
    expect(page).toContain('const next = gated ? "clips" : t;');
  });
});

describe("export tab — every setting-carrying Simple gate is a visible locked card", () => {
  it("ExportDoctor: real component in Advanced, labelled gate card in Simple", () => {
    expect(exportSection).toContain("<ExportDoctor");
    expect(exportSection).toContain('testId="export-doctor-gate"');
    expect(exportSection).toContain("Export Doctor is an Advanced-mode tool");
  });
  it("Audio Options, Caption Export and Export Range gates name the still-applied setting", () => {
    expect(exportSection).toContain('testId="export-audio-options-gate"');
    expect(exportSection).toContain('testId="export-caption-export-gate"');
    expect(exportSection).toContain('testId="export-range-gate"');
    expect(exportSection).toContain("still apply to this export");
  });
  it("Resolution renders a locked read-only row in Simple instead of vanishing", () => {
    expect(exportSection).toContain('data-testid="export-resolution-gate"');
    expect(exportSection).toContain("Advanced mode to change · platform presets below still apply");
  });
  it("all gate cards carry the shared mode-gate marker", () => {
    expect(exportSection).toContain('data-mode-gate="advanced"');
    expect(exportSection).toContain("function ModeGateCard");
  });
});
