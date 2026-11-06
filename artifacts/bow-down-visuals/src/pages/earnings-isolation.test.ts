/**
 * earnings-isolation.test.ts — Stack-200 hardening wave, section C
 * (census items 29 + 30): the /earnings payout door must survive a
 * failed earnings load, and the affiliate desk must never throw in
 * render on a malformed payload.
 *
 * Item 29: PendingPayoutCard, ConnectPayoutCard, AffiliateDeskSection
 * and EarningsDocuments each run their OWN fetch — but they sat
 * BEHIND the page's whole-page `if (failed)` / `if (!data)` early
 * returns, so one GET /api/earnings failure made the payout door
 * unreachable. They now render in all three page states from one
 * shared fragment, each in its own SectionBoundary.
 *
 * Item 30: AffiliateDeskSection stored the desk payload as a raw
 * cast and dereferenced desk.asSeller.totals.* / .affiliates.map /
 * desk.asAffiliate.totals.* unconditionally in render — a partial
 * 200 threw during render and took the whole money page down. The
 * payload now passes through lib/affiliate-desk-data normalizers at
 * the fetch boundary (the earnings-data pattern): no desk shape →
 * the section's honest failure state; partial shapes degrade
 * field-by-field, never throw.
 *
 * Idiom follows lane D3: real-class compositions + source pins.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SectionBoundaryCore } from "../components/section-boundary";
import {
  normalizeAffiliateCodes,
  normalizeAffiliateDesk,
  normalizeAffiliateOffers,
} from "../lib/affiliate-desk-data";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const earningsSource = read("./earnings.tsx");
const affiliateSource = read("../components/affiliates/AffiliateDeskSection.tsx");
const appSource = read("../App.tsx");

const LABELS = {
  title: "This section hit a snag",
  description:
    "Something glitched while this part of the page was loading. The rest of the page is fine — try this section again.",
  retryLabel: "Try again",
};

function makeBoundary(name: string, child: ReactElement) {
  return new SectionBoundaryCore({
    name,
    variant: "section",
    isLight: false,
    title: LABELS.title,
    description: LABELS.description,
    retryLabel: LABELS.retryLabel,
    children: child,
  });
}

function failWith(boundary: SectionBoundaryCore, error: Error) {
  Object.assign(
    boundary.state,
    SectionBoundaryCore.getDerivedStateFromError(error),
  );
}

/* The server renderer escapes apostrophes in text (&#x27;) — decode
   before copy assertions so the pins read as the copy reads. */
