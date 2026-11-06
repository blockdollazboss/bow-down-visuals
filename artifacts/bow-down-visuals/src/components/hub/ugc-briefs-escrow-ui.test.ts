/**
 * ugc-briefs-escrow-ui.test.ts — the Briefs Board escrow surfaces
 * (C-25), source-pinned like the beats embedded-checkout test:
 *
 * - the hub panel (Promote) posts an optional price, funds on the
 *   board card through the shared <EmbeddedSessionCheckout> (the
 *   buyer never leaves the site), settles sandbox funding through
 *   confirm and hosted/embedded returns through verify, and labels
 *   approval as the release it now is;
 * - the World UGC station mirrors through the SAME lib client (no
 *   divergent logic): same fund call, sandbox confirm in-world, and
 *   the sanctioned website door for the card moment — never a
 *   divergent in-world payment form.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("hub UgcAdsPanel — briefs escrow", () => {
  const src = read("./UgcAdsPanel.tsx");

  it("posts the optional price with the brief", () => {
    /* Stack-200 D6: the price field + the 5% help line resolve
       through the catalog (worldLivePromo.ugcBriefPriceAria /
       ugcBriefPriceHelp — the help key's en value carries the
       "We keep 5%" truth verbatim). */
    expect(src).toContain('aria-label={t("worldLivePromo.ugcBriefPriceAria")}');
    expect(src).toContain("priceCents:");
    expect(src).toContain("worldLivePromo.ugcBriefPriceHelp");
  });

  it("funds through the shared embedded checkout, gated on the publishable key", () => {
    expect(src).toContain(
      'import { EmbeddedSessionCheckout, hasStripePublishableKey } from "@/components/checkout/EmbeddedCheckout"',
    );
    expect(src).toContain('fundUgcBrief(await token(), brief.id, hasStripePublishableKey() ? "embedded" : undefined)');
    expect(src).toContain('data-testid="ugc-brief-fund-embedded-checkout"');
    expect(src).toContain("<EmbeddedSessionCheckout clientSecret={fundCheckout.clientSecret} />");
  });

  it("settles sandbox funding through confirm; the checkout return settles through verify", () => {
    expect(src).toContain("confirmUgcBriefFunding(await token(), brief.id, result.sessionId)");
    expect(src).toContain("verifyUgcBriefFunding(await token(), fundedId)");
    expect(src).toContain("URLSearchParams");
    expect(src).toContain("ugcBriefFunded");
  });

  it("approval reads as the release; the board note tells the whole conditional truth", () => {
    expect(src).toContain("worldLivePromo.ugcApproveRelease");
    /* The header renders the combined conditional note (escrow for
       priced briefs, off-site for a brief with no price) through the
       catalog key whose en value IS the seam's combined note
       (locale-newest-keying.test.ts pins them equal) — never an
       inline composition that lowercases the brand name to glue the
       sentences (C-25 follow-up). */
    expect(src).toContain("worldLivePromo.ugcBriefsMoneyNote");
    expect(src).not.toContain("charAt(0).toLowerCase()");
    expect(src).not.toContain("UGC_PAYMENT_NOTE");
    expect(src).not.toContain("UGC_ESCROW_NOTE");
    expect(src).toContain("worldLivePromo.ugcCreatorReceives");
    expect(src).toContain("escrowStatusLabel(brief.escrowStatus");
    expect(src).toContain("ugcBriefNetPreview(brief)");
  });
});

describe("World UgcAdsStation — briefs escrow mirror", () => {
  const src = read("../world/native/UgcAdsStation.tsx");

  it("posts the price through the shared seam (buildBriefInput carries priceCents)", () => {
    expect(src).toContain('data-testid="world-ugc-brief-price"');
    expect(src).toContain("worldLivePromo.ugcBriefPriceHelp");
  });

  it("funds through the SAME lib client; sandbox confirms in-world", () => {
    expect(src).toContain("fundUgcBrief(await token(), brief.id");
    expect(src).toContain("confirmUgcBriefFunding(await token(), brief.id, result.sessionId)");
    expect(src).toContain('data-testid="world-ugc-brief-fund"');
    expect(src).toContain("worldLivePromo.ugcFundBrief");
  });

  it("the card moment is the sanctioned website door — no in-world payment form", () => {
    expect(src).not.toContain("EmbeddedSessionCheckout");
    expect(src).toContain('data-testid="world-ugc-brief-fund-door"');
    expect(src).toContain('href="/promote"');
    expect(src).toContain("worldLivePromo.ugcFundOnWebsite");
  });

  it("approval reads as the release in the World too", () => {
    expect(src).toContain("worldLivePromo.ugcApproveRelease");
    expect(src).toContain("worldLivePromo.ugcCreatorReceives");
    expect(src).toContain("ugcBriefNetPreview(brief)");
  });
});
