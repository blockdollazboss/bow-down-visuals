/**
 * GiftMembership — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The gift desk on creator-pricing
 * has one list load, one return-verify, and the checkout start:
 *
 * - THE RECEIPTS LOAD is additive BY DESIGN ("a load failure never
 *   breaks pricing") and records only on an ok response — and the
 *   receipts block itself renders only when a successful load
 *   brought at least one gift on either side. The "No gifts sent /
 *   received yet" lines live INSIDE that gate, so a failed load
 *   (both lists stay empty, block absent) can never produce them;
 *   each line appears only when the other side's real data proved
 *   the load landed.
 * - THE RETURN VERIFY narrates the money truth in stages: granted
 *   (with the receipt), duplicate ("already granted — not charged
 *   or granted twice", the original receipt shown), still-landing
 *   on a refused verify, and the webhook explanation on a throw.
 *   It runs exactly once per return (a ref guard), matching the
 *   server's claim-on-session design.
 * - Recipient preview and checkout start surface the server's
 *   message on failure and record nothing.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const gift = read("./GiftMembership.tsx");

describe("the receipts load — empty copy exists only behind proven data", () => {
  it("the load records only on an ok response, under its additive note", () => {
    expect(gift).toContain('const res = await fetch("/api/membership-gifts/mine", { headers: await authHeaders() });');
    expect(gift).toContain("if (res.ok) {");
    expect(gift).toContain("/* gift desk is additive — a load failure never breaks pricing */");
  });

  it("the receipts block renders only when a load brought at least one gift", () => {
    expect(gift).toContain("{(sent.length > 0 || received.length > 0) && (");
  });

  it("the empty lines live inside that gate", () => {
    expect(gift.indexOf("No gifts sent yet.")).toBeGreaterThan(
      gift.indexOf("{(sent.length > 0 || received.length > 0) && ("),
    );
    expect(gift).toContain("No gifts received yet.");
  });
});

describe("the return verify narrates the money truth in stages", () => {
  it("it runs exactly once per return", () => {
    expect(gift).toContain("if (!user || verifyRan.current) return;");
    expect(gift).toContain("verifyRan.current = true;");
  });

  it("a duplicate grant says it was not charged or granted twice", () => {
    expect(gift).toContain('"That gift was already granted — the receipt below is the original. It was not charged or granted twice."');
  });

  it("a refused verify says the payment went through and the gift is still landing", () => {
    expect(gift).toContain('"Payment went through but the gift is still landing — check below in a few minutes."');
  });

  it("a thrown verify explains the webhook door instead of claiming failure", () => {
    expect(gift).toContain('"Payment went through but we couldn\'t confirm the gift yet — it lands automatically via our payment webhook."');
  });
});

describe("preview and checkout record nothing on failure", () => {
  it("a failed recipient lookup surfaces the server's message", () => {
    expect(gift).toContain('else setError(apiErrorMessage(data, "We couldn\'t find that creator."));');
  });

  it("checkout starts only on an ok response carrying a client secret", () => {
    expect(gift).toContain("if (res.ok && data.clientSecret) {");
    expect(gift).toContain('setError(apiErrorMessage(data, "Checkout didn\'t start. Try again in a minute."));');
  });
});
