/**
 * create-desks.ts — the Create Wing desks' shared logic (NATIVE-PLAN §3.6).
 *
 * Pure, testable logic for the six quick-create benches that live in
 * the palace: payload shaping (mirroring each desk's website page
 * exactly), the REAL Visual Bucs price each desk shows before
 * anything runs, task/job polling interpretation, draft payloads
 * (POST /api/drafts), and the editor-project seed (POST /api/projects,
 * the same shape make-video's performSave posts — the step-through's
 * newest-project seeding then opens the editor on THIS result).
 *
 * MONEY LAW: no price is invented here. Every cost comes from the
 * exact source the corresponding page uses:
 *   - the credit-cost registry (`getCreditCost`, lib/credit-costs) —
 *     the same registry the pages' credit confirmation reads;
 *   - the cover-art tier table (`getCoverArtTier`, lib/cover-art) —
 *     the cover page's own tier picker;
 *   - the artist-image model table (`ARTIST_IMAGE_MODELS`) — the
 *     image modal's own per-model price;
 *   - two server-default constants the registry never registered,
 *     each pinned to BOTH the page's displayed badge and the server
 *     route's default charge (finish-my-song 400, cover-in-motion
 *     400 — see the constants below).
 * Naming law: the automatic mode is "Turbo", the manual tier is
 * "Advanced"; no provider names appear in any user-facing string.
 */
import { getCreditCost } from "../credit-costs";
import { getCoverArtTier } from "../cover-art";
import {
  ARTIST_IMAGE_MODELS,
  type ArtistImageModel,
} from "../../components/generate-artist-image";
import { buildSchedulerHref } from "../scheduler-handoff";

export type CreateDeskId =
  | "song-desk"
  | "video-desk"
  | "song-video-desk"
  | "cover-art-desk"
  | "thumbnail-desk"
  | "audio-desk";

/** The six Create Wing stations whose panel pattern is "create". */
export const CREATE_DESK_IDS: readonly CreateDeskId[] = [
  "song-desk",
  "video-desk",
  "song-video-desk",
  "cover-art-desk",
  "thumbnail-desk",
  "audio-desk",
];

export function isCreateDeskId(id: string): id is CreateDeskId {
  return (CREATE_DESK_IDS as readonly string[]).includes(id);
}

/* ─── Costs — the real server charges, from the pages' own sources ── */

/** Registry cost for an endpoint; throws if unregistered so a desk
 *  can never silently show (or charge against) an invented price. */
function registryCost(endpoint: string): number {
  const entry = getCreditCost(endpoint);
  if (!entry) throw new Error(`No registered credit cost for ${endpoint}`);
  return entry.cost;
}

/** Song Desk — POST /api/generate-song. Registry: 400 (the make-song
 *  page's CostBadge cost={400} and the server's CREDIT_COST agree). */
export function songDeskCost(): number {
  return registryCost("/api/generate-song");
}

/** Song + Video Desk — POST /api/generate-song-video. Registry: 400
 *  (the song-and-video page's costBadge "400 Visual Bucs" agrees). */
export function songVideoDeskCost(): number {
  return registryCost("/api/generate-song-video");
}

/** Video Desk clip — POST /api/generate-runway-clip with the desk's
 *  default payload (no model/duration override — the shape
 *  MusicVideoTimeline posts). Registry: 400, the flat default-model
 *  charge on the server. */
export function videoClipCost(): number {
  return registryCost("/api/generate-runway-clip");
}

/** Video Desk plan — POST /api/generate-video-plan. Registry: 200
 *  (the server's video-plan CREDIT_COST agrees). */
export function videoPlanCost(): number {
  return registryCost("/api/generate-video-plan");
}

/** Cover Art Desk — the cover page's tier table: standard 200 /
 *  premium 300 (getCoverArtTier is the page's own pricing source). */
export function coverArtCost(tier: "standard" | "premium"): number {
  return getCoverArtTier(tier).credits;
}

/** Cover-in-motion — POST /api/cover-in-motion/animate. Not in the
 *  registry; the Create hub panel's badge says "400 VB" and the
 *  server route's MOTION_CREDIT_COST defaults to 400. */
export const COVER_IN_MOTION_COST_VB = 400;

export function coverInMotionCost(): number {
  return COVER_IN_MOTION_COST_VB;
}

/** Artist image — POST /api/generate-artist-image (+ /:taskId poll).
 *  Per-model price from the image modal's own model table. */
export function artistImageCost(model: ArtistImageModel): number {
  return ARTIST_IMAGE_MODELS.find((m) => m.id === model)?.credits ?? 200;
}

/** The desk's default artist-image model (the modal's fast default). */
export const DEFAULT_ARTIST_IMAGE_MODEL: ArtistImageModel = "gen4_image";

/** Thumbnail Desk — POST /api/generate-thumbnail. The server charges
 *  100 for the text package + 200 more when the image lands (its
 *  creditsUsed is exactly that sum), and the thumbnail page's own
 *  badge quotes it as "up to 300 Visual Bucs" — so 300 is the price
 *  shown up front: the most the make can cost. */
export const THUMBNAIL_MAX_COST_VB = 300;

export function thumbnailDeskCost(): number {
  return THUMBNAIL_MAX_COST_VB;
}

/** Audio quick bench — cleanup / deverb / beats / SFX read the
 *  registry exactly as their pages do (cleanup's page constant is
 *  3 legacy credits × 100 = 300, matching the registry; deverb's
 *  registry entry matches the server's DEVERB_CREDIT_COST default
 *  of 1000 — the tool stays server-gated until its pricing/provider
 *  gates open, and the desk surfaces that refusal honestly). */
export function audioCleanupCost(): number {
  return registryCost("/api/audio-cleanup");
}
export function deverbCost(): number {
  return registryCost("/api/deverb");
}
export function beatCost(): number {
  return registryCost("/api/beat/generate");
}
export function sfxCost(): number {
  return registryCost("/api/generate-sfx");
}

/** Finish my song — POST /api/finish-my-song/complete. Not in the
 *  registry; the Audio Studio panel's badge says "400 VB" and the
 *  server route's FINISH_CREDIT_COST defaults to 400. */
export const FINISH_MY_SONG_COST_VB = 400;

export function finishMySongCost(): number {
  return FINISH_MY_SONG_COST_VB;
}

/* ─── Payload shaping — mirrors each page's request body ─────────── */

export interface SongAdvanced {
  artistName: string;
  songTitle: string;
  genre: string;
  mood: string;
  cleanOrExplicit: string;
  voiceStyle: string;
  beatStyle: string;
  songLength: string;
  specialInstructions: string;
}

export const EMPTY_SONG_ADVANCED: SongAdvanced = {
  artistName: "",
  songTitle: "",
  genre: "",
  mood: "",
  cleanOrExplicit: "",
  voiceStyle: "",
  beatStyle: "",
  songLength: "",
  specialInstructions: "",
};

/** make-song.tsx, Turbo (its "simple" mode): the prompt becomes the
 *  song topic and the instructions tell the maker to choose the
 *  style itself; every other field rides empty, exactly as the page
 *  posts it. */
