/**
 * LlcDesk (World native) — honest load standard (deep-pins
 * tranche 5). No mount list load: the chat and the plan are
 * paid asks, and both roll back honestly. The chat appends
 * the assistant's answer only from a body parsed under
 * res.ok; on cancel, on 402, and on any failure the message
 * list is restored to exactly what it was before the send —
 * the member's question is never left standing as if
 * answered, and no placeholder answer is invented. The
 * plan follows the same gate: setPlan only from a parsed
 * ok body; 402 is the out state for both.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LlcDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the ask — the transcript only grows from a parsed answer", () => {
  it("cancel and 402 restore the pre-send list; the answer append sits past the parse gate; failure restores too", () => {
    const body = slice(src, "if (res === null) {", "async function buildPlan() {");
    expect(body).toContain("setMessages(messages);");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setChatOut(true);");
    expect(body).toContain("const answer = res.ok ? llcAnswerOf(data) : null;");
    expect(body).toContain('if (!answer) throw new Error(apiErrorMessage(data, t("llcGuide.errAnswer")));');
    expect(body).toContain("setMessages([...next, { role: \"assistant\", content: answer }]);");
    expect(body.indexOf('if (!answer) throw new Error(')).toBeLessThan(
      body.indexOf("setMessages([...next, { role: \"assistant\", content: answer }]);"),
    );
    const catchPart = slice(body, "} catch (e) {", "} finally {");
    expect(catchPart).toContain('setChatError(plainErrorText(e, t("llcGuide.errAnswer")));');
    expect(catchPart).toContain("setMessages(messages);");
    // rollback occurrences: cancel + 402 + catch — the append is the only growth
    expect(body.split("setMessages(messages);").length - 1).toBe(3);
  });
});

describe("the plan — set only from a parsed ok body", () => {
  it("missing payload is a form error before any spend; cancel silent; 402 out; parse gate before setPlan", () => {
    const body = slice(src, "async function buildPlan() {", "return (");
    expect(body).toContain("if (!payload || planning) {");
    expect(body).toContain('setPlanError(t("worldTeamLegal.llcPlanStateError"));');
    expect(body).toContain("if (res === null) return;");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setPlanOut(true);");
    expect(body).toContain("const parsed = res.ok ? llcPlanOf(data, llcPlanStrings(t)) : null;");
    expect(body).toContain('if (!parsed) throw new Error(apiErrorMessage(data, t("worldTeamLegal.llcPlanError")));');
    expect(body).toContain("setPlan(parsed);");
    expect(body.indexOf('if (!parsed) throw new Error(')).toBeLessThan(body.indexOf("setPlan(parsed);"));
    const catchPart = slice(body, "} catch (e) {", "} finally {");
    expect(catchPart).toContain("setPlanError(plainErrorText(e,");
    expect(catchPart).not.toContain("setPlan(");
  });
});
