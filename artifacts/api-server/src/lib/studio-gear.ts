/* Studio Gear — Branding Shop studio-gear line (owner ruling, Oct 25 2026).
   Server mirror of artifacts/bow-down-visuals/src/lib/studio-gear.ts.
   Prices + fulfillment were RULED by owner delegation — use exactly these,
   invent nothing:

     Mic wrap:              Bow Down house $49 / creator-custom $79
     LED neon-flex sign:    24" $249 / 32" $349 / 42" $499 (house same prices)
     LED light panel (RGB, app-controlled): $119 single / $199 pair
     LED light bar:         $79
     The Studio Set bundle: $549 (32" sign + panel pair + light bar)

   FULFILLMENT MODEL:
   - Made-to-order partners only, NO inventory — partner ships direct.
   - Every creator-custom piece gets a design proof the creator approves
     BEFORE production starts. House pieces use the house design (no proof).
   - Timelines: mic wrap ~7–12 days, signs ~10–15 days, panels/bars ~7–10.
   - Returns: replacement for defects / misprints; 12-month electronics
     warranty on lights, partner-backed.
   - TEST MODE: this rail NEVER creates a real charge. There is no Stripe
     call anywhere in the studio-gear routes — checkout is a labeled test
     completion only.

   Pure data + helpers (no DB, no provider calls) so the rail's tests can
   pin every ruled price and the proof state machine directly. */

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
  housePriceCents: number;
  customPriceCents: number;
}

export interface StudioGearProduct {
  id: GearProductId;
  label: string;
  blurb: string;
  timelineLabel: string;
  timelineMinDays: number;
  timelineMaxDays: number;
  electronicsWarranty: boolean;
  options: GearOption[];
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

export function gearPriceCents(
  productId: GearProductId,
  variant: GearVariant,
  optionKey: string,
): number {
  const option = gearOption(gearProductById(productId), optionKey);
  return variant === "custom" ? option.customPriceCents : option.housePriceCents;
}

export function gearProofRequired(variant: GearVariant): boolean {
  return variant === "custom";
}

export interface GearSelection {
  product: GearProductId;
  variant: GearVariant;
  option: string;
  qty: number;
}

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

export function initialGearOrderState(items: GearSelection[]): {
  status: StudioGearOrderStatus;
  proofStatus: StudioGearProofStatus;
} {
  const needsProof = items.some((i) => gearProofRequired(i.variant));
  return needsProof
    ? { status: "proof_pending", proofStatus: "pending" }
    : { status: "received", proofStatus: "not_required" };
}

/* Proof state machine. Production is reachable ONLY from proofStatus
   "approved" (custom) or "not_required" (house) — see orderStatusAfterProof
   and the checkout handler in routes/studio-gear.ts. */
const PROOF_TRANSITIONS: Record<StudioGearProofStatus, StudioGearProofStatus[]> = {
  not_required: [],
  pending: ["sent"],
  sent: ["approved", "revision_requested"],
  approved: [],
  revision_requested: ["sent"],
};

export function canTransitionProof(
  from: StudioGearProofStatus,
  to: StudioGearProofStatus,
): boolean {
  return PROOF_TRANSITIONS[from].includes(to);
}

/** Production may start only when no proof is outstanding: either the
    order never needed one (all-house) or the creator approved it. */
export function productionAllowed(proofStatus: StudioGearProofStatus): boolean {
  return proofStatus === "not_required" || proofStatus === "approved";
}

/** The order status implied by payment + proof state. Production
    requires BOTH: paid AND productionAllowed(proofStatus). */
export function gearOrderStatusFor(
  paid: boolean,
  proofStatus: StudioGearProofStatus,
): StudioGearOrderStatus {
  switch (proofStatus) {
    case "pending":
    case "revision_requested":
      return "proof_pending";
    case "sent":
      return "proof_sent";
    case "approved":
    case "not_required":
      return paid ? "in_production" : "received";
  }
}

/** The order status that follows a proof decision. */
export function orderStatusAfterProof(
  proofStatus: StudioGearProofStatus,
): StudioGearOrderStatus {
  switch (proofStatus) {
    case "approved":
      return "in_production";
    case "sent":
      return "proof_sent";
    case "revision_requested":
      return "proof_pending";
    case "pending":
      return "proof_pending";
    case "not_required":
      return "received";
  }
}
