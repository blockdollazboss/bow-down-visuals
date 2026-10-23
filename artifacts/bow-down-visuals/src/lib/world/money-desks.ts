/**
 * money-desks.ts — the pure logic behind the palace's Money wave I
 * (Stack-100 items 61–64): the Treasury packs desk, the Get Paid
 * Room's payout desk, the Crowns creator side (tier management),
 * and the Creator Room store's real cart.
 *
 * The law, same as every stand: prices are NEVER invented here.
 * - Credit packs mirror the server's own PACK_MAP
 *   (api-server routes/stripe-payments.ts) and the pricing page's
 *   pack cards (locales/en.json pricing.creditPacks) — key, credits
 *   and dollar price agree in both sources, and a test pins them.
 * - Payout state is the /api/connect/status DTO verbatim (the same
 *   payload the seller dashboard's Get Paid card renders).
 * - Tier forms ride the memberships rail's own schemas
 *   (routes/generate/memberships.ts tierCreate/tierUpdate) with the
 *   page's exact save body; the platform fee % is whatever
 *   GET /api/memberships/tiers reports (10 today) — never hardcoded
 *   into a charge, only displayed, exactly where the 2D surface
 *   displays it (the "after 10% platform fee" net line).
 * - The room store classifies the profile store-catalog's items by
 *   the rail that actually sells them: the creator's shop products
 *   ride the Marketplace rails (cart + POST /api/storefronts/checkout,
 *   the 5% fee model the Marketplace stand implements), tracks and
 *   videos ride POST /api/store/checkout (the profile store rail,
 *   also 5%, taken from the seller's cut), and store products ride
 *   POST /api/storefront/checkout. Nothing is sold on a rail that
 *   doesn't sell it on the website.
 *
 * Everything here is pure (no fetch, no React) so the money math
 * and payload shaping are unit-tested; the components stay thin.
 */
import { cartKey } from "@/lib/shops";
import { hostedCheckoutUrl, type MembershipTierDto, type PublicProductDto } from "./shop-stands";

/* ─── 61 · Buy Visual Bucs — the Treasury packs desk ─────────────── */

export interface CreditPack {
  /** The pack key POST /api/create-checkout-session takes. */
  key: string;
  /** Visual Bucs the pack grants (server PACK_MAP `credits`). */
  credits: number;
  /** The pack's dollar price, as the pricing page shows it. */
  priceLabel: string;
  /** The credits line, as the pricing page shows it. */
  creditsLabel: string;
}

/** The four packs, in the pricing page's order. Verified against
 *  BOTH sources on 2026-10-23: stripe-payments.ts PACK_MAP
 *  (10→1000, 50→5000, 150→15000, 500→50000) and en.json
 *  pricing.creditPacks.packs ($9 / $39 / $99 / $249). The dollar
 *  price itself is charged by Stripe from its price IDs — this
 *  table only DISPLAYS what the page displays and sends the key
 *  the server maps. */
export const CREDIT_PACKS: CreditPack[] = [
  { key: "10", credits: 1000, priceLabel: "$9", creditsLabel: "1,000 Visual Bucs" },
  { key: "50", credits: 5000, priceLabel: "$39", creditsLabel: "5,000 Visual Bucs" },
  { key: "150", credits: 15000, priceLabel: "$99", creditsLabel: "15,000 Visual Bucs" },
  { key: "500", credits: 50000, priceLabel: "$249", creditsLabel: "50,000 Visual Bucs" },
];

export function creditPackByKey(key: string): CreditPack | null {
  return CREDIT_PACKS.find((p) => p.key === key) ?? null;
}

/** POST /api/create-checkout-session — the pricing page's exact
 *  body: just the pack key; the server prices it. */
export function packCheckoutPayload(pack: CreditPack): { pack: string } {
  return { pack: pack.key };
}

/** The hosted checkout URL a pack checkout answers with ({ url }) —
 *  the same reader every stand uses. Null = no payment page was
 *  handed back, and the desk reports failure instead of opening a
 *  tab to nowhere. */
