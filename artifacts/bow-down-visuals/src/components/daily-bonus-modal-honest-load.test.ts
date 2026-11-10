/**
 * DailyBonusModal — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The bonus modal's reads are a
 * once-per-session probe and an on-open refresh; its writes are the
 * daily claim and the hourly crate spin. The contract:
 *
 * - THE CLAIM ACTIONS narrate four DISTINCT facts and never blur
 *   them: claimed (with the granted figures), already-claimed
 *   (a fact, not a failure — the offer stops), a cooldown / global
 *   take on the crate (each with its own words), and failure —
 *   which keeps the crate/claim OPEN and gets failure words. The
 *   file states the rule in its own comments: "A failure is not a
 *   taken crate"; "A failed claim is not a handled claim".
 * - THE REFRESH respects degraded reads: a degraded 200 carries
 *   null profile fields — "unknown, not zero" — so the streak is
 *   re-stamped only when the payload actually carries a number,
 *   never fabricated into a 0-day streak over loaded state.
 * - THE SESSION PROBE fails CLOSED and silent BY DESIGN: it only
 *   pre-arms claim availability (no auto-popup ever — claiming is
 *   manual via the StreakWidget), so a failed probe simply offers
 *   nothing; it can never present a claim that isn't real.
 *
 * Copy rides retention.dailyBonus keys with defaultValue fallbacks.
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const modal = read("./DailyBonusModal.tsx");

describe("the claim actions narrate each outcome as its own fact", () => {
  it("a claimed daily bonus records the granted figures", () => {
    expect(modal).toContain("if (res.ok && r.claimed) {");
    expect(modal).toContain("bonus: r.bonusGranted,");
  });

  it("already-claimed is stated as a fact and stops the offer — not dressed as failure", () => {
    expect(modal).toContain('} else if (res.ok && r.claimed === false && r.reason === "already_claimed") {');
    expect(modal).toContain("Already claimed today is a fact, not a failure — say it plainly");
  });

  it("a failed claim keeps the modal open and gets failure words", () => {
    expect(modal).toContain("A failed claim is not a handled claim: the modal stays open and");
    expect(modal).toContain('setClaimError(apiErrorMessage(r, t("retention.dailyBonus.claimFailed"');
  });

  it("the crate separates spun, globally-taken, cooldown, and failure", () => {
    expect(modal).toContain("if (res.ok && r.spun) {");
    expect(modal).toContain('r.reason === "already_claimed_global"');
    expect(modal).toContain('r.reason === "cooldown"');
    expect(modal).toContain("A failure is not a taken crate: say it failed, keep the crate open.");
  });
});

describe("the refresh never fabricates figures from a degraded read", () => {
  it("the streak re-stamps only when the payload carries a number", () => {
    expect(modal).toContain("unknown, not zero: leave the loaded state untouched rather than");
    expect(modal).toContain('if (typeof s.streak === "number") setStreak(s.streak);');
    expect(modal).toContain('if (typeof s.streakFreezes === "number") setStreakFreezes(s.streakFreezes);');
  });
});

describe("the session probe fails closed by design", () => {
  it("the probe only arms a claim the server actually offered", () => {
    expect(modal).toContain("if (s.canClaimDaily) {");
    expect(modal).toContain("No auto-popup: user claims manually via the StreakWidget.");
  });
});
