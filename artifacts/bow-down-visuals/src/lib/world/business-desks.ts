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
   lib/credit-costs (100 VB each); headshot from the Headshot
   Studio component + its route constant HEADSHOT_STUDIO_CREDIT_COST
   + lib/credit-costs (100 VB in all three); stream pack from the
   backend's STREAM_PACK_CREDIT_COST + its catalog endpoint (100 VB
   in both — the credit registry's stale 200 was corrected to match). */

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
export const HEADSHOT_COST_VISUAL_BUCS = 100;

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

/* ─── Headshots bench (the Branding Kit Desk's third maker) ────────
   POST /api/generate-headshot is the Headshot Studio's own rail
   (components/photo/HeadshotStudio.tsx + routes/generate/
   headshot-studio.ts): SYNCHRONOUS — one POST answers with
   { status: "succeeded", url } (parseJobStart reads it) — and the
   route itself charges HEADSHOT_STUDIO_CREDIT_COST (100 VB) ONLY
   on success, after a 402 pre-check. Failures charge nothing:
   402 = out of Visual Bucs, 503 / code "provider_not_connected" =
   the engine isn't connected. The desk mirrors the page's flows,
   presets, engine labels and payload shape exactly. */

/** The page's difficulty ladder, in the page's own words. */
export const HEADSHOT_FLOWS = [
  { key: "autopilot", label: "Turbo Mode" },
  { key: "preset", label: "Style presets" },
  { key: "manual", label: "Manual prompt" },
] as const;
export type HeadshotFlowKey = (typeof HEADSHOT_FLOWS)[number]["key"];

/** Style presets — keys exactly as the route's schema names them. */
export const HEADSHOT_PRESETS = [
  { key: "studio", label: "Studio" },
  { key: "stage", label: "Stage" },
  { key: "street", label: "Street" },
  { key: "luxury", label: "Luxury" },
] as const;
export type HeadshotPresetKey = (typeof HEADSHOT_PRESETS)[number]["key"];

/** Engines — the page's own labels; the keys are the wire values. */
export const HEADSHOT_MODELS = [
  { key: "nano-banana-2.1", label: "Turbo Render" },
  { key: "ideogram-4.0", label: "Portrait Render" },
] as const;
export type HeadshotModelKey = (typeof HEADSHOT_MODELS)[number]["key"];

/** The page's generate gate: manual mode needs words first;
 *  Turbo Mode and the presets are ready as they stand. */
export function headshotReady(flow: string, promptText: string): boolean {
  return flow !== "manual" || promptText.trim().length > 0;
}

/** POST /api/generate-headshot — the page's exact payload shape:
 *  the preset rides only in preset flow, promptText only in manual
 *  flow (trimmed), and referenceImageUrl is the trimmed face-photo
 *  URL or null when the member left it blank. */
export function buildHeadshotPayload(input: {
  flow: string;
  preset: string;
  promptText: string;
  model: string;
  referenceImageUrl?: string;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    mode: input.flow,
    model: input.model,
    referenceImageUrl: input.referenceImageUrl?.trim() || null,
  };
  if (input.flow === "preset") out["preset"] = input.preset;
  if (input.flow === "manual") out["promptText"] = input.promptText.trim();
  return out;
}

export type HeadshotFailureKind = "credits" | "provider" | "failed";
export interface HeadshotFailure {
  kind: HeadshotFailureKind;
  message: string | null;
}

/** The one reading of a failed headshot response: 402 (or the
 *  out_of_credits wire words) = credits; 503 / provider_not_connected
 *  = the engine isn't connected; anything else = a failed make.
 *  The route charges nothing on any of these. Null on a 2xx. */
export function parseHeadshotFailure(status: number, data: unknown): HeadshotFailure | null {
  if (status >= 200 && status < 300) return null;
  const d = asRecord(data);
  if (status === 402 || d["error"] === "out_of_credits" || d["code"] === "out_of_credits") {
    return { kind: "credits", message: str(d["message"]) ?? str(d["error"]) };
  }
  if (status === 503 || d["code"] === "provider_not_connected") {
    return { kind: "provider", message: str(d["error"]) ?? str(d["message"]) };
  }
  return { kind: "failed", message: str(d["error"]) ?? str(d["message"]) };
}

