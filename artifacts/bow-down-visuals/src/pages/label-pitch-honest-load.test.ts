/**
 * Label Pitch (+ Playlist Pitch tab) — honest load states
 * (Stack 400 C-28: the honest-load pin layer completing the
 * "empty lie" audit).
 *
 * Every list loader on this page already carries the honest machine
 * — the loaders' own comments state the law ("A failed load is NOT
 * 'no labels match'"). loadLabels() and loadTracker() throw on a
 * non-ok answer, their catches set the matching error state, and the
 * renders reach the no-match / no-submissions copy only after the
 * loading and error branches, each error branch carrying a retry
 * wired to its real loader; the Playlist Pitch tab's curator loader
 * follows the same shape. What was missing is the PIN. This file
 * pins that shape in source, like the sibling honest-load pins (the
 * FE suite runs in node, no DOM). The copy runs through i18n keys,
 * so the keys are pinned plus a catalog block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./label-pitch.tsx");
const labelsAt = page.indexOf("async function loadLabels(g: string, t: string) {");
const labelsLoader = page.slice(labelsAt, page.indexOf("async function loadTracker() {", labelsAt));
const trackerAt = page.indexOf("async function loadTracker() {");
const trackerLoader = page.slice(trackerAt, page.indexOf("async function generateKit() {", trackerAt));

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v as string;
    }
  }
  return out;
}

describe("labels — a failed directory load never reads as 'no labels match'", () => {
  it("the loader throws on a non-ok response and records the error state in its catch", () => {
    expect(labelsLoader).toContain("if (!res.ok) throw new Error();");
    expect(labelsLoader).toContain("setLabelsError(true);");
  });

  it("a successful load records the labels, clears the error and always clears loading", () => {
    expect(labelsLoader).toContain("setLabels((data as { labels: LabelEntry[] }).labels ?? []);");
    expect(labelsLoader).toContain("setLabelsError(false);");
    expect(labelsLoader).toContain("finally { setLabelsLoading(false); }");
  });

  it("failure renders the error panel with a retry wired to the real loader", () => {
    expect(page).toContain('t("labelPitch.labelsLoadError")');
    expect(page).toContain('t("labelPitch.labelsLoadErrorBody")');
    expect(page).toContain('data-testid="btn-retry-labels"');
    expect(page).toContain("onClick={() => void loadLabels(genreFilter, typeFilter)}");
    expect(page).toContain('t("labelPitch.retryLoad")');
  });

  it("the no-match copy renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{labelsLoading && (");
    const errorAt = page.indexOf("{!labelsLoading && labelsError && labels.length === 0 && (");
    const emptyAt = page.indexOf("{!labelsLoading && !labelsError && labels.length === 0 && (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain('t("labelPitch.noLabelsMatch")');
  });
});

describe("tracker — a failed tracker load never reads as an empty tracker", () => {
  it("the loader throws on a non-ok response and records the error state in its catch", () => {
    expect(trackerLoader).toContain("if (!res.ok) throw new Error();");
    expect(trackerLoader).toContain("setTrackerError(true);");
  });

  it("a successful load records the submissions and clears the error state", () => {
    expect(trackerLoader).toContain("setSubmissions((data as { pitches: Submission[] }).pitches ?? []);");
    expect(trackerLoader).toContain("setTrackerError(false);");
  });

  it("failure renders the error panel with a retry wired to the real loader", () => {
    expect(page).toContain('data-testid="btn-retry-tracker"');
    expect(page).toContain("onClick={() => void loadTracker()}");
  });

  it("the empty panel renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{trackerLoading ? (");
    const errorAt = page.indexOf(") : trackerError ? (");
    const emptyAt = page.indexOf(") : submissions.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain('t("labelPitch.noSubmissions")');
  });
});

describe("playlist tab — the curator directory follows the same honest shape", () => {
  it("the curator loader records its error state in its catch and the retry is pinned", () => {
    expect(page).toContain("setCuratorsError(true);");
    expect(page).toContain('data-testid="btn-retry-curators"');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the labelPitch honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of [
      "labelPitch.labelsLoadError",
      "labelPitch.labelsLoadErrorBody",
      "labelPitch.retryLoad",
      "labelPitch.noLabelsMatch",
      "labelPitch.trackerLoadError",
      "labelPitch.trackerLoadErrorBody",
      "labelPitch.noSubmissions",
    ]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
