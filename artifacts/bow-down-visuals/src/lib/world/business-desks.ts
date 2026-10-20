/**
 * business-desks.ts — the Business Desks' pure logic (NATIVE-PLAN §3.7).
 *
 * Lane 7: Branding Kit Desk, Press Kit Desk, and the Promote Desk
 * (with the Release / Scheduler / Coach rows folded in). Owner's
 * ruling for v1: status + headline actions native in-world; the
 * deep benches stay behind the desks' transfer footers and are
 * logged below as NATIVE FOLLOW-ON items — follow-ons, NOT
 * permanent exclusions.
 *
 * This module is the testable half: payload builders that mirror
 * the website pages byte-for-byte in shape, tolerant parsers for
 * every response these desks read, the Visual Bucs costs exactly
 * as the pages / credit registry quote them (shown BEFORE anything
 * runs — house law), and the shared job-poll interpreter for the
 * two task-polled generators (logo, intro/outro). The React desks
 * in components/world/native/BusinessDesks.tsx fetch with the
 * member's token (useAuthHeaders pattern) and render from here.
 *
 * Naming law: no provider names anywhere in copy; the logo maker's
 * tiers keep the pages' own words (Premium / Standard).
 */
import { slugifyHandle } from "@/lib/press-kit";
import { primaryActionFor, creatorStateSummary, type CoachCreatorState } from "@/lib/coach-next-action";

/* ─── Costs (Visual Bucs, x100 — quoted up front, never invented) ────
   Each figure is the page's / registry's own: logo tiers from
   pages/logo-maker MODELS; intro from pages/intros-outros
   (5s × 150 VB/s); press-kit from lib/credit-costs + the backend's
   PRESS_KIT_* constants; promo / promo-cards / coach from
   lib/credit-costs (100 VB each). */

/** Logo tiers, exactly as the Logo Maker page offers them. */
export const LOGO_MODELS = [
  { key: "premium", label: "Premium", costVisualBucs: 200 },
  { key: "standard", label: "Standard", costVisualBucs: 100 },
] as const;
export type LogoModelKey = (typeof LOGO_MODELS)[number]["key"];

export function logoModelCost(model: string): number {
  return LOGO_MODELS.find((m) => m.key === model)?.costVisualBucs ?? 200;
}

/** Logo style presets, keys exactly as the page sends them. */
export const LOGO_STYLES = [
  { key: "luxury-gold", label: "Luxury gold" },
  { key: "gaming", label: "Gaming" },
  { key: "minimal", label: "Minimal" },
  { key: "mascot", label: "Mascot" },
] as const;
export type LogoStyleKey = (typeof LOGO_STYLES)[number]["key"];

export const INTRO_DURATION_SEC = 5;
export const INTRO_COST_VISUAL_BUCS = 750;
export const INTRO_TYPES = [
  { key: "intro", label: "Intro" },
  { key: "outro", label: "Outro" },
] as const;
export type IntroTypeKey = (typeof INTRO_TYPES)[number]["key"];

export const PRESS_KIT_GENERATE_COST_VISUAL_BUCS = 300;
export const PRESS_KIT_BIO_REFRESH_COST_VISUAL_BUCS = 100;
export const PRESS_KIT_TONES = ["professional", "bold", "playful", "luxury"] as const;
export type PressKitTone = (typeof PRESS_KIT_TONES)[number];

export const PROMO_GENERATOR_COST_VISUAL_BUCS = 100;
export const PROMO_CARDS_COST_VISUAL_BUCS = 100;
export const COACH_COST_VISUAL_BUCS = 100;

/* ─── The shared job kit: logo + intro/outro task polling ────────────
   Both generators answer the same way (pages/logo-maker.tsx,
   pages/intros-outros.tsx): POST → either an instant
   { status:"succeeded", url } (logo Premium) or a { taskId } to
   poll; GET /:taskId → { status, url?, error? } until the status
   settles. These interpreters are the one reading of that wire. */

