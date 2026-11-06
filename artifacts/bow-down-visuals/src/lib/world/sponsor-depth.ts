/* ─── Sponsor depth seam (stack1400 world parity wave 1, item 5) ────
   The sponsor marketplace at full depth, native in-World, on the
   sponsors router's own rails — the same endpoints the 2D surfaces
   call (the Brand Deals Post a Deal + Manage Deals tabs —
   components/sponsors/PostDealPanel.tsx + SponsorDashboardPanel.tsx —
   and pages/sponsor-deal-detail.tsx):

     GET  /api/sponsors/can-spend            → { canSpend } readout
     POST /api/sponsors/deals                → post a deal: 500 Visual
                                               Bucs (SPONSOR_POST_CREDIT_COST
                                               on the rail; registry-pinned
                                               in lib/credit-costs.ts),
                                               charged before the save,
                                               auto-refunded on failure
     GET  /api/sponsors/dashboard            → { postedDeals (full-deal
                                               DTOs), applications +
                                               payouts (raw snake_case
                                               rows), totalEarnedCents }
     GET  /api/sponsors/deals/:id            → { deal } full DTO
     GET  /api/sponsors/deals/:id/applications → brand-only pitch list
     POST /api/sponsors/deals/:id/apply      → apply with a pitch (free)
     POST /api/sponsors/pitch                → AI pitch writer: 100
                                               Visual Bucs
                                               (SPONSOR_AI_CREDIT_COST;
                                               registry-pinned)
     PATCH /api/sponsors/applications/:id    → accept / reject (free);
                                               accept needs an agreed
                                               payout inside the budget
     POST /api/sponsors/deals/:id/fund       → fund escrow (embedded
                                               session, sandbox, or the
                                               rail's hosted fallback —
                                               the 2D page's own chain)
     POST /api/sponsors/escrow/confirm       → sandbox fund confirm
     POST /api/sponsors/deals/:id/start      → creator starts work
     POST /api/sponsors/deals/:id/complete   → creator marks delivered
     POST /api/sponsors/deals/:id/release    → brand releases escrow;
                                               the rail splits the gross
                                               by sponsorFeeSplit():
                                               SPONSOR_PLATFORM_FEE_BPS
                                               default 1500 = 15% fee /
                                               85% creator

   Deal lifecycle (the rail's own): active → funded → in_progress →
   completed → paid. Nothing here invents a price or a split: the
   post cost and the pitch cost ride the credit-confirmation registry
   exactly as the 2D pages ride it, and the escrow figures render
   from the deal DTO's own stamped cents. */

export const SPONSOR_DEALS_PATH = "/api/sponsors/deals";
export const SPONSOR_DASHBOARD_PATH = "/api/sponsors/dashboard";
export const SPONSOR_CAN_SPEND_PATH = "/api/sponsors/can-spend";
export const SPONSOR_PITCH_PATH = "/api/sponsors/pitch";
export const SPONSOR_ESCROW_CONFIRM_PATH = "/api/sponsors/escrow/confirm";

export function sponsorDealPath(id: string): string {
  return `/api/sponsors/deals/${encodeURIComponent(id)}`;
}
export function sponsorDealApplicationsPath(id: string): string {
  return `${sponsorDealPath(id)}/applications`;
}
export function sponsorDealApplyPath(id: string): string {
  return `${sponsorDealPath(id)}/apply`;
}
export function sponsorApplicationPath(id: string): string {
  return `/api/sponsors/applications/${encodeURIComponent(id)}`;
}
export function sponsorDealActionPath(
  id: string,
  action: "fund" | "start" | "complete" | "release",
): string {
  return `${sponsorDealPath(id)}/${action}`;
}

/** The rail's posting price: SPONSOR_POST_CREDIT_COST in
 *  routes/generate/sponsors.ts (env-overridable, default 500), the
 *  same number lib/credit-costs.ts pins for the confirmation and
 *  sponsors-post.tsx displays as POST_COST. */
