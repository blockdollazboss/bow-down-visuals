/**
 * cover-art-registry-parity.test.ts — STACK100 wave 2, item 7 (A6):
 * the cover-art option lists used to exist TWICE — FE lib/cover-art.ts
 * and API routes/generate/cover-art.ts — kept in sync only by a comment
 * ("Keep the keys in sync with the API"). They had already drifted:
 * all five style blurbs differed between the picker and the rail.
 *
 * The API route is now the registry of record (it validates the keys,
 * resolves the sizes, and charges the tiers). The FE lists are the
 * mirror: they add presentation-only fields (swatch / css) and must
 * match the rail on every shared field — key, label, blurb, order —
 * by this pin, never by hand-kept copies. Tier prices pin three ways:
 * FE tiers == the API constants re-derived from source == the
 * credit-costs registry's base row.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COVER_ART_PRESETS, COVER_ART_RATIOS, COVER_ART_STYLES, COVER_ART_TIERS } from "./cover-art";
import { CREDIT_COSTS } from "./credit-costs";

function readApi(rel: string): string {
  const url = new URL(`../../../api-server/src/${rel}`, import.meta.url);
  return readFileSync(url, "utf8");
}

function readFe(rel: string): string {
  const url = new URL(`../${rel}`, import.meta.url);
  return readFileSync(url, "utf8");
}

const API_FILE = "routes/generate/cover-art.ts";
const apiSrc = readApi(API_FILE);

interface RegistryEntry {
  key: string;
  label: string;
  blurb: string;
}

/** Extract the shared {key,label,blurb} contract from one of the API
 * route's `export const … = [ … ] as const` lists, in source order. */
function extractApiEntries(constName: string): RegistryEntry[] {
  const start = apiSrc.indexOf(`export const ${constName}`);
  expect(start, `${constName} in ${API_FILE}`).toBeGreaterThanOrEqual(0);
  const end = apiSrc.indexOf("] as const", start);
  expect(end, `${constName} closing bracket`).toBeGreaterThan(start);
  const block = apiSrc.slice(start, end);
  const entries: RegistryEntry[] = [];
  const re = /key:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*blurb:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    entries.push({ key: m[1], label: m[2], blurb: m[3] });
  }
  return entries;
}

/** Re-derive a server constant's default from its API source file. */
function deriveServerConstant(constant: string): number {
  const re = new RegExp(
    `(?:export\\s+)?const\\s+${constant}\\s*(?::\\s*number)?\\s*=\\s*(?:Number\\(process\\.env\\[[\"'][A-Z0-9_]+[\"']\\]\\)\\s*\\|\\|\\s*)?(\\d+)\\b`,
  );
  const m = apiSrc.match(re);
  expect(m, `${constant} in ${API_FILE}`).toBeTruthy();
  return Number(m![1]);
}

describe("cover-art registry parity — API owns, FE mirrors", () => {
  it("styles: FE list is the API list on every shared field, in order", () => {
    const apiStyles = extractApiEntries("COVER_ART_STYLES");
    expect(apiStyles.length).toBeGreaterThanOrEqual(5);
    expect(
      COVER_ART_STYLES.map((s) => ({ key: s.key, label: s.label, blurb: s.blurb })),
    ).toEqual(apiStyles);
  });

  it("ratios: FE list is the API list on every shared field, in order", () => {
    const apiRatios = extractApiEntries("COVER_ART_RATIOS");
    expect(apiRatios.length).toBeGreaterThanOrEqual(3);
    expect(
      COVER_ART_RATIOS.map((r) => ({ key: r.key, label: r.label, blurb: r.blurb })),
    ).toEqual(apiRatios);
  });

  it("ratios: the FE-only css field is derived from the key, never a second truth", () => {
    for (const r of COVER_ART_RATIOS) {
      expect(r.css).toBe(r.key.replace(":", " / "));
    }
  });

  it("tiers: FE tier keys are the API schema's tier enum, in order", () => {
    const m = apiSrc.match(/tier:\s*z\.enum\(\[([^\]]+)\]\)/);
    expect(m, "tier enum in coverArtSchema").toBeTruthy();
    const apiTierKeys = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(COVER_ART_TIERS.map((t) => t.key)).toEqual(apiTierKeys);
  });

  it("tiers: FE prices equal the API charging constants re-derived from source", () => {
    const byKey = new Map(COVER_ART_TIERS.map((t) => [t.key, t.credits]));
    expect(byKey.get("standard")).toBe(deriveServerConstant("COVER_ART_STANDARD_CREDITS"));
    expect(byKey.get("premium")).toBe(deriveServerConstant("COVER_ART_PREMIUM_CREDITS"));
  });

  it("tiers: the standard price is the credit-costs registry's base row", () => {
    const standard = COVER_ART_TIERS.find((t) => t.key === "standard");
    expect(standard?.credits).toBe(CREDIT_COSTS["/api/cover-art"]?.cost);
  });

  it("presets: every one-tap chip names a style the rail will honor", () => {
    const registryKeys = new Set(COVER_ART_STYLES.map((s) => s.key));
    expect(COVER_ART_PRESETS.length).toBeGreaterThanOrEqual(3);
    for (const preset of COVER_ART_PRESETS) {
      expect(registryKeys.has(preset.style), `preset "${preset.label}" → ${preset.style}`).toBe(true);
    }
    // The pre-dedupe chip pointed at "cinematic" — no such style exists
    // on the rail, and tapping it failed the request. Never again.
    expect(COVER_ART_PRESETS.map((p) => p.style)).not.toContain("cinematic");
  });

  it("consumers: page and World desk ride the one shared preset list", () => {
    const page = readFe("pages/cover-art.tsx");
    expect(page).toContain("COVER_ART_PRESETS");
    expect(page).not.toContain("const COVER_PRESETS");
    const worldModule = readFe("lib/world/create-desks.ts");
    expect(worldModule).toContain('export { COVER_ART_PRESETS } from "../cover-art"');
    expect(page).not.toContain('style: "cinematic"');
    expect(worldModule).not.toContain('style: "cinematic"');
  });

  it("ownership pointers: both files name this parity pin", () => {
    expect(apiSrc).toContain("cover-art-registry-parity");
    expect(readFe("lib/cover-art.ts")).toContain("cover-art-registry-parity");
  });
});
