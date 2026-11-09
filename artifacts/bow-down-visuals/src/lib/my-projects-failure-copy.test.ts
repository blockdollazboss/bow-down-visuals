/**
 * my-projects-failure-copy.test.ts — Stack 400 lane 42 (item D-44).
 *
 * My Projects was the last surface still reporting failures with the
 * browser's native alert dialog: its four delete handlers (project,
 * draft, clip, website) each popped `alert(t("myProjects.failedDelete…"))`
 * while the rest of the site — and HubProjectsSection on this very page —
 * surfaces failures through house in-page failure copy. The four handlers
 * now set the page's `deleteError` state, rendered as the same
 * role="alert" banner HubProjectsSection uses; the copy itself is
 * unchanged (the four myProjects.failedDelete* keys already existed,
 * fully translated, in all 10 catalogs — no catalog edits were needed).
 *
 * These pins hold the contract: no alert call ever returns to the page,
 * each delete failure routes through the banner state with its own key,
 * and the four keys stay present in every catalog.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Catalog = Record<string, unknown>;
const LOCALES = ["en", "es", "fr", "pt", "de", "it", "hi", "ar", "ja", "ko"] as const;
function load(locale: string): Catalog {
  return JSON.parse(
    readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"),
  ) as Catalog;
}
function flat(o: unknown, p = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v;
    }
  }
  return out;
}
const CATS = Object.fromEntries(LOCALES.map((l) => [l, flat(load(l))])) as Record<
  string,
  Record<string, unknown>
>;
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const DELETE_FAILURE_KEYS = [
  "myProjects.failedDeleteProject",
  "myProjects.failedDeleteDraft",
  "myProjects.failedDeleteClip",
  "myProjects.failedDeleteWebsite",
] as const;

describe("S400 · D-44 — My Projects delete failures use house in-page failure copy", () => {
  const src = read("../pages/my-projects.tsx");

  it("no native alert call remains anywhere in my-projects.tsx", () => {
    expect(src).not.toContain("alert(");
  });

  it("the page carries the deleteError banner state (HubProjectsSection shape)", () => {
    expect(src).toContain(
      "const [deleteError, setDeleteError] = useState<string | null>(null);",
    );
    expect(src).toContain("{deleteError && (");
    expect(src).toContain(
      '<p role="alert" className="text-sm text-red-400 font-semibold mb-3">{deleteError}</p>',
    );
  });

  it("each of the four delete failures routes through the banner with its own key", () => {
    for (const key of DELETE_FAILURE_KEYS) {
      expect(src).toContain(`setDeleteError(t("${key}"))`);
    }
  });

  it("each delete attempt clears the previous failure first", () => {
    expect(src.match(/setDeleteError\(null\)/g)).toHaveLength(4);
  });

  it("the four failure-copy keys stay present and non-empty in all 10 catalogs", () => {
    for (const locale of LOCALES) {
      for (const key of DELETE_FAILURE_KEYS) {
        const value = CATS[locale][key];
        expect(typeof value, `${locale} · ${key}`).toBe("string");
        expect((value as string).length, `${locale} · ${key}`).toBeGreaterThan(0);
      }
    }
  });
});
