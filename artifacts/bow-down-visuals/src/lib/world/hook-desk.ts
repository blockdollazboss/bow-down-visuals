/* ─── Hook Desk in-world (Stack-100 item 97, closing part) ──────────
   Hook Studio's native desk in the Create Wing, on Hook Studio's
   OWN rails — the exact endpoints the 2D /hooks page posts to:

     POST /api/hook-studio   mode "hooks"     → { hooks[5] }
                             mode "captions"  → { captions[3],
                               hashtags {niche, broad, trending}, cta }
                             mode "preflight" → { score, verdict,
                               disclaimer, checks[{label,score,fix}] }
                             100 Visual Bucs per generation, ALL
                             modes (the route's HOOK_STUDIO_CREDITS
                             + the credit registry's "/api/hook-studio"
                             entry — the desk reads the registry, so
                             the shown price can never drift from the
                             confirmation's price).
     POST /api/generate-cta  { videoTopic, ctaGoal, platform, tone }
                             → { ctas[{text, placement, strength}] }
                             50 Visual Bucs (the route's
                             CTA_GENERATOR_CREDITS + the registry's
                             "/api/generate-cta" entry).

   Confirmation law: every run rides useConfirmedApi's
   confirmedFetch — the registry-priced spend confirmation shows
   BEFORE anything runs, a declined confirmation runs nothing,
   and a failed generation is refunded server-side (the routes'
   refundOnFailure pattern). The price is also shown on the desk
   before the run, like every Create Wing desk.

   Templates: the site's own template libraries dock here — the
   hook templates (data/hook-templates, the /templates/hooks
   gallery's data) and the caption packs (data/caption-templates)
   prefill the desk exactly as the 2D page's ?template= deep link
   prefills it. Picking one is free; only generating charges.

   This desk is what closes item 97 in full: Daily Drop hook and
   caption templates "Use" into it (dailyDropStationForKind) —
   the same tool their hrefs name (/hooks, /hooks?tab=captions),
   now native in-world instead of a website transfer. */
import { getCreditCost } from "../credit-costs";
import { getHookTemplate } from "../../data/hook-templates";
import { getCaptionPack } from "../../data/caption-templates";

export const HOOK_DESK_STATION_ID = "hook-desk";
export const HOOK_STUDIO_PATH = "/api/hook-studio";
export const CTA_PATH = "/api/generate-cta";

/* ─── Prices — the registry's, never invented ────────────────────── */

function registryCost(endpoint: string): number {
  const entry = getCreditCost(endpoint);
  if (!entry) throw new Error(`No registered credit cost for ${endpoint}`);
  return entry.cost;
}

/** POST /api/hook-studio — registry 100, the route's
 *  HOOK_STUDIO_CREDITS default agrees. One price, all three modes. */
export function hookStudioCost(): number {
  return registryCost(HOOK_STUDIO_PATH);
}

/** POST /api/generate-cta — registry 50, the route's
 *  CTA_GENERATOR_CREDITS default agrees. */
export function ctaCost(): number {
  return registryCost(CTA_PATH);
}

/* ─── The routes' own enums (verbatim) ───────────────────────────── */

export type HookDeskMode = "hooks" | "captions" | "preflight" | "cta";

export const HOOK_DESK_MODES: readonly HookDeskMode[] = [
  "hooks",
  "captions",
  "preflight",
  "cta",
];

/** hook-studio.ts VIDEO_TYPES — keep in sync with the 2D page. */
export const HOOK_VIDEO_TYPES = [
  "music-promo",
  "behind-the-scenes",
  "tutorial",
  "announcement",
] as const;
export type HookVideoType = (typeof HOOK_VIDEO_TYPES)[number];

/** hook-studio.ts captions PLATFORMS. */
export const CAPTION_PLATFORMS = ["tiktok", "instagram", "youtube", "twitter"] as const;
export type CaptionPlatform = (typeof CAPTION_PLATFORMS)[number];

/** cta-generator.ts CTA_GOALS. */
export const CTA_GOALS = ["subscribe", "comment", "share", "follow", "buy", "stream"] as const;
export type CtaGoal = (typeof CTA_GOALS)[number];

/** cta-generator.ts PLATFORMS (the CTA rail adds facebook). */
export const CTA_PLATFORMS = ["tiktok", "instagram", "youtube", "twitter", "facebook"] as const;
export type CtaPlatform = (typeof CTA_PLATFORMS)[number];

