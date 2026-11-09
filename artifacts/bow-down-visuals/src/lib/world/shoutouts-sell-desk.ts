/* ─── Shoutouts SELL-side desk seam (stack1500 world parity wave 4c) ──
   The creator's half of Fan Shoutouts, native at the Marketplace
   square beside the wave-4b buy-side desk, on the shoutouts router's
   own rails — the same endpoints pages/shoutouts.tsx's Creator
   Dashboard tab calls:

     GET   /api/shoutouts/requests            → the creator's inbox
                                                (optional ?status=
                                                filter; the rail only
                                                honors its five
                                                REQUEST_STATUSES)
     PATCH /api/shoutouts/requests/:id        → { status,
                                                deliveryUrl } on the
                                                rail's transition map:
                                                pending_payment →
                                                accepted | declined;
                                                accepted → in_progress
                                                | declined; in_progress
                                                → delivered | declined;
                                                delivered / declined /
                                                refunded are terminal
     GET   /api/shoutouts/revenue             → counts + gross / net
                                                from real requests;
                                                net is the rail's own
                                                netAfterFee at the
                                                flat 5% platform fee
     POST  /api/shoutouts/ai-message          → polish a message into
                                                words that read well
                                                out loud: 100 Visual
                                                Bucs (registry-pinned
                                                in lib/credit-costs.ts;
                                                charge-before-generate,
                                                the rail refunds a
                                                provider failure)
     The shared clip door (lib/clip-upload)  → the delivery-video
                                                upload the 2D page
                                                uses (≤ 80 MB page-side
                                                cap); the answer's ref
                                                (or url) is then PATCHed
                                                onto the request as
                                                its delivery

   DECLINE + REFUND — the rail's settled behavior (owner ruling,
   stack1400 #15, implemented in routes/generate/shoutouts.ts):
   declining a PAID request (paid_at recorded by the settle flip,
   price > 0) refunds the fan IN FULL, automatically, as part of
   the decline — the request lands in the terminal "refunded"
   status and the fan's email states the full refund. Declining an
   unpaid or free request moves it to "declined" and its email says
   nothing about money. If the refund itself fails, the rail
   answers 502 and the decline does NOT land — the request keeps
   its pre-decline status so the creator can retry. This desk
   states that consequence BEFORE the decline tap (a two-tap arm
   naming the exact refund), and phrases every outcome from the
   rail's answer — it never invents a refund path of its own.

   Every sell rail is requireAuth — members only, exactly the 2D
   page's boundary (its creator tab sits behind sign-in too).

   Parsers are strict the house way: a broken or incomplete rail
   answer reads as a failed read (null), never painted-over content
   — a failed inbox read is an error state with a retry, never an
   empty inbox. */

import { getCreditCost } from "../credit-costs";

/** Registry cost for an endpoint; throws if unregistered so a desk
 *  can never silently show (or charge against) an invented price. */
function registryCost(endpoint: string): number {
  const entry = getCreditCost(endpoint);
  if (!entry) throw new Error(`No registered credit cost for ${endpoint}`);
  return entry.cost;
}

export const SHOUTOUT_REQUESTS_PATH = "/api/shoutouts/requests";
export const SHOUTOUT_REVENUE_PATH = "/api/shoutouts/revenue";
export const SHOUTOUT_AI_MESSAGE_PATH = "/api/shoutouts/ai-message";

export function shoutoutRequestPath(id: string): string {
  return `${SHOUTOUT_REQUESTS_PATH}/${encodeURIComponent(id)}`;
}

/** The inbox read, with the rail's status filter when one is
 *  picked (the rail ignores a status outside its five). */
export function shoutoutRequestsPath(statusFilter: string): string {
  return statusFilter
    ? `${SHOUTOUT_REQUESTS_PATH}?status=${encodeURIComponent(statusFilter)}`
    : SHOUTOUT_REQUESTS_PATH;
}

/** Registry-pinned price (lib/credit-costs.ts:
 *  "/api/shoutouts/ai-message": { cost: 100, feature: "Shoutout Message" } —
 *  the same 100 the server's SHOUTOUT_AI_CREDITS defaults to). */
export const SHOUTOUT_AI_MESSAGE_COST_VB = registryCost(SHOUTOUT_AI_MESSAGE_PATH);
export const SHOUTOUT_AI_MESSAGE_FEATURE = "Shoutout Message";

/** The platform fee on shoutouts — FLAT 5% everywhere (owner ruling
 *  2026-10-27). The revenue rail returns its own platformFeePct and
 *  the desk displays THAT figure; this constant pins the ruled
 *  default (the route's `|| 5`) for the desk's fallback copy. */
