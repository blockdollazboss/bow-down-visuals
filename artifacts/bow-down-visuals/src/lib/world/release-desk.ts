/* ─── The in-world Release Desk (Stack-100 #53/#54/#55) ─────────────
   The Promote Room's distribution wizard, completable where you
   stand: create/edit a release, metadata, splits, UPC/barcode,
   submit — plus the release's smartlink / pre-save surface (link,
   pixel settings, view/click analytics) — all on the 2D /distribute
   page's OWN rails (artifacts/api-server/src/routes/generate/
   distribution.ts):

     GET    /api/distribution/releases                 list (free)
     POST   /api/distribution/releases                 create draft (free)
     GET    /api/distribution/releases/:id             detail + splits (free)
     PATCH  /api/distribution/releases/:id             edit a draft (free)
     DELETE /api/distribution/releases/:id             delete a draft (free)
     POST   /api/distribution/releases/:id/submit      paid — tier price
     POST   /api/distribution/releases/:id/generate-barcode  mint an
                                            INTERNAL placeholder (free)
     PUT    /api/distribution/releases/:id/splits      royalty splits (free)
     POST   /api/distribution/releases/:id/presave     mint smartlink (free)
     PATCH  /api/distribution/releases/:id/presave-settings  smartlink
                                            settings + retargeting pixels (free)
     GET    /api/distribution/releases/:id/presave-stats     smartlink
                                            analytics + settings (free)
     GET    /api/distribution/releases/:id/platforms   delivery status (free)
     GET    /api/distribution/pricing                  live tier pricing
     POST   /api/distribution/metadata                 AI metadata (paid)
     POST   /api/distribution/strategy                 AI strategy (paid)

   Money honesty: prices are NEVER hardcoded here. The desk reads
   GET /api/distribution/pricing live — exactly like the 2D page —
   and only falls back to lib/distribution's shipped constants when
   the pricing read fails, exactly like the 2D page does. The paid
   submit follows the 2D page's own confirmation law: a plain
   window.confirm naming the live tier price, then the POST. The AI
   benches show their live price on the button, exactly like the 2D
   page. Create/edit/splits/barcode/smartlink calls are free on the
   rails and are called free here. */

import {
  DISTRIBUTION_PLATFORMS,
  DISTRIBUTION_TIERS,
  platformLabel,
  splitsTotal,
  splitsValid,
  tierCredits,
  type RoyaltySplit,
} from "@/lib/distribution";
import { isValidPixelId, type SmartlinkPixels } from "@/lib/smartlink-pixels";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/* ─── Pricing (GET /api/distribution/pricing) ─────────────────────── */

export interface ReleasePricingTier {
  type: string;
  credits: number;
  label: string;
  blurb: string;
}

export interface ReleasePricing {
  tiers: ReleasePricingTier[];
  aiMetadataCost: number;
  aiStrategyCost: number;
  aggregator: string | null;
  aggregatorLive: boolean;
}

/** The 2D page's fallback when the pricing read fails: the shipped
 *  lib constants (pages/distribute.tsx does exactly this). */
export const FALLBACK_PRICING: ReleasePricing = {
  tiers: DISTRIBUTION_TIERS.map((t) => ({ type: t.type, credits: t.credits, label: t.label, blurb: t.blurb })),
  aiMetadataCost: 100,
  aiStrategyCost: 100,
  aggregator: null,
  aggregatorLive: false,
};