/* ─── Stream pack bench (the Branding Kit Desk's fourth maker) ───
   POST /api/stream-pack/generate is the Stream Pack page's own rail
   (routes/generate/stream-pack.ts): SYNCHRONOUS — one POST answers
   { asset, label, url, creditCost } — and the route charges
   STREAM_PACK_CREDIT_COST (100 VB) ONLY after a successful render,
   after a 402 pre-check. Failures charge nothing: 402 = out of
   Visual Bucs, 400 = the pick itself is wrong (channel name /
   asset), 500 = the render failed. The library + apply half rides
   the shared client seam (lib/stream-pack.ts) — the same reads and
   writes the website's Stream Pack library and the Go Live studio
   tray use — so a graphic applied at this bench reads applied on
   both. The desk mirrors the page's themes, assets and payload
   shape exactly; the themes/assets below are the server catalog's
   own lists (GET /api/stream-pack/catalog serves the same rows). */

export const STREAM_PACK_COST_VISUAL_BUCS = 100;

/** Themes — ids and names exactly as the server catalog names them. */
export const STREAM_PACK_THEMES = [
  { key: "gold-luxury", label: "Gold Luxury" },
  { key: "neon-cyber", label: "Neon Cyber" },
  { key: "crimson-royal", label: "Crimson Royal" },
  { key: "emerald-empire", label: "Emerald Empire" },
  { key: "violet-noir", label: "Violet Noir" },
  { key: "arctic-frost", label: "Arctic Frost" },
] as const;
export type StreamPackThemeKey = (typeof STREAM_PACK_THEMES)[number]["key"];

/** Assets — keys, labels and groups exactly as the server catalog
 *  names them (the page groups its picker by these same groups). */
export const STREAM_PACK_ASSETS = [
  { key: "webcam-frame", label: "Webcam Frame", group: "Overlays" },
  { key: "chat-frame", label: "Chat Box Frame", group: "Overlays" },
  { key: "alert-follower", label: "New Follower Alert", group: "Alerts" },
  { key: "alert-subscriber", label: "New Subscriber Alert", group: "Alerts" },
  { key: "alert-donation", label: "Donation Alert", group: "Alerts" },
  { key: "panel-about", label: "About Panel", group: "Panels" },
  { key: "panel-rules", label: "Rules Panel", group: "Panels" },
  { key: "panel-schedule", label: "Schedule Panel", group: "Panels" },
  { key: "panel-socials", label: "Socials Panel", group: "Panels" },
  { key: "screen-starting", label: "Starting Soon Screen", group: "Screens" },
  { key: "screen-brb", label: "Be Right Back Screen", group: "Screens" },
  { key: "screen-ending", label: "Stream Ending Screen", group: "Screens" },
] as const;
export type StreamPackAssetKey = (typeof STREAM_PACK_ASSETS)[number]["key"];

/** The page's generate gate: a channel name is required (the route
 *  400s without one — the graphic is branded with it). */
export function streamPackGenerateReady(channelName: string): boolean {
  return channelName.trim().length > 0;
}

/** POST /api/stream-pack/generate — the page's exact payload shape:
 *  the channel name trimmed, the theme id and asset key as picked. */
export function buildStreamPackGeneratePayload(input: {
  channelName: string;
  theme: string;
  asset: string;
}): Record<string, unknown> {
  return {
    channelName: input.channelName.trim(),
    theme: input.theme,
    asset: input.asset,
  };
}

export type StreamPackGenerateOutcome =
  | { kind: "succeeded"; url: string; label: string | null }
  | { kind: "credits"; message: string | null }
  | { kind: "failed"; message: string | null };

/** The one reading of a stream-pack generate response: a 2xx with a
 *  playable url is the made graphic (a 2xx without one is a bench
 *  answer gone wrong, never a success); 402 (or the out_of_credits
 *  wire word) = credits; anything else = a failed make carrying the
 *  server's own message when it sent one. The route charges nothing
 *  on any failure. */
export function parseStreamPackGenerate(status: number, data: unknown): StreamPackGenerateOutcome {
  const d = asRecord(data);
  if (status >= 200 && status < 300) {
    const url = str(d["url"]);
    if (url) return { kind: "succeeded", url, label: str(d["label"]) };
    return { kind: "failed", message: null };
  }
  if (status === 402 || d["error"] === "out_of_credits") {
    return { kind: "credits", message: str(d["message"]) ?? str(d["error"]) };
  }
  return { kind: "failed", message: str(d["error"]) ?? str(d["message"]) };
}

/** The display name for a library record's themeId — the same names
 *  the website library shows; an unrecorded theme reads as null. */
