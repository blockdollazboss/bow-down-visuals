/**
 * Create media benches i18n pins (Stack-100 locale unit 38).
 *
 * The World's Create media benches — StoryboardBench,
 * StoryboardPlanner, ScenesDesk, ThumbnailBenches, HookDesk and
 * PostAssist — rendered hard-coded English inside a 10-locale
 * product: none of the six files contained a t()/useTranslation
 * call. Their own copy now lives in the locale catalogs under
 * worldCreateMedia.*. These pins hold both halves:
 *
 *  - extraction: every one of the six files renders through
 *    useTranslation, and every catalog key in the namespace is
 *    actually referenced by one of the six (no orphan keys, no
 *    unextracted remainder in the namespace);
 *  - parity: all 10 locales carry the full extracted key set, so
 *    the benches can never silently fall back to one language
 *    again;
 *  - money law: the lines that state a specific charge (the
 *    priced run buttons and the batch-refund note) carry the
 *    English source verbatim in EVERY catalog — money copy is
 *    never agent-drafted; figures still arrive by interpolation.
 *
 * Deliberately NOT extracted (family convention): rail/enum
 * tokens rendered verbatim as identifiers (hook video types,
 * platform + CTA-goal enums, thumbnail style presets, hashtag
 * tier keys, CTA placements, the storyboard step tokens' en
 * values), rail DTO words (scene names, template/pack titles,
 * verdicts, check labels/fixes, disclaimers, variant labels),
 * and server-bound DATA strings (draft/project/clip titles,
 * the "Untitled storyboard" board title, the scheduler prefill
 * caption) — those are content the member owns, not desk copy.
 * Seam-composed labels the benches only interpolate stay with
 * their seams (transcribeCostLabel's money schedule is English
 * by the same money law).
 *
 * TRANSLATION STATUS: en is final. The other nine catalogs'
 * values are AGENT-DRAFTED and UNREVIEWED (standing stack600
 * practice), except the money lines, which are verbatim en.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];
const FILES = [
  "StoryboardBench",
  "StoryboardPlanner",
  "ScenesDesk",
  "ThumbnailBenches",
  "HookDesk",
  "PostAssist",
] as const;
const sources: Record<string, string> = {};
for (const f of FILES) {
  sources[f] = read(`../../components/world/native/${f}.tsx`);
}
const allSrc = FILES.map((f) => sources[f]).join("\n");
const en = readJson("../../locales/en.json");
const enNs = (en.worldCreateMedia ?? {}) as Record<string, string>;
const enKeys = Object.keys(enNs).sort();

const MONEY_KEYS = [
  "paWriteButton",
  "hookCostLine",
  "sbAnalyzeButton",
  "sbScenesFromSongPaid",
  "sbScenesFromPlan",
  "sbMakeClip",
  "plGenerateFrame",
  "plRemakeFrame",
  "plRetryFrame",
  "thMakeVariations",
  "thBatchNote",
  "thFreshBatch",
  "thMakeVariants",
  "thPredictClicks",
  "thApplySuggestions",
];

describe("Create media benches extraction (unit 38)", () => {
  it("all six files render through useTranslation", () => {
    for (const f of FILES) {
      expect(sources[f], f).toContain('import { useTranslation } from "react-i18next"');
      expect(sources[f], f).toContain("worldCreateMedia.");
    }
  });

  it("every extracted key is referenced by the six files (no orphans, no remainder)", () => {
    expect(enKeys.length).toBe(226);
    const referenced = new Set(
      [...allSrc.matchAll(/worldCreateMedia\.(\w+)/g)].map((m) => m[1]),
    );
    for (const key of enKeys) {
      expect(referenced.has(key), `worldCreateMedia.${key}`).toBe(true);
    }
    for (const key of referenced) {
      expect(enNs, `worldCreateMedia.${key}`).toHaveProperty(key as string);
    }
  });

  it("en copy is the benches' original wording, verbatim", () => {
    expect(enNs.scenesTitle).toBe("Local Scenes");
    expect(enNs.paDrafted).toBe(
      "Drafted into your composer below — make it yours, then post it.",
    );
    expect(enNs.paNeverPosts).toBe(
      "The draft lands in your composer — it never posts itself.",
    );
    expect(enNs.hookCostLine).toBe(
      "Costs {{cost}} Visual Bucs — shown before anything runs.",
    );
    expect(enNs.plNoFrame).toBe(
      "No frame yet — a notes-only panel. It still films from its words.",
    );
    expect(enNs.plSaveError).toBe(
      "Couldn't save — your words are still here; tap out of the box to try again.",
    );
    expect(enNs.thWinnerSaved).toBe(
      "Winner saved — it's the thumbnail your video packaging flow picks up.",
    );
    expect(enNs.thBatchNote).toContain("were refunded");
    expect(enNs.plOpenProjects).toBe("Open your projects on the website ↗");
  });

  it("numbers format in the walker's language, never hard-coded en-US", () => {
    for (const f of FILES) {
      expect(sources[f], f).not.toContain('toLocaleString("en-US")');
      expect(sources[f], f).not.toMatch(/\.toLocaleString\(\)/);
    }
    for (const f of ["ScenesDesk", "HookDesk", "StoryboardBench", "StoryboardPlanner", "ThumbnailBenches"] as const) {
      expect(sources[f], f).toContain("i18n.language");
    }
  });

  it("no extracted display literal survives in the six files", () => {
    for (const frag of [
      "Write it for me ·",
      "Local Scenes",
      "Pro benches —",
      "This session",
      "Didn&rsquo;t land",
      "Storyboard — build the whole video",
      "Storyboard planner — plan it panel by panel",
    ]) {
      expect(allSrc, frag).not.toContain(frag);
    }
  });
});

describe("Create media benches catalog parity (unit 38)", () => {
  it("all 10 locales carry exactly the extracted key set", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      expect(Object.keys(cat.worldCreateMedia ?? {}).sort(), loc).toEqual(enKeys);
    }
  });

  it("interpolation tokens survive in every locale, key for key", () => {
    const tokens = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      for (const key of enKeys) {
        expect(tokens(cat.worldCreateMedia[key]), `${loc}.${key}`).toEqual(tokens(enNs[key]!));
      }
    }
  });

  it("money lines carry the English source verbatim in every catalog", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      for (const key of MONEY_KEYS) {
        expect(cat.worldCreateMedia[key], `${loc}.${key}`).toBe(enNs[key]);
      }
    }
  });
});