export function buildSongPayloadTurbo(prompt: string): Record<string, unknown> {
  return {
    artistName: "",
    songTitle: "",
    genre: "",
    mood: "",
    songTopic: prompt.trim(),
    explicit: "",
    voiceStyle: "",
    beatStyle: "",
    songLength: "",
    instructions:
      "Create a complete song from this description. Write the lyrics and choose the style automatically.",
    artistVault: null,
  };
}

/** make-song.tsx, Advanced (its custom form): the form fields post
 *  under the API's names (cleanOrExplicit → explicit,
 *  specialInstructions → instructions). */
export function buildSongPayloadAdvanced(
  prompt: string,
  adv: SongAdvanced,
): Record<string, unknown> {
  return {
    artistName: adv.artistName,
    songTitle: adv.songTitle,
    genre: adv.genre,
    mood: adv.mood,
    songTopic: prompt.trim(),
    explicit: adv.cleanOrExplicit,
    voiceStyle: adv.voiceStyle,
    beatStyle: adv.beatStyle,
    songLength: adv.songLength,
    instructions: adv.specialInstructions,
    artistVault: null,
  };
}

export interface SongVideoAdvanced extends SongAdvanced {
  videoStyle: string;
  platform: string;
}

/** song-and-video.tsx's Simple intake defaults — the desk's Turbo
 *  mode posts the same AI-picked defaults the page's simple mode
 *  uses, with the prompt as the song topic. */
export const SONG_VIDEO_TURBO_DEFAULTS = {
  genre: "Hip Hop",
  mood: "Energetic",
  videoStyle: "Street Cinematic",
  platform: "TikTok / Reels / Shorts - 9:16",
  cleanOrExplicit: "Clean",
  voiceStyle: "Confident, melodic",
  beatStyle: "Modern trap-influenced",
  songLength: "Standard (3 min)",
} as const;

export function buildSongVideoPayloadTurbo(prompt: string): Record<string, unknown> {
  const d = SONG_VIDEO_TURBO_DEFAULTS;
  return {
    artistName: "",
    songTitle: "",
    genre: d.genre,
    mood: d.mood,
    explicit: d.cleanOrExplicit,
    songTopic: prompt.trim(),
    voiceStyle: d.voiceStyle,
    beatStyle: d.beatStyle,
    songLength: d.songLength,
    videoStyle: d.videoStyle,
    platform: d.platform,
    artistDescription: "",
    existingLyrics: undefined,
  };
}

/** song-and-video.tsx's guided generate: the full form, with the
 *  location/length/instructions folded into one instructions field
 *  exactly as the page folds them. */
export function buildSongVideoPayloadAdvanced(
  prompt: string,
  adv: SongVideoAdvanced,
  extras: { locationIdeas?: string; videoLength?: string } = {},
): Record<string, unknown> {
  const combinedInstructions = [
    extras.locationIdeas ? `Location Ideas: ${extras.locationIdeas}` : null,
    extras.videoLength ? `Video Length: ${extras.videoLength}` : null,
    adv.specialInstructions || null,
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    artistName: adv.artistName,
    songTitle: adv.songTitle,
    genre: adv.genre,
    mood: adv.mood,
    explicit: adv.cleanOrExplicit,
    songTopic: prompt.trim(),
    voiceStyle: adv.voiceStyle,
    beatStyle: adv.beatStyle,
    songLength: adv.songLength,
    videoStyle: adv.videoStyle,
    platform: adv.platform,
    artistDescription: "",
    instructions: combinedInstructions || undefined,
    existingLyrics: undefined,
    artistVault: undefined,
    songStructure: undefined,
  };
}

export interface VideoPlanAdvanced {
  artistName: string;
  songTitle: string;
  genre: string;
  mood: string;
  videoStyle: string;
  platform: string;
  videoLength: string;
  lyrics: string;
}

/** make-video.tsx's onGenerate body for POST /api/generate-video-plan
 *  (Turbo: the prompt rides as the lyrics/topic seed with the plan's
 *  other fields empty; Advanced fills them from the expander). */
export function buildVideoPlanPayload(
  prompt: string,
  adv?: Partial<VideoPlanAdvanced>,
): Record<string, unknown> {
  return {
    artistName: adv?.artistName ?? "",
    songTitle: adv?.songTitle ?? "",
    genre: adv?.genre ?? "",
    mood: adv?.mood ?? "",
    videoStyle: adv?.videoStyle ?? "",
    platform: adv?.platform ?? "",
    videoLength: adv?.videoLength ?? "",
    lyrics: adv?.lyrics ?? prompt.trim(),
    artistDescription: "",
    instructions: "",
    presenter: null,
    artistVault: undefined,
    songStructure: undefined,
  };
}

/** The runway clip body MusicVideoTimeline posts for a scene:
 *  promptText + negativePrompt + the vertical ratio, nothing else
 *  (the flat default-model charge — see videoClipCost). */
export function buildRunwayClipPayload(
  prompt: string,
  negativePrompt = "",
): Record<string, unknown> {
  return {
    promptText: prompt.trim(),
    negativePrompt,
    ratio: "720:1280",
  };
}

export interface CoverArtAdvanced {
  songTitle: string;
  artistName: string;
  style: string;
  aspectRatio: string;
  tier: "standard" | "premium";
  /** Ring 2 (2.11): the cover page's opt-in "Made with" attribution
   *  toggle — rides the payload exactly as the page posts it. */
  attribution?: boolean;
}

/** cover-art.tsx's generate body: in Turbo the prompt is the mood /
 *  art direction and the title + artist ride from the expander (the
 *  endpoint requires both, so the desk keeps the run shut until
 *  they are filled — the runner's cost gate is not the only gate). */
export function buildCoverArtPayload(
  prompt: string,
  adv: CoverArtAdvanced,
): Record<string, unknown> {
  return {
    songTitle: adv.songTitle.trim(),
    artistName: adv.artistName.trim(),
    mood: prompt.trim(),
    style: adv.style,
    aspectRatio: adv.aspectRatio,
    tier: adv.tier,
    attribution: adv.attribution ?? false,
  };
}

/** Ring 2 (2.11) — cover-art.tsx's one-tap vibe preset grid, verbatim:
 *  picking a preset sets the desk's style + mood (prompt) fields. */
export const COVER_ART_PRESETS: ReadonlyArray<{ label: string; style: string; mood: string }> = [
  { label: "💎 Luxury Gold", style: "luxury-gold", mood: "luxurious and premium" },
  { label: "🌙 Dark Moody", style: "dark-moody", mood: "dark and atmospheric" },
  { label: "🎨 Vibrant Pop", style: "vibrant-pop", mood: "bold and energetic" },
  { label: "🎬 Cinematic", style: "cinematic", mood: "epic and dramatic" },
];

/** PublishToShowcase's publish body (POST /api/showcase/publish —
 *  the cover page's "publish-to-showcase" rail, free). */
export function buildShowcasePublishPayload(input: {
  title: string;
  description?: string;
  mediaType: string;
  mediaUrl: string;
  thumbnailUrl?: string | null;
  creatorName?: string;
}): Record<string, unknown> {
  return {
    title: input.title.trim(),
    description: (input.description ?? "").trim(),
    mediaType: input.mediaType,
    mediaUrl: input.mediaUrl,
    thumbnailUrl: input.thumbnailUrl ?? null,
    creatorName: input.creatorName?.trim() ? input.creatorName.trim() : undefined,
  };
}

