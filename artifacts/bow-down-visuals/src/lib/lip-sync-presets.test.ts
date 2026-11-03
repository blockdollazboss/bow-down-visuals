import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultEditorSettings } from "./editor-settings";
import {
  LIP_SYNC_PRESETS,
  activeLipSyncPreset,
  applyLipSyncPreset,
  getLipSyncPreset,
  lipSyncPresetSummary,
  lipSyncSettingsMatchPreset,
} from "./lip-sync-presets";

/**
 * Lip-sync starter presets (stack1400 org/design wave #3, item 1).
 *
 * Pins:
 *  (a) the registry exists, and every preset field maps to a REAL field
 *      of the existing lip-sync form (the keys of EditorSettings.lipSync,
 *      with values inside the form controls' own vocabularies);
 *  (b) applying a preset is a pure prefill — it changes only the preset's
 *      own lip-sync fields, preserves the creator's scene choice and
 *      uploaded stem, and the section code that wires the picker contains
 *      no charge / submit / fetch on the preset path;
 *  (c) labels are honest — the rendered summary is built from the
 *      settings themselves, and no preset copy names a provider or
 *      mentions price.
 */

const sectionSrc = readFileSync(
  new URL(
    "../components/editor/sections/LipSyncSection.tsx",
    import.meta.url,
  ),
  "utf8",
);

describe("lip-sync starter preset registry", () => {
  it("exists with a real shelf of starters and unique ids", () => {
    expect(LIP_SYNC_PRESETS.length).toBeGreaterThanOrEqual(6);
    const ids = LIP_SYNC_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of LIP_SYNC_PRESETS) {
      expect(p.name.trim().length).toBeGreaterThan(0);
      expect(p.tagline.trim().length).toBeGreaterThan(0);
      expect(p.description.trim().length).toBeGreaterThan(0);
      expect(getLipSyncPreset(p.id)).toBe(p);
    }
    expect(getLipSyncPreset("no-such-preset")).toBeNull();
  });

  it("(a) every preset field maps to a real lip-sync form field", () => {
    const formKeys = Object.keys(defaultEditorSettings().lipSync);
    for (const preset of LIP_SYNC_PRESETS) {
      const keys = Object.keys(preset.settings);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(formKeys, `${preset.id}.${key}`).toContain(key);
      }
      /* A preset never picks the creator's scene or invents a stem. */
      expect(keys).not.toContain("selectedSceneId");
      expect(keys).not.toContain("uploadedVocalStemUrl");
    }
  });

  it("(a) preset values stay inside the form controls' own vocabularies", () => {
    for (const preset of LIP_SYNC_PRESETS) {
      expect(["low", "medium", "high"]).toContain(preset.settings.strength);
      expect(["vocals", "full"]).toContain(preset.settings.audioSource);
      /* The form labels both preserve toggles "Always on" — a starter
         may never turn them off. */
      expect(preset.settings.preserveFaceIdentity).toBe(true);
      expect(preset.settings.preserveArtistLook).toBe(true);
      expect(preset.settings.enabled).toBe(true);
    }
    /* The shelf covers every strength × audio-source combination the
       form offers, so no dial pairing is left blank-slate. */
    const combos = new Set(
      LIP_SYNC_PRESETS.map(
        (p) => `${p.settings.strength}/${p.settings.audioSource}`,
      ),
    );
    expect(combos).toEqual(
      new Set([
        "low/vocals",
        "medium/vocals",
        "high/vocals",
        "low/full",
        "medium/full",
        "high/full",
      ]),
    );
  });

  it("(c) each description states the exact settings the preset applies", () => {
    const strengthWord = { low: "Low", medium: "Medium", high: "High" };
    const audioWord = { vocals: "Vocals Only", full: "Full Mix" };
    for (const preset of LIP_SYNC_PRESETS) {
      expect(preset.description).toContain(
        strengthWord[preset.settings.strength],
      );
      expect(preset.description).toContain(
        audioWord[preset.settings.audioSource],
      );
      /* The rendered summary is derived from the settings, so the card
         can never claim more than the prefill sets. */
      const summary = lipSyncPresetSummary(preset);
      expect(summary).toContain(
        `Strength: ${strengthWord[preset.settings.strength]}`,
      );
      expect(summary).toContain(
        `Audio: ${audioWord[preset.settings.audioSource]}`,
      );
    }
  });

  it("(c) no preset copy names a provider or mentions price", () => {
    const banned =
      /sync\.so|sync labs|latentsync|wavespeed|hedra|heygen|d-id|runway|elevenlabs|openai|stripe/i;
    for (const preset of LIP_SYNC_PRESETS) {
      const copy = `${preset.name} ${preset.tagline} ${preset.description}`;
      expect(copy).not.toMatch(banned);
      expect(copy).not.toMatch(/visual bucs|\bVB\b|\$\s?\d|free generation/i);
    }
  });
});

describe("applying a lip-sync starter preset", () => {
  it("(b) prefills exactly the preset's fields and nothing else", () => {
    const base = defaultEditorSettings();
    const custom = {
      ...base,
      lipSync: {
        ...base.lipSync,
        enabled: false,
        strength: "low" as const,
        audioSource: "full" as const,
        selectedSceneId: "scene-42",
        uploadedVocalStemUrl: "https://example.test/vocal.mp3",
      },
    };
    const preset = getLipSyncPreset("big-performance")!;
    const next = applyLipSyncPreset(custom, preset);

    expect(next.lipSync.strength).toBe("high");
    expect(next.lipSync.audioSource).toBe("vocals");
    expect(next.lipSync.enabled).toBe(true);
    expect(next.lipSync.preserveFaceIdentity).toBe(true);
    expect(next.lipSync.preserveArtistLook).toBe(true);
    /* The creator's own choices survive a prefill. */
    expect(next.lipSync.selectedSceneId).toBe("scene-42");
    expect(next.lipSync.uploadedVocalStemUrl).toBe(
      "https://example.test/vocal.mp3",
    );
    /* Nothing outside lipSync changes, and the input is not mutated. */
    expect(next.captions).toBe(custom.captions);
    expect(next.clips).toBe(custom.clips);
    expect(next.export).toBe(custom.export);
    expect(custom.lipSync.strength).toBe("low");
    expect(lipSyncSettingsMatchPreset(next.lipSync, preset)).toBe(true);
    expect(activeLipSyncPreset(next)).toBe(preset);
  });

  it("(b) the picker path in LipSyncSection charges and submits nothing", () => {
    /* The section actually renders the registry and applies through the
       pure helper — not literals scattered in JSX. */
    expect(sectionSrc).toContain("LIP_SYNC_PRESETS");
    expect(sectionSrc).toContain("applyLipSyncPreset");
    expect(sectionSrc).toContain('data-testid="lipsync-starter-presets"');

    const at = sectionSrc.indexOf('data-testid="lipsync-starter-presets"');
    expect(at).toBeGreaterThan(-1);
    const card = sectionSrc.slice(
      sectionSrc.lastIndexOf("<EditorCard", at),
      sectionSrc.indexOf("</EditorCard>", at),
    );
    /* Applying a starter only calls the settings setter — no fetch, no
       credit confirmation, no job submission inside the picker card. */
    expect(card).toContain("setSettings");
    expect(card).not.toContain("fetch(");
    expect(card).not.toContain("confirmedFetch");
    expect(card).not.toContain("confirmSpend");
    expect(card).not.toContain("callLipSyncBackend");
    expect(card).not.toContain("applyToSelected");
    expect(card).not.toContain("applyToAll");
    /* The card says so, plainly, next to the starters. */
    expect(card).toContain("never starts a job");
  });
});
