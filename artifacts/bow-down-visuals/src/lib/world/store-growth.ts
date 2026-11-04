/**
 * store-growth.ts — the pure logic behind the World's Store Growth
 * desk (stack1400 parity wave #1, item 3): the three conversion
 * tools the store dashboard (/store/dashboard) runs and the World
 * had no form for —
 *
 *   1. LEAD MAGNETS — a storefront product priced at $0 (migration
 *      0190). It is never checked out: fans claim it with their
 *      email via POST /api/storefront/claim, and the claim joins
 *      the creator's audience list. On the seller side a lead
 *      magnet is simply a product whose price is 0, so the desk
 *      creates one with POST /api/storefront/products at
 *      priceCents 0 and turns an existing product into one (or
 *      back into a paid product) with PATCH
 *      /api/storefront/products/:id { priceCents }.
 *   2. ORDER BUMPS — ONE add-on offer attached to a product
 *      (feature #13): PUT /api/storefront/products/:id/bump with
 *      { bumpProductId, percentOff }. The add-on is another of the
 *      seller's own priced products; at checkout the buyer ticks
 *      it and it rides the same single charge.
 *   3. POST-PURCHASE UPSELL — the SAME designation as the order
 *      bump (api lib/post-purchase-upsell.ts: the designation
 *      REUSES the order-bump attachment). If the buyer didn't tick
 *      the add-on, it is offered once right after the purchase
 *      completes, one click on the card they just used
 *      (GET/POST /api/storefront/orders/:id/upsell[/accept|/decline]
 *      are the BUYER's rails — the seller's only switch is the
 *      designation itself, so this desk's upsell section edits the
 *      same attachment and says so plainly).
 *
 * Prices/fees are never invented here: every price is the
 * seller-set product price (or the seller-set % off it, capped at
 * MAX_BUMP_PERCENT_OFF — the api lib/order-bumps ceiling), and the
 * fee on an add-on sale is the rail's flat platform fee, read off
 * the dashboard's own copy. The seller's product list is the
 * dashboard's own read — GET /api/storefront/products?slug=<mine>,
 * whose payload carries each product's raw bumpConfig and its
 * resolved live `bump` offer — and the seller's slug comes from
 * GET /api/storefront/money-checklist's links.storeUrl, exactly
 * where the dashboard gets it. A genuine no-profile account
 * answers that checklist 404 NO_PROFILE: the desk renders its
 * honest "make your creator profile first" state, never a fake
 * empty store.
 *
 * Everything in this module is pure (no fetch, no React) so the
 * desk's payload shaping and parsing are unit-tested; the
 * component in components/world/native/StoreGrowthDesk.tsx stays
 * a thin shell that fetches and renders. The desk renders ONLY
 * for signed-in members (guests have no store to grow) and every
 * change it makes is confirmed by the server's answer before the
 * list moves — the list never changes from a local guess.
 */
import { dollarsToCents } from "@/lib/shops";

/** The bump percent-off ceiling — the api lib/order-bumps
 *  MAX_BUMP_PERCENT_OFF (90), mirrored so a doomed save is refused
 *  in the form; the rail re-checks it regardless. */
export const MAX_BUMP_PERCENT_OFF = 90;

/** The flat platform fee the add-on rails charge — read off the
 *  storefront rail's own fee note / the dashboard's bump copy
 *  ("The flat 5% platform fee applies to the add-on too"). Shown
 *  as copy only; no fee is ever computed here. */
export const ADDON_FEE_LABEL = "flat 5% platform fee";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ─── The seller's product shape, narrowed from the dashboard's
 *     own list payload (lib/storefront-api StoreProductDTO) ────── */

export interface GrowthBumpConfig {
  bumpProductId: string;
  percentOff: number;
}

export interface GrowthBumpOffer {
  productId: string;
  title: string;
  priceCents: number;
  percentOff: number;
}

export interface GrowthProduct {
  id: string;
  title: string;
  kind: string;
  priceCents: number;
  isActive: boolean;
  /** Office Hours services carry priceCents 0 BY DESIGN (their
   *  price is Visual Bucs) and the claim rail refuses them — they
   *  are NOT lead magnets and must never be listed or priced as
   *  one. */
  officeHours: boolean;
  bumpConfig: GrowthBumpConfig | null;
  /** The buyer-facing resolved offer, or null when the attached
   *  add-on isn't live right now (paused / sold out / gone). */
  bump: GrowthBumpOffer | null;
}

