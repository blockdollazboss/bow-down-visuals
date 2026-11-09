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

/* ═══ Stack 400 · census B-16 / B-17 / B-20 — the hooks family's
   remaining rails, native at this desk ═══════════════════════════
   Three 2D families had no in-World form; their rails now dock
   here, on the twins' own posts at the registry's prices:

     B-16  AI Interview (the /hooks page's AIInterviewSection):
       POST /api/ai-interview/questions { topic, niche }
         → { questions[≤5] }                       100 VB
       POST /api/ai-interview/package   { topic, qa[{question,
         answer}] } → { clips[{quote, why}], quoteCards[],
         promoOutline[] }                          200 VB
     B-17  Three-Second Lab openings (the editor rail's
       ThreeSecondLabSection + the /hooks page):
       POST /api/three-second-lab/openings
         { videoDescription, niche }
         → { openings[{text, visual, score, reasoning}] }  200 VB
     B-20  the loose diagnostics (Analytics Hub + editor + Plan
       hub tools with no World form):
       POST /api/analyze-hook      { transcript, platform, niche,
         mode } → { analysis{…} }                    75 VB
       POST /api/seo-score         { title, description, tags[],
         niche, hasChapters, hasCaptions }
         → { result{…} }                             75 VB
       POST /api/retention-doctor  { title, dropOffs[{at,
         dropPct}], totalLength?, niche?, videoType?,
         platform? } → { reportCard, summary, diagnoses[] } 150 VB
       POST /api/trend-jacker/draft { trend, trendWhy, niche,
         styleNotes } → { hook, script, visualPlan[], caption,
         hashtags[] }                                200 VB
       POST /api/style-stealer/analyze { videoUrl, description,
         niche } → { formula{…}, editRecipe?, applyHints? } 200 VB

   Every run rides confirmedFetch at the registry price (the
   twins' confirm-before-charge law); a declined confirmation
   runs nothing; failures are refunded server-side. Payload
   builders below mirror the twins' posts field for field and
   the readers hold the twins' own usability bars — drift
   parses to null, never to dressed-up rows. */

export const AI_INTERVIEW_QUESTIONS_PATH = "/api/ai-interview/questions";
export const AI_INTERVIEW_PACKAGE_PATH = "/api/ai-interview/package";
export const OPENINGS_PATH = "/api/three-second-lab/openings";
export const ANALYZE_HOOK_PATH = "/api/analyze-hook";
export const SEO_SCORE_PATH = "/api/seo-score";
export const RETENTION_DOCTOR_PATH = "/api/retention-doctor";
export const TREND_JACKER_PATH = "/api/trend-jacker/draft";
export const STYLE_STEALER_PATH = "/api/style-stealer/analyze";

/** POST /api/ai-interview/questions — registry 100, the 2D
 *  section's Q_COST agrees. */
export function aiInterviewQuestionsCost(): number {
  return registryCost(AI_INTERVIEW_QUESTIONS_PATH);
}

/** POST /api/ai-interview/package — registry 200, the 2D
 *  section's PKG_COST agrees. */
export function aiInterviewPackageCost(): number {
  return registryCost(AI_INTERVIEW_PACKAGE_PATH);
}

/** POST /api/three-second-lab/openings — registry 200, the
 *  rail's OPENINGS_CREDITS agrees (the section reads the
 *  registry for its display; no override rides the post). */
export function openingsCost(): number {
  return registryCost(OPENINGS_PATH);
}

/** POST /api/analyze-hook — registry 75, StepHookLab's COST. */
export function hookAnalyzerCost(): number {
  return registryCost(ANALYZE_HOOK_PATH);
}

/** POST /api/seo-score — registry 75 (the My Clips toast's own
 *  "costs 75 Visual Bucs" copy agrees). */
export function seoScoreCost(): number {
  return registryCost(SEO_SCORE_PATH);
}

/** POST /api/retention-doctor — registry 150. */
export function retentionDoctorCost(): number {
  return registryCost(RETENTION_DOCTOR_PATH);
}

/** POST /api/trend-jacker/draft — registry 200, the section's
 *  DRAFT_CREDITS agrees. */
export function trendJackerCost(): number {
  return registryCost(TREND_JACKER_PATH);
}

/** POST /api/style-stealer/analyze — registry 200, the
 *  section's COST agrees. */
