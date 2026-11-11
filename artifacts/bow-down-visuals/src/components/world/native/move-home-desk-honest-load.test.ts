/**
 * MoveHomeDesk — honest load standard (deep-pins tranche 4,
 * batch A). The desk has one status load and a family of writes
 * that all ride the same status rail. The load: guests never call
 * it (the guest branch renders the sign-in line instead); a
 * non-ok answer OR a response the seam cannot parse throws into
 * the failed state — NativeErrorState with its own title/message
 * and a retry wired to the real loader — which renders BEFORE
 * the null/loading state, so a failed load never reaches the
 * answers form or the steps list dressed as a fresh start. The
 * writes share one runner: the shared post helper throws on
 * non-ok and on an unparseable status before returning a view,
 * and run() applies a view before it sets the success note — a
 * thrown write lands the plain error line instead. The answers
 * save re-reads the status after its PUT (the rail returns no
 * status body) and throws when that re-read cannot be parsed;
 * a step edit closes its editor only after both guards pass.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./MoveHomeDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("load — failed is its own state, before loading, never a fresh start", () => {
  it("non-ok or unparseable throws into the failed flag", () => {
    const body = slice(src, "const load = useCallback(async () => {", "useEffect(() => { void load(); }, [load]);");
    expect(body).toContain("if (isGuest) return;");
    expect(body).toContain('if (!res.ok) throw new Error("move-home");');
    expect(body).toContain("const parsed = moveHomeStatusOfResponse(await res.json().catch(() => ({})));");
    expect(body).toContain('if (!parsed) throw new Error("move-home");');
    expect(body).toContain("applyStatus(parsed);");
    expect(body).toContain("} catch {");
    expect(body).toContain("setFailed(true);");
    expect(body.indexOf("applyStatus(parsed);")).toBeGreaterThan(body.indexOf('if (!parsed) throw new Error("move-home");'));
  });

  it("render order is the error state (with retry) before the loading state", () => {
    expect(src).toContain('title={t("worldRemainder.mvhLoadTitle")}');
    expect(src).toContain('message={t("worldRemainder.mvhLoadMessage")}');
    expect(src).toContain("onRetry={() => void load()}");
    expect(src).toContain('message={t("worldRemainder.mvhLoading")}');
    expect(src.indexOf("{failed ? (")).toBeLessThan(src.indexOf("status === null || answers === null ? ("));
  });

  it("guests get the sign-in line and no load at all", () => {
    const body = slice(src, "if (isGuest) {", "return (\n    <div className=\"space-y-3\" data-testid=\"world-move-home-desk\">");
    expect(body).toContain('t("worldRemainder.mvhGuestBody")');
  });
});

describe("writes — the success note lands only from a parsed status view", () => {
  it("the shared post helper throws on non-ok and on unparseable before returning", () => {
    const body = slice(src, "const post = async (path: string, body?: unknown): Promise<MoveHomeStatusView> => {", "const saveAnswers = () => {");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldRemainder.mvhDidntGoThrough")));');
    expect(body).toContain("const parsed = moveHomeStatusOfResponse(data);");
    expect(body).toContain('if (!parsed) throw new Error(t("worldRemainder.mvhDidntGoThrough"));');
    expect(body).toContain("return parsed;");
    expect(body.indexOf("return parsed;")).toBeGreaterThan(body.indexOf('if (!parsed) throw new Error(t("worldRemainder.mvhDidntGoThrough"));'));
  });

  it("run() applies the view before the success note; a throw lands the error line", () => {
    const body = slice(src, "const run = async (key: string, fn: () => Promise<MoveHomeStatusView | null>, okNote: string) => {", "const post = async (path: string, body?: unknown): Promise<MoveHomeStatusView> => {");
    expect(body).toContain("const view = await fn();");
    expect(body).toContain("if (view) applyStatus(view);");
    expect(body).toContain("setNote(okNote);");
    expect(body.indexOf("setNote(okNote);")).toBeGreaterThan(body.indexOf("if (view) applyStatus(view);"));
    expect(body).toContain('setNote(plainErrorText(err, t("worldRemainder.mvhDidntGoThroughRetry")));');
  });

  it("the answers save throws on non-ok, then re-reads and throws on unparseable", () => {
    const body = slice(src, "const saveAnswers = () => {", "const buildDrafts = () =>");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldRemainder.mvhAnswersSaveFailed")));');
    expect(body).toContain("const again = await fetch(withLocale(MOVE_HOME_PATH, locale), { headers: await authHeaders() });");
    expect(body).toContain('if (!parsed) throw new Error(t("worldRemainder.mvhAnswersSaveFailed"));');
    expect(body.indexOf("return parsed;")).toBeGreaterThan(body.indexOf('if (!parsed) throw new Error(t("worldRemainder.mvhAnswersSaveFailed"));'));
  });

  it("a step edit closes the editor only after the ok and parse guards", () => {
    const body = slice(src, "const saveStepEdit = (step: MoveHomeStepKey) => (payload: Record<string, unknown>) =>", "const stepVerb = (step: MoveHomeStepView, verb:");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldRemainder.mvhEditsSaveFailed")));');
    expect(body).toContain('if (!parsed) throw new Error(t("worldRemainder.mvhEditsSaveFailed"));');
    expect(body).toContain("setEditing(null);");
    expect(body.indexOf("setEditing(null);")).toBeGreaterThan(body.indexOf('if (!parsed) throw new Error(t("worldRemainder.mvhEditsSaveFailed"));'));
  });
});
