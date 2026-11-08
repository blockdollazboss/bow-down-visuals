/* ─── Link-to-Hit bench in-world (Stack 300 world parity,
   census Lane B item 12 / manifest item 105) ───────────────────
   The /create hub's Link To Hit panel (LinkToHitPanel) —
   the COMEDY feature — native at the My Studio board: paste
   a social link and/or upload the video, paste the comments,
   get a funny music-video package on the panel's own rails:

     POST /api/upload-clip (multipart "clip") → { url }
       The free hosting step: the picked file REALLY uploads
       and its URL rides along with the analyze request.
     POST /api/link-to-hit/analyze
       { url, description, comments[], genre }
       → { source{ title, author, thumbnail } | null,
           comedyConcept, segments[{ type, description,
           prompt? }], songTitle, hook, songLyrics,
           musicPrompt }

   Two pipelines, never blended — the panel's own law:
   (1) VISUALS: real source clips intercut with AI-generated
   comedic roast inserts; (2) SONG: a funny song — hook +
   full lyrics written FROM THE COMMENTS, in the chosen
   genre. Honest sourcing: upload = the reliable path; link
   = whatever oEmbed publicly exposes (never faked);
   neither = fully AI-generated from the description +
   comments.

   Price: the analyze route's own charge — ANALYZE_CREDITS
   in routes/generate/link-to-hit.ts, default 300 — mirrored
   by the 2D panel's COST and passed to the confirmation as
   the override, exactly as the panel does it. (This rail
   has no credit-registry entry; the panel's override IS the
   house pattern for it, and the registry stays untouched
   this wave by the manifest's own rule.) The upload step is
   free and unconfirmed. Confirmation law: confirmedFetch
   shows the spend confirmation BEFORE the analyze run, a
   decline runs nothing, and a failed run is refunded
   server-side (the route's refundOnFailure).

   The hand-off: the panel's "Make this song" rides a
   website link carrying the lyrics as a query param — a
   channel the World panel-payload system has no kind for
   (another lane's file this wave). In-world the bench opens
   the Song Desk station instead, and the song stays on the
   bench with its copy button — nothing silently dropped.

   Copy rides the linkToHit.* catalog namespace — new to
   the catalogs with this bench, its en values the panel's
   own literal strings, so bench and page can never drift. */
export const LINK_TO_HIT_ANALYZE_PATH = "/api/link-to-hit/analyze";
export const LINK_TO_HIT_UPLOAD_PATH = "/api/upload-clip";

/** The route's ANALYZE_CREDITS default (300) — the same
 *  number the 2D panel's COST carries. */
export const LINK_TO_HIT_COST = 300;
export const LINK_TO_HIT_FEATURE = "Link-to-Hit";

/** The panel's genre presets, verbatim — plus any custom
 *  genre the creator types (their call). */
export const LINK_TO_HIT_GENRE_PRESETS = [
  "Hip-Hop", "Pop", "Country", "Rock", "EDM", "R&B", "Gospel",
  "Reggaeton", "Afrobeats", "Comedy Pop", "Novelty", "Punk",
] as const;
export const LINK_TO_HIT_DEFAULT_GENRE = "Comedy Pop";

/** The panel's caps: at most 20 comments; url ≤ 500 chars,
 *  description ≤ 1000, each comment ≤ 500, custom genre ≤ 60. */
export const LINK_TO_HIT_MAX_COMMENTS = 20;
export const LINK_TO_HIT_URL_MAX = 500;
export const LINK_TO_HIT_DESCRIPTION_MAX = 1000;
export const LINK_TO_HIT_COMMENT_MAX = 500;
export const LINK_TO_HIT_CUSTOM_GENRE_MAX = 60;

/** The member upload ceiling on /api/upload-clip (the
 *  panel's 80 MB; the owner-admin ceiling is the upload
 *  helper's business, applied by the bench via useIsAdmin
 *  exactly as the panel applies it). */
export const LINK_TO_HIT_MEMBER_UPLOAD_BYTES = 80 * 1024 * 1024;

/** The station the song hand-off opens in-world. */
export const LINK_TO_HIT_SONG_STATION_ID = "song-desk";

/** The genre a run uses: a typed custom genre wins over the
 *  picked preset — the panel's finalGenre. */
export function linkToHitFinalGenre(customGenre: string, preset: string): string {
  return customGenre.trim() || preset;
}

export type LinkToHitFileVerdict = "ok" | "not-video" | "too-large";