export function parseReleasePricing(data: unknown): ReleasePricing {
  const d = asRecord(data);
  const tiers: ReleasePricingTier[] = [];
  for (const raw of Array.isArray(d["tiers"]) ? (d["tiers"] as unknown[]) : []) {
    const t = asRecord(raw);
    const type = str(t["type"]);
    const credits = num(t["credits"]);
    if (!type || credits === null) continue;
    tiers.push({ type, credits, label: str(t["label"]) ?? type, blurb: str(t["blurb"]) ?? "" });
  }
  if (tiers.length === 0) return FALLBACK_PRICING;
  return {
    tiers,
    aiMetadataCost: num(d["aiMetadataCost"]) ?? FALLBACK_PRICING.aiMetadataCost,
    aiStrategyCost: num(d["aiStrategyCost"]) ?? FALLBACK_PRICING.aiStrategyCost,
    aggregator: str(d["aggregator"]),
    aggregatorLive: d["aggregatorLive"] === true,
  };
}

/** The price a submit will charge for this release type — the live
 *  pricing's tier when present, else the shipped constant, exactly
 *  the 2D page's own resolution. */
export function submitPriceFor(pricing: ReleasePricing, releaseType: string): number {
  return pricing.tiers.find((t) => t.type === releaseType)?.credits ?? tierCredits(releaseType);
}

/* ─── Release detail ──────────────────────────────────────────────── */

export interface ReleaseChecklistItem {
  key: string;
  label: string;
  ok: boolean;
  hint: string;
}

export interface ReleasePlatformStatus {
  platform: string;
  status: string;
  detail: string | null;
}

export interface ReleaseTrack {
  title: string;
  isrc: string;
}

export interface ReleaseDetail {
  id: string;
  title: string;
  artistName: string;
  releaseType: string;
  releaseDate: string | null;
  platforms: string[];
  audioUrl: string | null;
  artworkUrl: string | null;
  genre: string | null;
  subgenre: string | null;
  isrc: string | null;
  upc: string | null;
  upcKind: string;
  label: string | null;
  labelImprint: string | null;
  copyrightCLine: string | null;
  copyrightPLine: string | null;
  explicit: boolean;
  explicitDeclared: boolean;
  territoriesMode: string;
  territories: string[];
  originalReleaseDate: string | null;
  preorderDate: string | null;
  tracks: ReleaseTrack[];
  status: string;
  creditsCharged: number;
  aggregator: string | null;
  presaveSlug: string | null;
  splitShareSlug: string | null;
  royaltySplits: RoyaltySplit[];
  checklist: ReleaseChecklistItem[];
  platformStatuses: ReleasePlatformStatus[];
  metadata: Record<string, unknown> | null;
  strategy: Record<string, unknown> | null;
}

