/**
 * ThumbnailDuelDesk (the thumbnail A/B duel desk) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - THE DUEL STATE has its own loading line ("Loading duel
 *   state…") — the desk never paints a duel, or the absence
 *   of one, before the state proves.
 * - RUNNING and RESOLVED derive from the proven duel status
 *   (`duel?.status === "running" / "resolved"`) — a winner
 *   is shown only when the stored duel says resolved.
 * - THE ACTION leg throws on `!res || !res.ok` (declined-
 *   confirm null included) with the server's message — a
 *   duel is never shown started/stopped on an unproven
 *   write.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ThumbnailDuelDesk.tsx");

describe("duel phases derive from the proven duel status", () => {
  it("the loading line, the derivations, and the action gate are pinned", () => {
    expect(src).toContain("Loading duel state…");
    expect(src).toContain('const running = duel?.status === "running";');
    expect(src).toContain('const resolved = duel?.status === "resolved";');
    expect(src).toContain('if (!res || !res.ok) throw new Error(apiErrorMessage(data, "Something went wrong."));');
  });
});
