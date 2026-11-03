/**
 * caption-style-once.test.ts — stack1400 org/design wave #2, audit §4.4 #10.
 *
 * Pins "captions styled ONCE": the project CaptionSettings
 * (settings.captions — read by the master-player preview layer, persisted
 * by project save via normalizeEditorSettings, and consumed whole by the
 * main burned export) is the single source for the AI Caption Suite's
 * burn controls and for the saved caption file.
 *
 * Seams pinned here:
 *  1. Editor → burn: burn params derive FROM settings.captions.
 *  2. Burn → editor: a Suite pick writes back into settings.captions,
 *     preserving lines + unrelated fields (so preview/save/export follow).
 *  3. Save seam: the styled settings survive normalizeEditorSettings —
 *     the exact function project load applies to the saved blob.
 *  4. Saved file: the WebVTT style derivation carries the chosen style.
 */
import { describe, it, expect } from "vitest";
import {
  suiteBurnStyleFromSettings,
  settingsWithSuiteBurnStyle,
  captionVttStyleBlock,
  captionVttCueSettings,
  isWordsyncStyleKey,
  isTranscriptStyleKey,
} from "./caption-style-once";
import {
  defaultEditorSettings,
  normalizeEditorSettings,
  type CaptionSettings,
} from "./editor-settings";

function styledCaptions(overrides: Partial<CaptionSettings> = {}): CaptionSettings {
  return {
    ...defaultEditorSettings().captions,
    stylePreset: "gold-hiphop",
    position: "Top",
    fontSize: "Large",
    lines: [{ id: "l1", startSec: 0, endSec: 2, text: "hello" }],
    ...overrides,
  };
}

describe("editor style → Suite burn params (no re-ask)", () => {
  it("derives wordsync style/position/size from the project caption style", () => {
    expect(suiteBurnStyleFromSettings(styledCaptions(), "wordsync")).toEqual({
      styleKey: "luxury-gold",
      position: "top",
      fontSize: "large",
    });
  });

  it("derives transcript style from the same one source", () => {
    expect(suiteBurnStyleFromSettings(styledCaptions(), "transcript").styleKey).toBe("karaoke");
    expect(
      suiteBurnStyleFromSettings(styledCaptions({ stylePreset: "boxed" }), "transcript").styleKey,
    ).toBe("word-by-word");
    expect(
      suiteBurnStyleFromSettings(styledCaptions({ stylePreset: "clean-white" }), "transcript").styleKey,
    ).toBe("bold-outline");
  });

  it("maps every project preset into both burn vocabularies", () => {
    const presets = [
      "clean-white", "gold-hiphop", "karaoke", "boxed", "viral-shorts", "minimal",
      "drill", "luxury", "rnb", "kids", "neon-glow", "pill-pop", "brutalist", "karaoke-word",
    ] as const;
    for (const p of presets) {
      const c = styledCaptions({ stylePreset: p });
      expect(isWordsyncStyleKey(suiteBurnStyleFromSettings(c, "wordsync").styleKey), p).toBe(true);
      expect(isTranscriptStyleKey(suiteBurnStyleFromSettings(c, "transcript").styleKey), p).toBe(true);
    }
  });

  it("Lower Third burns at the bottom; XL clamps to the burn catalogue's large", () => {
    const c = styledCaptions({ position: "Lower Third", fontSize: "XL" });
    expect(suiteBurnStyleFromSettings(c, "wordsync")).toMatchObject({ position: "bottom", fontSize: "large" });
  });
});

