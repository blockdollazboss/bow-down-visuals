/**
 * money-desks-2.ts — the pure logic behind the palace's Money wave II
 * (Stack-100 items 65–70): the Music Hall's Beats licensing station,
 * portrait-card tipping + the tip-jar desk, the Get Paid Room's money
 * management actions (permanence elections + Content-ID claim work),
 * storefront custom domains at the Marketplace stand, site plan
 * subscriptions (Pro/Elite), and the full paginated credit-history
 * ledger.
 *
 * The law, same as wave I: NOTHING is invented here. Every number,
 * price, fee and payload mirrors the 2D surface that owns the rail:
 * - Beats ride the beats page's own endpoints (GET /api/beats with
 *   its limit/offset filters, POST /api/beats/:id/license,
 *   POST /api/beats/licenses/verify, POST /api/beats, the seller
 *   dashboard and the license-template CRUD). The commission is the
 *   page's own line — "15% site commission on sales" (heroSubtitle)
 *   — displayed exactly where the page displays it (the subtitle and
 *   the dashboard's gross → net stats), never folded into a price.
 * - Tips ride the tip-jar rails the public tip page and the creator's
 *   Tip Jar page use (GET /api/tips/page/:handle, POST checkout with
 *   the 503 intent fallback, GET/POST /api/tips/settings,
 *   GET /api/tips/dashboard) — dollar tips through hosted checkout,
 *   exactly as 2D does them; Visual Buc tipping stays on the stage /
 *   live rails that already work in-world.
 * - Permanence rides the TrustPanels/DistributionLegacyPanels rails
 *   (PUT catalog + per-release elections, election ∈ permanent |
 *   standard — the server's own enum).
 * - Claim work rides the TrustPanels ClaimsPanel rail: PATCH
 *   /api/content-id/claims/:id { action, note } with the panel's own
 *   role/status gating (uploader disputes a pending match; owner
 *   accepts a pending match; owner resolves a disputed/accepted one
 *   — and resolve REQUIRES a note, the server 400s without one).
 * - Domains ride lib/domains' own helpers (the creator-domains
 *   page's rails: mine / claim / verify / delete + the DNS
 *   instructions rebuilt from the owner's verification token).
 * - Plans ride the creator-pricing page's rails: the catalog is
 *   READ from GET /api/creator-tiers/plans (prices are never
 *   hardcoded here — the page reads them the same way; verified in
 *   code 2026-10-23: platform-fees TIER_PLANS Pro $12 / Elite $29),
 *   the caller's state from GET /api/creator-tiers/me, checkout via
 *   POST /api/creator-tiers/checkout { tier, returnTo } and the
 *   billing portal via POST /api/creator-tiers/portal — hosted
 *   pages open in a new tab, the sanctioned exit.
 * - The full ledger paginates the SAME merged entries the
 *   EarningsBoard ledger builds (normalizeLedger over
 *   /api/credits/history + /api/payments/history — those endpoints
 *   return the member's full history; pagination here is the
 *   board's page-through, not a sliced "recent rows" cap).
 *
 * Everything here is pure (no fetch, no React) so the money math
 * and payload shaping are unit-tested; the components stay thin.
 */
import {
  defaultTermsForTier,
  describeTermsInline,
  templateTerms,
  type BeatLicenseTemplate,
  type BeatLicenseTerms,
} from "@/lib/beat-license-terms";
import type { LedgerEntry } from "./earnings-board";

export { apiErrorLine } from "./money-desks";

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** $ with exactly two decimals — the beats page's centsToDollars. */
export function moneyCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/* ─── 65 · Beats licensing marketplace ───────────────────────────── */

/** The beats page's own subtitle line — the 15% commission, in the
 *  page's words (en.json beats.heroSubtitle), shown at the station
 *  exactly as the page shows it under its title. */
export const BEATS_COMMISSION_LINE =
  "Producers list for free. Artists license in one click. 15% site commission on sales.";

/** The license modal's payment note, verbatim (en.json
 *  beats.paymentNote): the buyer finishes at hosted checkout and
 *  the license activates when the payment confirms. */
export const BEATS_PAYMENT_NOTE =
  "You'll finish at secure checkout (test mode). Your license activates the moment your payment confirms — no charge until you complete checkout.";

/** The browse page size — the rail's own default limit
 *  (beatFiltersSchema: limit 1–50, default 24). */
export const BEATS_PAGE_SIZE = 24;

export interface BeatFilters {
  genre: string;
  mood: string;
  search: string;
  minBpm: string;
  maxBpm: string;
}

/** GET /api/beats query — the page's exact param names, plus the
 *  rail's limit/offset pagination. Blank filters ride omitted,
 *  exactly as the page omits them. */
