/**
 * Earnings (/earnings) — honest load states (Stack 400 C-28: the
 * honest-load pin layer completing the "empty lie" audit).
 *
 * The money picture already carries the honest machine at both
 * levels. The page load rides lib/earnings-data's loadEarnings(),
 * which throws on a non-ok answer; the page's catch sets failed,
 * and the render reaches the genuine-zero panel ("No earnings
 * yet", data-testid earnings-zero-next-steps) only behind a loaded
 * payload — the failed branch and the no-data (loading) branch
 * return first, and the failed branch's Try again calls the real
 * reload. The PendingPayoutCard runs its own in-page load: it
 * throws on !res.ok, its catch sets its own failed state, its
 * loading line renders while no read has landed, and its retry
 * bumps its reloadKey. A per-source failure inside a loaded
 * payload renders "Couldn't load — try again" on that source's
 * card, never a fake $0.00. This file pins that shape in source,
 * like the sibling honest-load pins (the FE suite runs in node,
 * no DOM). The error/loading/zero copy asserted here is hardcoded
 * English in the page; the one i18n key asserted (earnings.title)
 * gets the catalog block below.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./earnings.tsx");
const lib = read("../lib/earnings-data.ts");
const payoutAt = page.indexOf('const res = await fetch("/api/earnings/pending-payout", {');
const payoutLoader = page.slice(payoutAt, page.indexOf("}, [getToken, reloadKey]);", payoutAt));
const mainAt = page.indexOf("const normalized = await loadEarnings({");
const mainLoader = page.slice(mainAt, page.indexOf("}, [getAccessToken, user, authLoading, reloadKey]);", mainAt));

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

describe("failure path — a failed earnings load never reads as zero earnings", () => {
  it("the shared loader throws on a non-ok response", () => {
    expect(lib).toContain("if (!res.ok) throw new Error(`earnings failed (${res.status})`);");
  });

  it("the page records the failure state in its catch and data on success", () => {
    expect(mainLoader).toContain("if (!cancelled) setData(normalized);");
    expect(mainLoader).toContain("if (!cancelled && !(err instanceof EarningsLoadCancelled)) setFailed(true);");
  });

  it("the pending-payout loader throws on a non-ok response and records its own failure state", () => {
    expect(payoutLoader).toContain("if (!res.ok) throw new Error(`pending payout failed (${res.status})`);");
    expect(payoutLoader).toContain("if (!cancelled) setRead(data);");
    expect(payoutLoader).toContain("if (!cancelled) setFailed(true);");
  });

  it("the full-page failure renders its copy with a retry wired to the real reload", () => {
    expect(page).toContain("Couldn&apos;t load your earnings — try again in a moment.");
    expect(page).toContain("onClick={reload}");
    expect(page).toContain("const reload = () => { setFailed(false); setData(null); setReloadKey((k) => k + 1); };");
  });

  it("the pending-payout failure renders its own retry, and a failed source never reads as $0.00", () => {
    expect(page).toContain('data-testid="earnings-payout-retry"');
    expect(page).toContain("Couldn&apos;t load — try again");
    expect(page).toContain('data-testid="earnings-source-retry"');
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the page heading renders through the i18n title key", () => {
    expect(page).toContain('t("earnings.title")');
  });

  it("the zero-earnings panel renders only after the failure and loading branches", () => {
    const failedAt = page.indexOf("if (failed) {");
    const loadingAt = page.indexOf("if (!data) {");
    const zeroAt = page.indexOf('data-testid="earnings-zero-next-steps"');
    expect(failedAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(failedAt);
    expect(zeroAt).toBeGreaterThan(loadingAt);
    expect(page).toContain("Loading your money picture…");
    expect(page).toContain("No earnings yet — here&apos;s how the first dollar happens");
  });

  it("the pending-payout loading line renders only after its failure branch", () => {
    const failedAt = page.indexOf("{failed ? (");
    const loadingAt = page.indexOf(") : !read ? (");
    const rowsAt = page.indexOf("read.rows.length > 0");
    expect(failedAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(failedAt);
    expect(rowsAt).toBeGreaterThan(loadingAt);
    expect(page).toContain("Loading your payable balance…");
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the earnings honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["earnings.title"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