export interface JobStart {
  taskId: string | null;
  url: string | null;
  creditsRemaining: number | null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function parseJobStart(data: unknown): JobStart {
  const d = asRecord(data);
  return {
    taskId: str(d["taskId"]),
    url: d["status"] === "succeeded" ? str(d["url"]) : null,
    creditsRemaining: num(d["creditsRemaining"]),
  };
}

export type JobPollOutcome =
  | { kind: "succeeded"; url: string | null; creditsRemaining: number | null }
  | { kind: "failed"; error: string | null }
  | { kind: "pending" };

export function jobPollOutcome(data: unknown): JobPollOutcome {
  const d = asRecord(data);
  if (d["status"] === "succeeded") {
    return { kind: "succeeded", url: str(d["url"]), creditsRemaining: num(d["creditsRemaining"]) };
  }
  if (d["status"] === "failed" || d["status"] === "cancelled") {
    return { kind: "failed", error: str(d["error"]) ?? str(d["message"]) };
  }
  return { kind: "pending" };
}

/* ─── Branding Kit Desk ────────────────────────────────────────────── */

/** POST /api/brand-kit — the server's standing generation price
 *  (BRAND_KIT_COST in routes/generate/brand-kit.ts; env-overridable
 *  server-side, 200 is the shipped default the confirm shows). */
export const BRAND_KIT_GENERATE_COST_VISUAL_BUCS = 200;

/** POST /api/brand-kit — the hub panel's exact payload shape: industry
 *  only rides along when the creator typed one. */
export function buildBrandKitGeneratePayload(input: {
  brandName: string;
  vibe: string;
  industry?: string;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    brandName: input.brandName.trim(),
    vibe: input.vibe.trim(),
  };
  const industry = input.industry?.trim();
  if (industry) out["industry"] = industry;
  return out;
}

/** The hub panel's own readiness rule: a name, and a vibe of at least
 *  a few words' worth of characters (the POST schema's min 3). */
export function brandKitGenerateReady(input: { brandName: string; vibe: string }): boolean {
  return input.brandName.trim().length > 0 && input.vibe.trim().length >= 3;
}

/** POST /api/generate-logo — the page's exact payload shape. */
export function buildLogoPayload(input: {
  brandName: string;
  style: string;
  tagline?: string;
  model: string;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    brandName: input.brandName.trim(),
    style: input.style,
    model: input.model,
  };
  const tagline = input.tagline?.trim();
  if (tagline) out["tagline"] = tagline;
  return out;
}

/** POST /api/generate-intro-outro — the page's exact payload shape. */
export function buildIntroPayload(input: {
  channelName: string;
  type: string;
  tagline?: string;
  logoUrl?: string;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    channelName: input.channelName.trim(),
    type: input.type,
  };
  const tagline = input.tagline?.trim();
  if (tagline) out["tagline"] = tagline;
  const logo = input.logoUrl?.trim();
  if (logo) out["referenceImageUrl"] = logo;
  return out;
}

/* ─── Press Kit Desk ─────────────────────────────────────────────────
   Wire shape is the page's PressKit (snake_case, routes/generate/
   press-kit presentKit): GET /api/press-kit/mine → { kits: [...] }. */

export interface PressKitSummary {
  id: string;
  handle: string;
  artist_name: string;
  tagline: string | null;
  bio: string | null;
  genre: string | null;
  location: string | null;
  booking_email: string | null;
  achievements: string[];
  press_quotes: Array<{ quote: string; source: string }>;
  photo_urls: string[];
  top_tracks: Array<{ title: string; url: string }>;
  is_public: boolean;
}

export function parsePressKits(data: unknown): PressKitSummary[] {
  const kits = asRecord(data)["kits"];
  if (!Array.isArray(kits)) return [];
  const out: PressKitSummary[] = [];
  for (const raw of kits) {
    const k = asRecord(raw);
    const id = str(k["id"]);
    const handle = str(k["handle"]);
    if (!id || !handle) continue;
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
    out.push({
      id,
      handle,
      artist_name: str(k["artist_name"]) ?? "",
      tagline: str(k["tagline"]),
      bio: str(k["bio"]),
      genre: str(k["genre"]),
      location: str(k["location"]),
      booking_email: str(k["booking_email"]),
      achievements: strings(k["achievements"]),
      press_quotes: Array.isArray(k["press_quotes"])
        ? (k["press_quotes"] as unknown[])
            .map(asRecord)
            .filter((q) => str(q["quote"]))
            .map((q) => ({ quote: str(q["quote"])!, source: str(q["source"]) ?? "" }))
        : [],
      photo_urls: strings(k["photo_urls"]),
      top_tracks: Array.isArray(k["top_tracks"])
        ? (k["top_tracks"] as unknown[])
            .map(asRecord)
            .filter((t) => str(t["title"]))
            .map((t) => ({ title: str(t["title"])!, url: str(t["url"]) ?? "" }))
        : [],
      is_public: k["is_public"] === true,
    });
  }
  return out;
}

/** The kit the desk reads first: the page lists newest-updated
 *  first, so the desk's kit is simply the first one. */
export function firstPressKit(data: unknown): PressKitSummary | null {
  return parsePressKits(data)[0] ?? null;
}

/** A first kit can be generated when there's a name and the
 *  slugified handle is a usable press-kit handle (3–30 chars). */
export function pressKitGenerateReady(artistName: string, handle: string): boolean {
  const slug = slugifyHandle(handle || artistName);
  return artistName.trim().length > 0 && slug.length >= 3 && slug.length <= 30;
}

/** POST /api/press-kit/generate — the page's payload, trimmed to
 *  the fields a first kit needs in-world (the full form — socials,
 *  quotes, tracks, photos — is the layout bench, a follow-on). */
export function buildPressKitGeneratePayload(input: {
  artistName: string;
  handle: string;
  tagline?: string;
  genre?: string;
  location?: string;
}): Record<string, unknown> {
  return {
    handle: slugifyHandle(input.handle || input.artistName),
    artist_name: input.artistName.trim(),
    tagline: (input.tagline ?? "").trim(),
    genre: (input.genre ?? "").trim(),
    location: (input.location ?? "").trim(),
    booking_email: "",
    website: "",
    instagram_url: "",
    tiktok_url: "",
    youtube_url: "",
    spotify_url: "",
    achievements: [],
    press_quotes: [],
    photo_urls: [],
    top_tracks: [],
  };
}

/** POST /api/press-kit/:id/regenerate-bio — the page's payload. */
export function buildRegenerateBioPayload(kit: PressKitSummary, tone: string): Record<string, unknown> {
  return { achievements: kit.achievements, tone };
}

/* ─── Promote Desk: link-in-bio ──────────────────────────────────────
   GET /api/bio-pages/me → { pages: [...] } (routes/bio-pages.ts);
   GET /api/bio-pages/:id/analytics → { views, totalClicks,
   clicksLast7d, perLink }. CamelCase, unlike the press kit. */

export interface BioPageSummary {
  id: string;
  slug: string;
  displayName: string;
  headline: string;
  isPublished: boolean;
  viewCount: number;
  linkCount: number;
  url: string | null;
  updatedAt: string | null;
}

export function parseBioPages(data: unknown): BioPageSummary[] {
  const pages = asRecord(data)["pages"];
  if (!Array.isArray(pages)) return [];
  const out: BioPageSummary[] = [];
  for (const raw of pages) {
    const p = asRecord(raw);
    const id = str(p["id"]);
    if (!id) continue;
    out.push({
      id,
      slug: str(p["slug"]) ?? "",
      displayName: str(p["displayName"]) ?? "My Page",
      headline: str(p["headline"]) ?? "",
      isPublished: p["isPublished"] === true,
      viewCount: num(p["viewCount"]) ?? 0,
      linkCount: Array.isArray(p["links"]) ? (p["links"] as unknown[]).length : 0,
      url: str(p["url"]),
      updatedAt: str(p["updatedAt"]),
    });
  }
  return out;
}

export function bioPageStatusLine(page: BioPageSummary): string {
  return page.isPublished ? `Live at ${page.url ?? `/bio/${page.slug}`}` : "Draft — not published yet";
}

export interface BioAnalytics {
  views: number;
  totalClicks: number;
  clicksLast7d: number;
}

export function parseBioAnalytics(data: unknown): BioAnalytics | null {
  const d = asRecord(data);
  if (num(d["views"]) === null && num(d["totalClicks"]) === null) return null;
  return {
    views: num(d["views"]) ?? 0,
    totalClicks: num(d["totalClicks"]) ?? 0,
    clicksLast7d: num(d["clicksLast7d"]) ?? 0,
  };
}

/* ─── Promote Desk: Make a promo (POST /api/promo-generator) ──────── */

export const PROMO_CONTENT_TYPES = [
  { key: "twitter", label: "Short post" },
  { key: "instagram", label: "Instagram post" },
  { key: "tiktok", label: "TikTok post" },
  { key: "email", label: "Email blast" },
  { key: "banner", label: "Banner headline" },
  { key: "ad", label: "Ad copy" },
] as const;

export const PROMO_TONES = [
  { key: "hype", label: "Hype" },
  { key: "professional", label: "Professional" },
  { key: "funny", label: "Funny" },
  { key: "luxury", label: "Luxury" },
] as const;

/** POST /api/promo-generator — the promote page's exact payload. */
export function buildPromoGeneratorPayload(input: {
  featureName: string;
  featureTagline: string;
  featureRoute: string;
  contentType: string;
  tone: string;
  focus?: string;
}): Record<string, unknown> {
  return {
    featureName: input.featureName,
    featureTagline: input.featureTagline,
    featureRoute: input.featureRoute,
    contentType: input.contentType,
    tone: input.tone,
    focus: (input.focus ?? "").trim(),
  };
}

export interface PromoResult {
  title: string | null;
  body: string | null;
  extras: string[];
  hashtags: string[];
  cta: string | null;
}

export function parsePromoResult(data: unknown): PromoResult | null {
  const d = asRecord(data);
  const title = str(d["title"]);
  const body = str(d["body"]);
  if (!title && !body) return null;
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  return { title, body, extras: strings(d["extras"]), hashtags: strings(d["hashtags"]), cta: str(d["cta"]) };
}

/* ─── Promote Desk: promo cards gallery (POST /api/promo-cards) ──────
   The gallery holds the cards made at this desk in this sitting.
   Every pack is also recorded server-side (promo_cards) and the
   website panel lists the full history from GET /api/promo-cards —
   this desk doesn't read that endpoint yet (the follow-on log names
   it), so the desk's shelf is this sitting's pack and it says so.
   Styles/sizes mirror the panel + the GET /api/promo-cards/specs
   wire. */

export const PROMO_CARD_STYLES = [
  { key: "announcement", label: "Announcement" },
  { key: "out-now", label: "Out now" },
  { key: "pre-save", label: "Pre-save" },
  { key: "milestone", label: "Milestone" },
] as const;

export const PROMO_CARD_SIZES = ["1:1", "9:16", "16:9"] as const;

export interface PromoCardItem {
  /** History record id once the server has recorded the card; null
   *  when the record write didn't land — the card still works, its
   *  share just rides without a content reference. */
  id: string | null;
  style: string;
  size: string;
  url: string;
  width: number;
  height: number;
  platforms: string[];
}

/** POST /api/promo-cards — the PromoCardsPanel's exact payload. */
export function buildPromoCardsPayload(input: {
  releaseTitle: string;
  artistName: string;
  style: string;
  sizes?: string[];
  coverArtUrl?: string;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    releaseTitle: input.releaseTitle.trim(),
    artistName: input.artistName.trim(),
    style: input.style,
    sizes: input.sizes && input.sizes.length > 0 ? input.sizes : [...PROMO_CARD_SIZES],
    attribution: true,
  };
  const art = input.coverArtUrl?.trim();
  if (art) out["coverArtUrl"] = art;
  if (input.style === "milestone") out["milestoneLabel"] = "1M STREAMS";
  return out;
}

export function parsePromoCards(data: unknown): { cards: PromoCardItem[]; suggestedCaption: string | null } {
  const d = asRecord(data);
  const raw = Array.isArray(d["cards"]) ? (d["cards"] as unknown[]) : [];
  const cards: PromoCardItem[] = [];
  for (const r of raw) {
    const c = asRecord(r);
    const url = str(c["url"]);
    if (!url) continue;
    cards.push({
      id: str(c["id"]),
      style: str(c["style"]) ?? "",
      size: str(c["size"]) ?? "",
      url,
      width: num(c["width"]) ?? 0,
      height: num(c["height"]) ?? 0,
      platforms: Array.isArray(c["platforms"])
        ? (c["platforms"] as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
    });
  }
  return { cards, suggestedCaption: str(d["suggestedCaption"]) };
}

/* ─── Folded row: Release Desk ───────────────────────────────────────
   GET /api/distribution/releases → { releases: [...] } (camelCase
   DTO from rowToRelease); GET /api/catalog-vault/status →
   { vaults: [{ releaseId, status, vaultedAt }] }. */

export interface ReleaseSummary {
  id: string;
  title: string;
  artistName: string;
  status: string;
  releaseType: string;
  releaseDate: string | null;
}

export function parseReleases(data: unknown): ReleaseSummary[] {
  const rows = asRecord(data)["releases"];
  if (!Array.isArray(rows)) return [];
  const out: ReleaseSummary[] = [];
  for (const raw of rows) {
    const r = asRecord(raw);
    const id = str(r["id"]);
    if (!id) continue;
    out.push({
      id,
      title: str(r["title"]) ?? "Untitled release",
      artistName: str(r["artistName"]) ?? "",
      status: str(r["status"]) ?? "draft",
      releaseType: str(r["releaseType"]) ?? "single",
      releaseDate: str(r["releaseDate"]),
    });
  }
  return out;
}

export function releaseStatusCounts(releases: ReleaseSummary[]): Array<{ status: string; count: number }> {
  const by = new Map<string, number>();
  for (const r of releases) by.set(r.status, (by.get(r.status) ?? 0) + 1);
  return [...by.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
}

export function releaseDeskLine(releases: ReleaseSummary[], vaultedCount: number): string {
  if (releases.length === 0) return "No releases yet — your first release starts on the Release Desk.";
  const counts = releaseStatusCounts(releases)
    .map((c) => `${c.count} ${c.status}`)
    .join(" · ");
  const vault = vaultedCount > 0 ? ` · ${vaultedCount} in the catalog vault` : "";
  return `${releases.length} release${releases.length === 1 ? "" : "s"} — ${counts}${vault}`;
}

export function parseVaultedCount(data: unknown): number {
  const vaults = asRecord(data)["vaults"];
  return Array.isArray(vaults) ? vaults.length : 0;
}

/* ─── Folded row: Scheduler ──────────────────────────────────────────
   GET /api/scheduler/posts → { posts: [...] } (the scheduler lib's
   ScheduledPostShape). The row shows what's coming up, soonest
   first; the calendar itself is the bench (a follow-on). */

export interface UpcomingPost {
  id: string;
  caption: string;
  platforms: string[];
  scheduledAt: string;
  status: string;
}

export function parseScheduledPosts(data: unknown): UpcomingPost[] {
  const rows = asRecord(data)["posts"];
  if (!Array.isArray(rows)) return [];
  const out: UpcomingPost[] = [];
  for (const raw of rows) {
    const p = asRecord(raw);
    const id = str(p["id"]);
    const scheduledAt = str(p["scheduledAt"]);
    if (!id || !scheduledAt) continue;
    out.push({
      id,
      caption: str(p["caption"]) ?? "",
      platforms: Array.isArray(p["platforms"])
        ? (p["platforms"] as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
      scheduledAt,
      status: str(p["status"]) ?? "",
    });
  }
  return out;
}

/** Scheduled (not draft/posted/failed) posts, soonest first. */
export function upcomingPosts(posts: UpcomingPost[], limit = 3): UpcomingPost[] {
  return posts
    .filter((p) => p.status === "scheduled")
    .slice()
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, Math.max(0, limit));
}

/* ─── Folded row: Coach ──────────────────────────────────────────────
   POST /api/monetization-coach — the coach page's payload with the
   page's own defaults (niche Music, YouTube + TikTok, 3 posts a
   week, no follower counts typed in-world in v1). The plan costs
   100 Visual Bucs, shown before the ask. What the row reads back
   is the plan's ONE next action (lib/coach-next-action) plus its
   first money move — readable where you stand; the full plan is
   the bench (a follow-on). */

export function buildCoachPayload(): Record<string, unknown> {
  return {
    niche: "Music",
    platforms: ["youtube", "tiktok"],
    followers: { youtube: 0, tiktok: 0, instagram: 0 },
    cadence: 3,
  };
}

export interface CoachTodayAction {
  label: string;
  href: string;
  firstMove: string | null;
  stateSummary: string | null;
}

export function parseCoachTodayAction(data: unknown): CoachTodayAction | null {
  const d = asRecord(data);
  const moves = Array.isArray(d["moneyMoves"])
    ? (d["moneyMoves"] as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  const eligibility = d["eligibility"];
  if (moves.length === 0 && !Array.isArray(eligibility)) return null;
  const action = primaryActionFor({ nextAction: (d["nextAction"] as never) ?? null });
  const state = (d["creatorState"] as CoachCreatorState | undefined) ?? null;
  return {
    label: action.label,
    href: action.href,
    firstMove: moves[0] ?? null,
    stateSummary: creatorStateSummary(state),
  };
}

/* ─── PARITY FOLLOW-ON LOG (NATIVE FOLLOW-ON items) ──────────────────
   Everything v1 deliberately leaves on the bench, per desk. Each
   item names the bench (the website path the desk's transfer —
   or the row's own transfer — opens) so a later lane can promote
   it to a full native desk on the owner's word. This lane owns
   most of the program's backlog; the list is meant to be thorough. */

export interface BusinessFollowOn {
  id: string;
  title: string;
  desk: "branding-kit" | "press-kit" | "promote" | "release" | "scheduler" | "coach";
  benchPath: string;
  note: string;
}

export const BUSINESS_NATIVE_FOLLOW_ONS: BusinessFollowOn[] = [
  {
    id: "release-wizard",
    title: "NATIVE FOLLOW-ON: Release wizard (full distribution flow)",
    desk: "release",
    benchPath: "/distribute",
    note: "Create/edit releases, metadata, splits, UPC/barcode, platform delivery tracking, pre-save and submit — v1 shows distribution status only.",
  },
  {
    id: "scheduler-calendar",
    title: "NATIVE FOLLOW-ON: Scheduler calendar",
    desk: "scheduler",
    benchPath: "/scheduler",
    note: "Month calendar, drag-to-reschedule, composing/scheduling posts, account connections and best-time — v1 shows upcoming posts only.",
  },
  {
    id: "bio-page-layout-theme-editors",
    title: "NATIVE FOLLOW-ON: Link-in-bio layout/theme editors",
    desk: "promote",
    benchPath: "/promote",
    note: "Editing links, socials, featured items, themes, avatar and slug for the bio page — v1 shows status + analytics only.",
  },
  {
    id: "bio-page-publish-management",
    title: "NATIVE FOLLOW-ON: Bio-page publish/unpublish management",
    desk: "promote",
    benchPath: "/promote",
    note: "Publishing (POST /api/bio-publish/:id, 100 Visual Bucs) and unpublishing (POST /api/bio-pages/:id/unpublish) were left out of v1 — the desk is read + create only.",
  },
  {
    id: "press-kit-layout-editing",
    title: "NATIVE FOLLOW-ON: Press-kit layout editing",
    desk: "press-kit",
    benchPath: "/press-kit",
    note: "The full edit form (handle, socials, achievements, quotes, tracks, photos, public toggle), press-release panel, PDF/print, copy-link and delete — v1 reads the kit, regenerates the bio, and generates a first kit.",
  },
  {
    id: "branding-headshots-bench",
    title: "NATIVE FOLLOW-ON: Branding headshots bench",
    desk: "branding-kit",
    benchPath: "/branding-kit?tab=headshots",
    note: "Headshot studio (POST /api/generate-headshot family) stays a transfer bench in v1.",
  },
  {
    id: "branding-jewelry-bench",
    title: "NATIVE FOLLOW-ON: Branding jewelry bench",
    desk: "branding-kit",
    benchPath: "/branding-kit?tab=jewelry",
    note: "The jewelry studio family (/api/jewelry/…) stays a transfer bench in v1.",
  },
  {
    id: "branding-stream-pack-bench",
    title: "NATIVE FOLLOW-ON: Branding stream-pack bench",
    desk: "branding-kit",
    benchPath: "/branding-kit?tab=stream",
    note: "Stream pack generation stays a transfer bench in v1.",
  },
  {
    id: "brand-kit-generate-edit-apply",
    title: "NATIVE FOLLOW-ON: Brand-kit generation, editing and apply",
    desk: "branding-kit",
    benchPath: "/branding-kit",
    note: "Generating a kit (POST /api/brand-kit, 200 Visual Bucs), editing manual fields (PUT /api/brand-kit), choosing a tagline, and applying colors/fonts to the profile (POST /api/brand-kit/apply) — v1's kit card is read-only.",
  },
  {
    id: "generated-logo-save-to-kit",
    title: "NATIVE FOLLOW-ON: Saving a generated logo into the brand kit",
    desk: "branding-kit",
    benchPath: "/branding-kit",
    note: "In v1 a logo made at the desk is shown in-world; writing it back as the kit's logoUrl (and into hub project assets, as the page does) is a follow-on.",
  },
  {
    id: "coach-full-page-depth",
    title: "NATIVE FOLLOW-ON: Full coach page depth",
    desk: "coach",
    benchPath: "/coach",
    note: "The full money plan (eligibility per platform, earnings guidance, all money moves), niche analyzer, money tracker, and typed inputs (niche/platforms/followers/cadence) — v1 reads back only today's next action from the page-default ask.",
  },
  {
    id: "promo-cards-list-endpoint",
    title: "NATIVE FOLLOW-ON: Promo-cards history on this desk (list endpoint exists)",
    desk: "promote",
    benchPath: "/promote",
    note: "GAP: GET /api/promo-cards exists (shipped with the website's promo-card history; every pack is recorded server-side) and the website panel lists the creator's cards from it — but this desk doesn't read it yet, so the in-world gallery still holds only this sitting's pack. Wiring the desk's gallery to the endpoint is the remaining follow-on. (Per-card actions on the gallery's cards — download, share, schedule, add-to-assets — are built; they ride the same rails as the website panel's.)",
  },
];
