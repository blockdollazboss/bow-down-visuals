/* ─── Templates Desk in-world (Stack-100 wave 4, item 27 / desk #100) ──
   THE FEATURE (website): the Templates hub (pages/templates/*) —
   four public galleries over the site's own data libraries:
   video templates (data/video-templates), hook templates
   (data/hook-templates), caption packs (data/caption-templates)
   and thumbnail templates (data/thumbnail-templates). On the
   website each gallery's "Use" deep-links into the owning tool
   with the template preselected; the galleries themselves are
   browse + category filter (+ search on the videos gallery).

   THE GAP (census item B16): in-World the templates were
   consumable only inside their own desks — there was no browse
   surface at all — and the panel-payload union had no
   video-template kind, so the one gallery whose owning desk
   (the Video Desk) could not be handed a template was videos.

   THIS DESK closes both halves:
     · TemplatesDesk (components/world/native/TemplatesDesk) —
       one browse desk for all four galleries, stacked at the
       My Studio board in the Create Wing like its wave-4
       neighbours. Its cards are built from the SAME data
       libraries the 2D galleries read — the same catalog, not
       a World-curated subset — and "Use" rides the panel
       payload channel (lib/world/panel-payload) to the owning
       desk: hooks + captions → the Hook Desk, thumbnails →
       the Thumbnail Desk, videos → the Video Desk.
     · VideoTemplateBench (components/world/native/
       VideoTemplateBench), mounted inside the Video Desk —
       the video-template payload's receiving end. It loads the
       rail's own catalog, preselects the handed template (the
       editor panel's deep-link discipline: only when the key
       resolves in the catalog), fills the recipe's slots and
       applies through the same rail the editor's Templates
       tab uses.

   THE RAILS (api-server routes/generate/video-template.ts,
   requireAuth):
     GET  /api/video-template/templates → { price, templates }
          — the full recipes (slots, overlays, transitions).
     POST /api/video-template/apply { template, slots: [{url}],
          overlays?, musicBedUrl?, title?, endCard? } → 202
          { jobId, state, price, creditsRemaining } — charged
          BEFORE the render; a failed render auto-refunds.
     GET  /api/video-template/job/:jobId → { id, state, stage,
          progress, result, error } — polled to completion.

   PRICE — READ from the credit-cost registry: the route's
   TEMPLATE_COST, under the ledger action the registry names
   for the apply path. The bench quotes it through videoTemplateApplyCost
   (which throws if the registry row ever disappears — a desk
   must never quote an invented price) and hands it to
   confirmedFetch as the explicit quote, the wave-4 desks'
   discipline. The other three galleries charge nothing to
   browse or to hand off — their desks price their own makes.

   HONEST STATES: the browse half reads bundled libraries —
   exactly like the 2D gallery pages, which read the same
   files locally — so it has no fetch to fail; its honest zero
   is "nothing matches that search", never a pretend-empty
   hub. The bench half fetches: a failed or drifted catalog
   read is a failure with Retry, never an empty shelf, and a
   payload slug the catalog doesn't know preselects nothing. */

import {
  HOOK_TEMPLATES,
  HOOK_CATEGORIES,
  type HookTemplate,
} from "../../data/hook-templates";
import {
  CAPTION_PACKS,
  CAPTION_CATEGORIES,
  type CaptionPack,
} from "../../data/caption-templates";
import {
  THUMBNAIL_TEMPLATES,
  THUMBNAIL_CATEGORIES,
  type ThumbnailTemplate,
} from "../../data/thumbnail-templates";
import {
  VIDEO_TEMPLATE_METAS,
  VIDEO_TEMPLATE_CATEGORIES,
  getVideoTemplateMeta,
  type VideoTemplateMeta,
} from "../../data/video-templates";
import { getCreditCost } from "../credit-costs";
import { matchesQuery } from "../search-match";
import {
  captionPackPayload,
  hookTemplatePayload,
  parsePanelPayloadFor,
  thumbnailTemplatePayload,
  videoTemplatePayload,
  type PanelPayload,
} from "./panel-payload";

/* ─── The four galleries ─────────────────────────────────────────── */

export type TemplateGalleryId = "videos" | "hooks" | "captions" | "thumbnails";

export const TEMPLATE_GALLERIES: readonly { id: TemplateGalleryId; label: string }[] = [
  { id: "videos", label: "Videos" },
  { id: "hooks", label: "Hooks" },
  { id: "captions", label: "Captions" },
  { id: "thumbnails", label: "Thumbnails" },
];

/** One browse card, whatever gallery it came from. `slug` is the
 *  library's own key — the exact reference the owning desk's
 *  prefill resolves (a video key, a hook/caption/thumbnail slug). */