export const SPONSOR_POST_COST_VB = 500;
/** The rail's AI price: SPONSOR_AI_CREDIT_COST (default 100) — the
 *  pitch writer shares it with the deal matcher. */
export const SPONSOR_PITCH_COST_VB = 100;
/** The rail's default platform fee in basis points:
 *  SPONSOR_PLATFORM_FEE_BPS defaults to 1500 (15% fee / 85%
 *  creator) and is env-overridable server-side; used ONLY for the
 *  pre-release preview, exactly as the 2D detail page previews 85%
 *  to the creator — settled figures always render from the deal's
 *  own stamped cents. */
export const SPONSOR_PLATFORM_FEE_BPS_DEFAULT = 1500;

export const SPONSOR_DEAL_STEPS = ["active", "funded", "in_progress", "completed", "paid"] as const;

export const SPONSOR_PITCH_TONES = [
  { key: "professional", label: "Professional" },
  { key: "bold", label: "Bold" },
  { key: "friendly", label: "Friendly" },
] as const;
export type SponsorPitchTone = (typeof SPONSOR_PITCH_TONES)[number]["key"];

/* ─── Shared reading helpers ─────────────────────────────────────── */

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
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
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function sponsorMoneyCents(cents: number | null | undefined, locale: string = "en-US"): string {
  if (cents == null) return "—";
  return "$" + (Number(cents) / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** The index of a deal status on the lifecycle steps (-1 when the
 *  status is off-lifecycle, e.g. cancelled). */
export function sponsorDealStepIndex(status: string): number {
  return (SPONSOR_DEAL_STEPS as readonly string[]).indexOf(status);
}

/* ─── The full deal DTO (GET deal detail + dashboard postedDeals) ── */

export interface SponsorFullDeal {
  id: string;
  brandName: string;
  budgetMin: number;
  budgetMax: number;
  niche: string;
  deliverables: string;
  description: string;
  deadline: string;
  status: string;
  createdAt: string;
  postedBy: string;
  agreedAmountCents: number | null;
  escrowStatus: string;
  platformFeeCents: number | null;
  creatorPayoutCents: number | null;
  acceptedApplicationId: string | null;
  acceptedUserId: string | null;
  paidAt: string | null;
  applicationCount: number;
  myApplicationStatus: string | null;
}

function normalizeFullDeal(r: Record<string, unknown>): SponsorFullDeal | null {
  const id = str(r["id"]);
  const brandName = str(r["brandName"]);
  if (!id || !brandName) return null;
  return {
    id,
    brandName,
    budgetMin: num(r["budgetMin"]),
    budgetMax: num(r["budgetMax"]),
    niche: str(r["niche"]),
    deliverables: str(r["deliverables"]),
    description: str(r["description"]),
    deadline: str(r["deadline"]),
    status: str(r["status"]) || "active",
    createdAt: str(r["createdAt"]),
    postedBy: str(r["postedBy"]),
    agreedAmountCents: numOrNull(r["agreedAmountCents"]),
    escrowStatus: str(r["escrowStatus"]) || "unfunded",
    platformFeeCents: numOrNull(r["platformFeeCents"]),
    creatorPayoutCents: numOrNull(r["creatorPayoutCents"]),
    acceptedApplicationId: strOrNull(r["acceptedApplicationId"]),
    acceptedUserId: strOrNull(r["acceptedUserId"]),
    paidAt: strOrNull(r["paidAt"]),
    applicationCount: num(r["applicationCount"]),
    myApplicationStatus: strOrNull(r["myApplicationStatus"]),
  };
}

export function normalizeSponsorDealDetail(payload: unknown): SponsorFullDeal | null {
  const root = asRecord(payload);
  const deal = root ? asRecord(root["deal"]) : null;
  if (!deal) return null;
  return normalizeFullDeal(deal);
}

/* ─── The dashboard (GET /api/sponsors/dashboard) ────────────────── */

export interface SponsorMyApplication {
  id: string;
  dealId: string;
  applicationStatus: string;
  pitch: string;
  createdAt: string;
  brandName: string;
  budgetMin: number;
  budgetMax: number;
  niche: string;
  dealStatus: string;
  agreedAmountCents: number | null;
  escrowStatus: string;
}

export interface SponsorPayout {
  id: string;
  dealId: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  createdAt: string;
  brandName: string;
}

export interface SponsorDashboardData {
  postedDeals: SponsorFullDeal[];
  applications: SponsorMyApplication[];
  payouts: SponsorPayout[];
  /** Null until the rail answers — never a fake $0.00. */
  totalEarnedCents: number | null;
}

export function normalizeSponsorDashboard(payload: unknown): SponsorDashboardData | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root["postedDeals"]) || !Array.isArray(root["applications"]) || !Array.isArray(root["payouts"])) {
    return null;
  }
  const postedDeals: SponsorFullDeal[] = [];
  for (const raw of root["postedDeals"]) {
    const r = asRecord(raw);
    if (!r) return null;
    const deal = normalizeFullDeal(r);
    if (!deal) return null;
    postedDeals.push(deal);
  }
  const applications: SponsorMyApplication[] = [];
  for (const raw of root["applications"]) {
    const r = asRecord(raw);
    if (!r) return null;
    const id = str(r["id"]);
    const dealId = str(r["deal_id"]);
    if (!id || !dealId) return null;
    applications.push({
      id,
      dealId,
      applicationStatus: str(r["application_status"]) || "pending",
      pitch: str(r["pitch"]),
      createdAt: str(r["created_at"]),
      brandName: str(r["brand_name"]),
      budgetMin: num(r["budget_min"]),
      budgetMax: num(r["budget_max"]),
      niche: str(r["niche"]),
      dealStatus: str(r["deal_status"]),
      agreedAmountCents: numOrNull(r["agreed_amount_cents"]),
      escrowStatus: str(r["escrow_status"]),
    });
  }
  const payouts: SponsorPayout[] = [];
  for (const raw of root["payouts"]) {
    const r = asRecord(raw);
    if (!r) return null;
    const id = str(r["id"]);
    const dealId = str(r["deal_id"]);
    if (!id || !dealId) return null;
    payouts.push({
      id,
      dealId,
      grossCents: num(r["gross_cents"]),
      feeCents: num(r["fee_cents"]),
      netCents: num(r["net_cents"]),
      createdAt: str(r["created_at"]),
      brandName: str(r["brand_name"]),
    });
  }
  return {
    postedDeals,
    applications,
    payouts,
    totalEarnedCents: numOrNull(root["totalEarnedCents"]),
  };
}

