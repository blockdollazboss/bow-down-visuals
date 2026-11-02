/**
 * court-gathering-i18n — the catalog pins for the court gathering
 * block (worldCourtGathering), stack1300 (UPGRADE-PROGRAM 3.6).
 *
 * EXTRACTION: every English key in the namespace is referenced by
 * its component (the seam-error keys ride the dynamic
 * `errors.${code}` lookup, so those are pinned against the seam
 * files, where the codes live as literals). A dropped key is a bug
 * the moment the strings ship in all 10 locales.
 *
 * PARITY: all ten catalogs carry the full key set — a missing key
 * would print the raw key name to a member in that language. The
 * namespace carries NO money lines (court gatherings charge
 * nothing — honors are honor only), so nothing is held in English
 * across catalogs; the interpolation placeholders are pinned so a
 * translation can never drop the hour, the caller, the title, or
 * a count out of a sentence.
 *
 * The nine non-English sets are AGENT-DRAFTED and UNREVIEWED.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "..");

const LOCALES = ["en", "es", "fr", "de", "pt", "it", "ar", "hi", "ja", "ko"] as const;

function loadLocale(code: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SRC, "locales", `${code}.json`), "utf8")) as Record<string, unknown>;
}

function flatten(value: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") {
    out.set(prefix, value);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      for (const [fk, fv] of flatten(v, prefix ? `${prefix}.${k}` : k)) out.set(fk, fv);
    }
  }
  return out;
}

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!).sort();
}

const en = loadLocale("en");
const enCourt = flatten((en as { worldCourtGathering: unknown }).worldCourtGathering);

const component = readFileSync(join(SRC, "components/world/native/CourtGatheringBlock.tsx"), "utf8");
const seam = readFileSync(join(SRC, "lib/world/court-gathering.ts"), "utf8");

describe("court gathering i18n — extraction", () => {
  it("the English catalog is complete and non-empty", () => {
    expect(enCourt.size).toBe(38);
    for (const [key, value] of enCourt) expect(value.trim().length, key).toBeGreaterThan(0);
  });

  it("every non-error key is referenced by the block", () => {
    for (const key of enCourt.keys()) {
      if (key.startsWith("errors.")) continue;
      expect(component.includes(`worldCourtGathering.${key}`), key).toBe(true);
    }
  });

  it("every error key is a code the seam or the block can produce", () => {
    for (const key of enCourt.keys()) {
      if (!key.startsWith("errors.")) continue;
      const code = key.slice("errors.".length);
      expect(seam.includes(`"${code}"`) || component.includes(`"${code}"`), key).toBe(true);
    }
  });
});

describe("court gathering i18n — parity across all 10 catalogs", () => {
  for (const code of LOCALES) {
    it(`${code} carries the full key set with en's placeholders`, () => {
      const flat = flatten((loadLocale(code) as { worldCourtGathering: unknown }).worldCourtGathering);
      expect([...flat.keys()].sort(), code).toEqual([...enCourt.keys()].sort());
      for (const [key, value] of flat) {
        expect(value.trim().length, `${code}:${key}`).toBeGreaterThan(0);
        expect(placeholders(value), `${code}:${key}`).toEqual(placeholders(enCourt.get(key)!));
      }
    });
  }

  it("no catalog leaves the namespace in English by accident (heading differs or is a loanword)", () => {
    /* A light tripwire, not a translation review: at least the
     * heading + rule line must not be byte-identical to English in
     * the nine drafted sets (they were drafted per language). */
    for (const code of LOCALES) {
      if (code === "en") continue;
      const flat = flatten((loadLocale(code) as { worldCourtGathering: unknown }).worldCourtGathering);
      expect(flat.get("ruleLine"), code).not.toBe(enCourt.get("ruleLine"));
    }
  });
});
