/**
 * Creation Streak widget — honest load state (Stack-200 hardening D2,
 * census section A item 16: the "empty lie" family).
 *
 * Before: the load set data only `if (res.ok)` and the catch was
 * "widget stays empty on failure" — `if (!data) return null` made a
 * failed first load, still-loading, and a hidden widget identical,
 * and claimable Visual Bucs milestone rewards silently went missing.
 * After: failure raises loadFailed and the widget renders a compact
 * "streak couldn't load" card with a retry; loading still renders
 * nothing (the widget is a quiet dashboard extra), and a successful
 * load clears the flag.
 *
 * The FE suite runs in node (no DOM), so — like the sibling honest-load
 * pins — these tests pin the state machine in source: which setter each
 * load outcome calls, and which render branch each state reaches. The
 * new copy keys are English in en.json; the other nine catalogs carry
 * the English verbatim as UNREVIEWED placeholders (registered in the
 * retention wave's legit-identical allowlists).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const widget = read("./CreationStreakWidget.tsx");
const loadAt = widget.indexOf("const load = useCallback(async () => {");
const loader = widget.slice(loadAt, widget.indexOf("}, [authHeaders]);", loadAt));

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

describe("failure path — a failed streak read is a card, not a vanishing widget", () => {
  it("the loader throws on a non-ok response and records the failure in its catch", () => {
    expect(loader).toContain('if (!res.ok) throw new Error("streak load failed");');
    expect(loader).toContain("setLoadFailed(true)");
    expect(loader).not.toContain("widget stays empty on failure");
  });

  it("a successful load clears the failed flag", () => {
    expect(loader).toContain("setLoadFailed(false)");
  });

  it("failure with nothing loaded renders the compact card with a retry wired to the real load", () => {
    expect(widget).toContain('data-testid="creation-streak-load-error"');
    expect(widget).toContain('t("retention.streak_load_error")');
    expect(widget).toContain('t("retention.streak_retry")');
    expect(widget).toContain("onClick={() => void load()}");
  });
});

describe("loading and hidden states stay distinct from failure", () => {
  it("the failure card renders before the plain no-data null", () => {
    const failAt = widget.indexOf('data-testid="creation-streak-load-error"');
    const nullAt = widget.indexOf("if (!data) return null;");
    expect(failAt).toBeGreaterThan(-1);
    expect(nullAt).toBeGreaterThan(failAt);
  });

  it("the user's hide choice still wins over everything", () => {
    expect(widget.indexOf("if (hidden) return null;")).toBeLessThan(widget.indexOf('data-testid="creation-streak-load-error"'));
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the retention honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["retention.streak_load_error", "retention.streak_retry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