export function parseReleaseDetail(data: unknown): ReleaseDetail | null {
  const r = asRecord(asRecord(data)["release"] ?? data);
  const id = str(r["id"]);
  if (!id) return null;
  const checklist: ReleaseChecklistItem[] = [];
  for (const raw of Array.isArray(r["checklist"]) ? (r["checklist"] as unknown[]) : []) {
    const c = asRecord(raw);
    checklist.push({
      key: str(c["key"]) ?? "",
      label: str(c["label"]) ?? "",
      ok: c["ok"] === true,
      hint: str(c["hint"]) ?? "",
    });
  }
  const platformStatuses: ReleasePlatformStatus[] = [];
  for (const raw of Array.isArray(r["platformStatuses"]) ? (r["platformStatuses"] as unknown[]) : []) {
    const p = asRecord(raw);
    const platform = str(p["platform"]);
    if (!platform) continue;
    platformStatuses.push({ platform, status: str(p["status"]) ?? "", detail: str(p["detail"]) });
  }
  const tracks: ReleaseTrack[] = [];
  for (const raw of Array.isArray(r["tracks"]) ? (r["tracks"] as unknown[]) : []) {
    const t = asRecord(raw);
    tracks.push({ title: str(t["title"]) ?? "", isrc: str(t["isrc"]) ?? "" });
  }
  const royaltySplits: RoyaltySplit[] = [];
  for (const raw of Array.isArray(r["royaltySplits"]) ? (r["royaltySplits"] as unknown[]) : []) {
    const s = asRecord(raw);
    const name = str(s["name"]);
    const share = num(s["share"]);
    if (!name || share === null) continue;
    royaltySplits.push({
      name,
      role: str(s["role"]) ?? undefined,
      email: str(s["email"]),
      share,
      inviteStatus: str(s["inviteStatus"]) ?? undefined,
    });
  }
  return {
    id,
    title: str(r["title"]) ?? "Untitled release",
    artistName: str(r["artistName"]) ?? "",
    releaseType: str(r["releaseType"]) ?? "single",
    releaseDate: str(r["releaseDate"]),
    platforms: strings(r["platforms"]),
    audioUrl: str(r["audioUrl"]),
    artworkUrl: str(r["artworkUrl"]),
    genre: str(r["genre"]),
    subgenre: str(r["subgenre"]),
    isrc: str(r["isrc"]),
    upc: str(r["upc"]),
    upcKind: str(r["upcKind"]) ?? "internal",
    label: str(r["label"]),
    labelImprint: str(r["labelImprint"]),
    copyrightCLine: str(r["copyrightCLine"]),
    copyrightPLine: str(r["copyrightPLine"]),
    explicit: r["explicit"] === true,
    explicitDeclared: r["explicitDeclared"] === true,
    territoriesMode: str(r["territoriesMode"]) ?? "worldwide",
    territories: strings(r["territories"]),
    originalReleaseDate: str(r["originalReleaseDate"]),
    preorderDate: str(r["preorderDate"]),
    tracks,
    status: str(r["status"]) ?? "draft",
    creditsCharged: num(r["creditsCharged"]) ?? 0,
    aggregator: str(r["aggregator"]),
    presaveSlug: str(r["presaveSlug"]),
    splitShareSlug: str(r["splitShareSlug"]),
    royaltySplits,
    checklist,
    platformStatuses,
    metadata: r["metadata"] && typeof r["metadata"] === "object" ? (r["metadata"] as Record<string, unknown>) : null,
    strategy: r["strategy"] && typeof r["strategy"] === "object" ? (r["strategy"] as Record<string, unknown>) : null,
  };
}

