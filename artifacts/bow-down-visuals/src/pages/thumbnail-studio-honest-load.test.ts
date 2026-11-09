/**
 * Thumbnail Studio saved library — honest load states (Stack 400
 * C-28 residual pin for the C-25 resilience wrap).
 *
 * The saved-thumbnails load already carries the honest machine: the
 * loader throws on a non-ok answer, the failure renders in its own
 * error block, and the empty panel is gated on !loading && !error,
 * so a failed load can never dress up as "no thumbnails yet". This
 * pin asserts ONLY strings present in BOTH the join14 page and the
 * C-25-wrapped page on stack1600/s400-resilience-editors, so it
 * holds on the joined tree at join15. The FE suite runs in node,
 * no DOM.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./thumbnail-studio.tsx");

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
const KEYS = ["thumbnails.loadFailed", "thumbnails.emptyTitle", "thumbnails.emptyBody"];

describe("failure path — a failed library load never reads as an empty library", () => {
  it("the loader throws on a non-ok answer", () => {
    expect(page).toContain('if (!res.ok) throw new Error(t("thumbnails.loadFailed"));');
  });

  it("failure renders in its own error block, apart from the list states", () => {
    expect(page).toContain("{error && (");
    expect(page).toContain('<p className="text-red-400 text-sm font-medium">{error}</p>');
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the empty panel and the grid are both gated on loading finished AND no error", () => {
    expect(page).toContain("{!loading && !error && thumbnails.length === 0 && (");
    expect(page).toContain("{!loading && !error && allThumbnails.length > 0 && (");
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the thumbnails keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of KEYS) expect(typeof cat[k] === "string" && cat[k].length > 0).toBe(true);
  });
});
