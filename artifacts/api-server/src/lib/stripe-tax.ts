/**
 * stripe-tax.ts — the Stripe Tax integration points for the house
 * payment plumbing, built to the ACTIVATION LINE.
 *
 * Everything here is gated on STRIPE_TAX_ENABLED. With the flag off
 * (the default, and the state this stack ships in), every helper is a
 * no-op: session params come back empty, price_data passes through
 * untouched, and the amounts the verify/webhook rails read are exactly
 * the amounts they read today. Test-mode behavior is therefore
 * unchanged until the owner completes the dashboard/registration
 * steps and flips the flag.
 *
 * What flipping the flag turns on, per rail:
 *   - Checkout Sessions are created with `automatic_tax.enabled` and
 *     `billing_address_collection: "required"` (Stripe Tax cannot
 *     calculate without a customer location).
 *   - price_data line items gain `tax_behavior: "exclusive"` (the US
 *     convention: tax is added on top of the listed price) and a
 *     `product_data.tax_code` from the mapping below.
 *   - Price-ID line items (credit packs, creator tiers, hosting)
 *     carry no per-line tax fields — Stripe reads the tax code and
 *     tax behavior from the Product/Price in the Dashboard, which is
 *     one of the owner's activation steps.
 *   - Verify/webhook amount math reads the session total NET of the
 *     tax Stripe collected (`total_details.amount_tax`), so the 5%
 *     platform fee and creator splits are computed on the sale price,
 *     never on tax the platform must remit. With tax off or zero this
 *     is arithmetically identical to reading `amount_total`.
 *
 * Tax codes are Stripe preset product tax codes (docs.stripe.com/tax/
 * tax-codes), mapped from the site's existing catalog constants —
 * PACK_MAP rails in routes/stripe-payments.ts, TIER_PLANS in
 * lib/platform-fees.ts, DIGITAL_ITEM_KINDS in @workspace/db
 * (lib/db/src/schema/digital-sales.ts) and STORE_PRODUCT_KINDS
 * (lib/db/src/schema/storefront.ts). Every mapped code can be
 * overridden by env without a code change; a malformed override
 * fails closed with a configuration error, in the house style of
 * lib/stripe-client.ts — but only when the flag is on: a typo in an
 * unused override must never break checkout while tax is dark.
 *
 * Exactly-once rails are untouched: no idempotency key, claim, or
 * webhook branch changes here.
 */
import type Stripe from "stripe";