/** The published showcase slug from POST /api/showcase/publish's
 *  response ({ item: { slug } }) — null when the publish didn't land
 *  as a showcase item, so the desk never links to a phantom page. */
export function showcaseSlugOfResponse(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const item = (json as { item?: unknown }).item;
  if (!item || typeof item !== "object") return null;
  const slug = (item as { slug?: unknown }).slug;
  return typeof slug === "string" && slug.length > 0 ? slug : null;
}

/** ShareMenu's share-tracking body (POST /api/shares — feeds the
 *  weekly Viral Sharer quest; tracking only, never blocks sharing). */
export function buildShareTrackPayload(input: {
  contentType: string;
  contentId?: string | null;
  channel: string;
}): Record<string, unknown> {
  return {
    content_type: input.contentType,
    content_id: input.contentId ?? null,
    channel: input.channel,
  };
}

/** CoverInMotionPanel's animate body (5-second loop). */
export function buildCoverInMotionPayload(
  imageUrl: string,
  style = "",
): Record<string, unknown> {
  return { imageUrl: imageUrl.trim(), style: style.trim(), durationSec: 5 };
}

/** GenerateArtistImageModal's start body. */
export function buildArtistImagePayload(
  prompt: string,
  model: ArtistImageModel = DEFAULT_ARTIST_IMAGE_MODEL,
  ratio = "1080:1080",
): Record<string, unknown> {
  return {
    promptText: prompt.trim(),
    model,
    ratio,
    referenceImageUrl: null,
  };
}

export interface ThumbnailAdvanced {
  artistName: string;
  songTitle: string;
  platform: string;
  artStyle: string;
  colorTheme: string;
  mood: string;
  featuredText: string;
}

/** thumbnail-studio.tsx's single-shot (Artwork) body for
 *  POST /api/generate-thumbnail: the prompt rides as the maker's
 *  special requests, the rest from the expander. */
export function buildThumbnailPayload(
  prompt: string,
  adv: ThumbnailAdvanced,
): Record<string, unknown> {
  return {
    artistName: adv.artistName,
    songTitle: adv.songTitle,
    platform: adv.platform,
    artStyle: adv.artStyle,
    colorTheme: adv.colorTheme,
    mood: adv.mood,
    featuredText: adv.featuredText,
    requests: prompt.trim(),
    artistVault: null,
  };
}

/* ─── The beat bench's numbers — ONE truth, the website's own ─────
   ai-audio.tsx's AiBeatTab is the site's beat surface: BPM is a
   number input clamped to 60–200 on change, the key is a select
   over the twelve major keys, the length is a select over four
   fixed durations, and the title is free text the endpoint caps
   at 200 chars (its zod beatTitle max). The Audio Desk's beat
   bench speaks these exact ranges, so a number chosen in the
   World is the number the server runs — never a value the server
   silently clamps or rejects after the fact. The endpoint's own
   clamps (beat.ts: bpm 60–200 into the prompt, length 10–180 s)
   sit inside/behind these, so anything built here is in range
   before it is posted. */
export const BEAT_BPM_MIN = 60;
export const BEAT_BPM_MAX = 200;
export const BEAT_BPM_DEFAULT = 140;
export const BEAT_KEYS = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
] as const;
export const BEAT_LENGTHS = [
  { value: 30, label: "30 sec" },
  { value: 60, label: "1 min" },
  { value: 120, label: "2 min" },
  { value: 180, label: "3 min" },
] as const;
export const BEAT_LENGTH_DEFAULT = 60;
export const BEAT_TITLE_MAX = 200;

/** The page's BPM clamp, shared: a finite number rounds into
 *  60–200; anything else falls back to the 140 default (the
 *  endpoint's clampBpm bounds, the page's `|| 140`). */
export function clampBeatBpm(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return BEAT_BPM_DEFAULT;
  return Math.min(BEAT_BPM_MAX, Math.max(BEAT_BPM_MIN, Math.round(n)));
}

/** The desk's BPM text field on change: digits only (the desk
 *  field's standing strip), then the page's clamp — the state can
 *  never hold a number the bench would refuse to post. */
export function beatBpmInputOf(raw: string): number {
  return clampBeatBpm(Number(raw.replace(/[^0-9]/g, "")) || BEAT_BPM_DEFAULT);
}

/** A length is one of the page's four durations, or the default —
 *  a length the website doesn't offer is never posted. */
export function beatLengthOf(raw: unknown): number {
  const n = Number(raw);
  return (BEAT_LENGTHS as ReadonlyArray<{ value: number }>).some((d) => d.value === n)
    ? n
    : BEAT_LENGTH_DEFAULT;
}

/** A key is one of the page's twelve, or the default C. */
export function beatKeyOf(raw: string | undefined): string {
  return raw !== undefined && (BEAT_KEYS as readonly string[]).includes(raw) ? raw : "C";
}

/** ai-audio.tsx's beat body (its AiBeatTab generate), with the
 *  numbers normalized to the ranges above: the posted payload is
 *  the creator's chosen numbers, always in range. */
export function buildBeatPayload(
  prompt: string,
  opts: { genre?: string; bpm?: number; musicalKey?: string; lengthSeconds?: number; title?: string } = {},
): Record<string, unknown> {
  const title = opts.title?.trim().slice(0, BEAT_TITLE_MAX) || undefined;
  return {
    vibe: prompt.trim(),
    genre: opts.genre ?? "trap",
    bpm: clampBeatBpm(opts.bpm ?? BEAT_BPM_DEFAULT),
    musicalKey: beatKeyOf(opts.musicalKey),
    lengthSeconds: beatLengthOf(opts.lengthSeconds ?? BEAT_LENGTH_DEFAULT),
    beatTitle: title,
  };
}

/** The result label for a landed beat — the page's card shape:
 *  the chosen title (or its "{{genre}} beat · {{bpm}} BPM"
 *  default) with the maker's numbers behind it, never the bench's
 *  silent defaults. */
export function beatResultTitleOf(opts: {
  title?: string;
  genre: string;
  bpm: number;
  musicalKey: string;
  lengthSeconds: number;
}): string {
  const meta = `${opts.genre} · ${opts.bpm} BPM · ${opts.musicalKey} · ${opts.lengthSeconds}s`;
  const chosen = opts.title?.trim();
  return chosen ? `${chosen} · ${meta}` : `${opts.genre} beat · ${opts.bpm} BPM · ${opts.musicalKey} · ${opts.lengthSeconds}s`;
}

/** ai-audio.tsx's SFX body (its SfxTab generate). */
export function buildSfxPayload(
  prompt: string,
  opts: { durationSeconds?: number; category?: string } = {},
): Record<string, unknown> {
  return {
    prompt: prompt.trim(),
    durationSeconds: opts.durationSeconds ?? 3,
    category: opts.category ?? "impacts",
  };
}

/* ─── Polling — the same status words the pages poll for ─────────── */

export interface TaskPollData {
  status?: string;
  url?: string | null;
  outputUrl?: string | null;
  progress?: number;
  error?: string;
  message?: string;
}

/** Runway / artist-image task polls (5s on the pages): succeeded
 *  with a url is done; failed/cancelled is a failure. */
