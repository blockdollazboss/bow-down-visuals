/* admin-benches.ts — pure seams for the three /admin benches that
   stack1100 Lane X1 docks onto rails that previously had NO frontend
   consumer (W6 finding F1):
     - Payment Reversals  GET /api/admin/payment-reversals
     - Operator Actions   GET /api/admin/operator-actions
     - Studio Gear queue  GET /api/admin/studio-gear/orders (+ relays)
   The parsers are strict in the house idiom: a malformed answer is a
   FAILED read (null → the bench's error state), never a painted-empty
   queue. Gear action availability mirrors the server rail's own state
   machines (routes/studio-gear.ts + lib/studio-gear.ts) through the
   FE mirror in lib/studio-gear.ts — the bench never offers a move the
   rail would refuse, and says why when a move is blocked. */
import {
  canTransitionGearStatus,
  canTransitionProof,
  gearOrderIsTerminal,
  type StudioGearOrderStatus,
  type StudioGearProofStatus,
} from "./studio-gear";

/* ─── shared bits ──────────────────────────────────────────────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function strOr(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function numOr(v: unknown, fallback: number): number {
  const n = num(v);
  return n === null ? fallback : n;
}

/** "$12.34" from cents — figures render from rail data, never copy. */
export function formatUsdCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Compact queue age: whole minutes / hours / days since an ISO stamp. */
export function ageParts(
  iso: string,
  now: number,
): { value: number; unit: "minute" | "hour" | "day" } | null {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const mins = Math.max(0, Math.floor((now - at) / 60000));
  if (mins < 60) return { value: mins, unit: "minute" };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { value: hours, unit: "hour" };
  return { value: Math.floor(hours / 24), unit: "day" };
}

/** First 8 chars of an id, the ContentReportsInbox shortId idiom. */
export function shortId(id: string | null): string | null {
  return id ? `${id.slice(0, 8)}…` : null;
}

/* ─── Payment Reversals ──────────────────────────────────────────────
   Row shape = routes/admin.ts GET /admin/payment-reversals (the
   listPaymentReversals projection). Statuses are the reversal
   engine's own literals (lib/payment-reversals.ts): a row starts at
   'processing', lands at 'completed' or 'partial_shortfall', or is
   parked at 'needs_manual_review'. A parked row is resolved through
   the rail's own verb (POST /admin/payment-reversals/:id/resolve —
   stack1100 Y2): 'complete' runs the engine's completion path and
   the row lands at 'completed'; 'dismiss' lands it at 'dismissed'
   with no money moved. Either way the decision rides the row as
   `resolution` (who, when, which way, the note). */

export const REVERSAL_STATUSES = [
  "needs_manual_review",
  "processing",
  "completed",
  "partial_shortfall",
  "dismissed",
] as const;
type ReversalStatus = (typeof REVERSAL_STATUSES)[number];

export type ReversalFilter = "all" | ReversalStatus;
export const REVERSAL_FILTERS: ReversalFilter[] = [
  "all",
  "needs_manual_review",
  "completed",
  "partial_shortfall",
  "dismissed",
  "processing",
];

/** The human decision on a resolved row (payment_reversal_resolutions
    via the rail's projection). */
interface ReversalResolution {
  decision: string;
  adminEmail: string | null;
  note: string;
  resolvedAt: string | null;
}

export interface PaymentReversalRow {
  id: string;
  stripeEventId: string | null;
  stripeChargeId: string | null;
  stripePaymentIntentId: string | null;
  trigger: string;
  rail: string;
  userId: string | null;
  sessionId: string | null;
  grantedCredits: number;
  creditsClawed: number;
  referralCreditsClawed: number;
  refundedCentsSeen: number;
  chargeAmountCents: number;
  disputeLost: boolean;
  entitlementRevoked: boolean;
  sellerReversed: boolean;
  shortfallCredits: number;
  status: string;
  /** details.manualReason — why the engine parked the row. */
  manualReason: string | null;
  /** The recorded human decision, once the row has been resolved. */
  resolution: ReversalResolution | null;
  createdAt: string;
  updatedAt: string | null;
}

