/**
 * MoveHomeCard (the move-home progress card) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * An optional progress card: the move-home status read is
 * ok-gated at the door (`if (!res.ok) return;`) — the card's
 * steps and its done-count render only from a proven status
 * payload, and the count itself is computed FROM that data
 * (steps whose status is approved or skipped), never
 * assumed. A failed read leaves the card in its prior
 * proven state; nothing about the member's move is asserted
 * from an error body.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./MoveHomeCard.tsx");

describe("progress renders only from a proven status, counted from the data", () => {
  it("the ok gate and the derived count are pinned", () => {
    expect(src).toContain('fetch("/api/move-home", {');
    expect(src).toContain("if (!res.ok) return;");
    expect(src).toContain('status.steps.filter((s) => s.status === "approved" || s.status === "skipped").length');
  });
});
