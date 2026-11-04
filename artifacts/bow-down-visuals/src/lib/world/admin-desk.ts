/* ─── Admin benches seam (stack1500 world parity, wave #5 item 46) ──
   Census feature `admin` — the /admin BENCHES native in-World. The
   in-World admin CONTROLS (operator command authority — kick / mute /
   lock, lib/world/admin-locks.ts) already existed; the benches did
   not, and station `membersOnly` gating is NOT admin gating (the
   wave #3 note). This seam + the AdminDesk family close that gap on
   the website's own rails, end to end:

   THE GATE — the desk keys off the SAME admin identity the rails
   enforce, exactly like pages/admin.tsx does:
     GET /api/admin/status (requireAuth) → { isAdmin } — computed
     server-side from the ADMIN_EMAILS allowlist (api-server
     lib/admin.ts isAdminEmail, fail-closed: an unset allowlist
     means NOBODY is an admin). The desk renders its benches only
     when that answer is exactly `true`. Every bench rail behind it
     carries requireAuth + requireAdmin and answers a non-admin
     403 { error: "Not authorized." } — pinned below verbatim; if a
     bench rail ever answers 403 mid-session (the allowlist moved),
     that bench renders the not-authorized state, never data it
     should not have, and never a painted-over list. The client
     never re-implements or widens the gate: no email is read, no
     allowlist is mirrored — the server's word is the only word.

   THE BENCHES (the /admin page's own inventory, docked components
   and inline inboxes alike — each rides the page's rails in the
   page's shapes; strict parsers live here or in lib/admin-benches,
   re-exported below so the desk rides ONE seam):
     - Content reports    GET /api/admin/reports · PATCH …/:id { status }
     - DMCA reports       GET /api/admin/dmca-reports · PATCH …/:id { status }
     - Content removal    GET /api/admin/content/removed ·
                          GET /api/admin/content/:id ·
                          PATCH …/:id { removed, reason?, note? }
     - Pitch & Fix inbox  GET /api/admin/pitch-fix/queue ·
                          PATCH /api/admin/pitch-fix/:id
                            { moderation? | status? | duplicate_of? } ·
                          POST /api/admin/pitch-fix/rewards/process
     - Payment reversals  GET /api/admin/payment-reversals ·
                          POST …/:id/resolve { decision, note }
     - Operator actions   GET /api/admin/operator-actions (read-only)
     - Spotlight inbox    GET /api/admin/spotlight-inquiries ·
                          PATCH …/:id { status }
     - Contact inbox      GET /api/admin/contact-messages ·
                          PATCH …/:id { read }
     - Studio Gear queue  GET /api/admin/studio-gear/orders ·
                          POST …/:id/proof/send { proofUrl, proofNote } ·
                          POST …/:id/status { status }
     - Challenges         GET /api/admin/challenges ·
                          GET /api/challenges/:slug (public detail) ·
                          POST …/:slug/prizes { prizes } ·
                          POST …/:slug/lifecycle { status, starts_at,
                            ends_at, judging_ends_at } ·
                          POST …/:slug/judge { places } | { winners }
     - Community Grants   GET /api/community-grants (public surface) ·
                          POST /api/admin/community-grants/rounds ·
                          PATCH …/rounds/:id (windows) ·
                          POST …/rounds/:id/settle
     - Remix King         GET /api/admin/remix-king/events ·
                          POST …/events · PATCH …/events/:id ·
                          POST …/events/:id/status { status } ·
                          POST /api/admin/remix-king/entries/:id/shortlist
                            { shortlisted } ·
                          POST …/events/:id/winner { entry_id } ·
                          POST …/releases/:id/split-payments
                            { period, total_vb }
     - Bow Challenge      GET /api/admin/bow-challenge ·
                          PUT … { rewardCredits?, enabled?,
                            targetOverride? }
     - Users + grants     GET /api/admin/users/lookup?email= ·
                          POST /api/admin/users/:id/ban | /unban ·
                          POST /api/admin/credits/grant
                            { amount, userId?, email? } ·
                          POST /api/admin/plan/set
                            { tier, userId?, email? }
     - World Drops        lib/world/drop-booking.ts (the booking
                          seam built for this bench): GET/POST
                          /api/world/events · DELETE …/:id — booking
                          is ADMIN ONLY server-side (ADMIN_REQUIRED).
     - Card + jewelry     GET /api/nfc-cards/admin/orders ·
       orders             GET /api/jewelry/admin/orders (read-only
                          lists; the CSV exports are named gaps).
     - Discord Bot        GET /api/discord-bot/config ·
                          POST /api/discord-bot/config ·
                          GET /api/discord-bot/install-url ·
                          GET /api/discord-bot/live (the public
                          LIVE-badge state, read here for the bench's
                          live line). The config answer's env block
                          is PRESENCE ONLY — which of the server's
                          DISCORD_* keys exist, as booleans; no key
                          value ever crosses this seam (the parser
                          below reads the three *_set flags and
                          nothing else from env).

   PRICES: no bench charges the admin and the desk invents none —
   lib/credit-costs.ts has no /api/admin rows. The money the benches
   MOVE is the rails' own: the credit grant is the admin mint (the
   rail's own 1–100,000 bounds, pinned below), reversals resolve the
   engine's rows, challenge judging pays the mirrored weekly pool
   (lib/admin-benches' 1,000 VB cap), grants settle the round's VB
   pool, remix split-payments pay a declared total, drops spend
   from the shared weekly drop budget (drop-booking's pins). Every
   figure on screen renders from rail data, never from copy.

   NAMED GAPS (never faked in the desk; see the lane report):
   the CSV order exports (a file download leaves the World — the
   website benches keep them), artist import / export-my-artists
   and remove-duplicate-shark (file-shaped / one-shot ops rails
   with no queue and no /admin bench consumer), the challenges
   weekly-launch verb (a rail with no bench consumer anywhere),
   and the cheat-code admin events rail (no bench consumer
   anywhere). The desk lists none of them as if they existed.

   Parsers are strict the house way: a broken or incomplete rail
   answer reads as a failed read (null), never painted-over content.
   ────────────────────────────────────────────────────────────────── */

