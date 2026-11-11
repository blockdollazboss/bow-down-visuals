/**
 * ShowcaseVideoTools (owner tools on a showcase video:
 * chapters state) — honest load states (Stack-400 C-28
 * components residual, deep-pins tranche 6).
 *
 * - THE OWNER CHECK distinguishes its answers: a 404 means
 *   not-the-owner (an answer — the tools withdraw), while
 *   the data legs read payloads only past their status
 *   handling.
 * - THE CHAPTERS STATUS is rendered AS ITSELF, word for
 *   word: "Live on this page" only when approved, "Off —
 *   hidden" when off, "Draft — only you can see it" when
 *   draft — the label is the proven status, never an
 *   optimistic one.
 * - THE SAVE throws on `!res || !res.ok` (declined-confirm
 *   null included) with the server's message.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ShowcaseVideoTools.tsx");

describe("status labels are the proven status, verbatim", () => {
  it("the owner distinction, the labels, and the save gate are pinned", () => {
    expect(src).toContain("if (!cRes || cRes.status === 404) { setIsOwner(false); return; }");
    expect(src).toContain('chapters.status === "approved" ? "Live on this page" : chapters.status === "off" ? "Off — hidden" : "Draft — only you can see it"');
    expect(src).toContain('if (!res || !res.ok) throw new Error(apiErrorMessage(data, "Something went wrong."));');
  });
});
