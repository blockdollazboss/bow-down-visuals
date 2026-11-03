/**
 * catalog-price-truth.test.ts — the /features catalog strings
 * (src/data/features.ts) and the homepage studio cost cells in every
 * locale display the same numbers the rails charge.
 *
 * Price-accuracy audit 2026-11-02, mismatches #8 and #10:
 *  - 8 non-English locale homepages (ar/es/fr/hi/it/ja/ko/pt) showed
 *    "2 VB/min" and "1 VB/post" for home.studio[1].tools[1].cost and
 *    home.studio[2].tools[2].cost where en (and de) say 400 VB / 200 VB.
 *  - The hand-typed catalog carried the Veo per-second rate on the
 *    generic AI Video Generator, a per-second figure for Intros &
 *    Outros (whose rail resolves a 750 flat), a 200 VB Brand Deals
 *    search figure (the deal matcher charges 100) and an unnumbered
 *    "Per scene" for AI Lip Sync. The audit also listed the catalog's
 *    "From X" floors as underived; each is re-derived below — five
 *    stand as written, including Audio Studio's 75 (Guest Questions,
 *    embedded as the podcast tab, is its cheapest reachable rail).
 *
 * These pins re-derive the rail constants from the server source —
 * the same approach as collab-match-price-truth.test.ts and
 * sponsor-ai-price-truth.test.ts — and hold the catalog strings and
 * every locale catalog to them, so display and charge cannot drift
 * apart silently again. Display only — no charge moved.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getFeature, SITE_FEATURES } from "../data/features";
import { getCreditCost } from "./credit-costs";

function readApi(rel: string): string {
  return readFileSync(new URL(`../../../api-server/src/${rel}`, import.meta.url), "utf8");
}

function readLocale(code: string): Record<string, any> {
  return JSON.parse(readFileSync(new URL(`../locales/${code}.json`, import.meta.url), "utf8"));
}

/** Re-derive a server cost constant from source (env-default and
 *  plain-literal shapes), as in collab-match-price-truth.test.ts. */
function deriveServerConstant(rel: string, constant: string): number {
  const src = readApi(rel);
  const envDefault = src.match(
    new RegExp(
      `const\\s+${constant}\\s*=\\s*Number\\(process\\.env\\[["'][A-Z0-9_]+["']\\]\\)\\s*\\|\\|\\s*(\\d+)\\b`,
    ),
  );
  if (envDefault) return Number(envDefault[1]);
  const plain = src.match(
    new RegExp(`const\\s+${constant}\\s*(?::\\s*number)?\\s*=\\s*(\\d+)\\b`),
  );
  expect(plain, `${constant} in ${rel}`).toBeTruthy();
  return Number(plain![1]);
}

/** First number in a display string — the canonical numeric value of a
 *  cost cell under the audit §C census (numbers compared, wording free). */
function firstNumber(s: string): number {
  const m = s.match(/\d[\d.,\s]*\d|\d/);
  expect(m, `number in ${JSON.stringify(s)}`).toBeTruthy();
  return Number(m![0].replace(/[.,\s](?=\d{3}\b)/g, "").replace(",", "."));
}

