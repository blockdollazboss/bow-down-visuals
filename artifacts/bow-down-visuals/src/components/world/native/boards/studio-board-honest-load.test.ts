/**
 * StudioBoard (the World studio home board) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 2). The board judges its families by weight:
 *
 * - THE PROJECTS ARE THE CORE, and the rule is written on the
 *   load: "a failed read is the honest error state, never an
 *   empty-looking studio" — non-ok throws into projectsFailed;
 *   projects record only from a proven payload.
 * - THE STRIP (streak + latest activity) is a rail, not the
 *   board: each leg records only on its own ok, and a dead
 *   rail is quietly absent — "silence is honest" — because the
 *   strip claims nothing when it isn't there.
 * - THE WIDGET FAMILY is four independent reads: "one dead
 *   rail costs its own card and nothing else."
 *
 * NO FIX in this lane — every family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const board = read("./StudioBoard.tsx");

describe("the projects are the core: failure is the error state", () => {
  it("a non-ok read throws into projectsFailed; success records + clears it", () => {
    expect(board).toContain("The projects are the board's core: a failed read is the honest");
    expect(board).toContain('if (!res.ok) throw new Error("projects");');
    expect(board).toContain("setProjects(normalizeStudioProjects(await res.json(), sbStrings));");
    expect(board).toContain("setProjectsFailed(false);");
    expect(board).toContain("if (!cancelled) setProjectsFailed(true);");
  });
});

describe("the strip is a rail: per-leg proof, honest silence", () => {
  it("each leg records only on its own ok", () => {
    expect(board).toContain("if (bonusRes.ok) setStrip(normalizeStudioStrip(await bonusRes.json()));");
    expect(board).toContain("if (creditsRes.ok) setActivity(latestActivityLine(await creditsRes.json(), sbStrings, i18n.language));");
    expect(board).toContain("/* the strip is a rail, not the board — silence is honest */");
  });

  it("the widget family's independence is written on it", () => {
    expect(board).toContain("four rails, four independent reads — one\n     dead rail costs its own card and nothing else.");
  });
});