import {
  parsePaymentReversals,
  parseOperatorActions,
  parseGearAdminOrders,
  parseAdminChallenges,
  parseChallengeDetail,
  parseJudgeResult,
  parseGrantsAdmin,
  parseGrantSettleOutcome,
  parseRemixAdminEvents,
  countNeedsManualReview,
  filterReversals,
  filterOperatorActions,
  filterGearOrders,
  gearProofSendAvailable,
  gearFulfillmentActions,
  gearShipBlock,
  challengeLifecycleTargets,
  prizeDraftError,
  prizeDraftTotal,
  grantSettleAvailable,
  grantWindowsEditable,
  remixStatusTargets,
  remixWinnerAvailable,
  remixShortlistAvailable,
  splitDraftError,
  splitDraftSum,
  formatUsdCents,
  shortId,
  REVERSAL_FILTERS,
  OPERATOR_RESULT_FILTERS,
  GEAR_FILTERS,
  REMIX_SPLIT_ROLES,
  CHALLENGE_LIFECYCLES,
  CHALLENGE_PRIZE_POOL_CAP_VB,
  type PaymentReversalRow,
  type ReversalFilter,
  type OperatorActionRow,
  type OperatorResultFilter,
  type GearAdminOrder,
  type GearFilter,
  type GearFulfillmentStatus,
  type AdminChallengeRow,
  type ChallengeDetail,
  type ChallengePrize,
  type JudgeResult,
  type GrantsAdminRead,
  type GrantRoundSurfaceRow,
  type GrantSettleOutcome,
  type RemixEventBundle,
  type RemixEventRow,
  type RemixEntryRow,
  type PrizeDraft,
  type SplitDraft,
} from "../admin-benches";
import {
  DROP_BOOK_PATH,
  DROP_SLATE_PATH,
  dropCancelPath,
  buildDropBody,
  dropBookingError,
  parseUpcomingDrops,
  parseDropStartInput,
  dropStartInputValue,
  dropRooms,
  DROP_DURATION_PRESETS_MIN,
  DROP_MAX_AMOUNT_VB,
  DROP_MIN_AMOUNT_VB,
  DROP_MAX_CLAIMS,
  DROP_MIN_CLAIMS,
  DROP_WEEKLY_BUDGET_VB,
  type DropDraft,
  type UpcomingDrop,
} from "./drop-booking";
import { REMOVAL_REASONS, parseContentId } from "../content-removal";

/* The shared benches' parsers, mirrors and row shapes ride this
   seam so the desk components import admin from one place. */
export {
  parsePaymentReversals,
  parseOperatorActions,
  parseGearAdminOrders,
  parseAdminChallenges,
  parseChallengeDetail,
  parseJudgeResult,
  parseGrantsAdmin,
  parseGrantSettleOutcome,
  parseRemixAdminEvents,
  countNeedsManualReview,
  filterReversals,
  filterOperatorActions,
  filterGearOrders,
  gearProofSendAvailable,
  gearFulfillmentActions,
  gearShipBlock,
  challengeLifecycleTargets,
  prizeDraftError,
  prizeDraftTotal,
  grantSettleAvailable,
  grantWindowsEditable,
  remixStatusTargets,
  remixWinnerAvailable,
  remixShortlistAvailable,
  splitDraftError,
  splitDraftSum,
  formatUsdCents,
  shortId,
  REVERSAL_FILTERS,
  OPERATOR_RESULT_FILTERS,
  GEAR_FILTERS,
  REMIX_SPLIT_ROLES,
  CHALLENGE_LIFECYCLES,
  CHALLENGE_PRIZE_POOL_CAP_VB,
  DROP_BOOK_PATH,
  DROP_SLATE_PATH,
  dropCancelPath,
  buildDropBody,
  dropBookingError,
  parseUpcomingDrops,
  parseDropStartInput,
  dropStartInputValue,
  dropRooms,
  DROP_DURATION_PRESETS_MIN,
  DROP_MAX_AMOUNT_VB,
  DROP_MIN_AMOUNT_VB,
  DROP_MAX_CLAIMS,
  DROP_MIN_CLAIMS,
  DROP_WEEKLY_BUDGET_VB,
  REMOVAL_REASONS,
  parseContentId,
};
export type {
  PaymentReversalRow,
  ReversalFilter,
  OperatorActionRow,
  OperatorResultFilter,
  GearAdminOrder,
  GearFilter,
  GearFulfillmentStatus,
  AdminChallengeRow,
  ChallengeDetail,
  ChallengePrize,
  JudgeResult,
  GrantsAdminRead,
  GrantRoundSurfaceRow,
  GrantSettleOutcome,
  RemixEventBundle,
  RemixEventRow,
  RemixEntryRow,
  PrizeDraft,
  SplitDraft,
  DropDraft,
  UpcomingDrop,
};

/** The two bench reads whose result interfaces lib/admin-benches
 *  keeps unexported — named here off the parsers themselves. */
export type OperatorActionsRead = NonNullable<ReturnType<typeof parseOperatorActions>>;
export type GearAdminRead = NonNullable<ReturnType<typeof parseGearAdminOrders>>;

/* ─── the gate ───────────────────────────────────────────────────── */

export const ADMIN_STATUS_PATH = "/api/admin/status";

/** routes/admin.ts requireAdmin's refusal, verbatim — also the
 *  en.json `admin.notAuthorized` string the /admin page renders for
 *  a signed-in non-admin. The desk's not-authorized state carries
 *  the rail's own words. */
export const ADMIN_NOT_AUTHORIZED_MESSAGE = "Not authorized.";

/** The gate's answer, strictly: only a record carrying a boolean
 *  `isAdmin` is an answer at all; anything else is a failed read
 *  (null) — never a guessed yes or no. */
export function parseAdminStatus(json: unknown): boolean | null {
  if (!isRecord(json)) return null;
  return typeof json["isAdmin"] === "boolean" ? json["isAdmin"] : null;
}

/** A bench rail's 403 is the gate speaking (the allowlist moved
 *  mid-session, or the status probe raced a sign-out): the bench
 *  renders the not-authorized state, not a load failure. */
export function isNotAuthorized(status: number): boolean {
  return status === 403;
}

/* ─── shared strict-parse helpers (the house idiom) ──────────────── */

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
function strList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") return null;
    out.push(raw);
  }
  return out;
}

/* ─── content reports (routes/admin.ts GET/PATCH /admin/reports) ── */

export const ADMIN_REPORTS_PATH = "/api/admin/reports";
export function adminReportPath(id: string): string {
  return `/api/admin/reports/${encodeURIComponent(id)}`;
}

/** lib/db CONTENT_REPORT_STATUSES, pinned — also the page's
 *  REPORT_STATUSES: the only statuses the rail's zod enum accepts. */
export const REPORT_STATUSES = ["new", "reviewing", "actioned", "dismissed"] as const;

export interface ContentReportRow {
  id: string;
  reporterUserId: string;
  targetType: string;
  targetId: string;
  targetOwnerUserId: string | null;
  targetSummary: string;
  reason: string;
  note: string | null;
  status: string;
  createdAt: string | null;
}

function parseContentReportRow(v: unknown): ContentReportRow | null {
  if (!isRecord(v)) return null;
  const id = str(v["id"]);
  if (!id) return null;
  return {
    id,
    reporterUserId: strOr(v["reporterUserId"], ""),
    targetType: strOr(v["targetType"], ""),
    targetId: strOr(v["targetId"], ""),
    targetOwnerUserId: str(v["targetOwnerUserId"]),
    targetSummary: strOr(v["targetSummary"], ""),
    reason: strOr(v["reason"], ""),
    note: str(v["note"]),
    status: strOr(v["status"], ""),
    createdAt: str(v["createdAt"]),
  };
}

