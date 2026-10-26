/* Studio Gear — Branding Shop studio-gear line (owner ruling, Oct 25 2026).
   Prices + fulfillment were RULED by owner delegation — use exactly these,
   invent nothing:

     Mic wrap:              Bow Down house $49 / creator-custom $79
     LED neon-flex sign:    24" $249 / 32" $349 / 42" $499 (house same prices)
     LED light panel (RGB, app-controlled): $119 single / $199 pair
     LED light bar:         $79
     The Studio Set bundle: $549 (32" sign + panel pair + light bar)

   FULFILLMENT MODEL (shown on every gear surface):
   - Made-to-order partners only, NO inventory — partner ships direct.
   - Every creator-custom piece gets a design proof the creator approves
     BEFORE production starts. House pieces use the house design (no proof).
   - Honest timelines up front: mic wrap ~7–12 days, signs ~10–15 days,
     panels/bars ~7–10 days (bundle follows its slowest piece).
   - Returns: replacement for defects / misprints. Lights carry a
     12-month electronics warranty, partner-backed.
   - TEST MODE: the gear rail never takes a real charge.

   Pure data + helpers, safe to import in tests. Keep in sync with the
   backend mirror in artifacts/api-server/src/lib/studio-gear.ts — the
   test suites on both sides pin the same ruled prices. */

export type GearVariant = "house" | "custom";
export type GearProductId =
  | "mic-wrap"
  | "neon-sign"
  | "light-panel"
  | "light-bar"
  | "studio-set";

export interface GearOption {
  key: string;
  label: string;
  /** Price in cents for the HOUSE variant. */
  housePriceCents: number;
  /** Price in cents for the CREATOR-CUSTOM variant. */
  customPriceCents: number;
}

export interface StudioGearProduct {
  id: GearProductId;
  label: string;
  blurb: string;
  /** Honest made-to-order timeline, shown up front on the listing. */
  timelineLabel: string;
  timelineMinDays: number;
  timelineMaxDays: number;
  /** True when the 12-month electronics warranty applies (lights). */
  electronicsWarranty: boolean;
  options: GearOption[];
  /** What the bundle contains (studio-set only). */
  includes?: string[];
}

export const STUDIO_GEAR_TEST_MODE = true;

export const STUDIO_GEAR_PRODUCTS: StudioGearProduct[] = [
  {
    id: "mic-wrap",
    label: "Mic Wrap",
    blurb:
      "A fitted wrap for your mic flag — Bow Down house design, or your own artwork printed to spec.",
    timelineLabel: "~7–12 days, made to order",
    timelineMinDays: 7,
    timelineMaxDays: 12,
    electronicsWarranty: false,
    options: [
      { key: "standard", label: "Standard wrap", housePriceCents: 4900, customPriceCents: 7900 },
    ],
  },
  {
    id: "neon-sign",
    label: "Custom LED Neon-Flex Sign",
    blurb:
      "LED neon-flex sign in your size — the Bow Down house sign, or your own text and artwork.",
    timelineLabel: "~10–15 days, made to order",
    timelineMinDays: 10,
    timelineMaxDays: 15,
    electronicsWarranty: true,
    options: [
      { key: "24", label: '24"', housePriceCents: 24900, customPriceCents: 24900 },
      { key: "32", label: '32"', housePriceCents: 34900, customPriceCents: 34900 },
      { key: "42", label: '42"', housePriceCents: 49900, customPriceCents: 49900 },
    ],
  },
  {
    id: "light-panel",
    label: "LED Light Panel",
    blurb: "RGB, app-controlled light panel — house preset look, or your own spec and color profile.",
    timelineLabel: "~7–10 days, made to order",
    timelineMinDays: 7,
    timelineMaxDays: 10,
    electronicsWarranty: true,
    options: [
      { key: "single", label: "Single panel", housePriceCents: 11900, customPriceCents: 11900 },
      { key: "pair", label: "Pair (2 panels)", housePriceCents: 19900, customPriceCents: 19900 },
    ],
  },
  {
    id: "light-bar",
    label: "LED Light Bar",
    blurb: "LED light bar for your desk or stream setup — house look, or your own spec.",
    timelineLabel: "~7–10 days, made to order",
    timelineMinDays: 7,
    timelineMaxDays: 10,
    electronicsWarranty: true,
    options: [
      { key: "standard", label: "Light bar", housePriceCents: 7900, customPriceCents: 7900 },
    ],
  },
  {
    id: "studio-set",
    label: "The Studio Set",
    blurb: "The whole setup in one order — sign, panels, and light bar, matched as a set.",
    timelineLabel: "~10–15 days, made to order (follows the sign)",
    timelineMinDays: 10,
    timelineMaxDays: 15,
    electronicsWarranty: true,
    includes: ['32" LED neon-flex sign', "LED light panel — pair", "LED light bar"],
    options: [
      { key: "set", label: "Complete set", housePriceCents: 54900, customPriceCents: 54900 },
    ],
  },
];