export function styleStealerCost(): number {
  return registryCost(STYLE_STEALER_PATH);
}

/* ─── The diagnostics' own enums (verbatim from the twins) ───── */

/** intelligence/types.ts IntelPlatform (StepHookLab's post). */
export const DIAG_PLATFORMS = ["tiktok", "instagram", "youtube", "x"] as const;
export type DiagPlatform = (typeof DIAG_PLATFORMS)[number];

/** StepHookLab's analysis modes (the viral-loop toggle). */
export const HOOK_ANALYSIS_MODES = ["viral", "standard"] as const;
export type HookAnalysisMode = (typeof HOOK_ANALYSIS_MODES)[number];

/** RetentionDoctor.tsx VIDEO_TYPES. */
export const DOCTOR_VIDEO_TYPES = [
  "music-video",
  "tutorial",
  "vlog",
  "short",
  "promo",
  "livestream-clip",
  "other",
] as const;
export type DoctorVideoType = (typeof DOCTOR_VIDEO_TYPES)[number];

/** RetentionDoctor.tsx PLATFORMS. */
export const DOCTOR_PLATFORMS = ["tiktok", "instagram", "youtube", "x"] as const;
export type DoctorPlatform = (typeof DOCTOR_PLATFORMS)[number];

/** RetentionDoctor.tsx MM_SS — a drop-off point / total length
 *  is only real in m:ss shape. */
export const DOCTOR_TIME_RE = /^\d{1,3}:[0-5]\d$/;

export const SEO_SEVERITIES = ["high", "medium", "low"] as const;
export type SeoSeverity = (typeof SEO_SEVERITIES)[number];

export const DOCTOR_FIX_ACTIONS = ["hook", "script", "editor"] as const;
export type DoctorFixAction = (typeof DOCTOR_FIX_ACTIONS)[number];

/* ─── Payload shaping — the twins' posts, field for field ────── */

/** AIInterviewSection getQuestions' body:
 *  { topic, niche } — both trimmed, niche rides even empty. */
export function buildInterviewQuestionsPayload(input: {
  topic: string;
  niche: string;
}): Record<string, unknown> {
  return { topic: input.topic.trim(), niche: input.niche.trim() };
}

export interface InterviewQaPair {
  question: string;
  answer: string;
}

/** AIInterviewSection buildPackage's qa shaping: pair each
 *  question with its answer, keep only the answered ones. */
export function interviewQaPairs(
  questions: readonly string[],
  answers: readonly string[],
): InterviewQaPair[] {
  return questions
    .map((q, i) => ({ question: q, answer: (answers[i] ?? "").trim() }))
    .filter((x) => x.answer.length > 0);
}

/** AIInterviewSection buildPackage's body: { topic, qa }. */
export function buildInterviewPackagePayload(input: {
  topic: string;
  qa: readonly InterviewQaPair[];
}): Record<string, unknown> {
  return { topic: input.topic.trim(), qa: input.qa };
}

/** ThreeSecondLabSection generate()'s body:
 *  { videoDescription, niche } — both trimmed. (The section's
 *  optional clip upload only pre-describes the clip client-side;
 *  the rail's post is these two fields.) */
export function buildOpeningsPayload(input: {
  videoDescription: string;
  niche: string;
}): Record<string, unknown> {
  return { videoDescription: input.videoDescription.trim(), niche: input.niche.trim() };
}

/** StepHookLab run()'s body: the transcript clipped to 3,000
 *  chars, the niche to 100, mode from the viral toggle. */
export function buildHookAnalysisPayload(input: {
  transcript: string;
  platform: DiagPlatform;
  niche: string;
  mode: HookAnalysisMode;
}): Record<string, unknown> {
  return {
    transcript: input.transcript.trim().slice(0, 3000),
    platform: input.platform,
    niche: input.niche.trim().slice(0, 100),
    mode: input.mode,
  };
}

/** The My Clips SEO post's tags shaping: comma text → at most
 *  15 trimmed, non-empty tags. */
export function seoTagsFromText(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 15);
}

/** The My Clips SEO Score post's body, field for field. */
export function buildSeoScorePayload(input: {
  title: string;
  description: string;
  tagsText: string;
  niche: string;
  hasChapters: boolean;
  hasCaptions: boolean;
}): Record<string, unknown> {
  return {
    title: input.title.trim(),
    description: input.description.trim(),
    tags: seoTagsFromText(input.tagsText),
    niche: input.niche.trim(),
    hasChapters: input.hasChapters,
    hasCaptions: input.hasCaptions,
  };
}

