/**
 * Referrals — honest load states (Stack 400 C-28: the honest-load pin
 * layer completing the "empty lie" audit).
 *
 * This page carries TWO list loads, and both already carry the honest
 * machine. (1) The page load: /api/referrals/me (plus the public
 * contest in parallel) — a non-ok answer or a transport failure sets
 * `error`, `setLoading(false)` lives in `finally`, and the render
 * reaches the referral tracker (with its genuine-empty line) only
 * after the loading and error branches; the error branch's retry
 * bumps retryNonce, which re-runs the real effect. (2) The
 * leaderboard: entries stay null while loading, a non-ok answer or a
 * throw sets loadError, and the empty line renders only after the
 * error and loading branches, with its own retry on the same nonce.
 * This file pins that shape in source, like the sibling honest-load
 * pins (the FE suite runs in node, no DOM). The honest-load copy
 * rides i18n keys, so the catalog block pins them in all 10 locales;
 * the leaderboard's error copy is a hardcoded English literal and is
 * pinned as a literal.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./referrals.tsx");
const lbAt = page.indexOf("function LeaderboardSection");
const lb = page.slice(lbAt, page.indexOf("function ShareKitSection", lbAt));

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

describe("page load — a failed /api/referrals/me load never reads as an empty tracker", () => {
  it("a non-ok answer records the error state with the load-failed copy key", () => {
    expect(page).toContain('if (!res.ok) { setError(apiErrorMessage(data, t("referrals.error.loadFailed"))); return; }');
    expect(page).toContain('setError(t("referrals.error.loadFailed"))');
  });

  it("loading starts true and always clears in finally", () => {
    expect(page).toContain("const [loading, setLoading] = useState(true);");
    expect(page).toContain("if (!cancelled) setLoading(false);");
  });

  it("the error branch renders before the loaded content, with a retry wired to the real load", () => {
    const loadingAt = page.indexOf("{loading ? (");
    const errorAt = page.indexOf(") : error ? (");
    const trackerEmptyAt = page.indexOf('t("referrals.tracker.empty")');
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(trackerEmptyAt).toBeGreaterThan(errorAt);
    /* both error branches (page + leaderboard) retry via the nonce */
    expect(page.match(/onClick=\{\(\) => setRetryNonce\(\(n\) => n \+ 1\)\}/g)).toHaveLength(2);
  });
});

describe("leaderboard — a failed leaderboard load never reads as an empty board", () => {
  it("the loader records ready on ok and the error state on non-ok or throw", () => {
    expect(lb).toContain("const res = await fetch(`/api/referrals/leaderboard?window=${window}`);");
    expect(lb).toContain("if (res.ok) setEntries(data.entries ?? []);");
    expect(lb).toContain("else setLoadError(true);");
    expect(lb).toContain("} catch { if (!cancelled) setLoadError(true); }");
    expect(lb).toContain("const [loadError, setLoadError] = useState(false);");
  });

  it("failure renders the error panel with its copy before any empty state", () => {
    expect(lb).toContain("Couldn't load the leaderboard.");
    expect(lb).toContain("the rankings are safe, they just couldn't load.");
  });

  it("the empty line renders only after the error and loading branches", () => {
    const errorAt = lb.indexOf("{loadError ? (");
    const loadingAt = lb.indexOf(") : entries === null ? (");
    const emptyAt = lb.indexOf(") : entries.length === 0 ? (");
    expect(errorAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(errorAt);
    expect(emptyAt).toBeGreaterThan(loadingAt);
    expect(lb).toContain('t("referrals.leaderboard.empty")');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the referrals honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["referrals.error.loadFailed", "referrals.leaderboard.empty", "referrals.tracker.empty"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