/** The panel's handleFile rules: a video file under the
 *  caller's ceiling. */
export function linkToHitFileVerdict(
  file: { type: string; size: number },
  limitBytes: number,
): LinkToHitFileVerdict {
  if (!file.type.startsWith("video/")) return "not-video";
  if (file.size > limitBytes) return "too-large";
  return "ok";
}

/** Adding a comment: the Comment-to-Video adder's rules on
 *  this panel's own cap. */
export function addLinkToHitComment(comments: readonly string[], raw: string): string[] | null {
  const c = raw.trim();
  if (!c || comments.length >= LINK_TO_HIT_MAX_COMMENTS) return null;
  return [...comments, c];
}

export interface LinkToHitInput {
  url: string;
  description: string;
  hasUpload: boolean;
  fileName: string;
  comments: readonly string[];
  genre: string;
}

/** The run stays shut (and uncharged) until at least one
 *  source exists — a link, a description, or an upload —
 *  the panel's own gate. */
export function linkToHitInputReady(input: LinkToHitInput): boolean {
  return input.description.trim().length > 0 || input.url.trim().length > 0 || input.hasUpload;
}

/** The panel's analyze body: the uploaded clip's hosted URL
 *  (or the pasted link), the description (an upload with no
 *  description speaks as "Uploaded video: <name>"), the
 *  comments, and the final genre. */
export function buildLinkToHitPayload(input: LinkToHitInput, effectiveUrl: string): Record<string, unknown> {
  return {
    url: effectiveUrl,
    description:
      input.description.trim() || (input.hasUpload ? `Uploaded video: ${input.fileName}` : ""),
    comments: [...input.comments],
    genre: input.genre,
  };
}

/** The upload step's answer: the hosted URL or the upload
 *  didn't happen. */
export function linkToHitUploadUrlOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const url = (data as Record<string, unknown>).url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

export interface LinkToHitSegment {
  type: "source" | "generated";
  description: string;
  prompt?: string;
}

export interface LinkToHitPackage {
  source: { title?: string; author?: string; thumbnail?: string } | null;
  comedyConcept: string;
  segments: LinkToHitSegment[];
  songTitle: string;
  hook: string;
  songLyrics: string;
  musicPrompt: string;
}

/** The answer guard: the package whole or the run reads as
 *  failed — the panel keys on data.comedyConcept; the bench
 *  holds the full shape to the desk standard. A segment
 *  whose type isn't one of the two pipelines is dropped,
 *  never re-labelled. */
export function linkToHitPackageOf(data: unknown): LinkToHitPackage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.comedyConcept !== "string" || d.comedyConcept.length === 0) return null;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  let source: LinkToHitPackage["source"] = null;
  if (d.source && typeof d.source === "object") {
    const s = d.source as Record<string, unknown>;
    source = {
      title: typeof s.title === "string" ? s.title : undefined,
      author: typeof s.author === "string" ? s.author : undefined,
      thumbnail: typeof s.thumbnail === "string" ? s.thumbnail : undefined,
    };
  }
  const segments: LinkToHitSegment[] = [];
  if (Array.isArray(d.segments)) {
    for (const seg of d.segments) {
      if (!seg || typeof seg !== "object") continue;
      const r = seg as Record<string, unknown>;
      if (r.type !== "source" && r.type !== "generated") continue;
      if (typeof r.description !== "string") continue;
      segments.push({
        type: r.type,
        description: r.description,
        prompt: typeof r.prompt === "string" ? r.prompt : undefined,
      });
    }
  }
  return {
    source,
    comedyConcept: d.comedyConcept,
    segments,
    songTitle: str(d.songTitle),
    hook: str(d.hook),
    songLyrics: str(d.songLyrics),
    musicPrompt: str(d.musicPrompt),
  };
}

/** The panel's copy text for the funny song, byte for byte. */
export function linkToHitSongCopyText(pkg: LinkToHitPackage): string {
  return `${pkg.songTitle}\n\nHOOK:\n${pkg.hook}\n\n${pkg.songLyrics}`;
}

/** The text the panel's website hand-off carries into the
 *  song flow — kept whole on the bench's copy button. */
export function linkToHitSongSeed(pkg: LinkToHitPackage, genre: string): string {
  return `${pkg.songTitle}\n\nHOOK:\n${pkg.hook}\n\n${pkg.songLyrics}\n\nGenre: ${genre}\nMusic prompt: ${pkg.musicPrompt}`;
}