/** { reports: [...] } or a failed read (null). */
export function parseContentReports(json: unknown): ContentReportRow[] | null {
  if (!isRecord(json) || !Array.isArray(json["reports"])) return null;
  const rows: ContentReportRow[] = [];
  for (const raw of json["reports"]) {
    const row = parseContentReportRow(raw);
    if (!row) return null;
    rows.push(row);
  }
  return rows;
}

export function buildStatusPatch(status: string): { status: string } {
  return { status };
}

/** Rows still waiting on a human: the open end of the queue. */
export function openReports(rows: readonly { status: string }[]): number {
  return rows.filter((r) => r.status === "new" || r.status === "reviewing").length;
}

/* ─── DMCA reports (GET/PATCH /api/admin/dmca-reports) ───────────── */

export const ADMIN_DMCA_PATH = "/api/admin/dmca-reports";
export function adminDmcaPath(id: string): string {
  return `/api/admin/dmca-reports/${encodeURIComponent(id)}`;
}

/** The page's DMCA_STATUSES, pinned — the rail's accepted set. */
export const DMCA_STATUSES = ["new", "reviewing", "actioned", "dismissed"] as const;

export interface DmcaReportRow {
  id: string;
  reporterName: string;
  reporterEmail: string;
  reporterOrg: string | null;
  infringingUrls: string[];
  originalUrls: string[];
  description: string;
  status: string;
  createdAt: string | null;
}

export function parseDmcaReports(json: unknown): DmcaReportRow[] | null {
  if (!isRecord(json) || !Array.isArray(json["reports"])) return null;
  const rows: DmcaReportRow[] = [];
  for (const raw of json["reports"]) {
    if (!isRecord(raw)) return null;
    const id = str(raw["id"]);
    const infringing = strList(raw["infringingUrls"]);
    const original = strList(raw["originalUrls"]);
    if (!id || !infringing || !original) return null;
    rows.push({
      id,
      reporterName: strOr(raw["reporterName"], ""),
      reporterEmail: strOr(raw["reporterEmail"], ""),
      reporterOrg: str(raw["reporterOrg"]),
      infringingUrls: infringing,
      originalUrls: original,
      description: strOr(raw["description"], ""),
      status: strOr(raw["status"], ""),
      createdAt: str(raw["createdAt"]),
    });
  }
  return rows;
}

/* ─── content removal (GET /admin/content/removed, GET+PATCH
       /admin/content/:id) ──────────────────────────────────────── */

export const ADMIN_REMOVED_CONTENT_PATH = "/api/admin/content/removed";
export function adminContentPath(id: string): string {
  return `/api/admin/content/${encodeURIComponent(id)}`;
}

export interface AdminContentState {
  id: string;
  kind: "post" | "comment";
  postKind: string;
  body: string;
  author: { profileId: string; userId: string; slug: string; displayName: string } | null;
  createdAt: string | null;
  removed: boolean;
  removedAt: string | null;
  removedByEmail: string | null;
  removalReason: string | null;
  removalNote: string | null;
}

export function parseContentState(v: unknown): AdminContentState | null {
  if (!isRecord(v)) return null;
  const id = str(v["id"]);
  if (!id || (v["kind"] !== "post" && v["kind"] !== "comment")) return null;
  let author: AdminContentState["author"] = null;
  if (v["author"] !== null && v["author"] !== undefined) {
    if (!isRecord(v["author"])) return null;
    author = {
      profileId: strOr(v["author"]["profileId"], ""),
      userId: strOr(v["author"]["userId"], ""),
      slug: strOr(v["author"]["slug"], ""),
      displayName: strOr(v["author"]["displayName"], ""),
    };
  }
  return {
    id,
    kind: v["kind"],
    postKind: strOr(v["postKind"], ""),
    body: strOr(v["body"], ""),
    author,
    createdAt: str(v["createdAt"]),
    removed: v["removed"] === true,
    removedAt: str(v["removedAt"]),
    removedByEmail: str(v["removedByEmail"]),
    removalReason: str(v["removalReason"]),
    removalNote: str(v["removalNote"]),
  };
}

/** { content } — the single-content reads and writes. */
export function parseContentAnswer(json: unknown): AdminContentState | null {
  if (!isRecord(json)) return null;
  return parseContentState(json["content"]);
}

/** { content: [...] } — the removed-content list. */
export function parseRemovedContent(json: unknown): AdminContentState[] | null {
  if (!isRecord(json) || !Array.isArray(json["content"])) return null;
  const rows: AdminContentState[] = [];
  for (const raw of json["content"]) {
    const row = parseContentState(raw);
    if (!row) return null;
    rows.push(row);
  }
  return rows;
}

/** The rail's PATCH shape: a removal carries a reason (and an
 *  optional note); a restore is exactly { removed: false }. */
export function buildContentRemovalPatch(input: {
  removed: boolean;
  reason?: string;
  note?: string;
}): { removed: boolean; reason?: string; note?: string } {
  if (!input.removed) return { removed: false };
  const patch: { removed: boolean; reason?: string; note?: string } = { removed: true };
  if (input.reason) patch.reason = input.reason;
  const note = (input.note ?? "").trim();
  if (note) patch.note = note;
  return patch;
}

/* ─── pitch & fix inbox (GET /admin/pitch-fix/queue, PATCH
       /admin/pitch-fix/:id, POST …/rewards/process) ────────────── */

export const ADMIN_PITCH_FIX_QUEUE_PATH = "/api/admin/pitch-fix/queue";
export const ADMIN_PITCH_FIX_PROCESS_PATH = "/api/admin/pitch-fix/rewards/process";
export function adminPitchFixPath(id: string): string {
  return `/api/admin/pitch-fix/${encodeURIComponent(id)}`;
}

export interface PitchFixRow {
  id: string;
  kind: "pitch" | "fix" | "feedback";
  source: string;
  submitterName: string;
  title: string;
  body: string;
  why: string | null;
  category: string | null;
  page: string | null;
  severity: string | null;
  rating: number | null;
  status: string;
  moderationStatus: "pending" | "approved" | "rejected";
  upvoteCount: number;
  rewardStatus: "none" | "queued" | "paid" | "ineligible";
  rewardAmount: number | null;
  rewardQueuedAt: string | null;
  rewardPaidAt: string | null;
  duplicateOfId: string | null;
  createdAt: string;
}

export interface PitchFixPool {
  weekStart: string;
  capVb: number;
  spentVb: number;
  remainingVb: number;
  queuedIds: string[];
}

export interface PitchFixQueue {
  submissions: PitchFixRow[];
  rewardPool: PitchFixPool;
}

/** The page's per-kind status ladders, pinned — a pitch walks
 *  reviewing → approved → building → shipped; a fix walks
 *  received → confirmed → fixing → fixed. Feedback rows carry no
 *  ladder (moderation only). */
