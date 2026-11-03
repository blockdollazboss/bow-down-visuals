/**
 * brand-calculator-desk — the seam behind the Get Paid room's
 * native Brand Deal Calculator desk (stack1500 world parity
 * wave #3, census item 21; the census counted
 * /brand-calculator PARTIAL before this wave).
 *
 * Source of truth: artifacts/api-server/src/routes/generate/
 * brand-calculator.ts.
 *   POST /api/brand-calculator/calculate { platform,
 *     followers (int 100–1,000,000,000), avgViews (int
 *     0–1,000,000,000), engagementRate (0–100), contentType,
 *     niche (1–120 chars) }
 *     → { result: CalcResult, creditsUsed, creditsRemaining }
 *   CalcResult = { rateRange: { low, high, currency },
 *     perPost, package3, breakdown: [{ deliverable, low,
 *     high }], usageRights: [{ term, surcharge }],
 *     negotiationTips: string[], disclaimer }.
 *
 * PRICE: 200 Visual Bucs, pinned from the registry row
 * ("/api/brand-calculator/calculate" = "Brand Deal
 * Calculator") — matching the route's BRAND_CALC_CREDIT_COST
 * and the page's badge. The page posts through a plain fetch
 * with its own 402 handling; the desk upgrades the run to the
 * World's confirmed-spend seam (the Interview/Setlist/LLC
 * precedent): a decline runs nothing; a 402 lands in the
 * out-of-Bucs state.
 *
 * HONEST FRAMING (the rail's own rule): every figure is an
 * industry estimate, never a guarantee — the result carries
 * the model's disclaimer and the desk renders it on the rate
 * card verbatim. The result guard mirrors the route's
 * parseCalcJson bar: money degrades to 0 only inside rows the
 * desk labels as estimates; a result with no rate range at
 * all is a failure verdict, never a dressed-up card.
 */
import { getCreditCost } from "../credit-costs";

export const BRAND_CALC_PATH = "/api/brand-calculator/calculate";
export const BRAND_CALC_FEATURE = "Brand Deal Calculator";

function registryCost(path: string): number {
  const row = getCreditCost(path);
  if (!row) throw new Error(`brand-calculator-desk: no credit-cost registry row for ${path}`);
  return row.cost;
}

export const BRAND_CALC_COST = registryCost(BRAND_CALC_PATH);

export const BRAND_CALC_PLATFORMS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "youtube", label: "YouTube" },
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Instagram" },
  { key: "twitch", label: "Twitch" },
  { key: "x", label: "X (Twitter)" },
];

export const BRAND_CALC_CONTENT_TYPES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "sponsored_post", label: "Sponsored post" },
  { key: "video_integration", label: "Video integration (60–90s)" },
  { key: "dedicated_video", label: "Dedicated video" },
  { key: "story_set", label: "Story set (3 frames)" },
  { key: "livestream", label: "Livestream segment" },
  { key: "ambassadorship", label: "Monthly ambassadorship" },
];

export interface BrandCalcForm {
  platform: string;
  followers: string;
  avgViews: string;
  engagementRate: string;
  contentType: string;
  niche: string;
}

/** Numbers ride as the schema's ints/floats or the payload is
 *  refused in-desk (the rail would 400 the same inputs). */
export function buildBrandCalcPayload(form: BrandCalcForm): Record<string, unknown> | null {
  if (!BRAND_CALC_PLATFORMS.some((p) => p.key === form.platform)) return null;
  if (!BRAND_CALC_CONTENT_TYPES.some((t) => t.key === form.contentType)) return null;
  const followers = Number(form.followers);
  const avgViews = Number(form.avgViews);
  const engagementRate = Number(form.engagementRate);
  if (!Number.isInteger(followers) || followers < 100 || followers > 1_000_000_000) return null;
  if (!Number.isInteger(avgViews) || avgViews < 0 || avgViews > 1_000_000_000) return null;
  if (!Number.isFinite(engagementRate) || engagementRate < 0 || engagementRate > 100) return null;
  const niche = form.niche.trim();
  if (!niche) return null;
  return {
    platform: form.platform,
    followers,
    avgViews,
    engagementRate,
    contentType: form.contentType,
    niche: niche.slice(0, 120),
  };
}

export interface BrandCalcResult {
  rateLow: number;
  rateHigh: number;
  currency: string;
  perPost: number;
  package3: number;
  breakdown: Array<{ deliverable: string; low: number; high: number }>;
  usageRights: Array<{ term: string; surcharge: string }>;
  negotiationTips: string[];
  disclaimer: string;
}

function money(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** The route's bar, mirrored: a card needs its rate range. */
export function brandCalcResultOf(data: unknown): BrandCalcResult | null {
  if (!data || typeof data !== "object") return null;
  const result = (data as Record<string, unknown>)["result"];
  if (!result || typeof result !== "object") return null;
  const o = result as Record<string, unknown>;
  const range = o["rateRange"];
  if (!range || typeof range !== "object") return null;
  const rr = range as Record<string, unknown>;
  const breakdown: BrandCalcResult["breakdown"] = [];
  for (const raw of Array.isArray(o["breakdown"]) ? o["breakdown"] : []) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    const deliverable = str(b["deliverable"]);
    if (!deliverable) continue;
    breakdown.push({ deliverable, low: money(b["low"]), high: money(b["high"]) });
  }
  const usageRights: BrandCalcResult["usageRights"] = [];
  for (const raw of Array.isArray(o["usageRights"]) ? o["usageRights"] : []) {
    if (!raw || typeof raw !== "object") continue;
    const u = raw as Record<string, unknown>;
    const term = str(u["term"]);
    if (!term) continue;
    usageRights.push({ term, surcharge: str(u["surcharge"]) });
  }
  return {
    rateLow: money(rr["low"]),
    rateHigh: money(rr["high"]),
    currency: str(rr["currency"]) || "USD",
    perPost: money(o["perPost"]),
    package3: money(o["package3"]),
    breakdown,
    usageRights,
    negotiationTips: (Array.isArray(o["negotiationTips"]) ? o["negotiationTips"] : [])
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim()),
    disclaimer: str(o["disclaimer"]),
  };
}

/** "$1,200" — the desk's one money format. */
export function formatMoney(n: number, currency: string): string {
  return `${currency === "USD" ? "$" : `${currency} `}${n.toLocaleString()}`;
}
