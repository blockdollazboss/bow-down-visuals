/**
 * Analytics Hub — Connected Accounts overview — honest load states
 * (Stack-400 pin batch, the "empty lie" family). The rest of the
 * hub is local/manual stats plus user-triggered POST actions; the
 * network-loaded collection on this page is the overview's platform
 * list, pinned here.
 *
 * Before the Stack-28 #23 / A3-F1 fix, a pending or failed overview
 * rendered the "not connected" cards — a failed load claimed
 * nothing was connected. After: loading starts in flight and the
 * grid shows skeletons; a failure with nothing loaded renders ONE
 * scoped error card with a retry; a failure with a loaded overview
 * keeps the grid and banners the error above it; the connect cards
 * render only from a LOADED overview.
 *
 * The FE suite runs in node (no DOM), so — like the sibling
 * honest-load pins — these tests pin the state machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./analytics-hub.tsx");
const loadAt = page.indexOf("const loadOverview = useCallback(async () => {");
const loader = page.slice(loadAt, page.indexOf("}, [user, authedFetch]);", loadAt));

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

describe("failure path — a failed overview never reads as nothing-connected", () => {
  it("the loader throws on a non-ok response and records the error in its catch", () => {
    expect(loader).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("analytics.errorLoadStats")));');
    expect(loader).toContain('setError(plainErrorText(err, t("analytics.errorLoadStats")));');
  });

  it("a successful load records the overview", () => {
    expect(loader).toContain("setOverview(data as ConnOverviewResponse);");
  });

  it("the overview starts in flight, so the first render is the skeleton state", () => {
    expect(page).toContain("const [loading, setLoading] = useState(true);");
    expect(page).toContain('data-testid="analytics-overview-loading"');
  });

  it("failure with nothing loaded renders the scoped error card with a retry wired to the real load", () => {
    expect(page).toContain('data-testid="analytics-overview-error"');
    expect(page).toContain('t("analytics.tryAgain")');
    /* refresh button, error-card retry, and per-platform retry */
    expect(page.match(/onClick=\{loadOverview\}/g)).toHaveLength(3);
  });

  it("a failed reload keeps the loaded overview and banners the error over it", () => {
    expect(page).toContain("{error && overview && (");
  });
});

describe("genuine not-connected path stays distinct from failure", () => {
  it("the connect cards render only in the settled branch, after loading and error", () => {
    const loadAt2 = page.indexOf('data-testid="analytics-overview-loading"');
    const errAt = page.indexOf('data-testid="analytics-overview-error"');
    const settledAt = page.indexOf('if (!p || p.status === "not_connected") {');
    expect(loadAt2).toBeGreaterThan(-1);
    expect(errAt).toBeGreaterThan(loadAt2);
    expect(settledAt).toBeGreaterThan(errAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the analytics honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["analytics.errorLoadStats", "analytics.tryAgain"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