export function interpretTaskPoll(data: TaskPollData): {
  done: boolean;
  failed: boolean;
  url: string | null;
  error: string | null;
} {
  if (data.status === "succeeded") {
    return data.url
      ? { done: true, failed: false, url: data.url, error: null }
      : { done: true, failed: true, url: null, error: "The make finished but came back empty — nothing was charged for it." };
  }
  if (data.status === "failed" || data.status === "cancelled") {
    return { done: true, failed: true, url: null, error: data.error ?? "The make didn't finish." };
  }
  return { done: false, failed: false, url: null, error: null };
}

/** Audio job polls (cleanup / deverb, 3s on the pages): the job
 *  words are queued/processing → done/failed, output in outputUrl. */
export function interpretJobPoll(data: TaskPollData): {
  done: boolean;
  failed: boolean;
  url: string | null;
  error: string | null;
} {
  if (data.status === "done") {
    return { done: true, failed: false, url: data.outputUrl ?? null, error: null };
  }
  if (data.status === "failed") {
    return { done: true, failed: true, url: null, error: data.error ?? data.message ?? "The job didn't finish." };
  }
  return { done: false, failed: false, url: null, error: null };
}

/* ─── Drafts — POST /api/drafts, the pages' shape ─────────────────── */

/** make-video.tsx's server draft body: { workflowType, title,
 *  draftData }. Song Desk drafts ride workflow "make-song",
 *  Thumbnail Desk drafts "thumbnail-studio" (the stations' own
 *  website workflows). */
export function buildDraftPayload(
  workflowType: string,
  title: string,
  draftData: Record<string, unknown>,
): Record<string, unknown> {
  return { workflowType, title, draftData };
}

export const SONG_DRAFT_WORKFLOW = "make-song";
export const THUMBNAIL_DRAFT_WORKFLOW = "thumbnail-studio";

/* ─── The editor seed — POST /api/projects, make-video's shape ───── */

export interface EditorSeedInput {
  projectType: string;
  title: string;
  artistName?: string;
  songTitle?: string;
  genre?: string;
  mood?: string;
  inputData: Record<string, unknown>;
  resultText: string;
  genHistoryId?: string | null;
}

/** The project body make-video's performSave posts. Saving the
 *  desk's result as the newest project is what seeds the editor
 *  step-through: the palace resolves the newest project when the
 *  editor door opens, so Send-to-the-editor lands on THIS piece. */
export function buildEditorProjectPayload(input: EditorSeedInput): Record<string, unknown> {
  return {
    projectType: input.projectType,
    title: input.title || "Untitled Project",
    artistName: input.artistName || null,
    songTitle: input.songTitle || null,
    genre: input.genre || null,
    mood: input.mood || null,
    inputData: input.inputData,
    outputData: { result: input.resultText },
    creditsUsed: 1,
    genHistoryId: input.genHistoryId ?? null,
  };
}

/* ─── Next-step hrefs the pages themselves offer after a make ────── */

/** CoverInMotionPanel's "Post it →" rail: the scheduler handoff. */
export function scheduleHrefForMedia(mediaUrl: string, mediaType: "video" | "image", caption: string): string {
  return buildSchedulerHref({ caption, media: mediaUrl, mediaType });
}

/** cover-art.tsx's result "Distribute" rail. */
export function distributeHrefForCover(coverUrl: string, title: string): string {
  return `/distribute?cover=${encodeURIComponent(coverUrl)}&title=${encodeURIComponent(title)}`;
}

/* ─── Result text helpers ─────────────────────────────────────────── */

/** A short, honest in-panel excerpt of a text-package result (song /
 *  plan / song+video packages are long markdown — the panel shows
 *  the head and the full package rides the editor seed + draft). */
export function resultExcerpt(raw: string, maxChars = 600): string {
  const text = raw.trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}…`;
}

/** The jukebox chip's gate: the room's queue only accepts published
 *  profile tracks, whose ids are the catalog's `track:<uuid>` form
 *  (the server re-verifies at add time). A desk result may offer
 *  "Put it on the jukebox" ONLY when it carries such an id — a
 *  freshly generated package has none until it is published. */
export function jukeboxTrackIdOf(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  return /^track:[0-9a-fA-F-]{36}$/.test(candidate) ? candidate : null;
}

/** The jukebox chip's three honest faces (stack-20 round 2, #4):
 *  - "absent": the desk offers no jukebox rail at all — no chip.
 *  - "live": the rail is offered AND the result carries a
 *    gate-passing published id — the chip is a real button.
 *  - "dark": the rail is offered but the result is unpublished —
 *    the chip shows its face with the reason on it ("publish
 *    first") as a non-interactive span, never a dead click.
 *  The publish landing flips dark → live, and nothing else does. */
export type JukeboxChipState = "live" | "dark" | "absent";
export function jukeboxChipStateOf(args: {
  candidate: string | null | undefined;
  railOffered: boolean;
}): JukeboxChipState {
  if (!args.railOffered) return "absent";
  return jukeboxTrackIdOf(args.candidate) ? "live" : "dark";
}

/* ─── The publish rail — Ring 2 items 2.1 + 2.2 ──────────────────────
   The palace's central loop, closed with the SITE'S OWN rails, in
   the SITE'S OWN order (the exact steps the 2D flow takes):
     1. The package becomes real audio — POST /api/generate-music-audio
        with the package's AI MUSIC PROMPT (GenerationResult's
        "Generate real audio" step; the response carries the song
        library row the server saved, source "generated").
     2. The audio is published to the creator's profile —
        POST /api/publish/track with is_published:true, the /publish
        page's save body for audio (publish.tsx handleSave). FREE:
        the publish route charges nothing ("uploading/publishing is
        FREE — it's the creator's own content"); only AI extras
        charge. The profile id comes from GET /api/creator-profiles,
        the same lookup the publish page and the publish server use.
     3. The publish response's track id becomes the jukebox identity
        `track:<uuid>` — and only then may the ResultChips jukebox
        chip light (see jukeboxTrackIdOf above). */

/** The desk makes its audio at the default length: 60 seconds,
 *  the music-audio route's own DEFAULT_LENGTH_MS. */
export const SONG_AUDIO_LENGTH_SECONDS = 60;

/** POST /api/generate-music-audio's REAL price at a length: the
 *  registry's 400 is the ≤1-minute tier; the server's
 *  creditCostForLength tiers 400 / 800 / 1200 at 1 and 3 minutes —
 *  exact multiples of the registry base, never invented here. */
export function musicAudioCost(lengthSeconds: number = SONG_AUDIO_LENGTH_SECONDS): number {
  const base = registryCost("/api/generate-music-audio");
  if (lengthSeconds <= 60) return base;
  if (lengthSeconds <= 180) return base * 2;
  return base * 3;
}

/** One ## section of a song package (the hub-song section shape). */
export function packageSectionOf(raw: string, header: string): string {
  const re = new RegExp(`^##\\s*${header}\\s*$`, "im");
  const m = re.exec(raw);
  if (!m || m.index === undefined) return "";
  const start = m.index + m[0].length;
  const rest = raw.slice(start);
  const next = /^##\s+\S/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

/** The package's AI MUSIC PROMPT — the exact text GenerationResult
 *  hands to the audio maker. Null when the package carries none
 *  (then there is honestly nothing to make audio from). */
