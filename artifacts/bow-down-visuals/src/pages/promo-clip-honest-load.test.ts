/**
 * Promo Clip — honest load states (Stack 400 C-28: the honest-load
 * pin layer completing the "empty lie" audit).
 *
 * The from-project project list already carries the honest
 * machine — its own comment states the law ("A failed load is NOT
 * an empty project list"). loadProjects() throws on a non-ok
 * answer, its catch sets projectsError, and the render reaches
 * the no-projects copy only after the projectsLoading and
 * projectsError branches, with the error branch's retry wired to
 * the real loader. This file pins that shape in source, like the
 * sibling honest-load pins (the FE suite runs in node, no DOM).
 * The load-state copy goes through promo-clip.* keys (the error
 * copy carries English defaultValue fallbacks in the page),
 * pinned for all 10 catalogs below.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./promo-clip.tsx");
const loadAt = page.indexOf("async function loadProjects() {");
const loader = page.slice(loadAt, page.indexOf("function resetOutput()", loadAt));

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

describe("failure path — a failed projects load never reads as an empty project list", () => {
  it("the loader throws on a non-ok response and records the error state in its catch", () => {
    expect(loader).toContain("if (!res.ok) throw new Error();");
    expect(loader).toContain("setProjectsError(true);");
  });

  it("a successful load records the projects, clears the error, and always clears loading", () => {
    expect(loader).toContain("setProjects(data.projects ?? []);");
    expect(loader).toContain("setProjectsError(false);");
    expect(loader).toContain("setProjectsLoading(false);");
  });

  it("failure renders the error panel with a retry wired to the real loader", () => {
    expect(page).toContain('t("promo-clip.projectsLoadError", { defaultValue: "We couldn\'t load your projects" })');
    expect(page).toContain('t("promo-clip.projectsLoadErrorBody", { defaultValue: "Your projects are safe — this just couldn\'t reach them. Check your connection and try again." })');
    expect(page).toContain('data-testid="btn-retry-projects"');
    expect(page).toContain("onClick={() => void loadProjects()}");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the first load renders the pending state, not the empty panel", () => {
    expect(page).toContain('t("promo-clip.loadingProjects")');
  });

  it("the empty panel renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf(") : projectsLoading ? (");
    const errorAt = page.indexOf(") : projectsError ? (");
    const emptyAt = page.indexOf(") : projects.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain('t("promo-clip.noProjects")');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the promo-clip honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["promo-clip.loadingProjects", "promo-clip.projectsLoadError", "promo-clip.projectsLoadErrorBody", "promo-clip.retryLoad", "promo-clip.noProjects"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