export interface DoctorDropOffRow {
  at: string;
  dropPct: string;
}

/** RetentionDoctor's validRows rule: a real m:ss point and a
 *  drop percentage in 1–99. Invalid rows never ride the post. */
export function doctorDropOffValid(row: DoctorDropOffRow): boolean {
  return (
    DOCTOR_TIME_RE.test(row.at.trim()) &&
    row.dropPct.trim() !== "" &&
    Number(row.dropPct) >= 1 &&
    Number(row.dropPct) <= 99
  );
}

/** RetentionDoctor run()'s body: title clipped to 200, only the
 *  valid drop-off rows (percentages as numbers), and the
 *  optionals riding ONLY when set — totalLength only in m:ss
 *  shape, niche clipped to 100, type/platform only when picked. */
export function buildDoctorPayload(input: {
  title: string;
  dropOffs: readonly DoctorDropOffRow[];
  totalLength: string;
  niche: string;
  videoType: string;
  platform: string;
}): Record<string, unknown> {
  const validRows = input.dropOffs.filter(doctorDropOffValid);
  return {
    title: input.title.trim().slice(0, 200),
    dropOffs: validRows.map((r) => ({ at: r.at.trim(), dropPct: Number(r.dropPct) })),
    ...(input.totalLength.trim() && DOCTOR_TIME_RE.test(input.totalLength.trim())
      ? { totalLength: input.totalLength.trim() }
      : {}),
    ...(input.niche.trim() ? { niche: input.niche.trim().slice(0, 100) } : {}),
    ...(input.videoType ? { videoType: input.videoType } : {}),
    ...(input.platform ? { platform: input.platform } : {}),
  };
}

/** TrendJackerSection generate()'s body: the niche defaults to
 *  "Music" when blank, exactly as the section posts it. */
export function buildTrendDraftPayload(input: {
  trend: string;
  trendWhy: string;
  niche: string;
  styleNotes: string;
}): Record<string, unknown> {
  return {
    trend: input.trend.trim(),
    trendWhy: input.trendWhy.trim(),
    niche: input.niche.trim() || "Music",
    styleNotes: input.styleNotes.trim(),
  };
}

/** StyleStealerSection analyze()'s body:
 *  { videoUrl, description, niche } — all trimmed. */
export function buildStyleStealerPayload(input: {
  videoUrl: string;
  description: string;
  niche: string;
}): Record<string, unknown> {
  return {
    videoUrl: input.videoUrl.trim(),
    description: input.description.trim(),
    niche: input.niche.trim(),
  };
}

/* ─── Input readiness — the twins' own run gates ─────────────── */

export function interviewQuestionsReady(topic: string): boolean {
  return topic.trim().length > 0;
}

export function interviewPackageReady(
  questions: readonly string[],
  answers: readonly string[],
): boolean {
  return questions.length > 0 && interviewQaPairs(questions, answers).length > 0;
}

export function openingsReady(videoDescription: string): boolean {
  return videoDescription.trim().length > 0;
}

export function hookAnalysisReady(transcript: string): boolean {
  return transcript.trim().length > 0;
}

export function seoScoreReady(title: string): boolean {
  return title.trim().length > 0;
}

/** The doctor's formValid: a title of 3+ chars and at least one
 *  valid drop-off row. */
export function doctorReady(title: string, dropOffs: readonly DoctorDropOffRow[]): boolean {
  return title.trim().length >= 3 && dropOffs.some(doctorDropOffValid);
}

export function trendDraftReady(trend: string): boolean {
  return trend.trim().length > 0;
}

export function styleStealerReady(description: string): boolean {
  return description.trim().length > 0;
}

/* ─── Response guards — the twins' usability bars ────────────── */

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function clampScore(v: unknown): number {
  return Math.max(0, Math.min(100, Math.round(numOr(v, 0))));
}

/** The interview questions out of a questions answer — the
 *  section slices to 5 and treats an empty list as no result. */
export function interviewQuestionsOfResponse(raw: unknown): string[] | null {
  if (!isRecord(raw)) return null;
  const questions = stringList(raw["questions"]).slice(0, 5);
  return questions.length > 0 ? questions : null;
}

