/* ─── Dream Collab bench in-world (Stack 300 world parity,
   census Lane B item 11 / manifest item 104) ───────────────────
   The /create hub's Dream Collab panel (DreamCollabPanel),
   native at the My Studio board: "What if I collabed with
   X?" — a style-blend video concept (logline, full concept,
   prompt-level video prompts, a song concept) on the
   panel's own rail:

     POST /api/dream-collab/concept
       { collaborator, userStyle, songTheme }
       → { logline, concept, styleBlend, videoPrompts[],
           songConcept, creditsUsed, creditsRemaining }

   Price: the route's own charge — CONCEPT_CREDITS in
   routes/generate/dream-collab.ts, default 200 — mirrored
   by the 2D panel's COST constant and passed to the
   confirmation as the override, exactly as the panel does
   it. (This rail has no credit-registry entry; the panel's
   override IS the house pattern for it, and the registry
   stays untouched this wave by the manifest's own rule.)
   Confirmation law: confirmedFetch shows the spend
   confirmation BEFORE the run, a decline runs nothing, and
   a failed generation is refunded server-side (the route's
   refundOnFailure).

   The hand-off: the panel's "Make this song" rides a website
   link carrying the concept as a query param — a channel
   the World panel-payload system has no kind for (its kinds
   are another lane's file this wave). In-world the bench
   opens the Song Desk station instead, and the concept
   stays on the bench with its copy button — nothing is
   silently dropped, and no fake prefill is claimed.

   Copy rides the dreamCollab.* catalog namespace — new to
   the catalogs with this bench, its en values the panel's
   own literal strings, so bench and page can never drift. */
export const DREAM_COLLAB_PATH = "/api/dream-collab/concept";

/** The route's CONCEPT_CREDITS default (200) — the same
 *  number the 2D panel's COST carries. */
export const DREAM_COLLAB_COST = 200;
export const DREAM_COLLAB_FEATURE = "Dream Collab";

/** The panel's input caps: collaborator ≤ 120, style ≤ 200,
 *  theme ≤ 300. */
export const DREAM_COLLAB_COLLABORATOR_MAX = 120;
export const DREAM_COLLAB_STYLE_MAX = 200;
export const DREAM_COLLAB_THEME_MAX = 300;

/** The station the song hand-off opens in-world. */
export const DREAM_COLLAB_SONG_STATION_ID = "song-desk";

export interface DreamCollabConcept {
  logline: string;
  concept: string;
  styleBlend: string;
  videoPrompts: string[];
  songConcept: string;
}

/** The panel's post body: all three fields trimmed, the
 *  theme riding as a (possibly empty) string. */
export function buildDreamCollabPayload(input: {
  collaborator: string;
  userStyle: string;
  songTheme: string;
}): Record<string, unknown> {
  return {
    collaborator: input.collaborator.trim(),
    userStyle: input.userStyle.trim(),
    songTheme: input.songTheme.trim(),
  };
}

/** The run stays shut (and uncharged) until both required
 *  fields carry text — the panel's own gate. */
export function dreamCollabInputReady(input: { collaborator: string; userStyle: string }): boolean {
  return input.collaborator.trim().length > 0 && input.userStyle.trim().length > 0;
}

/** The answer guard: the concept whole or the run reads as
 *  failed — the panel keys on data.logline; the bench holds
 *  the full shape to the same standard as every other desk. */
export function dreamCollabConceptOf(data: unknown): DreamCollabConcept | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.logline !== "string" || d.logline.length === 0) return null;
  if (typeof d.concept !== "string") return null;
  return {
    logline: d.logline,
    concept: d.concept,
    styleBlend: typeof d.styleBlend === "string" ? d.styleBlend : "",
    videoPrompts: Array.isArray(d.videoPrompts)
      ? d.videoPrompts.filter((p): p is string => typeof p === "string")
      : [],
    songConcept: typeof d.songConcept === "string" ? d.songConcept : "",
  };
}

/** The panel's copy-all text, byte for byte. */
export function dreamCollabCopyText(c: DreamCollabConcept): string {
  return `${c.logline}\n\n${c.concept}\n\nSTYLE BLEND: ${c.styleBlend}\n\nVIDEO PROMPTS:\n${c.videoPrompts.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\nSONG CONCEPT: ${c.songConcept}`;
}

/** The text the panel's website hand-off carries into the
 *  song flow — kept whole on the bench's copy button. */
export function dreamCollabSongSeed(c: DreamCollabConcept): string {
  return `${c.logline}\n\n${c.songConcept}\n\nStyle blend: ${c.styleBlend}`;
}