export function songMusicPromptOf(rawResult: string): string | null {
  const prompt = packageSectionOf(rawResult, "AI MUSIC PROMPT");
  return prompt ? prompt : null;
}

/** The generate-music-audio body GenerationResult posts for a
 *  finished package: the music prompt, the package's own lyrics as
 *  the custom-lyrics input, and the desk's title/artist. Null when
 *  the package has no music prompt. */
export function buildMusicAudioPayload(input: {
  rawResult: string;
  artistName?: string;
  songTitle?: string;
}): Record<string, unknown> | null {
  const prompt = songMusicPromptOf(input.rawResult);
  if (!prompt) return null;
  const lyrics = packageSectionOf(input.rawResult, "FULL LYRICS");
  return {
    prompt,
    ...(lyrics ? { lyrics } : {}),
    ...(input.artistName?.trim() ? { artistName: input.artistName.trim() } : {}),
    ...(input.songTitle?.trim() ? { songTitle: input.songTitle.trim() } : {}),
    lengthSeconds: SONG_AUDIO_LENGTH_SECONDS,
  };
}

/** The /publish page's audio save body (publish.tsx handleSave,
 *  publish=true): profile_id + title + audio_url + is_published.
 *  Category "music" rides as the vertical; the server folds it
 *  into tags itself. download_price_cents 0 = free download, the
 *  page's default. */
export function buildPublishTrackPayload(input: {
  profileId: string;
  title: string;
  audioUrl: string;
  genre?: string;
  durationSec?: number;
}): Record<string, unknown> {
  return {
    profile_id: input.profileId,
    title: input.title.trim() || "Untitled Song",
    audio_url: input.audioUrl,
    genre: input.genre?.trim() ? input.genre.trim() : undefined,
    category: "music",
    tags: [],
    duration_sec:
      typeof input.durationSec === "number" && input.durationSec > 0
        ? Math.round(input.durationSec)
        : undefined,
    download_price_cents: 0,
    is_published: true,
  };
}

/** The creator's first profile id from GET /api/creator-profiles —
 *  the response shapes the publish page's loadProfile accepts
 *  (array, { profiles }, or a single profile object). Null when the
 *  creator has no profile yet: publishing honestly cannot proceed. */
export function profileIdOfProfilesResponse(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const list: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray((json as { profiles?: unknown }).profiles)
      ? ((json as { profiles: unknown[] }).profiles as unknown[])
      : typeof (json as { id?: unknown }).id === "string"
        ? [json]
        : [];
  for (const p of list) {
    if (p && typeof p === "object" && typeof (p as { id?: unknown }).id === "string") {
      return (p as { id: string }).id;
    }
  }
  return null;
}

/** The published identity from POST /api/publish/track's response
 *  ({ track: { id, … } }): `track:<uuid>`, passed through the
 *  jukebox gate — anything else is not a publish the room can play,
 *  so it reads as null and the desk must say so, never light up. */
export function publishedTrackIdOfResponse(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const track = (json as { track?: unknown }).track;
  if (!track || typeof track !== "object") return null;
  const id = (track as { id?: unknown }).id;
  if (typeof id !== "string" && typeof id !== "number") return null;
  return jukeboxTrackIdOf(`track:${String(id)}`);
}

/* ─── Ring 2 (2.3) — the Video Desk storyboard flow ─────────────────
   make-video.tsx's actual storyboard machinery, docked:
     lyrics → POST /api/analyze-sections (registry 100) → scenes
     (either the video plan's parsed breakdown, POST
     /api/generate-video-plan at videoPlanCost, or the audio flow's
     scenes-from-audio via lib/generate-scenes-from-audio-flow) →
     per-scene review/approval → per-scene clips (POST
     /api/generate-runway-clip at videoClipCost each) → autosave
     (POST /api/drafts workflow "make-video", then POST
     /api/projects in make-video's performSave shape).
   The step machine below is the desk's honest spine: a step is
   only reachable when the previous step's server truth exists. */

export type StoryboardStep = "intake" | "analysis" | "scenes" | "review" | "clips" | "done";

export const STORYBOARD_STEPS: readonly StoryboardStep[] = [
  "intake",
  "analysis",
  "scenes",
  "review",
  "clips",
  "done",
];

/** POST /api/analyze-sections — registry-priced (100). */
export function analyzeSectionsCost(): number {
  return registryCost("/api/analyze-sections");
}

/** POST /api/transcribe — registry-priced (100). */
export function transcribeCost(): number {
  return registryCost("/api/transcribe");
}

/** POST /api/generate/ai-edit-plan — registry-priced (100). */
export function aiEditPlanCost(): number {
  return registryCost("/api/generate/ai-edit-plan");
}

/** make-video.tsx handleAnalyze's body: { lyrics } only. */
export function buildAnalyzeSectionsPayload(lyrics: string): Record<string, unknown> {
  return { lyrics };
}

/** The storyboard machine: given what server truth exists, the
 *  furthest honest step. Analysis exists → scenes can be built;
 *  scenes exist → review; every scene decided (approved or not)
 *  and at least one approved → clips; every approved scene holding
 *  a finished clip → done. */
export function storyboardStepOf(state: {
  hasLyrics: boolean;
  hasStructure: boolean;
  sceneCount: number;
  decidedCount: number;
  approvedCount: number;
  clippedApprovedCount: number;
}): StoryboardStep {
  if (!state.hasLyrics) return "intake";
  if (!state.hasStructure) return "analysis";
  if (state.sceneCount === 0) return "scenes";
  if (state.decidedCount < state.sceneCount || state.approvedCount === 0) return "review";
  if (state.clippedApprovedCount < state.approvedCount) return "clips";
  return "done";
}

/** One scene's approval flip — returns a NEW array (the page treats
 *  scenes as immutable state; autosave diffing depends on it). */
export function withSceneApproval<T extends { id: string; approved: boolean }>(
  scenes: readonly T[],
  sceneId: string,
  approved: boolean,
): T[] {
  return scenes.map((s) => (s.id === sceneId ? { ...s, approved } : s));
}

/** Attach a finished clip url to its scene (the page's demoClipUrl
 *  + generationStatus "completed" bookkeeping). */
export function withSceneClip<T extends { id: string; demoClipUrl: string | null; generationStatus: string | null }>(
  scenes: readonly T[],
  sceneId: string,
  clipUrl: string,
): T[] {
  return scenes.map((s) =>
    s.id === sceneId ? { ...s, demoClipUrl: clipUrl, generationStatus: "completed" } : s,
  );
}

/** make-video.tsx's draft autosave body: workflow "make-video",
 *  draftData { formValues, rawResult, scenes, songStructure,
 *  timestamp } — the page's own server-draft shape, so a storyboard
 *  started at the desk reopens on the page and vice versa. */
export const VIDEO_DRAFT_WORKFLOW = "make-video";

export function buildStoryboardDraftPayload(input: {
  title: string;
  formValues: Record<string, unknown>;
  rawResult: string;
  scenes: unknown[];
  songStructure: unknown;
}): Record<string, unknown> {
  return buildDraftPayload(VIDEO_DRAFT_WORKFLOW, input.title, {
    formValues: input.formValues,
    rawResult: input.rawResult,
    scenes: input.scenes,
    songStructure: input.songStructure,
    timestamp: Date.now(),
  });
}

