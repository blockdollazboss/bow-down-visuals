/**
 * Public link-in-bio page (/bio/:slug) — honest load states
 * (Stack-400 pin batch, the "empty lie" family).
 *
 * The single fetch loads the bio page record (rendered by the
 * BioPageView child). Before the Stack-28 #29 / A3-F7 fix, every
 * failure landed on the not-found state. After: only a genuine 404
 * is not-found; any other failure (non-ok status, an ok answer with
 * no page, a network throw) raises the load-error panel with a
 * retry, and the spinner renders while the load is in flight. The
 * error copy is hardcoded English literals, so this pin asserts the
 * literals and carries no catalog block.
 *
 * The FE suite runs in node (no DOM), so — like the sibling
 * honest-load pins — these tests pin the state machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./bio-public.tsx");
const loadAt = page.indexOf("const res = await fetch(`/api/bio-pages/public/${encodeURIComponent(slug)}`);");
const loader = page.slice(loadAt, page.indexOf("}, [slug, retryNonce]);", loadAt));

describe("failure path — a failed bio load never reads as not-found", () => {
  it("only a 404 records not-found; other non-ok responses record the load error", () => {
    expect(loader).toContain("if (res.status === 404) { if (!cancelled) setNotFound(true); return; }");
    expect(loader).toContain("if (!res.ok) { if (!cancelled) setLoadError(true); return; }");
  });

  it("an ok answer with no page, and a network throw, also record the load error", () => {
    expect(loader).toContain("if (json.ok && json.page) setPage(json.page);");
    expect(loader).toContain("else setLoadError(true);");
    expect(loader).toContain("if (!cancelled) setLoadError(true);");
  });

  it("failure renders the error panel with a retry wired to the real load", () => {
    expect(page).toContain('data-testid="bio-load-error"');
    expect(page).toContain("This page couldn't load");
    expect(page).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
  });
});

describe("loading and not-found paths stay distinct from failure", () => {
  it("the branches render in loading → load-error → not-found order", () => {
    const loadingAt = page.indexOf("if (loading) {");
    const errAt = page.indexOf('data-testid="bio-load-error"');
    const notFoundAt = page.indexOf("if (notFound || !page) {");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errAt).toBeGreaterThan(loadingAt);
    expect(notFoundAt).toBeGreaterThan(errAt);
  });
});
