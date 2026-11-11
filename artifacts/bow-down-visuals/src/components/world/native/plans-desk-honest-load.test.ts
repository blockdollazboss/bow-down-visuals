/**
 * PlansDesk — honest load standard (deep-pins tranche 4, batch A).
 * The desk's standard lands on its catalog + standing load and on
 * four money writes. The load reads the plans rail and /me
 * together: a non-ok plans answer or an unparseable catalog throws
 * into the failed state (its own copy + retry), the loading line
 * renders only while plans is null, and there is no empty state to
 * dress a failure in — a landed catalog renders its cards (the /me
 * standing is additive: a failed /me simply leaves the standing
 * line out, it never fakes one). Every write sets its success
 * note/state ONLY after its guard: the embedded confirm returns on
 * non-ok before the success note; the checkout intent stops on any
 * failure kind (transport, server, error outcome) and never falls
 * through to the hosted rail, whose own branch throws on non-ok
 * before any tab opens; the tier change returns on an error
 * outcome before the preview clears; the portal throws on non-ok
 * (or a missing URL) before opening anything.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PlansDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("load — failed is failed, loading is null, never an empty lie", () => {
  it("a non-ok or unparseable catalog throws into the failed state", () => {
    const body = slice(src, "const load = useCallback(async () => {", "useEffect(() => { void load(); }, [load]);");
    expect(body).toContain('fetch("/api/creator-tiers/plans")');
    expect(body).toContain('fetch("/api/creator-tiers/me", { headers: await authHeaders() })');
    expect(body).toContain('if (!plansRes.ok) throw new Error("plans");');
    expect(body).toContain("const parsed = parseSitePlans(payload);");
    expect(body).toContain('if (!parsed) throw new Error("plans");');
    expect(body).toContain("setLoadFailed(false);");
    expect(body).toContain("} catch { setLoadFailed(true); }");
    expect(body.indexOf("setPlans(parsed);")).toBeGreaterThan(body.indexOf('if (!parsed) throw new Error("plans");'));
    /* /me is additive: it is recorded only from an ok answer. */
    expect(body).toContain("if (meRes.ok) setMe(parseSitePlanMe(await meRes.json()));");
  });

  it("render order is failed (with retry) before loading before the catalog", () => {
    const body = slice(src, "{loadFailed ? (", '{note && <p className={`text-[11px] ${muted}`}>{note}</p>}');
    expect(body).toContain('t("worldPlansDesk.loadFailed")');
    expect(body).toContain('data-testid="world-plans-retry" onClick={() => void load()}');
    expect(body).toContain('t("worldPlansDesk.loading")');
    expect(body.indexOf("{loadFailed ? (")).toBeLessThan(body.indexOf("plans === null ? ("));
  });
});

describe("embedded confirm — the success note lands only after ok", () => {
  it("non-ok returns with the pending line before the note is set", () => {
    const body = slice(src, "const confirmEmbedded = async (paymentIntentId: string) => {", "const checkout = async (plan: SitePlan) => {");
    expect(body).toContain("if (!res.ok) {");
    expect(body).toContain('setError(apiErrorMessage(data, t("worldPlansDesk.confirmPending")));');
    expect(body).toContain('setOpenedNote(t("worldPlansDesk.confirmSuccess"');
    expect(body.indexOf("setOpenedNote(")).toBeGreaterThan(body.indexOf("if (!res.ok) {"));
    expect(body).toContain('setError(t("worldPlansDesk.confirmPending"));');
  });
});

describe("checkout — a failed intent stops in the desk, never falls through", () => {
  it("transport failure and the error outcome both end in setError", () => {
    const body = slice(src, "const checkout = async (plan: SitePlan) => {", "const applyChange = async () => {");
    expect(body).toContain("outcome = planIntentOutcome(result, plan.name, planStrings);");
    expect(body).toContain("setError(checkoutFailureCopy(err, checkoutStrings));");
    expect(body).toContain("setError(outcome.message);");
    expect(body.indexOf("setError(outcome.message);")).toBeGreaterThan(body.indexOf('if (outcome.kind === "change") {'));
  });

  it("the hosted fallback throws on non-ok (or no page) before any tab opens", () => {
    const body = slice(src, "const checkout = async (plan: SitePlan) => {", "const applyChange = async () => {");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorLine(data, t("worldPlansDesk.checkoutStartFailed")));');
    expect(body).toContain('if (!url) throw new Error(t("worldPlansDesk.checkoutNoPage"));');
    expect(body.indexOf('window.open(url, "_blank", "noopener,noreferrer");')).toBeGreaterThan(body.indexOf('if (!url) throw new Error(t("worldPlansDesk.checkoutNoPage"));'));
    /* The in-place change answer reloads instead of opening a page. */
    expect(body).toContain("if (data.changed === true) {");
    expect(body.indexOf("if (data.changed === true) {")).toBeLessThan(body.indexOf("const url = planHostedUrl(data);"));
  });
});

describe("change + portal — success only after their guards", () => {
  it("an error outcome returns before the preview clears or the note lands", () => {
    const body = slice(src, "const applyChange = async () => {", "const openPortal = async () => {");
    expect(body).toContain("outcome = planChangeOutcome(result, planStrings);");
    expect(body).toContain('if (outcome.kind === "error") {');
    expect(body).toContain("setError(outcome.message);");
    expect(body.indexOf("setChangePreview(null);")).toBeGreaterThan(body.indexOf('if (outcome.kind === "error") {'));
    expect(body).toContain("setError(checkoutFailureCopy(err, checkoutStrings));");
  });

  it("the portal throws on non-ok (or no page) before opening the tab", () => {
    const body = slice(src, "const openPortal = async () => {", "const muted = isLight");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorLine(data, t("worldPlansDesk.portalOpenFailed")));');
    expect(body).toContain('if (!url) throw new Error(t("worldPlansDesk.portalNoPage"));');
    expect(body.indexOf('window.open(url, "_blank", "noopener,noreferrer");')).toBeGreaterThan(body.indexOf('if (!url) throw new Error(t("worldPlansDesk.portalNoPage"));'));
    expect(body).toContain('setOpenedNote(t("worldPlansDesk.portalOpened"));');
  });
});