export const PITCH_FIX_PITCH_STATUSES = ["reviewing", "approved", "building", "shipped"] as const;
export const PITCH_FIX_FIX_STATUSES = ["received", "confirmed", "fixing", "fixed"] as const;

export function pitchFixStatusesFor(kind: PitchFixRow["kind"]): readonly string[] {
  if (kind === "pitch") return PITCH_FIX_PITCH_STATUSES;
  if (kind === "fix") return PITCH_FIX_FIX_STATUSES;
  return [];
}

function parsePitchFixRow(v: unknown): PitchFixRow | null {
  if (!isRecord(v)) return null;
  const id = str(v["id"]);
  const createdAt = str(v["createdAt"]);
  if (!id || !createdAt) return null;
  if (v["kind"] !== "pitch" && v["kind"] !== "fix" && v["kind"] !== "feedback") return null;
  if (
    v["moderationStatus"] !== "pending" &&
    v["moderationStatus"] !== "approved" &&
    v["moderationStatus"] !== "rejected"
  ) {
    return null;
  }
  if (
    v["rewardStatus"] !== "none" &&
    v["rewardStatus"] !== "queued" &&
    v["rewardStatus"] !== "paid" &&
    v["rewardStatus"] !== "ineligible"
  ) {
    return null;
  }
  return {
    id,
    kind: v["kind"],
    source: strOr(v["source"], ""),
    submitterName: strOr(v["submitterName"], ""),
    title: strOr(v["title"], ""),
    body: strOr(v["body"], ""),
    why: str(v["why"]),
    category: str(v["category"]),
    page: str(v["page"]),
    severity: str(v["severity"]),
    rating: num(v["rating"]),
    status: strOr(v["status"], ""),
    moderationStatus: v["moderationStatus"],
    upvoteCount: numOr(v["upvoteCount"], 0),
    rewardStatus: v["rewardStatus"],
    rewardAmount: num(v["rewardAmount"]),
    rewardQueuedAt: str(v["rewardQueuedAt"]),
    rewardPaidAt: str(v["rewardPaidAt"]),
    duplicateOfId: str(v["duplicateOfId"]),
    createdAt,
  };
}

export function parsePitchFixPool(v: unknown): PitchFixPool | null {
  if (!isRecord(v)) return null;
  const weekStart = str(v["weekStart"]);
  const queuedIds = strList(v["queuedIds"]);
  if (!weekStart || !queuedIds) return null;
  return {
    weekStart,
    capVb: numOr(v["capVb"], 0),
    spentVb: numOr(v["spentVb"], 0),
    remainingVb: numOr(v["remainingVb"], 0),
    queuedIds,
  };
}

/** { submissions, rewardPool } or a failed read (null). */
export function parsePitchFixQueue(json: unknown): PitchFixQueue | null {
  if (!isRecord(json) || !Array.isArray(json["submissions"])) return null;
  const pool = parsePitchFixPool(json["rewardPool"]);
  if (!pool) return null;
  const submissions: PitchFixRow[] = [];
  for (const raw of json["submissions"]) {
    const row = parsePitchFixRow(raw);
    if (!row) return null;
    submissions.push(row);
  }
  return { submissions, rewardPool: pool };
}

/** The PATCH carries exactly one verb at a time (the rail applies
 *  moderation, duplicate and status independently; the bench fires
 *  one per tap, like the page). */
export type PitchFixPatch =
  | { moderation: "approved" | "rejected" }
  | { status: string }
  | { duplicate_of: string };

export function buildPitchFixModeration(moderation: "approved" | "rejected"): PitchFixPatch {
  return { moderation };
}
export function buildPitchFixStatus(status: string): PitchFixPatch {
  return { status };
}
export function buildPitchFixDuplicate(duplicateOfId: string): PitchFixPatch {
  return { duplicate_of: duplicateOfId };
}

/** Submissions still waiting on a moderation decision. */
export function pitchFixPending(rows: readonly PitchFixRow[]): number {
  return rows.filter((r) => r.moderationStatus === "pending").length;
}

/* ─── payment reversals (the resolve verb's own rules) ──────────── */

export const ADMIN_REVERSALS_PATH = "/api/admin/payment-reversals";
export function adminReversalResolvePath(id: string): string {
  return `/api/admin/payment-reversals/${encodeURIComponent(id)}/resolve`;
}

export const REVERSAL_DECISIONS = ["complete", "dismiss"] as const;
export type ReversalDecision = (typeof REVERSAL_DECISIONS)[number];

/** The bench rule the page carries (and the rail's spirit): a
 *  dismissal with no money moved must say why. 'complete' may ride
 *  a blank note. */
export function reversalResolveReady(decision: string, note: string): boolean {
  if (!(REVERSAL_DECISIONS as readonly string[]).includes(decision)) return false;
  if (decision === "dismiss") return note.trim().length > 0;
  return true;
}

export function buildReversalResolve(decision: ReversalDecision, note: string): {
  decision: ReversalDecision;
  note: string;
} {
  return { decision, note: note.trim() };
}

/** Only parked rows can be resolved — the rail 409s a row someone
 *  (or the engine) already settled, and the bench reloads on 409 so
 *  the recorded decision is what shows. */
export function reversalResolvable(row: PaymentReversalRow): boolean {
  return row.status === "needs_manual_review";
}

/* ─── operator actions (read-only) ───────────────────────────────── */

export const ADMIN_OPERATOR_ACTIONS_PATH = "/api/admin/operator-actions";

/* ─── spotlight inbox (GET/PATCH /api/admin/spotlight-inquiries) ── */

export const ADMIN_SPOTLIGHT_PATH = "/api/admin/spotlight-inquiries";
export function adminSpotlightPath(id: string): string {
  return `/api/admin/spotlight-inquiries/${encodeURIComponent(id)}`;
}

/** The page's SPOTLIGHT_STATUSES, pinned. */
export const SPOTLIGHT_STATUSES = ["new", "contacted", "approved", "rejected"] as const;

export interface SpotlightInquiryRow {
  id: string;
  name: string;
  email: string;
  videoUrl: string | null;
  targetUrl: string | null;
  status: string;
  createdAt: string | null;
}

export function parseSpotlightInquiries(json: unknown): SpotlightInquiryRow[] | null {
  if (!isRecord(json) || !Array.isArray(json["inquiries"])) return null;
  const rows: SpotlightInquiryRow[] = [];
  for (const raw of json["inquiries"]) {
    if (!isRecord(raw)) return null;
    const id = str(raw["id"]);
    if (!id) return null;
    rows.push({
      id,
      name: strOr(raw["name"], ""),
      email: strOr(raw["email"], ""),
      videoUrl: str(raw["videoUrl"]),
      targetUrl: str(raw["targetUrl"]),
      status: strOr(raw["status"], ""),
      createdAt: str(raw["createdAt"]),
    });
  }
  return rows;
}

/* ─── contact inbox (GET/PATCH /api/admin/contact-messages) ─────── */

