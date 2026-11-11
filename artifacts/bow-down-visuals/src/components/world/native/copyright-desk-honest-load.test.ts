/**
 * CopyrightDesk (World native) — honest load standard
 * (deep-pins tranche 5). No mount list load: a paid draft
 * and a paid ask, both gated the house way. The draft is
 * set only from a body parsed under res.ok (cancel silent,
 * 402 the out state, an unparseable body the server's
 * error). The ask rolls back honestly like its LlcDesk
 * sibling: the transcript grows only from a parsed answer,
 * and on cancel, on 402, and on any failure the message
 * list is restored to exactly the pre-send list — the
 * question never stands as if answered.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CopyrightDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the draft — set only from a parsed ok body", () => {
  it("a missing payload is a form error pre-spend; cancel silent; 402 out; parse gate before setDraft", () => {
    const body = slice(src, "async function runDraft() {", "async function ask() {");
    expect(body).toContain("if (!payload || drafting) {");
    expect(body).toContain('setDraftError(t("worldTeamLegal.copyrightDraftTitleError"));');
    expect(body).toContain("if (res === null) return;");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setDraftOut(true);");
    expect(body).toContain("const parsed = res.ok ? copyrightDraftOf(data) : null;");
    expect(body).toContain('if (!parsed) throw new Error(apiErrorMessage(data, t("worldTeamLegal.copyrightDraftError")));');
    expect(body).toContain("setDraft(parsed);");
    expect(body.indexOf('if (!parsed) throw new Error(')).toBeLessThan(body.indexOf("setDraft(parsed);"));
  });
});

describe("the ask — the transcript rolls back on every non-answer", () => {
  it("cancel, 402 and failure all restore the pre-send list; the append sits past the parse gate", () => {
    const body = slice(src, "async function ask() {", "return (");
    expect(body).toContain("if (res === null) {");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setAskOut(true);");
    expect(body).toContain("const answer = res.ok ? copyrightAnswerOf(data) : null;");
    expect(body).toContain('if (!answer) throw new Error(apiErrorMessage(data, t("worldTeamLegal.copyrightAnswerError")));');
    expect(body).toContain("setMessages([...next, { role: \"assistant\", content: answer }]);");
    expect(body.indexOf('if (!answer) throw new Error(')).toBeLessThan(
      body.indexOf("setMessages([...next, { role: \"assistant\", content: answer }]);"),
    );
    // rollback on cancel + 402 + catch
    expect(body.split("setMessages(messages);").length - 1).toBe(3);
    const catchPart = slice(body, "} catch (e) {", "} finally {");
    expect(catchPart).toContain("setAskError(plainErrorText(e,");
    expect(catchPart).toContain("setMessages(messages);");
  });
});
