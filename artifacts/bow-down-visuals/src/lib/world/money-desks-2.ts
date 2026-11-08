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
 *   dashboard and the license-template CRUD) — plus the dashboard
 *   BeatRow's AI-tags pair (POST /api/beats/:id/ai-tags → PATCH
 *   /api/beats/:id { genre, moodTags }, stack1200 parity). The commission is the
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
import { apiErrorLine } from "./money-desks";
import { CheckoutTransportError, checkoutFailureCopy } from "../checkout-fetch";

export { apiErrorLine };

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
  /** Boolean only (stack1400 ruling #2): whether stems are on file.
      The stems URL never rides a public read; this flag is what lets
      the desk mark stems-format offers unavailable, mirroring the
      server's offers shelf. */
  hasStems: boolean;
  plays: number;
  licenseTemplates: BeatLicenseTemplate[];
}

/** A license format that promises the buyer the separate track stems. */
export function isStemsLicenseFormat(format: string): boolean {
  return format === "wav_mp3_stems" || format === "ownership_stems";
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
    /* The server's has_stems boolean is the source; an unmasked
       stems_url/stems_path (the producer's own dashboard rows) also
       proves stems are on file. */
    hasStems:
      raw["has_stems"] === true ||
      (typeof raw["stems_url"] === "string" && raw["stems_url"].length > 0) ||
      (typeof raw["stems_path"] === "string" && raw["stems_path"].length > 0),
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
 *  binding terms at purchase. Sold-out rule (stack1100 X4, C1): an
 *  exclusive sale closes the WHOLE market — the server 409s every
 *  offer on an exclusive-sold beat and the offers rail marks every
 *  offer unavailable, so every tier reads sold out here too, not
 *  just the exclusive tier. */
interface BeatTierOffer {
  key: "basic" | "premium" | "exclusive";
  label: string;
  blurb: string;
  termsLine: string;
  priceCents: number;
  soldOut: boolean;
  /** True when this offer is unavailable specifically because its
      format includes stems and the beat has none on file (ruling
      #2) — distinct from soldOut-by-exclusive-sale so the desk can
      say "No stems on file" instead of "Sold out". */
  stemsBlocked: boolean;
}

export function beatTierOffers(beat: BeatDto): BeatTierOffer[] {
  const tiers: Array<{ key: BeatTierOffer["key"]; label: string; blurb: string; priceCents: number }> = [
    { key: "basic", label: "Basic", blurb: "MP3 lease · 1 music video · 50k streams", priceCents: beat.basicPriceCents },
    { key: "premium", label: "Premium", blurb: "2 music videos · 500k streams", priceCents: beat.premiumPriceCents },
    { key: "exclusive", label: "Exclusive", blurb: "Full ownership · stems · unlimited", priceCents: beat.exclusivePriceCents },
  ];
  return tiers.map((t) => {
    /* Mirror of the server's available flag (ruling #2): a
       stems-format tier (Exclusive = ownership_stems) is unavailable
       when the beat has no stems on file; other tiers stay buyable. */
    const stemsBlocked = isStemsLicenseFormat(defaultTermsForTier(t.key).format) && !beat.hasStems;
    return {
      ...t,
      termsLine: describeTermsInline(defaultTermsForTier(t.key)),
      soldOut: beat.exclusiveSold || stemsBlocked,
      stemsBlocked,
    };
  });
}

/** A custom template as a license offer — under the same whole-market
 *  rule as the tiers (stack1100 X4, C1): once the beat's exclusive
 *  has sold, NO template sells either, exclusive or not — the page's
 *  modal disables every template on a sold beat and the server 409s
 *  the POST. */
export function beatTemplateOffer(beat: BeatDto, tpl: BeatLicenseTemplate): {
  id: string; name: string; priceCents: number; termsLine: string; soldOut: boolean; stemsBlocked: boolean;
} {
  /* Same mirror as the tiers: a stems-format template is unavailable
     when the beat has no stems on file (ruling #2). */
  const stemsBlocked = isStemsLicenseFormat(tpl.format) && !beat.hasStems;
  return {
    id: tpl.id,
    name: tpl.name,
    priceCents: tpl.priceCents,
    termsLine: describeTermsInline(templateTerms(tpl)),
    soldOut: beat.exclusiveSold || stemsBlocked,
    stemsBlocked,
  };
}

/** Is the desk's currently selected offer (a tier key, or
 *  "tpl:<id>" for a template) unavailable on this beat — by the
 *  exclusive sale OR by the stems guard (ruling #2)? The desk's buy
 *  button disables on this, mirroring the server's available flag. */
export function beatSelectedOfferUnavailable(beat: BeatDto, offerKey: string): boolean {
  if (offerKey.startsWith("tpl:")) {
    const tpl = beat.licenseTemplates.find((t) => t.id === offerKey.slice(4));
    return tpl ? beatTemplateOffer(beat, tpl).soldOut : beat.exclusiveSold;
  }
  const tier = beatTierOffers(beat).find((o) => o.key === offerKey);
  return tier ? tier.soldOut : beat.exclusiveSold;
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
  /** Buyer-library fields (licenses/mine rows only, stack1100 X4):
   *  every row names its beat, and the delivery URLs ride completed
   *  licenses only — the server leaves them null otherwise, so a
   *  non-null value here IS the entitlement. Dashboard sales rows
   *  carry none of these and parse null. */
  beatTitle: string | null;
  downloadUrl: string | null;
  stemsUrl: string | null;
}

function parseBeatSale(raw: unknown): BeatSale | null {
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
    beatTitle: str(raw["beatTitle"]),
    downloadUrl: str(raw["downloadUrl"]),
    stemsUrl: str(raw["stemsUrl"]),
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

/** A sale's status in plain words (stack800 lane 3, QC Q15 family):
 *  pending_payment is a reserved license whose checkout hasn't been
 *  paid — "Pending payment"; completed means the payment confirmed
 *  and the license activated — "Paid". Any other internal token is
 *  never passed through raw. */
export function beatSaleStatusLabel(status: string): string {
  if (status === "pending_payment") return "Pending payment";
  if (status === "completed") return "Paid";
  /* 'refunded' is a KNOWN terminal state (the reversal engine flips
     a completed license to it and revokes the download) — naming it
     "Status unavailable" told the buyer/seller a settled fact was
     unknown (stack1100 X4). Only genuinely unrecognized tokens fall
     through to the honest unknown. */
  if (status === "refunded") return "Refunded";
  return "Status unavailable";
}

/* The sell form — the page's defaults and its exact POST body. */

export interface BeatListingForm {
  title: string;
  audioUrl: string;
  /** Optional preview + stems slots (stack1100 X4) — the page's form
   *  sends both; without a preview the public browse plays the full
   *  master as the "preview", and without stems no stems license can
   *  ever deliver. Blank = omitted from the payload, exactly as the
   *  page omits them. */
  previewUrl: string;
  stemsUrl: string;
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
    previewUrl: "",
    stemsUrl: "",
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

/** The listing form's problem lines, in the desk's words. The
 *  desk passes its active language's bundle (worldAudioDesk
 *  keys; tier names from the beats tier labels); other callers
 *  get these English defaults, byte-identical to the page copy. */
export interface BeatListingProblemStrings {
  needsTitleUrl: string;
  /** Template carrying one {{tier}} token. */
  priceLine: string;
  tierBasic: string;
  tierPremium: string;
  tierExclusive: string;
}

export const BEAT_LISTING_PROBLEM_STRINGS_EN: BeatListingProblemStrings = {
  needsTitleUrl: "A listing needs a title and an audio URL.",
  priceLine: "Enter a {{tier}} price of $0 or more.",
  tierBasic: "Basic",
  tierPremium: "Premium",
  tierExclusive: "Exclusive",
};

export function beatListingProblem(
  form: BeatListingForm,
  strings: BeatListingProblemStrings = BEAT_LISTING_PROBLEM_STRINGS_EN,
): string | null {
  if (!form.title.trim() || !form.audioUrl.trim()) return strings.needsTitleUrl;
  for (const [label, v] of [[strings.tierBasic, form.basicPrice], [strings.tierPremium, form.premiumPrice], [strings.tierExclusive, form.exclusivePrice]] as const) {
    const n = Number(v);
    if (v.trim() === "" || !Number.isFinite(n) || n < 0) return strings.priceLine.split("{{tier}}").join(label);
  }
  return null;
}

/** POST /api/beats — the page's exact body (listing is free),
 *  preview/stems included in the page's position and shape
 *  (trimmed, blank → undefined → omitted from the JSON). */
export function buildBeatListingPayload(form: BeatListingForm): Record<string, unknown> | null {
  if (beatListingProblem(form)) return null;
  return {
    title: form.title.trim(),
    audioUrl: form.audioUrl.trim(),
    previewUrl: form.previewUrl.trim() || undefined,
    stemsUrl: form.stemsUrl.trim() || undefined,
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

/** The template form's problem lines, in the desk's words —
 *  same strings-bundle rule as the listing form above. */
export interface BeatTemplateProblemStrings {
  needsName: string;
  priceInvalid: string;
}

export const BEAT_TEMPLATE_PROBLEM_STRINGS_EN: BeatTemplateProblemStrings = {
  needsName: "Give the license a name first.",
  priceInvalid: "Enter a price of $0 or more.",
};

export function beatTemplateProblem(
  form: BeatTemplateForm,
  strings: BeatTemplateProblemStrings = BEAT_TEMPLATE_PROBLEM_STRINGS_EN,
): string | null {
  if (!form.name.trim()) return strings.needsName;
  const price = Number(form.priceDollars || "0");
  if (!Number.isFinite(price) || price < 0) return strings.priceInvalid;
  return null;
}

/* ─── AI tag suggester — the dashboard BeatRow's affordance ───────
   The 2D dashboard's producer rows (pages/beats.tsx BeatRow) carry
   the page's only beat edit: POST /api/beats/:id/ai-tags suggests a
   genre + mood tags, and Apply PATCHes /api/beats/:id with exactly
   { genre, moodTags }. The suggester is a CHARGED rail: the server
   charges BEAT_AI_TAGS_CREDIT_COST (100 Visual Bucs, env-overridable
   via BEAT_AI_TAGS_CREDITS — beats-pricing.ts getBeatAiTagsCost)
   BEFORE generating and refunds on provider failure or empty
   output, in its own words on the error line. The desk mirrors the
   charge exactly — same endpoint, same price, named before the
   spend confirmation (the World's confirmedFetch law, the way the
   neighbouring charged desks pin their costs) — and never invents
   a second price. (The 2D button's label still reads "Tags · 1cr",
   a stale pre-×100 label; the rail's true charge is 100 and the
   desk names the true charge, per price-display honesty.) */

/** The suggester's pinned price — the server default in
 *  beats-pricing.ts (BEAT_AI_TAGS_CREDIT_COST = 100). */
export const BEAT_AI_TAGS_COST_VB = 100;

/** The server's own ledger name for the charge
 *  (chargeCreditsAtomic action: "Beat AI Tag Suggester") — the
 *  spend confirmation's feature label. */
export const BEAT_AI_TAGS_FEATURE = "Beat AI Tag Suggester";

export function beatAiTagsPath(beatId: string): string {
  return `/api/beats/${encodeURIComponent(beatId)}/ai-tags`;
}

/** PATCH /api/beats/:id — the producer metadata rail the BeatRow's
 *  Apply rides (owner-only server-side). */
export function beatPatchPath(beatId: string): string {
  return `/api/beats/${encodeURIComponent(beatId)}`;
}

export interface BeatAiTagSuggestion {
  genre: string;
  moodTags: string[];
}

/** Parse a suggester answer tolerantly, the BeatRow's own reading:
 *  genre falls back to the beat's current genre when the answer
 *  carries none, moodTags to an empty list. Null when the payload
 *  isn't an object at all — a shape the desk can't honestly show. */
export function parseBeatAiTagSuggestion(payload: unknown, fallbackGenre: string): BeatAiTagSuggestion | null {
  if (!isObj(payload)) return null;
  return {
    genre: str(payload["genre"]) ?? fallbackGenre,
    moodTags: Array.isArray(payload["moodTags"])
      ? (payload["moodTags"] as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
  };
}

export type BeatAiTagsOutcome =
  | { kind: "ok"; suggestion: BeatAiTagSuggestion }
  | { kind: "credits" }
  | { kind: "error"; message: string };

/** The suggester POST's verdict, in the BeatRow's order of checks:
 *  a 402 is the out-of-credits answer (the page opens its
 *  OutOfCredits surface; the desk names it in place — the server
 *  charged nothing, its balance pre-check runs before the charge);
 *  an OK answer parses into the suggestion; anything else STOPS
 *  with the server's own error line when it sent one (its 500 text
 *  already carries the refund note), else the desk's plain retry
 *  line. An OK answer in an unreadable shape is an error too,
 *  never a suggestion the desk invented. */
/** The suggester outcome's own words — the unreadable-shape line
 *  is refund copy (money law: the English source rides verbatim
 *  in every catalog) and the run-failed line is the error
 *  fallback; the desk passes its active language's pair. */
export interface BeatAiTagsOutcomeStrings {
  unreadable: string;
  runFailed: string;
}

export const BEAT_AI_TAGS_OUTCOME_STRINGS_EN: BeatAiTagsOutcomeStrings = {
  unreadable:
    "The suggester answered in a shape this desk can't read — the rail refunds failed generations; if Bucs left your balance, the refund lands on its own.",
  runFailed: "The tag suggester couldn't run — try again.",
};

export function beatAiTagsOutcome(
  result: { status: number; data: unknown },
  fallbackGenre: string,
  strings: BeatAiTagsOutcomeStrings = BEAT_AI_TAGS_OUTCOME_STRINGS_EN,
): BeatAiTagsOutcome {
  const { status, data } = result;
  if (status === 402) return { kind: "credits" };
  if (status >= 200 && status < 300) {
    const suggestion = parseBeatAiTagSuggestion(data, fallbackGenre);
    if (suggestion) return { kind: "ok", suggestion };
    return {
      kind: "error",
      message: strings.unreadable,
    };
  }
  return {
    kind: "error",
    message: apiErrorLine(data, strings.runFailed),
  };
}

/** PATCH body for Apply — the BeatRow's exact payload:
 *  { genre, moodTags } from the shown suggestion, nothing else. */
export function beatAiTagApplyPayload(suggestion: BeatAiTagSuggestion): { genre: string; moodTags: string[] } {
  return { genre: suggestion.genre, moodTags: suggestion.moodTags };
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
const TIP_MIN_DOLLARS = 1;
const TIP_MAX_DOLLARS = 10_000;

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

/* ─── Tip strings (stack100 locale unit 49) ───────────────────────
   The tip helpers below render through the catalogs under
   worldIdentityMisc.* (PortraitTip / TipJarDesk pass their
   bundles); the EN defaults are the original wording verbatim, so
   an unbundled caller (and every existing pin) reads exactly what
   it read before. The min/max lines are MONEY lines — the English
   source rides every catalog verbatim, figures by interpolation. */

export interface TipStrings {
  problemPickFirst: string;
  /** "Minimum tip is ${{amount}}." */
  problemMin: string;
  /** "Maximum tip is ${{amount}}." */
  problemMax: string;
  feedStatusIntent: string;
  feedStatusReceived: string;
  feedStatusUnavailable: string;
}

export const TIP_STRINGS_EN: TipStrings = {
  problemPickFirst: "Pick or enter an amount first.",
  problemMin: "Minimum tip is ${{amount}}.",
  problemMax: "Maximum tip is ${{amount}}.",
  feedStatusIntent: "Intent recorded",
  feedStatusReceived: "Received",
  feedStatusUnavailable: "Status unavailable",
};

export function tipAmountProblem(
  amountDollars: number | null,
  strings: TipStrings = TIP_STRINGS_EN,
  locale = "en-US",
): string | null {
  if (amountDollars === null || !Number.isFinite(amountDollars) || amountDollars <= 0) {
    return strings.problemPickFirst;
  }
  if (amountDollars < TIP_MIN_DOLLARS) {
    return strings.problemMin.replace("{{amount}}", String(TIP_MIN_DOLLARS));
  }
  if (amountDollars > TIP_MAX_DOLLARS) {
    return strings.problemMax.replace("{{amount}}", TIP_MAX_DOLLARS.toLocaleString(locale));
  }
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
const TIP_SUGGESTED_DEFAULT = "5, 10, 25";

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
 *  is intent recorded, never money received (every tip-jar intent
 *  carries it by design); a settled tip ("paid" on the tip rail,
 *  "completed" elsewhere) is "Received". Any other internal token
 *  is never passed through raw (stack800 lane 3, QC Q15 family). */
export function tipFeedStatusLabel(status: string, strings: TipStrings = TIP_STRINGS_EN): string {
  if (status === "pending_payment") return strings.feedStatusIntent;
  if (status === "paid" || status === "completed") return strings.feedStatusReceived;
  return strings.feedStatusUnavailable;
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

/** The claim detail line's templates — the English pair-set below
 *  is the source text; the catalogs carry the same templates under
 *  worldCoachMoney.maClaim*, and the desk hands the walker's
 *  language's set in (the questChipLine precedent). */
export interface ClaimDetailStrings {
  matchedAt: string;
  confidence: string;
  landmarks: string;
}

export const CLAIM_DETAIL_STRINGS_EN: ClaimDetailStrings = {
  matchedAt: "matched at {{seconds}}s",
  confidence: "confidence {{value}}",
  landmarks: "{{matched}} of {{total}} landmarks matched",
};

/** GET /api/content-id/claims — the ClaimsPanel's rows, fuller than
 *  the board's status summary: role, notes and evidence ride along
 *  because the actions below are gated on them. */
export function parseClaimRows(payload: unknown, detail: ClaimDetailStrings = CLAIM_DETAIL_STRINGS_EN): ClaimRow[] {
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
    if (offset !== null) parts.push(detail.matchedAt.replaceAll("{{seconds}}", String(offset)));
    if (conf !== null) parts.push(detail.confidence.replaceAll("{{value}}", String(conf)));
    if (matched !== null && total !== null) {
      parts.push(
        detail.landmarks
          .replaceAll("{{matched}}", String(matched))
          .replaceAll("{{total}}", String(total)),
      );
    }
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
export function claimActionProblem(
  action: ClaimAction,
  note: string,
  resolveNeedsNote = "Add a note first — a resolution records its reason.",
): string | null {
  if (action === "resolve" && !note.trim()) return resolveNeedsNote;
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
  /** Boosts used in the current month; null when the server didn't
      report them (an older build) — surfaces then show the quota
      alone, exactly as before stack300. */
  aiBoostsUsedThisMonth: number | null;
  /** Boosts left in the current month; null when unreported. */
  aiBoostsRemaining: number | null;
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
    aiBoostsUsedThisMonth: num(payload["aiBoostsUsedThisMonth"]),
    aiBoostsRemaining: num(payload["aiBoostsRemaining"]),
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

/** Optional localized strings for the plan-change family (locale
 *  unit 52): every default below is the current English literal,
 *  byte-identical, so an unthreaded caller renders exactly what it
 *  renders today. The charge lines are MONEY copy — the catalogs
 *  carry the English source verbatim in every locale. */
export interface PlanChangeStrings {
  freeLabel?: string;
  perMonth?: (price: number) => string;
  chargeToday?: (amount: string, from: string, to: string) => string;
  creditLine?: (amount: string, from: string) => string;
  nothingCharged?: string;
  startLine?: (to: string, renewal: string) => string;
  renewalStays?: (date: string) => string;
  sameRenewal?: string;
  renewalDateFormat?: (date: Date) => string;
  intentDidntStart?: string;
  changeDidntGoThrough?: string;
  failureCopy?: (status: number) => string;
}

/** A plan card's price line, the pricing page's dress: "$12/mo" for
 *  a paid plan, "Free" for the free tier. */
export function planPriceLabel(plan: SitePlan, strings?: PlanChangeStrings): string {
  if (plan.priceUsdPerMonth === null) return strings?.freeLabel ?? "Free";
  return strings?.perMonth ? strings.perMonth(plan.priceUsdPerMonth) : `$${plan.priceUsdPerMonth}/mo`;
}

/* ─── The subscription intent's verdict (stack600
   plansdesk-honesty) ──────────────────────────────────────────────
   The PlansDesk used to fire the embedded intent with a bare fetch
   and fall through to the HOSTED checkout rail on ANY failure —
   so a failed intent silently walked the buyer off the site, and
   the failure itself was never shown. The creator-pricing page
   (the desk's reference implementation) never does that: a server
   answer is shown, a transport failure is named by
   checkoutFailureCopy, and checkout STOPS. This pure function is
   that page's verdict, shared: it turns the intent POST's
   { ok, status, data } into exactly one of —
   - "embedded": the confirmation secret arrived; mount the form.
   - "changed": the tier change applied in place (the intent's own
     answer for it); no payment page exists.
   - "change": a subscriber picked a DIFFERENT tier and the intent
     answered mode "change" with the proration preview (stack600
     plan-tier-change) — nothing charged yet; the desk shows the
     confirm panel and applies via POST /creator-tiers/change.
   - "error": STOP with this honest line — the server's own message
     when it sent one (its 502 text already carries the
     nothing-charged line; its 409 names the manage path), else the
     shared failure copy naming the HTTP status + nothing charged.
   An OK answer with no usable secret is an error too, never a
   reason to try another rail. */
export type PlanIntentOutcome =
  | { kind: "embedded"; clientSecret: string; subscriptionId: string; label: string }
  | { kind: "changed" }
  | { kind: "change"; preview: PlanChangePreview }
  | { kind: "error"; message: string };

/** The proration preview the intent's mode:"change" answer carries
 *  (the server's TierChangePreviewView, mirrored field for field).
 *  These are the PINNED numbers the confirm panel shows: Stripe
 *  priced the swap at the same proration instant the apply call
 *  uses, so what the walker confirms is what gets charged — the
 *  desk displays them verbatim and never recomputes them. */
export interface PlanChangePreview {
  fromTier: string;
  fromPlanName: string;
  toTier: string;
  toPlanName: string;
  /** Charged to the saved card today (0 on a net-credit downgrade). */
  amountDueTodayCents: number;
  /** Credit toward future invoices (0 unless the swap nets negative). */
  creditCents: number;
  currency: string;
  /** When the current period ends — a swap never moves it. */
  renewalDate: string | null;
  /** True when a cancel was pending: changing plans clears it. */
  clearsPendingCancel: boolean;
}

/** Parse a changePreview payload; null when any pinned number is
 *  missing or mistyped — a change the desk cannot price honestly
 *  is never offered for confirmation. */
function parsePlanChangePreview(
  payload: unknown,
  toPlanNameFallback?: string,
): PlanChangePreview | null {
  if (!isObj(payload)) return null;
  const fromTier = str(payload["fromTier"]);
  const toTier = str(payload["toTier"]);
  const amountDueTodayCents = num(payload["amountDueTodayCents"]);
  const creditCents = num(payload["creditCents"]);
  if (!fromTier || !toTier || amountDueTodayCents === null || creditCents === null) return null;
  return {
    fromTier,
    fromPlanName: str(payload["fromPlanName"]) ?? fromTier,
    toTier,
    toPlanName: str(payload["toPlanName"]) ?? toPlanNameFallback ?? toTier,
    amountDueTodayCents,
    creditCents,
    currency: str(payload["currency"]) ?? "usd",
    renewalDate: str(payload["renewalDate"]),
    clearsPendingCancel: payload["clearsPendingCancel"] === true,
  };
}

export function planIntentOutcome(
  result: { ok: boolean; status: number; data: unknown },
  planName: string,
  strings?: PlanChangeStrings,
): PlanIntentOutcome {
  const { ok, status, data } = result;
  if (ok && isObj(data)) {
    if (data["changed"] === true) return { kind: "changed" };
    if (data["mode"] === "change") {
      /* A change with no usable preview is NOT a confirmable
         change — it falls through to the honest OK stop below. */
      const preview = parsePlanChangePreview(data["changePreview"], planName);
      if (preview) return { kind: "change", preview };
    }
    const clientSecret = str(data["clientSecret"]);
    const subscriptionId = str(data["subscriptionId"]);
    if (clientSecret && subscriptionId) {
      return {
        kind: "embedded",
        clientSecret,
        subscriptionId,
        label: str(data["label"]) ?? planName,
      };
    }
  }
  if (ok) {
    /* The server answered OK but sent nothing the form can mount —
       that is a failed start, stated plainly, not a detour. */
    return {
      kind: "error",
      message:
        strings?.intentDidntStart ??
        "Checkout didn't start — nothing was charged. Try again in a minute.",
    };
  }
  return {
    kind: "error",
    message: apiErrorLine(
      data,
      strings?.failureCopy
        ? strings.failureCopy(status)
        : checkoutFailureCopy(
            new CheckoutTransportError("Subscription intent failed", status),
          ),
    ),
  };
}

/* ─── The tier-change confirm (stack600 plansdesk-change) ──────────
   The confirm panel's lines are the creator-pricing page's own
   words for the same preview (its change-confirm panel), built
   from the preview's pinned numbers only — the desk never prices
   a swap itself. */

/** What today's money does: the prorated charge on an upgrade, the
 *  $0-due + credit sentence on a downgrade, or the plain
 *  nothing-charged line when the swap nets to zero. */
export function planChangeChargeLine(preview: PlanChangePreview, strings?: PlanChangeStrings): string {
  if (preview.amountDueTodayCents > 0) {
    return strings?.chargeToday
      ? strings.chargeToday(moneyCents(preview.amountDueTodayCents), preview.fromPlanName, preview.toPlanName)
      : `Your saved card will be charged ${moneyCents(preview.amountDueTodayCents)} today — the prorated difference between ${preview.fromPlanName} and ${preview.toPlanName} for the rest of this billing period.`;
  }
  if (preview.creditCents > 0) {
    return strings?.creditLine
      ? strings.creditLine(moneyCents(preview.creditCents), preview.fromPlanName)
      : `Nothing is charged today. The unused time on ${preview.fromPlanName} becomes a ${moneyCents(preview.creditCents)} credit toward your next invoices.`;
  }
  return strings?.nothingCharged ?? "Nothing is charged today.";
}

/** When the new tier starts + the renewal-date-unchanged note. */
export function planChangeStartLine(preview: PlanChangePreview, strings?: PlanChangeStrings): string {
  const renewalDate = preview.renewalDate
    ? (strings?.renewalDateFormat
        ? strings.renewalDateFormat(new Date(preview.renewalDate))
        : new Date(preview.renewalDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }))
    : null;
  const renewal = renewalDate
    ? (strings?.renewalStays ? strings.renewalStays(renewalDate) : `, and your renewal date stays ${renewalDate}`)
    : (strings?.sameRenewal ?? ", same renewal date");
  return strings?.startLine
    ? strings.startLine(preview.toPlanName, renewal)
    : `${preview.toPlanName} starts right away — same subscription, same card${renewal}.`;
}

/** Shown when the preview says a cancel was pending: changing
 *  plans clears it, and the walker hears that BEFORE confirming. */
export const PLAN_CHANGE_CLEARS_CANCEL_LINE =
  "You had a cancellation pending. Switching plans clears it — you're staying, so your plan keeps renewing.";

/** POST /creator-tiers/change's verdict, in the intent verdict's
 *  honesty shape: a landed change (including the
 *  already-applied answer a double-click replays into) is "done"
 *  with the amounts the response itself reports; anything else
 *  STOPS in the desk with the server's own message when it sent
 *  one (its 409 already-on-tier line, its 502 change-failed text),
 *  else the shared failure copy naming the HTTP status + nothing
 *  charged. An OK answer that applied nothing is the honest
 *  nothing-charged stop, never a success the desk invented. */
export type PlanChangeOutcome =
  | { kind: "done"; alreadyApplied: boolean; amountDueTodayCents: number; creditCents: number }
  | { kind: "error"; message: string };

export function planChangeOutcome(
  result: { ok: boolean; status: number; data: unknown },
  strings?: PlanChangeStrings,
): PlanChangeOutcome {
  const { ok, status, data } = result;
  if (ok && isObj(data) && data["changed"] === true) {
    return {
      kind: "done",
      alreadyApplied: data["alreadyApplied"] === true,
      amountDueTodayCents: num(data["amountDueTodayCents"]) ?? 0,
      creditCents: num(data["creditCents"]) ?? 0,
    };
  }
  if (ok) {
    return {
      kind: "error",
      message: apiErrorLine(
        data,
        strings?.changeDidntGoThrough ??
          "That plan change didn't go through — nothing was charged. Try again in a minute.",
      ),
    };
  }
  return {
    kind: "error",
    message: apiErrorLine(
      data,
      strings?.failureCopy
        ? strings.failureCopy(status)
        : checkoutFailureCopy(
            new CheckoutTransportError("Plan change failed", status),
          ),
    ),
  };
}

/* ─── 70 · The full credit-history ledger, paginated ─────────────── */

/** Rows per ledger page at the history desk. */
const LEDGER_PAGE_SIZE = 20;

interface LedgerPage {
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