export function streamPackThemeLabel(themeId: string | null): string | null {
  return STREAM_PACK_THEMES.find((t) => t.key === themeId)?.label ?? null;
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

/* ─── Promote Desk: link-in-bio FULL editing (Stack-100 #59) ────────
   The desk stops being read-only: links, themes, slug, avatar and
   the 100 VB publish all complete here on the bio-pages routes' own
   rails —
     POST /api/bio-pages            create a draft (free)
     PUT  /api/bio-pages/:id        save edits (free)
     POST /api/bio-publish/:id      publish (100 Visual Bucs; the
                                    credit registry's own entry —
                                    confirmedFetch prompts first)
     POST /api/bio-pages/:id/unpublish   take it offline (free)
   Validation mirrors the route's zod schema (bioSaveSchema) and its
   URL rule, so the member hears a refusal at the desk in words, not
   from a failed save. Themes are the db schema's BIO_THEMES — the
   only keys the server accepts. */

export const BIO_PUBLISH_COST_VISUAL_BUCS = 100;
export const BIO_MAX_LINKS = 25;

export const BIO_PAGE_THEMES = [
  { key: "gold-royal", label: "Gold Royal" },
  { key: "midnight-gold", label: "Midnight Gold" },
  { key: "onyx-minimal", label: "Onyx Minimal" },
] as const;

export const BIO_SOCIAL_FIELDS = [
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "youtube", label: "YouTube" },
  { key: "x", label: "X" },
  { key: "spotify", label: "Spotify" },
  { key: "discord", label: "Discord" },
] as const;

export type BioSocialKey = (typeof BIO_SOCIAL_FIELDS)[number]["key"];

export interface BioLinkDraft {
  title: string;
  url: string;
  icon: string;
}

export interface BioPageDraft {
  displayName: string;
  headline: string;
  bio: string;
  avatarUrl: string;
  slug: string;
  theme: string;
  links: BioLinkDraft[];
  socials: Record<BioSocialKey, string>;
  tipJarUrl: string;
}

export interface BioPageFull extends BioPageSummary {
  bio: string;
  avatarUrl: string | null;
  theme: string;
  links: BioLinkDraft[];
  socials: Record<BioSocialKey, string>;
  featuredCount: number;
  tipJarUrl: string | null;
}

function parseBioLinkRows(v: unknown): BioLinkDraft[] {
  if (!Array.isArray(v)) return [];
  const out: BioLinkDraft[] = [];
  for (const raw of v) {
    const r = asRecord(raw);
    out.push({
      title: str(r["title"]) ?? "",
      url: str(r["url"]) ?? "",
      icon: str(r["icon"]) ?? "link",
    });
  }
  return out;
}

function parseBioSocials(v: unknown): Record<BioSocialKey, string> {
  const r = asRecord(v);
  const out = {} as Record<BioSocialKey, string>;
  for (const f of BIO_SOCIAL_FIELDS) out[f.key] = str(r[f.key]) ?? "";
  return out;
}

/** The full editable page out of GET /api/bio-pages/me (or a
 *  POST/PUT response's { page }). */
export function parseBioPageFull(data: unknown): BioPageFull | null {
  const single = asRecord(data)["page"];
  const wrapped = single && Object.keys(single).length > 0 ? { pages: [single] } : data;
  const pages = parseBioPages(wrapped);
  const first = pages[0];
  if (!first) return null;
  const rawPages = asRecord(wrapped)["pages"];
  const raw = Array.isArray(rawPages) ? asRecord(rawPages[0]) : {};
  return {
    ...first,
    bio: str(raw["bio"]) ?? "",
    avatarUrl: str(raw["avatarUrl"]),
    theme: str(raw["theme"]) ?? "gold-royal",
    links: parseBioLinkRows(raw["links"]),
    socials: parseBioSocials(raw["socials"]),
    featuredCount: Array.isArray(raw["featured"]) ? (raw["featured"] as unknown[]).length : 0,
    tipJarUrl: str(raw["tipJarUrl"]),
  };
}

export function bioDraftFromPage(page: BioPageFull): BioPageDraft {
  return {
    displayName: page.displayName,
    headline: page.headline,
    bio: page.bio,
    avatarUrl: page.avatarUrl ?? "",
    slug: page.slug,
    theme: page.theme,
    links: page.links.map((l) => ({ ...l })),
    socials: { ...page.socials },
    tipJarUrl: page.tipJarUrl ?? "",
  };
}

export function emptyBioDraft(): BioPageDraft {
  return {
    displayName: "",
    headline: "",
    bio: "",
    avatarUrl: "",
    slug: "",
    theme: "gold-royal",
    links: [{ title: "", url: "", icon: "link" }],
    socials: { instagram: "", tiktok: "", youtube: "", x: "", spotify: "", discord: "" },
    tipJarUrl: "",
  };
}

/** The route's URL rule (isAllowedUrl): site-relative, http(s),
 *  mailto: or tel:. */
