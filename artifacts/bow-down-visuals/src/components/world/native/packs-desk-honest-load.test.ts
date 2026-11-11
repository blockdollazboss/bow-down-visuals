/**
 * PacksDesk (World native) — honest load standard (deep-pins
 * tranche 5). The pack list is a static catalog and the
 * balance rides the session profile, so there is no list
 * load to fake; the pinned surface is the money flow, which
 * carries the stack1400 ruling #18 in its own comment: an
 * embedded-intent failure STOPS with the honest error — the
 * server's message, or its HTTP status with the
 * nothing-charged line, or the didn't-start line for an ok
 * answer with no usable secret — and NEVER falls through to
 * the hosted rail (which serves only the no-publishable-key
 * configuration). The granted note exists only after the
 * hosted session answers ok WITH a payment url, or after
 * the embedded verify answers ok + success; a failed verify
 * names the still-confirming state (the webhook is the
 * second door to the same exactly-once grant), never a
 * granted balance.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PacksDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the embedded intent — failure stops here, honestly", () => {
  it("ok + secret mounts the form; ok without secret is didn't-start; non-ok names the status; transport is classified", () => {
    const body = slice(src, "const buy = async (pack: CreditPack) => {", "const muted =");
    expect(body).toContain('if (ires.ok && typeof idata.clientSecret === "string") {');
    expect(body).toContain('setEmbedded({ packKey: pack.key, clientSecret: idata.clientSecret, label: `${pack.creditsLabel} — ${pack.priceLabel}` });');
    expect(body).toContain("if (ires.ok) {");
    expect(body).toContain('setFailed(t("worldRemainder.pakCheckoutDidntStart"));');
    expect(body).toContain('t("worldRemainder.chkServerError", { status: ires.status })');
    expect(body).toContain("setFailed(checkoutFailureCopy(err, {");
    // every embedded branch returns — the hosted rail below is unreachable after an intent attempt
    const embeddedBlock = slice(body, "if (hasStripePublishableKey()) {", "const res = await fetch(\"/api/create-checkout-session\", {");
    expect(embeddedBlock.split("return;").length - 1).toBeGreaterThanOrEqual(4);
    expect(embeddedBlock).not.toContain("window.open");
  });

  it("the hosted rail (no-key configuration only): the note exists only past ok + a real payment url", () => {
    const body = slice(src, "const buy = async (pack: CreditPack) => {", "const muted =");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorLine(data, t("worldRemainder.pakCheckoutFailed")));');
    expect(body).toContain("const url = packCheckoutUrl(data);");
    expect(body).toContain('if (!url) throw new Error(t("worldRemainder.pakNoPaymentPage"));');
    expect(body).toContain('setNote(t("worldRemainder.pakHostedNote", { label: pack.creditsLabel }));');
    expect(body.indexOf('if (!url) throw new Error(')).toBeLessThan(
      body.indexOf('setNote(t("worldRemainder.pakHostedNote"'),
    );
  });
});

describe("the embedded verify — granted only on ok + success", () => {
  it("a refused verify names the confirming state and grants nothing; success adds the server's amount", () => {
    const body = slice(src, "const confirmEmbedded = async (paymentIntentId: string) => {", "const buy = async");
    expect(body).toContain("if (!res.ok || !data.success) {");
    expect(body).toContain('setFailed(apiErrorMessage(data, t("worldRemainder.pakConfirming")));');
    expect(body).toContain('setNote(t("worldRemainder.pakAdded", { amount: (typeof data.added === "number" ? data.added : 0).toLocaleString(i18n.language) }));');
    expect(body.indexOf("if (!res.ok || !data.success) {")).toBeLessThan(body.indexOf('setNote(t("worldRemainder.pakAdded"'));
    const failPart = slice(body, "if (!res.ok || !data.success) {", "setEmbedded(null);");
    expect(failPart).toContain("return;");
    expect(failPart).not.toContain("setNote");
    const catchPart = slice(body, "} catch {", "const buy = async");
    expect(catchPart).toContain('setFailed(t("worldRemainder.pakConfirming"));');
    expect(catchPart).not.toContain("setNote");
  });
});
