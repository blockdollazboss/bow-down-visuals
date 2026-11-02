/**
 * stage-drop-booking-i18n — the catalog pins for the stage-booking
 * block (worldStageBooking) and the drop bench (admin.worldDrops),
 * stack1300.
 *
 * EXTRACTION: every English key in both namespaces is referenced by
 * its component (the seam-error keys ride the dynamic
 * `errors.${code}` lookup, so those are pinned against the seam
 * files, where the codes live as literals). A renumbered or dropped
 * key is a bug the moment the strings ship in all 10 locales.
 *
 * PARITY: all ten catalogs carry the full key set — a missing key
 * would print the raw key name to a member in that language.
 *
 * MONEY LINES: the drop money-policy lines (the weekly budget, the
 * per-claim range, the claims format, the amount refusal) state the
 * rails' own figures and stay ENGLISH in every catalog, exactly as
 * the rails state them — the gift-desk precedent.
 *
 * The nine non-English sets are AGENT-DRAFTED and UNREVIEWED; the
 * interpolation placeholders are pinned so a translation can never
 * drop the hour, the room, or the figures out of a sentence.
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

const en = loadLocale("en");
const enStage = flatten((en as { worldStageBooking: unknown }).worldStageBooking);
const enDrops = flatten((en as { admin: { worldDrops: unknown } }).admin.worldDrops);

const stageComponent = readFileSync(join(SRC, "components/world/native/StageBookingBlock.tsx"), "utf8");
const stageSeam = readFileSync(join(SRC, "lib/world/stage-booking.ts"), "utf8");
const dropComponent = readFileSync(join(SRC, "components/WorldDropAdmin.tsx"), "utf8");
const dropSeam = readFileSync(join(SRC, "lib/world/drop-booking.ts"), "utf8");

const MONEY_KEYS = ["budgetLine", "rangeLine", "claimsLine", "errors.amountRange"];

describe("stage/drop booking i18n — extraction", () => {
  it("the English stage catalog is complete and non-empty", () => {
    expect(enStage.size).toBeGreaterThanOrEqual(40);
    for (const [key, value] of enStage) expect(value.trim().length, key).toBeGreaterThan(0);
  });

  it("every non-error stage key is referenced by the block", () => {
    for (const key of enStage.keys()) {
      if (key.startsWith("errors.")) continue;
      expect(stageComponent.includes(`worldStageBooking.${key}`), key).toBe(true);
    }
    expect(stageComponent).toContain("worldStageBooking.errors.");
  });

  it("every stage error code lives in the seam as a literal", () => {
    for (const key of enStage.keys()) {
      if (!key.startsWith("errors.")) continue;
      const code = key.slice("errors.".length);
      expect(stageSeam.includes(`"${code}"`), code).toBe(true);
    }
  });

  it("every non-error drop key is referenced by the bench", () => {
    for (const key of enDrops.keys()) {
      if (key.startsWith("errors.")) continue;
      expect(dropComponent.includes(`admin.worldDrops.${key}`), key).toBe(true);
    }
    expect(dropComponent).toContain("admin.worldDrops.errors.");
  });

  it("every drop error code lives in the seam as a literal", () => {
    for (const key of enDrops.keys()) {
      if (!key.startsWith("errors.")) continue;
      const code = key.slice("errors.".length);
      expect(dropSeam.includes(`"${code}"`), code).toBe(true);
    }
  });
});

describe("stage/drop booking i18n — parity across all ten catalogs", () => {
  for (const code of LOCALES) {
    it(`${code} carries the full key set in both namespaces`, () => {
      const loc = loadLocale(code);
      const stage = flatten((loc as { worldStageBooking: unknown }).worldStageBooking);
      const drops = flatten((loc as { admin: { worldDrops: unknown } }).admin.worldDrops);
      expect([...stage.keys()].sort(), `${code} stage keys`).toEqual([...enStage.keys()].sort());
      expect([...drops.keys()].sort(), `${code} drop keys`).toEqual([...enDrops.keys()].sort());
      for (const [key, value] of stage) expect(value.trim().length, `${code} ${key}`).toBeGreaterThan(0);
      for (const [key, value] of drops) expect(value.trim().length, `${code} ${key}`).toBeGreaterThan(0);
    });
  }
});

describe("stage/drop booking i18n — the money lines stay the rails' words", () => {
  for (const code of LOCALES) {
    it(`${code} keeps the money lines in English, exactly as the rails state them`, () => {
      const loc = loadLocale(code);
      const drops = flatten((loc as { admin: { worldDrops: unknown } }).admin.worldDrops);
      for (const key of MONEY_KEYS) {
        expect(drops.get(key), `${code} ${key}`).toBe(enDrops.get(key));
      }
    });
  }

  it("the English money lines carry the rails' own figures", () => {
    expect(enDrops.get("budgetLine")).toContain("1,000 Visual Bucs");
    expect(enDrops.get("rangeLine")).toContain("100 and 1,000 Visual Bucs");
    expect(enDrops.get("errors.amountRange")).toContain("100 and 1,000 Visual Bucs");
    expect(enDrops.get("claimsLine")).toContain("Visual Bucs");
  });
});

describe("stage/drop booking i18n — placeholders survive translation", () => {
  for (const code of LOCALES) {
    it(`${code} keeps the interpolation slots`, () => {
      const loc = loadLocale(code);
      const stage = flatten((loc as { worldStageBooking: unknown }).worldStageBooking);
      const drops = flatten((loc as { admin: { worldDrops: unknown } }).admin.worldDrops);
      expect(stage.get("booked"), code).toContain("{{when}}");
      expect(stage.get("cancelled"), code).toContain("{{title}}");
      expect(stage.get("lengthMin"), code).toContain("{{count}}");
      expect(stage.get("lengthHr"), code).toContain("{{count}}");
      expect(drops.get("booked"), code).toContain("{{title}}");
      expect(drops.get("booked"), code).toContain("{{room}}");
      expect(drops.get("booked"), code).toContain("{{when}}");
      expect(drops.get("claimsLine"), code).toContain("{{amount}}");
      expect(drops.get("claimsLine"), code).toContain("{{count}}");
    });
  }
});