export const ADMIN_CONTACT_PATH = "/api/admin/contact-messages";
export function adminContactPath(id: string): string {
  return `/api/admin/contact-messages/${encodeURIComponent(id)}`;
}

export interface ContactMessageRow {
  id: string;
  name: string;
  email: string;
  message: string;
  read: boolean;
  createdAt: string | null;
}

export function parseContactMessages(json: unknown): ContactMessageRow[] | null {
  if (!isRecord(json) || !Array.isArray(json["messages"])) return null;
  const rows: ContactMessageRow[] = [];
  for (const raw of json["messages"]) {
    if (!isRecord(raw)) return null;
    const id = str(raw["id"]);
    if (!id) return null;
    rows.push({
      id,
      name: strOr(raw["name"], ""),
      email: strOr(raw["email"], ""),
      message: strOr(raw["message"], ""),
      read: raw["read"] === true,
      createdAt: str(raw["createdAt"]),
    });
  }
  return rows;
}

export function buildReadPatch(read: boolean): { read: boolean } {
  return { read };
}

export function unreadMessages(rows: readonly ContactMessageRow[]): number {
  return rows.filter((r) => !r.read).length;
}

/* ─── studio gear queue ──────────────────────────────────────────── */

export const ADMIN_GEAR_ORDERS_PATH = "/api/admin/studio-gear/orders";
export function adminGearProofPath(id: string): string {
  return `/api/admin/studio-gear/orders/${encodeURIComponent(id)}/proof/send`;
}
export function adminGearStatusPath(id: string): string {
  return `/api/admin/studio-gear/orders/${encodeURIComponent(id)}/status`;
}

export function buildGearProof(input: { proofUrl: string; proofNote: string }): {
  proofUrl: string;
  proofNote?: string;
} {
  const note = input.proofNote.trim();
  return note ? { proofUrl: input.proofUrl.trim(), proofNote: note } : { proofUrl: input.proofUrl.trim() };
}

export function buildGearStatus(status: string): { status: string } {
  return { status };
}

/* ─── challenges ─────────────────────────────────────────────────── */

export const ADMIN_CHALLENGES_PATH = "/api/admin/challenges";
export function adminChallengePrizesPath(slug: string): string {
  return `/api/admin/challenges/${encodeURIComponent(slug)}/prizes`;
}
export function adminChallengeLifecyclePath(slug: string): string {
  return `/api/admin/challenges/${encodeURIComponent(slug)}/lifecycle`;
}
export function adminChallengeJudgePath(slug: string): string {
  return `/api/admin/challenges/${encodeURIComponent(slug)}/judge`;
}
/** The detail (prizes + entries) rides the PUBLIC challenge read —
 *  the same rail the website bench loads. */
export function challengeDetailPath(slug: string): string {
  return `/api/challenges/${encodeURIComponent(slug)}`;
}

export function buildPrizesBody(draft: readonly PrizeDraft[]): {
  prizes: { place: number; prize_credits: number; description: string }[];
} {
  return {
    prizes: draft.map((p) => ({
      place: p.place,
      prize_credits: Number(p.amount),
      description: p.description,
    })),
  };
}

/** Lifecycle body in the rail's snake_case, the page's exact
 *  semantics: a date rides as ISO, or as null to CLEAR it (the rail
 *  distinguishes null from absent); an absent field is left alone.
 *  The desk's datetime-local inputs convert via localInputToIso
 *  before this builder, exactly like the page's fromLocalInput. */
export function buildLifecycleBody(input: {
  status?: string;
  startsAtIso?: string | null;
  endsAtIso?: string | null;
  judgingEndsAtIso?: string | null;
}): {
  status?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  judging_ends_at?: string | null;
} {
  return {
    status: input.status || undefined,
    starts_at: input.startsAtIso,
    ends_at: input.endsAtIso,
    judging_ends_at: input.judgingEndsAtIso,
  };
}

/** Judge by votes: the rail crowns the top N by its own tally. */
export function buildJudgeByVotes(places: number): { places: number } {
  const n = Number.isInteger(places) && places >= 1 && places <= 10 ? places : 3;
  return { places: n };
}

/** Judge by hand: place → entry (video) id picks, places ascending. */
export function buildJudgeByPicks(picks: Readonly<Record<number, string>>): {
  winners: { place: number; video_id: string }[];
} {
  const winners = [1, 2, 3]
    .filter((place) => picks[place])
    .map((place) => ({ place, video_id: picks[place]! }));
  return { winners };
}

/** A datetime-local input value → ISO (null when blank/invalid) —
 *  the page benches' fromLocalInput, mirrored. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** An ISO stamp → a datetime-local input value ("" when absent). */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ─── community grants ───────────────────────────────────────────── */

export const GRANTS_SURFACE_PATH = "/api/community-grants";
export const ADMIN_GRANT_ROUNDS_PATH = "/api/admin/community-grants/rounds";
export function adminGrantRoundPath(id: string): string {
  return `/api/admin/community-grants/rounds/${encodeURIComponent(id)}`;
}
export function adminGrantSettlePath(id: string): string {
  return `/api/admin/community-grants/rounds/${encodeURIComponent(id)}/settle`;
}

export interface GrantWindows {
  submissionsOpenAt: string;
  submissionsCloseAt: string;
  votingOpenAt: string;
  votingCloseAt: string;
}

/** The open-round rule the page carries: a YYYY-MM month key and a
 *  whole, positive VB pool. */
export function grantOpenReady(monthKey: string, poolInput: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return false;
  const pool = Number(poolInput);
  return Number.isInteger(pool) && pool > 0;
}

export function buildGrantRoundBody(input: { monthKey: string; poolVb: number; windows: GrantWindows }): {
  monthKey: string;
  poolVb: number;
  submissionsOpenAt: string | null;
  submissionsCloseAt: string | null;
  votingOpenAt: string | null;
  votingCloseAt: string | null;
} {
  return {
    monthKey: input.monthKey,
    poolVb: input.poolVb,
    submissionsOpenAt: localInputToIso(input.windows.submissionsOpenAt),
    submissionsCloseAt: localInputToIso(input.windows.submissionsCloseAt),
    votingOpenAt: localInputToIso(input.windows.votingOpenAt),
    votingCloseAt: localInputToIso(input.windows.votingCloseAt),
  };
}

export function buildGrantWindowsBody(windows: GrantWindows): {
  submissionsOpenAt: string | null;
  submissionsCloseAt: string | null;
  votingOpenAt: string | null;
  votingCloseAt: string | null;
} {
  return {
    submissionsOpenAt: localInputToIso(windows.submissionsOpenAt),
    submissionsCloseAt: localInputToIso(windows.submissionsCloseAt),
    votingOpenAt: localInputToIso(windows.votingOpenAt),
    votingCloseAt: localInputToIso(windows.votingCloseAt),
  };
}

/* ─── remix king ─────────────────────────────────────────────────── */