export function packCheckoutUrl(payload: unknown): string | null {
  return hostedCheckoutUrl(payload);
}

/** The honest line the pricing page itself carries (en.json
 *  pricing.creditPacks.testMode*): payments are in test mode today,
 *  so the desk says so before anyone clicks — never after. */
export const PACKS_TEST_MODE_NOTE =
  "Payments are currently in test mode. No real money is charged.";

/* ─── 62 · Payouts — the Get Paid Room's payout desk ─────────────── */

export interface ConnectStatusDto {
  connected: boolean;
  accountId: string | null;
  onboarded: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  pendingCents: number;
  minPayoutCents: number;
  testMode: boolean;
}

/** Parse GET /api/connect/status tolerantly — the seller dashboard
 *  casts the same payload. A payload that doesn't honestly carry
 *  the money fields is no status at all (null; the desk reports the
 *  load failed rather than rendering invented zeros). The 404
 *  NO_PROFILE answer is handled by the caller (status code), not
 *  here. */
export function parseConnectStatus(payload: unknown): ConnectStatusDto | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p["pendingCents"] !== "number" || !Number.isFinite(p["pendingCents"])) return null;
  if (typeof p["minPayoutCents"] !== "number" || !Number.isFinite(p["minPayoutCents"])) return null;
  const bool = (v: unknown) => v === true;
  return {
    connected: bool(p["connected"]),
    accountId: typeof p["accountId"] === "string" ? p["accountId"] : null,
    onboarded: bool(p["onboarded"]),
    chargesEnabled: bool(p["chargesEnabled"]),
    payoutsEnabled: bool(p["payoutsEnabled"]),
    pendingCents: p["pendingCents"],
    minPayoutCents: p["minPayoutCents"],
    testMode: bool(p["testMode"]),
  };
}

/** The dashboard's own cash-out gate, verbatim: payouts enabled AND
 *  at least the minimum pending. */
export function canCashOut(status: ConnectStatusDto | null): boolean {
  if (!status) return false;
  return status.payoutsEnabled && status.pendingCents >= status.minPayoutCents;
}

/** Which of the dashboard card's three states the desk is in. */
export type PayoutDeskState = "connect" | "finish-setup" | "ready";
export function payoutDeskState(status: ConnectStatusDto): PayoutDeskState {
  if (!status.connected) return "connect";
  if (!status.payoutsEnabled) return "finish-setup";
  return "ready";
}

/** $ with exactly two decimals — the dashboard card's format. */
export function payoutDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** The note a successful cash-out shows: the dashboard's own
 *  sentence, built from the payout response ({ payout.amountCents,
 *  note? }) — the test-mode note rides along verbatim when the
 *  server sends it. Null when the response doesn't carry a payout. */
export function payoutSuccessNote(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const payout = p["payout"];
  if (!payout || typeof payout !== "object") return null;
  const amount = (payout as Record<string, unknown>)["amountCents"];
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  const note = typeof p["note"] === "string" && p["note"] ? ` — ${p["note"]}` : "";
  return `Cash out sent: ${payoutDollars(amount)}${note}`;
}

/** The error line an API refusal carries: the server's human
 *  `message` wins over its machine `error` code (the dashboard's
 *  own order), with the caller's fallback last. */
export function apiErrorLine(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (typeof p["message"] === "string" && p["message"]) return p["message"];
    if (typeof p["error"] === "string" && p["error"]) return p["error"];
  }
  return fallback;
}

/* ─── 63 · Membership tiers — the Crowns creator side ────────────── */

export interface TierFormState {
  name: string;
  /** Dollars as typed (the page keeps the string until save). */
  price: string;
  description: string;
  perks: string[];
  trialEnabled: boolean;
  /** Annual discount % as typed. */
  annualDiscount: string;
}

/** The page's fresh-form defaults (price starts at "5"). */
export function emptyTierForm(): TierFormState {
  return { name: "", price: "5", description: "", perks: [], trialEnabled: false, annualDiscount: "0" };
}

