/**
 * GuestQuestions (the Podcast Guest Question Generator docked
 * in /podcast) — honest action states (Stack-400 C-28
 * components residual, deep-pins tranche 6).
 *
 * This is an ACTION panel, not a collection load: four charged
 * generations (question set, podcast intro, show notes,
 * audiogram), each with its own loading flag, error line and
 * result state. Every action narrates ONLY from a checked
 * response:
 * - a declined credit confirmation (null res) returns without
 *   claiming anything;
 * - a 402 / out_of_credits body lands on the OutOfCredits
 *   panel, never on an error line or a fake result;
 * - non-ok OR a malformed success payload (no warmup array,
 *   no url, null notes) throws into that action's own error
 *   line — success is never claimed for a body that did not
 *   prove itself;
 * - every finally clears its own loading flag, so no button
 *   can spin forever.
 *
 * THE INTRO-STYLES LOAD is a designed fallback, pinned as-is:
 * the style picker ships a built-in default list and a failed
 * or malformed styles read simply keeps it — the picker never
 * renders an empty or "failed" state because there is always
 * a real list to pick from.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./GuestQuestions.tsx");

describe("the question-set generation narrates from the checked response", () => {
  it("cancel claims nothing, 402 lands on OutOfCredits, malformed success throws", () => {
    expect(src).toContain("if (!res) return; // user cancelled the credit confirmation");
    expect(src).toContain('if (res.status === 402 || data.error === "out_of_credits") {');
    expect(src).toContain("if (!res.ok || !Array.isArray(data.warmup)) {");
    expect(src).toContain("setResult(data);");
  });

  it("the loading flag always clears in finally", () => {
    expect(src).toContain("setLoading(false);");
    expect(src).toContain("setIntroLoading(false);");
    expect(src).toContain("setNotesLoading(false);");
    expect(src).toContain("setAgLoading(false);");
  });
});

describe("the three chain actions each gate success on ok + a proven payload", () => {
  it("intro and audiogram require a url; show notes require non-null notes", () => {
    expect(src).toContain("if (!res.ok || !data.url) {");
    expect(src).toContain("if (!res.ok || data.notes == null) {");
    expect(src).toContain("setIntroResult(data);");
    expect(src).toContain("setNotesResult(data);");
    expect(src).toContain("setAgResult(data);");
  });
});

describe("the intro-styles load is a designed fallback", () => {
  it("only a proven styles array replaces the built-in default list", () => {
    expect(src).toContain("if (!cancelled && Array.isArray(data.styles)) setIntroStyles(data.styles);");
    expect(src).toContain("introStyles.length > 0");
    expect(src).toContain('{ id: "upbeat", label: "Upbeat Pop", blurb: "" }');
  });
});
