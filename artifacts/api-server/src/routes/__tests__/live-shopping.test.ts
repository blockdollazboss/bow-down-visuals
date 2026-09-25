/**
 * Tests for the Live Shopping backend.
 *
 * Covers: the 5% platform fee math (rounds half-up, payouts reconcile),
 * price formatting, zod input schemas (validation + rejection), and the
 * 1-credit AI description price.
 *
 * Unit tests never touch a real database: importing the route pulls in
 * @workspace/db (dummy DATABASE_URL from vitest config), but the pg Pool
 * only connects on first query, which these tests never issue.
 */
import { describe, expect, it } from "vitest";
import {
  AI_DESCRIPTION_CREDIT_COST,
  alertSchema,
  formatPrice,
  productSchema,
  productUpdateSchema,
  saleSchema,
  streamSchema,
  streamUpdateSchema,
} from "../live-shopping";
import {
  LIVE_SHOPPING_FEE_BPS,
  creatorPayoutCents,
  platformFeeCents,
} from "@workspace/db";

describe("LIVE_SHOPPING_FEE_BPS", () => {
  it("is 5% expressed in basis points", () => {
    expect(LIVE_SHOPPING_FEE_BPS).toBe(500);
  });
});

describe("platformFeeCents", () => {
  it("takes 5% of the sale total", () => {
    expect(platformFeeCents(10000)).toBe(500); // $100.00 → $5.00
    expect(platformFeeCents(2499)).toBe(125); // $24.99 → $1.25 (124.95 rounds up)
    expect(platformFeeCents(0)).toBe(0);
  });

  it("rounds half-up on fractional cents", () => {
    // 99¢ * 5% = 4.95¢ → 5¢
    expect(platformFeeCents(99)).toBe(5);
    // $0.10 * 5% = 0.5¢ → 1¢
    expect(platformFeeCents(10)).toBe(1);
  });
});

describe("creatorPayoutCents", () => {
  it("fee + payout always reconciles to the total", () => {
    for (const total of [0, 10, 99, 2499, 10000, 99999]) {
      expect(platformFeeCents(total) + creatorPayoutCents(total)).toBe(total);
    }
  });
});

describe("formatPrice", () => {
  it("formats cents as dollars", () => {
    expect(formatPrice(2499)).toBe("$24.99");
    expect(formatPrice(100)).toBe("$1.00");
    expect(formatPrice(0)).toBe("$0.00");
  });
});

describe("AI_DESCRIPTION_CREDIT_COST", () => {
  it("charges 1 credit for an AI product description", () => {
    expect(AI_DESCRIPTION_CREDIT_COST).toBe(1);
  });
});

describe("productSchema", () => {
  const valid = { name: "Gold Hoodie", price_cents: 4999 };

  it("accepts a minimal valid product", () => {
    expect(productSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional urls and description", () => {
    expect(
      productSchema.safeParse({
        ...valid,
        image_url: "https://example.com/img.png",
        external_url: "https://shop.example.com/buy",
        description: "Soft heavyweight hoodie.",
        is_active: true,
      }).success,
    ).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(productSchema.safeParse({ ...valid, name: "  " }).success).toBe(false);
  });

  it("rejects negative or fractional prices", () => {
    expect(productSchema.safeParse({ ...valid, price_cents: -1 }).success).toBe(false);
    expect(productSchema.safeParse({ ...valid, price_cents: 49.99 }).success).toBe(false);
  });

  it("rejects non-url image links", () => {
    expect(productSchema.safeParse({ ...valid, image_url: "not-a-url" }).success).toBe(false);
  });

  it("treats empty-string urls as absent", () => {
    const parsed = productSchema.safeParse({ ...valid, image_url: "" });
    expect(parsed.success).toBe(true);
  });
});

describe("productUpdateSchema", () => {
  it("accepts partial updates", () => {
    expect(productUpdateSchema.safeParse({ price_cents: 5999 }).success).toBe(true);
    expect(productUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("still rejects bad values when present", () => {
    expect(productUpdateSchema.safeParse({ price_cents: -5 }).success).toBe(false);
  });
});

describe("streamSchema", () => {
  it("accepts a title", () => {
    expect(streamSchema.safeParse({ title: "Friday merch drop" }).success).toBe(true);
  });

  it("rejects an empty title", () => {
    expect(streamSchema.safeParse({ title: "" }).success).toBe(false);
  });
});

describe("streamUpdateSchema", () => {
  it("accepts status changes and pin/unpin", () => {
    expect(streamUpdateSchema.safeParse({ status: "ended" }).success).toBe(true);
    expect(
      streamUpdateSchema.safeParse({ pinned_product_id: "123e4567-e89b-12d3-a456-426614174000" }).success,
    ).toBe(true);
    expect(streamUpdateSchema.safeParse({ pinned_product_id: null }).success).toBe(true);
  });

  it("rejects unknown statuses and non-uuid product ids", () => {
    expect(streamUpdateSchema.safeParse({ status: "paused" }).success).toBe(false);
    expect(streamUpdateSchema.safeParse({ pinned_product_id: "nope" }).success).toBe(false);
  });
});

describe("alertSchema", () => {
  it("defaults buyer name and quantity", () => {
    const parsed = alertSchema.safeParse({ product_id: "123e4567-e89b-12d3-a456-426614174000" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.buyer_name).toBe("A viewer");
      expect(parsed.data.quantity).toBe(1);
    }
  });

  it("rejects zero quantity", () => {
    expect(
      alertSchema.safeParse({ product_id: "123e4567-e89b-12d3-a456-426614174000", quantity: 0 }).success,
    ).toBe(false);
  });
});

describe("saleSchema", () => {
  it("accepts product + optional stream + quantity", () => {
    expect(
      saleSchema.safeParse({
        product_id: "123e4567-e89b-12d3-a456-426614174000",
        stream_id: "123e4567-e89b-12d3-a456-426614174001",
        quantity: 3,
      }).success,
    ).toBe(true);
  });

  it("rejects a non-uuid product id", () => {
    expect(saleSchema.safeParse({ product_id: "nope" }).success).toBe(false);
  });
});