/* ─── Applications on one deal (brand review list) ───────────────── */

export interface SponsorApplication {
  id: string;
  dealId: string;
  userId: string;
  pitch: string;
  status: string;
  portfolioUrl: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export function normalizeSponsorApplications(payload: unknown): SponsorApplication[] | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root["applications"])) return null;
  const out: SponsorApplication[] = [];
  for (const raw of root["applications"]) {
    const r = asRecord(raw);
    if (!r) return null;
    const id = str(r["id"]);
    const dealId = str(r["deal_id"]);
    if (!id || !dealId) return null;
    out.push({
      id,
      dealId,
      userId: str(r["user_id"]),
      pitch: str(r["pitch"]),
      status: str(r["status"]) || "pending",
      portfolioUrl: strOrNull(r["portfolio_url"]),
      decidedAt: strOrNull(r["decided_at"]),
      createdAt: str(r["created_at"]),
    });
  }
  return out;
}

/* ─── Post a deal — form + payload (the rail's dealSchema) ─────────
   brandName 1–120, budgetMin/budgetMax ints ≥0 with max ≥ min,
   niche 1–120, deliverables 1–500, description 1–2000, deadline an
   ISO datetime. The form holds the deadline as a date input value;
   the payload converts it exactly as sponsors-post.tsx does. */

