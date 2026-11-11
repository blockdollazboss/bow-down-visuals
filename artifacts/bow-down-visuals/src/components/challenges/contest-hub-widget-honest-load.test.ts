/**
 * ContestHubWidget — honest load standard (deep-pins tranche 4,
 * batch C). One endpoint (GET /api/challenges/weekly) drives the
 * whole card. A failed read gets its own failure state + retry —
 * documented on the code ("a failed weekly read used to be
 * indistinguishable from loading") — and renders an error strip
 * with a retry button; it never falls through to the no-contest
 * card, which renders only from loaded data (challenge null +
 * week_available). Still-loading renders nothing (the widget
 * never blocks the page). The retention-prefs and admin-status
 * reads are progressive enhancements: they move their state only
 * on ok and default to show / non-admin. The admin launch claims
 * success only after an ok answer, and the refreshed data is set
 * only from an ok refetch.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ContestHubWidget.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the weekly read — failure is a state, never no-contest", () => {
  it("non-ok throws into loadFailed; data and the failure clear only on success", () => {
    const body = slice(src, "const loadWeekly = useCallback(async () => {", "}, []);");
    expect(body).toContain('if (!res.ok) throw new Error("weekly load failed");');
    expect(body.indexOf("setData(await res.json());")).toBeGreaterThan(body.indexOf('if (!res.ok) throw'));
    expect(body.indexOf("setLoadFailed(false);")).toBeGreaterThan(body.indexOf("setData(await res.json());"));
    expect(body).toContain("setLoadFailed(true);");
    expect(src).toContain("a failed weekly read used");
    expect(src).toContain("indistinguishable from loading");
  });

  it("render order: failure strip (with retry) before the still-loading null; cards need data", () => {
    expect(src).toContain("if (prefsOff) return null;");
    expect(src.indexOf("if (!data && loadFailed) {")).toBeLessThan(
      src.indexOf("if (!data) return null; // still loading — the widget never blocks the page"),
    );
    expect(src).toContain('data-testid="contest-hub-load-error"');
    expect(src).toContain("onClick={() => void loadWeekly()}");
    expect(src.indexOf("{!challenge && data.week_available && (")).toBeGreaterThan(
      src.indexOf("if (!data) return null;"),
    );
  });
});

describe("prefs + admin reads — progressive enhancement, ok-gated", () => {
  it("the retention toggle hides the widget only on an ok explicit off", () => {
    const body = slice(src, "/* Retention toggle:", "/* Admin detection");
    expect(body).toContain("if (res.ok) {");
    expect(body).toContain("setPrefsOff(j.contests_enabled === false);");
    expect(body).toContain("catch { /* default: show */ }");
  });

  it("admin status is set only on ok", () => {
    const body = slice(src, "/* Admin detection", "const challenge = data?.challenge");
    expect(body).toContain("if (res.ok) {");
    expect(body).toContain("setIsAdmin(j.isAdmin === true);");
    expect(body).toContain("catch { /* non-fatal */ }");
  });
});

describe("the admin launch — success only after ok, refresh only from an ok refetch", () => {
  it("non-ok throws into launchError; the weekly data refreshes only if the refetch is ok", () => {
    const body = slice(src, "const launchThisWeek = async () => {", "if (prefsOff) return null;");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(j, "Launch failed"));');
    expect(body.indexOf("if (w.ok) setData(await w.json());")).toBeGreaterThan(body.indexOf('if (!res.ok) throw'));
    expect(body).toContain('setLaunchError(plainErrorText(e, "Launch failed"));');
    expect(body).toContain("setLaunching(false);");
  });
});