export interface InterviewClipMoment {
  quote: string;
  why: string;
}

export interface InterviewPackageResult {
  clips: InterviewClipMoment[];
  quoteCards: string[];
  promoOutline: string[];
}

/** The package out of a package answer — the clips array is the
 *  payload (the section sets the package on its presence);
 *  quote cards and the promo outline ride as string lists. */
export function interviewPackageOfResponse(raw: unknown): InterviewPackageResult | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw["clips"])) return null;
  const clips: InterviewClipMoment[] = [];
  for (const c of raw["clips"]) {
    if (!isRecord(c)) continue;
    if (typeof c["quote"] !== "string" || c["quote"].trim().length === 0) continue;
    clips.push({
      quote: c["quote"].trim(),
      why: typeof c["why"] === "string" ? c["why"].trim() : "",
    });
  }
  return {
    clips,
    quoteCards: stringList(raw["quoteCards"]),
    promoOutline: stringList(raw["promoOutline"]),
  };
}

export interface OpeningResult {
  text: string;
  visual: string;
  score: number;
  reasoning: string;
}

/** The openings out of an openings answer — the section refuses
 *  an empty list and sorts best-first by score; the desk holds
 *  both rules. Rows without opening text are not openings. */
export function openingsOfResponse(raw: unknown): OpeningResult[] | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw["openings"])) return null;
  const out: OpeningResult[] = [];
  for (const o of raw["openings"]) {
    if (!isRecord(o)) continue;
    if (typeof o["text"] !== "string" || o["text"].trim().length === 0) continue;
    out.push({
      text: o["text"].trim(),
      visual: typeof o["visual"] === "string" ? o["visual"].trim() : "",
      score: clampScore(o["score"]),
      reasoning: typeof o["reasoning"] === "string" ? o["reasoning"].trim() : "",
    });
  }
  if (out.length === 0) return null;
  return out.sort((a, b) => b.score - a.score);
}

export interface HookAnalysisResult {
  curiosityGap: number;
  patternInterrupt: number;
  clarity: number;
  overallScore: number;
  verdict: string;
  weaknesses: string[];
  rewrittenHook: string;
  rewriteNotes: string[];
  alternativeHooks: string[];
}

/** The analysis out of an analyze-hook answer — StepHookLab
 *  accepts it only with an analysis carrying an overallScore;
 *  the three axes are 0–10 scores, clamped as the step clamps
 *  them for display. */
export function hookAnalysisOfResponse(raw: unknown): HookAnalysisResult | null {
  if (!isRecord(raw)) return null;
  const a = raw["analysis"];
  if (!isRecord(a)) return null;
  if (typeof a["overallScore"] !== "number") return null;
  const axis = (v: unknown) => Math.max(0, Math.min(10, numOr(v, 0)));
  return {
    curiosityGap: axis(a["curiosityGap"]),
    patternInterrupt: axis(a["patternInterrupt"]),
    clarity: axis(a["clarity"]),
    overallScore: clampScore(a["overallScore"]),
    verdict: typeof a["verdict"] === "string" ? a["verdict"].trim() : "",
    weaknesses: stringList(a["weaknesses"]),
    rewrittenHook: typeof a["rewrittenHook"] === "string" ? a["rewrittenHook"].trim() : "",
    rewriteNotes: stringList(a["rewriteNotes"]),
    alternativeHooks: stringList(a["alternativeHooks"]),
  };
}

export interface SeoScoreIssue {
  severity: SeoSeverity;
  message: string;
  fix: string;
}

export interface SeoScoreResult {
  overallScore: number;
  dimensions: {
    titleStrength: number;
    keywordCoverage: number;
    descriptionQuality: number;
    tagRelevance: number;
    packagingComplete: number;
  };
  issues: SeoScoreIssue[];
  optimizedTitle: string;
  optimizedDescriptionFirst150: string;
}

/** The score out of a seo-score answer — the result record with
 *  its five dimensions is the payload; an issue whose severity
 *  is not one of the route's three is dropped, not rendered. */
