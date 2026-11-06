/* ── Affiliate desk payload guards (Stack-200 hardening C, item 30) ──
 * Same pattern as lib/earnings-data.ts. AffiliateDeskSection stored
 * `(await res.json()) as Desk` after only a res.ok check, then
 * dereferenced desk.asSeller.totals.*, desk.asSeller.affiliates.map,
 * desk.asAffiliate.totals.* and desk.recentSales unconditionally in
 * render — a partial/malformed 200 threw during render and took the
 * whole /earnings page down, despite the section's own header
 * promising it "never takes the rest of the earnings page down"
 * (true only for fetch failures). These normalizers run at the
 * fetch boundary:
 *   • a desk payload missing either chair (asSeller / asAffiliate)
 *     is not a desk at all → null → the section's honest failure
 *     state, never a render throw;
 *   • inside a chair, arrays default to [] and money/count fields
 *     to 0 when absent or non-numeric — the same degrade-to-zero
 *     discipline the earnings normalizer applies to older payloads;
 *   • codes / offers lists degrade entry-by-entry: a malformed
 *     entry is dropped, never rendered half-shaped. */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const num = (v: unknown): number => finite(v) ?? 0;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export interface DeskTotals {
  salesCount: number;
  owedCents: number;
  paidCents: number;
}
export interface AffiliateDesk {
  asSeller: {
    affiliates: Array<{
      affiliateUserId: string;
      code: string;
      salesCount: number;
      grossCents: number;
      owedCents: number;
      paidCents: number;
    }>;
    totals: DeskTotals;
  };
  asAffiliate: {
    products: Array<{
      surface: string;
      productId: string | null;
      productTitle: string;
      salesCount: number;
      owedCents: number;
      paidCents: number;
    }>;
    totals: DeskTotals;
  };
  recentSales: Array<{
    id: string;
    productTitle: string;
    commissionCents: number;
    commissionPct: string;
    status: string;
    mine: string;
    createdAt: string;
  }>;
  note: string;
}
export interface AffiliateCode {
  id: string;
  code: string;
  surface: string;
  productTitle: string;
  shareLink: string;
  isActive: boolean;
  salesCount: number;
  owedCents: number;
  paidCents: number;
}
export interface AffiliateOffer {
  surface: string;
  productId: string;
  title: string;
  price: string;
  sellerName: string;
  commissionPct: string;
  productPath: string;
}

function totals(v: unknown): DeskTotals {
  const t = isObj(v) ? v : {};
  return {
    salesCount: num(t.salesCount),
    owedCents: num(t.owedCents),
    paidCents: num(t.paidCents),
  };
}

export function normalizeAffiliateDesk(payload: unknown): AffiliateDesk | null {
  if (!isObj(payload)) return null;
  if (!isObj(payload.asSeller) || !isObj(payload.asAffiliate)) return null;
  const seller = payload.asSeller;
  const affiliate = payload.asAffiliate;
  return {
    asSeller: {
      affiliates: (Array.isArray(seller.affiliates) ? seller.affiliates : [])
        .filter(isObj)
        .map((a) => ({
          affiliateUserId: str(a.affiliateUserId),
          code: str(a.code),
          salesCount: num(a.salesCount),
          grossCents: num(a.grossCents),
          owedCents: num(a.owedCents),
          paidCents: num(a.paidCents),
        })),
      totals: totals(seller.totals),
    },
    asAffiliate: {
      products: (Array.isArray(affiliate.products) ? affiliate.products : [])
        .filter(isObj)
        .map((pr) => ({
          surface: str(pr.surface),
          productId: typeof pr.productId === "string" ? pr.productId : null,
          productTitle: str(pr.productTitle),
          salesCount: num(pr.salesCount),
          owedCents: num(pr.owedCents),
          paidCents: num(pr.paidCents),
        })),
      totals: totals(affiliate.totals),
    },
    recentSales: (Array.isArray(payload.recentSales) ? payload.recentSales : [])
      .filter(isObj)
      .map((r) => ({
        id: str(r.id),
        productTitle: str(r.productTitle),
        commissionCents: num(r.commissionCents),
        commissionPct: str(r.commissionPct),
        status: str(r.status),
        mine: str(r.mine),
        createdAt: str(r.createdAt),
      })),
    note: str(payload.note),
  };
}

export function normalizeAffiliateCodes(payload: unknown): AffiliateCode[] {
  if (!isObj(payload) || !Array.isArray(payload.codes)) return [];
  return payload.codes.filter(isObj).map((c) => ({
    id: str(c.id),
    code: str(c.code),
    surface: str(c.surface),
    productTitle: str(c.productTitle),
    shareLink: str(c.shareLink),
    isActive: c.isActive === true,
    salesCount: num(c.salesCount),
    owedCents: num(c.owedCents),
    paidCents: num(c.paidCents),
  }));
}

export function normalizeAffiliateOffers(payload: unknown): AffiliateOffer[] {
  if (!isObj(payload) || !Array.isArray(payload.offers)) return [];
  return payload.offers.filter(isObj).map((o) => ({
    surface: str(o.surface),
    productId: str(o.productId),
    title: str(o.title),
    price: str(o.price),
    sellerName: str(o.sellerName),
    commissionPct: str(o.commissionPct),
    productPath: str(o.productPath),
  }));
}
