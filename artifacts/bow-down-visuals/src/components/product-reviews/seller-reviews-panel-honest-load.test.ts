/**
 * SellerReviewsPanel (a seller's product reviews + replies)
 * — honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE REVIEWS LOAD is the house machine: loading +
 *   loadError states, a throw on non-ok ("load") into
 *   loadError, loading settled in the finally path — a
 *   seller's review list (their public reputation) is never
 *   painted as empty on a failed load.
 * - THE REPLY write throws on non-ok with the server's
 *   message ("That didn't go through.") — a reply is never
 *   shown as posted on an unproven write.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SellerReviewsPanel.tsx");

describe("reviews load proven or error; replies gate on ok", () => {
  it("the load machine and the reply throw are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error("load");');
    expect(src).toContain("setLoadError(true);");
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "That didn\'t go through."));');
  });
});