export const ADMIN_REMIX_EVENTS_PATH = "/api/admin/remix-king/events";
export function adminRemixEventPath(id: string): string {
  return `/api/admin/remix-king/events/${encodeURIComponent(id)}`;
}
export function adminRemixStatusPath(id: string): string {
  return `/api/admin/remix-king/events/${encodeURIComponent(id)}/status`;
}
export function adminRemixWinnerPath(id: string): string {
  return `/api/admin/remix-king/events/${encodeURIComponent(id)}/winner`;
}
export function adminRemixShortlistPath(entryId: string): string {
  return `/api/admin/remix-king/entries/${encodeURIComponent(entryId)}/shortlist`;
}
export function adminRemixSplitPaymentsPath(releaseId: string): string {
  return `/api/admin/remix-king/releases/${encodeURIComponent(releaseId)}/split-payments`;
}

export interface RemixEventDraft {
  title: string;
  kingTrackTitle: string;
  kingTrackAudioUrl: string;
  kingTrackStemsUrl: string;
  description: string;
  entriesOpenAt: string;
  entriesCloseAt: string;
  splits: SplitDraft[];
}

/** The splits wire shape — the page bench's splitsBody, verbatim:
 *  camelCase rows riding inside the snake_case event body. */
export function buildSplitsBody(draft: readonly SplitDraft[]): {
  role: string;
  payeeName: string;
  payeeUserId: string | null;
  sharePct: number;
}[] {
  return draft.map((s) => ({
    role: s.role,
    payeeName: s.payeeName.trim(),
    payeeUserId: s.payeeUserId.trim() ? s.payeeUserId.trim() : null,
    sharePct: Number(s.sharePct),
  }));
}

export function buildRemixCreateBody(input: { monthKey: string; draft: RemixEventDraft }): Record<string, unknown> {
  return {
    month_key: input.monthKey,
    title: input.draft.title,
    king_track_title: input.draft.kingTrackTitle,
    king_track_audio_url: input.draft.kingTrackAudioUrl.trim() || null,
    king_track_stems_url: input.draft.kingTrackStemsUrl.trim() || null,
    description: input.draft.description,
    splits: buildSplitsBody(input.draft.splits),
    entries_open_at: localInputToIso(input.draft.entriesOpenAt),
    entries_close_at: localInputToIso(input.draft.entriesCloseAt),
  };
}

export function buildRemixPatchBody(draft: RemixEventDraft): Record<string, unknown> {
  return {
    title: draft.title,
    king_track_title: draft.kingTrackTitle,
    king_track_audio_url: draft.kingTrackAudioUrl.trim() || null,
    king_track_stems_url: draft.kingTrackStemsUrl.trim() || null,
    description: draft.description,
    splits: buildSplitsBody(draft.splits),
    entries_open_at: localInputToIso(draft.entriesOpenAt),
    entries_close_at: localInputToIso(draft.entriesCloseAt),
  };
}

export function buildRemixStatus(status: string): { status: string } {
  return { status };
}
export function buildRemixShortlist(shortlisted: boolean): { shortlisted: boolean } {
  return { shortlisted };
}
export function buildRemixWinner(entryId: string): { entry_id: string } {
  return { entry_id: entryId };
}

/** The split-payments rule the page carries: a YYYY-MM period and a
 *  whole, non-negative total. */
export function remixPayReady(period: string, totalInput: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return false;
  const total = Number(totalInput);
  return Number.isInteger(total) && total >= 0;
}

export function buildRemixSplitPayments(period: string, totalVb: number): { period: string; total_vb: number } {
  return { period, total_vb: totalVb };
}

/** An event row → the bench's editable draft (the page's seeding). */
export function remixDraftFromEvent(event: RemixEventRow): RemixEventDraft {
  return {
    title: event.title,
    kingTrackTitle: event.kingTrackTitle,
    kingTrackAudioUrl: event.kingTrackAudioUrl ?? "",
    kingTrackStemsUrl: event.kingTrackStemsUrl ?? "",
    description: event.description,
    entriesOpenAt: isoToLocalInput(event.entriesOpenAt),
    entriesCloseAt: isoToLocalInput(event.entriesCloseAt),
    splits: event.splits.map((s) => ({
      role: s.role,
      payeeName: s.payeeName,
      payeeUserId: s.payeeUserId ?? "",
      sharePct: String(s.sharePct),
    })),
  };
}

/* ─── bow challenge (the jackpot race) ───────────────────────────── */

export const ADMIN_BOW_CHALLENGE_PATH = "/api/admin/bow-challenge";

export interface BowRaceRow {
  period: string;
  target: number;
  totalBows: number;
  winnerEmail: string | null;
  wonAt: string | null;
}

export interface BowChallengeState {
  rewardCredits: number;
  enabled: boolean;
  targetOverride: number | null;
  updatedAt: string | null;
  race: (BowRaceRow & { winnerUserId: string | null; raceOver: boolean }) | null;
  history: BowRaceRow[];
}

export function parseBowChallenge(json: unknown): BowChallengeState | null {
  if (!isRecord(json)) return null;
  const rewardCredits = num(json["rewardCredits"]);
  if (rewardCredits === null || typeof json["enabled"] !== "boolean") return null;
  if (!Array.isArray(json["history"])) return null;
  const history: BowRaceRow[] = [];
  for (const raw of json["history"]) {
    if (!isRecord(raw)) return null;
    const period = str(raw["period"]);
    if (!period) return null;
    history.push({
      period,
      target: numOr(raw["target"], 0),
      totalBows: numOr(raw["totalBows"], 0),
      winnerEmail: str(raw["winnerEmail"]),
      wonAt: str(raw["wonAt"]),
    });
  }
  let race: BowChallengeState["race"] = null;
  if (json["race"] !== null && json["race"] !== undefined) {
    if (!isRecord(json["race"])) return null;
    const r = json["race"];
    const period = str(r["period"]);
    if (!period) return null;
    race = {
      period,
      target: numOr(r["target"], 0),
      totalBows: numOr(r["totalBows"], 0),
      winnerEmail: str(r["winnerEmail"]),
      wonAt: str(r["wonAt"]),
      winnerUserId: str(r["winnerUserId"]),
      raceOver: r["raceOver"] === true,
    };
  }
  return {
    rewardCredits,
    enabled: json["enabled"],
    targetOverride: num(json["targetOverride"]),
    updatedAt: str(json["updatedAt"]),
    race,
    history,
  };
}

/** The rail's config bounds, pinned from its zod schema: reward
 *  1–10,000 credits; a target override is 1,000–5,000 or null
 *  (cleared). */
export const BOW_REWARD_MIN = 1;
export const BOW_REWARD_MAX = 10000;
export const BOW_TARGET_MIN = 1000;
export const BOW_TARGET_MAX = 5000;

export function buildBowConfigBody(input: {
  rewardCredits: number;
  enabled: boolean;
  targetOverride: number | null;
}): { rewardCredits: number; enabled: boolean; targetOverride: number | null } {
  return {
    rewardCredits: input.rewardCredits,
    enabled: input.enabled,
    targetOverride: input.targetOverride,
  };
}

