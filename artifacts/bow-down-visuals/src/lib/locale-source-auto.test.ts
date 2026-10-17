/**
 * locale-source-auto.test.ts — Stack-30 Lane E (E4).
 *
 * labelPitch.sourceAuto is the song-source toggle's automatic mode.
 * English renamed that mode to "✨ Turbo (AI picks)" when every AI
 * auto mode became Turbo — but the 9 non-English catalogs still
 * rendered their generic word for "auto" (Auto / Automático / تلقائي /
 * 自動 / 자동 …), i.e. they were translated from the pre-Turbo string
 * and never followed the rename. (The key was never English-only; it
 * was stale.) Turbo is the product's mode name, so every catalog now
 * carries "✨ Turbo" + its own translated "(AI picks)" parenthetical,
 * matching each catalog's existing labelPitch tone.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;

function sourceAuto(locale: string): string {
  const raw = readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
  const catalog = JSON.parse(raw) as { labelPitch?: { sourceAuto?: string } };
  const v = catalog.labelPitch?.sourceAuto;
  if (!v) throw new Error(`${locale}.json is missing labelPitch.sourceAuto`);
  return v;
}

describe("labelPitch.sourceAuto — the Turbo mode name in every catalog", () => {
  it("english is the canonical string", () => {
    expect(sourceAuto("en")).toBe("✨ Turbo (AI picks)");
  });

  it.each(LOCALES.filter((l) => l !== "en"))("%s names the Turbo mode, not a generic 'auto'", (locale) => {
    const v = sourceAuto(locale);
    expect(v.startsWith("✨ Turbo")).toBe(true);
    // The parenthetical stays translated — the value is not an
    // English copy wearing a Turbo hat.
    expect(v).not.toBe(sourceAuto("en"));
    expect(v).toContain("(");
  });
});