function parseReversalRow(v: unknown): PaymentReversalRow | null {
  if (!isRecord(v)) return null;
  const id = str(v["id"]);
  const status = str(v["status"]);
  const createdAt = str(v["createdAt"]);
  if (!id || !status || !createdAt) return null;
  let manualReason: string | null = null;
  const details = v["details"];
  if (isRecord(details)) manualReason = str(details["manualReason"]);
  else if (typeof details === "string") {
    try {
      const parsed: unknown = JSON.parse(details);
      if (isRecord(parsed)) manualReason = str(parsed["manualReason"]);
    } catch {
      manualReason = null;
    }
  }
  let resolution: ReversalResolution | null = null;
  const rawResolution = v["resolution"];
  if (rawResolution !== undefined && rawResolution !== null) {
    if (!isRecord(rawResolution)) return null;
    resolution = {
      decision: strOr(rawResolution["decision"], ""),
      adminEmail: str(rawResolution["adminEmail"]),
      note: strOr(rawResolution["note"], ""),
      resolvedAt: str(rawResolution["resolvedAt"]),
    };
  }
  return {
    id,
    stripeEventId: str(v["stripeEventId"]),
    stripeChargeId: str(v["stripeChargeId"]),
    stripePaymentIntentId: str(v["stripePaymentIntentId"]),
    trigger: strOr(v["trigger"], ""),
    rail: strOr(v["rail"], ""),
    userId: str(v["userId"]),
    sessionId: str(v["sessionId"]),
    grantedCredits: numOr(v["grantedCredits"], 0),
    creditsClawed: numOr(v["creditsClawed"], 0),
    referralCreditsClawed: numOr(v["referralCreditsClawed"], 0),
    refundedCentsSeen: numOr(v["refundedCentsSeen"], 0),
    chargeAmountCents: numOr(v["chargeAmountCents"], 0),
    disputeLost: v["disputeLost"] === true,
    entitlementRevoked: v["entitlementRevoked"] === true,
    sellerReversed: v["sellerReversed"] === true,
    shortfallCredits: numOr(v["shortfallCredits"], 0),
    status,
    manualReason,
    resolution,
    createdAt,
    updatedAt: str(v["updatedAt"]),
  };
}

/** { reversals: [...] } or a failed read (null). */
export function parsePaymentReversals(json: unknown): PaymentReversalRow[] | null {
  if (!isRecord(json) || !Array.isArray(json["reversals"])) return null;
  const rows: PaymentReversalRow[] = [];
  for (const raw of json["reversals"]) {
    const row = parseReversalRow(raw);
    if (!row) return null;
    rows.push(row);
  }
  return rows;
}

export function filterReversals(
  rows: PaymentReversalRow[],
  filter: ReversalFilter,
): PaymentReversalRow[] {
  if (filter === "all") return rows;
  return rows.filter((r) => r.status === filter);
}

export function countNeedsManualReview(rows: PaymentReversalRow[]): number {
  return rows.filter((r) => r.status === "needs_manual_review").length;
}

/* ─── Operator Actions ───────────────────────────────────────────────
   Response shape = routes/admin.ts GET /admin/operator-actions:
   { dailyChargedCap, handsEnabled, actions: [...] }. Results are the
   executor's own literals: "done" | "refused" | "failed". Read-only
   audit surface — no controls, ever. */

const OPERATOR_RESULTS = ["done", "refused", "failed"] as const;
type OperatorResult = (typeof OPERATOR_RESULTS)[number];
export type OperatorResultFilter = "all" | OperatorResult;
export const OPERATOR_RESULT_FILTERS: OperatorResultFilter[] = [
  "all",
  "done",
  "refused",
  "failed",
];

export interface OperatorActionRow {
  id: string;
  userId: string | null;
  adminEmail: string | null;
  tier: string | null;
  toolId: string;
  summary: string;
  target: string | null;
  channel: string | null;
  priceQuoted: number | null;
  priceCharged: number | null;
  result: string;
  resultReason: string | null;
  createdAt: string;
}

interface OperatorActionsRead {
  dailyChargedCap: number;
  handsEnabled: boolean;
  actions: OperatorActionRow[];
}

function parseOperatorActionRow(v: unknown): OperatorActionRow | null {
  if (!isRecord(v)) return null;
  const id = str(v["id"]);
  const createdAt = str(v["createdAt"]);
  if (!id || !createdAt) return null;
  return {
    id,
    userId: str(v["userId"]),
    adminEmail: str(v["adminEmail"]),
    tier: str(v["tier"]),
    toolId: strOr(v["toolId"], ""),
    summary: strOr(v["summary"], ""),
    target: str(v["target"]),
    channel: str(v["channel"]),
    priceQuoted: num(v["priceQuoted"]),
    priceCharged: num(v["priceCharged"]),
    result: strOr(v["result"], ""),
    resultReason: str(v["resultReason"]),
    createdAt,
  };
}

export function parseOperatorActions(json: unknown): OperatorActionsRead | null {
  if (!isRecord(json) || !Array.isArray(json["actions"])) return null;
  const cap = num(json["dailyChargedCap"]);
  if (cap === null || typeof json["handsEnabled"] !== "boolean") return null;
  const actions: OperatorActionRow[] = [];
  for (const raw of json["actions"]) {
    const row = parseOperatorActionRow(raw);
    if (!row) return null;
    actions.push(row);
  }
  return { dailyChargedCap: cap, handsEnabled: json["handsEnabled"], actions };
}

export function filterOperatorActions(
  rows: OperatorActionRow[],
  filter: OperatorResultFilter,
): OperatorActionRow[] {
  if (filter === "all") return rows;
  return rows.filter((r) => r.result === filter);
}

/* ─── Studio Gear relay queue ────────────────────────────────────────
   Row shape = routes/studio-gear.ts presentOrder + the admin GET's
   buyer block. Actions are the rail's own relays:
     POST /admin/studio-gear/orders/:id/proof/send  { proofUrl, proofNote }
     POST /admin/studio-gear/orders/:id/status      { status }
   Availability mirrors the rail exactly (terminal orders never move;
   proof sends only from pending / revision_requested; fulfillment
   only along ORDER_TRANSITIONS; shipping additionally requires paid
   AND a settled proof — the route's defense-in-depth gate). */