function parseBumpConfig(v: unknown): GrowthBumpConfig | null {
  if (!v || typeof v !== "object") return null;
  const row = v as Record<string, unknown>;
  if (typeof row["bumpProductId"] !== "string" || !UUID_RE.test(row["bumpProductId"])) return null;
  const pct = row["percentOff"];
  if (typeof pct !== "number" || !Number.isInteger(pct) || pct < 0 || pct > MAX_BUMP_PERCENT_OFF) return null;
  return { bumpProductId: row["bumpProductId"], percentOff: pct };
}

function parseBumpOffer(v: unknown): GrowthBumpOffer | null {
  if (!v || typeof v !== "object") return null;
  const row = v as Record<string, unknown>;
  if (typeof row["productId"] !== "string" || !row["productId"]) return null;
  if (typeof row["title"] !== "string" || !row["title"]) return null;
  if (typeof row["priceCents"] !== "number" || !Number.isFinite(row["priceCents"])) return null;
  const pct = typeof row["percentOff"] === "number" && Number.isFinite(row["percentOff"]) ? row["percentOff"] : 0;
  return { productId: row["productId"], title: row["title"], priceCents: row["priceCents"], percentOff: pct };
}

/** Narrow one product row. Null when the row doesn't honestly
 *  carry an id/title/price — a malformed row drops out rather
 *  than rendering as an invented product. */
export function parseGrowthProduct(v: unknown): GrowthProduct | null {
  if (!v || typeof v !== "object") return null;
  const row = v as Record<string, unknown>;
  if (typeof row["id"] !== "string" || !row["id"]) return null;
  if (typeof row["title"] !== "string" || !row["title"]) return null;
  if (typeof row["priceCents"] !== "number" || !Number.isFinite(row["priceCents"])) return null;
  const sd = row["serviceDetails"];
  const officeHours =
    !!sd && typeof sd === "object" && (sd as Record<string, unknown>)["office_hours"] === true;
  return {
    id: row["id"],
    title: row["title"],
    kind: typeof row["kind"] === "string" ? row["kind"] : "digital",
    priceCents: row["priceCents"],
    isActive: row["isActive"] !== false,
    officeHours,
    bumpConfig: parseBumpConfig(row["bumpConfig"]),
    bump: parseBumpOffer(row["bump"]),
  };
}

/** GET /api/storefront/products?slug=… → the seller's products.
 *  Null when the payload carries no products array at all (the
 *  read failed in shape — the desk reports the failure instead of
 *  rendering an invented empty store). */
export function parseGrowthProducts(payload: unknown): GrowthProduct[] | null {
  if (!payload || typeof payload !== "object") return null;
  const rows = (payload as { products?: unknown }).products;
  if (!Array.isArray(rows)) return null;
  return rows.map(parseGrowthProduct).filter((p): p is GrowthProduct => p !== null);
}

/** The seller's store slug, from GET
 *  /api/storefront/money-checklist — the dashboard's own source:
 *  links.storeUrl is "/artist/<slug>". Anything else is null. */
