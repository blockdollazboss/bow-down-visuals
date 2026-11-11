/**
 * SocialProofDesk (World native) — honest load standard
 * (deep-pins tranche 5). A discriminated LoadState with
 * FOUR kinds: loading, unavailable (the rail answered 503 —
 * the feature is down, a different truth from a failed
 * read), failed, and ready. The load throws on !ok and on
 * an unparseable body; the catch lands on failed, and the
 * ready state can only be constructed with a parsed state
 * in hand. Refresh and visibility-save follow the same
 * gate: success replaces the state only from a parsed ok
 * body; the optimistic toggle reverts WHOLE on failure and
 * the error surfaces as an action error — never as a lost
 * desk.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SocialProofDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the load — four kinds, distinctly earned", () => {
  it("503 is unavailable; !ok and unparseable throw to failed; ready requires a parsed state", () => {
    expect(src).toContain('| { kind: "unavailable" }');
    expect(src).toContain('| { kind: "failed" }');
    const body = slice(src, "const loadState = useCallback(async () => {", "async function refresh() {");
    expect(body).toContain('setLoad({ kind: "loading" });');
    expect(body).toContain("if (res.status === 503) {");
    expect(body).toContain('setLoad({ kind: "unavailable" });');
    expect(body).toContain('if (!res.ok) throw new Error("load failed");');
    expect(body).toContain('if (!state) throw new Error("load failed");');
    expect(body).toContain('setLoad({ kind: "ready", state });');
    expect(body.indexOf("if (res.status === 503) {")).toBeLessThan(body.indexOf('if (!res.ok) throw new Error("load failed");'));
    expect(body.indexOf('if (!state) throw new Error("load failed");')).toBeLessThan(
      body.indexOf('setLoad({ kind: "ready", state });'),
    );
    const catchPart = slice(body, "} catch {", "}, [deskHeaders]);");
    expect(catchPart).toContain('setLoad({ kind: "failed" });');
    expect(catchPart).not.toContain("ready");
  });
});

describe("refresh + save — the state moves only from parsed ok bodies", () => {
  it("refresh failure is an action error; the ready state stays untouched", () => {
    const body = slice(src, "async function refresh() {", "async function toggle(");
    expect(body).toContain('if (!res.ok) throw new Error("refresh failed");');
    expect(body).toContain('if (!state) throw new Error("refresh failed");');
    expect(body).toContain('setLoad({ kind: "ready", state });');
    const catchPart = slice(body, "} catch {", "} finally {");
    expect(catchPart).toContain('setActionError(t("worldSocialDesk.proofRefreshError"));');
    expect(catchPart).not.toContain("setLoad");
  });

  it("the optimistic toggle reverts whole on a refused save", () => {
    const body = slice(src, "async function toggle(figure: SocialProofFigure, show: boolean) {", "return (");
    expect(body).toContain('if (!res.ok) throw new Error("save failed");');
    expect(body).toContain('if (!saved) throw new Error("save failed");');
    const catchPart = slice(body, "} catch {", "} finally {");
    expect(catchPart).toContain('setActionError(t("worldSocialDesk.proofSaveError"));');
    expect(catchPart).toContain('setLoad({ kind: "ready", state });');
  });
});
