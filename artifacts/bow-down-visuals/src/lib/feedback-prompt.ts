/* ─── Feedback Pop-Ups (Stack-200 UPGRADES 180) ────────────────────────
   The client half of the trigger law. A prompt may appear ONLY when
   every gate below passes, in this order:

   1. QUALIFYING MOMENT — a real thing just succeeded: an export
      finished, a creation succeeded, or a session milestone landed.
      A bare page load is NEVER a qualifying moment; this module has
      no load-time entry point at all. Surfaces announce moments with
      notifyQualifyingMoment(); the host listens.
   2. SETTINGS TOGGLE — the account's Feedback prompts switch is ON
      (Settings → Feedback prompts; GET /api/pitch-fix/feedback-prefs).
   3. HARD CAP — the server stamped the last SHOWING less than 7 days
      ago → no prompt. The server is the authority (lib/pitch-fix.ts
      on the API); this module mirrors the same rule for the local
      decision so a stale client can't argue with it.
   4. HARD SUPPRESSION — never during creation flows, calls, live
      streams, or checkout. Suppressed routes are listed below; call /
      live / creation surfaces can also raise an explicit busy flag.
      A suppressed moment is dropped, never queued for later.
   5. CHANCE ROLL — only then, a 25% roll. Randomness is the LAST
      gate, never the trigger (smart law: no blind randomness).

   Dismissal is one tap and final for that showing — no guilt copy,
   no "are you sure?", and the cap counts the showing either way. */

export const FEEDBACK_PROMPT_CAP_MS = 7 * 24 * 60 * 60 * 1000;
export const FEEDBACK_PROMPT_CHANCE = 0.25;

export const QUALIFYING_MOMENTS = ["export_finished", "creation_succeeded", "session_milestone"] as const;
export type QualifyingMoment = (typeof QUALIFYING_MOMENTS)[number];

export const FEEDBACK_MOMENT_EVENT = "bdv:qualifying-moment";

/** Announce a qualifying moment. Call ONLY from a real success path
 *  (an export that just finished, a creation that just succeeded) —
 *  never from a mount, an effect on load, or a timer by itself. The
 *  session-milestone moment is raised by the host's own milestone
 *  timer, which is a session event, not a page load. */
export function notifyQualifyingMoment(moment: QualifyingMoment): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FEEDBACK_MOMENT_EVENT, { detail: { moment } }));
}

/** Route prefixes where a prompt must NEVER appear: creation flows,
 *  the editor, live/streaming surfaces, calls, and checkout/money
 *  confirmation surfaces. */
export const SUPPRESSED_ROUTE_PREFIXES = [
  "/create",
  "/video-editor",
  "/audio-studio",
  "/ai-audio",
  "/go-live",
  "/live",
  "/live-shopping",
  "/checkout",
  "/cart",
  "/messages", // calls live inside Messages threads
  "/world", // in-World sessions are a live surface
] as const;

export interface FeedbackContext {
  /** Explicit busy flags a surface can raise (in a call, mid-render…). */
  inCreationFlow?: boolean;
  inCall?: boolean;
  inLiveStream?: boolean;
  inCheckout?: boolean;
  pathname?: string;
}

export function isSuppressedContext(ctx: FeedbackContext): boolean {
  if (ctx.inCreationFlow || ctx.inCall || ctx.inLiveStream || ctx.inCheckout) return true;
  const path = ctx.pathname ?? "";
  return SUPPRESSED_ROUTE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`));
}

export interface FeedbackDecisionInput {
  moment: string | null | undefined;
  /** Settings toggle (server prefs). */
  enabled: boolean;
  /** Server-stamped last showing (ISO) or null. */
  lastPromptedAt: string | null;
  now: number;
  context: FeedbackContext;
  /** Injectable for tests; defaults to Math.random. */
  roll: number;
}

export type FeedbackDecisionReason =
  | "show"
  | "not_qualifying"
  | "disabled"
  | "capped"
  | "suppressed"
  | "roll_missed";

export function decideFeedbackPrompt(input: FeedbackDecisionInput): { show: boolean; reason: FeedbackDecisionReason } {
  if (!input.moment || !(QUALIFYING_MOMENTS as readonly string[]).includes(input.moment)) {
    return { show: false, reason: "not_qualifying" };
  }
  if (!input.enabled) return { show: false, reason: "disabled" };
  if (input.lastPromptedAt) {
    const last = new Date(input.lastPromptedAt).getTime();
    if (Number.isFinite(last) && input.now - last < FEEDBACK_PROMPT_CAP_MS) {
      return { show: false, reason: "capped" };
    }
  }
  if (isSuppressedContext(input.context)) return { show: false, reason: "suppressed" };
  if (input.roll >= FEEDBACK_PROMPT_CHANCE) return { show: false, reason: "roll_missed" };
  return { show: true, reason: "show" };
}

/** Session milestone: 20 minutes into a signed-in session counts as a
 *  qualifying moment (raised once per session by the host). */
export const SESSION_MILESTONE_MS = 20 * 60 * 1000;
