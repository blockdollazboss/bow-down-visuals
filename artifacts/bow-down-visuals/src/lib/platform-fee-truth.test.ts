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
import {
  STOREFRONT_PLATFORM_FEE_BPS,
  STOREFRONT_PLATFORM_FEE_PCT,
  storefrontFeeCents,
} from "./shops";

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

/* ── Shop fee displays derive from the rail constant (stack1600 fee-display
   lane). The staging walk caught a wrong fee figure on the shop surface;
   the audit found FE displays computing their own percent: the store
   dashboard's digital-sales fee preview ran 10% math and the public shop
   page initialised its fee state to 10 until the payload landed. These
   pins hold every shop display to the one mirror constant, and the
   mirror to the rail's own default. ──────────────────────────────── */
describe("shop fee displays == the shops rail constant", () => {
  it("the FE mirror constant equals the rail's own default (500 bps = 5%)", () => {
    const shops = readApi("routes/generate/shops.ts");
    const m = shops.match(
      /STOREFRONT_PLATFORM_FEE_BPS\s*=\s*Number\(process\.env\["STOREFRONT_PLATFORM_FEE_BPS"\]\)\s*\|\|\s*(\d+)/,
    );
    expect(m, "STOREFRONT_PLATFORM_FEE_BPS default in shops.ts").toBeTruthy();
    expect(Number(m![1])).toBe(STOREFRONT_PLATFORM_FEE_BPS);
    expect(STOREFRONT_PLATFORM_FEE_BPS).toBe(500);
    expect(STOREFRONT_PLATFORM_FEE_PCT).toBe(5);
    /* routes/store.ts (the digital-store rail behind the dashboard's
       Digital sales section) reuses the same knob — no second rate. */
    const store = readApi("routes/store.ts");
    expect(store).toContain("const PLATFORM_FEE_BPS = STOREFRONT_PLATFORM_FEE_BPS");
  });

  it("storefrontFeeCents matches the rail's rounding at the flat 5%", () => {
    expect(storefrontFeeCents(10_000)).toBe(500); // $100.00 → $5.00
    expect(storefrontFeeCents(2000)).toBe(100); // $20.00 → $1.00
    expect(storefrontFeeCents(333)).toBe(17); // $3.33 → 16.65 → 17
    expect(storefrontFeeCents(0)).toBe(0);
  });

  it("store dashboard's fee preview derives from the mirror, never 10% math", () => {
    const dash = readFe("pages/store-dashboard.tsx");
    expect(dash).toContain("storefrontFeeCents(cents)");
    expect(dash).not.toContain("(cents * 10) / 100");
  });

  it("public shop page never initialises or falls back to a stale fee rate", () => {
    const shop = readFe("pages/shop.tsx");
    expect(shop).toContain("useState(STOREFRONT_PLATFORM_FEE_PCT)");
    expect(shop).not.toContain("useState(10)");
    expect(shop).toContain("?? STOREFRONT_PLATFORM_FEE_PCT");
  });

  it("my-shop fee sentences interpolate the mirror constant", () => {
    const mine = readFe("pages/my-shop.tsx");
    expect(mine).toContain("The {STOREFRONT_PLATFORM_FEE_PCT}% platform fee");
    expect(mine).toContain("stays the flat {STOREFRONT_PLATFORM_FEE_PCT}%");
    expect(mine).not.toContain("stays the flat 5%");
  });
});

/* ── The other ruled fees: display == rail (stack1600 sweep). Each
   product keeps its own ratified rate; these pins hold the headline
   display and the rail constant in lockstep so one cannot drift
   without the other side of the pin failing too. ─────────────────── */
describe("the other ruled fees: displays match their rails", () => {
  const en = JSON.parse(readFe("locales/en.json")) as Record<string, any>;

  it("memberships: rail 10% == the after-fee display", () => {
    const rail = readApi("routes/generate/memberships.ts");
    expect(rail).toContain("MEMBERSHIPS_PLATFORM_FEE_PCT = 10");
    expect(en.memberships.afterFee).toContain("10% platform fee");
  });

  it("beats: rail 15% commission == the commission line displays", () => {
    const rail = readApi("routes/generate/beats-pricing.ts");
    expect(rail).toContain("BEAT_SALE_COMMISSION_PCT = 15");
    const line = readFe("lib/world/money-desks-2.ts");
    expect(line).toContain("15% site commission on sales");
  });

  it("sponsors: rail 15% (1500 bps default) == the dashboard displays", () => {
    const rail = readApi("routes/generate/sponsors.ts");
    const m = rail.match(
      /SPONSOR_PLATFORM_FEE_BPS\s*=\s*Number\(process\.env\["SPONSOR_PLATFORM_FEE_BPS"\]\)\s*\|\|\s*(\d+)/,
    );
    expect(m, "SPONSOR_PLATFORM_FEE_BPS default in sponsors.ts").toBeTruthy();
    expect(Number(m![1])).toBe(1500);
    expect(en.sponsorDashboard.earnedHint).toContain("15% platform fee");
    expect(en.sponsorDealDetail.platformFeeLabel).toContain("(15%)");
  });

  it("tips: the rail takes no fee at all == the no-fee displays", () => {
    const rail = readApi("routes/generate/tip-jar.ts");
    expect(rail).not.toContain("application_fee_amount");
    expect(rail).not.toContain("payment_intent_data");
    const door = readFe("components/tips/WatchTipDoor.tsx");
    expect(door).toContain("100% reaches the creator");
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