/** make-video.tsx performSave's project body (POST /api/projects):
 *  outputData carries the result + structure + scenes exactly as
 *  the page saves them — the editor step-through seeds from it. */
export function buildStoryboardProjectPayload(input: {
  title: string;
  artistName?: string;
  songTitle?: string;
  genre?: string;
  mood?: string;
  inputData: Record<string, unknown>;
  resultText: string;
  songStructure?: unknown;
  scenes: unknown[];
  genHistoryId?: string | null;
}): Record<string, unknown> {
  return {
    projectType: "Make a Music Video",
    title: input.title || "Untitled Project",
    artistName: input.artistName || null,
    songTitle: input.songTitle || null,
    genre: input.genre || null,
    mood: input.mood || null,
    inputData: input.inputData,
    outputData: {
      result: input.resultText,
      ...(input.songStructure ? { songStructure: input.songStructure } : {}),
      ...(input.scenes.length > 0 ? { scenes: input.scenes } : {}),
    },
    creditsUsed: 1,
    genHistoryId: input.genHistoryId ?? null,
  };
}

/* ─── Ring 2 (2.4) — the Song + Video wizard's later steps ──────────
   song-and-video.tsx's Simple flow, step for step: audio upload →
   POST /api/transcribe (form field "audio", registry 100) → the
   audio scene flow (2.3's machinery) or the text package → scene
   review → POST /api/generate/ai-edit-plan (registry 100) applied
   to the scenes → POST /api/projects in the page's save shape. */

/** The transcribe intake's form fields (the page appends exactly
 *  one: the audio file under "audio"). Returned as field names so
 *  the contract is testable without a File in the test run. */
export const TRANSCRIBE_FORM_FIELD = "audio";

/** The transcript from POST /api/transcribe's response
 *  ({ transcript }) — null when the response carries none, so the
 *  wizard honestly stays on the intake step. */
export function transcriptOfResponse(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const t = (json as { transcript?: unknown }).transcript;
  return typeof t === "string" && t.trim().length > 0 ? t : null;
}

/** song-and-video.tsx's auto-edit plan body, field for field: the
 *  scene descriptions are "section · lyric · action · mood" joined,
 *  falling back to "Scene N". */
export function buildAiEditPlanPayload(input: {
  style: string;
  styleName: string;
  scenes: ReadonlyArray<{ section?: string; lyricLine?: string; action?: string; mood?: string }>;
  audioFound: boolean;
  captionStyle: string;
  currentEffects: unknown;
  artistName?: string;
  songTitle?: string;
  lyricsText?: string;
}): Record<string, unknown> {
  const sceneDescriptions = input.scenes.map(
    (s, i) => [s.section, s.lyricLine, s.action, s.mood].filter(Boolean).join(" · ") || `Scene ${i + 1}`,
  );
  return {
    style: input.style,
    styleName: input.styleName,
    sceneCount: input.scenes.length,
    sceneDescriptions,
    audioFound: input.audioFound,
    captionsFound: false,
    captionCount: 0,
    captionStyle: input.captionStyle,
    currentEffects: input.currentEffects,
    artistName: input.artistName ?? "",
    songTitle: input.songTitle ?? "",
    lyricsText: input.lyricsText ?? "",
  };
}

/** The plan from POST /api/generate/ai-edit-plan's response
 *  ({ plan }) — null when absent (the page treats a missing plan as
 *  non-fatal: the project still saves, the desk says so). */
export function aiEditPlanOfResponse(json: unknown): unknown {
  if (!json || typeof json !== "object") return null;
  return (json as { plan?: unknown }).plan ?? null;
}

/** song-and-video.tsx's project save body (POST /api/projects):
 *  outputData { result, songStructure?, scenes, editorSettings }. */
export function buildSongVideoProjectPayload(input: {
  title: string;
  artistName?: string;
  genre: string;
  mood: string;
  inputData: Record<string, unknown>;
  resultText: string;
  songStructure?: unknown;
  scenes: unknown[];
  editorSettings: unknown;
  genHistoryId?: string | null;
}): Record<string, unknown> {
  return {
    projectType: "Make Song + Video",
    title: input.title || "Untitled Project",
    artistName: input.artistName || null,
    songTitle: null,
    genre: input.genre,
    mood: input.mood,
    inputData: input.inputData,
    outputData: {
      result: input.resultText,
      ...(input.songStructure ? { songStructure: input.songStructure } : {}),
      scenes: input.scenes,
      editorSettings: input.editorSettings,
    },
    creditsUsed: 2,
    genHistoryId: input.genHistoryId ?? null,
  };
}

/* ─── Ring 2 (2.5) — Song Desk tabs: Inspo / Mashup / Hum-to-Song ───
   The generation endpoints behind make-song.tsx's tabs, docked:
   InspoTab.tsx (analyze FREE per the registry, generate 200),
   SongMashup.tsx (POST /api/mashup, registry 400), HumToSong.tsx
   (POST /api/hum-to-song two-step: analyzeOnly is free, the
   generate charges the registry's 500). Plus Artist Vault preset
   loading (GET /api/artist-vaults, the selector's own rail) and
   the upload + transcription intake (POST /api/transcribe). */

export function inspoAnalyzeCost(): number {
  return registryCost("/api/song-inspo/analyze");
}
export function inspoGenerateCost(): number {
  return registryCost("/api/song-inspo/generate");
}
export function mashupCost(): number {
  return registryCost("/api/mashup");
}
export function humToSongCost(): number {
  return registryCost("/api/hum-to-song");
}

/** InspoTab analyzeVibe's body: { playlistInput, notes }. */
export function buildInspoAnalyzePayload(playlistInput: string, notes = ""): Record<string, unknown> {
  return { playlistInput: playlistInput.trim(), notes: notes.trim() };
}

/** InspoTab generateFromDna's body (via callGenerateApi):
 *  { styleDna, notes, artistName, songTitle }. */
export function buildInspoGeneratePayload(input: {
  styleDna: unknown;
  notes?: string;
  artistName?: string;
  songTitle?: string;
}): Record<string, unknown> {
  return {
    styleDna: input.styleDna,
    notes: (input.notes ?? "").trim(),
    artistName: (input.artistName ?? "").trim(),
    songTitle: (input.songTitle ?? "").trim(),
  };
}

/** InspoTab savePreset's body (POST /api/song-inspo/presets, free):
 *  { name, styleDna }. */
export function buildInspoPresetPayload(name: string, styleDna: unknown): Record<string, unknown> {
  return { name: name.trim(), styleDna };
}

/** The style DNA from POST /api/song-inspo/analyze's response
 *  ({ styleDna }) — null when the analysis carried none. */
export function styleDnaOfResponse(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object") return null;
  const dna = (json as { styleDna?: unknown }).styleDna;
  return dna && typeof dna === "object" ? (dna as Record<string, unknown>) : null;
}

/** SongMashup's generate body: two library songs + blend controls;
 *  the custom blend point rides only in custom mode with a known
 *  duration, exactly as the page folds it. */