export interface SponsorPostForm {
  brandName: string;
  budgetMin: string;
  budgetMax: string;
  niche: string;
  deliverables: string;
  description: string;
  deadline: string;
}

export const EMPTY_SPONSOR_POST_FORM: SponsorPostForm = {
  brandName: "",
  budgetMin: "",
  budgetMax: "",
  niche: "",
  deliverables: "",
  description: "",
  deadline: "",
};

/* ─── Display strings (i18n seam, stack100 locale unit 47) ────────
   The seam's user-facing sentences take optional strings bundles
   whose defaults are the original English, byte-identical; the
   desk builds the bundles from the worldSponsorPress catalog keys
   (the description error and the paused-spending sentence ride the
   2D post page's own sponsorsPost keys — the same words there). */

export interface SponsorPostFormStrings {
  brandRequired: string;
  brandLong: string;
  budgetMin: string;
  budgetMax: string;
  niche: string;
  deliverables: string;
  description: string;
  deadline: string;
  deadlineValid: string;
}

export const SPONSOR_POST_FORM_STRINGS_EN: SponsorPostFormStrings = {
  brandRequired: "Add your brand name.",
  brandLong: "Brand name is too long (max 120 characters).",
  budgetMin: "Add the lowest budget.",
  budgetMax: "The top budget must be at least the lowest budget.",
  niche: "Add the niche you're hiring for.",
  deliverables: "Say what the creator delivers.",
  description: "Describe the deal.",
  deadline: "Pick a deadline.",
  deadlineValid: "Pick a valid deadline.",
};

/** Build the bundle from a translate function (the desk's `t`). */
export function sponsorPostFormStrings(translate: (key: string) => string): SponsorPostFormStrings {
  return {
    brandRequired: translate("worldSponsorPress.spFormErrBrandRequired"),
    brandLong: translate("worldSponsorPress.spFormErrBrandLong"),
    budgetMin: translate("worldSponsorPress.spFormErrBudgetMin"),
    budgetMax: translate("worldSponsorPress.spFormErrBudgetMax"),
    niche: translate("worldSponsorPress.spFormErrNiche"),
    deliverables: translate("worldSponsorPress.spFormErrDeliverables"),
    description: translate("sponsorsPost.errorDescription"),
    deadline: translate("worldSponsorPress.spFormErrDeadline"),
    deadlineValid: translate("worldSponsorPress.spFormErrDeadlineValid"),
  };
}

/** The first validation problem, in the 2D page's own check order —
 *  null when the form is ready to post. */
export function sponsorPostFormError(form: SponsorPostForm, strings: SponsorPostFormStrings = SPONSOR_POST_FORM_STRINGS_EN): string | null {
  const min = Number(form.budgetMin);
  const max = Number(form.budgetMax);
  if (!form.brandName.trim()) return strings.brandRequired;
  if (form.brandName.trim().length > 120) return strings.brandLong;
  if (!Number.isFinite(min) || min < 0 || form.budgetMin.trim() === "") return strings.budgetMin;
  if (!Number.isFinite(max) || max < min) return strings.budgetMax;
  if (!form.niche.trim()) return strings.niche;
  if (!form.deliverables.trim()) return strings.deliverables;
  if (!form.description.trim()) return strings.description;
  if (!form.deadline) return strings.deadline;
  if (Number.isNaN(new Date(form.deadline).getTime())) return strings.deadlineValid;
  return null;
}

export function buildSponsorPostPayload(form: SponsorPostForm): Record<string, unknown> | null {
  if (sponsorPostFormError(form)) return null;
  return {
    brandName: form.brandName.trim(),
    budgetMin: Math.round(Number(form.budgetMin)),
    budgetMax: Math.round(Number(form.budgetMax)),
    niche: form.niche.trim(),
    deliverables: form.deliverables.trim(),
    description: form.description.trim(),
    deadline: new Date(form.deadline).toISOString(),
  };
}