export interface TemplateCard {
  gallery: TemplateGalleryId;
  slug: string;
  title: string;
  blurb: string;
  category: string;
  /** The outcome line (video templates carry one; the other
   *  libraries don't, so theirs is null — never invented). */
  detail: string | null;
  /** Card icon from the library (videos carry none → null). */
  emoji: string | null;
  /** Shape line for video cards ("9:16 · ~7s · 12 clips") —
   *  built from the meta's own fields; null for other galleries. */
  meta: string | null;
}

function videoCard(t: VideoTemplateMeta): TemplateCard {
  return {
    gallery: "videos",
    slug: t.key,
    title: t.name,
    blurb: t.tagline,
    category: t.category,
    detail: t.outcome,
    emoji: null,
    meta: `${t.aspect} · ${t.durationLabel} · ${t.slotCount} ${t.slotCount === 1 ? "clip" : "clips"}`,
  };
}

function hookCard(t: HookTemplate): TemplateCard {
  return {
    gallery: "hooks",
    slug: t.slug,
    title: t.title,
    blurb: t.blurb,
    category: t.category,
    detail: null,
    emoji: t.emoji,
    meta: null,
  };
}

function captionCard(t: CaptionPack): TemplateCard {
  return {
    gallery: "captions",
    slug: t.slug,
    title: t.title,
    blurb: t.blurb,
    category: t.category,
    detail: null,
    emoji: t.emoji,
    meta: null,
  };
}

function thumbnailCard(t: ThumbnailTemplate): TemplateCard {
  return {
    gallery: "thumbnails",
    slug: t.slug,
    title: t.title,
    blurb: t.blurb,
    category: t.category,
    detail: null,
    emoji: t.emoji,
    meta: null,
  };
}

export function templateCards(gallery: TemplateGalleryId): TemplateCard[] {
  switch (gallery) {
    case "videos":
      return VIDEO_TEMPLATE_METAS.map(videoCard);
    case "hooks":
      return HOOK_TEMPLATES.map(hookCard);
    case "captions":
      return CAPTION_PACKS.map(captionCard);
    case "thumbnails":
      return THUMBNAIL_TEMPLATES.map(thumbnailCard);
  }
}

export function templateGalleryCount(gallery: TemplateGalleryId): number {
  return templateCards(gallery).length;
}

/** The gallery's own category list, from its own library —
 *  the desk's chips are the pages' chips. */
export function templateCategories(gallery: TemplateGalleryId): string[] {
  switch (gallery) {
    case "videos":
      return [...VIDEO_TEMPLATE_CATEGORIES];
    case "hooks":
      return [...HOOK_CATEGORIES];
    case "captions":
      return [...CAPTION_CATEGORIES];
    case "thumbnails":
      return [...THUMBNAIL_CATEGORIES];
  }
}

/** The search haystack for one library entry — what the 2D
 *  gallery searches over. The videos page's hay is verbatim
 *  (name/tagline/description/category/outcome); the other
 *  galleries have no search box of their own, so theirs is
 *  the same shape over their fields (title/blurb/description/
 *  category/keywords). */
function haystackFor(gallery: TemplateGalleryId, slug: string): string {
  switch (gallery) {
    case "videos": {
      const t = VIDEO_TEMPLATE_METAS.find((m) => m.key === slug);
      return t ? `${t.name} ${t.tagline} ${t.description} ${t.category} ${t.outcome}` : "";
    }
    case "hooks": {
      const t = HOOK_TEMPLATES.find((m) => m.slug === slug);
      return t ? `${t.title} ${t.blurb} ${t.metaDescription} ${t.category} ${t.keywords.join(" ")}` : "";
    }
    case "captions": {
      const t = CAPTION_PACKS.find((m) => m.slug === slug);
      return t ? `${t.title} ${t.blurb} ${t.metaDescription} ${t.category} ${t.keywords.join(" ")}` : "";
    }
    case "thumbnails": {
      const t = THUMBNAIL_TEMPLATES.find((m) => m.slug === slug);
      return t ? `${t.title} ${t.blurb} ${t.metaDescription} ${t.category} ${t.keywords.join(" ")}` : "";
    }
  }
}

/** Browse filtering, mirroring the galleries: a category chip
 *  is an exact category match ("All" passes everything), and a
 *  typed search runs the site's plain-words matcher
 *  (lib/search-match) over the entry's haystack — the videos
 *  page's own semantics, extended to its three siblings. */
export function filterTemplateCards(
  gallery: TemplateGalleryId,
  category: string,
  query: string,
): TemplateCard[] {
  const q = query.trim();
  return templateCards(gallery).filter((card) => {
    if (category !== "All" && card.category !== category) return false;
    if (!q) return true;
    return matchesQuery(haystackFor(gallery, card.slug), query);
  });
}

