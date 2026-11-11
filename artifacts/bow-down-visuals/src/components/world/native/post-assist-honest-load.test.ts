/**
 * PostAssist (the in-World post-writing assistant) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A native-desk action panel with a three-way honest
 * resolution, all surfaced through its note line:
 * - A DECLINED credit confirmation returns quietly — "credit
 *   confirmation declined — nothing ran" — a cancel is
 *   never an error and never a draft.
 * - A NON-OK response sets the note to the out-of-credits
 *   copy on 402, else the server's own message — the failure
 *   is stated, never hidden.
 * - AN OK response whose payload fails the draft parser
 *   gets its own truth (assistNoWords): the tool answered
 *   but produced no usable draft, said as itself instead of
 *   rendering an empty editor as a success.
 * The draft applies only from the parsed proven payload.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PostAssist.tsx");

describe("declined, refused, and empty are three different notes", () => {
  it("the three-way resolution is pinned", () => {
    expect(src).toContain("if (!res) return; // credit confirmation declined — nothing ran");
    expect(src).toContain('t("worldSocialDesk.assistOutOfCredits")');
    expect(src).toContain("const draft = parsePostAssistDraft(data);");
    expect(src).toContain('setNote(t("worldSocialDesk.assistNoWords"));');
  });
});