export function parseStoreSlug(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const links = (payload as { links?: unknown }).links;
  if (!links || typeof links !== "object") return null;
  const url = (links as { storeUrl?: unknown }).storeUrl;
  if (typeof url !== "string") return null;
  const slug = url.split("/artist/")[1]?.split(/[/?#]/)[0]?.trim();
  return slug ? slug : null;
}

/* ─── Lead magnets ──────────────────────────────────────────────── */

/** A product IS a lead magnet when its price is $0 — the rail's
 *  own rule (the payload even carries `free` for it) — with the
 *  one honest exception: an Office Hours service's $0 is its
 *  unused dollar field, not a free claim. Gift cards are excluded
 *  too: their priceCents is the smallest seller-set amount, never
 *  a claim price, so a $0-shaped gift card row is not a magnet. */
export function isLeadMagnet(p: GrowthProduct): boolean {
  return p.priceCents === 0 && !p.officeHours && p.kind !== "gift_card";
}

export function leadMagnets(products: GrowthProduct[]): GrowthProduct[] {
  return products.filter(isLeadMagnet);
}

/** Products that may be TURNED INTO a lead magnet from the desk:
 *  currently paid, and not a kind whose price means something
 *  else (gift cards price from their amounts list; Office Hours
 *  services are already $0-shaped and VB-priced). */
export function leadMagnetConvertible(products: GrowthProduct[]): GrowthProduct[] {
  return products.filter((p) => p.priceCents > 0 && p.kind !== "gift_card" && !p.officeHours);
}

/** The kinds the desk's create form offers — the two kinds whose
 *  create needs nothing beyond title/description/price (tickets
 *  need an event, services need details, gift cards need amounts;
 *  those stay creatable from the Products bench, and any of them
 *  can still be priced $0 there or converted here). */
export const LEAD_MAGNET_KINDS = ["digital", "download"] as const;
export type LeadMagnetKind = (typeof LEAD_MAGNET_KINDS)[number];

export interface LeadMagnetFormState {
  title: string;
  description: string;
  kind: LeadMagnetKind;
}

export function emptyLeadMagnetForm(): LeadMagnetFormState {
  return { title: "", description: "", kind: "digital" };
}

export interface LeadMagnetStrings {
  titleRequired: string;
  titleLong: string;
  descLong: string;
  restorePrice: string;
}

/** The seam's English defaults — byte-identical to the desk's
 *  original literals; the desk passes catalog strings
 *  (the namespace's growthProblem* keys). */
export const LEAD_MAGNET_STRINGS_EN: LeadMagnetStrings = {
  titleRequired: "Give the free product a title first.",
  titleLong: "The title tops out at 160 characters.",
  descLong: "The description tops out at 5000 characters.",
  restorePrice: "Enter the price it should sell for — dollars and cents above $0, like 9.99.",
};

export function leadMagnetFormProblem(
  form: LeadMagnetFormState,
  strings: LeadMagnetStrings = LEAD_MAGNET_STRINGS_EN,
): string | null {
  if (!form.title.trim()) return strings.titleRequired;
  if (form.title.trim().length > 160) return strings.titleLong;
  if (form.description.trim().length > 5000) return strings.descLong;
  return null;
}

/** POST /api/storefront/products — the create body for a lead
 *  magnet: the dashboard's product shape with priceCents 0 (the
 *  one fact that makes it a magnet), unlimited inventory, live. */
export function buildLeadMagnetCreatePayload(
  form: LeadMagnetFormState,
): { kind: LeadMagnetKind; title: string; description: string; priceCents: 0; inventory: -1; mediaUrls: string[]; isActive: true } | null {
  if (leadMagnetFormProblem(form)) return null;
  return {
    kind: form.kind,
    title: form.title.trim(),
    description: form.description.trim(),
    priceCents: 0,
    inventory: -1,
    mediaUrls: [],
    isActive: true,
  };
}

/** PATCH /api/storefront/products/:id — turn a product into a
 *  lead magnet. The body carries ONLY the price: the rail's
 *  partial update leaves every other field untouched. */
export function buildLeadMagnetConvertPayload(): { priceCents: 0 } {
  return { priceCents: 0 };
}

/** PATCH body for making a lead magnet paid again — the seller
 *  types the new price; it must be a real price above $0 (a $0
 *  "restore" would leave it a magnet and lie about the change). */
export function buildLeadMagnetRestorePayload(priceInput: string): { priceCents: number } | null {
  const cents = dollarsToCents(priceInput.trim());
  if (cents === null || cents <= 0) return null;
  return { priceCents: cents };
}

export function leadMagnetRestoreProblem(
  priceInput: string,
  strings: LeadMagnetStrings = LEAD_MAGNET_STRINGS_EN,
): string | null {
  if (buildLeadMagnetRestorePayload(priceInput)) return null;
  return strings.restorePrice;
}

/* ─── Order bumps + the post-purchase upsell designation ───────── */

/** May `target` be offered as `main`'s add-on in the form? The
 *  rail's attach rules the form can know (api lib/order-bumps
 *  validateBumpTarget): never the product itself, never a free
 *  product (a $0 lead magnet rides the claim rail, not a paid
 *  line), never a gift card (its price is an amounts list). The
 *  server re-validates everything, stock included. */
export function bumpCandidates(products: GrowthProduct[], mainId: string): GrowthProduct[] {
  return products.filter((p) => p.id !== mainId && p.priceCents > 0 && p.kind !== "gift_card");
}

export interface BumpStrings {
  percentProblem: string;
  summaryNone: string;
  summaryAttachedNamed: string;
  summaryAttachedAnon: string;
  summaryLive: string;
  summaryLivePct: string;
}

/** The seam's English defaults — byte-identical to the desk's
 *  original literals; the desk passes catalog strings
 *  (the namespace's growthProblemPercent / growthSummary* keys).
 *  Templates carry {{max}} / {{title}} / {{pct}} / {{pctPart}}. */
export const BUMP_STRINGS_EN: BumpStrings = {
  percentProblem: "The % off is a whole number from 0 to {{max}}.",
  summaryNone: "No add-on attached.",
  summaryAttachedNamed: "Add-on attached — “{{title}}” — but not offered right now (it's paused, sold out or gone).",
  summaryAttachedAnon: "Add-on attached, but not offered right now (it's paused, sold out or gone).",
  summaryLive: "Add-on live: “{{title}}”{{pctPart}}.",
  summaryLivePct: " · {{pct}}% off",
};

/** The typed % off, gated the rail's way: a whole number 0–90.
 *  An empty field is the rail's default, 0 (full price). */
export function bumpPercentProblem(raw: string, strings: BumpStrings = BUMP_STRINGS_EN): string | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0 || n > MAX_BUMP_PERCENT_OFF) {
    return strings.percentProblem.replace("{{max}}", String(MAX_BUMP_PERCENT_OFF));
  }
  return null;
}

