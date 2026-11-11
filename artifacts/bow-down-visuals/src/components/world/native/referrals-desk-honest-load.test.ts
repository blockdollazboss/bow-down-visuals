/**
 * ReferralsDesk (the in-World referrals desk) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - THE REFERRALS LOAD throws on non-ok (its status rides
 *   the error) into the desk's failure handling, rendered
 *   through the shared native states (NativeLoadingState
 *   while loading) — the desk never paints referral counts
 *   or a code from an error body.
 * - THE CONTEST leg is a secondary read with the poll
 *   doctrine: `if (!res.ok) return;` — a failed contest read
 *   holds the desk's proven state and never takes the main
 *   referrals truth down with it (per-section law).
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ReferralsDesk.tsx");

describe("the main load throws on failure; the contest leg holds position", () => {
  it("the throw, the native loading state, and the contest gate are pinned", () => {
    expect(src).toContain("if (!res.ok) throw new Error(`referrals ${res.status}`);");
    expect(src).toContain("if (!res.ok) return;");
    expect(src).toContain('t("worldLivePromo.referralLoading")');
  });
});