/** À-la-carte total of what the Studio Set bundles (32" sign 349 + panel
    pair 199 + light bar 79 = $627) — the bundle's $78 saving is arithmetic
    from the ruled prices, never an invented discount. */
export const STUDIO_SET_ALACARTE_CENTS = 34900 + 19900 + 7900;
export const STUDIO_SET_SAVING_CENTS = STUDIO_SET_ALACARTE_CENTS - 54900;

export const STUDIO_GEAR_FULFILLMENT = {
  model: "Made to order — no inventory. A partner makes your piece and ships it direct to you.",
  proofRule:
    "Every creator-custom piece gets a design proof first. Production starts only after you approve the proof — never before.",
  returnsRule:
    "Defect or misprint? The partner replaces it. Lights carry a 12-month electronics warranty, partner-backed.",
  testModeNote: "Test mode — checkout is simulated and no real charge is taken.",
} as const;

/* Order + proof lifecycle. Custom orders wait on the proof gate; house
   orders skip straight to production once the (test-mode) checkout lands. */
export const STUDIO_GEAR_ORDER_STATUSES = [
  "received",
  "proof_pending",
  "proof_sent",
  "in_production",
  "shipped",
  "delivered",
  "canceled",
] as const;
export type StudioGearOrderStatus = (typeof STUDIO_GEAR_ORDER_STATUSES)[number];

export const STUDIO_GEAR_PROOF_STATUSES = [
  "not_required",
  "pending",
  "sent",
  "approved",
  "revision_requested",
] as const;
export type StudioGearProofStatus = (typeof STUDIO_GEAR_PROOF_STATUSES)[number];

export function gearProductById(id: GearProductId): StudioGearProduct {
  const p = STUDIO_GEAR_PRODUCTS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown studio gear product: ${id}`);
  return p;
}

export function gearOption(product: StudioGearProduct, optionKey: string): GearOption {
  const o = product.options.find((x) => x.key === optionKey);
  if (!o) throw new Error(`Unknown option "${optionKey}" for ${product.id}`);
  return o;
}

/** Ruled price for one unit of a selection, in cents. */
export function gearPriceCents(
  productId: GearProductId,
  variant: GearVariant,
  optionKey: string,
): number {
  const option = gearOption(gearProductById(productId), optionKey);
  return variant === "custom" ? option.customPriceCents : option.housePriceCents;
}

/** A creator-custom piece ALWAYS goes through the design-proof gate. */
export function gearProofRequired(variant: GearVariant): boolean {
  return variant === "custom";
}

export interface GearSelection {
  product: GearProductId;
  variant: GearVariant;
  option: string;
  qty: number;
}

/** Server-style validation shared by the UI: returns an error string or null. */
export function validateGearSelection(sel: GearSelection): string | null {
  let product: StudioGearProduct;
  try {
    product = gearProductById(sel.product);
  } catch {
    return `Unknown studio gear product: ${sel.product}`;
  }
  if (sel.variant !== "house" && sel.variant !== "custom") {
    return `Unknown variant: ${sel.variant}`;
  }
  if (!product.options.some((o) => o.key === sel.option)) {
    return `Unknown option "${sel.option}" for ${product.id}.`;
  }
  if (!Number.isInteger(sel.qty) || sel.qty < 1 || sel.qty > 99) {
    return "Quantity must be between 1 and 99.";
  }
  return null;
}

export function gearCartTotalCents(items: GearSelection[]): number {
  return items.reduce(
    (n, i) => n + gearPriceCents(i.product, i.variant, i.option) * i.qty,
    0,
  );
}

/** Initial order + proof status for a fresh order's items. Any custom item
    holds the whole order at the proof gate. */
export function initialGearOrderState(items: GearSelection[]): {
  status: StudioGearOrderStatus;
  proofStatus: StudioGearProofStatus;
} {
  const needsProof = items.some((i) => gearProofRequired(i.variant));
  return needsProof
    ? { status: "proof_pending", proofStatus: "pending" }
    : { status: "received", proofStatus: "not_required" };
}

/** Proof state machine: which proof transitions a buyer may make. */
export function canTransitionProof(
  from: StudioGearProofStatus,
  to: StudioGearProofStatus,
): boolean {
  const allowed: Record<StudioGearProofStatus, StudioGearProofStatus[]> = {
    not_required: [],
    pending: ["sent"],
    sent: ["approved", "revision_requested"],
    approved: [],
    revision_requested: ["sent"],
  };
  return allowed[from].includes(to);
}

export function formatGearMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
