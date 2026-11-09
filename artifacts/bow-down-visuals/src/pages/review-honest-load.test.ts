/**
 * Review (public client review page) — honest load states (Stack 400
 * C-28: the honest-load pin layer completing the "empty lie" audit).
 * Residual pin verified against both shapes: this page was wrapped by
 * resilience-live (stack1600/s400-resilience-live @ df87eb650) with
 * SectionBoundary wrappers only — every string asserted here is
 * present verbatim in BOTH the join14 page and the banked branch
 * version (loader logic identical; only wrapping/indentation moved).
 *
 * The census spot-checked this page HONEST, and this pin records why:
 * the single-record load is a PageState machine (loading | locked |
 * ready | error). load() sets loading, a non-ok answer sets the error
 * state with the server's message (or the loadFailed key), the catch
 * sets the same error state, and success sets ready. The render
 * reaches the ready branch — the only place the comments empty line
 * ("be first") can render — only after the loading and error
 * branches. One shape difference from the list pins, stated plainly:
 * the error branch's action is the Back-home link, not an in-place
 * retry button — the load is keyed by the URL token, so there is no
 * list to re-fetch in place; the pin asserts the real exit instead of
 * inventing a retry. Copy rides i18n keys, pinned in all 10 catalogs.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./review.tsx");
const loadAt = page.indexOf("const load = useCallback(async () => {");
const loader = page.slice(loadAt, page.indexOf("}, [token, t]);", loadAt));

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

describe("failure path — a failed review load never reads as an empty review", () => {
  it("the loader starts at loading and records the error state on a non-ok response", () => {
    expect(loader).toContain('setState({ kind: "loading" });');
    expect(loader).toContain("if (!res.ok) {");
    expect(loader).toContain('setState({ kind: "error", message: apiErrorMessage(data, t("review.loadFailed")) });');
  });

  it("a transport failure records the same error state in the catch", () => {
    expect(loader).toContain('setState({ kind: "error", message: t("review.loadFailed") });');
  });

  it("a successful load records the ready state (and locked stays its own state)", () => {
    expect(loader).toContain('setState({ kind: "ready", payload: data });');
    expect(loader).toContain('setState({ kind: "locked" });');
  });

  it("the state machine starts at loading", () => {
    expect(page).toContain('useState<PageState>({ kind: "loading" })');
    expect(page).toContain('useEffect(() => { load(); }, [load]);');
  });

  it("failure renders the error panel with its copy and the back-home exit", () => {
    expect(page).toContain('t("review.unavailable")');
    expect(page).toContain("{state.message}");
    expect(page).toContain('t("review.backHome")');
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the first load renders the pending state, not the content", () => {
    expect(page).toContain('t("review.loading")');
  });

  it("the comments empty line renders only inside ready, after the loading and error branches", () => {
    const loadingAt = page.indexOf('{state.kind === "loading" && (');
    const errorAt = page.indexOf('{state.kind === "error" && (');
    const readyAt = page.indexOf('{state.kind === "ready" && (');
    const emptyAt = page.indexOf('t("review.beFirst")');
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(readyAt).toBeGreaterThan(errorAt);
    expect(emptyAt).toBeGreaterThan(readyAt);
    expect(page).toContain("(state.payload.comments ?? []).length === 0 && (");
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the review honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["review.loadFailed", "review.loading", "review.unavailable", "review.beFirst"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
