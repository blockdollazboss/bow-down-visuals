/**
 * PayoutDesk (World native) — honest load standard
 * (deep-pins tranche 5). The Connect status load has FOUR
 * honest outcomes: 404 is noProfile (the member has no
 * payout profile — a real state, not an error), 503 is
 * notConfigured (the rail itself is off — a different
 * truth), any other non-ok throws into loadFailed, and an
 * unparseable body throws too. The failed card renders
 * before the loading card and carries a retry that clears
 * the flag and re-runs the load. Money actions: onboarding
 * opens the hosted tab only with a real url in an ok body
 * (the note says the tab opened, nothing more), and the
 * payout claims success only past ok + a parsed success
 * flag, behind an explicit confirm step.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PayoutDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the status load — four outcomes, none dressed as another", () => {
  it("404 → noProfile, 503 → notConfigured, other !ok and unparseable → loadFailed; status lands only parsed", () => {
    const body = slice(src, "const load = useCallback(async () => {", "const goOnboard = async");
    expect(body).toContain("if (res.status === 404) {");
    expect(body).toContain("setNoProfile(true);");
    expect(body).toContain("if (res.status === 503) {");
    expect(body).toContain("setNotConfigured(true);");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorLine(data, t("worldCoachMoney.poLoadStatusError")));');
    expect(body).toContain("const parsed = parseConnectStatus(data);");
    expect(body).toContain('if (!parsed) throw new Error(t("worldCoachMoney.poLoadStatusError"));');
    expect(body).toContain("setStatus(parsed);");
    expect(body).toContain("setLoadFailed(false);");
    expect(body.indexOf("if (res.status === 404) {")).toBeLessThan(body.indexOf('if (!res.ok) throw new Error('));
    expect(body.indexOf('if (!parsed) throw new Error(')).toBeLessThan(body.indexOf("setStatus(parsed);"));
    const catchPart = slice(body, "} catch {", "// eslint-disable-next-line react-hooks/exhaustive-deps");
    expect(catchPart).toContain("setLoadFailed(true);");
    expect(catchPart).not.toContain("setStatus");
  });

  it("render: the failed card (with retry) precedes the loading card while status is null", () => {
    expect(src).toContain("if (!status && loadFailed) {");
    expect(src).toContain('{t("worldCoachMoney.poLoadFailedLine")}');
    expect(src).toContain("onClick={() => { setLoadFailed(false); void load(); }}");
    expect(src).toContain('{t("worldCoachMoney.poLoading")}');
    expect(src.indexOf("if (!status && loadFailed) {")).toBeLessThan(src.indexOf('{t("worldCoachMoney.poLoading")}'));
  });
});

describe("the money actions — opened and paid are claimed only from real answers", () => {
  it("onboard: the tab opens only on ok + url; the note claims no more than that", () => {
    const body = slice(src, "const goOnboard = async", "const requestPayout = async");
    expect(body).toContain('const url = typeof data["url"] === "string" ? data["url"] : null;');
    expect(body).toContain('if (!res.ok || !url) throw new Error(apiErrorLine(data, t("worldCoachMoney.poStartSetupError")));');
    expect(body).toContain('window.open(url, "_blank", "noopener,noreferrer");');
    expect(body).toContain('setNote(t("worldCoachMoney.poSetupOpenedNote"));');
    expect(body.indexOf('if (!res.ok || !url) throw new Error(')).toBeLessThan(
      body.indexOf('window.open(url, "_blank", "noopener,noreferrer");'),
    );
  });

  it("payout: the first press only arms the confirm; success requires ok AND the parsed success note", () => {
    const body = slice(src, "const doPayout = async () => {", "const muted =");
    expect(body).toContain("if (!confirmingPayout) {");
    expect(body).toContain("setConfirmingPayout(true);");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorLine(data, t("worldCoachMoney.poPayoutFailed")));');
    expect(body).toContain("const success = payoutSuccessNote(data);");
    expect(body).toContain('if (!success) throw new Error(t("worldCoachMoney.poPayoutFailed"));');
    expect(body).toContain("setNote(success);");
    expect(body).toContain("await load();");
    expect(body.indexOf('if (!success) throw new Error(')).toBeLessThan(body.indexOf("setNote(success);"));
    expect(body.indexOf("setNote(success);")).toBeLessThan(body.indexOf("await load();"));
    const catchPart = slice(body, "} catch (e) {", "} finally {");
    expect(catchPart).toContain("setErr(plainErrorText(e, t(\"worldCoachMoney.poPayoutFailed\")));");
    expect(catchPart).not.toContain("setNote");
  });
});