export function parseReleaseList(data: unknown): ReleaseDetail[] {
  const rows = asRecord(data)["releases"];
  if (!Array.isArray(rows)) return [];
  const out: ReleaseDetail[] = [];
  for (const raw of rows) {
    const parsed = parseReleaseDetail(raw);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function checklistPasses(checklist: ReleaseChecklistItem[]): boolean {
  return checklist.length > 0 && checklist.every((c) => c.ok);
}

/* ─── The wizard draft (create + edit share one shape) ────────────── */

export interface ReleaseDraft {
  title: string;
  artistName: string;
  releaseType: string;
  releaseDate: string;
  platforms: string[];
  audioUrl: string;
  artworkUrl: string;
  genre: string;
  subgenre: string;
  isrc: string;
  upc: string;
  upcKind: string;
  label: string;
  labelImprint: string;
  copyrightCLine: string;
  copyrightPLine: string;
  /** null = not declared yet (the 2D wizard's own gate). */
  explicit: boolean | null;
  explicitConfirmed: boolean;
  territoriesMode: string;
  territoriesText: string;
  originalReleaseDate: string;
  preorderDate: string;
  tracks: ReleaseTrack[];
  lyrics: string;
}

/** A creation handed to the desk (Stack-100 #55: the Cover Desk's
 *  finished cover — artwork + title prefilled, nothing else faked). */
export interface ReleasePrefill {
  coverUrl: string;
  title: string;
}

export function emptyReleaseDraft(prefill?: ReleasePrefill | null): ReleaseDraft {
  return {
    title: prefill?.title ?? "",
    artistName: "",
    releaseType: "single",
    releaseDate: "",
    platforms: ["spotify"],
    audioUrl: "",
    artworkUrl: prefill?.coverUrl ?? "",
    genre: "",
    subgenre: "",
    isrc: "",
    upc: "",
    upcKind: "internal",
    label: "",
    labelImprint: "",
    copyrightCLine: "",
    copyrightPLine: "",
    explicit: null,
    explicitConfirmed: false,
    territoriesMode: "worldwide",
    territoriesText: "",
    originalReleaseDate: "",
    preorderDate: "",
    tracks: [{ title: prefill?.title ?? "", isrc: "" }],
    lyrics: "",
  };
}

export function draftFromRelease(r: ReleaseDetail): ReleaseDraft {
  return {
    title: r.title,
    artistName: r.artistName,
    releaseType: r.releaseType,
    releaseDate: r.releaseDate ?? "",
    platforms: [...r.platforms],
    audioUrl: r.audioUrl ?? "",
    artworkUrl: r.artworkUrl ?? "",
    genre: r.genre ?? "",
    subgenre: r.subgenre ?? "",
    isrc: r.isrc ?? "",
    upc: r.upc ?? "",
    upcKind: r.upcKind,
    label: r.label ?? "",
    labelImprint: r.labelImprint ?? "",
    copyrightCLine: r.copyrightCLine ?? "",
    copyrightPLine: r.copyrightPLine ?? "",
    explicit: r.explicit,
    explicitConfirmed: r.explicitDeclared,
    territoriesMode: r.territoriesMode,
    territoriesText: r.territories.join(", "),
    originalReleaseDate: r.originalReleaseDate ?? "",
    preorderDate: r.preorderDate ?? "",
    tracks: r.tracks.length > 0 ? r.tracks.map((t) => ({ ...t })) : [{ title: r.title, isrc: "" }],
    lyrics: typeof r.metadata?.["lyrics"] === "string" ? (r.metadata["lyrics"] as string) : "",
  };
}

function territoriesOf(draft: ReleaseDraft): string[] {
  return draft.territoriesText
    .split(/[,\s]+/)
    .map((t) => t.trim().toUpperCase())
    .filter((t) => /^[A-Z]{2}$/.test(t));
}

/** The create/edit body — the 2D wizard's own field discipline:
 *  blanks ride only when the rail treats them as real values; the
 *  same body serves POST (create) and PATCH (edit a draft). */
export function buildReleasePayload(draft: ReleaseDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: draft.title.trim(),
    artistName: draft.artistName.trim(),
    releaseType: draft.releaseType,
    releaseDate: draft.releaseDate.trim(),
    platforms: [...draft.platforms],
    audioUrl: draft.audioUrl.trim(),
    artworkUrl: draft.artworkUrl.trim(),
    tracks: draft.tracks.map((t) => ({
      title: t.title.trim(),
      ...(t.isrc.trim() ? { isrc: t.isrc.trim() } : {}),
    })),
    isrc: draft.isrc.trim(),
    genre: draft.genre.trim(),
    subgenre: draft.subgenre.trim(),
    explicit: draft.explicit === true,
    explicitDeclared: draft.explicitConfirmed,
    upc: draft.upc.trim(),
    upcKind: draft.upcKind === "official" ? "official" : "internal",
    label: draft.label.trim(),
    labelImprint: draft.labelImprint.trim(),
    copyrightCLine: draft.copyrightCLine.trim(),
    copyrightPLine: draft.copyrightPLine.trim(),
    territoriesMode: draft.territoriesMode,
    territories: territoriesOf(draft),
    originalReleaseDate: draft.originalReleaseDate.trim(),
    preorderDate: draft.preorderDate.trim(),
  };
  if (draft.lyrics.trim()) body["lyrics"] = draft.lyrics.trim();
  return body;
}

/** The wizard's own review gate — the 2D wizard's validation list,
 *  word for word in spirit: title+artist, the explicit declaration
 *  actively confirmed, ≥1 platform, an audio source, every track
 *  titled, a release date. Returns the first failing line or null. */
export function validateReleaseDraft(draft: ReleaseDraft): string | null {
  if (!draft.title.trim() || !draft.artistName.trim()) return "Title and artist name set — both are needed first.";
  if (draft.explicit === null || !draft.explicitConfirmed) {
    return "Confirm the explicit-content declaration — platforms reject undeclared releases.";
  }
  if (draft.platforms.length === 0) return "Pick at least one platform to deliver to.";
  if (!draft.audioUrl.trim()) return "Add the master audio link (or a song-library link) — a release needs its audio.";
  if (draft.tracks.length === 0 || draft.tracks.some((t) => !t.title.trim())) return "Every track needs a title.";
  if (!draft.releaseDate.trim()) return "Set the release date — platforms need at least 7 days lead time.";
  return null;
}

/* ─── Splits ──────────────────────────────────────────────────────── */

export { splitsTotal, splitsValid };

/** PUT /api/distribution/releases/:id/splits — the 2D editor's own
 *  payload shape (blank role/email ride as absent). */
export function buildSplitsPayload(splits: RoyaltySplit[]): Record<string, unknown> {
  return {
    splits: splits.map((s) => ({
      name: s.name.trim(),
      role: (s.role ?? "").trim() || undefined,
      email: (s.email ?? "").trim() || undefined,
      share: Number(s.share),
    })),
  };
}

export function parseSplitsSave(data: unknown): { splits: RoyaltySplit[]; agreementVersion: number | null } {
  const d = asRecord(data);
  const splits: RoyaltySplit[] = [];
  for (const raw of Array.isArray(d["splits"]) ? (d["splits"] as unknown[]) : []) {
    const s = asRecord(raw);
    const name = str(s["name"]);
    const share = num(s["share"]);
    if (!name || share === null) continue;
    splits.push({ name, role: str(s["role"]) ?? undefined, email: str(s["email"]), share });
  }
  return { splits, agreementVersion: num(d["agreementVersion"]) };
}

/* ─── Barcode + submit answers ────────────────────────────────────── */

export function parseBarcodeResult(data: unknown): { barcode: string | null; notice: string | null } {
  const d = asRecord(data);
  return { barcode: str(d["barcode"]), notice: str(d["notice"]) };
}

export interface SubmitResult {
  release: ReleaseDetail | null;
  notice: string | null;
  creditsUsed: number | null;
}

export function parseSubmitResult(data: unknown): SubmitResult {
  const d = asRecord(data);
  return {
    release: parseReleaseDetail(data),
    notice: str(d["notice"]),
    creditsUsed: num(d["creditsUsed"]),
  };
}

/** A failed submit's checklist (the rail answers 400 + checklist
 *  when the release isn't ready) — shown at the desk, never hidden. */
export function parseSubmitChecklist(data: unknown): ReleaseChecklistItem[] {
  const rows = asRecord(data)["checklist"];
  if (!Array.isArray(rows)) return [];
  return rows.map((raw) => {
    const c = asRecord(raw);
    return { key: str(c["key"]) ?? "", label: str(c["label"]) ?? "", ok: c["ok"] === true, hint: str(c["hint"]) ?? "" };
  });
}

/* ─── AI benches ──────────────────────────────────────────────────── */

export function buildMetadataPayload(input: {
  vibe: string;
  lyrics: string;
  artistName: string;
  workingTitle: string;
}): Record<string, unknown> {
  return {
    vibe: input.vibe.trim(),
    lyrics: input.lyrics.trim(),
    artistName: input.artistName,
    workingTitle: input.workingTitle,
  };
}

export interface MetadataResult {
  titleOptions: string[];
  description: string | null;
  genreTags: string[];
}

export function parseMetadataResult(data: unknown): MetadataResult | null {
  const d = asRecord(data);
  const titleOptions = strings(d["titleOptions"]);
  if (titleOptions.length === 0) return null;
  return { titleOptions, description: str(d["description"]), genreTags: strings(d["genreTags"]) };
}

export function buildStrategyPayload(release: ReleaseDetail, metadata: Record<string, unknown> | null): Record<string, unknown> {
  const genreTags = metadata && Array.isArray(metadata["genreTags"]) ? strings(metadata["genreTags"]) : [];
  return {
    title: release.title,
    artistName: release.artistName,
    genreTags,
    releaseDate: release.releaseDate ?? "",
    platforms: release.platforms.length ? [...release.platforms] : ["spotify"],
  };
}

export interface StrategyResult {
  timing: string | null;
  promoPlan: string[];
  checklist: string[];
}

export function parseStrategyResult(data: unknown): StrategyResult | null {
  const d = asRecord(data);
  const timing = str(d["timing"]);
  if (!timing) return null;
  return { timing, promoPlan: strings(d["promoPlan"]), checklist: strings(d["checklist"]) };
}

/** PATCH body that saves the AI package onto the release — the 2D
 *  page's own saveAiToRelease shape. */
export function buildAiSavePayload(input: {
  metadata: MetadataResult | null;
  strategy: StrategyResult | null;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.metadata) {
    payload["metadata"] = {
      titleOptions: input.metadata.titleOptions,
      description: input.metadata.description,
      genreTags: input.metadata.genreTags,
    };
  }
  if (input.strategy) {
    payload["strategy"] = {
      timing: input.strategy.timing,
      promoPlan: input.strategy.promoPlan,
      checklist: input.strategy.checklist,
    };
  }
  return payload;
}

/* ─── Smartlink / pre-save (Stack-100 #54) ──────────────────────────
   One page, one URL: the pre-save landing persists after release
   day as the release's smartlink. The desk mints it (POST presave),
   forms its URL exactly like the 2D page does
   (`<origin>/presave/<slug>`), edits its settings + the creator's
   own retargeting pixels (PATCH presave-settings), and reads its
   numbers (GET presave-stats: views, clicks, per-link splits,
   followers, shares). All free on the rails. */

/** The platform keys a smartlink page can carry — the rail's own
 *  PRESAVE_LINK_PLATFORMS set. */
export const SMARTLINK_LINK_PLATFORMS = [
  { key: "spotify", label: "Spotify" },
  { key: "apple_music", label: "Apple Music" },
  { key: "youtube_music", label: "YouTube Music" },
  { key: "tiktok", label: "TikTok" },
  { key: "amazon_music", label: "Amazon Music" },
  { key: "deezer", label: "Deezer" },
  { key: "tidal", label: "Tidal" },
] as const;

export function smartlinkUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, "")}/presave/${slug}`;
}

export function parsePresaveMint(data: unknown): { slug: string | null; url: string | null } {
  const d = asRecord(data);
  return { slug: str(d["slug"]), url: str(d["url"]) };
}

export interface SmartlinkSettings {
  headline: string;
  platformLinks: Record<string, string>;
  bonusUrl: string;
  pixels: SmartlinkPixels;
}

export function parseSmartlinkSettings(raw: unknown): SmartlinkSettings {
  const s = asRecord(raw);
  const linksRaw = asRecord(s["platformLinks"]);
  const platformLinks: Record<string, string> = {};
  for (const { key } of SMARTLINK_LINK_PLATFORMS) {
    const v = linksRaw[key];
    if (typeof v === "string") platformLinks[key] = v;
  }
  const px = asRecord(s["pixels"]);
  return {
    headline: str(s["headline"]) ?? "",
    platformLinks,
    bonusUrl: str(s["bonusUrl"]) ?? "",
    pixels: {
      metaPixelId: str(px["metaPixelId"]),
      tiktokPixelId: str(px["tiktokPixelId"]),
      googleTagId: str(px["googleTagId"]),
    },
  };
}

/** The settings form's refusal, in words, or null — pixel shapes are
 *  checked with the site's own patterns before the round-trip (the
 *  rail refuses a bad ID too; the desk just says it sooner). */
export function validateSmartlinkSettings(settings: SmartlinkSettings): string | null {
  if (!isValidPixelId("meta", settings.pixels.metaPixelId ?? "")) {
    return "That Meta Pixel ID doesn't look right — it's digits only.";
  }
  if (!isValidPixelId("tiktok", settings.pixels.tiktokPixelId ?? "")) {
    return "That TikTok Pixel ID doesn't look right — check it and try again.";
  }
  if (!isValidPixelId("google", settings.pixels.googleTagId ?? "")) {
    return "That Google tag ID doesn't look right — it starts with G-, AW-, GT- or UA-.";
  }
  return null;
}

/** PATCH presave-settings body — the 2D panel's own shape: headline,
 *  the known platform links (http(s) only ride; the rail re-cleans),
 *  bonus URL, and the three pixel IDs (blank clears). */
export function buildPresaveSettingsPayload(settings: SmartlinkSettings): Record<string, unknown> {
  const platformLinks: Record<string, string> = {};
  for (const { key } of SMARTLINK_LINK_PLATFORMS) {
    platformLinks[key] = (settings.platformLinks[key] ?? "").trim();
  }
  return {
    headline: settings.headline.trim(),
    platformLinks,
    bonusUrl: settings.bonusUrl.trim(),
    metaPixelId: (settings.pixels.metaPixelId ?? "").trim(),
    tiktokPixelId: (settings.pixels.tiktokPixelId ?? "").trim(),
    googleTagId: (settings.pixels.googleTagId ?? "").trim(),
  };
}

export interface SmartlinkAnalytics {
  views: number;
  clicks: number;
  clicksLast7d: number;
  perLink: Array<{ linkKey: string; linkTitle: string; clicks: number }>;
}

export interface PresaveStats {
  settings: SmartlinkSettings;
  /** null = the events table isn't collecting on this install yet —
   *  the desk says so instead of dressing an absence up as zeros. */
  linkAnalytics: SmartlinkAnalytics | null;
  followers: number;
  shares: number;
}

export function parsePresaveStats(data: unknown): PresaveStats {
  const d = asRecord(data);
  const la = d["linkAnalytics"];
  let linkAnalytics: SmartlinkAnalytics | null = null;
  if (la && typeof la === "object") {
    const a = asRecord(la);
    const perLink: SmartlinkAnalytics["perLink"] = [];
    for (const raw of Array.isArray(a["perLink"]) ? (a["perLink"] as unknown[]) : []) {
      const p = asRecord(raw);
      perLink.push({
        linkKey: str(p["linkKey"]) ?? "",
        linkTitle: str(p["linkTitle"]) ?? str(p["linkKey"]) ?? "",
        clicks: num(p["clicks"]) ?? 0,
      });
    }
    linkAnalytics = {
      views: num(a["views"]) ?? 0,
      clicks: num(a["clicks"]) ?? 0,
      clicksLast7d: num(a["clicksLast7d"]) ?? 0,
      perLink,
    };
  }
  return {
    settings: parseSmartlinkSettings(d["settings"]),
    linkAnalytics,
    followers: num(d["followers"]) ?? 0,
    shares: num(d["shares"]) ?? 0,
  };
}

/* ─── Delivery status ─────────────────────────────────────────────── */

export function parsePlatformStatuses(data: unknown): ReleasePlatformStatus[] {
  const rows = asRecord(data)["platformStatuses"];
  if (!Array.isArray(rows)) return [];
  const out: ReleasePlatformStatus[] = [];
  for (const raw of rows) {
    const p = asRecord(raw);
    const platform = str(p["platform"]);
    if (!platform) continue;
    out.push({ platform, status: str(p["status"]) ?? "", detail: str(p["detail"]) });
  }
  return out;
}

export { DISTRIBUTION_PLATFORMS, platformLabel };
