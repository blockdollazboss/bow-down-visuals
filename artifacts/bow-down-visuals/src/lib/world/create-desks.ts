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
    attribution: false,
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

/** ai-audio.tsx's beat body (its AiBeatTab generate). */
export function buildBeatPayload(
  prompt: string,
  opts: { genre?: string; bpm?: number; musicalKey?: string; lengthSeconds?: number; title?: string } = {},
): Record<string, unknown> {
  return {
    vibe: prompt.trim(),
    genre: opts.genre ?? "trap",
    bpm: opts.bpm ?? 140,
    musicalKey: opts.musicalKey ?? "C",
    lengthSeconds: opts.lengthSeconds ?? 60,
    beatTitle: opts.title?.trim() || undefined,
  };
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
 *  freshly generated package has none until it is published, so the
 *  chip stays hidden rather than fake. */
export function jukeboxTrackIdOf(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  return /^track:[0-9a-fA-F-]{36}$/.test(candidate) ? candidate : null;
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