export function beatsBrowsePath(filters: BeatFilters, offset: number): string {
  const q = new URLSearchParams();
  if (filters.genre) q.set("genre", filters.genre);
  if (filters.mood) q.set("mood", filters.mood);
  if (filters.search) q.set("search", filters.search);
  if (filters.minBpm) q.set("minBpm", filters.minBpm);
  if (filters.maxBpm) q.set("maxBpm", filters.maxBpm);
  q.set("limit", String(BEATS_PAGE_SIZE));
  q.set("offset", String(Math.max(0, offset)));
  return `/api/beats?${q.toString()}`;
}

/** The genre list the page's filter offers (beats.tsx GENRES). */
export const BEAT_GENRES = [
  "hip-hop", "trap", "drill", "r&b", "afrobeats", "pop", "edm", "lofi", "rock", "latin",
] as const;

export interface BeatDto {
  id: string;
  producerId: string;
  title: string;
  audioUrl: string;
  previewUrl: string | null;
  genre: string;
  bpm: number | null;
  musicalKey: string | null;
  moodTags: string[];
  description: string | null;
  basicPriceCents: number;
  premiumPriceCents: number;
  exclusivePriceCents: number;
  exclusiveSold: boolean;
  plays: number;
  licenseTemplates: BeatLicenseTemplate[];
}

function parseTemplate(raw: unknown): BeatLicenseTemplate | null {
  if (!isObj(raw)) return null;
  const id = str(raw["id"]);
  if (!id) return null;
  const capOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const fmt = str(raw["format"]);
  return {
    id,
    producerId: str(raw["producerId"]) ?? "",
    name: str(raw["name"]) ?? "Custom license",
    priceCents: num(raw["priceCents"]) ?? 0,
    isExclusive: raw["isExclusive"] === true,
    format: (["mp3", "wav_mp3", "wav_mp3_stems", "ownership_stems"].includes(fmt ?? "")
      ? fmt
      : "mp3") as BeatLicenseTemplate["format"],
    streamsCap: capOrNull(raw["streamsCap"]),
    salesCap: capOrNull(raw["salesCap"]),
    musicVideosCap: capOrNull(raw["musicVideosCap"]),
    radioTvAllowed: raw["radioTvAllowed"] === true,
    livePerformancesCap: capOrNull(raw["livePerformancesCap"]),
    termYears: capOrNull(raw["termYears"]),
    territory: str(raw["territory"]) ?? "Worldwide",
    creditLine: str(raw["creditLine"]),
    termsNote: str(raw["termsNote"]),
    createdAt: str(raw["createdAt"]) ?? "",
    updatedAt: str(raw["updatedAt"]) ?? "",
  };
}

/** Parse one browse/dashboard beat row tolerantly — the wire is the
 *  DB row shape (snake_case) with the producer's templates attached
 *  as license_templates (camelCase DTOs). A row without an id or a
 *  title is no beat at all. */