export const SHOUTOUT_PLATFORM_FEE_PCT = 5;

/* ─── Statuses + the rail's transition map ───────────────────────── */

export type ShoutoutSellStatus =
  | "pending_payment"
  | "accepted"
  | "in_progress"
  | "delivered"
  | "declined"
  | "refunded";

/** The five statuses the rail's filter + PATCH schema speak.
 *  "refunded" is real (a paid decline lands there, and the clawback
 *  engine writes it too) but is never a filter or a PATCH target. */
export const SHOUTOUT_FILTER_STATUSES: ReadonlyArray<{
  id: Exclude<ShoutoutSellStatus, "refunded">;
  labelKey: string;
}> = [
  { id: "pending_payment", labelKey: "shoutouts.statusAwaitingPayment" },
  { id: "accepted", labelKey: "shoutouts.statusAccepted" },
  { id: "in_progress", labelKey: "shoutouts.statusRecording" },
  { id: "delivered", labelKey: "shoutouts.statusDelivered" },
  { id: "declined", labelKey: "shoutouts.statusDeclined" },
];

const TRANSITIONS: Record<ShoutoutSellStatus, ShoutoutSellStatus[]> = {
  pending_payment: ["accepted", "declined"],
  accepted: ["in_progress", "declined"],
  in_progress: ["delivered", "declined"],
  delivered: [],
  declined: [],
  refunded: [],
};

export function canShoutoutTransition(from: string, to: ShoutoutSellStatus): boolean {
  return TRANSITIONS[from as ShoutoutSellStatus]?.includes(to) ?? false;
}

export function isShoutoutTerminal(status: string): boolean {
  return (TRANSITIONS[status as ShoutoutSellStatus]?.length ?? 0) === 0;
}

/** The verbs the desk offers on a request, from the rail's map —
 *  a terminal request gets none, never a button the rail would 409. */
export type ShoutoutSellAction = "accept" | "start" | "deliver" | "decline";

export function shoutoutActionsFor(status: string): ShoutoutSellAction[] {
  const out: ShoutoutSellAction[] = [];
  if (canShoutoutTransition(status, "accepted")) out.push("accept");
  if (canShoutoutTransition(status, "in_progress")) out.push("start");
  if (canShoutoutTransition(status, "delivered")) out.push("deliver");
  if (canShoutoutTransition(status, "declined")) out.push("decline");
  return out;
}

/* ─── Shapes ─────────────────────────────────────────────────────── */

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export interface ShoutoutSellRequest {
  id: string;
  fanName: string;
  fanEmail: string;
  occasion: string;
  message: string;
  status: string;
  priceCents: number;
  priceDollars: number;
  deliveryUrl: string;
  /** Set by the rail's settle flip when the fan's payment landed —
   *  the client-visible half of the rail's paid test. */
  paidAt: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

function normalizeRequestRow(r: Record<string, unknown>): ShoutoutSellRequest | null {
  const id = str(r["id"]);
  const status = str(r["status"]);
  if (!id || !status) return null;
  return {
    id,
    fanName: str(r["fanName"]),
    fanEmail: str(r["fanEmail"]),
    occasion: str(r["occasion"]),
    message: str(r["message"]),
    status,
    priceCents: num(r["priceCents"]),
    priceDollars: num(r["priceDollars"]),
    deliveryUrl: str(r["deliveryUrl"]),
    paidAt: strOrNull(r["paidAt"]),
    createdAt: str(r["createdAt"]),
    deliveredAt: strOrNull(r["deliveredAt"]),
  };
}

export function normalizeShoutoutRequests(payload: unknown): ShoutoutSellRequest[] | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root["requests"])) return null;
  const out: ShoutoutSellRequest[] = [];
  for (const raw of root["requests"]) {
    const r = asRecord(raw);
    if (!r) return null;
    const row = normalizeRequestRow(r);
    if (!row) return null;
    out.push(row);
  }
  return out;
}

/** A PATCH answer: { request }. A decline that landed on a paid
 *  request answers with the request in its "refunded" status. */
export function normalizeShoutoutRequest(payload: unknown): ShoutoutSellRequest | null {
  const root = asRecord(payload);
  if (!root) return null;
  const r = asRecord(root["request"]);
  if (!r) return null;
  return normalizeRequestRow(r);
}