export function isBioAllowedUrl(v: string): boolean {
  if (/^\/(?!\/)/.test(v)) return true;
  return /^(https?:\/\/|mailto:|tel:)/i.test(v);
}

export const BIO_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The desk's refusal, in words, or null when the draft can save.
 *  Mirrors bioSaveSchema: a display name, a well-formed slug when
 *  one is typed, ≤25 links each with a title and an allowed URL. */
export function validateBioDraft(draft: BioPageDraft): string | null {
  if (!draft.displayName.trim()) return "Give the page a display name first.";
  if (draft.slug.trim()) {
    const slug = draft.slug.trim();
    if (slug.length < 3 || slug.length > 40 || !BIO_SLUG_RE.test(slug)) {
      return "The page address (slug) needs 3–40 lowercase letters, numbers and hyphens — e.g. my-name.";
    }
  }
  if (draft.links.length > BIO_MAX_LINKS) return `A page holds at most ${BIO_MAX_LINKS} links.`;
  for (const link of draft.links) {
    if (!link.title.trim() && !link.url.trim()) continue; // untouched blank row
    if (!link.title.trim()) return "Every link needs a title — or remove the empty row.";
    if (!isBioAllowedUrl(link.url.trim())) {
      return `“${link.title.trim()}” needs a real link — http(s), mailto:, tel: or a site page like /shop.`;
    }
  }
  for (const f of BIO_SOCIAL_FIELDS) {
    const v = draft.socials[f.key].trim();
    if (v && !isBioAllowedUrl(v)) return `Your ${f.label} link needs to be http(s) or a site page.`;
  }
  if (draft.tipJarUrl.trim() && !isBioAllowedUrl(draft.tipJarUrl.trim())) {
    return "The tip jar link needs to be http(s), mailto:, tel: or a site page.";
  }
  return null;
}

/** POST /api/bio-pages (create) and PUT /api/bio-pages/:id (save)
 *  share the route's one schema — this body serves both. Blank link
 *  rows are dropped; an empty slug is omitted so the server derives
 *  (create) or keeps (update) the address. */
export function buildBioSavePayload(draft: BioPageDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    displayName: draft.displayName.trim(),
    headline: draft.headline.trim(),
    bio: draft.bio.trim(),
    avatarUrl: draft.avatarUrl.trim() ? draft.avatarUrl.trim() : null,
    links: draft.links
      .filter((l) => l.title.trim() || l.url.trim())
      .map((l) => ({ title: l.title.trim(), url: l.url.trim(), icon: l.icon || "link" })),
    socials: Object.fromEntries(BIO_SOCIAL_FIELDS.map((f) => [f.key, draft.socials[f.key].trim()])),
    theme: draft.theme,
    tipJarUrl: draft.tipJarUrl.trim() ? draft.tipJarUrl.trim() : null,
  };
  if (draft.slug.trim()) payload["slug"] = draft.slug.trim();
  return payload;
}

/** Publish readiness in the rail's own words: the route refuses a
 *  page with no name or no links — the desk says it first. */
export function bioPublishBlocker(draft: BioPageDraft): string | null {
  if (!draft.displayName.trim()) return "Add a display name before publishing.";
  const realLinks = draft.links.filter((l) => l.title.trim() && l.url.trim());
  if (realLinks.length === 0) return "Add at least one link before publishing.";
  return validateBioDraft(draft);
}

/** The { ok, url, slug } answer of POST /api/bio-publish/:id. */
export function parseBioPublishResult(data: unknown): { url: string | null; slug: string | null } {
  const d = asRecord(data);
  return { url: str(d["url"]), slug: str(d["slug"]) };
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
   ScheduledPostShape). This shaping served the old read-only row;
   the full in-world Scheduler desk (compose / best-time / edit /
   cancel, Stack-100 #45) owns its own shaping in
   lib/world/scheduler-desk.ts. */

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
    id: "press-kit-layout-editing",
    title: "NATIVE FOLLOW-ON: Press-kit layout editing",
    desk: "press-kit",
    benchPath: "/press-kit",
    note: "The full edit form (handle, socials, achievements, quotes, tracks, photos, public toggle), press-release panel, PDF/print, copy-link and delete — v1 reads the kit, regenerates the bio, and generates a first kit.",
  },
  {
    id: "branding-jewelry-bench",
    title: "NATIVE FOLLOW-ON: Branding jewelry bench",
    desk: "branding-kit",
    benchPath: "/branding-kit?tab=jewelry",
    note: "The jewelry studio family (/api/jewelry/…) stays a transfer bench in v1.",
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