export function parseBeat(raw: unknown): BeatDto | null {
  if (!isObj(raw)) return null;
  const id = str(raw["id"]);
  const title = str(raw["title"]);
  if (!id || !title) return null;
  const templates: BeatLicenseTemplate[] = [];
  if (Array.isArray(raw["license_templates"])) {
    for (const t of raw["license_templates"]) {
      const parsed = parseTemplate(t);
      if (parsed) templates.push(parsed);
    }
  }
  return {
    id,
    producerId: str(raw["user_id"]) ?? "",
    title,
    audioUrl: str(raw["audio_url"]) ?? "",
    previewUrl: str(raw["preview_url"]),
    genre: str(raw["genre"]) ?? "",
    bpm: num(raw["bpm"]),
    musicalKey: str(raw["musical_key"]),
    moodTags: Array.isArray(raw["mood_tags"])
      ? (raw["mood_tags"] as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
    description: str(raw["description"]),
    basicPriceCents: num(raw["basic_price_cents"]) ?? 0,
    premiumPriceCents: num(raw["premium_price_cents"]) ?? 0,
    exclusivePriceCents: num(raw["exclusive_price_cents"]) ?? 0,
    exclusiveSold: raw["exclusive_sold"] === true,
    plays: num(raw["plays"]) ?? 0,
    licenseTemplates: templates,
  };
}

export function parseBeatList(payload: unknown): BeatDto[] {
  if (!isObj(payload) || !Array.isArray(payload["beats"])) return [];
  const out: BeatDto[] = [];
  for (const raw of payload["beats"]) {
    const beat = parseBeat(raw);
    if (beat) out.push(beat);
  }
  return out;
}

/** The three fixed tiers, in the page's order, with the page's own
 *  blurbs (en.json beats.tier*Blurb) and terms lines rendered from
 *  the shared terms mirror — display only; the server snapshots the
 *  binding terms at purchase. */
export interface BeatTierOffer {
  key: "basic" | "premium" | "exclusive";
  label: string;
  blurb: string;
  termsLine: string;
  priceCents: number;
  soldOut: boolean;
}

export function beatTierOffers(beat: BeatDto): BeatTierOffer[] {
  const tiers: Array<{ key: BeatTierOffer["key"]; label: string; blurb: string; priceCents: number }> = [
    { key: "basic", label: "Basic", blurb: "MP3 lease · 1 music video · 50k streams", priceCents: beat.basicPriceCents },
    { key: "premium", label: "Premium", blurb: "WAV + MP3 · 2 music videos · 500k streams", priceCents: beat.premiumPriceCents },
    { key: "exclusive", label: "Exclusive", blurb: "Full ownership · stems · unlimited", priceCents: beat.exclusivePriceCents },
  ];
  return tiers.map((t) => ({
    ...t,
    termsLine: describeTermsInline(defaultTermsForTier(t.key)),
    soldOut: t.key === "exclusive" && beat.exclusiveSold,
  }));
}

/** A custom template as a license offer — sold out under the same
 *  exclusive rule the page applies (an exclusive template can't
 *  sell once the beat's exclusive is gone). */
export function beatTemplateOffer(beat: BeatDto, tpl: BeatLicenseTemplate): {
  id: string; name: string; priceCents: number; termsLine: string; soldOut: boolean;
} {
  return {
    id: tpl.id,
    name: tpl.name,
    priceCents: tpl.priceCents,
    termsLine: describeTermsInline(templateTerms(tpl)),
    soldOut: tpl.isExclusive && beat.exclusiveSold,
  };
}

/** POST /api/beats/:id/license — exactly ONE offer, the page's body:
 *  { templateId } for a custom template, else { tier }. */
export function beatLicensePayload(offer: { tier?: string; templateId?: string }): { tier: string } | { templateId: string } {
  return offer.templateId ? { templateId: offer.templateId } : { tier: offer.tier ?? "basic" };
}

export function beatLicensePath(beatId: string): string {
  return `/api/beats/${encodeURIComponent(beatId)}/license`;
}

/** The hosted checkout URL a license start answers with
 *  ({ checkoutUrl }) — null when no payment page was handed back. */
export function beatCheckoutUrl(payload: unknown): string | null {
  if (!isObj(payload)) return null;
  return str(payload["checkoutUrl"]);
}

/** The session id a license start answers with ({ sessionId }) —
 *  the verify rail's input when the walker returns from checkout. */
export function beatCheckoutSessionId(payload: unknown): string | null {
  if (!isObj(payload)) return null;
  return str(payload["sessionId"]);
}

/** POST /api/beats/licenses/verify's verdict, in the page's words:
 *  success only when the rail confirms ({ success: true }). */
export function beatVerifyConfirmed(payload: unknown): boolean {
  return isObj(payload) && payload["success"] === true;
}

export interface BeatSale {
  id: string;
  tier: string;
  /** The purchase-time terms snapshot (dashboard rows carry it as
   *  terms_snapshot; the licenses/mine DTO calls it terms). */
  terms: BeatLicenseTerms | null;
  priceCents: number;
  status: string;
  createdAt: string | null;
}

export function parseBeatSale(raw: unknown): BeatSale | null {
  if (!isObj(raw)) return null;
  const id = str(raw["id"]);
  if (!id) return null;
  const termsRaw = raw["terms"] ?? raw["terms_snapshot"];
  return {
    id,
    tier: str(raw["tier"]) ?? "",
    terms: isObj(termsRaw) ? (termsRaw as unknown as BeatLicenseTerms) : null,
    priceCents: num(raw["priceCents"]) ?? num(raw["price_cents"]) ?? 0,
    status: str(raw["status"]) ?? "",
    createdAt: str(raw["createdAt"]) ?? str(raw["created_at"]),
  };
}

export interface BeatDashboard {
  beats: BeatDto[];
  sales: BeatSale[];
  stats: { beatCount: number; saleCount: number; grossCents: number; netCents: number } | null;
}

/** GET /api/beats/mine/dashboard — one payload: my beats + sales +
 *  stats (gross/net already net of the 15% commission server-side). */
export function parseBeatDashboard(payload: unknown): BeatDashboard {
  if (!isObj(payload)) return { beats: [], sales: [], stats: null };
  const beats = Array.isArray(payload["beats"])
    ? (payload["beats"] as unknown[]).map(parseBeat).filter((b): b is BeatDto => b !== null)
    : [];
  const sales = Array.isArray(payload["sales"])
    ? (payload["sales"] as unknown[]).map(parseBeatSale).filter((s): s is BeatSale => s !== null)
    : [];
  let stats: BeatDashboard["stats"] = null;
  if (isObj(payload["stats"])) {
    const s = payload["stats"];
    stats = {
      beatCount: num(s["beatCount"]) ?? 0,
      saleCount: num(s["saleCount"]) ?? 0,
      grossCents: num(s["grossCents"]) ?? 0,
      netCents: num(s["netCents"]) ?? 0,
    };
  }
  return { beats, sales, stats };
}

/** GET /api/beats/licenses/mine — the buyer's own licenses. */
export function parseMyLicenses(payload: unknown): BeatSale[] {
  if (!isObj(payload) || !Array.isArray(payload["licenses"])) return [];
  return (payload["licenses"] as unknown[]).map(parseBeatSale).filter((s): s is BeatSale => s !== null);
}

/** A sale's status in the page's dress: pending_payment reads as
 *  the page's "payment coming soon" state token — here, plainly
 *  "Pending payment"; completed stays "completed". */
export function beatSaleStatusLabel(status: string): string {
  return status === "pending_payment" ? "Pending payment" : status;
}

/* The sell form — the page's defaults and its exact POST body. */

export interface BeatListingForm {
  title: string;
  audioUrl: string;
  genre: string;
  bpm: string;
  musicalKey: string;
  moodTags: string;
  description: string;
  basicPrice: string;
  premiumPrice: string;
  exclusivePrice: string;
}

/** The page's fresh-form defaults (prices start at its presets). */
export function emptyBeatListingForm(): BeatListingForm {
  return {
    title: "",
    audioUrl: "",
    genre: "hip-hop",
    bpm: "",
    musicalKey: "",
    moodTags: "",
    description: "",
    basicPrice: "29.99",
    premiumPrice: "99.99",
    exclusivePrice: "499.99",
  };
}

export function beatListingProblem(form: BeatListingForm): string | null {
  if (!form.title.trim() || !form.audioUrl.trim()) return "A listing needs a title and an audio URL.";
  for (const [label, v] of [["Basic", form.basicPrice], ["Premium", form.premiumPrice], ["Exclusive", form.exclusivePrice]] as const) {
    const n = Number(v);
    if (v.trim() === "" || !Number.isFinite(n) || n < 0) return `Enter a ${label} price of $0 or more.`;
  }
  return null;
}

/** POST /api/beats — the page's exact body (listing is free). */
export function buildBeatListingPayload(form: BeatListingForm): Record<string, unknown> | null {
  if (beatListingProblem(form)) return null;
  return {
    title: form.title.trim(),
    audioUrl: form.audioUrl.trim(),
    genre: form.genre,
    bpm: form.bpm ? Number(form.bpm) : undefined,
    musicalKey: form.musicalKey.trim() || undefined,
    moodTags: form.moodTags.split(",").map((t) => t.trim()).filter(Boolean),
    description: form.description.trim() || undefined,
    basicPriceCents: Math.round(Number(form.basicPrice) * 100),
    premiumPriceCents: Math.round(Number(form.premiumPrice) * 100),
    exclusivePriceCents: Math.round(Number(form.exclusivePrice) * 100),
  };
}

/* Custom license templates — the producer's own offers. The form
 *  mirrors LicenseTemplatesSection's TemplateFormState and its
 *  formToPayload verbatim (blank cap = null = uncapped). */

export interface BeatTemplateForm {
  name: string;
  priceDollars: string;
  format: string;
  streamsCap: string;
  salesCap: string;
  musicVideosCap: string;
  radioTvAllowed: boolean;
  livePerformancesCap: string;
  termYears: string;
  territory: string;
  creditLine: string;
  termsNote: string;
  isExclusive: boolean;
}

export function emptyBeatTemplateForm(): BeatTemplateForm {
  return {
    name: "",
    priceDollars: "",
    format: "mp3",
    streamsCap: "",
    salesCap: "",
    musicVideosCap: "",
    radioTvAllowed: false,
    livePerformancesCap: "",
    termYears: "",
    territory: "Worldwide",
    creditLine: "",
    termsNote: "",
    isExclusive: false,
  };
}

export function beatTemplateFormFromDto(tpl: BeatLicenseTemplate): BeatTemplateForm {
  const cap = (v: number | null) => (v === null ? "" : String(v));
  return {
    name: tpl.name,
    priceDollars: (tpl.priceCents / 100).toFixed(2),
    format: tpl.format,
    streamsCap: cap(tpl.streamsCap),
    salesCap: cap(tpl.salesCap),
    musicVideosCap: cap(tpl.musicVideosCap),
    radioTvAllowed: tpl.radioTvAllowed,
    livePerformancesCap: cap(tpl.livePerformancesCap),
    termYears: tpl.termYears === null ? "" : String(tpl.termYears),
    territory: tpl.territory,
    creditLine: tpl.creditLine ?? "",
    termsNote: tpl.termsNote ?? "",
    isExclusive: tpl.isExclusive,
  };
}

/** POST/PATCH body — the page's formToPayload, verbatim. */
export function buildBeatTemplatePayload(form: BeatTemplateForm): Record<string, unknown> {
  const cap = (v: string) => {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
  };
  return {
    name: form.name.trim(),
    priceCents: Math.round(Number(form.priceDollars || "0") * 100),
    format: form.format,
    streamsCap: cap(form.streamsCap),
    salesCap: cap(form.salesCap),
    musicVideosCap: cap(form.musicVideosCap),
    radioTvAllowed: form.radioTvAllowed,
    livePerformancesCap: cap(form.livePerformancesCap),
    termYears: cap(form.termYears),
    territory: form.territory.trim() || "Worldwide",
    creditLine: form.creditLine.trim() === "" ? null : form.creditLine.trim(),
    termsNote: form.termsNote.trim() === "" ? null : form.termsNote.trim(),
    isExclusive: form.isExclusive,
  };
}

export function beatTemplateProblem(form: BeatTemplateForm): string | null {
  if (!form.name.trim()) return "Give the license a name first.";
  const price = Number(form.priceDollars || "0");
  if (!Number.isFinite(price) || price < 0) return "Enter a price of $0 or more.";
  return null;
}

/** GET /api/beats/license-templates/mine → the caller's templates. */
export function parseMyTemplates(payload: unknown): BeatLicenseTemplate[] {
  if (!isObj(payload) || !Array.isArray(payload["templates"])) return [];
  const out: BeatLicenseTemplate[] = [];
  for (const raw of payload["templates"]) {
    const tpl = parseTemplate(raw);
    if (tpl) out.push(tpl);
  }
  return out;
}

/* ─── 66 · Tip any creator + the tip-jar desk ────────────────────── */

/** The tip page's amount bounds — the rail's own schema
 *  (tipIntentSchema: $1–$10,000). Display/gate only; the server
 *  re-validates every send. */
export const TIP_MIN_DOLLARS = 1;
export const TIP_MAX_DOLLARS = 10_000;

export interface TipPageData {
  handle: string;
  displayName: string;
  message: string;
  suggestedAmounts: number[];
  goalAmount: number | null;
  goalLabel: string;
  totalDollars: number;
  tipCount: number;
  goalProgress: number | null;
  /** Paid-tips-only dollars raised toward the goal (payload.goal),
      when the server could read the tip records. The goal line pairs
      THIS with goalProgress — never the intent total. */
  goalRaisedDollars: number | null;
  paymentsLive: boolean;
  /** The API's own honesty notice — rendered verbatim, never
   *  paraphrased (the tip page renders data.notice as-is). */
  notice: string;
}

/** GET /api/tips/page/:handle — the public tip page payload. Null
 *  when the payload doesn't honestly carry a page (the component
 *  treats a 404 the same way: no tip jar at this handle). */
export function parseTipPage(payload: unknown): TipPageData | null {
  if (!isObj(payload) || !isObj(payload["page"])) return null;
  const page = payload["page"];
  const handle = str(page["handle"]);
  const displayName = str(page["displayName"]);
  if (!handle || !displayName) return null;
  const stats = isObj(payload["stats"]) ? payload["stats"] : {};
  const amounts = Array.isArray(page["suggestedAmounts"])
    ? (page["suggestedAmounts"] as unknown[]).filter((x): x is number => typeof x === "number" && Number.isFinite(x))
    : [];
  return {
    handle,
    displayName,
    message: str(page["message"]) ?? "",
    suggestedAmounts: amounts,
    goalAmount: num(page["goalAmount"]),
    goalLabel: str(page["goalLabel"]) ?? "",
    totalDollars: num(stats["total"]) ?? 0,
    tipCount: num(stats["count"]) ?? 0,
    goalProgress: num(stats["goalProgress"]),
    goalRaisedDollars: isObj(payload["goal"]) ? num(payload["goal"]["raised"]) : null,
    paymentsLive: payload["paymentsLive"] === true,
    notice: str(payload["notice"]) ?? "",
  };
}

export function tipPagePath(handle: string): string {
  return `/api/tips/page/${encodeURIComponent(handle)}`;
}
export function tipCheckoutPath(handle: string): string {
  return `/api/tips/${encodeURIComponent(handle)}/checkout`;
}
export function tipIntentPath(handle: string): string {
  return `/api/tips/${encodeURIComponent(handle)}/tip`;
}

/** The send body both tip rails take (checkout + intent):
 *  { amount, fanName, message } — the page's exact shape. */
export function tipSendPayload(amountDollars: number, fanName: string, message: string): {
  amount: number; fanName: string; message: string;
} {
  return { amount: amountDollars, fanName: fanName.trim(), message: message.trim() };
}

/** The hosted checkout URL a tip checkout answers with
 *  ({ checkoutUrl }) — null when none was handed back (the caller
 *  then falls back to recording intent, the page's own rule). */
export function tipCheckoutUrl(payload: unknown): string | null {
  if (!isObj(payload)) return null;
  return str(payload["checkoutUrl"]);
}

export function tipAmountProblem(amountDollars: number | null): string | null {
  if (amountDollars === null || !Number.isFinite(amountDollars) || amountDollars <= 0) {
    return "Pick or enter an amount first.";
  }
  if (amountDollars < TIP_MIN_DOLLARS) return `Minimum tip is $${TIP_MIN_DOLLARS}.`;
  if (amountDollars > TIP_MAX_DOLLARS) return `Maximum tip is $${TIP_MAX_DOLLARS.toLocaleString("en-US")}.`;
  return null;
}

/* The creator's own tip-jar settings + dashboard (the Tip Jar
 *  page's rails). */

export interface TipSettingsForm {
  handle: string;
  displayName: string;
  message: string;
  /** Suggested amounts as typed ("5, 10, 25") — the page's form. */
  suggested: string;
  goalAmount: string;
  goalLabel: string;
}

/** The page's fresh-form default for the suggested amounts. */
export const TIP_SUGGESTED_DEFAULT = "5, 10, 25";

export function tipSettingsFormFrom(payload: unknown): TipSettingsForm | null {
  if (!isObj(payload) || !isObj(payload["settings"])) return null;
  const s = payload["settings"];
  const handle = str(s["handle"]);
  if (!handle) return null;
  const amounts = Array.isArray(s["suggestedAmounts"])
    ? (s["suggestedAmounts"] as unknown[]).filter((x): x is number => typeof x === "number")
    : [];
  return {
    handle,
    displayName: str(s["displayName"]) ?? "",
    message: str(s["message"]) ?? "",
    suggested: amounts.length ? amounts.join(", ") : TIP_SUGGESTED_DEFAULT,
    goalAmount: num(s["goalAmount"]) !== null ? String(num(s["goalAmount"])) : "",
    goalLabel: str(s["goalLabel"]) ?? "",
  };
}

/** POST /api/tips/settings — the page's exact save body: suggested
 *  amounts parsed from the typed list (positives only), falling
 *  back to [5, 10, 25] when the list parses empty — verbatim. */
export function buildTipSettingsPayload(form: TipSettingsForm): Record<string, unknown> {
  const suggestedAmounts = form.suggested
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x > 0);
  return {
    handle: form.handle,
    displayName: form.displayName,
    message: form.message,
    suggestedAmounts: suggestedAmounts.length ? suggestedAmounts : [5, 10, 25],
    goalAmount: form.goalAmount.trim() ? Number(form.goalAmount) : null,
    goalLabel: form.goalLabel,
  };
}