/* ─── The "Use" handoff ──────────────────────────────────────────── */

export interface TemplateUseTarget {
  stationId: string;
  payload: PanelPayload;
}

/** Where a card's "Use" goes: the owning desk's station, with
 *  the panel payload that desk's prefill speaks. The payload is
 *  a template reference only — never money (panel-payload law). */
export function templateUseTarget(card: TemplateCard): TemplateUseTarget {
  switch (card.gallery) {
    case "videos":
      return { stationId: "video-desk", payload: videoTemplatePayload(card.slug) };
    case "hooks":
      return { stationId: "hook-desk", payload: hookTemplatePayload(card.slug) };
    case "captions":
      return { stationId: "hook-desk", payload: captionPackPayload(card.slug) };
    case "thumbnails":
      return { stationId: "thumbnail-desk", payload: thumbnailTemplatePayload(card.slug) };
  }
}

/* ─── The video-template bench (the payload's receiving end) ─────── */

export const VIDEO_TEMPLATES_PATH = "/api/video-template/templates";
export const VIDEO_TEMPLATE_APPLY_PATH = "/api/video-template/apply";

export function videoTemplateJobPath(jobId: string): string {
  return `/api/video-template/job/${jobId}`;
}

/** The apply price, read from the credit-cost registry — the
 *  same entry the rail's TEMPLATE_COST is pinned to and the
 *  editor's confirmation quotes. Throws if the row ever
 *  disappears: the bench must fail loudly, never quote a
 *  price from memory. */
export function videoTemplateApplyCost(): number {
  const entry = getCreditCost(VIDEO_TEMPLATE_APPLY_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${VIDEO_TEMPLATE_APPLY_PATH}`);
  return entry.cost;
}

/** The registry's own words for the apply (the confirmation's
 *  feature line + the ledger action's name). */
export function videoTemplateApplyFeature(): string {
  const entry = getCreditCost(VIDEO_TEMPLATE_APPLY_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${VIDEO_TEMPLATE_APPLY_PATH}`);
  return entry.feature;
}

/** The payload half of the bench's deep link: parse the raw
 *  panel payload for the Video Desk and resolve the slug
 *  against the FE meta library (the first gate — the bench's
 *  catalog find is the second, exactly like the editor panel:
 *  an unknown key preselects nothing). Returns the template
 *  key to preselect, or null. */
export function videoTemplatePrefill(raw: unknown): string | null {
  const payload = parsePanelPayloadFor("video-desk", raw);
  if (!payload || payload.kind !== "video-template") return null;
  return getVideoTemplateMeta(payload.templateSlug) ? payload.templateSlug : null;
}

/* The rail catalog's shapes, mirrored from the route's response
   (which is the editor panel's CatalogTemplate, field for field). */
export interface VideoTemplateSlot {
  key: string;
  label: string;
  kind: "video" | "photo" | "any";
  durationSec: number;
}

export interface VideoTemplateOverlay {
  text: string;
  slotIndex: number;
  position: "top" | "center" | "bottom";
  size: "sm" | "md" | "lg";
  color: "white" | "gold";
}

export interface VideoTemplateCatalogEntry {
  key: string;
  name: string;
  tagline: string;
  description: string;
  aspect: "9:16" | "16:9" | "1:1";
  durationTargetSec: number;
  outputSeconds: number;
  slots: VideoTemplateSlot[];
  transitions: string[];
  overlays: VideoTemplateOverlay[];
  audioMode: "keep" | "bed";
}

