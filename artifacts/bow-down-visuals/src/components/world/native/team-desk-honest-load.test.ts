/**
 * TeamDesk — honest load standard (deep-pins tranche 4,
 * batch D). The desk's loads are classified by weight, and
 * every surface in the file is accounted for here:
 *
 * - THE WORKSPACE LOAD (loadAll) is the core, with FOUR
 *   honest phases in render order — loading, tier, failed,
 *   ready. A 403 carrying the rail's own Shot Caller sentence
 *   is classified as the tier gate (the locked-create card in
 *   the rail's words), NOT a failure and NOT an empty
 *   workspace; any other non-ok throws into failed (error
 *   state + Retry). The list and the detail record only from
 *   seam-parsed payloads — a null parse throws.
 * - THE RAILS INSIDE (admin spending, my vaults, the group
 *   profile) each carry their own failed state with a Retry
 *   in place of the section — a dead rail never reads as
 *   "spent nothing" / "no vaults" / an unset group, and never
 *   takes the workspace down with it. Each renders loading
 *   (null) before honestly-empty before rows.
 * - THE GROUP PREVIEW separates its endings: 404 is "missing"
 *   (not published yet), anything else is "failed."
 * - THE WRITES ride the throwing api() helper — non-ok throws
 *   before any note is set, so every success note (created,
 *   funded, shared, saved…) is claimed only after the rail's
 *   ok. The one money move, pool funding, adds the confirmed-
 *   spend shape: an invalid amount refuses before the call, a
 *   decline (null) runs nothing, 402 is the named
 *   out-of-credits ending, and the funded note waits for a
 *   parsed fund result. The vault share toggle takes the
 *   row's new state from the rail's parsed answer, never
 *   from the tap.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./TeamDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the api helper: non-ok throws before anything can claim success", () => {
  it("throws the rail's words on non-ok", () => {
    const api = slice(src, "const api = useCallback(", "const loadSpending = useCallback(");
    expect(api).toContain("if (!res.ok) {");
    expect(api).toContain('throw new Error(apiErrorMessage(data, t("worldTeamLegal.teamRequestFailed", { status: res.status })));');
  });
});

describe("the workspace load: tier is classified, failure is failed, records are parsed", () => {
  const load = slice(src, "const loadAll = useCallback", "useEffect(() => {\n    void loadAll();");

  it("the Shot Caller 403 lands the tier phase before the generic throw", () => {
    expect(load).toContain("if (isTierGateError(res.status, message)) {");
    expect(load).toContain('setPhase("tier");');
    expect(load.indexOf('setPhase("tier");')).toBeLessThan(load.indexOf("throw new Error(message);"));
  });

  it("list and detail record only from parsed payloads; failure lands failed with its message", () => {
    expect(load).toContain("const parsedList = parseTeamList(raw);");
    expect(load).toContain('if (!parsedList) throw new Error("teams shape");');
    expect(load).toContain("const parsedDetail = parseTeamDetail(await api(teamDetailPath(active.id)));");
    expect(load).toContain('if (!parsedDetail) throw new Error("team shape");');
    expect(load).toContain('setFailMessage(plainErrorText(e, t("team.errorLoad")));');
    expect(load).toContain('setPhase("failed");');
  });

  it("no active team is a ready workspace, not an error and not a fake team", () => {
    expect(load).toContain("if (!active) {");
    expect(load).toContain("setDetail(null);");
    expect(load).toContain('setPhase("ready");');
  });

  it("the render orders the four phases loading, tier, failed, ready", () => {
    expect(src.indexOf('phase === "loading"')).toBeLessThan(src.indexOf('phase === "tier"'));
    expect(src.indexOf('phase === "tier"')).toBeLessThan(src.indexOf('phase === "failed"'));
    expect(src).toContain("onRetry={() => void loadAll()}");
    expect(src).toContain('title={t("worldTeamLegal.teamLoadFailedTitle")}');
  });
});

describe("the inside rails: each failure is its own state with a retry", () => {
  it("spending: a failed or unparseable read sets the failed flag, and the error card replaces the section", () => {
    const spend = slice(src, "const loadSpending = useCallback(", "/* The vault list carries");
    expect(spend).toContain("const rows = parseSpending(await api(teamSpendingPath(teamId)));");
    expect(spend).toContain('if (rows === null) throw new Error("spending shape");');
    expect(spend).toContain("setSpendingFailed(true);");
    expect(src).toContain("iAmAdmin && spendingFailed && spending.length === 0 ? (");
    expect(src).toContain('data-testid="world-team-spending-error"');
    expect(src).toContain("onClick={() => void loadSpending(team.id)}");
    expect(src).toContain('t("worldTeamLegal.teamSpendingError")');
  });

  it("vaults: failed before loading (null) before honestly-empty, with a retry", () => {
    const vaults = slice(src, "const loadVaults = useCallback(", "const fillGroupForm = useCallback(");
    expect(vaults).toContain("const rows = parseOwnVaults(await api(VAULTS_PATH), user?.id ?? null);");
    expect(vaults).toContain('if (rows === null) throw new Error("vaults shape");');
    expect(vaults).toContain("setVaultsFailed(true);");
    expect(src.indexOf("{vaultsFailed ? (")).toBeLessThan(src.indexOf("vaults === null ? ("));
    expect(src.indexOf("vaults === null ? (")).toBeLessThan(src.indexOf("vaults.length === 0 ? ("));
    expect(src).toContain("isn&rsquo;t hidden, it just didn&rsquo;t arrive.");
    expect(src).toContain("onClick={() => void loadVaults()}");
  });

  it("group profile: failed renders its error + retry, distinct from loading", () => {
    const group = slice(src, "const loadGroup = useCallback(", "const loadAll = useCallback");
    expect(group).toContain("const dto = parseGroupOwn(await api(teamGroupProfilePath(teamId)));");
    expect(group).toContain('if (!dto) throw new Error("group shape");');
    expect(group).toContain('setGroupPhase("failed");');
    expect(src).toContain('groupPhase === "failed" || !groupDto ? (');
    expect(src).toContain('data-testid="world-team-group-error"');
    expect(src).toContain("onClick={() => void loadGroup(team.id)}");
  });

  it("the public preview separates missing (404) from failed", () => {
    const preview = slice(src, "async function handlePreview() {", "const roleIcon =");
    expect(preview).toContain('setPreviewState("loading");');
    expect(preview).toContain('e instanceof GroupProfileFetchError && e.status === 404 ? "missing" : "failed"');
    expect(preview.indexOf('setPreviewState("ready");')).toBeGreaterThan(preview.indexOf("setPreview(await fetchPublicGroupProfile(slug));"));
  });
});

describe("the writes: notes land only after the rail's ok", () => {
  it("create reloads and notes only after the throwing api() resolves", () => {
    const create = slice(src, "async function handleCreate() {", "async function handleAccept(teamId: string) {");
    expect(create).toContain("if (!teamNameReady(newTeamName)) return;");
    expect(create.indexOf('setNote(t("worldTeamLegal.teamNoteCreated"));')).toBeGreaterThan(create.indexOf("await api(TEAMS_PATH"));
  });

  it("the vault share takes the row's new state from the parsed answer, never the tap", () => {
    const share = slice(src, "async function handleVaultShare(vault: TeamVaultRow) {", "async function handleCreate() {");
    expect(share).toContain("const result = parseVaultShareResult(data);");
    expect(share).toContain('if (!result) throw new Error("share shape");');
    expect(share).toContain("teamId: result.teamId, shared: result.teamId !== null");
    expect(share.indexOf("setVaults((prev) =>")).toBeGreaterThan(share.indexOf('if (!result) throw new Error("share shape");'));
  });
});

describe("pool funding — the one money move, in confirmed-spend shape", () => {
  const fund = slice(src, "async function handleFund() {", "async function handleLeave() {");

  it("an unreadable amount refuses before the call", () => {
    expect(fund).toContain("const amount = fundAmountFromInput(fundAmount);");
    expect(fund).toContain("if (amount === null) {");
    expect(fund).toContain('setError(t("worldTeamLegal.teamErrorFundAmount"));');
    expect(fund.indexOf("if (amount === null) {")).toBeLessThan(fund.indexOf("confirmedFetch(teamFundPath(team.id)"));
  });

  it("decline runs nothing; 402 is out-of-credits; non-ok throws; the note waits for the parsed result", () => {
    expect(fund).toContain("if (res === null) return;");
    expect(fund).toContain('if (res.status === 402 || data["error"] === "out_of_credits") {');
    expect(fund).toContain("setOutOfCredits(true);");
    expect(fund).toContain("if (!res.ok) {");
    expect(fund).toContain("const result = parseFundResult(data);");
    expect(fund).toContain('if (!result) throw new Error("fund shape");');
    expect(fund.indexOf("if (res === null) return;")).toBeLessThan(fund.indexOf("if (res.status === 402"));
    expect(fund.indexOf('setNote(\n        result.duplicate')).toBeGreaterThan(fund.indexOf('if (!result) throw new Error("fund shape");'));
    expect(fund).toContain("overrideCost: amount,");
    expect(fund).toContain('overrideFeature: "Team Pool Funding",');
  });
});
