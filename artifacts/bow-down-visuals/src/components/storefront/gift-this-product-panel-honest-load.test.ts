/**
 * GiftThisProductPanel (send a product as a gift) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A money action with no mount load: the gift purchase
 * throws on non-ok with the server's message ("Could not
 * send this gift.") into the error line — a gift (and its
 * charge) is never shown as sent on an unproven write, and
 * the failure the buyer sees is the server's reason where
 * one exists.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./GiftThisProductPanel.tsx");

describe("a gift is sent only on a proven purchase", () => {
  it("the throw is pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(body, "Could not send this gift."));');
    expect(src).toContain('setError(plainErrorText(err, "Could not send this gift."));');
  });
});
