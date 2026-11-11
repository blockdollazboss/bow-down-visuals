/**
 * PurchasesPanel (the library's purchases list) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * The SavedPanel family doctrine: the purchases loader
 * throws on non-ok before reading any payload, and the
 * failure lands on the panel's own error line — "Your
 * purchases couldn't load just now — try again in a
 * moment." A failed load of a MONEY list never reads as
 * "you bought nothing": the error says the page failed, in
 * the member's own purchase history surface.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PurchasesPanel.tsx");

describe("a failed purchases load says the page failed, never that nothing was bought", () => {
  it("the throw and the error copy are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error("load failed");');
    expect(src).toContain("Your purchases couldn't load just now — try again in a moment.");
  });
});
