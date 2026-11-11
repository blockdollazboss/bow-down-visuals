/**
 * SecondLifeSettings — honest load standard (deep-pins
 * tranche 5). The component states its own honesty rule in
 * a header comment — a failed load is NOT "everything on,
 * queue empty" — and the code keeps it: BOTH legs (prefs +
 * revival queue) must answer ok or the whole load throws
 * into loadError, whose branch (error copy + a Retry that
 * bumps retryNonce, re-running the effect) renders before
 * any control. The queue is null while loading and an array
 * only after a successful load, so "empty" is always a
 * proven state. Writes: the optimistic toggle reverts to
 * the previous value on failure, and decide() toasts
 * success only after res.ok — a failed decision changes
 * nothing on screen.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SecondLifeSettings.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the load — both legs or an honest error", () => {
  it("either leg non-ok throws; prefs + queue land together only on success; the catch sets loadError", () => {
    expect(src).toContain("const [loadError, setLoadError] = useState(false);");
    expect(src).toContain("const [revivals, setRevivals] = useState<Revival[] | null>(null);");
    const body = slice(src, "const [prefsRes, queueRes] = await Promise.all([", "async function toggleWatch(");
    expect(body).toContain('if (!prefsRes.ok || !queueRes.ok) throw new Error("load failed");');
    expect(body).toContain("setPrefs({ watch_enabled: p.watch_enabled ?? true });");
    expect(body).toContain("setRevivals(Array.isArray(q.revivals) ? q.revivals : []);");
    expect(body.indexOf('if (!prefsRes.ok || !queueRes.ok) throw new Error("load failed");')).toBeLessThan(
      body.indexOf("setRevivals(Array.isArray(q.revivals) ? q.revivals : []);"),
    );
    const catchPart = slice(body, "} catch {", "return () => {");
    expect(catchPart).toContain("if (!cancelled) setLoadError(true);");
    expect(catchPart).not.toContain("setRevivals");
    // the effect re-runs on the retry nonce
    expect(src).toContain("}, [user, getAccessToken, retryNonce]);");
  });

  it("render: the loadError branch (with its retry) stands before the controls; queue null is the loading line", () => {
    const body = slice(src, "{loadError ? (", "</section>");
    expect(body).toContain('{t("settings.secondLife.loadError")}');
    expect(body).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(body).toContain('{t("settings.secondLife.retry")}');
    expect(body).toContain('{t("settings.secondLife.queueLoading")}');
    expect(body.indexOf("{loadError ? (")).toBeLessThan(body.indexOf('{t("settings.secondLife.queueLoading")}'));
  });
});

describe("the writes — optimistic with a real revert, success only after ok", () => {
  it("toggleWatch reverts to the previous value on failure and toasts saved only past the gate", () => {
    const body = slice(src, "async function toggleWatch(", "async function decide(");
    expect(body).toContain("const prev = prefs.watch_enabled;");
    expect(body).toContain("setPrefs({ watch_enabled: nextValue }); // optimistic");
    expect(body).toContain('if (!res.ok) throw new Error("save failed");');
    expect(body).toContain('toast({ title: t("settings.secondLife.saved") });');
    expect(body.indexOf('if (!res.ok) throw new Error("save failed");')).toBeLessThan(
      body.indexOf('toast({ title: t("settings.secondLife.saved") });'),
    );
    const catchPart = slice(body, "} catch {", "} finally {");
    expect(catchPart).toContain("setPrefs({ watch_enabled: prev }); // revert on failure");
    expect(catchPart).toContain('toast({ title: t("settings.secondLife.saveFailed"), variant: "destructive" });');
  });

  it("decide: approve/dismiss mutate the list only after res.ok; failure toasts and changes nothing", () => {
    const body = slice(src, "async function decide(", "const watchOn =");
    expect(body).toContain('if (!res.ok) throw new Error("decision failed");');
    expect(body).toContain("setApprovedIds((s) => new Set(s).add(revival.id));");
    expect(body).toContain('toast({ title: t("settings.secondLife.approved") });');
    expect(body.indexOf('if (!res.ok) throw new Error("decision failed");')).toBeLessThan(
      body.indexOf("setApprovedIds((s) => new Set(s).add(revival.id));"),
    );
    const catchPart = slice(body, "} catch {", "} finally {");
    expect(catchPart).toContain('toast({ title: t("settings.secondLife.decisionFailed"), variant: "destructive" });');
    expect(catchPart).not.toContain("setRevivals");
    expect(catchPart).not.toContain("setApprovedIds");
  });
});