export function parseBumpPercent(raw: string): number {
  const t = raw.trim();
  if (t === "") return 0;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 && n <= MAX_BUMP_PERCENT_OFF ? n : 0;
}

/** PUT /api/storefront/products/:id/bump — the dashboard's exact
 *  body (lib/storefront-api setProductBump): a target id attaches
 *  (with the seller-set % off), null clears the designation —
 *  which clears the checkout bump AND the post-purchase upsell
 *  together, because they are the one designation. */
export function buildBumpPayload(
  targetId: string | null,
  percentRaw: string,
): { bumpProductId: string | null; percentOff: number } | null {
  if (targetId === null) return { bumpProductId: null, percentOff: 0 };
  if (!UUID_RE.test(targetId)) return null;
  if (bumpPercentProblem(percentRaw)) return null;
  return { bumpProductId: targetId, percentOff: parseBumpPercent(percentRaw) };
}

/** The buyer-facing add-on price, for the form's preview ONLY —
 *  the api lib/order-bumps bumpUnitCents formula (seller-set
 *  price with the seller-set % off, floored at 1¢). The server
 *  recomputes it at save and at checkout; this number never
 *  charges anyone. */
export function bumpUnitCents(listPriceCents: number, percentOff: number): number {
  const list = Math.max(0, Math.round(listPriceCents));
  const pct = Math.max(0, Math.min(MAX_BUMP_PERCENT_OFF, Math.round(percentOff)));
  if (list === 0) return 0;
  return Math.max(1, Math.round((list * (100 - pct)) / 100));
}

/** What the bump PUT answered, narrowed: the saved product row
 *  (presentProduct shape, bumpConfig + resolved bump included)
 *  and whether the offer is live for buyers right now. Null when
 *  the answer carries no honest product row — the desk then
 *  reports the failure and keeps the list it had. */
export function parseBumpSave(payload: unknown): { product: GrowthProduct; offerLive: boolean } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const product = parseGrowthProduct(p["product"]);
  if (!product) return null;
  return { product, offerLive: p["offerLive"] === true };
}

/** What a product create / price PATCH answered ({ product }),
 *  narrowed the same way. */
export function parseSavedGrowthProduct(payload: unknown): GrowthProduct | null {
  if (!payload || typeof payload !== "object") return null;
  return parseGrowthProduct((payload as { product?: unknown }).product);
}

/** Apply a server-confirmed product row to the list: a known id
 *  is replaced, a new one is prepended (the rail lists newest
 *  first). Local form state never enters the list directly. */
export function applyGrowthProductSave(list: GrowthProduct[], saved: GrowthProduct): GrowthProduct[] {
  if (list.some((p) => p.id === saved.id)) return list.map((p) => (p.id === saved.id ? saved : p));
  return [saved, ...list];
}

/** The one-line truth about a product's add-on designation, in
 *  the desk's order of honesty: no designation → nothing is
 *  offered; a designation whose offer isn't live → attached but
 *  hidden (the target is paused / sold out / gone) for BOTH the
 *  checkout bump and the post-purchase offer; a live offer →
 *  both doors carry it. */
export function addonSummary(
  products: GrowthProduct[],
  p: GrowthProduct,
  strings: BumpStrings = BUMP_STRINGS_EN,
): { designated: boolean; live: boolean; targetTitle: string | null; line: string } {
  if (!p.bumpConfig) {
    return { designated: false, live: false, targetTitle: null, line: strings.summaryNone };
  }
  const target = products.find((q) => q.id === p.bumpConfig!.bumpProductId) ?? null;
  const targetTitle = p.bump?.title ?? target?.title ?? null;
  if (!p.bump) {
    return {
      designated: true,
      live: false,
      targetTitle,
      line: targetTitle
        ? strings.summaryAttachedNamed.replace("{{title}}", targetTitle)
        : strings.summaryAttachedAnon,
    };
  }
  const pctPart = p.bumpConfig.percentOff > 0
    ? strings.summaryLivePct.replace("{{pct}}", String(p.bumpConfig.percentOff))
    : "";
  return {
    designated: true,
    live: true,
    targetTitle: p.bump.title,
    line: strings.summaryLive.replace("{{title}}", p.bump.title).replace("{{pctPart}}", pctPart),
  };
}
