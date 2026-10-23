/* ─── Post Assist in-world (Stack-100 #58) ──────────────────────────
   "Write It For Me" — the feed composer's AI drafting hand, on the
   2D Composer's own rail:

     POST /api/posts/assist   { prompt, tone } → { draft }
                              100 Visual Bucs (the route's
                              POST_ASSIST_CREDITS + the credit
                              registry's own entry — the world's
                              confirmedFetch shows the spend
                              confirmation before it runs; a failed
                              assist is refunded server-side)

   The assist NEVER posts: it returns words the member reads, edits
   and posts themselves — the 2D composer's exact contract. Tones
   are the route's enum, verbatim. */

export const POST_ASSIST_COST_VISUAL_BUCS = 100;
export const POST_ASSIST_PATH = "/api/posts/assist";
export const POST_MAX_CHARS = 500;

export const POST_ASSIST_TONES = [
  { key: "hype", label: "Hype" },
  { key: "chill", label: "Chill" },
  { key: "professional", label: "Professional" },
  { key: "funny", label: "Funny" },
] as const;

export type PostAssistTone = (typeof POST_ASSIST_TONES)[number]["key"];

export function isPostAssistTone(v: unknown): v is PostAssistTone {
  return POST_ASSIST_TONES.some((t) => t.key === v);
}

/** The route needs a real topic (3–300 chars) — the desk says a
 *  shorter one's refusal in words before anything is charged. */
export function postAssistPromptReady(prompt: string): boolean {
  const n = prompt.trim().length;
  return n >= 3 && n <= 300;
}

export function buildPostAssistPayload(prompt: string, tone: PostAssistTone): Record<string, unknown> {
  return { prompt: prompt.trim(), tone };
}

/** The drafted words out of the assist response, or null when the
 *  rail answered without a usable draft (treated as a failure —
 *  a failed assist is refunded server-side). */
export function parsePostAssistDraft(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const draft = (data as Record<string, unknown>)["draft"];
  return typeof draft === "string" && draft.trim().length > 0 ? draft.trim() : null;
}

/** How the 2D composer takes a draft in: appended after the words
 *  already there (blank line between), capped at the post limit. */
export function appendAssistDraft(current: string, draft: string): string {
  return (current ? `${current}\n\n${draft}` : draft).slice(0, POST_MAX_CHARS);
}
