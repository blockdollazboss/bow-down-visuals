/**
 * FanLinksPanel (fan referral links) — honest load states
 * (Stack-400 C-28 components residual, deep-pins tranche 6).
 *
 * The FeatureVersePanel dual-leg doctrine: BOTH the mine
 * leg and the for-me leg must answer ok (`!mineRes.res.ok
 * || !forMeRes.res.ok` throws "load failed") before either
 * applies — the panel never renders half-proven link data,
 * and the failure lands on its own error line ("Couldn't
 * load your fan links — try again.") with loading settled
 * in finally. A referral link is never fabricated from an
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
const src = read("./FanLinksPanel.tsx");

describe("both legs must prove before either renders", () => {
  it("the dual gate and the error line are pinned", () => {
    expect(src).toContain('if (!mineRes.res.ok || !forMeRes.res.ok) throw new Error("load failed");');
    expect(src).toContain('setLoadError("Couldn\'t load your fan links — try again.");');
    expect(src).toContain("setLoading(false);");
  });
});
