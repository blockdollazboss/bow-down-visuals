import { describe, it, expect } from "vitest";
import { normalizeEarningsResponse } from "./earnings-data";

/* DTO guard batch #2 — a partial earnings payload must never render
   $NaN totals: no real total → whole-page failure state; a broken
   source → that source's own error card + the partial flag. */

const good = {
  currency: "USD",
  totalCents: 4200,
  totalTipsVb: 300,
  partial: false,
  sources: {
    storeSales: { status: "ok", totalCents: 2000, count: 4, breakdown: { profileStoreCents: 1500, shopSalesCents: 500 } },
    memberships: { status: "ok", totalCents: 1200, count: 2 },
    brandDeals: { status: "ok", totalCents: 1000, count: 1 },
    tips: { status: "ok", streamTipsVb: 300, streamTipCount: 3, tipJarPendingCents: 0, tipJarPendingCount: 0, tipJarStatus: "open" },
  },
};

describe("normalizeEarningsResponse", () => {
  it("passes a complete payload through untouched", () => {
    const d = normalizeEarningsResponse(good);
    expect(d?.totalCents).toBe(4200);
    expect(d?.partial).toBe(false);
    expect(d?.sources.storeSales.status).toBe("ok");
    if (d?.sources.storeSales.status === "ok") {
      expect(d.sources.storeSales.breakdown?.profileStoreCents).toBe(1500);
    }
  });
  it("returns null when the headline total is not a real number", () => {
    expect(normalizeEarningsResponse({ ...good, totalCents: "lots" })).toBeNull();
    expect(normalizeEarningsResponse({})).toBeNull();
    expect(normalizeEarningsResponse(null)).toBeNull();
  });
  it("a missing/broken source becomes its error card and flags partial — totals stay real", () => {
    const d = normalizeEarningsResponse({ ...good, sources: { ...good.sources, memberships: undefined, brandDeals: { status: "ok", totalCents: "x", count: 1 } } });
    expect(d?.sources.memberships.status).toBe("error");
    expect(d?.sources.brandDeals.status).toBe("error");
    expect(d?.sources.storeSales.status).toBe("ok");
    expect(d?.partial).toBe(true);
    expect(d?.totalCents).toBe(4200);
  });
  it("missing sources entirely → every card errors, total still honored, partial flagged", () => {
    const d = normalizeEarningsResponse({ totalCents: 0, totalTipsVb: null });
    expect(d?.sources.tips.status).toBe("error");
    expect(d?.partial).toBe(true);
  });
});
