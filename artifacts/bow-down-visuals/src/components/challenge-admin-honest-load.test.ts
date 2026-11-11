/**
 * ChallengeAdmin — honest load standard (deep-pins tranche 4,
 * batch C). A two-source admin bench. The list: rows are set
 * only from an ok response whose payload PARSES
 * (parseAdminChallenges) — non-ok, unparseable and network
 * failure all land in the loadError panel with a retry that
 * re-runs the load; the render order is loading → loadError →
 * honestly-empty → rows, so the empty claim sits behind a
 * successful load only. The detail is the same shape per slug:
 * the previous detail is cleared at load start, an unparseable
 * or non-ok answer is the detail error panel with its own
 * retry, and the prize/lifecycle drafts are seeded only from
 * the parsed detail. Mutations (prizes, lifecycle, judge):
 * the success message/result is set only inside res.ok; a
 * non-ok surfaces the rail's own message and claims nothing.
 * Judging — the mutation that pays — fires only from an
 * explicit confirm panel, and its parsed result is restored
 * after the post-judge refresh reloads the detail.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ChallengeAdmin.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the list — rows only from an ok, parseable payload; empty behind success", () => {
  it("load: parse-gated set, every failure path lands in loadError", () => {
    const body = slice(src, "const load = useCallback(async (): Promise<AdminChallengeRow[] | null> => {", "useEffect(() => { void load(); }, [load, retryNonce]);");
    expect(body).toContain("const parsed = res.ok ? parseAdminChallenges(await res.json()) : null;");
    expect(body.indexOf("setRows(parsed);")).toBeGreaterThan(body.indexOf("const parsed = res.ok"));
    expect(body).toContain("setLoadError(true);");
    expect(body).toContain("setLoading(false);");
  });

  it("render order: loading → loadError (with retry) → empty → rows", () => {
    expect(src.indexOf("{loading ? (")).toBeLessThan(src.indexOf(") : loadError ? ("));
    expect(src.indexOf(") : loadError ? (")).toBeLessThan(src.indexOf(") : rows.length === 0 ? ("));
    expect(src).toContain('t("admin.challenges.empty")');
    expect(src).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(src).toContain("useEffect(() => { void load(); }, [load, retryNonce]);");
  });
});

describe("the detail — cleared first, seeded only from the parsed payload", () => {
  const body = slice(src, "const loadDetail = useCallback(", "const selected = rows.find");

  it("an unparseable or non-ok answer is the detail error, never a stale editor", () => {
    expect(body.indexOf("setDetail(null);")).toBeLessThan(body.indexOf("const parsed = res.ok ? parseChallengeDetail(await res.json()) : null;"));
    expect(body).toContain("const parsed = res.ok ? parseChallengeDetail(await res.json()) : null;");
    expect(body).toContain("if (!parsed) {");
    expect(body).toContain("setDetailError(true);");
  });

  it("the drafts are seeded from the parsed detail, after it is set", () => {
    expect(body.indexOf("setPrizeDraft(")).toBeGreaterThan(body.indexOf("setDetail(parsed);"));
    expect(body).toContain("parsed.prizes.map((p) => ({");
    expect(body).toContain("setLifeStarts(toLocalInput(parsed.startsAt));");
  });

  it("render order: detail loading → detail error (with retry) → the editors", () => {
    expect(src.indexOf("{detailLoading ? (")).toBeLessThan(src.indexOf(") : detailError ? ("));
    expect(src.indexOf(") : detailError ? (")).toBeLessThan(src.indexOf(") : detail ? ("));
    expect(src).toContain("onClick={() => void loadDetail(selected.slug)}");
  });
});

describe("mutations — success only inside res.ok, the rail's words on failure", () => {
  it("prizes: local validation first; saved message only on ok; rail message otherwise", () => {
    const body = slice(src, "const savePrizes = async () => {", "const saveLifecycle = async () => {");
    expect(body.indexOf("const invalid = prizeDraftError(prizeDraft);")).toBeLessThan(body.indexOf('method: "POST",'));
    expect(body.indexOf('t("admin.challenges.prizesSaved"')).toBeGreaterThan(body.indexOf("if (res.ok) {"));
    expect(body).toContain('setActionError((await railMessage(res)) ?? t("admin.challenges.actionError"));');
  });

  it("lifecycle: saved message only on ok; rail message otherwise", () => {
    const body = slice(src, "const saveLifecycle = async () => {", "const submitJudge = async () => {");
    expect(body.indexOf('t("admin.challenges.lifecycleSaved"')).toBeGreaterThan(body.indexOf("if (res.ok) {"));
    expect(body).toContain('setActionError((await railMessage(res)) ?? t("admin.challenges.actionError"));');
  });

  it("judge: an empty pick is refused before any fetch; the result sets only on ok and survives the refresh", () => {
    const body = slice(src, "const submitJudge = async () => {", "const draftError = prizeDraft.length");
    expect(body).toContain("if (winners.length === 0) {");
    expect(body).toContain('setActionError(t("admin.challenges.pickRequired"));');
    expect(body.indexOf("const parsed = parseJudgeResult(await res.json());")).toBeGreaterThan(body.indexOf("if (res.ok) {"));
    expect(src).toContain("refresh() reloads the detail, which clears judgeResult");
    expect(body).toContain("if (parsed) setJudgeResult(parsed);");
    expect(body).toContain("setJudgeConfirm(false);");
  });

  it("judging fires only from the explicit confirm panel", () => {
    expect(src).toContain("onClick={() => setJudgeConfirm(true)}");
    expect(src).toContain('data-testid="challenge-judge-confirm"');
    expect(src).toContain("onClick={() => void submitJudge()}");
    expect(src.indexOf('data-testid="challenge-judge-confirm"')).toBeLessThan(src.indexOf("onClick={() => void submitJudge()}"));
  });
});