export interface TipJarDashboard {
  hasPage: boolean;
  handle: string | null;
  total: number;
  count: number;
  average: number;
  goalAmount: number | null;
  goalLabel: string;
  goalProgress: number | null;
  /** Paid-tips-only dollars raised toward the goal (payload.goal) —
      pairs with goalProgress on the goal line, never the intent total. */
  goalRaisedDollars: number | null;
  paymentsLive: boolean;
  feed: Array<{ id: string; amount: number; fanName: string; message: string; status: string; createdAt: string | null }>;
}

/** GET /api/tips/dashboard — totals + the recent tip feed. Null
 *  when the payload carries no dashboard at all. */
export function parseTipJarDashboard(payload: unknown): TipJarDashboard | null {
  if (!isObj(payload)) return null;
  const feed: TipJarDashboard["feed"] = [];
  if (Array.isArray(payload["feed"])) {
    for (const raw of payload["feed"]) {
      if (!isObj(raw)) continue;
      const id = str(raw["id"]);
      if (!id) continue;
      feed.push({
        id,
        amount: num(raw["amount"]) ?? 0,
        fanName: str(raw["fanName"]) ?? "",
        message: str(raw["message"]) ?? "",
        status: str(raw["status"]) ?? "",
        createdAt: str(raw["createdAt"]),
      });
    }
  }
  return {
    hasPage: payload["hasPage"] === true,
    handle: str(payload["handle"]),
    total: num(payload["total"]) ?? 0,
    count: num(payload["count"]) ?? 0,
    average: num(payload["average"]) ?? 0,
    goalAmount: num(payload["goalAmount"]),
    goalLabel: str(payload["goalLabel"]) ?? "",
    goalProgress: num(payload["goalProgress"]),
    goalRaisedDollars: isObj(payload["goal"]) ? num(payload["goal"]["raised"]) : null,
    paymentsLive: payload["paymentsLive"] === true,
    feed,
  };
}

