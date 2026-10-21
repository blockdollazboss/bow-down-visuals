import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Locale parity guard for videoEditor.subjectReframe — the Smart
 * Reframe (Subject Tracking) card's namespace. The newest editor
 * namespaces historically shipped English-only in the other nine
 * catalogs (they fall back silently); this namespace must not: every
 * locale carries every key with the same interpolation placeholders.
 * Also pins that every key the card/helper actually references exists
 * in the catalogs, so a renamed key fails here instead of rendering a
 * raw key to a creator.
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const load = (loc: string) => JSON.parse(read(`../locales/${loc}.json`)) as any;

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"];
const catalogs = Object.fromEntries(LOCALES.map((l) => [l, load(l)]));
const enBlock = catalogs.en?.videoEditor?.subjectReframe as Record<string, string>;
const enKeys = Object.keys(enBlock ?? {});

const placeholders = (v: string) => (v.match(/\{\{\w+\}\}/g) ?? []).sort();

/** Keys referenced by the card (static t() calls + aspect/platform maps). */
const cardSrc = read("../components/editor/SubjectReframeCard.tsx");
const referenced = new Set<string>(
  [...cardSrc.matchAll(/videoEditor\.subjectReframe\.([A-Za-z]+)/g)].map((m) => m[1]),
);
/** Reason keys are built dynamically from the helper's closed mapping. */
const helperSrc = read("./subject-reframe.ts");
for (const m of helperSrc.matchAll(/return "(reason[A-Za-z]+)"/g)) referenced.add(m[1]);

describe("locale parity — videoEditor.subjectReframe", () => {
  it("en carries the full namespace", () => {
    expect(enKeys.length).toBeGreaterThanOrEqual(48);
  });

  it("every key the card references exists in en", () => {
    expect(referenced.size).toBeGreaterThan(30);
    for (const key of referenced) {
      expect(enBlock, `en missing referenced key ${key}`).toHaveProperty(key);
    }
  });

  it.each(LOCALES.filter((l) => l !== "en"))("%s has every subjectReframe key, non-empty", (loc) => {
    const block = catalogs[loc]?.videoEditor?.subjectReframe as Record<string, string> | undefined;
    expect(block, `${loc} missing videoEditor.subjectReframe`).toBeDefined();
    expect(Object.keys(block!).sort()).toEqual([...enKeys].sort());
    for (const key of enKeys) {
      expect(typeof block![key]).toBe("string");
      expect(block![key].trim().length).toBeGreaterThan(0);
    }
  });

  it.each(LOCALES.filter((l) => l !== "en"))("%s placeholders match en exactly per key", (loc) => {
    const block = catalogs[loc].videoEditor.subjectReframe as Record<string, string>;
    for (const key of enKeys) {
      expect(placeholders(block[key]), `${loc}:${key}`).toEqual(placeholders(enBlock[key]));
    }
  });
});