/** Prefill for an edit — the memberships page's startEdit, verbatim. */
export function tierFormFromDto(tier: MembershipTierDto): TierFormState {
  return {
    name: tier.name,
    price: String(tier.priceDollars),
    description: tier.description,
    perks: [...tier.perks],
    trialEnabled: tier.trialEnabled === true,
    annualDiscount: String(tier.annualDiscountPct ?? 0),
  };
}

/* The rail's own limits (tierCreateSchema): name 1–60, price
 * $0–$999.99, description ≤500, perks ≤20 of 1–140 chars, annual
 * discount an integer 0–90. The form gates mirror them so a doomed
 * save is refused in the form, in the stand's plain words. */
export const TIER_NAME_MAX = 60;
export const TIER_PRICE_MAX = 999.99;
export const TIER_DESCRIPTION_MAX = 500;
export const TIER_PERKS_MAX = 20;
export const TIER_PERK_MAX = 140;
export const TIER_ANNUAL_DISCOUNT_MAX = 90;

export function tierFormProblem(form: TierFormState): string | null {
  if (!form.name.trim()) return "Give the tier a name first.";
  if (form.name.trim().length > TIER_NAME_MAX) return `The tier name tops out at ${TIER_NAME_MAX} characters.`;
  const price = parseFloat(form.price);
  if (form.price.trim() === "" || !Number.isFinite(price) || price < 0 || price > TIER_PRICE_MAX) {
    return `Enter a price between $0 and $${TIER_PRICE_MAX} a month — 0 makes it a free tier.`;
  }
  if (form.description.trim().length > TIER_DESCRIPTION_MAX) return `The description tops out at ${TIER_DESCRIPTION_MAX} characters.`;
  /* Perks are judged as they'll be SENT (trimmed, blanks dropped —
   *  the page's add-box never admits a blank perk in the first
   *  place; the payload builder drops blanks the same way). */
  const sentPerks = form.perks.map((p) => p.trim()).filter(Boolean);
  if (sentPerks.length > TIER_PERKS_MAX) return `A tier carries at most ${TIER_PERKS_MAX} perks.`;
  if (sentPerks.some((p) => p.length > TIER_PERK_MAX)) {
    return `Every perk tops out at ${TIER_PERK_MAX} characters.`;
  }
  const discount = parseFloat(form.annualDiscount);
  if (form.annualDiscount.trim() === "" || !Number.isFinite(discount) || discount < 0 || discount > TIER_ANNUAL_DISCOUNT_MAX) {
    return `The annual discount runs 0–${TIER_ANNUAL_DISCOUNT_MAX}%.`;
  }
  return null;
}

/** The save body — POST /api/memberships/tiers and
 *  PUT /api/memberships/tiers/:id take the memberships page's exact
 *  shape, its clamps included. Null when a form gate fails. */
export function buildTierPayload(form: TierFormState): {
  name: string;
  priceDollars: number;
  description: string;
  perks: string[];
  trialEnabled: boolean;
  annualDiscountPct: number;
} | null {
  if (tierFormProblem(form)) return null;
  return {
    name: form.name.trim(),
    priceDollars: Math.max(0, Math.min(TIER_PRICE_MAX, parseFloat(form.price) || 0)),
    description: form.description.trim(),
    perks: form.perks.map((p) => p.trim()).filter(Boolean),
    trialEnabled: form.trialEnabled,
    annualDiscountPct: Math.max(0, Math.min(TIER_ANNUAL_DISCOUNT_MAX, Math.round(parseFloat(form.annualDiscount) || 0))),
  };
}

/** The pause/unpause body — the page's toggle, verbatim: is_active
 *  rides as the STRING "true"/"false" (the rail's enum). */
export function tierActivePayload(tier: MembershipTierDto): { is_active: "true" | "false" } {
  return { is_active: tier.isActive ? "false" : "true" };
}