/** A feed row's status in the dashboard's words: pending_payment
 *  is intent recorded, never money received. */
export function tipFeedStatusLabel(status: string): string {
  return status === "pending_payment" ? "Intent recorded" : status;
}

/* ─── 67 · Money management: permanence + Content-ID claims ──────── */

export type PermanenceElection = "permanent" | "standard";

export interface PermanenceState {
  catalogElection: string | null;
  releases: Array<{ rowId: string; releaseId: string; title: string; election: string }>;
  covers: string[];
  excludes: string[];
}

/** GET /api/distribution/permanence — the full management read:
 *  catalog election, per-release elections WITH their release ids
 *  (the write rail needs them), and the guarantee's covers/excludes
 *  copy the 2D panels render from the same payload. */
export function parsePermanenceState(payload: unknown): PermanenceState | null {
  if (!isObj(payload)) return null;
  const catalog = isObj(payload["catalog"]) ? str(payload["catalog"]["election"]) : null;
  const releases: PermanenceState["releases"] = [];
  if (Array.isArray(payload["releases"])) {
    for (const raw of payload["releases"]) {
      if (!isObj(raw)) continue;
      const releaseId = str(raw["releaseId"]);
      const election = str(raw["election"]);
      if (!releaseId || !election) continue;
      releases.push({
        rowId: str(raw["id"]) ?? releaseId,
        releaseId,
        title: str(raw["releaseTitle"]) ?? "Release",
        election,
      });
    }
  }
  const stringList = (v: unknown): string[] =>
    Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return {
    catalogElection: catalog,
    releases,
    covers: stringList(payload["covers"]),
    excludes: stringList(payload["excludes"]),
  };
}