export function bowConfigReady(rewardInput: string, targetInput: string): boolean {
  const reward = Number(rewardInput);
  if (!Number.isInteger(reward) || reward < BOW_REWARD_MIN || reward > BOW_REWARD_MAX) return false;
  if (targetInput.trim() === "") return true;
  const target = Number(targetInput);
  return Number.isInteger(target) && target >= BOW_TARGET_MIN && target <= BOW_TARGET_MAX;
}

/* ─── users, grants, plan (routes/admin.ts) ──────────────────────── */

export function adminUserLookupPath(email: string): string {
  return `/api/admin/users/lookup?email=${encodeURIComponent(email)}`;
}
export function adminUserBanPath(id: string): string {
  return `/api/admin/users/${encodeURIComponent(id)}/ban`;
}
export function adminUserUnbanPath(id: string): string {
  return `/api/admin/users/${encodeURIComponent(id)}/unban`;
}
export const ADMIN_CREDITS_GRANT_PATH = "/api/admin/credits/grant";
export const ADMIN_PLAN_SET_PATH = "/api/admin/plan/set";

export interface AdminUserLookup {
  id: string;
  email: string;
  displayName: string | null;
  credits: number;
  plan: string | null;
  banned: boolean;
  createdAt: string | null;
}

/** { user } — a miss is an honest null user, NOT a failed read; the
 *  parse itself fails (null) only on a broken answer. The wrapper
 *  keeps the two apart: { ok: true, user: null } vs null. */
export function parseUserLookup(json: unknown): { user: AdminUserLookup | null } | null {
  if (!isRecord(json)) return null;
  if (json["user"] === null) return { user: null };
  if (!isRecord(json["user"])) return null;
  const u = json["user"];
  const id = str(u["id"]);
  const email = str(u["email"]);
  if (!id || !email) return null;
  return {
    user: {
      id,
      email,
      displayName: str(u["displayName"]),
      credits: numOr(u["credits"], 0),
      plan: str(u["plan"]),
      banned: u["banned"] === true,
      createdAt: str(u["createdAt"]),
    },
  };
}

export function emailReady(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** The grant rail's own bounds (its zod schema): a whole amount
 *  1–100,000. The target is a looked-up user id OR an email —
 *  exactly one rides the body, the page's precedence (an explicit
 *  user wins). */
export const GRANT_AMOUNT_MIN = 1;
export const GRANT_AMOUNT_MAX = 100000;

export function grantAmountReady(amountInput: string): boolean {
  const amount = Number(amountInput);
  return Number.isInteger(amount) && amount >= GRANT_AMOUNT_MIN && amount <= GRANT_AMOUNT_MAX;
}

export function buildGrantBody(input: {
  amount: number;
  userId?: string;
  email?: string;
}): { amount: number; userId?: string; email?: string } {
  const body: { amount: number; userId?: string; email?: string } = { amount: input.amount };
  if (input.userId) body.userId = input.userId;
  else if (input.email) body.email = input.email.trim();
  return body;
}

/** Plan tiers 1–6 (the rail's ladder: 1–3 free, 4–5 pro, 6 elite —
 *  a plan record, never a rank; Creator Level stars never move). */
export const PLAN_TIERS = [1, 2, 3, 4, 5, 6] as const;

export function buildPlanBody(input: {
  tier: number;
  userId?: string;
  email?: string;
}): { tier: number; userId?: string; email?: string } {
  const body: { tier: number; userId?: string; email?: string } = { tier: input.tier };
  if (input.userId) body.userId = input.userId;
  else if (input.email) body.email = input.email.trim();
  return body;
}

/* ─── card + jewelry orders (read-only lists) ────────────────────── */

export const ADMIN_NFC_ORDERS_PATH = "/api/nfc-cards/admin/orders";
export const ADMIN_JEWELRY_ORDERS_PATH = "/api/jewelry/admin/orders";

export interface StoreOrderRow {
  id: string;
  /** What was ordered, in the bench's own words (card style /
   *  jewelry product + finish). */
  itemLabel: string;
  detail: string | null;
  quantity: number;
  fullName: string;
  email: string;
  status: string;
  totalCents: number;
  createdAt: string;
}

function parseShipping(v: unknown): boolean {
  if (!isRecord(v)) return false;
  return (
    typeof v["street"] === "string" &&
    typeof v["city"] === "string" &&
    typeof v["state"] === "string" &&
    typeof v["zip"] === "string" &&
    typeof v["country"] === "string"
  );
}

/** { ok, orders } — the NFC bench's snake_case rows. */
export function parseNfcOrders(json: unknown): StoreOrderRow[] | null {
  if (!isRecord(json) || !Array.isArray(json["orders"])) return null;
  const rows: StoreOrderRow[] = [];
  for (const raw of json["orders"]) {
    if (!isRecord(raw)) return null;
    const id = str(raw["id"]);
    const createdAt = str(raw["created_at"]);
    if (!id || !createdAt || !parseShipping(raw["shipping_address"])) return null;
    const profile = isRecord(raw["nfc_profiles"]) ? str(raw["nfc_profiles"]["slug"]) : null;
    rows.push({
      id,
      itemLabel: strOr(raw["card_style"], ""),
      detail: profile ? `/${profile}` : null,
      quantity: numOr(raw["quantity"], 0),
      fullName: strOr(raw["full_name"], ""),
      email: strOr(raw["email"], ""),
      status: strOr(raw["status"], ""),
      totalCents: numOr(raw["total_cents"], 0),
      createdAt,
    });
  }
  return rows;
}

/** { ok, orders } — the jewelry bench's snake_case rows. */
export function parseJewelryOrders(json: unknown): StoreOrderRow[] | null {
  if (!isRecord(json) || !Array.isArray(json["orders"])) return null;
  const rows: StoreOrderRow[] = [];
  for (const raw of json["orders"]) {
    if (!isRecord(raw)) return null;
    const id = str(raw["id"]);
    const createdAt = str(raw["created_at"]);
    if (!id || !createdAt || !parseShipping(raw["shipping_address"])) return null;
    const product = strOr(raw["product_key"], "");
    const finish = strOr(raw["finish"], "");
    const engraving = str(raw["engraving"]);
    rows.push({
      id,
      itemLabel: finish ? `${product} · ${finish}` : product,
      detail: engraving ? `Engraving: ${engraving}` : str(raw["size_option"]),
      quantity: numOr(raw["quantity"], 0),
      fullName: strOr(raw["full_name"], ""),
      email: strOr(raw["email"], ""),
      status: strOr(raw["status"], ""),
      totalCents: numOr(raw["total_cents"], 0),
      createdAt,
    });
  }
  return rows;
}

