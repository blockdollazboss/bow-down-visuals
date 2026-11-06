/**
 * Activity FOMO feed — honest first load (Stack-200 hardening D2,
 * census section A item 18: the "empty lie" family).
 *
 * Before: loadFeed set the feed only `if (res.ok)` and swallowed
 * failures ("feed keeps last good state on failure") — true for
 * reloads, but a failed FIRST load left feed null forever, so
 * first-load failure, still-loading, and a genuinely quiet platform
 * were identical while the poll retried silently. After: failure
 * raises feedFailed; with nothing loaded the widget renders a minimal
 * "Activity couldn't load" placeholder with a retry; a failed RELOAD
 * still keeps the last good feed on screen; a success clears the flag.
 *
 * The FE suite runs in node (no DOM), so — like the sibling honest-load
 * pins — these tests pin the state machine in source: which setter each
 * load outcome calls, and which render branch each state reaches. The
 * new copy keys are English in en.json; the other nine catalogs carry
 * the English verbatim as UNREVIEWED placeholders (registered in the
 * fomoFeed wave's legit-identical allowlists).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const feed = read("./FomoFeed.tsx");
const loadAt = feed.indexOf("const loadFeed = useCallback(async () => {");
const loader = feed.slice(loadAt, feed.indexOf("}, [authHeaders]);", loadAt));

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

describe("failure path — a failed first load is a placeholder, not a silent void", () => {
  it("the loader throws on a non-ok response and records the failure in its catch", () => {
    expect(loader).toContain('if (!res.ok) throw new Error("feed load failed");');
    expect(loader).toContain("setFeedFailed(true)");
  });

  it("a successful load clears the failed flag", () => {
    expect(loader).toContain("setFeedFailed(false)");
  });

  it("failure with nothing loaded renders the placeholder with a retry wired to the real load", () => {
    expect(feed).toContain('data-testid="fomo-feed-load-error"');
    expect(feed).toContain('t("fomoFeed.load_error")');
    expect(feed).toContain('t("fomoFeed.load_retry")');
    expect(feed).toContain("onClick={() => void loadFeed()}");
  });
});

describe("reload and preference states stay honest", () => {
  it("the placeholder renders only when nothing is loaded — a failed reload keeps the good feed", () => {
    expect(feed).toContain("if (!feed && feedFailed) {");
    expect(feed.indexOf("if (!feed && feedFailed) {")).toBeLessThan(feed.indexOf("if (!feed) return null;"));
  });

  it("hide and prefs-off still win over the placeholder", () => {
    const errAt = feed.indexOf('data-testid="fomo-feed-load-error"');
    expect(feed.indexOf("if (hidden) return null;")).toBeLessThan(errAt);
    expect(feed.indexOf("if (prefEnabled === false) return null;")).toBeLessThan(errAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the fomoFeed honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["fomoFeed.load_error", "fomoFeed.load_retry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