export function catalogPermanencePath(): string {
  return "/api/distribution/permanence/catalog";
}
export function releasePermanencePath(releaseId: string): string {
  return `/api/distribution/releases/${encodeURIComponent(releaseId)}/permanence`;
}
/** PUT body — { election } with the server's enum only. */
export function permanencePayload(election: PermanenceElection): { election: PermanenceElection } {
  return { election };
}
/** The other election — a release row's toggle (TrustPanels flips
 *  permanent ⇄ standard the same way). */
export function otherElection(election: string): PermanenceElection {
  return election === "permanent" ? "standard" : "permanent";
}

export interface ClaimRow {
  id: string;
  label: string;
  /** "uploader" | "owner" — which side of the match the caller is. */
  youAre: string;
  status: string;
  detail: string;
  disputeNote: string | null;
  resolutionNote: string | null;
}

/** GET /api/content-id/claims — the ClaimsPanel's rows, fuller than
 *  the board's status summary: role, notes and evidence ride along
 *  because the actions below are gated on them. */
export function parseClaimRows(payload: unknown): ClaimRow[] {
  if (!isObj(payload) || !Array.isArray(payload["claims"])) return [];
  const out: ClaimRow[] = [];
  for (const raw of payload["claims"]) {
    if (!isObj(raw)) continue;
    const id = str(raw["id"]);
    if (!id) continue;
    const parts: string[] = [];
    const offset = num(raw["offsetSeconds"]);
    const conf = num(raw["confidence"]);
    const matched = num(raw["matchedLandmarks"]);
    const total = num(raw["totalLandmarks"]);
    if (offset !== null) parts.push(`matched at ${offset}s`);
    if (conf !== null) parts.push(`confidence ${conf}`);
    if (matched !== null && total !== null) parts.push(`${matched} of ${total} landmarks matched`);
    out.push({
      id,
      label: str(raw["sourceLabel"]) ?? "Upload",
      youAre: str(raw["youAre"]) ?? "",
      status: str(raw["status"]) ?? "unknown",
      detail: parts.join(" · "),
      disputeNote: str(raw["disputeNote"]),
      resolutionNote: str(raw["resolutionNote"]),
    });
  }
  return out;
}

