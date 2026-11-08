/* ─── Post Assist in-world (Stack-100 #58) ──────────────────────────
   "Write It For Me" — the feed composer's AI drafting hand, on the
   2D Composer's own rail:

     POST /api/posts/assist   { prompt, tone } → { draft, boost }
                              100 Visual Bucs past the caller's
                              monthly plan boosts allowance (the
                              route's POST_ASSIST_CREDITS + the
                              credit registry's own entry): with
                              boosts left, the rail draws one boost
                              instead of charging, and the response's
                              boost object says which funded it
                              (stack300 plans-boosts). A failed
                              assist is refunded server-side either
                              way — Bucs back, or the boost restored.
                              A repeat of the SAME prompt+tone is a
                              replay: the rail answers the stored
                              draft of the first ask (one boost /
                              charge, one generation) and marks the
                              body replayed: true (stack400 C-03) —
                              the surfaces say so plainly instead of
                              letting it read as a stuck generator
                              (C-36).

   The assist NEVER posts: it returns words the member reads, edits
   and posts themselves — the 2D composer's exact contract. Tones
   are the route's enum, verbatim. */

export const POST_ASSIST_COST_VISUAL_BUCS = 100;
export const POST_ASSIST_PATH = "/api/posts/assist";
const POST_MAX_CHARS = 500;

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

/** How an assist was funded, as the rail reports it: whether a plan
 *  boost paid (vs the 100 VB charge), the month's allowance, and how
 *  many boosts are used / left after it. Null when the rail answered
 *  without a boost report (an older build, or the boosts ledger was
 *  unreadable and the charge path ran) — the desk then keeps its
 *  standing drafted-note, never an invented count. */
export interface PostAssistBoost {
  applied: boolean;
  allowance: number;
  used: number;
  remaining: number;
}

/** Whether the rail answered this ask from the stored result of an
 *  earlier identical ask (stack400 C-03/C-36): the draft is the one
 *  already paid for — no new boost, charge, or generation — and the
 *  body carries exactly one added field, replayed: true. Absent on
 *  a fresh success. */
export function parsePostAssistReplayed(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  return (data as Record<string, unknown>)["replayed"] === true;
}

export function parsePostAssistBoost(data: unknown): PostAssistBoost | null {
  if (typeof data !== "object" || data === null) return null;
  const boost = (data as Record<string, unknown>)["boost"];
  if (typeof boost !== "object" || boost === null) return null;
  const b = boost as Record<string, unknown>;
  const applied = b["applied"];
  const allowance = b["allowance"];
  const used = b["used"];
  const remaining = b["remaining"];
  if (typeof applied !== "boolean") return null;
  if (typeof allowance !== "number" || typeof used !== "number" || typeof remaining !== "number") return null;
  return { applied, allowance, used, remaining };
}

/** How the 2D composer takes a draft in: appended after the words
 *  already there (blank line between), capped at the post limit. */
export function appendAssistDraft(current: string, draft: string): string {
  return (current ? `${current}\n\n${draft}` : draft).slice(0, POST_MAX_CHARS);
}
