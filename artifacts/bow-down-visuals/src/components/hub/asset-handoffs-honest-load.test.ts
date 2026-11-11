/**
 * AssetHandoffs (the hub spine's per-asset handoff actions)
 * — honest action states (Stack-400 C-28 components
 * residual, deep-pins tranche 6).
 *
 * A panel of independent handoff actions, each with its OWN
 * error slot (a Partial record keyed by handoff id): one
 * handoff's failure never poisons its neighbors' states.
 * Each call throws on non-ok with the server's message, and
 * the catch separates the out-of-credits outcome (its own
 * line) from the general failure (the message itself) — a
 * handoff is marked done only from the proven response on
 * its own leg.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./AssetHandoffs.tsx");

describe("each handoff fails into its own slot, credits distinguished", () => {
  it("the gate and the per-id error routing are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiThrowMessage(data, t("hubSpine.handoffs.failed")));');
    expect(src).toContain('setErrors((e) => ({ ...e, [id]: t("hubSpine.handoffs.outOfCredits") }));');
    expect(src).toContain("setErrors((e) => ({ ...e, [id]: msg }));");
  });
});
