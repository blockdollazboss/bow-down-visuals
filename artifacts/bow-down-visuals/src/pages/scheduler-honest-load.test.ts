/**
 * Scheduler — honest load states (Stack 400 C-28: the honest-load pin
 * layer completing the "empty lie" audit). Residual pin verified
 * against both shapes: this page was wrapped by resilience-live
 * (stack1600/s400-resilience-live @ df87eb650) with SectionBoundary
 * wrappers only — every string asserted here is present verbatim in
 * BOTH the join14 page and the banked branch version (loader logic
 * identical; only wrapping/indentation moved).
 *
 * Every tab on this page derives from the posts list, so a rejected
 * first load used to render each tab's genuine-looking empty state.
 * The honest machine: the shared api() helper throws on !res.ok; the
 * initial Promise.all load's catch sets loadError (guarded by
 * postsLoadedRef, so a later background refresh failure never blanks
 * loaded content); `finally` always clears loading. The render shows
 * loading, then the error panel with a retry wired to retryNonce
 * (which re-runs the real effect), and the tabs — the only place the
 * queue/drafts/posted empty states live — only after both. The error
 * copy is hardcoded English in the page, so the literals are pinned;
 * the loading/empty copy rides i18n keys, pinned in all 10 catalogs.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./scheduler.tsx");
const apiAt = page.indexOf("async function api<T>(");
const apiHelper = page.slice(apiAt, page.indexOf("/* ─── Best-time optimizer", apiAt));
const loadAt = page.indexOf("const loadPosts = useCallback(async () => {");
const loadPosts = page.slice(loadAt, page.indexOf("}, [getAccessToken]);", loadAt));

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

describe("failure path — a failed posts load never reads as nothing scheduled", () => {
  it("the shared api helper throws on a non-ok response", () => {
    expect(apiHelper).toContain("if (!res.ok) {");
    expect(apiHelper).toContain("throw err;");
  });

  it("a successful posts load records the posts", () => {
    expect(loadPosts).toContain("setPosts(data.posts);");
  });

  it("the initial load's catch records the error state, guarded so reloads keep loaded posts", () => {
    expect(page).toContain("Promise.all([loadPosts(), loadAccounts()])");
    expect(page).toContain(".then(() => { postsLoadedRef.current = true; })");
    expect(page).toContain(".catch(() => { if (!postsLoadedRef.current) setLoadError(true); })");
    expect(page).toContain(".finally(() => setLoading(false));");
    expect(page).toContain("const [loadError, setLoadError] = useState(false);");
    expect(page).toContain("const [loading, setLoading] = useState(true);");
  });

  it("failure renders the error panel with its copy and a retry wired to the real load", () => {
    expect(page).toContain("Couldn't load your scheduled posts.");
    expect(page).toContain("Something went wrong on our end — your posts are safe, this page just couldn't reach them.");
    expect(page).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the empty tab states render only after the loading and error branches", () => {
    const loadingAt = page.indexOf('t("scheduler.loading")');
    const errorAt = page.indexOf("Couldn't load your scheduled posts.");
    const emptyAt = page.indexOf('t("scheduler.queue.emptyTitle")');
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain(") : loadError ? (");
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the scheduler honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["scheduler.loading", "scheduler.queue.emptyTitle", "scheduler.drafts.emptyTitle", "scheduler.posted.emptyTitle"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
