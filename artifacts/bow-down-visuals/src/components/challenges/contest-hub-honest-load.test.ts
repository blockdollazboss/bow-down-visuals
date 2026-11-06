/**
 * Contest Hub widget — honest load state (Stack-200 hardening D2,
 * census section A item 17: the "empty lie" family).
 *
 * Before: the weekly load set data only `if (res.ok)` and the catch
 * was "the widget simply doesn't render" — `if (!data) return null`
 * made a failed first load identical to still-loading, so a live
 * contest looked like no contest at all. After: the load is a named
 * retryable loadWeekly; failure raises loadFailed and renders a slim
 * "couldn't load — try again" strip; loading still renders nothing
 * (the widget never blocks the page), the prefs-off choice still wins,
 * and a successful load clears the flag.
 *
 * The FE suite runs in node (no DOM), so — like the sibling honest-load
 * pins — these tests pin the state machine in source: which setter each
 * load outcome calls, and which render branch each state reaches. The
 * new copy keys are English in en.json; the other nine catalogs carry
 * the English verbatim as UNREVIEWED placeholders (registered in the
 * weekly_contest wave's legit-identical allowlists).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const widget = read("./ContestHubWidget.tsx");
const loadAt = widget.indexOf("const loadWeekly = useCallback(async () => {");
const loader = widget.slice(loadAt, widget.indexOf("}, []);", loadAt));

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

describe("failure path — a failed weekly read is a strip, not a vanishing widget", () => {
  it("the loader throws on a non-ok response and records the failure in its catch", () => {
    expect(loader).toContain('if (!res.ok) throw new Error("weekly load failed");');
    expect(loader).toContain("setLoadFailed(true)");
    expect(widget).not.toContain("the widget simply doesn't render");
  });

  it("a successful load clears the failed flag", () => {
    expect(loader).toContain("setLoadFailed(false)");
  });

  it("failure with nothing loaded renders the slim strip with a retry wired to the real load", () => {
    expect(widget).toContain('data-testid="contest-hub-load-error"');
    expect(widget).toContain('t("weekly_contest.load_error")');
    expect(widget).toContain('t("weekly_contest.load_retry")');
    expect(widget).toContain("onClick={() => void loadWeekly()}");
  });
});

describe("loading and prefs states stay distinct from failure", () => {
  it("the failure strip renders before the plain no-data null", () => {
    const failAt = widget.indexOf('data-testid="contest-hub-load-error"');
    const nullAt = widget.indexOf("if (!data) return null;");
    expect(failAt).toBeGreaterThan(-1);
    expect(nullAt).toBeGreaterThan(failAt);
  });

  it("the user's contests-off preference still wins over everything", () => {
    expect(widget.indexOf("if (prefsOff) return null;")).toBeLessThan(widget.indexOf('data-testid="contest-hub-load-error"'));
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the weekly_contest honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../../locales/${loc}.json`)));
    for (const k of ["weekly_contest.load_error", "weekly_contest.load_retry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