/** GET /api/memberships/tiers, parsed tolerantly: the caller's OWN
 *  tiers (active AND paused — management sees everything the fan
 *  side hides) plus the platform fee % the rail reports. A payload
 *  without a tiers array is no list at all (null). */
export function parseOwnTiers(payload: unknown): { tiers: MembershipTierDto[]; platformFeePct: number } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (!Array.isArray(p["tiers"])) return null;
  const tiers: MembershipTierDto[] = [];
  for (const raw of p["tiers"] as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== "object") continue;
    if (typeof raw["id"] !== "string" || typeof raw["name"] !== "string") continue;
    const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
    tiers.push({
      id: raw["id"],
      creatorUserId: typeof raw["creatorUserId"] === "string" ? raw["creatorUserId"] : "",
      name: raw["name"],
      priceDollars: num(raw["priceDollars"]),
      priceCents: num(raw["priceCents"]),
      description: typeof raw["description"] === "string" ? raw["description"] : "",
      perks: Array.isArray(raw["perks"]) ? (raw["perks"] as unknown[]).filter((x): x is string => typeof x === "string") : [],
      isActive: raw["isActive"] === true,
      trialEnabled: raw["trialEnabled"] === true,
      annualDiscountPct: num(raw["annualDiscountPct"]),
      annualPriceCents: num(raw["annualPriceCents"]),
      annualPriceDollars: num(raw["annualPriceDollars"]),
      createdAt: typeof raw["createdAt"] === "string" ? raw["createdAt"] : "",
    });
  }
  const fee = p["platformFeePct"];
  return { tiers, platformFeePct: typeof fee === "number" && Number.isFinite(fee) ? fee : 10 };
}

/** The tier row a save answers with ({ tier }) — null when the
 *  answer doesn't honestly carry one. */
export function savedTierDto(payload: unknown): MembershipTierDto | null {
  const parsed = parseOwnTiers({ tiers: [(payload as { tier?: unknown } | null)?.tier] });
  return parsed && parsed.tiers.length === 1 ? parsed.tiers[0]! : null;
}

/** Apply a confirmed save: an edit replaces its row, a create
 *  appends the server's row. The list changes ONLY from
 *  server-confirmed tiers. */
export function applyTierSave(list: MembershipTierDto[], saved: MembershipTierDto, editingId: string | null): MembershipTierDto[] {
  if (editingId) return list.map((t) => (t.id === editingId ? saved : t));
  return [...list, saved];
}

/** Remove a tier — called ONLY after the server confirmed delete. */
export function removeTier(list: MembershipTierDto[], id: string): MembershipTierDto[] {
  return list.filter((t) => t.id !== id);
}

/** What the creator keeps of a tier's price — the server's own
 *  netAfterFee (round(cents × (100 − pct) / 100)), the number the
 *  2D surface shows as "{{amount}} after 10% platform fee". */
export function tierNetCents(priceCents: number, platformFeePct: number): number {
  return Math.round((priceCents * (100 - platformFeePct)) / 100);
}

/* ─── 64 · The Creator Room store — real cart + checkout ─────────── */

export interface RoomStoreItem {
  id: string;
  kind: string;
  /** "shop" for the creator's shop products; null otherwise. */
  productKind: string | null;
  title: string;
  artworkUrl: string | null;
  priceCents: number;
  /** The server's formatted price line. */
  price: string;
  pwyw: { enabled: boolean; minCents: number } | null;
}

/** Parse GET /api/creator-profiles/:slug/store-catalog tolerantly —
 *  the richer read of the panel's old parser: priceCents and
 *  productKind ride along (the catalog DTO carries both), because
 *  the cart math and the rail choice need them. Rows without an id
 *  or a usable price drop out, never repaired into existence. */
