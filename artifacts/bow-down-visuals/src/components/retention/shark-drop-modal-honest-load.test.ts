/**
 * SharkDropModal (the Shark Drop reward claim) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A money surface held to the strictest gate in its family:
 * the claim is shown as claimed ONLY when the response is
 * ok AND the payload itself says so — `!res.ok ||
 * !data.claimed` routes to the failure path — and the
 * amount the member sees comes from that same proven
 * payload (data.amount), never a client-side figure. A
 * reward is never announced as landed on an unproven or
 * self-contradicting response (the notification truth
 * rule, applied at the claim button).
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SharkDropModal.tsx");

describe("claimed is claimed only when the payload says claimed", () => {
  it("the double gate is pinned", () => {
    expect(src).toContain("if (!res.ok || !data.claimed) {");
    expect(src).toContain('setError(plainErrorText(e, t("retentionDelight.sharkDrop_failed")));');
  });
});