export const CTA_PLACEMENTS = ["opener", "mid-roll", "closer", "pinned-comment"] as const;
export type CtaPlacement = (typeof CTA_PLACEMENTS)[number];

/** The price a mode's run shows (and the confirmation charges). */
export function hookDeskModeCost(mode: HookDeskMode): number {
  return mode === "cta" ? ctaCost() : hookStudioCost();
}

/* ─── Payload shaping — mirrors the /hooks page's posts exactly ──── */

/** hooks.tsx generateHooks' body: { mode:"hooks", videoType, topic }. */
export function buildHookPayload(videoType: HookVideoType, topic: string): Record<string, unknown> {
  return { mode: "hooks", videoType, topic: topic.trim() };
}

/** hooks.tsx generateCaptions' body: topic is REQUIRED by the route
 *  (min 1) — the desk keeps the run shut without one, see
 *  hookDeskInputReady. */
export function buildCaptionPayload(input: {
  topic: string;
  platform: CaptionPlatform;
  tone: string;
}): Record<string, unknown> {
  return {
    mode: "captions",
    topic: input.topic.trim(),
    platform: input.platform,
    tone: input.tone.trim(),
  };
}

/** hooks.tsx scoreVideo's body: title required, the rest optional. */
export function buildPreflightPayload(input: {
  title: string;
  caption: string;
  hashtags: string;
  description: string;
}): Record<string, unknown> {
  return {
    mode: "preflight",
    title: input.title.trim(),
    caption: input.caption.trim(),
    hashtags: input.hashtags.trim(),
    description: input.description.trim(),
  };
}

/** hooks.tsx generateCtas' body for /api/generate-cta:
 *  { videoTopic, ctaGoal, platform, tone } — videoTopic required. */
export function buildCtaPayload(input: {
  videoTopic: string;
  ctaGoal: CtaGoal;
  platform: CtaPlatform;
  tone: string;
}): Record<string, unknown> {
  return {
    videoTopic: input.videoTopic.trim(),
    ctaGoal: input.ctaGoal,
    platform: input.platform,
    tone: input.tone.trim(),
  };
}

/** The endpoint a mode posts to. */
export function hookDeskModePath(mode: HookDeskMode): string {
  return mode === "cta" ? CTA_PATH : HOOK_STUDIO_PATH;
}

/** Whether a mode's required input is present — the run stays shut
 *  (and uncharged) until it is, mirroring the routes' zod minimums:
 *  hooks needs no topic (the route defaults it empty), captions
 *  needs a topic, preflight needs a title, CTA needs a video topic. */
export function hookDeskInputReady(
  mode: HookDeskMode,
  input: { topic: string; title: string },
): boolean {
  switch (mode) {
    case "hooks":
      return true;
    case "captions":
    case "cta":
      return input.topic.trim().length > 0;
    case "preflight":
      return input.title.trim().length > 0;
  }
}

/* ─── Response guards — a payload that drifts is a failure state,
       never rows dressed as a result (the routes refund failures;
       an unusable body is treated as one by the desk). ─────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim());
}

/** The hooks out of a mode:"hooks" answer — null when none landed. */
export function hooksOfResponse(raw: unknown): string[] | null {
  if (!isRecord(raw)) return null;
  const hooks = stringList(raw["hooks"]);
  return hooks.length > 0 ? hooks : null;
}

export interface CaptionResult {
  captions: string[];
  hashtags: { niche: string[]; broad: string[]; trending: string[] };
  cta: string;
}

/** The caption package out of a mode:"captions" answer — captions
 *  are the payload; hashtag tiers ride when present (missing tiers
 *  read empty, exactly as the route's own parse tolerates them). */
export function captionsOfResponse(raw: unknown): CaptionResult | null {
  if (!isRecord(raw)) return null;
  const captions = stringList(raw["captions"]);
  if (captions.length === 0) return null;
  const h = isRecord(raw["hashtags"]) ? raw["hashtags"] : {};
  return {
    captions,
    hashtags: {
      niche: stringList(h["niche"]),
      broad: stringList(h["broad"]),
      trending: stringList(h["trending"]),
    },
    cta: typeof raw["cta"] === "string" ? raw["cta"].trim() : "",
  };
}

export interface PreflightCheck {
  label: string;
  score: number;
  fix: string;
}

export interface PreflightResult {
  score: number;
  verdict: string;
  disclaimer: string;
  checks: PreflightCheck[];
}

