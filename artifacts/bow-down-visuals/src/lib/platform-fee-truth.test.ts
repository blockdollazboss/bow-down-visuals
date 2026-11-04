/**
 * platform-fee-truth.test.ts — the storefront fee story is ONE flat 5%.
 *
 * Owner ruling 2026-10-23: flat 5% platform fee on every storefront/shop
 * rail and every display. The retired 10% / 7% / 5% tier ladder was
 * approved 2026-10-07 as a schedule but honored by no checkout rail; the
 * shops rail has charged flat 5% since 2026-10-18. These pins hold the
 * user-facing copy (creator-pricing page + pricing guide + the server's
 * TIER_PLANS labels) to the flat-5% story so the ladder cannot creep
 * back into a display while the rails charge 5%. Other products keep
 * their own ratified fees (memberships 10%, beats/sponsors 15%, live
 * shopping 5%) — they are not this file's business.
 *
 * Stack-100 #34 adds the bookings-basis pins below: the performance
 * booking rail takes its 15% out of the gross booking PRICE (Gate #5
 * proved $37.50 on a $250 booking), and the three surfaces that once
 * said "keeps 15% of the fee" — a fee-on-fee misreading — now state
 * the price basis. The rail itself is pinned untouched.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readFe(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}
function readApi(rel: string): string {
  return readFileSync(new URL(`../../../api-server/src/${rel}`, import.meta.url), "utf8");
}

const LADDER_COPY = [
  "drops your platform fee to 7%",
  "fee drop from 10% to 7%",
  "lowest platform fee on the site at 5%",
  "standard 10% fee",
  "Free keeps 90%",
  "Pro keeps 93%",
  "Only 7% platform fee",
  "Only 5% platform fee",
  "Lower platform fees on everything you sell",
];

describe("storefront fee displays tell the single flat-5% story", () => {
  it("creator-pricing page: flat 5% present, ladder copy gone", () => {
    const page = readFe("pages/creator-pricing.tsx");
    expect(page).toContain("flat 5% platform fee");
    expect(page).toContain("Every tier keeps 95% of every sale");
    for (const stale of LADDER_COPY) {
      expect(page, `stale ladder copy: ${stale}`).not.toContain(stale);
    }
  });

  it("pricing guide: flat 5% on both paid tiers, ladder copy gone", () => {
    const guide = readFe("guides/pricing.ts");
    expect(guide).toContain("same flat 5% platform fee every tier pays");
    expect(guide).toContain("the same flat 5% platform fee as every tier");
    for (const stale of LADDER_COPY) {
      expect(guide, `stale ladder copy: ${stale}`).not.toContain(stale);
    }
  });

  it("pricing switcher caption: plans do NOT change your cut (Stack-100 #3 lane 12)", () => {
    const switcher = readFe("components/PricingSwitcher.tsx");
    expect(switcher).not.toContain("change your cut");
    expect(switcher).toContain("Creator Plans add your own domain, unlimited products and AI boosts");
  });

  it("server TIER_PLANS labels + tier welcome email match the flat 5%", () => {
    const fees = readApi("lib/platform-fees.ts");
    expect(fees).toContain("flat 5% platform fee");
    for (const stale of LADDER_COPY) {
      expect(fees, `stale ladder copy: ${stale}`).not.toContain(stale);
    }
    const sync = readApi("lib/creator-tier-sync.ts");
    expect(sync).toContain("One flat 5% platform fee on everything you sell");
    expect(sync).not.toContain("Lower platform fees on everything you sell");
  });
});

describe("bookings fee copy states the price basis (stack100 #34)", () => {
  it("BookArtistSection: 15% of the price, never 'of the fee'", () => {
    const section = readFe("components/artist/BookArtistSection.tsx");
    expect(section).toContain("keeps 15% of the price at release");
    expect(section).not.toContain("15% of the fee");
  });

  it("performance-bookings route: header comment + list note state the price basis", () => {
    const route = readApi("routes/performance-bookings.ts");
    expect(route).toContain("keeps 15% of the booking");
    expect(route).toContain("price at release (PERFORMANCE_BOOKING_FEE_BPS)");
    expect(route).toContain(
      "Bow Down Visuals keeps 15% of the price at release.",
    );
    expect(route).not.toContain("15% of the fee");
  });

  it("the rail itself is untouched: the split still reads 1500 bps of the gross", () => {
    const rail = readApi("lib/performance-bookings.ts");
    expect(rail).toContain(
      'Number(process.env["PERFORMANCE_BOOKING_FEE_BPS"]) || 1500',
    );
    expect(rail).toContain(
      "feeCents = Math.round((grossCents * PERFORMANCE_BOOKING_FEE_BPS) / 10000)",
    );
  });
});
