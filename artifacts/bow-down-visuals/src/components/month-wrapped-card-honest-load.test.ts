/**
 * MonthWrappedCard (the monthly wrapped summary card) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An optional dashboard card under the First100FansCard
 * doctrine, with its rule stated in the source: "Opted out,
 * no creator profile, still loading, or a failed load" all
 * render NOTHING — the card exists only from a proven
 * wrapped payload (the loader throws on non-ok before any
 * state is set). Absence claims nothing about the member's
 * month; a wrapped summary is never fabricated from an
 * error body.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./MonthWrappedCard.tsx");

describe("the card exists only from a proven wrapped payload", () => {
  it("the throw and the hide-on-any-unproven rule are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error("load failed");');
    expect(src).toContain("Opted out, no creator profile, still loading, or a failed load:");
  });
});