/** The activation flag. Only "1"/"true" (any case) enable tax. */
export function isStripeTaxEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const v = (env["STRIPE_TAX_ENABLED"] ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/**
 * Semantic tax kinds. Each maps to one Stripe preset product tax code
 * (the code ids and names below are Stripe's, verified against the
 * Stripe Tax product-tax-code list) plus one env override slot.
 */
export type StripeTaxKind =
  | "credit-packs"
  | "subscription"
  | "store-audio"
  | "store-video"
  | "store-stream"
  | "store-digital"
  | "electronically-supplied-services"
  | "general-services"
  | "tangible-goods";

const KIND_DEFAULT_CODE: Record<StripeTaxKind, string> = {
  /* Visual Bucs packs are prepaid balance for electronically supplied
     services: txcd_10000000 "General - Electronically Supplied
     Services". */
  "credit-packs": "txcd_10000000",
  /* Creator Pro/Elite + profile hosting are cloud software sold to
     individual creators: txcd_10103000 "Software as a service (SaaS)
     - personal use". */
  subscription: "txcd_10103000",
  /* txcd_10401100 "Digital Audio Works - downloaded - non
     subscription - with permanent rights" (tracks, albums, beats). */
  "store-audio": "txcd_10401100",
  /* txcd_10402100 "Digital Audio Visual Works - downloaded - non
     subscription - with permanent rights" (video downloads). */
  "store-video": "txcd_10402100",
  /* txcd_10402000 "Digital Audio Visual Works - streamed - non
     subscription - with limited rights" (series unlocks are watched,
     not downloaded). */
  "store-stream": "txcd_10402000",
  /* Remaining digital store goods: txcd_10000000 "General -
     Electronically Supplied Services". */
  "store-digital": "txcd_10000000",
  "electronically-supplied-services": "txcd_10000000",
  /* txcd_20030000 "General - Services". Stripe's own guidance for
     event/ticket sales without a more specific code is also this
     one (the specific admission codes require a performance
     location, which a Product-level default cannot carry). */
  "general-services": "txcd_20030000",
  /* txcd_99999999 "General - Tangible Goods" (merch). */
  "tangible-goods": "txcd_99999999",
};

const KIND_ENV_OVERRIDE: Record<StripeTaxKind, string> = {
  "credit-packs": "STRIPE_TAX_CODE_CREDIT_PACKS",
  subscription: "STRIPE_TAX_CODE_SUBSCRIPTION",
  "store-audio": "STRIPE_TAX_CODE_STORE_AUDIO",
  "store-video": "STRIPE_TAX_CODE_STORE_VIDEO",
  "store-stream": "STRIPE_TAX_CODE_STORE_STREAM",
  "store-digital": "STRIPE_TAX_CODE_STORE_DIGITAL",
  "electronically-supplied-services": "STRIPE_TAX_CODE_DEFAULT",
  "general-services": "STRIPE_TAX_CODE_SERVICES",
  "tangible-goods": "STRIPE_TAX_CODE_TANGIBLE",
};

const TAX_CODE_SHAPE = /^txcd_\d{8}$/;

/**
 * Resolve the Stripe product tax code for a kind, honoring the env
 * override. Callers invoke this only on tax-enabled paths; a
 * malformed override is a configuration error and throws, so an
 * activation typo fails loudly at checkout start instead of silently
 * mis-taxing sales.
 */
export function stripeTaxCodeFor(
  kind: StripeTaxKind,
  env: Record<string, string | undefined> = process.env,
): string {
  const envKey = KIND_ENV_OVERRIDE[kind];
  const override = (env[envKey] ?? "").trim();
  if (!override) return KIND_DEFAULT_CODE[kind];
  if (!TAX_CODE_SHAPE.test(override)) {
    throw new Error(
      `${envKey} is not a valid Stripe product tax code (expected txcd_########)`,
    );
  }
  return override;
}

/**
 * The DIGITAL_ITEM_KINDS (lib/db/src/schema/digital-sales.ts) → tax
 * kind map for the /store rail. Every member of the constant is
 * covered; unknown future kinds fall back to the generic digital
 * code rather than escaping tax mapping silently.
 */
export function stripeTaxKindForStoreKind(itemKind: string): StripeTaxKind {
  switch (itemKind) {
    case "track":
    case "album":
      return "store-audio";
    case "video":
      return "store-video";
    case "series":
      return "store-stream";
    default:
      /* "pack", "digital", "bundle", and anything added later. */
      return "store-digital";
  }
}

/**
 * The STORE_PRODUCT_KINDS (lib/db/src/schema/storefront.ts) → tax
 * kind map for creator storefronts. Returns null for kinds that must
 * NOT be taxed at the point of sale: a gift card is taxed when it is
 * redeemed, not when it is bought — taxing the card itself would
 * double-tax the redemption purchase.
 */
export function stripeTaxKindForStorefrontKind(
  productKind: string,
): StripeTaxKind | null {
  switch (productKind) {
    case "gift_card":
      return null;
    case "merch":
      return "tangible-goods";
    case "service":
    case "ticket":
      return "general-services";
    default:
      /* "download", "digital", "course", and anything added later. */
      return "store-digital";
  }
}

/**
 * Session-level Stripe Tax fields for Checkout Session creation.
 * Spread into the create params: with tax disabled this is an empty
 * object and the session is created byte-identically to today.
 */
export function stripeTaxSessionFields(
  env: Record<string, string | undefined> = process.env,
): Pick<
  Stripe.Checkout.SessionCreateParams,
  "automatic_tax" | "billing_address_collection"
> {
  if (!isStripeTaxEnabled(env)) return {};
  return {
    automatic_tax: { enabled: true },
    /* Stripe Tax needs the customer's location to calculate; without
       a required billing address a session can silently compute no
       tax, so activation collects it at checkout. */
    billing_address_collection: "required",
  };
}

type PriceData = NonNullable<
  NonNullable<Stripe.Checkout.SessionCreateParams.LineItem>["price_data"]
>;

/**
 * Apply Stripe Tax fields to one price_data line item. With tax
 * disabled (or a null kind — see gift cards) the object passes
 * through by reference, untouched. When enabled, the line gains
 * `tax_behavior: "exclusive"` (USD convention: listed prices are
 * pre-tax, tax is added on top — the same convention the existing
 * prices were authored under) and the kind's tax code on
 * product_data.
 */
export function applyStripeTaxToPriceData<T extends PriceData>(
  priceData: T,
  kind: StripeTaxKind | null,
  env: Record<string, string | undefined> = process.env,
): T {
  if (!isStripeTaxEnabled(env) || kind === null) return priceData;
  return {
    ...priceData,
    tax_behavior: "exclusive" as const,
    product_data: {
      ...(priceData.product_data ?? { name: "" }),
      tax_code: stripeTaxCodeFor(kind, env),
    },
  };
}

/**
 * The tax Stripe collected inside a completed session, in cents.
 * Absent/zero whenever tax was off, unregistered, or not applicable —
 * which is what makes the net-of-tax reads below no-ops today.
 */
export function sessionTaxCents(
  session: Pick<Stripe.Checkout.Session, "total_details">,
): number {
  const tax = session.total_details?.amount_tax;
  if (typeof tax !== "number" || !Number.isFinite(tax) || tax < 0) return 0;
  return Math.round(tax);
}

/**
 * The session's paid amount EXCLUDING collected tax — the gross the
 * sale splits (platform fee, creator share) must be derived from.
 * `session.amount_total` includes tax whenever Stripe Tax added it
 * on top; with tax off this returns amount_total unchanged (falling
 * back to `fallbackCents` exactly where existing callers fell back
 * to their metadata amount).
 */
export function sessionAmountExcludingTaxCents(
  session: Pick<Stripe.Checkout.Session, "amount_total" | "total_details">,
  fallbackCents?: number,
): number {
  const total = session.amount_total ?? fallbackCents ?? 0;
  return total - sessionTaxCents(session);
}
