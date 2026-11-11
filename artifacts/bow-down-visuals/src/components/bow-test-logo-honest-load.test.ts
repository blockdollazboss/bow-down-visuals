/**
 * BowTestLogo (the logo bow-test widget) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A classification pin for a playful test surface:
 * - THE VOTE RECORD is ok-gated: the POST to /api/bow must
 *   answer ok before the local recorded state advances
 *   (`if (!res.ok) return;`) — a bow is never shown as
 *   counted on an unproven write, and the beacon's failure
 *   is silent because the widget's own local play (the
 *   visitor's device-local month counter in localStorage)
 *   makes no server claim at all.
 * - THE LOCAL COUNTER is the visitor's own device state,
 *   labeled by its own storage — it never presents itself
 *   as a server total.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./BowTestLogo.tsx");

describe("a bow counts only when the record proves", () => {
  it("the ok gate on the vote write is pinned", () => {
    expect(src).toContain('fetch("/api/bow", {');
    expect(src).toContain("if (!res.ok) return;");
  });
});