/* ─── discord bot (GET/POST /api/discord-bot/config,
       GET /api/discord-bot/install-url, GET /api/discord-bot/live)
       ──────────────────────────────────────────────────────────────
   The Live Companion Bot's wiring bench — the same rails the
   website's /discord-bot setup page drives, in the page's shapes.

   PRESENCE ONLY: the config answer's `env` block says which of the
   server's DISCORD_* keys EXIST, as booleans (client_id_set /
   bot_token_set / shared_secret_set). The key VALUES never leave
   the server and this seam never asks for them: the parser reads
   exactly the three *_set flags out of env — even a hypothetical
   answer smuggling a value into env could not carry it into the
   desk, because the parsed read has no field that could hold it.
   The saved wiring row itself (guild / channel / role / streamer
   IDs the admin typed) is the admin's own data, not a secret.

   THE HONESTY (the website desk's, stack1600 fix queue #8): until
   the server can see ALL THREE core keys the bot is NOT connected —
   an unset key reads amber "not set up" (a setup step, never a
   failure), the wiring form stays LOCKED with the reason shown
   (saved wiring would announce nothing), and the install link
   stays off while the client ID is unset (the rail refuses to
   build it: 400). Configured reads as configured. */

export const DISCORD_BOT_CONFIG_PATH = "/api/discord-bot/config";
export const DISCORD_BOT_INSTALL_URL_PATH = "/api/discord-bot/install-url";
export const DISCORD_BOT_LIVE_PATH = "/api/discord-bot/live";

/** The saved wiring, camelCased off the rail's snake_case row. */
export interface DiscordBotWiring {
  guildId: string;
  announceChannelId: string;
  announceRoleId: string;
  mentionEveryone: boolean;
  streamerDiscordUserId: string;
  streamerDiscordUsername: string;
  enabled: boolean;
}

export interface DiscordBotRead {
  /** The admin's saved wiring row, or null when none is saved yet. */
  wiring: DiscordBotWiring | null;
  /** Presence flags ONLY — which server keys exist. */
  env: {
    clientIdSet: boolean;
    botTokenSet: boolean;
    sharedSecretSet: boolean;
  };
}

/** { config, env } — strict where it matters: the env block must
 *  carry the three presence booleans or the whole read fails (a
 *  bench that can't tell set from unset must not guess); the wiring
 *  row is null or mapped field-by-field. */
export function parseDiscordBotConfig(json: unknown): DiscordBotRead | null {
  if (!isRecord(json) || !isRecord(json["env"])) return null;
  const env = json["env"];
  if (
    typeof env["client_id_set"] !== "boolean" ||
    typeof env["bot_token_set"] !== "boolean" ||
    typeof env["shared_secret_set"] !== "boolean"
  ) {
    return null;
  }
  let wiring: DiscordBotWiring | null = null;
  const cfg = json["config"];
  if (cfg !== null && cfg !== undefined) {
    if (!isRecord(cfg)) return null;
    wiring = {
      guildId: strOr(cfg["guild_id"], ""),
      announceChannelId: strOr(cfg["announce_channel_id"], ""),
      announceRoleId: strOr(cfg["announce_role_id"], ""),
      mentionEveryone: cfg["mention_everyone"] === true,
      streamerDiscordUserId: strOr(cfg["streamer_discord_user_id"], ""),
      streamerDiscordUsername: strOr(cfg["streamer_discord_username"], ""),
      enabled: cfg["enabled"] !== false,
    };
  }
  return {
    wiring,
    env: {
      clientIdSet: env["client_id_set"],
      botTokenSet: env["bot_token_set"],
      sharedSecretSet: env["shared_secret_set"],
    },
  };
}

/** Connected = the server can see all three core keys — the
 *  website desk's rule, verbatim in spirit: anything less and the
 *  bot announces nothing. */
export function discordBotConfigured(read: DiscordBotRead): boolean {
  return read.env.clientIdSet && read.env.botTokenSet && read.env.sharedSecretSet;
}

export function discordBotUnconfigured(read: DiscordBotRead): boolean {
  return !discordBotConfigured(read);
}

/** The install rail builds its URL from DISCORD_CLIENT_ID and
 *  refuses (400) without it — the bench keeps the button off while
 *  the ID is known to be unset, with the reason shown. */
export function discordInstallBlocked(read: DiscordBotRead): boolean {
  return !read.env.clientIdSet;
}

/** The bench's editable draft: the six fields the website form
 *  carries (the streamer username rides the row for display; the
 *  bot itself keeps it current from its own sightings, and the
 *  save body omits it so a save never wipes it). */
export interface DiscordBotDraft {
  guildId: string;
  announceChannelId: string;
  announceRoleId: string;
  mentionEveryone: boolean;
  streamerDiscordUserId: string;
  enabled: boolean;
}

/** Seed the form from the saved row — or the page's blanks, with
 *  announcements enabled by default, exactly like the page's
 *  `form.enabled ?? true`. */
export function discordBotDraftFrom(read: DiscordBotRead): DiscordBotDraft {
  const w = read.wiring;
  return {
    guildId: w?.guildId ?? "",
    announceChannelId: w?.announceChannelId ?? "",
    announceRoleId: w?.announceRoleId ?? "",
    mentionEveryone: w?.mentionEveryone ?? false,
    streamerDiscordUserId: w?.streamerDiscordUserId ?? "",
    enabled: w?.enabled ?? true,
  };
}

/** The POST body in the rail's snake_case schema — exactly the six
 *  fields the website form sends, IDs trimmed (an ID carries no
 *  spaces; a stray one would only 400 the save). */
export function buildDiscordBotConfigBody(draft: DiscordBotDraft): {
  guild_id: string;
  announce_channel_id: string;
  announce_role_id: string;
  mention_everyone: boolean;
  streamer_discord_user_id: string;
  enabled: boolean;
} {
  return {
    guild_id: draft.guildId.trim(),
    announce_channel_id: draft.announceChannelId.trim(),
    announce_role_id: draft.announceRoleId.trim(),
    mention_everyone: draft.mentionEveryone,
    streamer_discord_user_id: draft.streamerDiscordUserId.trim(),
    enabled: draft.enabled,
  };
}

/** { install_url } or a failed read (null). */
export function parseDiscordInstallUrl(json: unknown): string | null {
  if (!isRecord(json)) return null;
  return str(json["install_url"]);
}

export interface DiscordBotLive {
  isLive: boolean;
  configured: boolean;
  startedAt: string | null;
  endedAt: string | null;
  channelName: string | null;
  streamTitle: string | null;
}

/** The public LIVE-badge state, parsed strictly on the two
 *  booleans the rail always sends. */
export function parseDiscordBotLive(json: unknown): DiscordBotLive | null {
  if (!isRecord(json) || typeof json["is_live"] !== "boolean") return null;
  return {
    isLive: json["is_live"],
    configured: json["configured"] === true,
    startedAt: str(json["started_at"]),
    endedAt: str(json["ended_at"]),
    channelName: str(json["channel_name"]),
    streamTitle: str(json["stream_title"]),
  };
}

