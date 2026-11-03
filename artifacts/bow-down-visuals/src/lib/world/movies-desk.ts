/* ─── Movies Desk in-world (stack1400 world parity wave #2, item 4) ──
   Movies & Web Series, native in the Create Wing, on the 2D
   /movies page's OWN rails — the exact endpoints pages/movies.tsx
   posts to (artifacts/api-server/src/routes/generate/movies.ts):

     POST /api/movies/concept     { idea, format, genre, episodeCount }
       → { concept: { title, tagline, logline, synopsis, genre,
           targetAudience, episodes[{number,title,summary}],
           characters[{name,role,description,arc}], pilotHook,
           comparables[] }, format, creditsCharged }
       400 Visual Bucs — CONCEPT_CREDITS in the route AND the page's
       own CONCEPT_CREDITS badge agree (finder-display-truth pins
       the pair at 400).
     POST /api/movies/clip-detect { streamUrl, description,
           streamLengthMin, clipCount }
       → { detection: { clips[{title,timestamp,timestampSeconds,
           durationSec,category,hook,caption,viralityScore}],
           streamSummary, postingStrategy }, creditsCharged, note }
       300 Visual Bucs — CLIP_DETECT_CREDITS in the route AND the
       page's CLIP_DETECT_CREDITS badge agree (pinned at 300).

   REGISTRY GAP (named, not papered over): neither movies endpoint
   has a row in lib/credit-costs.ts, so a plain confirmedFetch would
   find no registered cost and skip the spend confirmation entirely.
   The desk therefore passes the costs below as explicit
   overrideCost/overrideFeature — the same confirmation the website
   shows (the 2D page itself rides overrideCost for exactly this
   reason) — and the constants are pinned by test to BOTH the page
   constant and the server constant's documented value.

   PAYLOAD SHAPE: the page posts { idea, format, genre } for a
   concept and { streamUrl, description } for a detection, leaving
   the rest to the routes' zod defaults (episodeCount 8,
   streamLengthMin 120, clipCount 8). The desk's Advanced fields
   expose exactly those rail-supported knobs, pre-filled with the
   SAME defaults, and the builders always send them — a plain run
   from the desk is byte-equivalent in effect to the page's run.

   SAVED PROJECTS — THE GAP, VERBATIM: the movies rails have NO
   persistence: no GET endpoint, no table, no saved-projects list
   on the 2D page either. A concept's only durable landing is the
   one the page itself performs — the hub project script asset
   (useHubProject addAsset, kind "script") — and the desk performs
   that same landing. Everything else the desk keeps is
   session-only history, labelled as such; nothing here pretends a
   saved-movies rail exists.

   Confirmation law: every run rides useConfirmedApi's
   confirmedFetch (the spend confirmation stands BEFORE anything
   runs; a decline runs nothing) and the routes charge before
   generation and refund on failure server-side. A 402 reads as
   out-of-Visual-Bucs, never as a mystery. Members only — the
   routes are requireAuth and the station is membersOnly, exactly
   the 2D boundary (public-routes pins /movies "locked"). */

export const MOVIES_DESK_STATION_ID = "movies-desk";
export const MOVIES_CONCEPT_PATH = "/api/movies/concept";
export const MOVIES_CLIP_DETECT_PATH = "/api/movies/clip-detect";

/* ─── Prices — the page's + the route's constants, never invented ── */

/** POST /api/movies/concept — 400 VB (page CONCEPT_CREDITS and the
 *  route's CONCEPT_CREDITS default agree; env-overridable
 *  server-side as MOVIE_CONCEPT_CREDIT_COST). */
export const MOVIES_CONCEPT_COST_VISUAL_BUCS = 400;

/** POST /api/movies/clip-detect — 300 VB (page CLIP_DETECT_CREDITS
 *  and the route's CLIP_DETECT_CREDITS default agree;
 *  env-overridable server-side as CLIP_DETECT_CREDIT_COST). */
export const MOVIES_CLIP_DETECT_COST_VISUAL_BUCS = 300;

