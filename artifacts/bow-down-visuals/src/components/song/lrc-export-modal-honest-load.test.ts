/**
 * LrcExportModal (the .lrc lyric-timing export; AI-align
 * leg) — honest action states (Stack-400 C-28 components
 * residual, deep-pins tranche 6).
 *
 * An action surface whose paid leg is the AI alignment: the
 * align call gives credits their own branch (402 status or
 * the body's out_of_credits code) BEFORE the general gate,
 * and the aligned lines apply only from an ok response
 * carrying a non-empty lines array (`!res.ok ||
 * !Array.isArray(data.lines) || data.lines.length === 0`)
 * — an alignment that produced nothing is a failure, never
 * an empty timing file presented as the export. The manual
 * tap-timing path is local state and claims nothing about
 * the server.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LrcExportModal.tsx");

describe("credits speak first; aligned lines require a proven non-empty array", () => {
  it("the taxonomy and the gate are pinned", () => {
    expect(src).toContain('if (res.status === 402 || data.error === "out_of_credits") {');
    expect(src).toContain("if (!res.ok || !Array.isArray(data.lines) || data.lines.length === 0) {");
  });
});
