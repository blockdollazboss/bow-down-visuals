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
export type ReversalStatus = (typeof REVERSAL_STATUSES)[number];

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
export interface ReversalResolution {
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

export const OPERATOR_RESULTS = ["done", "refused", "failed"] as const;
export type OperatorResult = (typeof OPERATOR_RESULTS)[number];
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

export interface OperatorActionsRead {
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

export interface GearAdminItem {
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

export interface GearAdminRead {
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

export const GEAR_FULFILLMENT_STATUSES = ["shipped", "delivered", "canceled"] as const;
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

/* ─── Challenges (stack1200 admin-benches) ───────────────────────────
   The bench for the challenge engine's admin verbs, which had NO
   frontend consumer at all: POST /admin/challenges/:slug/prizes,
   /lifecycle, /judge. List rows ride the bench read added with this
   lane (GET /admin/challenges — every challenge, any state); the
   detail (prizes + entries) rides the public GET /challenges/:slug.
   The mirrors below are the rail's own rules, read from
   routes/challenge-engine.ts: prize places 1–10 unique, amounts are
   Visual Bucs (multiples of 100), the pool total caps at the weekly
   1,000 VB budget law, the pool locks once winners are announced,
   and 'winners' is reachable ONLY through /judge (that's what pays). */

export const CHALLENGE_LIFECYCLES = ["upcoming", "live", "judging", "winners"] as const;
export type ChallengeLifecycle = (typeof CHALLENGE_LIFECYCLES)[number];

/** The weekly budget law, mirrored from the rail (WEEKLY_PRIZE_CAP_VB). */
export const CHALLENGE_PRIZE_POOL_CAP_VB = 1000;

export interface AdminChallengeRow {
  slug: string;
  title: string;
  hashtag: string;
  /** The stored lifecycle (the rail's own status column). */
  status: string;
  /** The date-derived lifecycle the public surfaces show. */
  effectiveStatus: string;
  startsAt: string | null;
  endsAt: string | null;
  judgingEndsAt: string | null;
  entryCount: number;
  prizePoolCredits: number;
  winnersAnnounced: boolean;
  createdAt: string;
}

function parseAdminChallengeRow(v: unknown): AdminChallengeRow | null {
  if (!isRecord(v)) return null;
  const slug = str(v["slug"]);
  const createdAt = str(v["created_at"]);
  if (!slug || !createdAt) return null;
  return {
    slug,
    title: strOr(v["title"], ""),
    hashtag: strOr(v["hashtag"], ""),
    status: strOr(v["status"], ""),
    effectiveStatus: strOr(v["effective_status"], ""),
    startsAt: str(v["starts_at"]),
    endsAt: str(v["ends_at"]),
    judgingEndsAt: str(v["judging_ends_at"]),
    entryCount: numOr(v["entry_count"], 0),
    prizePoolCredits: numOr(v["prize_pool_credits"], 0),
    winnersAnnounced: v["winners_announced"] === true,
    createdAt,
  };
}

/** { challenges: [...] } or a failed read (null). */
export function parseAdminChallenges(json: unknown): AdminChallengeRow[] | null {
  if (!isRecord(json) || !Array.isArray(json["challenges"])) return null;
  const rows: AdminChallengeRow[] = [];
  for (const raw of json["challenges"]) {
    const row = parseAdminChallengeRow(raw);
    if (!row) return null;
    rows.push(row);
  }
  return rows;
}

/** Lifecycle moves the rail would accept from this row: any of
    upcoming/live/judging except the current stored state — never
    'winners' (only /judge crowns), and nothing once crowned. */
export function challengeLifecycleTargets(row: AdminChallengeRow): ChallengeLifecycle[] {
  if (row.status === "winners") return [];
  return CHALLENGE_LIFECYCLES.filter(
    (s): s is ChallengeLifecycle => s !== "winners" && s !== row.status,
  );
}

export interface ChallengePrize {
  place: number;
  prizeCredits: number;
  description: string;
}

export interface ChallengeEntryRow {
  id: string;
  title: string;
  voteCount: number;
  viewCount: number;
  likeCount: number;
  creatorName: string;
  creatorSlug: string;
}

export interface ChallengeDetail {
  slug: string;
  title: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  judgingEndsAt: string | null;
  entryCount: number;
  prizePoolCredits: number;
  prizes: ChallengePrize[];
  winnersAnnounced: boolean;
  entries: ChallengeEntryRow[];
}

export function parseChallengeDetail(json: unknown): ChallengeDetail | null {
  if (!isRecord(json) || !isRecord(json["challenge"])) return null;
  const c = json["challenge"];
  const slug = str(c["slug"]);
  if (!slug) return null;
  if (!Array.isArray(c["prizes"]) || !Array.isArray(json["entries"])) return null;
  const prizes: ChallengePrize[] = [];
  for (const raw of c["prizes"]) {
    if (!isRecord(raw)) return null;
    const place = num(raw["place"]);
    if (place === null) return null;
    prizes.push({
      place,
      prizeCredits: numOr(raw["prize_credits"], 0),
      description: strOr(raw["description"], ""),
    });
  }
  const entries: ChallengeEntryRow[] = [];
  for (const raw of json["entries"]) {
    if (!isRecord(raw)) return null;
    const id = str(raw["id"]);
    if (!id) return null;
    const creator = isRecord(raw["creator"]) ? raw["creator"] : {};
    entries.push({
      id,
      title: strOr(raw["title"], ""),
      voteCount: numOr(raw["vote_count"], 0),
      viewCount: numOr(raw["view_count"], 0),
      likeCount: numOr(raw["like_count"], 0),
      creatorName: strOr(creator["display_name"], ""),
      creatorSlug: strOr(creator["slug"], ""),
    });
  }
  return {
    slug,
    title: strOr(c["title"], ""),
    status: strOr(c["status"], ""),
    startsAt: str(c["starts_at"]),
    endsAt: str(c["ends_at"]),
    judgingEndsAt: str(c["judging_ends_at"]),
    entryCount: numOr(c["entry_count"], 0),
    prizePoolCredits: numOr(c["prize_pool_credits"], 0),
    prizes,
    winnersAnnounced: c["winners_announced"] === true,
    entries,
  };
}

/** One editable prize row in the bench's pool editor. */
export interface PrizeDraft {
  place: number;
  amount: string;
  description: string;
}

export type PrizeDraftError =
  | "empty"
  | "placeRange"
  | "placeDuplicate"
  | "amountWhole"
  | "amountMultiple"
  | "amountRange"
  | "overCap";

/** The rail's prize rules, mirrored: 1–10 rows; places unique whole
    numbers 1–10; amounts whole Visual Bucs, multiples of 100, within
    the rail's 100–10,000,000 span; the TOTAL under the weekly cap.
    Returns the first broken rule, or null when the pool is sendable. */
export function prizeDraftError(draft: PrizeDraft[]): PrizeDraftError | null {
  if (draft.length === 0) return "empty";
  const seen = new Set<number>();
  let total = 0;
  for (const row of draft) {
    if (!Number.isInteger(row.place) || row.place < 1 || row.place > 10) return "placeRange";
    if (seen.has(row.place)) return "placeDuplicate";
    seen.add(row.place);
    const amount = Number(row.amount);
    if (!Number.isInteger(amount)) return "amountWhole";
    if (amount % 100 !== 0) return "amountMultiple";
    if (amount < 100 || amount > 10_000_000) return "amountRange";
    total += amount;
  }
  if (total > CHALLENGE_PRIZE_POOL_CAP_VB) return "overCap";
  return null;
}

export function prizeDraftTotal(draft: PrizeDraft[]): number {
  return draft.reduce((s, r) => s + (Number.isInteger(Number(r.amount)) ? Number(r.amount) : 0), 0);
}

export interface JudgeResult {
  paid: number;
  alreadyPaid: number;
  payoutErrors: string[];
  budgetCapped: string[];
  weeklyCapVb: number;
  weeklyPaidVb: number;
  winners: Array<{
    place: number;
    videoId: string;
    prizeCredits: number;
    paidAt: string | null;
  }>;
}

/** The judge verb's answer, or a failed read (null). */
export function parseJudgeResult(json: unknown): JudgeResult | null {
  if (!isRecord(json) || json["ok"] !== true || !Array.isArray(json["winners"])) return null;
  const winners: JudgeResult["winners"] = [];
  for (const raw of json["winners"]) {
    if (!isRecord(raw)) return null;
    const place = num(raw["place"]);
    const videoId = str(raw["video_id"]);
    if (place === null || !videoId) return null;
    winners.push({
      place,
      videoId,
      prizeCredits: numOr(raw["prize_credits"], 0),
      paidAt: str(raw["paid_at"]),
    });
  }
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    paid: numOr(json["paid"], 0),
    alreadyPaid: numOr(json["already_paid"], 0),
    payoutErrors: strList(json["payout_errors"]),
    budgetCapped: strList(json["budget_capped"]),
    weeklyCapVb: numOr(json["weekly_cap_vb"], 0),
    weeklyPaidVb: numOr(json["weekly_paid_vb"], 0),
    winners,
  };
}

/* ─── Community Grants rounds (stack1200 admin-benches) ──────────────
   The bench for POST/PATCH /admin/community-grants/rounds and
   POST …/rounds/:id/settle — none of which had a frontend consumer.
   The list rides the PUBLIC surface read (GET /community-grants:
   current + past rounds with candidates and tallies), so no new read
   was added. Shapes mirror lib/community-grants' FE vocabulary; the
   parser is strict like the other benches'. Settle mirrors the lib:
   exactly-once; a tie pays nobody and holds for window resolution. */

export interface GrantRoundRow {
  id: string;
  monthKey: string;
  poolVb: number;
  submissionsOpenAt: string;
  submissionsCloseAt: string;
  votingOpenAt: string;
  votingCloseAt: string;
  resultStatus: string;
  winnerCandidateId: string | null;
  grantStatus: string;
  grantPaidAt: string | null;
  settledAt: string | null;
}

export interface GrantCandidateRow {
  id: string;
  creatorName: string;
  title: string;
  description: string;
  votes: number;
  isWinner: boolean;
  reportBackOwed: boolean;
  reportBack: string | null;
}

export interface GrantRoundSurfaceRow {
  round: GrantRoundRow;
  phase: string;
  candidates: GrantCandidateRow[];
  totalVotes: number;
}

export interface GrantsAdminRead {
  current: GrantRoundSurfaceRow | null;
  past: GrantRoundSurfaceRow[];
}

function parseGrantRound(v: unknown): GrantRoundRow | null {
  if (!isRecord(v)) return null;
  const id = str(v["id"]);
  const monthKey = str(v["monthKey"]);
  if (!id || !monthKey) return null;
  return {
    id,
    monthKey,
    poolVb: numOr(v["poolVb"], 0),
    submissionsOpenAt: strOr(v["submissionsOpenAt"], ""),
    submissionsCloseAt: strOr(v["submissionsCloseAt"], ""),
    votingOpenAt: strOr(v["votingOpenAt"], ""),
    votingCloseAt: strOr(v["votingCloseAt"], ""),
    resultStatus: strOr(v["resultStatus"], ""),
    winnerCandidateId: str(v["winnerCandidateId"]),
    grantStatus: strOr(v["grantStatus"], ""),
    grantPaidAt: str(v["grantPaidAt"]),
    settledAt: str(v["settledAt"]),
  };
}

function parseGrantSurfaceRow(v: unknown): GrantRoundSurfaceRow | null {
  if (!isRecord(v)) return null;
  const round = parseGrantRound(v["round"]);
  if (!round || !Array.isArray(v["candidates"])) return null;
  const candidates: GrantCandidateRow[] = [];
  for (const raw of v["candidates"]) {
    if (!isRecord(raw)) return null;
    const id = str(raw["id"]);
    if (!id) return null;
    candidates.push({
      id,
      creatorName: strOr(raw["creatorName"], ""),
      title: strOr(raw["title"], ""),
      description: strOr(raw["description"], ""),
      votes: numOr(raw["votes"], 0),
      isWinner: raw["isWinner"] === true,
      reportBackOwed: raw["reportBackOwed"] === true,
      reportBack: str(raw["reportBack"]),
    });
  }
  return {
    round,
    phase: strOr(v["phase"], ""),
    candidates,
    totalVotes: numOr(v["totalVotes"], 0),
  };
}

/** { current, past } from GET /community-grants, or a failed read. */
export function parseGrantsAdmin(json: unknown): GrantsAdminRead | null {
  if (!isRecord(json) || !Array.isArray(json["past"])) return null;
  const current = json["current"] === null ? null : parseGrantSurfaceRow(json["current"]);
  if (json["current"] !== null && !current) return null;
  const past: GrantRoundSurfaceRow[] = [];
  for (const raw of json["past"]) {
    const row = parseGrantSurfaceRow(raw);
    if (!row) return null;
    past.push(row);
  }
  return { current, past };
}

/** Settle is offered exactly when the rail would take it: voting has
    closed (phase 'closed') and the round is still undecided. A paid
    grant's windows are final — the rail refuses window edits then. */
export function grantSettleAvailable(surface: GrantRoundSurfaceRow): boolean {
  return surface.phase === "closed" && surface.round.resultStatus === "pending";
}

export function grantWindowsEditable(round: GrantRoundRow): boolean {
  return round.grantStatus !== "paid";
}

export interface GrantSettleOutcome {
  outcome: string;
  winnerCandidateId: string | null;
  amountVb: number | null;
  resultStatus: string | null;
}

export function parseGrantSettleOutcome(json: unknown): GrantSettleOutcome | null {
  if (!isRecord(json)) return null;
  const outcome = str(json["outcome"]);
  if (!outcome) return null;
  return {
    outcome,
    winnerCandidateId: str(json["winnerCandidateId"]),
    amountVb: num(json["amountVb"]),
    resultStatus: str(json["resultStatus"]),
  };
}

/* ─── Remix King events (stack1200 admin-benches) ────────────────────
   The bench for the remix-king admin verbs, which had NO frontend
   consumer: POST/PATCH /admin/remix-king/events, …/status,
   /admin/remix-king/entries/:id/shortlist, …/events/:id/winner,
   /admin/remix-king/releases/:id/split-payments. The list rides the
   bench read added with this lane (GET /admin/remix-king/events —
   drafts included; every public read hides them). Mirrors are the
   rail's own rules (lib/remix-king.ts): the status transition table,
   the published-splits contract (roles unique, winner required,
   shares whole 1–100, sum exactly 100), the winner picked only while
   judging, draft-only edits (splits freeze once live). */

export const REMIX_EVENT_STATUSES = [
  "draft",
  "open",
  "judging",
  "decided",
  "released",
  "cancelled",
] as const;
export type RemixEventStatus = (typeof REMIX_EVENT_STATUSES)[number];

/** The rail's TRANSITIONS table, mirrored verbatim. */
export const REMIX_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["open", "cancelled"],
  open: ["judging", "cancelled"],
  judging: ["cancelled"],
  decided: ["released", "cancelled"],
  released: [],
  cancelled: [],
};

export function remixStatusTargets(status: string): string[] {
  return [...(REMIX_TRANSITIONS[status] ?? [])];
}

export const REMIX_SPLIT_ROLES = ["winner", "king", "house"] as const;

export interface RemixSplitRow {
  role: string;
  payeeName: string;
  payeeUserId: string | null;
  sharePct: number;
}

export interface RemixEventRow {
  id: string;
  monthKey: string;
  title: string;
  kingTrackTitle: string;
  kingTrackAudioUrl: string | null;
  kingTrackStemsUrl: string | null;
  description: string;
  splits: RemixSplitRow[];
  status: string;
  entriesOpenAt: string | null;
  entriesCloseAt: string | null;
  winnerEntryId: string | null;
  createdAt: string;
}

export interface RemixEntryRow {
  id: string;
  entrantName: string;
  remixTitle: string;
  audioUrl: string;
  note: string;
  status: string;
  voteCount: number;
  createdAt: string;
}

export interface RemixReleaseRow {
  id: string;
  entryId: string;
  winnerName: string;
  releaseTitle: string;
  splits: RemixSplitRow[];
  status: string;
  releasedAt: string | null;
}

export interface RemixPaymentRow {
  id: string;
  payeeName: string;
  role: string;
  sharePct: number;
  amountVb: number;
  period: string;
  status: string;
  paidAt: string | null;
}

export interface RemixEventBundle {
  event: RemixEventRow;
  entries: RemixEntryRow[];
  release: RemixReleaseRow | null;
  payments: RemixPaymentRow[];
}

function parseRemixSplits(v: unknown): RemixSplitRow[] | null {
  if (!Array.isArray(v)) return null;
  const splits: RemixSplitRow[] = [];
  for (const raw of v) {
    if (!isRecord(raw)) return null;
    const role = str(raw["role"]);
    const sharePct = num(raw["sharePct"]);
    if (!role || sharePct === null) return null;
    splits.push({
      role,
      payeeName: strOr(raw["payeeName"], ""),
      payeeUserId: str(raw["payeeUserId"]),
      sharePct,
    });
  }
  return splits;
}

function parseRemixBundle(v: unknown): RemixEventBundle | null {
  if (!isRecord(v) || !isRecord(v["event"]) || !Array.isArray(v["entries"]) || !Array.isArray(v["payments"])) {
    return null;
  }
  const e = v["event"];
  const id = str(e["id"]);
  const monthKey = str(e["monthKey"]);
  const splits = parseRemixSplits(e["splits"]);
  if (!id || !monthKey || !splits) return null;
  const entries: RemixEntryRow[] = [];
  for (const raw of v["entries"]) {
    if (!isRecord(raw)) return null;
    const entryId = str(raw["id"]);
    if (!entryId) return null;
    entries.push({
      id: entryId,
      entrantName: strOr(raw["entrantName"], ""),
      remixTitle: strOr(raw["remixTitle"], ""),
      audioUrl: strOr(raw["audioUrl"], ""),
      note: strOr(raw["note"], ""),
      status: strOr(raw["status"], ""),
      voteCount: numOr(raw["voteCount"], 0),
      createdAt: strOr(raw["createdAt"], ""),
    });
  }
  let release: RemixReleaseRow | null = null;
  if (v["release"] !== null && v["release"] !== undefined) {
    if (!isRecord(v["release"])) return null;
    const r = v["release"];
    const releaseId = str(r["id"]);
    const releaseSplits = parseRemixSplits(r["splits"]);
    if (!releaseId || !releaseSplits) return null;
    release = {
      id: releaseId,
      entryId: strOr(r["entryId"], ""),
      winnerName: strOr(r["winnerName"], ""),
      releaseTitle: strOr(r["releaseTitle"], ""),
      splits: releaseSplits,
      status: strOr(r["status"], ""),
      releasedAt: str(r["releasedAt"]),
    };
  }
  const payments: RemixPaymentRow[] = [];
  for (const raw of v["payments"]) {
    if (!isRecord(raw)) return null;
    const paymentId = str(raw["id"]);
    if (!paymentId) return null;
    payments.push({
      id: paymentId,
      payeeName: strOr(raw["payeeName"], ""),
      role: strOr(raw["role"], ""),
      sharePct: numOr(raw["sharePct"], 0),
      amountVb: numOr(raw["amountVb"], 0),
      period: strOr(raw["period"], ""),
      status: strOr(raw["status"], ""),
      paidAt: str(raw["paidAt"]),
    });
  }
  return {
    event: {
      id,
      monthKey,
      title: strOr(e["title"], ""),
      kingTrackTitle: strOr(e["kingTrackTitle"], ""),
      kingTrackAudioUrl: str(e["kingTrackAudioUrl"]),
      kingTrackStemsUrl: str(e["kingTrackStemsUrl"]),
      description: strOr(e["description"], ""),
      splits,
      status: strOr(e["status"], ""),
      entriesOpenAt: str(e["entriesOpenAt"]),
      entriesCloseAt: str(e["entriesCloseAt"]),
      winnerEntryId: str(e["winnerEntryId"]),
      createdAt: strOr(e["createdAt"], ""),
    },
    entries,
    release,
    payments,
  };
}

/** { events: [...] } from GET /admin/remix-king/events, or a failed read. */
export function parseRemixAdminEvents(json: unknown): RemixEventBundle[] | null {
  if (!isRecord(json) || !Array.isArray(json["events"])) return null;
  const bundles: RemixEventBundle[] = [];
  for (const raw of json["events"]) {
    const bundle = parseRemixBundle(raw);
    if (!bundle) return null;
    bundles.push(bundle);
  }
  return bundles;
}

export interface SplitDraft {
  role: string;
  payeeName: string;
  payeeUserId: string;
  sharePct: string;
}

export type SplitDraftError =
  | "empty"
  | "tooMany"
  | "roleUnknown"
  | "roleDuplicate"
  | "nameMissing"
  | "shareRange"
  | "winnerMissing"
  | "sumNot100";

/** The published-splits contract, mirrored from validateSplits:
    1–3 rows, known unique roles, every split named, whole shares
    1–100, the winner's split present, the sum exactly 100. */
export function splitDraftError(draft: SplitDraft[]): SplitDraftError | null {
  if (draft.length === 0) return "empty";
  if (draft.length > 3) return "tooMany";
  const seen = new Set<string>();
  let sum = 0;
  for (const row of draft) {
    if (!(REMIX_SPLIT_ROLES as readonly string[]).includes(row.role)) return "roleUnknown";
    if (seen.has(row.role)) return "roleDuplicate";
    seen.add(row.role);
    if (!row.payeeName.trim()) return "nameMissing";
    const share = Number(row.sharePct);
    if (!Number.isInteger(share) || share < 1 || share > 100) return "shareRange";
    sum += share;
  }
  if (!seen.has("winner")) return "winnerMissing";
  if (sum !== 100) return "sumNot100";
  return null;
}

export function splitDraftSum(draft: SplitDraft[]): number {
  return draft.reduce((s, r) => s + (Number.isInteger(Number(r.sharePct)) ? Number(r.sharePct) : 0), 0);
}

/** The winner is crowned only while the event is judging (the rail
    refuses otherwise) — the bench offers the verb only there. */
export function remixWinnerAvailable(event: RemixEventRow): boolean {
  return event.status === "judging";
}

/** Shortlist toggles any entry that isn't the crowned winner. */
export function remixShortlistAvailable(entry: RemixEntryRow): boolean {
  return entry.status !== "winner";
}