export type MoviesDeskMode = "concept" | "clips";
export const MOVIES_DESK_MODES: readonly MoviesDeskMode[] = ["concept", "clips"];

/** The price a mode's run shows (and the confirmation charges). */
export function moviesDeskModeCost(mode: MoviesDeskMode): number {
  return mode === "concept" ? MOVIES_CONCEPT_COST_VISUAL_BUCS : MOVIES_CLIP_DETECT_COST_VISUAL_BUCS;
}

/** The endpoint a mode posts to. */
export function moviesDeskModePath(mode: MoviesDeskMode): string {
  return mode === "concept" ? MOVIES_CONCEPT_PATH : MOVIES_CLIP_DETECT_PATH;
}

/** The feature name the confirmation shows — the routes' own
 *  charge-ledger action names, which the 2D page also passes as
 *  overrideFeature. */
export function moviesDeskModeFeature(mode: MoviesDeskMode): string {
  return mode === "concept" ? "Movie/Series Concept" : "Stream Clip Detection";
}

/* ─── The routes' own enums + bounds (verbatim) ──────────────────── */

/** movies.ts FORMAT_TYPES. */
export const MOVIES_FORMATS = ["movie", "web-series", "limited-series"] as const;
export type MoviesFormat = (typeof MOVIES_FORMATS)[number];

/** The page's format labels (movies.formats.*). */
export const MOVIES_FORMAT_LABELS: Record<MoviesFormat, string> = {
  movie: "Movie",
  "web-series": "Web Series",
  "limited-series": "Limited Series",
};

/** conceptSchema bounds: idea 50–5000 chars, episodeCount 1–24. */
export const MOVIES_IDEA_MIN = 50;
export const MOVIES_IDEA_MAX = 5000;
export const MOVIES_EPISODE_COUNT_MIN = 1;
export const MOVIES_EPISODE_COUNT_MAX = 24;
/** conceptSchema's episodeCount default — the desk's Advanced
 *  default, so an untouched desk runs the page's run. */
export const MOVIES_EPISODE_COUNT_DEFAULT = 8;

/** clipDetectSchema bounds: description 50–5000 chars,
 *  streamLengthMin 1–1440, clipCount 1–20. */
export const MOVIES_DESCRIPTION_MIN = 50;
export const MOVIES_DESCRIPTION_MAX = 5000;
export const MOVIES_STREAM_LENGTH_MIN = 1;
export const MOVIES_STREAM_LENGTH_MAX = 1440;
/** clipDetectSchema's defaults — the desk's Advanced defaults. */
export const MOVIES_STREAM_LENGTH_DEFAULT = 120;
export const MOVIES_CLIP_COUNT_MIN = 1;
export const MOVIES_CLIP_COUNT_MAX = 20;
export const MOVIES_CLIP_COUNT_DEFAULT = 8;

/** The clip categories the route's system prompt enumerates. The
 *  parser keeps any non-empty category string (the route's answer
 *  is model JSON, not a zod enum) — this list is the desk's badge
 *  vocabulary, mirroring the page's CATEGORY_STYLES keys. */
export const MOVIES_CLIP_CATEGORIES = [
  "funny-moment",
  "big-play",
  "reaction",
  "fail",
  "wholesome",
  "rant",
  "clutch",
] as const;

/** Clamp an Advanced number into the route's own range — a value
 *  chosen in the World is a value the server runs, never one it
 *  silently clamps or rejects after the charge. Non-finite input
 *  falls back to the schema default. */