/** The scorecard out of a mode:"preflight" answer — checks are the
 *  payload (the route itself refuses a check-less card); scores
 *  clamp to 0–100 exactly as the route clamps them. */
export function preflightOfResponse(raw: unknown): PreflightResult | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw["checks"])) return null;
  const checks: PreflightCheck[] = [];
  for (const c of raw["checks"]) {
    if (!isRecord(c)) return null;
    if (typeof c["label"] !== "string" || typeof c["score"] !== "number" || typeof c["fix"] !== "string") {
      return null;
    }
    checks.push({
      label: c["label"].trim(),
      score: Math.max(0, Math.min(100, Math.round(c["score"]))),
      fix: c["fix"].trim(),
    });
  }
  if (checks.length === 0) return null;
  return {
    score:
      typeof raw["score"] === "number"
        ? Math.max(0, Math.min(100, Math.round(raw["score"])))
        : 0,
    verdict: typeof raw["verdict"] === "string" ? raw["verdict"].trim() : "",
    disclaimer: typeof raw["disclaimer"] === "string" ? raw["disclaimer"].trim() : "",
    checks,
  };
}

export interface CtaResult {
  text: string;
  placement: CtaPlacement;
  strength: number;
}

/** The CTA variants out of a /api/generate-cta answer — each must
 *  carry text, a real placement and a strength; one bad variant
 *  poisons the list rather than rendering a half-ranked set. */
export function ctasOfResponse(raw: unknown): CtaResult[] | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw["ctas"])) return null;
  const out: CtaResult[] = [];
  for (const c of raw["ctas"]) {
    if (!isRecord(c)) return null;
    if (
      typeof c["text"] !== "string" ||
      typeof c["strength"] !== "number" ||
      !(CTA_PLACEMENTS as readonly string[]).includes(c["placement"] as string)
    ) {
      return null;
    }
    out.push({
      text: c["text"].trim(),
      placement: c["placement"] as CtaPlacement,
      strength: Math.max(0, Math.min(100, Math.round(c["strength"]))),
    });
  }
  return out.length > 0 ? out : null;
}

/* ─── Templates — the site's own libraries prefill the desk ──────── */

export interface HookTemplatePrefill {
  videoType: HookVideoType;
  topic: string;
}

/** A hook template slug → the generator prefill, exactly as the 2D
 *  page's ?template= handler applies it (videoType + topic).
 *  Null for an unknown slug — no invented prefill. */
export function hookTemplatePrefill(slug: string): HookTemplatePrefill | null {
  const tpl = getHookTemplate(slug);
  if (!tpl) return null;
  return { videoType: tpl.videoType, topic: tpl.topic };
}

export interface CaptionPackPrefill {
  topic: string;
  platform: CaptionPlatform;
  tone: string;
}

/** A caption pack slug → the caption writer prefill, exactly as
 *  the 2D page's ?tab=captions&template= handler applies it. */
export function captionPackPrefill(slug: string): CaptionPackPrefill | null {
  const pack = getCaptionPack(slug);
  if (!pack) return null;
  return { topic: pack.topic, platform: pack.platform, tone: pack.tone };
}

/* ─── Session history — this sitting's makes, newest first ───────── */

export interface HookHistoryEntry {
  mode: HookDeskMode;
  /** The input the member ran (topic or title) — the row's label. */
  label: string;
  /** The result's lines (hooks, captions, CTA texts, or the
   *  preflight verdict) — restored verbatim when the row is picked. */
  lines: string[];
  /** Structured results ride whole, so a restore never reinvents
   *  a CTA's placement/strength or a scorecard's checks. */
  ctas?: CtaResult[];
  preflight?: PreflightResult;
  captionResult?: CaptionResult;
}

export const HOOK_HISTORY_LIMIT = 8;

/** Prepend a landed make, deduped on mode+label+lines, capped —
 *  the desk's "this session" strip (the 2D page keeps no hook
 *  history at all; this is session-only, nothing is persisted). */
export function pushHookHistory(
  history: readonly HookHistoryEntry[],
  entry: HookHistoryEntry,
): HookHistoryEntry[] {
  const key = (e: HookHistoryEntry) => `${e.mode}|${e.label}|${e.lines.join("\n")}`;
  return [entry, ...history.filter((e) => key(e) !== key(entry))].slice(0, HOOK_HISTORY_LIMIT);
}
