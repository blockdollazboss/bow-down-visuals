/**
 * TakeoversDesk (the in-World spotlight / loading-screen
 * takeover desk) — honest load states (Stack-400 C-28
 * components residual, deep-pins tranche 6).
 *
 * - THE INQUIRY POST gates its success on ok AND the
 *   payload validator (`!res.ok || !takeoverInquiryOk(data)`)
 *   — an inquiry is never shown as received on an unproven
 *   or malformed answer; the form validates first
 *   (takeoverFormError).
 * - THE OFFER SLOTS carry failure as a STATE: each slot is
 *   `{ offer, failed }`, so a failed offer read marks the
 *   slot failed instead of quietly presenting the standing
 *   terms as that slot's live offer — the native twin of
 *   the 2D takeover modals' ok-gated offer read.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./TakeoversDesk.tsx");

describe("the inquiry and the offers are both payload-proven", () => {
  it("the validated gate and the failed-slot state are pinned", () => {
    expect(src).toContain("if (!res.ok || !takeoverInquiryOk(data)) {");
    expect(src).toContain("useState<OfferSlot>({ offer: null, failed: false })");
    expect(src).toContain('setError(t("worldLivePromo.takeoverFormError"));');
  });
});
