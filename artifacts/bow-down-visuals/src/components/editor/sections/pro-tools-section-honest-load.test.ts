/**
 * ProToolsSection (the editor's pro tools: auto-grade,
 * slow motion) — honest action states (Stack-400 C-28
 * components residual, deep-pins tranche 6).
 *
 * Both of the section's charged calls gate success on ok
 * PLUS the proven payload before anything is applied:
 * auto-grade requires the correction, slow motion requires
 * the url — a non-ok or a payload missing its deliverable
 * throws the server's message into the tool's error surface,
 * so a tool never applies a "result" that was never
 * delivered. (The remaining buttons are local editor
 * operations with no network result to fake.)
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ProToolsSection.tsx");

describe("both charged tools gate success on ok + the proven payload", () => {
  it("auto-grade requires the correction; slow motion requires the url", () => {
    expect(src).toContain('if (!res.ok || !body.correction) throw new Error(apiErrorMessage(body, "Auto-grade failed"));');
    expect(src).toContain('if (!res.ok || !body.url) throw new Error(apiErrorMessage(body, "Slow motion render failed"));');
  });
});