export interface VideoTemplateCatalog {
  templates: VideoTemplateCatalogEntry[];
  /** The rail's own price line from the catalog response, when
   *  it carries one (the editor panel lets it overwrite the
   *  display; the bench shows it only as the rail's words —
   *  the charge quote still comes from the registry). */
  price: number | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isSlot(v: unknown): v is VideoTemplateSlot {
  return (
    isRecord(v) &&
    typeof v["key"] === "string" &&
    typeof v["label"] === "string" &&
    (v["kind"] === "video" || v["kind"] === "photo" || v["kind"] === "any") &&
    typeof v["durationSec"] === "number"
  );
}

function isOverlay(v: unknown): v is VideoTemplateOverlay {
  return (
    isRecord(v) &&
    typeof v["text"] === "string" &&
    typeof v["slotIndex"] === "number" &&
    (v["position"] === "top" || v["position"] === "center" || v["position"] === "bottom") &&
    (v["size"] === "sm" || v["size"] === "md" || v["size"] === "lg") &&
    (v["color"] === "white" || v["color"] === "gold")
  );
}

function isCatalogEntry(v: unknown): v is VideoTemplateCatalogEntry {
  return (
    isRecord(v) &&
    typeof v["key"] === "string" &&
    typeof v["name"] === "string" &&
    typeof v["tagline"] === "string" &&
    typeof v["description"] === "string" &&
    (v["aspect"] === "9:16" || v["aspect"] === "16:9" || v["aspect"] === "1:1") &&
    typeof v["durationTargetSec"] === "number" &&
    typeof v["outputSeconds"] === "number" &&
    Array.isArray(v["slots"]) &&
    (v["slots"] as unknown[]).every(isSlot) &&
    Array.isArray(v["transitions"]) &&
    (v["transitions"] as unknown[]).every((t) => typeof t === "string") &&
    Array.isArray(v["overlays"]) &&
    (v["overlays"] as unknown[]).every(isOverlay) &&
    (v["audioMode"] === "keep" || v["audioMode"] === "bed")
  );
}

/** Defensive parse of the catalog response. ANY drift — a
 *  missing field, a mistyped slot — fails the whole read
 *  (null): the bench shows its failure state with Retry,
 *  never a half-parsed shelf dressed as the catalog. */
export function parseVideoTemplateCatalog(raw: unknown): VideoTemplateCatalog | null {
  if (!isRecord(raw)) return null;
  const list = raw["templates"];
  if (!Array.isArray(list) || !list.every(isCatalogEntry)) return null;
  const price = raw["price"];
  return {
    templates: list as VideoTemplateCatalogEntry[],
    price: typeof price === "number" ? price : null,
  };
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv)(\?|#|$)/i;

/** Whether a piece of media belongs in a slot — the editor
 *  panel's own rule: the mime speaks first when known, then
 *  the URL's extension; an unknown extension passes (the
 *  server probes and reports clearly). */
export function slotAcceptsMedia(slot: VideoTemplateSlot, url: string, mime = ""): boolean {
  if (mime.startsWith("image/")) return slot.kind !== "video";
  if (mime.startsWith("video/")) return slot.kind !== "photo";
  if (IMAGE_EXT.test(url)) return slot.kind !== "video";
  if (VIDEO_EXT.test(url)) return slot.kind !== "photo";
  return true;
}

/** The upload ceiling the editor panel enforces (80 MB). */
export const VIDEO_TEMPLATE_UPLOAD_MAX_BYTES = 80 * 1024 * 1024;

/** The slot labels still waiting for media — the apply's
 *  gate, in the recipe's own order. */
export function missingSlotLabels(
  entry: VideoTemplateCatalogEntry,
  slotUrls: Record<string, string>,
): string[] {
  return entry.slots.filter((s) => !slotUrls[s.key]).map((s) => s.label);
}

/** The apply body, byte-for-byte the editor panel's shape:
 *  slots in recipe order, overlay texts as edited, the music
 *  bed only when given, the template's own name as the title. */
export function buildVideoTemplateApplyBody(input: {
  entry: VideoTemplateCatalogEntry;
  slotUrls: Record<string, string>;
  overlayTexts: string[];
  musicBedUrl: string;
  endCard: boolean;
}): Record<string, unknown> {
  const bed = input.musicBedUrl.trim();
  return {
    template: input.entry.key,
    slots: input.entry.slots.map((s) => ({ url: input.slotUrls[s.key] })),
    overlays: input.overlayTexts,
    musicBedUrl: bed || undefined,
    title: input.entry.name,
    endCard: input.endCard,
  };
}

/* The job poll's read — the editor panel's semantics: queued /
   active keep working, done carries the result, failed carries
   the rail's words (and the rail auto-refunds the charge). */
export interface TemplateJobRead {
  state: "queued" | "active" | "done" | "failed" | "unknown";
  stage: string;
  progress: number;
  resultUrl: string | null;
  durationSec: number | null;
  error: string | null;
}

export function interpretTemplateJob(raw: unknown): TemplateJobRead {
  const out: TemplateJobRead = {
    state: "unknown",
    stage: "",
    progress: 0,
    resultUrl: null,
    durationSec: null,
    error: null,
  };
  if (!isRecord(raw)) return out;
  const state = raw["state"];
  if (state === "queued" || state === "active" || state === "done" || state === "failed") {
    out.state = state;
  }
  if (typeof raw["stage"] === "string") out.stage = raw["stage"];
  if (typeof raw["progress"] === "number") out.progress = raw["progress"];
  const result = raw["result"];
  if (isRecord(result)) {
    if (typeof result["url"] === "string") out.resultUrl = result["url"];
    if (typeof result["durationSec"] === "number") out.durationSec = result["durationSec"];
  }
  if (typeof raw["error"] === "string" && raw["error"]) out.error = raw["error"];
  return out;
}