export function buildMashupPayload(input: {
  songAId: string;
  songBId: string;
  style: string;
  balance: number;
  crossfadeSec: number;
  mode?: string;
  blendPct?: number;
  durationA?: number;
  title?: string;
}): Record<string, unknown> {
  return {
    songA: { songId: input.songAId },
    songB: { songId: input.songBId },
    style: input.style,
    balance: input.balance,
    crossfadeSec: input.crossfadeSec,
    ...(input.mode === "custom" && (input.durationA ?? 0) > 0
      ? { blendPointSec: Math.round((((input.blendPct ?? 50) / 100) * (input.durationA ?? 0)) * 10) / 10 }
      : {}),
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
  };
}

/** The mashup result song from POST /api/mashup's response
 *  ({ song: { audio_url, title } }) — null when it didn't land. */
export function mashupResultOfResponse(json: unknown): { audioUrl: string; title: string } | null {
  if (!json || typeof json !== "object") return null;
  const song = (json as { song?: unknown }).song;
  if (!song || typeof song !== "object") return null;
  const url = (song as { audio_url?: unknown }).audio_url;
  if (typeof url !== "string" || !url) return null;
  const title = (song as { title?: unknown }).title;
  return { audioUrl: url, title: typeof title === "string" ? title : "Your mashup" };
}

/** HumToSong's two form posts, as testable field lists (the File
 *  itself is attached by the component under the named field):
 *  analyze = hum file + analyzeOnly "true" (free, skipConfirm on
 *  the page); generate = humRef + mode + the custom fields only in
 *  custom mode, exactly as the page appends them. */
export function humAnalyzeFields(): Array<[string, string]> {
  return [["analyzeOnly", "true"]];
}
export const HUM_FORM_FIELD = "hum";

export function humGenerateFields(input: {
  humRef: string;
  mode: string;
  stylePrompt?: string;
  vocalGender?: string;
  instrumental?: boolean;
  lyrics?: string;
  songTitle?: string;
  artistName?: string;
}): Array<[string, string]> {
  const fields: Array<[string, string]> = [
    ["humRef", input.humRef],
    ["mode", input.mode],
  ];
  if (input.mode === "custom") {
    if (input.stylePrompt?.trim()) fields.push(["stylePrompt", input.stylePrompt.trim()]);
    if (input.vocalGender) fields.push(["vocalGender", input.vocalGender]);
    if (input.instrumental) fields.push(["instrumental", "true"]);
    if (input.lyrics?.trim()) fields.push(["lyrics", input.lyrics.trim()]);
  }
  if (input.songTitle?.trim()) fields.push(["songTitle", input.songTitle.trim()]);
  if (input.artistName?.trim()) fields.push(["artistName", input.artistName.trim()]);
  return fields;
}

/** The hum analysis from POST /api/hum-to-song's analyze response
 *  ({ humRef, humUrl, analysis }) — null unless BOTH the ref and
 *  the analysis landed (the page refuses an incomplete analysis). */
export function humAnalysisOfResponse(
  json: unknown,
): { humRef: string; humUrl: string | null; analysis: Record<string, unknown> } | null {
  if (!json || typeof json !== "object") return null;
  const ref = (json as { humRef?: unknown }).humRef;
  const analysis = (json as { analysis?: unknown }).analysis;
  if (typeof ref !== "string" || !ref || !analysis || typeof analysis !== "object") return null;
  const url = (json as { humUrl?: unknown }).humUrl;
  return { humRef: ref, humUrl: typeof url === "string" ? url : null, analysis: analysis as Record<string, unknown> };
}

/** The finished hum song's url from the generate response
 *  ({ url, … }) — null when it didn't land. */
export function humSongUrlOfResponse(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const url = (json as { url?: unknown }).url;
  return typeof url === "string" && url ? url : null;
}

/** Artist Vault preset loading: the vault list from
 *  GET /api/artist-vaults (the selector accepts an array or
 *  { vaults }). Only rows with an id + artist_name are loadable. */
export function vaultsOfResponse(json: unknown): Array<{ id: string; artistName: string }> {
  if (!json || typeof json !== "object") return [];
  const list: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray((json as { vaults?: unknown }).vaults)
      ? ((json as { vaults: unknown[] }).vaults as unknown[])
      : [];
  const out: Array<{ id: string; artistName: string }> = [];
  for (const v of list) {
    if (v && typeof v === "object") {
      const id = (v as { id?: unknown }).id;
      const name = (v as { artist_name?: unknown }).artist_name;
      if (typeof id === "string" && typeof name === "string") out.push({ id, artistName: name });
    }
  }
  return out;
}

/** make-song.tsx posts the loaded vault object itself as
 *  `artistVault` — the desk's payload builders keep it null, so
 *  loading a preset swaps the whole vault in, untouched. */
export function withArtistVault(
  payload: Record<string, unknown>,
  vault: unknown,
): Record<string, unknown> {
  return { ...payload, artistVault: vault ?? null };
}

/* ─── Ring 2 (2.9 + 2.10) — Thumbnail Desk benches ──────────────────
   thumbnail-studio.tsx's own endpoints:
   - the 4-variation Thumbnail Maker: POST /api/thumbnail-generator
     (multipart; registry 200) returns { images: [{url, variation}] }
     — prompt / stylePreset / aspectRatio / overlayText (the
     text-overlay field the server renders) / facePhoto / attribution;
   - the A/B variants bench: POST /api/wave8/thumbnail-ab/variants
     (registry) returns { variants: [{url, label, prompt}] };
   - the CTR prediction bench: POST /api/thumbnail-test (multipart
     "thumbnails", registry 200) — the page's honest framing: a
     PREDICTION from thumbnail best practices, never a guarantee —
     returns { result: { analyses, winnerIndex, confidence,
     reasoning, disclaimer } }; its improve rail is
     POST /api/thumbnail-test/improve (registry 200). */

export function thumbnailGeneratorCost(): number {
  return registryCost("/api/thumbnail-generator");
}
export function thumbnailVariantsCost(): number {
  return registryCost("/api/wave8/thumbnail-ab/variants");
}
export function thumbnailTestCost(): number {
  return registryCost("/api/thumbnail-test");
}
export function thumbnailImproveCost(): number {
  return registryCost("/api/thumbnail-test/improve");
}

/** The maker form's text fields, in the page's append order (the
 *  facePhoto File rides under "facePhoto" when one is picked;
 *  attribution rides as the "true"/"false" string the server
 *  coerces, exactly as the page appends it). */
export function thumbnailGeneratorFields(input: {
  prompt: string;
  stylePreset: string;
  aspectRatio: string;
  overlayText?: string;
  attribution?: boolean;
}): Array<[string, string]> {
  const fields: Array<[string, string]> = [
    ["prompt", input.prompt.trim()],
    ["stylePreset", input.stylePreset],
    ["aspectRatio", input.aspectRatio],
  ];
  if (input.overlayText?.trim()) fields.push(["overlayText", input.overlayText.trim()]);
  fields.push(["attribution", input.attribution ? "true" : "false"]);
  return fields;
}
export const THUMBNAIL_FACE_FIELD = "facePhoto";

/** The maker's images from its response ({ images }) — only rows
 *  with a real url count as variations. */
