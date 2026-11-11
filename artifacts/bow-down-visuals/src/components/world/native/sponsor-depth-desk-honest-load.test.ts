/**
 * SponsorDepthDesk — honest load standard (deep-pins tranche 3,
 * batch 3). The sponsor marketplace at full depth, in-World.
 *
 * Three loads, all honest:
 * - The DASHBOARD renders in the house order — error state (with a
 *   retry wired to loadDashboard) before the loading state before
 *   the summary — and the summary's numbers render only from a
 *   successful load (the header comment's law: "never a painted
 *   $0.00"). The three boards' empty states render only inside the
 *   loaded arm.
 * - The can-spend readout is FAIL-OPEN BY DESIGN (documented in its
 *   comment): a failed read leaves the desk un-paused and the
 *   submit-time 403 still answers honestly — pinned as the
 *   documented exception, not a silent swallow.
 * - The DETAIL load mirrors the dashboard (error → loading →
 *   content), and the owner's applications sub-load has its own
 *   honest state: a failed read sets applications to null, which
 *   renders the "couldn't be read" line — NEVER the "no applications
 *   yet" empty copy, which is gated on a successful empty read.
 *
 * Writes pin as-is: the deal post walks the full honesty chain
 * (form validation → decline runs nothing → 402 names out-of-credits
 * → spending-paused → non-ok surfaces the server's message), and the
 * desk only opens the new deal after all of it. The pitch writer
 * treats a misshapen result as an error. runAction — the shared
 * rail for apply / review / fund / start / complete / release —
 * throws the server's words into detailError on non-ok and only
 * reloads the detail + bumps the dashboard tick on ok, so no action
 * ever paints success over a failed write.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SponsorDepthDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("dashboard load — failure first, loading second, numbers only from a real load", () => {
  it("loadDashboard throws on non-ok and on a misshapen body before any state write", () => {
    const loader = slice(src, "const loadDashboard = async () => {", "useEffect(() => {");
    expect(loader).toContain("if (!res.ok) throw new Error(`dashboard ${res.status}`);");
    expect(loader).toContain("const parsed = normalizeSponsorDashboard(await res.json());");
    expect(loader).toContain('if (!parsed) throw new Error("dashboard shape");');
    expect(loader.indexOf("setDashboard(parsed)")).toBeGreaterThan(loader.indexOf("if (!parsed) throw"));
    expect(loader).toContain("setDashFailed(true)");
  });

  it("render order is error → loading → summary, and the boards' empties live in the loaded arm", () => {
    const errAt = src.indexOf('t("worldSponsorPress.spDeskErrorTitle")');
    const loadAt = src.indexOf('t("worldSponsorPress.spDeskLoading")');
    const summaryAt = src.indexOf('data-testid="world-sponsor-depth-summary"');
    expect(errAt).toBeGreaterThan(-1);
    expect(loadAt).toBeGreaterThan(errAt);
    expect(summaryAt).toBeGreaterThan(loadAt);
    const boards = src.slice(src.indexOf("{dashboard && ("));
    expect(boards).toContain("dashboard.postedDeals.length === 0");
    expect(boards).toContain("spBoardPostedEmpty");
    expect(boards).toContain("dashboard.applications.length === 0");
    expect(boards).toContain("spBoardApplicationsEmpty");
    expect(boards).toContain("dashboard.payouts.length === 0");
    expect(boards).toContain("spBoardEarningsEmpty");
  });

  it("the error state's retry is wired to the real loader", () => {
    const errBlock = slice(src, "message={t(\"worldSponsorPress.spDeskErrorMessage\")}", "spDeskLoading");
    expect(errBlock).toContain("onRetry={() => void loadDashboard()}");
  });
});

describe("can-spend readout — the documented fail-open exception", () => {
  it("a failed readout never pauses the desk; the submit-time 403 still speaks", () => {
    const effect = slice(src, "/* The can-spend readout: learn the paused state on arrival,", "}, [tick]);");
    expect(effect).toContain("fail-open, the submit-time 403");
    expect(effect).toContain("if (res.ok && !cancelled && normalizeSponsorCanSpend(await res.json()) === false)");
    expect(effect).toContain("setSpendingPaused(true)");
    expect(effect).toContain("/* readout unreachable — the submit-time 403 still speaks */");
  });
});