export interface ShoutoutRevenue {
  total: number;
  pendingPayment: number;
  accepted: number;
  inProgress: number;
  delivered: number;
  declined: number;
  grossCents: number;
  netCents: number;
  /** The rail's own fee figure — the desk displays this, verbatim. */
  platformFeePct: number;
  paymentsLive: boolean;
}

export function normalizeShoutoutRevenue(payload: unknown): ShoutoutRevenue | null {
  const root = asRecord(payload);
  if (!root) return null;
  /* A revenue answer without the rail's own money figures is not a
     revenue answer — the desk never fills money in from defaults. */
  if (
    typeof root["total"] !== "number" ||
    typeof root["grossCents"] !== "number" ||
    typeof root["netCents"] !== "number"
  ) {
    return null;
  }
  return {
    total: num(root["total"]),
    pendingPayment: num(root["pendingPayment"]),
    accepted: num(root["accepted"]),
    inProgress: num(root["inProgress"]),
    delivered: num(root["delivered"]),
    declined: num(root["declined"]),
    grossCents: num(root["grossCents"]),
    netCents: num(root["netCents"]),
    platformFeePct:
      typeof root["platformFeePct"] === "number" ? root["platformFeePct"] : SHOUTOUT_PLATFORM_FEE_PCT,
    paymentsLive: root["paymentsLive"] === true,
  };
}

/* ─── Paid truth + the decline consequence ───────────────────────── */

/** Mirrors the rail's isPaidShoutoutRequest as far as the read
 *  model lets a client see: the settle flip recorded the payment
 *  (paidAt) on a priced request. (The rail also holds the checkout
 *  session id, which the read model never exposes — the server
 *  re-decides on the PATCH either way; this only phrases the
 *  warning before the tap.) */
export function isPaidShoutout(req: ShoutoutSellRequest): boolean {
  return req.paidAt != null && req.priceCents > 0;
}

export type ShoutoutDeclineConsequence =
  | { kind: "refund"; amountCents: number }
  | { kind: "no-payment" };

/** What declining THIS request does to the fan's money, per the
 *  rail's settled decline behavior — stated before the tap. */
export function shoutoutDeclineConsequence(req: ShoutoutSellRequest): ShoutoutDeclineConsequence {
  return isPaidShoutout(req)
    ? { kind: "refund", amountCents: req.priceCents }
    : { kind: "no-payment" };
}

/* ─── Bodies ─────────────────────────────────────────────────────── */

/** The 2D page's PATCH body shape: the target status plus the
 *  delivery URL field ("" when there is none to attach). */
export function buildShoutoutStatusBody(
  status: ShoutoutSellStatus,
  deliveryUrl = "",
): Record<string, unknown> {
  return { status, deliveryUrl };
}

/** The AI helper's body — the rail's schema: occasion 1–120,
 *  notes ≤600, creatorName ≤60 (optional). */
export function buildShoutoutAiMessageBody(args: {
  occasion: string;
  notes: string;
  creatorName?: string;
}): Record<string, unknown> {
  return {
    occasion: args.occasion.trim(),
    notes: args.notes.trim(),
    ...(args.creatorName?.trim() ? { creatorName: args.creatorName.trim() } : {}),
  };
}

export function shoutoutAiMessageReady(args: { occasion: string; notes: string }): boolean {
  const occasion = args.occasion.trim();
  return occasion.length >= 1 && occasion.length <= 120 && args.notes.length <= 600;
}

export interface ShoutoutAiDraft {
  message: string;
  creditsUsed: number;
  creditsRemaining: number;
}

export function normalizeShoutoutAiDraft(payload: unknown): ShoutoutAiDraft | null {
  const root = asRecord(payload);
  if (!root) return null;
  const message = str(root["message"]);
  if (!message) return null;
  return {
    message,
    creditsUsed: num(root["creditsUsed"]),
    creditsRemaining: num(root["creditsRemaining"]),
  };
}

/* ─── Delivery upload (the page's rail) ──────────────────────────── */

/** The 2D page's own cap: a delivery video over 80 MB is refused
 *  before the upload starts. */
export const SHOUTOUT_DELIVERY_MAX_BYTES = 80 * 1024 * 1024;

export function shoutoutDeliveryFileReady(sizeBytes: number): boolean {
  return sizeBytes > 0 && sizeBytes <= SHOUTOUT_DELIVERY_MAX_BYTES;
}

/** The upload answer carries the stable storage ref (preferred) or
 *  a URL — the page attaches whichever the rail returned. */
export function shoutoutUploadRef(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root) return null;
  return strOrNull(root["ref"]) ?? strOrNull(root["url"]);
}