export type ClaimAction = "dispute" | "accept" | "resolve";

/** The ClaimsPanel's gating, verbatim: dispute is the UPLOADER's
 *  move on a pending match; accept is the OWNER's on a pending
 *  match; resolve is the OWNER's once a match is disputed or
 *  accepted. Resolved claims offer nothing. */
export function claimActionsFor(claim: ClaimRow): ClaimAction[] {
  if (claim.status === "resolved") return [];
  const actions: ClaimAction[] = [];
  if (claim.youAre === "uploader" && claim.status === "pending") actions.push("dispute");
  if (claim.youAre === "owner" && claim.status === "pending") actions.push("accept");
  if (claim.youAre === "owner" && (claim.status === "disputed" || claim.status === "accepted")) actions.push("resolve");
  return actions;
}

/** PATCH /api/content-id/claims/:id body — { action, note }. A
 *  resolve REQUIRES a note (the server 400s without one — the
 *  panel's input placeholder says the same); the gate here refuses
 *  the doomed call in the desk's own words first. */
export function claimActionProblem(action: ClaimAction, note: string): string | null {
  if (action === "resolve" && !note.trim()) return "Add a note first — a resolution records its reason.";
  return null;
}
export function claimActionPayload(action: ClaimAction, note: string): { action: ClaimAction; note: string } {
  return { action, note: note ?? "" };
}
export function claimActionPath(id: string): string {
  return `/api/content-id/claims/${encodeURIComponent(id)}`;
}
export const CLAIM_ACTION_LABELS: Record<ClaimAction, string> = {
  dispute: "Dispute",
  accept: "Accept match",
  resolve: "Resolve with note",
};

