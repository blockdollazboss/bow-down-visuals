/**
 * locations-desk-components — stack200 world parity lane B1,
 * census item 3 source-contract pins. The Locations bench
 * must sit inside the Video Desk (beside the template bench)
 * as an ({ isLight }) bench, with:
 * - the page's whole manager: gallery, add-by-URL, upload,
 *   delete — on the seam's rails, with plain bearer fetches
 *   (free rails, no charge seam, no confirm spend);
 * - the empty-lie law in the render order: error state,
 *   then loading, then the page's empty copy, then the
 *   gallery — a failed load can never reach the empty copy;
 * - all copy from the page's locations.* catalog keys (no
 *   new copy invented for the bench);
 * - light/dark parity via the bench's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const bench = read("../../components/world/native/LocationsBench.tsx");
const desks = read("../../components/world/native/CreateDesks.tsx");

describe("the bench shape + the Video Desk mount", () => {
  it("is an ({ isLight }) bench rooted at its testid", () => {
    expect(bench).toContain("export function LocationsBench({ isLight }: { isLight: boolean })");
    expect(bench).toContain('data-testid="world-locations-bench"');
  });

  it("CreateDesks stacks it inside VideoDesk after the template bench", () => {
    expect(desks).toContain('import { LocationsBench } from "./LocationsBench";');
    expect(desks).toContain("<LocationsBench isLight={isLight} />");
    expect(desks.indexOf("<LocationsBench")).toBeGreaterThan(desks.indexOf("<VideoTemplateBench"));
  });
});

describe("the rails — the page's, free, no charge seam", () => {
  it("loads, saves, uploads and deletes through the seam's paths", () => {
    for (const needle of [
      "fetch(LOCATIONS_PATH",
      "fetch(LOCATIONS_UPLOAD_PATH",
      "fetch(locationPath(id)",
      'method: "DELETE"',
      "buildLocationBody(label, imageUrl)",
      "locationUploadProblem(label, file.size)",
    ]) {
      expect(bench, needle).toContain(needle);
    }
  });

  it("never confirms a spend — the rails are free", () => {
    expect(bench).not.toContain("confirmedFetch");
    expect(bench).not.toContain("getCreditCost");
  });
});

describe("data-path honesty — the render order", () => {
  it("error state, then loading, then the empty copy, then the gallery", () => {
    const err = bench.indexOf("loadFailed ? (");
    const loading = bench.indexOf("locations === null ? (");
    const empty = bench.indexOf("locations.length === 0 ? (");
    const gallery = bench.indexOf('data-testid="world-locations-bench-gallery"');
    expect(err).toBeGreaterThan(-1);
    expect(loading).toBeGreaterThan(err);
    expect(empty).toBeGreaterThan(loading);
    expect(gallery).toBeGreaterThan(empty);
    expect(bench).toContain("locationsOf(await res.json()");
    expect(bench).toContain('if (parsed === null) throw new Error("load")');
  });

  it("a failed load retries through the nonce", () => {
    expect(bench).toContain("onRetry={() => setReloadNonce((n) => n + 1)}");
  });
});

describe("copy — the page's own catalog keys, nothing invented", () => {
  it("every label rides locations.*", () => {
    for (const key of [
      't("locations.pageTitle")',
      't("locations.subtitle")',
      't("locations.addLocation")',
      't("locations.namePlaceholder")',
      't("locations.imageUrlPlaceholder")',
      't("locations.save")',
      't("locations.uploadImage")',
      't("locations.noLocations")',
      't("locations.errLoad")',
      't("locations.errNameUrl")',
      't("locations.errNameFirst")',
      't("locations.errImageTooLarge")',
      't("locations.errSave")',
      't("locations.errUpload")',
      't("locations.errDelete")',
      't("locations.removeLocationTitle")',
    ]) {
      expect(bench, key).toContain(key);
    }
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the bench branches its surfaces on isLight", () => {
    expect(bench).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(bench).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