export function parseRoomCatalog(payload: unknown): RoomStoreItem[] {
  if (!payload || typeof payload !== "object") return [];
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: RoomStoreItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r["id"] === "string" ? r["id"] : "";
    if (!id) continue;
    if (typeof r["priceCents"] !== "number" || !Number.isFinite(r["priceCents"])) continue;
    const pwywRaw = r["pwyw"];
    const pwyw =
      pwywRaw && typeof pwywRaw === "object" && (pwywRaw as Record<string, unknown>)["enabled"] === true
        ? {
            enabled: true,
            minCents:
              typeof (pwywRaw as Record<string, unknown>)["minCents"] === "number"
                ? ((pwywRaw as Record<string, unknown>)["minCents"] as number)
                : 0,
          }
        : null;
    out.push({
      id,
      kind: typeof r["kind"] === "string" ? r["kind"] : "item",
      productKind: typeof r["productKind"] === "string" ? r["productKind"] : null,
      title: typeof r["title"] === "string" ? r["title"] : "Untitled",
      artworkUrl: typeof r["artworkUrl"] === "string" ? r["artworkUrl"] : null,
      priceCents: r["priceCents"],
      price: typeof r["price"] === "string" ? r["price"] : "",
      pwyw,
    });
  }
  return out;
}

/** Which rail sells an item — the same split the catalog's own
 *  buyUrls encode on the website:
 *  - "market": the creator's SHOP products — the Marketplace rails
 *    (cart, quantities, POST /api/storefronts/checkout);
 *  - "store": tracks and videos — POST /api/store/checkout
 *    (single-item hosted checkout, name-your-price honored);
 *  - "storefront": store products — POST /api/storefront/checkout
 *    (single product, quantity honored);
 *  - null: a kind no rail here sells — the card keeps the honest
 *    website door instead of a button that can't complete. */
export type RoomItemRail = "market" | "store" | "storefront" | null;
export function roomItemRail(item: RoomStoreItem): RoomItemRail {
  if (item.kind === "product" && item.productKind === "shop") return "market";
  if (item.kind === "track" || item.kind === "video") return "store";
  if (item.kind === "product") return "storefront";
  return null;
}

/** The cartable (market-rail) items as Marketplace products — the
 *  stand's detailed cart joins on exactly this shape. */
export function roomMarketProducts(items: RoomStoreItem[]): PublicProductDto[] {
  return items
    .filter((i) => roomItemRail(i) === "market")
    .map((i) => ({
      id: i.id,
      name: i.title,
      price_cents: i.priceCents,
      description: null,
      image_url: i.artworkUrl,
    }));
}

/** POST /api/store/checkout — the store-buy page's exact body:
 *  { kind, id } plus amountCents ONLY for a name-your-price item
 *  (the fan's amount, validated against the minimum first). */
export function storeCheckoutPayload(
  item: RoomStoreItem,
  pwywDollars: string,
): { ok: true; body: { kind: string; id: string; amountCents?: number } } | { ok: false; problem: string } {
  if (!item.pwyw?.enabled) return { ok: true, body: { kind: item.kind, id: item.id } };
  const cents = Math.round(Number.parseFloat(pwywDollars || "0") * 100);
  if (!Number.isFinite(cents) || cents < item.pwyw.minCents) {
    return {
      ok: false,
      problem: `Name your price — at least $${(item.pwyw.minCents / 100).toFixed(2)}.`,
    };
  }
  return { ok: true, body: { kind: item.kind, id: item.id, amountCents: cents } };
}

/** POST /api/storefront/checkout — the product page's Buy Now body
 *  (quantity rides along; no discount field at this stand — the
 *  room store never invents a code box the catalog didn't carry). */
export function storefrontCheckoutPayload(item: RoomStoreItem, quantity: number): { productId: string; quantity: number } {
  return { productId: item.id, quantity: Math.max(1, Math.min(99, Math.floor(quantity) || 1)) };
}

/** The room cart's persistence key: the shop page's own key shape
 *  (cartKey(handle)) when the room's creator runs that shop — the
 *  room cart and the Marketplace stand cart for the same shop are
 *  ONE cart. Without a storefront handle, the room keeps its own
 *  key by slug. */
export function roomCartKey(handle: string | null, slug: string): string {
  return handle ? cartKey(handle) : `bdv-cart-room-${slug}`;
}