/* ─── 69 · Site plan subscriptions (Pro / Elite) ─────────────────── */

export interface SitePlan {
  tier: string;
  name: string;
  tagline: string;
  /** Null = the free plan (no checkout exists for it). */
  priceUsdPerMonth: number | null;
  feePct: number;
  aiBoostsPerMonth: number;
  features: string[];
  /** Whether the rail can actually sell it today (its Stripe price
   *  is configured server-side) — the plans DTO's own flag
   *  (priceConfigured). */
  purchasable: boolean;
}

/** The plans payload's own note line — the rail carries an honesty
 *  note ("…Stripe TEST mode only") and the desk renders it verbatim
 *  rather than paraphrasing it away. */
export function plansNote(payload: unknown): string | null {
  if (!isObj(payload)) return null;
  return str(payload["note"]);
}

/** GET /api/creator-tiers/plans — the catalog READ from the rail,
 *  never a local price table: name, monthly price, fee and boosts
 *  all ride the payload (the creator-pricing page renders the same
 *  DTO). A payload without a plans array is no catalog (null). */
export function parseSitePlans(payload: unknown): SitePlan[] | null {
  if (!isObj(payload) || !Array.isArray(payload["plans"])) return null;
  const out: SitePlan[] = [];
  for (const raw of payload["plans"]) {
    if (!isObj(raw)) continue;
    const tier = str(raw["tier"]);
    if (!tier) continue;
    const feeBps = num(raw["feeBps"]);
    const features = Array.isArray(raw["features"])
      ? (raw["features"] as unknown[])
          .map((f) => (isObj(f) ? str(f["label"]) : str(f)))
          .filter((x): x is string => x !== null)
      : [];
    out.push({
      tier,
      name: str(raw["name"]) ?? tier,
      tagline: str(raw["tagline"]) ?? "",
      priceUsdPerMonth: num(raw["priceUsdPerMonth"]),
      feePct: feeBps !== null ? feeBps / 100 : 0,
      aiBoostsPerMonth: num(raw["aiBoostsPerMonth"]) ?? 0,
      features,
      purchasable: raw["priceConfigured"] !== false,
    });
  }
  return out;
}

export interface SitePlanMe {
  tier: string;
  status: string;
  feePct: number;
  aiBoostsPerMonth: number;
  currentPeriodEnd: string | null;
}

/** GET /api/creator-tiers/me — the caller's current plan truth. */
export function parseSitePlanMe(payload: unknown): SitePlanMe | null {
  if (!isObj(payload)) return null;
  const tier = str(payload["tier"]);
  if (!tier) return null;
  return {
    tier,
    status: str(payload["status"]) ?? "active",
    feePct: num(payload["feePct"]) ?? (num(payload["feeBps"]) !== null ? (num(payload["feeBps"]) as number) / 100 : 0),
    aiBoostsPerMonth: num(payload["aiBoostsPerMonth"]) ?? 0,
    currentPeriodEnd: str(payload["currentPeriodEnd"]),
  };
}

/** POST /api/creator-tiers/checkout — the pricing page's exact
 *  body: { tier, returnTo }. The in-world returnTo is the palace
 *  itself, so a finished checkout lands the walker back at /world. */
export function planCheckoutPayload(tier: string): { tier: string; returnTo: string } {
  return { tier, returnTo: "/world" };
}

/** The hosted URL a checkout/portal call answers with ({ url }). */
export function planHostedUrl(payload: unknown): string | null {
  if (!isObj(payload)) return null;
  return str(payload["url"]);
}

/** A plan card's price line, the pricing page's dress: "$12/mo" for
 *  a paid plan, "Free" for the free tier. */
export function planPriceLabel(plan: SitePlan): string {
  return plan.priceUsdPerMonth === null ? "Free" : `$${plan.priceUsdPerMonth}/mo`;
}

/* ─── 70 · The full credit-history ledger, paginated ─────────────── */

/** Rows per ledger page at the history desk. */
export const LEDGER_PAGE_SIZE = 20;

export interface LedgerPage {
  rows: LedgerEntry[];
  page: number;
  pageCount: number;
  total: number;
}

/** One page of the FULL merged ledger (normalizeLedger's output —
 *  the whole history from /api/credits/history +
 *  /api/payments/history, not a recent-rows slice). The page index
 *  clamps into range, so a shrinking list can never strand the
 *  walker on a page that no longer exists. */
export function ledgerPage(entries: readonly LedgerEntry[], page: number, pageSize: number = LEDGER_PAGE_SIZE): LedgerPage {
  const total = entries.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const clamped = Math.min(Math.max(0, Math.floor(page) || 0), pageCount - 1);
  return {
    rows: entries.slice(clamped * pageSize, clamped * pageSize + pageSize),
    page: clamped,
    pageCount,
    total,
  };
}