function clampInt(raw: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

export function clampEpisodeCount(raw: number): number {
  return clampInt(raw, MOVIES_EPISODE_COUNT_MIN, MOVIES_EPISODE_COUNT_MAX, MOVIES_EPISODE_COUNT_DEFAULT);
}

export function clampStreamLengthMin(raw: number): number {
  return clampInt(raw, MOVIES_STREAM_LENGTH_MIN, MOVIES_STREAM_LENGTH_MAX, MOVIES_STREAM_LENGTH_DEFAULT);
}

export function clampClipCount(raw: number): number {
  return clampInt(raw, MOVIES_CLIP_COUNT_MIN, MOVIES_CLIP_COUNT_MAX, MOVIES_CLIP_COUNT_DEFAULT);
}

/* ─── Payload shaping — the page's posts + the rails' defaults ───── */

/** movies.tsx generateConcept's body, with the route's
 *  episodeCount default (8) sent explicitly from the Advanced
 *  field: { idea, format, genre, episodeCount }. */
export function buildConceptPayload(input: {
  idea: string;
  format: MoviesFormat;
  genre: string;
  episodeCount: number;
}): Record<string, unknown> {
  return {
    idea: input.idea.trim(),
    format: input.format,
    genre: input.genre.trim(),
    episodeCount: clampEpisodeCount(input.episodeCount),
  };
}

/** movies.tsx detectClips' body, with the route's streamLengthMin
 *  (120) and clipCount (8) defaults sent explicitly from the
 *  Advanced fields: { streamUrl, description, streamLengthMin,
 *  clipCount }. The page sends streamUrl "" when blank; the schema
 *  treats "" as its optional default, so the desk does the same. */
export function buildClipDetectPayload(input: {
  streamUrl: string;
  description: string;
  streamLengthMin: number;
  clipCount: number;
}): Record<string, unknown> {
  return {
    streamUrl: input.streamUrl.trim(),
    description: input.description.trim(),
    streamLengthMin: clampStreamLengthMin(input.streamLengthMin),
    clipCount: clampClipCount(input.clipCount),
  };
}

/** Whether a mode's required input meets the route's zod minimum —
 *  the run stays shut (and uncharged) until it does, mirroring the
 *  page's canGenerateConcept / canDetectClips gates (trimmed
 *  length ≥ 50). */
export function moviesDeskInputReady(
  mode: MoviesDeskMode,
  input: { idea: string; description: string },
): boolean {
  return mode === "concept"
    ? input.idea.trim().length >= MOVIES_IDEA_MIN
    : input.description.trim().length >= MOVIES_DESCRIPTION_MIN;
}

/* ─── Response guards — a payload that drifts is a failure state,
       never rows dressed as a result (the routes refund failures;
       an unusable body is treated as one by the desk). ─────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim());
}

export interface MoviesEpisode {
  number: number;
  title: string;
  summary: string;
}

export interface MoviesCharacter {
  name: string;
  role: string;
  description: string;
  arc: string;
}

export interface MoviesConcept {
  title: string;
  tagline: string;
  logline: string;
  synopsis: string;
  genre: string;
  targetAudience: string;
  episodes: MoviesEpisode[];
  characters: MoviesCharacter[];
  pilotHook: string;
  comparables: string[];
}

/** The concept out of a POST /api/movies/concept answer
 *  ({ concept, format, creditsCharged }) — the concept IS the
 *  payload: no title or no logline means nothing landed, so the
 *  whole read is null (the page renders whatever object arrives;
 *  the desk is stricter because it also files the hub asset from
 *  these fields). Episode/character rows missing their text are
 *  dropped, not dressed up. */
export function conceptOfResponse(raw: unknown): MoviesConcept | null {
  if (!isRecord(raw)) return null;
  const c = raw["concept"];
  if (!isRecord(c)) return null;
  const title = str(c["title"]);
  const logline = str(c["logline"]);
  if (!title || !logline) return null;
  const episodes: MoviesEpisode[] = [];
  if (Array.isArray(c["episodes"])) {
    for (const e of c["episodes"]) {
      if (!isRecord(e)) continue;
      const epTitle = str(e["title"]);
      const summary = str(e["summary"]);
      if (!epTitle && !summary) continue;
      episodes.push({ number: num(e["number"], episodes.length + 1), title: epTitle, summary });
    }
  }
  const characters: MoviesCharacter[] = [];
  if (Array.isArray(c["characters"])) {
    for (const ch of c["characters"]) {
      if (!isRecord(ch)) continue;
      const name = str(ch["name"]);
      if (!name) continue;
      characters.push({
        name,
        role: str(ch["role"]),
        description: str(ch["description"]),
        arc: str(ch["arc"]),
      });
    }
  }
  return {
    title,
    tagline: str(c["tagline"]),
    logline,
    synopsis: str(c["synopsis"]),
    genre: str(c["genre"]),
    targetAudience: str(c["targetAudience"]),
    episodes,
    characters,
    pilotHook: str(c["pilotHook"]),
    comparables: stringList(c["comparables"]),
  };
}

export interface MoviesClip {
  title: string;
  timestamp: string;
  timestampSeconds: number;
  durationSec: number;
  category: string;
  hook: string;
  caption: string;
  viralityScore: number;
}

export interface MoviesDetection {
  clips: MoviesClip[];
  streamSummary: string;
  postingStrategy: string;
}

/** The detection out of a POST /api/movies/clip-detect answer
 *  ({ detection, creditsCharged, note }) — clips are the payload:
 *  an answer with no usable clip is a failed read. A clip needs a
 *  title; its numbers default to 0 and its category rides as the
 *  model named it (no enum on the rail). Virality clamps to the
 *  prompt's own 1–10 scale. */
export function detectionOfResponse(raw: unknown): { detection: MoviesDetection; note: string } | null {
  if (!isRecord(raw)) return null;
  const d = raw["detection"];
  if (!isRecord(d)) return null;
  const clips: MoviesClip[] = [];
  if (Array.isArray(d["clips"])) {
    for (const cl of d["clips"]) {
      if (!isRecord(cl)) continue;
      const title = str(cl["title"]);
      if (!title) continue;
      clips.push({
        title,
        timestamp: str(cl["timestamp"]),
        timestampSeconds: Math.max(0, Math.round(num(cl["timestampSeconds"]))),
        durationSec: Math.max(0, Math.round(num(cl["durationSec"]))),
        category: str(cl["category"]),
        hook: str(cl["hook"]),
        caption: str(cl["caption"]),
        viralityScore: Math.min(10, Math.max(0, Math.round(num(cl["viralityScore"])))),
      });
    }
  }
  if (clips.length === 0) return null;
  return {
    detection: {
      clips,
      streamSummary: str(d["streamSummary"]),
      postingStrategy: str(d["postingStrategy"]),
    },
    note: str(raw["note"]),
  };
}

/* ─── The hub landing — the page's own durable step ──────────────── */

/** movies.tsx's addAsset body for a landed concept, field for
 *  field: the concept flows into the hub project as a script asset
 *  (kind "script", a data: URL of title/logline/synopsis) so the
 *  script writer and video tools pick it up. This is the ONLY
 *  durable landing the movies rails offer — see the gap note at
 *  the top of this file. */
export function buildConceptHubAsset(concept: MoviesConcept): {
  kind: "script";
  url: string;
  label: string;
  detail?: string;
  meta: { text: string; logline: string };
} {
  const text = `${concept.title}\n\n${concept.logline}\n\n${concept.synopsis}`;
  const detail = concept.tagline || concept.genre || undefined;
  return {
    kind: "script",
    url: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`,
    label: concept.title || "Movie concept",
    ...(detail ? { detail } : {}),
    meta: { text, logline: concept.logline },
  };
}

/* ─── Session history — this sitting's makes, newest first ───────── */

export interface MoviesHistoryEntry {
  mode: MoviesDeskMode;
  /** The row's label: the concept's title, or the detection's
   *  first clip title / stream summary head. */
  label: string;
  concept?: MoviesConcept;
  detection?: MoviesDetection;
  note?: string;
}

export const MOVIES_HISTORY_LIMIT = 8;

/** Prepend a landed make, deduped on mode+label, capped — the
 *  desk's "this session" strip. Session-only by design: the rails
 *  persist nothing (see the gap note), and the strip never claims
 *  otherwise. */
export function pushMoviesHistory(
  history: readonly MoviesHistoryEntry[],
  entry: MoviesHistoryEntry,
): MoviesHistoryEntry[] {
  const key = (e: MoviesHistoryEntry) => `${e.mode}|${e.label}`;
  return [entry, ...history.filter((e) => key(e) !== key(entry))].slice(0, MOVIES_HISTORY_LIMIT);
}
