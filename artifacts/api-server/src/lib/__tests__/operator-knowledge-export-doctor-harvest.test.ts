/**
 * ExportDoctor B-08 — generator half (Stack-200 lane rem-expdoctor-b08).
 *
 * The operator knowledge generator used to harvest PAGE files only, so
 * the /api/export-doctor/* family reached operator-knowledge.json only
 * through a hand-kept FEATURE_PRICE_LINKS list — and that list named
 * thirteen of the route file's eighteen routes, silently omitting the
 * five diagnostic steps (test-url, download, check-clip-urls,
 * download-all, export-audio-sync-diagnostic). The operator could
 * describe the doctor's exports but not the diagnosis itself.
 *
 * The generator now harvests the whole route file
 * (ROUTE_FILE_FEATURE_LINKS + extractRouteFileEndpoints in
 * scripts/generate-operator-knowledge.mjs). These tests RE-DERIVE the
 * family from the route file, the registry, and the router mount —
 * independently of the generator's own code — and pin the generated
 * artifact against all three, in both directions:
 *
 *   route file → KB: every registered export-doctor route is an
 *     endpoint of the video-editor entry (the doctor's in-workflow
 *     home — its panel is docked in the editor's Export tab);
 *   KB → route file: the entry names no export-doctor endpoint the
 *     file does not serve (no stale knowledge);
 *   prices: a registry-priced route carries its registry price
 *     (every doctor rail is registered free, 0 VB); an unpriced
 *     diagnostic sub-step carries NO price entry — the generator
 *     must never invent a price for a step the registry never priced.
 *
 * If these fail after a route change, re-run:
 *   node scripts/generate-operator-knowledge.mjs
 * (from artifacts/api-server) and review what changed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OPERATOR_KB, OPERATOR_FEATURES } from "../operator-knowledge";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* Same convention as operator-knowledge.test.ts: API_SRC is the
   api-server src/ dir; the frontend src is four levels up + across. */
const API_SRC = path.resolve(HERE, "..", "..");
const FE_SRC = path.resolve(HERE, "..", "..", "..", "..", "bow-down-visuals", "src");
const read = (p: string) => readFileSync(p, "utf8");

const ROUTE_FILE = path.join(API_SRC, "routes", "generate", "export-doctor.ts");
const GENERATOR = path.resolve(API_SRC, "..", "scripts", "generate-operator-knowledge.mjs");
const REGISTRY = path.join(FE_SRC, "lib", "credit-costs.ts");

/** Independent re-derivation of the routes export-doctor.ts registers:
    every router.<method>("…") path literal, parameters normalized. */