describe("Suite pick → project caption style (preview/save/export inherit)", () => {
  it("writes a wordsync pick back as the closest project preset + position + size", () => {
    const next = settingsWithSuiteBurnStyle(styledCaptions(), "wordsync", {
      styleKey: "neon",
      position: "middle",
      fontSize: "small",
    });
    expect(next.stylePreset).toBe("neon-glow");
    expect(next.position).toBe("Center");
    expect(next.fontSize).toBe("Small");
  });

  it("writes a transcript pick back as the closest project preset", () => {
    const next = settingsWithSuiteBurnStyle(styledCaptions(), "transcript", { styleKey: "word-by-word" });
    expect(next.stylePreset).toBe("boxed");
  });

  it("preserves caption lines and unrelated fields on write-back", () => {
    const before = styledCaptions({ textColor: "#ff00aa", outline: false, maxWidth: "70%" });
    const next = settingsWithSuiteBurnStyle(before, "wordsync", { styleKey: "minimal" });
    expect(next.lines).toEqual(before.lines);
    expect(next.textColor).toBe("#ff00aa");
    expect(next.outline).toBe(false);
    expect(next.maxWidth).toBe("70%");
    expect(next.stylePreset).toBe("minimal");
  });

  it("round-trips: every burn key derives back to itself after write-back", () => {
    const wordsync = ["hormozi", "minimal", "karaoke", "neon", "luxury-gold"];
    const transcript = ["karaoke", "word-by-word", "minimal", "bold-outline", "neon"];
    for (const k of wordsync) {
      const written = settingsWithSuiteBurnStyle(styledCaptions(), "wordsync", { styleKey: k });
      expect(suiteBurnStyleFromSettings(written, "wordsync").styleKey, k).toBe(k);
    }
    for (const k of transcript) {
      const written = settingsWithSuiteBurnStyle(styledCaptions(), "transcript", { styleKey: k });
      expect(suiteBurnStyleFromSettings(written, "transcript").styleKey, k).toBe(k);
    }
    for (const pos of ["top", "middle", "bottom"] as const) {
      const written = settingsWithSuiteBurnStyle(styledCaptions(), "wordsync", { position: pos });
      expect(suiteBurnStyleFromSettings(written, "wordsync").position, pos).toBe(pos);
    }
    for (const size of ["small", "medium", "large"] as const) {
      const written = settingsWithSuiteBurnStyle(styledCaptions(), "wordsync", { fontSize: size });
      expect(suiteBurnStyleFromSettings(written, "wordsync").fontSize, size).toBe(size);
    }
  });

  it("an unknown style key never corrupts the project preset", () => {
    const next = settingsWithSuiteBurnStyle(styledCaptions(), "wordsync", { styleKey: "bogus" });
    expect(next.stylePreset).toBe("gold-hiphop");
  });
});

describe("save seam — the saved project keeps the one style", () => {
  it("styled captions survive normalizeEditorSettings (project load)", () => {
    const styled = styledCaptions();
    const roundTripped = normalizeEditorSettings({ captions: styled } as never);
    expect(roundTripped.captions.stylePreset).toBe("gold-hiphop");
    expect(roundTripped.captions.position).toBe("Top");
    expect(roundTripped.captions.fontSize).toBe("Large");
    expect(roundTripped.captions.lines).toEqual(styled.lines);
  });

  it("a Suite write-back is what the export path consumes (same fields, same object)", () => {
    /* FinalVideoExport sends settings.captions whole as the export
       payload's `captions`; export-video feeds it to buildAssContent as
       CaptionBurnConfig (stylePreset/position/fontSize/fontFamily/
       textColor/outline/background). Pin those fields on the written-back
       object — the burn reads exactly this. */
    const next = settingsWithSuiteBurnStyle(styledCaptions(), "wordsync", {
      styleKey: "karaoke",
      position: "top",
      fontSize: "large",
    });
    const burnFields = {
      stylePreset: next.stylePreset,
      position: next.position,
      fontSize: next.fontSize,
      fontFamily: next.fontFamily,
      textColor: next.textColor,
      outline: next.outline,
      background: next.background,
    };
    expect(burnFields.stylePreset).toBe("karaoke");
    expect(burnFields.position).toBe("Top");
    expect(burnFields.fontSize).toBe("Large");
    expect(burnFields.fontFamily).toBe(styledCaptions().fontFamily);
  });
});

describe("saved caption file inherits the style (WebVTT)", () => {
  it("STYLE block carries the preset's signature color and the chosen size", () => {
    const block = captionVttStyleBlock(styledCaptions());
    expect(block).toContain("#FFD700"); // gold-hiphop signature gold
    expect(block).toContain("1.4em"); // Large
    expect(block).toContain("::cue");
  });

  it("an explicit text color pick wins over the preset color", () => {
    expect(captionVttStyleBlock(styledCaptions({ textColor: "#00ffcc" }))).toContain("#00ffcc");
  });

  it("background + outline toggles ride into the saved file's style", () => {
    const block = captionVttStyleBlock(styledCaptions({ background: true, outline: true }));
    expect(block).toContain("background-color: rgba(0,0,0,0.72)");
    expect(block).toContain("text-shadow:");
  });

  it("cue placement follows the chosen position", () => {
    expect(captionVttCueSettings(styledCaptions({ position: "Top" }))).toContain("line:8%");
    expect(captionVttCueSettings(styledCaptions({ position: "Center" }))).toContain("line:50%");
    expect(captionVttCueSettings(styledCaptions({ position: "Lower Third" }))).toContain("line:88%");
  });
});