export interface SponsorPostResult {
  dealId: string;
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

export function normalizeSponsorPostResult(payload: unknown): SponsorPostResult | null {
  const root = asRecord(payload);
  const deal = root ? asRecord(root["deal"]) : null;
  const dealId = deal ? str(deal["id"]) : "";
  if (!dealId) return null;
  return {
    dealId,
    creditsUsed: numOrNull(root!["creditsUsed"]),
    creditsRemaining: numOrNull(root!["creditsRemaining"]),
  };
}

/* ─── Apply + AI pitch writer ────────────────────────────────────── */

export function buildSponsorApplyPayload(pitch: string, portfolioUrl: string): Record<string, unknown> | null {
  const p = pitch.trim();
  if (!p || p.length > 2000) return null;
  const url = portfolioUrl.trim();
  return { pitch: p, ...(url ? { portfolioUrl: url } : {}) };
}

export interface SponsorPitchForm {
  creatorName: string;
  niche: string;
  followers: string;
  achievements: string;
  tone: SponsorPitchTone;
}

export function buildSponsorPitchPayload(
  dealId: string,
  form: SponsorPitchForm,
): Record<string, unknown> | null {
  if (!dealId || !form.niche.trim()) return null;
  return {
    dealId,
    creatorName: form.creatorName.trim(),
    niche: form.niche.trim(),
    followers: Number(form.followers.replace(/[^0-9]/g, "")) || 0,
    platforms: [],
    achievements: form.achievements.trim(),
    tone: form.tone,
  };
}

export function normalizeSponsorPitchResult(payload: unknown): string | null {
  const root = asRecord(payload);
  return root ? strOrNull(root["pitch"]) : null;
}

/* ─── Review (accept / reject) ───────────────────────────────────── */

/** Accept needs an agreed payout in dollars inside the deal's posted
 *  budget — the rail enforces the same range in cents and rejects
 *  outside it; the desk checks first so the brand hears it plainly. */
export interface SponsorReviewStrings {
  agreedRequired: string;
  /** Template with a {{range}} token for the formatted budget range. */
  agreedRange: string;
}

export const SPONSOR_REVIEW_STRINGS_EN: SponsorReviewStrings = {
  agreedRequired: "Add the agreed payout before accepting.",
  agreedRange: "Agreed payout must be within the posted budget ({{range}}).",
};

/** Build the bundle from a translate function (the desk's `t`).
 *  The range template keeps its {{range}} token — the seam fills
 *  it with the locale-formatted budget range at build time. */
export function sponsorReviewStrings(translate: (key: string) => string): SponsorReviewStrings {
  return {
    agreedRequired: translate("worldSponsorPress.spReviewErrAgreedRequired"),
    agreedRange: translate("worldSponsorPress.spReviewErrAgreedRange"),
  };
}

export function buildSponsorReviewPayload(
  action: "accept" | "reject",
  agreedDollars: string,
  deal: Pick<SponsorFullDeal, "budgetMin" | "budgetMax">,
  strings: SponsorReviewStrings = SPONSOR_REVIEW_STRINGS_EN,
  locale: string = "en-US",
): { payload: Record<string, unknown> } | { error: string } {
  if (action === "reject") return { payload: { action } };
  const dollars = Number(agreedDollars);
  if (!agreedDollars.trim() || !Number.isFinite(dollars) || dollars <= 0) {
    return { error: strings.agreedRequired };
  }
  const agreedAmountCents = Math.round(dollars * 100);
  if (agreedAmountCents < Math.max(100, deal.budgetMin * 100) || agreedAmountCents > deal.budgetMax * 100) {
    const range = `$${deal.budgetMin.toLocaleString(locale)}–$${deal.budgetMax.toLocaleString(locale)}`;
    return {
      error: strings.agreedRange.replace("{{range}}", range),
    };
  }
  return { payload: { action, agreedAmountCents } };
}

/* ─── Funding ────────────────────────────────────────────────────── */

export interface SponsorFundResult {
  sandbox: boolean;
  sessionId: string | null;
  clientSecret: string | null;
  checkoutUrl: string | null;
}

export function normalizeSponsorFundResult(payload: unknown): SponsorFundResult | null {
  const root = asRecord(payload);
  if (!root) return null;
  return {
    sandbox: root["sandbox"] === true,
    sessionId: strOrNull(root["sessionId"]),
    clientSecret: strOrNull(root["clientSecret"]),
    checkoutUrl: strOrNull(root["checkoutUrl"]),
  };
}

/** The amount the fund action sends: the deal's agreed amount when
 *  the rail has stamped one, else the brand's typed dollars — the
 *  2D page's own fallback chain. Null when neither yields a
 *  positive amount. */
export function sponsorFundAmountCents(
  deal: Pick<SponsorFullDeal, "agreedAmountCents">,
  agreedDollars: string,
): number | null {
  const fromDeal = deal.agreedAmountCents ?? Math.round(Number(agreedDollars) * 100);
  return fromDeal && fromDeal > 0 ? fromDeal : null;
}

/** The pre-release split preview: the rail's sponsorFeeSplit at its
 *  default fee (see SPONSOR_PLATFORM_FEE_BPS_DEFAULT). Settled
 *  figures come from the deal's stamped cents, never from here. */
export function sponsorReleasePreview(grossCents: number): { feeCents: number; netCents: number } {
  const gross = Math.max(0, Math.round(grossCents));
  const feeCents = Math.round((gross * SPONSOR_PLATFORM_FEE_BPS_DEFAULT) / 10000);
  return { feeCents, netCents: gross - feeCents };
}

/* ─── Can-spend + error reading ──────────────────────────────────── */

export function normalizeSponsorCanSpend(payload: unknown): boolean | null {
  const root = asRecord(payload);
  if (!root) return null;
  return typeof root["canSpend"] === "boolean" ? root["canSpend"] : null;
}

/** Plain-words error reading for the sponsor rails: the server's own
 *  sentence wins; a raw internal code never renders. 402 and the
 *  CREDITS_DISABLED 403 keep their tailored words, matching the 2D
 *  pages' branches. */
export interface SponsorErrorStrings {
  pausedMessage: string;
  outOfCreditsMessage: string;
}

export const SPONSOR_ERROR_STRINGS_EN: SponsorErrorStrings = {
  pausedMessage: "Credit spending is paused on this account right now — nothing was charged.",
  outOfCreditsMessage: "You're out of Visual Bucs — top up to continue.",
};

/** Build the bundle from a translate function (the desk's `t`).
 *  The paused sentence rides the 2D post page's own sponsorsPost
 *  key — the same words for the same rail state. */
export function sponsorErrorStrings(translate: (key: string) => string): SponsorErrorStrings {
  return {
    pausedMessage: translate("sponsorsPost.errorSpendingPaused"),
    outOfCreditsMessage: translate("worldSponsorPress.spOutOfCreditsFallback"),
  };
}

export function sponsorErrorMessage(payload: unknown, status: number, fallback: string, strings: SponsorErrorStrings = SPONSOR_ERROR_STRINGS_EN): string {
  const root = asRecord(payload);
  if (root) {
    if (status === 403 && root["code"] === "CREDITS_DISABLED") {
      return str(root["error"]) || strings.pausedMessage;
    }
    const message = str(root["message"]);
    const error = str(root["error"]);
    if (status === 402 || error === "out_of_credits") {
      return message || strings.outOfCreditsMessage;
    }
    if (error && error !== "out_of_credits") return error;
    if (message) return message;
  }
  if (status === 402) return strings.outOfCreditsMessage;
  return fallback;
}

export function isSponsorSpendingPaused(payload: unknown, status: number): boolean {
  const root = asRecord(payload);
  return status === 403 && !!root && root["code"] === "CREDITS_DISABLED";
}
