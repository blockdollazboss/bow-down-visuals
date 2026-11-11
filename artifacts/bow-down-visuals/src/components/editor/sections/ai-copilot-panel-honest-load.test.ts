/**
 * AICopilotPanel (the editor's AI copilot) — honest action
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * The scenes arrive from the editor by props — the
 * scenes.length === 0 early return is the genuine empty
 * timeline, not a load state. The panel's one charged call
 * is honest end to end:
 * - THE ANALYZE gates on res.ok before a single suggestion
 *   is recorded; a declined confirmation (null res) returns
 *   claiming nothing (the analyzing flag clears in finally);
 *   failure lands on a destructive "Analysis failed" toast
 *   carrying the server's message.
 * - THE SUCCESS TOAST narrates the PROVEN count — including
 *   a truthful "0 suggestions from the AI" when the analysis
 *   genuinely found nothing — rather than inventing findings;
 *   AI suggestions are source-tagged ("ai") so they never
 *   blend invisibly with the local heuristic ones.
 * - APPLYING a suggestion claims "Applied" only after the
 *   edit lands; a failure lands on a destructive "Couldn't
 *   apply" toast and the suggestion stays unapplied.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./AICopilotPanel.tsx");

describe("the analyze gates on the checked response", () => {
  it("non-ok throws the server's message before any suggestion is recorded", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Analysis failed."));');
    expect(src).toContain("if (!res) return; // user cancelled the credit confirm");
    expect(src).toContain("setAiSuggestions(incoming);");
    expect(src).toContain("setAnalyzing(false);");
  });

  it("the success toast narrates the proven count; AI suggestions are source-tagged", () => {
    expect(src).toContain("`${incoming.length} suggestion${incoming.length === 1 ? \"\" : \"s\"} from the AI.`");
    expect(src).toContain('source: "ai" as const,');
  });

  it("a failed apply claims nothing and leaves the suggestion unapplied", () => {
    expect(src).toContain('title: "Couldn\'t apply",');
    expect(src).toContain("setApplyingId(null);");
  });
});