export function seoScoreOfResponse(raw: unknown): SeoScoreResult | null {
  if (!isRecord(raw)) return null;
  const r = raw["result"];
  if (!isRecord(r)) return null;
  if (typeof r["overallScore"] !== "number") return null;
  const dims = isRecord(r["dimensions"]) ? r["dimensions"] : {};
  const issues: SeoScoreIssue[] = [];
  if (Array.isArray(r["issues"])) {
    for (const i of r["issues"]) {
      if (!isRecord(i)) continue;
      if (!(SEO_SEVERITIES as readonly string[]).includes(i["severity"] as string)) continue;
      issues.push({
        severity: i["severity"] as SeoSeverity,
        message: typeof i["message"] === "string" ? i["message"].trim() : "",
        fix: typeof i["fix"] === "string" ? i["fix"].trim() : "",
      });
    }
  }
  return {
    overallScore: clampScore(r["overallScore"]),
    dimensions: {
      titleStrength: clampScore(dims["titleStrength"]),
      keywordCoverage: clampScore(dims["keywordCoverage"]),
      descriptionQuality: clampScore(dims["descriptionQuality"]),
      tagRelevance: clampScore(dims["tagRelevance"]),
      packagingComplete: clampScore(dims["packagingComplete"]),
    },
    issues,
    optimizedTitle: typeof r["optimizedTitle"] === "string" ? r["optimizedTitle"].trim() : "",
    optimizedDescriptionFirst150:
      typeof r["optimizedDescriptionFirst150"] === "string"
        ? r["optimizedDescriptionFirst150"].trim()
        : "",
  };
}

export interface DoctorDiagnosis {
  at: string;
  dropPct: number;
  causeCategory: string;
  causeLabel: string;
  diagnosis: string;
  prescription: string;
  fixAction: DoctorFixAction;
  fixLabel: string;
  fixUrl: string;
}

export interface DoctorResult {
  reportCard: { grade: string; score: number; headline: string };
  summary: string;
  diagnoses: DoctorDiagnosis[];
}

/** The diagnosis out of a retention-doctor answer — the page
 *  accepts it only with a report card AND at least one
 *  diagnosis; a row without its moment, cause or prescription
 *  is dropped rather than rendered half-told. */
export function doctorOfResponse(raw: unknown): DoctorResult | null {
  if (!isRecord(raw)) return null;
  const card = raw["reportCard"];
  if (!isRecord(card)) return null;
  if (typeof card["grade"] !== "string" || typeof card["score"] !== "number") return null;
  if (!Array.isArray(raw["diagnoses"])) return null;
  const diagnoses: DoctorDiagnosis[] = [];
  for (const d of raw["diagnoses"]) {
    if (!isRecord(d)) continue;
    if (
      typeof d["at"] !== "string" ||
      typeof d["dropPct"] !== "number" ||
      typeof d["causeLabel"] !== "string" ||
      typeof d["prescription"] !== "string"
    ) {
      continue;
    }
    diagnoses.push({
      at: d["at"].trim(),
      dropPct: d["dropPct"],
      causeCategory: typeof d["causeCategory"] === "string" ? d["causeCategory"].trim() : "",
      causeLabel: d["causeLabel"].trim(),
      diagnosis: typeof d["diagnosis"] === "string" ? d["diagnosis"].trim() : "",
      prescription: d["prescription"].trim(),
      fixAction: (DOCTOR_FIX_ACTIONS as readonly string[]).includes(d["fixAction"] as string)
        ? (d["fixAction"] as DoctorFixAction)
        : "hook",
      fixLabel: typeof d["fixLabel"] === "string" ? d["fixLabel"].trim() : "",
      fixUrl: typeof d["fixUrl"] === "string" ? d["fixUrl"].trim() : "",
    });
  }
  if (diagnoses.length === 0) return null;
  return {
    reportCard: {
      grade: card["grade"].trim(),
      score: clampScore(card["score"]),
      headline: typeof card["headline"] === "string" ? card["headline"].trim() : "",
    },
    summary: typeof raw["summary"] === "string" ? raw["summary"].trim() : "",
    diagnoses,
  };
}

export interface TrendDraftResult {
  hook: string;
  script: string;
  visualPlan: string[];
  caption: string;
  hashtags: string[];
}

/** The draft out of a trend-jacker answer — the section refuses
 *  a draft without a hook or a script; the rest rides along. */