export function thumbnailImagesOfResponse(
  json: unknown,
): Array<{ url: string; variation: string }> {
  if (!json || typeof json !== "object") return [];
  const images = (json as { images?: unknown }).images;
  if (!Array.isArray(images)) return [];
  const out: Array<{ url: string; variation: string }> = [];
  for (const img of images) {
    if (img && typeof img === "object") {
      const url = (img as { url?: unknown }).url;
      if (typeof url === "string" && url) {
        const v = (img as { variation?: unknown }).variation;
        out.push({ url, variation: typeof v === "string" ? v : `variation-${out.length + 1}` });
      }
    }
  }
  return out;
}

/** The wave8 A/B variants body (JSON): source + title + niche,
 *  the title capped at 200 chars exactly as the page caps it. */
export function buildThumbnailVariantsPayload(input: {
  sourceImageUrl: string;
  title: string;
  niche: string;
}): Record<string, unknown> {
  return {
    sourceImageUrl: input.sourceImageUrl,
    title: input.title.slice(0, 200),
    niche: input.niche,
  };
}

export function thumbnailVariantsOfResponse(
  json: unknown,
): Array<{ url: string; label: string; prompt: string }> {
  if (!json || typeof json !== "object") return [];
  const variants = (json as { variants?: unknown }).variants;
  if (!Array.isArray(variants)) return [];
  const out: Array<{ url: string; label: string; prompt: string }> = [];
  for (const v of variants) {
    if (v && typeof v === "object") {
      const url = (v as { url?: unknown }).url;
      if (typeof url === "string" && url) {
        const label = (v as { label?: unknown }).label;
        const prompt = (v as { prompt?: unknown }).prompt;
        out.push({
          url,
          label: typeof label === "string" ? label : `Variant ${out.length + 1}`,
          prompt: typeof prompt === "string" ? prompt : "",
        });
      }
    }
  }
  return out;
}

/** The CTR prediction from POST /api/thumbnail-test's response
 *  ({ result }) — the winner + confidence + per-image overall
 *  scores. Null when the response carries no usable result, so
 *  the desk never presents an invented prediction. */
export interface CtrPrediction {
  winnerIndex: number;
  confidence: number;
  reasoning: string;
  disclaimer: string;
  overallScores: number[];
}

export function ctrPredictionOfResponse(json: unknown): CtrPrediction | null {
  if (!json || typeof json !== "object") return null;
  const result = (json as { result?: unknown }).result;
  if (!result || typeof result !== "object") return null;
  const r = result as {
    winnerIndex?: unknown;
    confidence?: unknown;
    reasoning?: unknown;
    disclaimer?: unknown;
    analyses?: unknown;
  };
  if (typeof r.winnerIndex !== "number" || !Array.isArray(r.analyses)) return null;
  const overallScores: number[] = [];
  for (const a of r.analyses) {
    const scores = a && typeof a === "object" ? (a as { scores?: unknown }).scores : null;
    const overall = scores && typeof scores === "object" ? (scores as { overall?: unknown }).overall : null;
    overallScores.push(typeof overall === "number" ? overall : 0);
  }
  return {
    winnerIndex: r.winnerIndex,
    confidence: typeof r.confidence === "number" ? r.confidence : 0,
    reasoning: typeof r.reasoning === "string" ? r.reasoning : "",
    disclaimer: typeof r.disclaimer === "string" ? r.disclaimer : "",
    overallScores,
  };
}

/** The thumbnail-test form's text fields (the image Files ride
 *  under "thumbnails", 2–4 of them, the page's own bounds). */
export const THUMBNAIL_TEST_FIELD = "thumbnails";
export const THUMBNAIL_TEST_MIN_FILES = 2;
export const THUMBNAIL_TEST_MAX_FILES = 4;

export function thumbnailTestFields(input: {
  title?: string;
  niche?: string;
}): Array<[string, string]> {
  const fields: Array<[string, string]> = [];
  if (input.title?.trim()) fields.push(["title", input.title.trim()]);
  if (input.niche?.trim()) fields.push(["niche", input.niche.trim()]);
  return fields;
}

/* ─── THE-GAME §5(a) — the desk result quest-progress chip ──────────
   When a desk job finishes, the desk checks the member's quest
   rails (GET /api/retention/quests — the same status the Treasury
   board reads) against the snapshot taken when the job started.
   The chip speaks ONLY from that server diff: a quest whose
   progress moved, or that flipped to completed, is named; no
   movement → no chip (never a fake "quest advanced!" line). */

export interface QuestProgress {
  key: string;
  target: number;
  reward: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

/** The quest rows from GET /api/retention/quests ({ quests: [...] })
 *  — malformed rows are dropped, never guessed at. */
export function questsOfResponse(json: unknown): QuestProgress[] {
  if (!json || typeof json !== "object") return [];
  const quests = (json as { quests?: unknown }).quests;
  if (!Array.isArray(quests)) return [];
  const out: QuestProgress[] = [];
  for (const q of quests) {
    if (!q || typeof q !== "object") continue;
    const r = q as Record<string, unknown>;
    if (typeof r["key"] !== "string") continue;
    out.push({
      key: r["key"] as string,
      target: typeof r["target"] === "number" ? (r["target"] as number) : 0,
      reward: typeof r["reward"] === "number" ? (r["reward"] as number) : 0,
      progress: typeof r["progress"] === "number" ? (r["progress"] as number) : 0,
      completed: r["completed"] === true,
      claimed: r["claimed"] === true,
    });
  }
  return out;
}

/** Human names for the weekly quest keys (QuestsWidget's own
 *  QUEST_META titles, in plain words). Unknown keys humanize. */
export const QUEST_TITLES: Readonly<Record<string, string>> = {
  "make-thumbnail": "Make a thumbnail",
  "generate-song": "Generate a song",
  "export-video": "Export a video",
  "viral-sharer": "Share your work",
};

export function questTitleOf(key: string): string {
  return QUEST_TITLES[key] ?? key.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export interface QuestAdvance {
  key: string;
  title: string;
  progress: number;
  target: number;
  completedNow: boolean;
}

/** The honest diff: quests present in BOTH snapshots whose progress
 *  strictly increased or that newly completed. A quest that only
 *  exists afterwards (first snapshot failed) is NOT claimed as
 *  advanced — without a before, the desk cannot prove the job did
 *  it, so the chip stays silent. */
export function questAdvancesBetween(
  before: readonly QuestProgress[] | null,
  after: readonly QuestProgress[],
): QuestAdvance[] {
  if (!before) return [];
  const prev = new Map(before.map((q) => [q.key, q]));
  const out: QuestAdvance[] = [];
  for (const q of after) {
    const p = prev.get(q.key);
    if (!p) continue;
    const completedNow = q.completed && !p.completed;
    if (q.progress > p.progress || completedNow) {
      out.push({
        key: q.key,
        title: questTitleOf(q.key),
        progress: q.progress,
        target: q.target,
        completedNow: completedNow || (q.completed && q.progress >= q.target && p.progress < p.target),
      });
    }
  }
  return out;
}

/** The chip's line for one advance — the completed form is the
 *  THE-GAME wording: the quest is named and the claim lives at the
 *  Treasury. */
export function questChipLine(advance: QuestAdvance): string {
  if (advance.completedNow) {
    return `That finished your quest — “${advance.title}” is complete. Claim it at the Treasury.`;
  }
  return `Quest progress — “${advance.title}” is now ${advance.progress} of ${advance.target}.`;
}