describe("features catalog — charged == displayed (audit #10)", () => {
  it("AI Video Generator shows the generic clip rail: 400 flat, not the Veo per-second rate", () => {
    const rail = deriveServerConstant("routes/generate/clip-pricing.ts", "GEN45_CREDIT_COST");
    expect(rail).toBe(400);
    expect(getFeature("video-generator")?.creditCost).toBe(`${rail} Visual Bucs`);
  });

  it("Intros & Outros shows the primary rail's resolved flat price (5s × 150 = 750), not the per-second rate or the 350 ffmpeg rail", () => {
    const secs = deriveServerConstant(
      "routes/generate/intro-outro-pricing.ts",
      "INTRO_OUTRO_DURATION_SEC",
    );
    const perSec = deriveServerConstant(
      "routes/generate/intro-outro-pricing.ts",
      "INTRO_OUTRO_CREDITS_PER_SEC_FALLBACK",
    );
    expect(secs * perSec).toBe(750);
    // The separate ffmpeg rail exists at 350 — the catalog must not promise it.
    expect(
      deriveServerConstant("routes/generate/intro-outro-ffmpeg.ts", "INTRO_OUTRO_COST"),
    ).toBe(350);
    expect(getFeature("intros-outros")?.creditCost).toBe("750 Visual Bucs");
  });

  it("Brand Deals shows the deal matcher price it names: 100/search", () => {
    const rail = deriveServerConstant("routes/generate/sponsors.ts", "SPONSOR_AI_CREDIT_COST");
    expect(rail).toBe(100);
    expect(getFeature("brand-deals")?.creditCost).toBe(`${rail} Visual Bucs/search`);
  });

  it("AI Lip Sync names the real tier: 300 per clip to 50s, 600 for 50–60s", () => {
    const rail = deriveServerConstant("routes/lip-sync.ts", "LIP_SYNC_PREVIEW_CREDIT_COST");
    expect(rail).toBe(300);
    const shown = getFeature("lip-sync")?.creditCost ?? "";
    expect(shown).toContain(`${rail} Visual Bucs per clip`);
    // 600 VB for 50–60s clips — owner ruling 2026-11-02, banked in
    // stack1400's duration-tiered lip-sync rail; pinned here as the
    // ruled catalog figure so the tier cannot silently vanish.
    expect(shown).toContain("600 Visual Bucs for 50–60s");
  });

  it("Audio Studio floor stands at 75 — Guest Questions is its cheapest reachable rail", () => {
    // Guest Questions (75) is embedded in Audio Studio as the podcast
    // tab; every other Audio Studio rail is 100+. The audit listed the
    // From-floors as underived; this floor IS derived (also pinned by
    // price-honesty-2.test.ts) and must not be "corrected" to 100.
    expect(getCreditCost("/api/guest-questions")?.cost).toBe(75);
    expect(getFeature("audio-studio")?.creditCost).toBe("From 75 Visual Bucs");
  });

  it("the remaining From-floors match their rails", () => {
    expect(deriveServerConstant("routes/generate/thumbnail-generator.ts", "BATCH_CREDIT_COST")).toBe(200);
    expect(getFeature("thumbnail-maker")?.creditCost).toBe("From 200 Visual Bucs");

    expect(deriveServerConstant("routes/generate/logo-pricing.ts", "LOGO_STANDARD_CREDIT_COST")).toBe(100);
    expect(getFeature("logo-maker")?.creditCost).toBe("From 100 Visual Bucs");

    expect(
      deriveServerConstant("routes/generate/distribution.ts", "DISTRIBUTION_RELEASE_CREDITS"),
    ).toBe(1000);
    expect(getFeature("distribute")?.creditCost).toBe("From 1,000 Visual Bucs");

    expect(deriveServerConstant("routes/artist-voices.ts", "CLONE_CREDIT_COST")).toBe(200);
    expect(getFeature("voice-lock")?.creditCost).toBe("From 200 Visual Bucs");

    expect(
      deriveServerConstant("routes/generate/artist-image-pricing.ts", "NANO_BANANA_21_CREDIT_COST"),
    ).toBe(100);
    expect(getFeature("photo-shoot")?.creditCost).toBe("From 100 Visual Bucs");
  });

  it("no catalog entry still carries a stale figure from the audit", () => {
    for (const f of SITE_FEATURES) {
      expect(f.creditCost, f.key).not.toContain("150 Visual Bucs/sec");
      expect(f.creditCost, f.key).not.toBe("Per scene");
    }
    expect(getFeature("brand-deals")?.creditCost).not.toContain("200");
  });
});

describe("locale homepage studio costs — numbers aligned to en (audit #8)", () => {
  const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];

  it("home.studio[1].tools[1].cost is 400 in every locale", () => {
    for (const code of LOCALES) {
      const cost = readLocale(code)?.home?.studio?.[1]?.tools?.[1]?.cost;
      expect(typeof cost, code).toBe("string");
      expect(firstNumber(cost), `${code}: ${cost}`).toBe(400);
    }
  });

  it("home.studio[2].tools[2].cost is 200 in every locale", () => {
    for (const code of LOCALES) {
      const cost = readLocale(code)?.home?.studio?.[2]?.tools?.[2]?.cost;
      expect(typeof cost, code).toBe("string");
      expect(firstNumber(cost), `${code}: ${cost}`).toBe(200);
    }
  });

  it("every studio cost cell in every locale carries en's number (§C census, studio block)", () => {
    const en = readLocale("en");
    for (const code of LOCALES) {
      const loc = readLocale(code);
      for (let s = 0; s < 4; s++) {
        for (let t = 0; t < 3; t++) {
          const ev = en.home.studio[s].tools[t].cost;
          const lv = loc?.home?.studio?.[s]?.tools?.[t]?.cost;
          expect(typeof lv, `${code} studio[${s}].tools[${t}]`).toBe("string");
          expect(firstNumber(lv), `${code} studio[${s}].tools[${t}]: ${lv} vs en ${ev}`).toBe(
            firstNumber(ev),
          );
        }
      }
    }
  });
});