export function trendDraftOfResponse(raw: unknown): TrendDraftResult | null {
  if (!isRecord(raw)) return null;
  const hook = typeof raw["hook"] === "string" ? raw["hook"].trim() : "";
  const script = typeof raw["script"] === "string" ? raw["script"].trim() : "";
  if (!hook || !script) return null;
  return {
    hook,
    script,
    visualPlan: stringList(raw["visualPlan"]),
    caption: typeof raw["caption"] === "string" ? raw["caption"].trim() : "",
    hashtags: stringList(raw["hashtags"]),
  };
}

export interface StyleFormulaResult {
  formula: {
    hook: string;
    pacing: string;
    cutPattern: string;
    captionStyle: string;
    audioCues: string;
    whyItWorks: string;
  };
  editRecipe: { name: string; steps: string[] } | null;
  applyHints: { captionStyle: string; effects: string[]; overlays: string[] } | null;
}

/** The formula out of a style-stealer answer — the section
 *  refuses an answer without the formula record; its hook line
 *  is the payload. The recipe and apply hints ride when the
 *  route sends them (the World bench shows the recipe; the
 *  editor-apply step stays the editor page's own). */
export function styleFormulaOfResponse(raw: unknown): StyleFormulaResult | null {
  if (!isRecord(raw)) return null;
  const f = raw["formula"];
  if (!isRecord(f)) return null;
  if (typeof f["hook"] !== "string" || f["hook"].trim().length === 0) return null;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const recipe = isRecord(raw["editRecipe"])
    ? {
        name: str(raw["editRecipe"]["name"]),
        steps: stringList(raw["editRecipe"]["steps"]),
      }
    : null;
  const hints = isRecord(raw["applyHints"])
    ? {
        captionStyle: str(raw["applyHints"]["captionStyle"]),
        effects: stringList(raw["applyHints"]["effects"]),
        overlays: stringList(raw["applyHints"]["overlays"]),
      }
    : null;
  return {
    formula: {
      hook: str(f["hook"]),
      pacing: str(f["pacing"]),
      cutPattern: str(f["cutPattern"]),
      captionStyle: str(f["captionStyle"]),
      audioCues: str(f["audioCues"]),
      whyItWorks: str(f["whyItWorks"]),
    },
    editRecipe: recipe,
    applyHints: hints,
  };
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

/* ─── Stack 400 · census B-19 — Hook Rewriter (wave8) ─────────
   The Wave8 single rail that belongs to this desk (manifest
   lane s400-world-wave8, joining AFTER the B-16/B-17/B-20
   section above): the Hook Rewriter bench stacked under the
   Hook Desk beside the desk's other benches.

     POST /api/wave8/hook-rewriter/rewrite   50  HookRewriter

   The payload is shaped EXACTLY as the page shapes it (the
   post trimmed, the niche trimmed-or-absent) and the answer
   is read at the page's own acceptance bar — exactly five
   variants or it didn't rewrite. */

export const HOOK_REWRITER_PATH = "/api/wave8/hook-rewriter/rewrite";

/** POST /api/wave8/hook-rewriter/rewrite — registry 50, read
 *  through this file's own registry helper. */
export function hookRewriterCost(): number {
  return registryCost(HOOK_REWRITER_PATH);
}

/** The page's rewrite body, field for field. */
export function buildHookRewriterPayload(input: {
  post: string;
  niche: string;
}): { post: string; niche: string | undefined } {
  return {
    post: input.post.trim(),
    niche: input.niche.trim() || undefined,
  };
}

export interface HookRewriterVariant {
  hook: string;
  angle: string;
  whyItWorks: string;
}

export interface HookRewriterResult {
  variants: HookRewriterVariant[];
}

/** The page's acceptance rule: an array of EXACTLY five
 *  variants, each carrying its hook / angle / why-it-works. */
export function hookRewriterResultOf(data: unknown): HookRewriterResult | null {
  if (!isRecord(data)) return null;
  if (!Array.isArray(data.variants) || data.variants.length !== 5) return null;
  const variants: HookRewriterVariant[] = [];
  for (const raw of data.variants as unknown[]) {
    if (!isRecord(raw)) return null;
    variants.push({
      hook: typeof raw.hook === "string" ? raw.hook : "",
      angle: typeof raw.angle === "string" ? raw.angle : "",
      whyItWorks: typeof raw.whyItWorks === "string" ? raw.whyItWorks : "",
    });
  }
  return { variants };
}
