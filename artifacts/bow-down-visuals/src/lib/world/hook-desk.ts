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
     POST /api/title-studio  { topic, platform, tone, keywords }
                             → { titles[{title, score, why}],
                               description, tags[15], note }
                             100 Visual Bucs (the route's
                             TITLE_STUDIO_CREDITS + the registry's
                             "/api/title-studio" entry) — the 2D
                             /hooks page's Titles tab, the same post.
     POST /api/script-writer { platform, length, topic, tone,
                               audience, ctaGoal }
                             → { title, hook, beats[{timestamp,
                               spoken, visualCue, broll}],
                               retentionBeats[{at, tactic, line}],
                               cta, teleprompter }
                             200 Visual Bucs (the route's
                             SCRIPT_WRITER_CREDIT_COST + the
                             registry's "/api/script-writer" entry)
                             — the 2D /script-writer page's post.

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
import type { RankedTitle } from "../title-studio";

export const HOOK_DESK_STATION_ID = "hook-desk";
export const HOOK_STUDIO_PATH = "/api/hook-studio";
export const CTA_PATH = "/api/generate-cta";
export const TITLE_STUDIO_PATH = "/api/title-studio";
export const SCRIPT_WRITER_PATH = "/api/script-writer";

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

/** POST /api/title-studio — registry 100, the route's
 *  TITLE_STUDIO_CREDITS default agrees. */
export function titleStudioCost(): number {
  return registryCost(TITLE_STUDIO_PATH);
}

/** POST /api/script-writer — registry 200, the route's
 *  SCRIPT_WRITER_CREDIT_COST default agrees. */
export function scriptWriterCost(): number {
  return registryCost(SCRIPT_WRITER_PATH);
}

/* ─── The routes' own enums (verbatim) ───────────────────────────── */

export type HookDeskMode = "hooks" | "captions" | "preflight" | "cta" | "titles" | "scripts";

export const HOOK_DESK_MODES: readonly HookDeskMode[] = [
  "hooks",
  "captions",
  "preflight",
  "cta",
  "titles",
  "scripts",
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
type CtaPlacement = (typeof CTA_PLACEMENTS)[number];

/** title-studio.ts PLATFORMS — keep in sync with the 2D Titles tab. */
export const TITLE_PLATFORMS = ["youtube", "tiktok", "instagram"] as const;
export type TitlePlatform = (typeof TITLE_PLATFORMS)[number];

/** title-studio.ts TONES. */
export const TITLE_TONES = ["hype", "professional", "funny"] as const;
export type TitleTone = (typeof TITLE_TONES)[number];

/** script-writer.ts SCRIPT_WRITER_PLATFORMS. */
export const SCRIPT_PLATFORMS = ["youtube", "tiktok", "reels"] as const;
export type ScriptPlatform = (typeof SCRIPT_PLATFORMS)[number];

/** script-writer.ts SCRIPT_WRITER_LENGTHS. */
export const SCRIPT_LENGTHS = ["short", "medium", "long", "deep"] as const;
export type ScriptLength = (typeof SCRIPT_LENGTHS)[number];

/** script-writer.ts SCRIPT_WRITER_TONES. */
export const SCRIPT_TONES = ["educational", "entertaining", "inspirational", "controversial"] as const;
export type ScriptTone = (typeof SCRIPT_TONES)[number];

/** The price a mode's run shows (and the confirmation charges). */
export function hookDeskModeCost(mode: HookDeskMode): number {
  switch (mode) {
    case "cta":
      return ctaCost();
    case "titles":
      return titleStudioCost();
    case "scripts":
      return scriptWriterCost();
    default:
      return hookStudioCost();
  }
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

/** hooks.tsx TitlesTab's body for /api/title-studio:
 *  { topic, platform, tone, keywords } — topic required. */
export function buildTitlePayload(input: {
  topic: string;
  platform: TitlePlatform;
  tone: TitleTone;
  keywords: string;
}): Record<string, unknown> {
  return {
    topic: input.topic.trim(),
    platform: input.platform,
    tone: input.tone,
    keywords: input.keywords.trim(),
  };
}

/** script-writer.tsx generate()'s body for /api/script-writer:
 *  { platform, length, topic, tone, audience, ctaGoal } — the
 *  optionals ride as (possibly empty) strings, exactly as the page
 *  posts them; the route defaults them the same way. */
export function buildScriptPayload(input: {
  platform: ScriptPlatform;
  length: ScriptLength;
  topic: string;
  tone: ScriptTone;
  audience: string;
  ctaGoal: string;
}): Record<string, unknown> {
  return {
    platform: input.platform,
    length: input.length,
    topic: input.topic.trim(),
    tone: input.tone,
    audience: input.audience.trim(),
    ctaGoal: input.ctaGoal.trim(),
  };
}

/** The endpoint a mode posts to. */
export function hookDeskModePath(mode: HookDeskMode): string {
  switch (mode) {
    case "cta":
      return CTA_PATH;
    case "titles":
      return TITLE_STUDIO_PATH;
    case "scripts":
      return SCRIPT_WRITER_PATH;
    default:
      return HOOK_STUDIO_PATH;
  }
}

/** Whether a mode's required input is present — the run stays shut
 *  (and uncharged) until it is, mirroring the routes' zod minimums:
 *  hooks needs no topic (the route defaults it empty), captions
 *  needs a topic, preflight needs a title, CTA needs a video topic,
 *  titles and scripts each need their topic. The caller passes the
 *  ACTIVE bench's topic as `topic` — each bench keeps its own. */
export function hookDeskInputReady(
  mode: HookDeskMode,
  input: { topic: string; title: string },
): boolean {
  switch (mode) {
    case "hooks":
      return true;
    case "captions":
    case "cta":
    case "titles":
    case "scripts":
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

interface PreflightCheck {
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

export interface TitlesResult {
  titles: RankedTitle[];
  description: string;
  tags: string[];
  note: string;
}

/** The title pack out of a /api/title-studio answer — mirrors the
 *  route's parseTitleStudioResponse + the 2D tab's usability bar:
 *  unusable rows drop (as the route drops them), scores clamp
 *  0–100, tags shed leading #'s, caps hold at 10 titles / 15 tags;
 *  and a pack with no titles or no description is a failed make
 *  (null) — the route refuses the same shape server-side. */
export function titlesOfResponse(raw: unknown): TitlesResult | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw["titles"])) return null;
  const titles: RankedTitle[] = [];
  for (const t of raw["titles"]) {
    if (!isRecord(t)) continue;
    if (typeof t["title"] !== "string" || t["title"].trim().length === 0) continue;
    titles.push({
      title: t["title"].trim(),
      score:
        typeof t["score"] === "number"
          ? Math.max(0, Math.min(100, Math.round(t["score"])))
          : 0,
      why: typeof t["why"] === "string" ? t["why"].trim() : "",
    });
  }
  const description =
    typeof raw["description"] === "string" ? raw["description"].trim() : "";
  if (titles.length === 0 || !description) return null;
  const tags = stringList(raw["tags"])
    .map((t) => t.replace(/^#+/, ""))
    .filter((t) => t.length > 0)
    .slice(0, 15);
  return {
    titles: titles.slice(0, 10),
    description,
    tags,
    note: typeof raw["note"] === "string" ? raw["note"].trim() : "",
  };
}

export interface ScriptBeat {
  timestamp: string;
  spoken: string;
  visualCue: string;
  broll: string;
}

export interface RetentionBeat {
  at: string;
  tactic: string;
  line: string;
}

export interface ScriptResult {
  title: string;
  hook: string;
  beats: ScriptBeat[];
  retentionBeats: RetentionBeat[];
  cta: string;
  teleprompter: string;
}

/** The script out of a /api/script-writer answer — mirrors the
 *  route's own parse: beats keep only rows with a timestamp and
 *  spoken words (caps 40 beats / 20 retention beats, as the route
 *  slices), and the route's usability bar is the desk's too — no
 *  hook or no usable beats is a failed make (null), refunded
 *  server-side, never an empty script dressed as a result. */
export function scriptOfResponse(raw: unknown): ScriptResult | null {
  if (!isRecord(raw)) return null;
  const hook = typeof raw["hook"] === "string" ? raw["hook"].trim() : "";
  const beats: ScriptBeat[] = [];
  if (Array.isArray(raw["beats"])) {
    for (const b of raw["beats"]) {
      if (!isRecord(b)) continue;
      if (typeof b["timestamp"] !== "string" || typeof b["spoken"] !== "string") continue;
      const spoken = b["spoken"].trim();
      if (spoken.length === 0) continue;
      beats.push({
        timestamp: b["timestamp"].trim(),
        spoken,
        visualCue: typeof b["visualCue"] === "string" ? b["visualCue"].trim() : "",
        broll: typeof b["broll"] === "string" ? b["broll"].trim() : "",
      });
    }
  }
  if (!hook || beats.length === 0) return null;
  const retentionBeats: RetentionBeat[] = [];
  if (Array.isArray(raw["retentionBeats"])) {
    for (const r of raw["retentionBeats"]) {
      if (!isRecord(r)) continue;
      if (typeof r["at"] !== "string" || typeof r["line"] !== "string") continue;
      const line = r["line"].trim();
      if (line.length === 0) continue;
      retentionBeats.push({
        at: r["at"].trim(),
        tactic: typeof r["tactic"] === "string" ? r["tactic"].trim() : "",
        line,
      });
    }
  }
  return {
    title: typeof raw["title"] === "string" ? raw["title"].trim() : "",
    hook,
    beats: beats.slice(0, 40),
    retentionBeats: retentionBeats.slice(0, 20),
    cta: typeof raw["cta"] === "string" ? raw["cta"].trim() : "",
    teleprompter:
      typeof raw["teleprompter"] === "string" ? raw["teleprompter"].trim() : "",
  };
}

/* ─── Templates — the site's own libraries prefill the desk ──────── */

interface HookTemplatePrefill {
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

interface CaptionPackPrefill {
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
  titlesResult?: TitlesResult;
  scriptResult?: ScriptResult;
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