describe("detail load — and the applications sub-load's own honest state", () => {
  it("loadDetail throws on non-ok and on a misshapen body before setDeal", () => {
    const loader = slice(src, "const loadDetail = async (id: string) => {", "useEffect(() => {");
    expect(loader).toContain("if (!res.ok) throw new Error(`deal ${res.status}`);");
    expect(loader).toContain("const parsed = normalizeSponsorDealDetail(await res.json());");
    expect(loader).toContain('if (!parsed) throw new Error("deal shape");');
    expect(loader.indexOf("setDeal(parsed)")).toBeGreaterThan(loader.indexOf("if (!parsed) throw"));
    expect(loader).toContain("setDetailFailed(true)");
  });

  it("detail render order is error → loading → content, retry wired to the real loader", () => {
    const errAt = src.indexOf('t("worldSponsorPress.spDealErrorTitle")');
    const loadAt = src.indexOf('t("worldSponsorPress.spDealLoading")');
    const stepsAt = src.indexOf('data-testid="world-sponsor-depth-steps"');
    expect(errAt).toBeGreaterThan(-1);
    expect(loadAt).toBeGreaterThan(errAt);
    expect(stepsAt).toBeGreaterThan(loadAt);
    const errBlock = slice(src, "message={t(\"worldSponsorPress.spDealErrorMessage\")}", "spDealLoading");
    expect(errBlock).toContain("onRetry={() => void loadDetail(openId)}");
  });

  it("a failed applications read renders the unreadable line — never the empty copy", () => {
    const loader = slice(src, "const loadDetail = async (id: string) => {", "useEffect(() => {");
    expect(loader).toContain("setApplications(appsRes.ok ? normalizeSponsorApplications(await appsRes.json()) : null)");
    const render = slice(src, "{applications === null ? (", "{deal.acceptedApplicationId");
    expect(render).toContain("spApplicationsUnreadable");
    expect(render).toContain("applications.length === 0");
    expect(render).toContain("spApplicationsEmpty");
    expect(render.indexOf("spApplicationsUnreadable")).toBeLessThan(render.indexOf("spApplicationsEmpty"));
  });
});

describe("writes — no success is ever painted over a failed write", () => {
  it("post a deal: decline runs nothing, 402 and paused are named, non-ok surfaces the server's words", () => {
    const body = slice(src, "const postDeal = async () => {", "/* ── Detail actions");
    expect(body).toContain("if (!res) return; /* the walker cancelled the credit confirmation */");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setPostOutOfCredits(true)");
    expect(body).toContain("if (isSponsorSpendingPaused(body, res.status)) {");
    expect(body).toContain("if (!res.ok) {");
    expect(body.indexOf("openDeal(result.dealId)")).toBeGreaterThan(body.indexOf("if (!res.ok) {"));
  });

  it("write pitch: a misshapen result is an error, not a filled pitch box", () => {
    const body = slice(src, "const writePitch = async () => {", "const reviewApplication =");
    expect(body).toContain("const written = res.ok ? normalizeSponsorPitchResult(body) : null;");
    expect(body).toContain("if (!written) {");
    expect(body.indexOf("setPitch(written)")).toBeGreaterThan(body.indexOf("if (!written) {"));
    expect(body).toContain("setPitchOutOfCredits(true)");
  });

  it("runAction: non-ok lands the server's words in detailError and returns null; ok reloads before returning", () => {
    const body = slice(src, "const runAction = async (", "const applyToDeal =");
    expect(body).toContain("if (!res.ok) {");
    expect(body).toContain("setDetailError(sponsorErrorMessage(data, res.status,");
    expect(body).toContain("return null;");
    expect(body.indexOf("await loadDetail(openId)")).toBeGreaterThan(body.indexOf("if (!res.ok) {"));
    expect(body).toContain("setBusy(null)");
  });

  it("fund: the amount is validated first, and a misshapen fund result does nothing further", () => {
    const body = slice(src, "const fundDeal = async () => {", "const isBrand =");
    expect(body).toContain("if (!amountCents) {");
    expect(body).toContain("if (!data) return;");
    expect(body).toContain("const fund = normalizeSponsorFundResult(data);");
    expect(body).toContain("if (!fund) return;");
  });
});