interface GearAdminItem {
  product: string;
  variant: string;
  option: string;
  qty: number;
  unitPriceCents: number;
  customText: string | null;
  specNotes: string | null;
  artworkUrl: string | null;
}

export interface GearAdminOrder {
  id: string;
  items: GearAdminItem[];
  totalCents: number;
  status: string;
  proofStatus: string;
  proofUrl: string | null;
  proofNote: string | null;
  paid: boolean;
  testMode: boolean;
  createdAt: string;
  buyer: {
    name: string;
    email: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  };
}

interface GearAdminRead {
  testMode: boolean;
  orders: GearAdminOrder[];
}

function parseGearItem(v: unknown): GearAdminItem | null {
  if (!isRecord(v)) return null;
  const product = str(v["product"]);
  if (!product) return null;
  return {
    product,
    variant: strOr(v["variant"], ""),
    option: strOr(v["option"], ""),
    qty: numOr(v["qty"], 0),
    unitPriceCents: numOr(v["unitPriceCents"], 0),
    customText: str(v["customText"]),
    specNotes: str(v["specNotes"]),
    artworkUrl: str(v["artworkUrl"]),
  };
}

function parseGearOrder(v: unknown): GearAdminOrder | null {
  if (!isRecord(v)) return null;
  const id = str(v["id"]);
  const status = str(v["status"]);
  const proofStatus = str(v["proofStatus"]);
  const createdAt = str(v["createdAt"]);
  if (!id || !status || !proofStatus || !createdAt) return null;
  if (!Array.isArray(v["items"])) return null;
  const items: GearAdminItem[] = [];
  for (const raw of v["items"]) {
    const item = parseGearItem(raw);
    if (!item) return null;
    items.push(item);
  }
  const buyer = v["buyer"];
  if (!isRecord(buyer)) return null;
  return {
    id,
    items,
    totalCents: numOr(v["totalCents"], 0),
    status,
    proofStatus,
    proofUrl: str(v["proofUrl"]),
    proofNote: str(v["proofNote"]),
    paid: v["paid"] === true,
    testMode: v["testMode"] === true,
    createdAt,
    buyer: {
      name: strOr(buyer["name"], ""),
      email: strOr(buyer["email"], ""),
      address: strOr(buyer["address"], ""),
      city: strOr(buyer["city"], ""),
      state: strOr(buyer["state"], ""),
      zip: strOr(buyer["zip"], ""),
    },
  };
}

export function parseGearAdminOrders(json: unknown): GearAdminRead | null {
  if (!isRecord(json) || !Array.isArray(json["orders"])) return null;
  const orders: GearAdminOrder[] = [];
  for (const raw of json["orders"]) {
    const order = parseGearOrder(raw);
    if (!order) return null;
    orders.push(order);
  }
  return { testMode: json["testMode"] === true, orders };
}

export const GEAR_FILTERS = [
  "all",
  "received",
  "proof_pending",
  "proof_sent",
  "in_production",
  "shipped",
  "delivered",
  "canceled",
] as const;
export type GearFilter = (typeof GEAR_FILTERS)[number];

export function filterGearOrders(orders: GearAdminOrder[], filter: GearFilter): GearAdminOrder[] {
  if (filter === "all") return orders;
  return orders.filter((o) => o.status === filter);
}

/** Orders still waiting on the team: a proof to relay or a fulfillment
    move available. Terminal orders never count. */
export function gearNeedsTeam(order: GearAdminOrder): boolean {
  return gearProofSendAvailable(order) || gearFulfillmentActions(order).length > 0;
}

/** The proof relay is offered exactly when the rail would accept it:
    proof pending or revision requested, and the order not terminal. */
export function gearProofSendAvailable(order: GearAdminOrder): boolean {
  if (gearOrderIsTerminal(order.status as StudioGearOrderStatus)) return false;
  return canTransitionProof(order.proofStatus as StudioGearProofStatus, "sent");
}

const GEAR_FULFILLMENT_STATUSES = ["shipped", "delivered", "canceled"] as const;
export type GearFulfillmentStatus = (typeof GEAR_FULFILLMENT_STATUSES)[number];

/** Fulfillment moves the rail would accept from this order's status. */
export function gearFulfillmentActions(order: GearAdminOrder): GearFulfillmentStatus[] {
  return GEAR_FULFILLMENT_STATUSES.filter((next) =>
    canTransitionGearStatus(order.status as StudioGearOrderStatus, next),
  );
}

/** Why shipping is blocked, in the rail's own order of checks — null
    when the ship move is fully open. Mirrors the route: the move must
    exist (from in_production), then paid AND proof settled. */
export function gearShipBlock(order: GearAdminOrder): "not_in_production" | "unpaid" | "proof_open" | null {
  if (!canTransitionGearStatus(order.status as StudioGearOrderStatus, "shipped")) {
    return "not_in_production";
  }
  if (!order.paid) return "unpaid";
  if (order.proofStatus !== "approved" && order.proofStatus !== "not_required") return "proof_open";
  return null;
}