function deriveDoctorRoutes(): string[] {
  const src = read(ROUTE_FILE);
  const out = new Set<string>();
  for (const m of src.matchAll(/\brouter\.(?:get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
    out.add(m[1].replace(/:([A-Za-z0-9_]+)/g, ":param").replace(/\/+$/, ""));
  }
  return [...out].sort();
}

/** The family's registry rows, parsed from CREDIT_COSTS directly. */
function deriveDoctorRegistry(): Map<string, { cost: number; feature: string }> {
  const src = read(REGISTRY);
  const out = new Map<string, { cost: number; feature: string }>();
  for (const m of src.matchAll(/"(\/api\/export-doctor\/[^"]+)":\s*\{\s*cost:\s*(\d+),\s*feature:\s*"([^"]+)"/g)) {
    out.set(m[1], { cost: Number(m[2]), feature: m[3] });
  }
  return out;
}

const doctorRoutes = deriveDoctorRoutes();
const doctorFamily = doctorRoutes.map((p) => `/api${p}`);
const registry = deriveDoctorRegistry();
const editor = OPERATOR_FEATURES.find((f) => f.id === "video-editor")!;

describe("operator knowledge — ExportDoctor B-08 route-file harvest", () => {
  it("the route file's family is the reviewed eighteen routes", () => {
    // Pinned in both directions: a route added to or removed from the
    // file changes this list — update it deliberately, with the regen.
    expect(doctorRoutes).toEqual([
      "/export-doctor/check-clip-urls",
      "/export-doctor/download",
      "/export-doctor/download-all",
      "/export-doctor/export",
      "/export-doctor/export-all",
      "/export-doctor/export-all-audio",
      "/export-doctor/export-all-captions",
      "/export-doctor/export-all-effects",
      "/export-doctor/export-all-overlays",
      "/export-doctor/export-audio",
      "/export-doctor/export-audio-sync-diagnostic",
      "/export-doctor/export-audio-sync-short",
      "/export-doctor/export-effects-range",
      "/export-doctor/export-effects-transitions",
      "/export-doctor/export-overlays-range",
      "/export-doctor/repair-clip",
      "/export-doctor/repair-normalize",
      "/export-doctor/test-url",
    ]);
  });

  it("the router is mounted prefix-free, so /api + route path is the served path", () => {
    const index = read(path.join(API_SRC, "routes", "index.ts"));
    expect(index).toContain('from "./generate/export-doctor"');
    expect(index).toContain("router.use(exportDoctorRouter);");
  });

  it("every export-doctor route the file serves is an endpoint of the video-editor entry", () => {
    expect(editor, "video-editor entry").toBeTruthy();
    for (const ep of doctorFamily) {
      expect(editor.endpoints, ep).toContain(ep);
    }
  });

  it("the five diagnostic steps the hand list missed are present", () => {
    for (const ep of [
      "/api/export-doctor/test-url",
      "/api/export-doctor/download",
      "/api/export-doctor/check-clip-urls",
      "/api/export-doctor/download-all",
      "/api/export-doctor/export-audio-sync-diagnostic",
    ]) {
      expect(editor.endpoints, ep).toContain(ep);
    }
  });

  it("the entry names no export-doctor endpoint the route file does not serve", () => {
    const named = editor.endpoints.filter((e) => e.startsWith("/api/export-doctor/"));
    expect(named.sort()).toEqual([...doctorFamily].sort());
  });

  it("the artifact's routeFileEndpoints count is the harvested family size", () => {
    expect(OPERATOR_KB.counts.routeFileEndpoints).toBe(doctorFamily.length);
  });

  it("registry-priced doctor rails carry their exact registry price (all free)", () => {
    expect(registry.size).toBeGreaterThan(0);
    for (const [ep, row] of registry) {
      // No registry row may name a route the file no longer serves.
      expect(doctorFamily, `registry names unserved ${ep}`).toContain(ep);
      const price = editor.prices.find((p) => p.endpoint === ep);
      expect(price, ep).toBeTruthy();
      expect(price!.vb, ep).toBe(row.cost);
      expect(price!.feature, ep).toBe(row.feature);
      // Every doctor rail is free today; a future charge must be a
      // deliberate registry change, reviewed — not generator drift.
      expect(row.cost, ep).toBe(0);
    }
  });

  it("unpriced diagnostic sub-steps carry NO price entry — no invented price", () => {
    const unpriced = doctorFamily.filter((ep) => !registry.has(ep));
    // The five diagnostic steps are exactly the unpriced set today.
    expect(unpriced.sort()).toEqual([
      "/api/export-doctor/check-clip-urls",
      "/api/export-doctor/download",
      "/api/export-doctor/download-all",
      "/api/export-doctor/export-audio-sync-diagnostic",
      "/api/export-doctor/test-url",
    ]);
    for (const ep of unpriced) {
      expect(editor.endpoints, ep).toContain(ep);
      expect(editor.prices.some((p) => p.endpoint === ep), ep).toBe(false);
    }
  });

  it("the generator harvests the route file instead of hand-listing the family", () => {
    const gen = read(GENERATOR);
    expect(gen).toContain("ROUTE_FILE_FEATURE_LINKS");
    expect(gen).toContain("extractRouteFileEndpoints");
    expect(gen).toContain('routeFile: "routes/generate/export-doctor.ts"');
    expect(gen).toContain('pathPrefix: "/export-doctor/"');
    // The rot-prone hand list is gone: no FEATURE_PRICE_LINKS-style
    // per-endpoint entry for any export-doctor route may come back.
    expect(gen).not.toMatch(/endpoint:\s*"\/api\/export-doctor\//);
  });
});
