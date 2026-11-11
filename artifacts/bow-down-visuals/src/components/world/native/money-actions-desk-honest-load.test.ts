/**
 * MoneyActionsDesk — honest load standard (deep-pins tranche 4,
 * batch A). Two independent collection loads, each with its own
 * failed flag: permanence (non-ok OR an unparseable state throws
 * into permFailed) and claims (non-ok throws into claimsFailed).
 * In render the failed branch — its own copy plus a retry wired
 * to the real loader — comes BEFORE the null/loading branch, and
 * the claims empty line ("no claims") is reachable only after a
 * successful load, so a failed read can never dress as "you have
 * nothing here." The permanence shelf's own honestly-empty line
 * (no per-release elections) likewise renders only inside the
 * loaded branch. Every write — catalog election, per-release
 * election, claim action — throws on non-ok BEFORE its saved note
 * and then re-reads its rail, so the desk believes only server
 * truth; a note-less resolve is refused by the desk's own gate
 * before any call is made.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./MoneyActionsDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("permanence load — failed, loading, loaded in that order", () => {
  it("non-ok or unparseable throws into permFailed; success clears it", () => {
    const body = slice(src, "const loadPermanence = useCallback(async () => {", "const loadClaims = useCallback(async () => {");
    expect(body).toContain('fetch("/api/distribution/permanence", { headers: await authHeaders() })');
    expect(body).toContain('if (!res.ok) throw new Error("permanence");');
    expect(body).toContain("const parsed = parsePermanenceState(await res.json());");
    expect(body).toContain('if (!parsed) throw new Error("permanence");');
    expect(body).toContain("setPermanence(parsed);");
    expect(body).toContain("setPermFailed(false);");
    expect(body).toContain("} catch { setPermFailed(true); }");
    expect(body.indexOf("setPermanence(parsed);")).toBeGreaterThan(body.indexOf('if (!parsed) throw new Error("permanence");'));
  });

  it("render puts the failed branch (with retry) before the loading branch", () => {
    expect(src).toContain('t("worldCoachMoney.maPermLoadFailed")');
    expect(src).toContain('data-testid="world-permanence-retry" onClick={() => void loadPermanence()}');
    expect(src).toContain('t("worldCoachMoney.maPermLoading")');
    expect(src.indexOf("{permFailed ? (")).toBeLessThan(src.indexOf("permanence === null ? ("));
    /* The honestly-empty line lives inside the loaded branch only. */
    expect(src).toContain('t("worldCoachMoney.maNoReleaseElections")');
    expect(src.indexOf('t("worldCoachMoney.maNoReleaseElections")')).toBeGreaterThan(src.indexOf("permanence === null ? ("));
  });
});

describe("claims load — the empty line is reachable only after success", () => {
  it("non-ok throws into claimsFailed; success records rows and clears it", () => {
    const body = slice(src, "const loadClaims = useCallback(async () => {", "useEffect(() => { void loadPermanence(); void loadClaims(); }, [loadPermanence, loadClaims]);");
    expect(body).toContain('fetch("/api/content-id/claims", { headers: await authHeaders() })');
    expect(body).toContain('if (!res.ok) throw new Error("claims");');
    expect(body).toContain("setClaims(parseClaimRows(await res.json(), {");
    expect(body).toContain("setClaimsFailed(false);");
    expect(body).toContain("} catch { setClaimsFailed(true); }");
  });

  it("render order is failed (with retry) before loading before empty", () => {
    expect(src).toContain('t("worldCoachMoney.maClaimsLoadFailed")');
    expect(src).toContain('data-testid="world-claims-retry" onClick={() => void loadClaims()}');
    expect(src).toContain('t("worldCoachMoney.maClaimsLoading")');
    expect(src).toContain('t("worldCoachMoney.maNoClaims")');
    expect(src.indexOf("{claimsFailed ? (")).toBeLessThan(src.indexOf("claims === null ? ("));
    expect(src.indexOf("claims === null ? (")).toBeLessThan(src.indexOf("claims.length === 0 ? ("));
  });
});

describe("writes — the saved note lands only after the ok guard, then a re-read", () => {
  it("the catalog election throws on non-ok before its note", () => {
    const body = slice(src, "const chooseCatalog = async (election: PermanenceElection) => {", "const chooseRelease = async (releaseId: string, election: PermanenceElection) => {");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorLine(data, t("worldCoachMoney.maCatalogSaveError")));');
    expect(body).toContain('setPermNote(t("worldCoachMoney.maCatalogSavedNote"));');
    expect(body.indexOf('setPermNote(t("worldCoachMoney.maCatalogSavedNote"));')).toBeGreaterThan(body.indexOf('if (!res.ok) throw new Error(apiErrorLine(data, t("worldCoachMoney.maCatalogSaveError")));'));
    expect(body).toContain("await loadPermanence();");
  });

  it("the release election throws on non-ok before its note", () => {
    const body = slice(src, "const chooseRelease = async (releaseId: string, election: PermanenceElection) => {", "const actOnClaim = async (claim: ClaimRow, action: ClaimAction) => {");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorLine(data, t("worldCoachMoney.maReleaseSaveError")));');
    expect(body).toContain('setPermNote(t("worldCoachMoney.maReleaseSavedNote"));');
    expect(body.indexOf('setPermNote(t("worldCoachMoney.maReleaseSavedNote"));')).toBeGreaterThan(body.indexOf('if (!res.ok) throw new Error(apiErrorLine(data, t("worldCoachMoney.maReleaseSaveError")));'));
    expect(body).toContain("await loadPermanence();");
  });

  it("a claim action is gated before the call and throws on non-ok before its note", () => {
    const body = slice(src, "const actOnClaim = async (claim: ClaimRow, action: ClaimAction) => {", "const muted = isLight");
    expect(body).toContain('const problem = claimActionProblem(action, note, t("worldCoachMoney.maClaimResolveNeedsNote"));');
    expect(body).toContain("if (problem) { setClaimError(problem); setClaimNote(null); return; }");
    expect(body.indexOf("fetch(claimActionPath(claim.id), {")).toBeGreaterThan(body.indexOf("if (problem) { setClaimError(problem); setClaimNote(null); return; }"));
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorLine(data, t("worldCoachMoney.maActionFailed")));');
    expect(body.indexOf('action === "dispute" ? t("worldCoachMoney.maDisputedNote")')).toBeGreaterThan(body.indexOf('if (!res.ok) throw new Error(apiErrorLine(data, t("worldCoachMoney.maActionFailed")));'));
    expect(body).toContain("await loadClaims();");
  });
});