const unescapeHtml = (html: string) => html.replace(/&#x27;/g, "'");

describe("earnings shape — the payout door survives a failed page load", () => {
  it("with the main load failed, the four independent sections still render; a throwing affiliate desk degrades alone", () => {
    const pending = makeBoundary(
      "earnings-pending-payout",
      createElement("p", null, "PENDING PAYOUT"),
    );
    const connect = makeBoundary(
      "earnings-connect-payout",
      createElement("p", null, "CONNECT PAYOUT"),
    );
    const affiliate = makeBoundary(
      "earnings-affiliate-desk",
      createElement("p", null, "AFFILIATE DESK"),
    );
    const docs = makeBoundary(
      "earnings-documents",
      createElement("p", null, "EARNINGS DOCUMENTS"),
    );
    failWith(affiliate, new Error("desk payload malformed"));

    const html = unescapeHtml(
      [
        renderToStaticMarkup(
          createElement("p", null, "Couldn't load your earnings — try again in a moment."),
        ),
        renderToStaticMarkup(pending.render() as ReactElement),
        renderToStaticMarkup(connect.render() as ReactElement),
        renderToStaticMarkup(affiliate.render() as ReactElement),
        renderToStaticMarkup(docs.render() as ReactElement),
      ].join("\n"),
    );

    expect(html).toContain("Couldn't load your earnings");
    expect(html).toContain("PENDING PAYOUT");
    expect(html).toContain("CONNECT PAYOUT");
    expect(html).toContain("EARNINGS DOCUMENTS");
    expect(html).toContain('data-testid="section-error-earnings-affiliate-desk"');
    expect(html).not.toContain("AFFILIATE DESK");
    expect(appSource).toContain("The vault guards tripped.");
    expect(html).not.toContain("The vault guards tripped.");
  });
});

describe("earnings.tsx — census-29 structure (source pins)", () => {
  it("imports the shared SectionBoundary", () => {
    expect(earningsSource).toContain(
      'import { SectionBoundary } from "@/components/SectionBoundary";',
    );
  });

  it("renders the independent sections in ALL THREE page states", () => {
    const uses = earningsSource.match(/\{independentSections\}/g) ?? [];
    expect(uses).toHaveLength(3);
  });

  it("mounts each independent section exactly once — inside the shared fragment", () => {
    for (const comp of [
      "<PendingPayoutCard",
      "<ConnectPayoutCard",
      "<AffiliateDeskSection",
      "<EarningsDocuments",
    ]) {
      expect(earningsSource.match(new RegExp(comp, "g")) ?? []).toHaveLength(1);
    }
  });

  it.each([
    "earnings-pending-payout",
    "earnings-connect-payout",
    "earnings-affiliate-desk",
    "earnings-documents",
    "earnings-total",
    "earnings-source-store",
    "earnings-source-beats",
    "earnings-source-memberships",
    "earnings-source-deals",
    "earnings-source-shoutouts",
    "earnings-source-tipjar",
    "earnings-tips-card",
  ])("wraps section %s in its own boundary", (slug) => {
    expect(earningsSource).toContain(`<SectionBoundary name="${slug}">`);
  });
});

describe("affiliate desk normalizers (census item 30)", () => {
  const FULL = {
    asSeller: {
      affiliates: [
        { affiliateUserId: "u1", code: "KING10", salesCount: 3, grossCents: 9000, owedCents: 900, paidCents: 100 },
      ],
      totals: { salesCount: 3, owedCents: 900, paidCents: 100 },
    },
    asAffiliate: {
      products: [
        { surface: "store", productId: "p1", productTitle: "Beat Pack", salesCount: 2, owedCents: 500, paidCents: 0 },
      ],
      totals: { salesCount: 2, owedCents: 500, paidCents: 0 },
    },
    recentSales: [
      { id: "s1", productTitle: "Beat Pack", commissionCents: 250, commissionPct: "10", status: "owed", mine: "seller", createdAt: "2026-11-01" },
    ],
    note: "Commission comes out of the seller's cut.",
  };

  it("passes a well-formed payload through with its values intact", () => {
    const desk = normalizeAffiliateDesk(FULL);
    expect(desk).not.toBeNull();
    expect(desk!.asSeller.totals.owedCents).toBe(900);
    expect(desk!.asSeller.affiliates[0]!.code).toBe("KING10");
    expect(desk!.asAffiliate.totals.salesCount).toBe(2);
    expect(desk!.recentSales[0]!.commissionCents).toBe(250);
    expect(desk!.note).toContain("seller's cut");
  });

  it("returns null when either chair is missing — the section shows its failure state instead of throwing", () => {
    expect(normalizeAffiliateDesk(null)).toBeNull();
    expect(normalizeAffiliateDesk({})).toBeNull();
    expect(normalizeAffiliateDesk({ asSeller: FULL.asSeller })).toBeNull();
    expect(normalizeAffiliateDesk({ asAffiliate: FULL.asAffiliate })).toBeNull();
    expect(normalizeAffiliateDesk("desk")).toBeNull();
  });

  it("degrades a partial payload field-by-field: missing totals → zeros, non-array lists → [], bad entries dropped", () => {
    const desk = normalizeAffiliateDesk({
      asSeller: { affiliates: "nope" },
      asAffiliate: { products: [{ surface: "store", productTitle: 42, salesCount: "x" }, null, "junk"] },
      recentSales: 7,
    });
    expect(desk).not.toBeNull();
    expect(desk!.asSeller.totals).toEqual({ salesCount: 0, owedCents: 0, paidCents: 0 });
    expect(desk!.asSeller.affiliates).toEqual([]);
    expect(desk!.asAffiliate.products).toHaveLength(1);
    expect(desk!.asAffiliate.products[0]!.productTitle).toBe("");
    expect(desk!.asAffiliate.products[0]!.salesCount).toBe(0);
    expect(desk!.recentSales).toEqual([]);
    expect(desk!.note).toBe("");
  });

  it("codes and offers degrade entry-by-entry, never half-shaped", () => {
    expect(normalizeAffiliateCodes({ codes: [{ id: "c1", code: "X", shareLink: "/a/X" }, { bogus: true }, null] })).toHaveLength(2);
    expect(normalizeAffiliateCodes({})).toEqual([]);
    expect(normalizeAffiliateCodes(null)).toEqual([]);
    expect(normalizeAffiliateOffers({ offers: [{ surface: "store", productId: "p1", title: "Pack" }] })[0]!.title).toBe("Pack");
    expect(normalizeAffiliateOffers({ offers: "nope" })).toEqual([]);
  });

  it("the section wires the normalizers at the fetch boundary — no raw desk cast remains", () => {
    expect(affiliateSource).toContain("normalizeAffiliateDesk(await d.json())");
    expect(affiliateSource).toContain("normalizeAffiliateCodes(await c.json())");
    expect(affiliateSource).toContain("normalizeAffiliateOffers(await o.json())");
    expect(affiliateSource).not.toContain("as Desk)");
    expect(affiliateSource).not.toContain("as { codes:");
    expect(affiliateSource).not.toContain("as { offers:");
  });
});
