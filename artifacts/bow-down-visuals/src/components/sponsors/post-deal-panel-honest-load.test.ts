/**
 * PostDealPanel (post a sponsor deal) — honest action states
 * (Stack-400 C-28 components residual, deep-pins tranche 6).
 *
 * - THE CAN-SPEND PROBE is fail-open BY DOCUMENTED DESIGN,
 *   pinned as-is: it exists only to warn about paused
 *   spending on arrival; if the readout can't be reached the
 *   form stays usable, and the submit-time response still
 *   answers honestly (the source says exactly this). Only a
 *   proven canSpend === false may raise the paused error
 *   early — an unproven probe never blocks or accuses.
 * - THE POST validates every field into its own error line
 *   before sending, then narrates from the checked response:
 *   the paused code lands on the paused error, other non-ok
 *   responses throw the server's message, and the deal is
 *   treated as posted only on a proven response.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PostDealPanel.tsx");

describe("the can-spend probe warns only from a proven answer", () => {
  it("only canSpend === false raises the paused error; failure stays silent by design", () => {
    expect(src).toContain("if (!res.ok) return;");
    expect(src).toContain("if (!cancelled && data.canSpend === false) {");
    expect(src).toContain("/* readout unreachable — the submit-time 403 still speaks */");
  });
});

describe("the post narrates from its checked response", () => {
  it("the paused code and other failures land on their own error lines", () => {
    expect(src).toContain('setError(t("sponsorsPost.errorSpendingPaused"));');
    expect(src).toContain('setError(plainErrorText(err, t("sponsorsPost.errorPostDeal")));');
  });
});
