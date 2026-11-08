/* ─── Comment-to-Video bench in-world (Stack 300 world parity,
   census Lane B item 9 / manifest item 102) ────────────────────
   The Hooks page's "comments" tab (CommentToVideoSection),
   native at the Hook Desk: paste your top comments, the AI
   picks the most video-worthy ones and writes complete
   response-video scripts (title, 3-second hook, full script,
   visual plan, CTA) on the section's own rail:

     POST /api/comment-to-video/scripts
       { comments[], niche, count: 3 }
       → { scripts[{ title, hook, script, visualPlan, cta }],
           creditsUsed, creditsRemaining }

   Price: the route's own charge — SCRIPTS_CREDITS in
   routes/generate/comment-to-video.ts, default 200 — mirrored
   by the 2D section's COST constant and passed to the
   confirmation as the override, exactly as the page does it.
   (This rail has no credit-registry entry; the page's
   override IS the house pattern for it, and the registry
   stays untouched this wave by the manifest's own rule.)
   Confirmation law: confirmedFetch shows the spend
   confirmation BEFORE the run, a decline runs nothing, and a
   failed generation is refunded server-side (the route's
   refundOnFailure).

   Copy rides the commentToVideo.* catalog namespace — new to
   the catalogs with this bench, its en values the section's
   own literal strings, so bench and page can never drift. */
export const COMMENT_TO_VIDEO_PATH = "/api/comment-to-video/scripts";

/** The route's SCRIPTS_CREDITS default (200) — the same number
 *  the 2D section's COST carries. Env-overridable server-side;
 *  the confirmation shows this figure exactly as the page's
 *  does. */
export const COMMENT_TO_VIDEO_COST = 200;
export const COMMENT_TO_VIDEO_FEATURE = "Comment-to-Video";

/** The section's own caps: at most 20 pasted comments, each
 *  input capped at 500 chars, the niche at 120. */
export const COMMENT_TO_VIDEO_MAX_COMMENTS = 20;
export const COMMENT_TO_VIDEO_COMMENT_MAX = 500;
export const COMMENT_TO_VIDEO_NICHE_MAX = 120;
/** The section always asks for 3 scripts. */
export const COMMENT_TO_VIDEO_SCRIPT_COUNT = 3;

export interface CommentVideoScript {
  title: string;
  hook: string;
  script: string;
  visualPlan: string;
  cta: string;
}

/** Adding a comment: trimmed, non-empty, under the cap — the
 *  section's addComment rules. Returns the next list, or null
 *  when the add is refused. */
export function addBenchComment(comments: readonly string[], raw: string): string[] | null {
  const c = raw.trim();
  if (!c || comments.length >= COMMENT_TO_VIDEO_MAX_COMMENTS) return null;
  return [...comments, c];
}

/** The section's post body: { comments, niche, count: 3 }. */
export function buildCommentVideoPayload(
  comments: readonly string[],
  niche: string,
): Record<string, unknown> {
  return {
    comments: [...comments],
    niche: niche.trim(),
    count: COMMENT_TO_VIDEO_SCRIPT_COUNT,
  };
}

/** The run stays shut (and uncharged) with no comments — the
 *  section's own gate. */
export function commentVideoInputReady(comments: readonly string[]): boolean {
  return comments.length > 0;
}

/** The answer guard: every script whole (all five fields as
 *  strings) or the run reads as failed — a drifted payload is
 *  never dressed up as scripts. */
export function commentVideoScriptsOf(data: unknown): CommentVideoScript[] | null {
  if (!data || typeof data !== "object") return null;
  const scripts = (data as Record<string, unknown>).scripts;
  if (!Array.isArray(scripts) || scripts.length === 0) return null;
  const out: CommentVideoScript[] = [];
  for (const s of scripts) {
    if (!s || typeof s !== "object") return null;
    const r = s as Record<string, unknown>;
    const fields = [r.title, r.hook, r.script, r.visualPlan, r.cta];
    if (fields.some((f) => typeof f !== "string")) return null;
    out.push({
      title: r.title as string,
      hook: r.hook as string,
      script: r.script as string,
      visualPlan: r.visualPlan as string,
      cta: r.cta as string,
    });
  }
  return out;
}

/** The section's copy-all text for one script, byte for byte. */
export function commentVideoScriptCopyText(s: CommentVideoScript): string {
  return `${s.title}\n\nHOOK: ${s.hook}\n\n${s.script}\n\nVISUALS: ${s.visualPlan}\n\nCTA: ${s.cta}`;
}
