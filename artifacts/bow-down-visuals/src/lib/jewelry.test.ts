/**
 * jewelry.test.ts — the $0.00 jewelry pin (QC-200 fix queue #6).
 *
 * Provenance: the jewelry line went premium on 2026-10-06 (commit
 * e8791875f) — the old plated-era prices were deliberately removed and
 * every catalog priceCents set to 0, meaning "price TBD from supplier
 * quotes; final price confirmed with the buyer before production".
 * That commit added formatJewelryPrice ("Pricing soon" for an unset
 * price) but the shop page never adopted it — it rendered formatMoney
 * directly, so all four pieces showed a literal "$0.00" with working
 * reserve buttons, and the orphaned helper was deleted as dead code on
 * 2026-10-10. The shop is reservation-only (no charge is ever taken
 * there), so nothing was sold at $0 — but a rendered "$0.00" is a fake
 * price. These pins hold the honest interim: an unset price renders
 * "Pricing soon" on every surface, never "$0.00", until the owner sets
 * real prices in BOTH catalogs (FE lib + @workspace/db schema), which
 * the parity pin below forces to move together.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  JEWELRY_PRODUCTS,
  JEWELRY_PRICE_TBD_LABEL,
  formatJewelryPrice,
  formatMoney,
} from "./jewelry";

const read = (rel: string): string =>
  readFileSync(new URL(rel, import.meta.url), "utf8");

describe("formatJewelryPrice — an unset price is never a dollar amount", () => {
  it("renders the TBD label for zero and negative cents", () => {
    expect(JEWELRY_PRICE_TBD_LABEL).toBe("Pricing soon");
    expect(formatJewelryPrice(0)).toBe("Pricing soon");
    expect(formatJewelryPrice(-500)).toBe("Pricing soon");
  });

  it("renders real money once a price is set", () => {
    expect(formatJewelryPrice(8900)).toBe("$89.00");
    expect(formatJewelryPrice(12900)).toBe("$129.00");
    expect(formatJewelryPrice(1)).toBe("$0.01");
  });

  it("formatMoney itself is unchanged (other lines rely on it)", () => {
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(2900)).toBe("$29.00");
  });
});

describe("the catalog can never render a $0.00 sellable price", () => {
  it("every piece renders 'Pricing soon' or a real price — never $0.00", () => {
    expect(JEWELRY_PRODUCTS.length).toBeGreaterThan(0);
    for (const p of JEWELRY_PRODUCTS) {
      expect(formatJewelryPrice(p.priceCents), p.key).not.toBe("$0.00");
      if (p.priceCents <= 0) {
        expect(formatJewelryPrice(p.priceCents), p.key).toBe("Pricing soon");
      }
    }
  });

  it("order totals at any quantity never render $0.00 either", () => {
    for (const p of JEWELRY_PRODUCTS) {
      for (const qty of [1, 2, 20]) {
        expect(formatJewelryPrice(p.priceCents * qty), `${p.key} x${qty}`).not.toBe("$0.00");
      }
    }
  });
});

describe("FE catalog == server catalog (lib/db schema) — prices move together or not at all", () => {
  const serverSrc = read("../../../../lib/db/src/schema/jewelry.ts");
  const block = serverSrc.slice(
    serverSrc.indexOf("export const JEWELRY_PRODUCTS"),
    serverSrc.indexOf("as const", serverSrc.indexOf("export const JEWELRY_PRODUCTS")),
  );
  const serverPrices = new Map<string, number>();
  for (const m of block.matchAll(/key:\s*"([^"]+)"[\s\S]*?priceCents:\s*(\d+)/g)) {
    serverPrices.set(m[1], Number(m[2]));
  }

  it("the server catalog parses and covers exactly the FE keys", () => {
    expect(serverPrices.size).toBe(JEWELRY_PRODUCTS.length);
    expect([...serverPrices.keys()].sort()).toEqual(JEWELRY_PRODUCTS.map((p) => p.key).sort());
  });

  it("every priceCents matches across the two catalogs", () => {
    for (const p of JEWELRY_PRODUCTS) {
      expect(serverPrices.get(p.key), p.key).toBe(p.priceCents);
    }
  });
});

describe("source pins — every jewelry price render goes through formatJewelryPrice", () => {
  const shop = read("../pages/jewelry-shop.tsx");
  const admin = read("../components/JewelryOrdersAdmin.tsx");

  it("the shop renders card price, both totals, and reservation rows via the helper", () => {
    expect(shop).toContain("formatJewelryPrice(p.priceCents)");
    expect(shop).toContain("formatJewelryPrice(total)");
    expect(shop).toContain("formatJewelryPrice(o.total_cents)");
  });

  it("the shop never formats a jewelry price with formatMoney or a literal $0.00", () => {
    expect(shop).not.toContain("formatMoney");
    expect(shop).not.toContain("$0.00");
  });

  it("the admin reservations table renders totals via the helper, not raw cents math", () => {
    expect(admin).toContain("formatJewelryPrice(o.total_cents)");
    expect(admin).not.toContain("(o.total_cents / 100)");
  });
});
