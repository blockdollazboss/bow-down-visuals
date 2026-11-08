/* ─── Chat Speak bench in-world (Stack 400 world parity,
   census B item B-08) ──────────────────────────────────────
   Chat Speak — hearing Thy Cheat Code say a reply out loud —
   native on the in-World Thy/operator surface (the My Studio
   board, where the walker's own desks live): write or paste
   the reply text, tap Speak, and the King says it in his own
   voice on the 2D drawer's own rail:

     GET  /api/chat/speak/status → { ready, creditCost }
     POST /api/chat/speak { text, idempotencyKey }
       → { audioPlayUrl, creditsUsed, creditsRemaining }

   This seam is a thin World face over lib/chat-speak — the
   drawer's seam is reused whole (status parsing, the view
   verdict, the playback coordinator, the client key), so the
   two surfaces can never drift on the rules:

   - The price is NEVER hardcoded here either. The status
     read carries the server's figure; the registry row
     (/api/chat/speak, 100 Bucs — owner ruling Oct 20, 2026)
     is read through getCreditCost only to pin the rail's
     identity in tests. The confirmation shows the SERVER's
     status figure, exactly as the drawer does.
   - Charged only when it plays (the manifest's B-08 pin,
     the drawer's standing contract): the spend runs through
     confirmedFetch, so declining the confirmation sends no
     request and charges nothing; the server refuses with a
     503 while his voice is uncast and never charges; and any
     synthesis/storage failure refunds server-side — a speak
     that doesn't produce playable audio nets zero.
   - One client key per speak intent (the drawer's rule):
     retries of the same tap reuse the key and can't
     double-charge; a successful speak is cached and "listen
     again" replays it locally, free.
   - Until the voice is cast the bench says so in the
     drawer's own words ("still being cast") — no dead
     control, no fake speak.

   Copy rides the worldChatSpeakBench.* catalog namespace —
   new to the catalogs with this bench; the casting and
   unavailable lines are the drawer's own literal strings
   (lib/chat-speak's constants, the same words in both
   places). The other nine catalogs carry the new keys
   English-verbatim UNREVIEWED, the house convention. */
import { getCreditCost } from "@/lib/credit-costs";
import { CHAT_SPEAK_PATH, CHAT_SPEAK_STATUS_PATH } from "@/lib/chat-speak";

export const WORLD_SPEAK_PATH = CHAT_SPEAK_PATH;
export const WORLD_SPEAK_STATUS_PATH = CHAT_SPEAK_STATUS_PATH;

/** The registry's row for the speak rail (100 Bucs) — the
 *  rail's identity pin. The price the member SEES and
 *  confirms is the status read's server figure, never this
 *  constant (the drawer's honesty rule #1). */
export const WORLD_SPEAK_REGISTRY_COST =
  getCreditCost(WORLD_SPEAK_PATH)?.cost ?? 0;

/** The confirmation's feature name — the exact words the 2D
 *  drawer's spend popup carries for this same charge. */
export const WORLD_SPEAK_FEATURE = "Hear Thy Cheat Code speak";

/** The rail's hard cap: replies are capped at 2,000 chars by
 *  the chat contract, and the route refuses longer text
 *  honestly rather than truncating mid-reply. */
export const WORLD_SPEAK_TEXT_MAX = 2000;

export interface WorldSpeakOutcome {
  audioPlayUrl: string;
  creditsUsed: number;
  creditsRemaining: number;
}

/** Read a speak answer. A 200 without a playable URL is NOT
 *  a success the bench may present (or consider played) —
 *  returns null so the caller states the failure plainly. */
export function speakOutcomeOf(data: unknown): WorldSpeakOutcome | null {
  const d = data as {
    audioPlayUrl?: unknown;
    creditsUsed?: unknown;
    creditsRemaining?: unknown;
  } | null;
  if (typeof d?.audioPlayUrl !== "string" || !d.audioPlayUrl) return null;
  return {
    audioPlayUrl: d.audioPlayUrl,
    creditsUsed: typeof d.creditsUsed === "number" ? d.creditsUsed : 0,
    creditsRemaining: typeof d.creditsRemaining === "number" ? d.creditsRemaining : 0,
  };
}

/** The server's own words for a failed speak — its message
 *  when it sent one, else its error code, never a
 *  client-invented explanation (the drawer's rule, mirrored
 *  here for the bench's error surface). */
export function speakFailureMessage(data: unknown): string {
  const d = data as { message?: unknown; error?: unknown } | null;
  if (typeof d?.message === "string" && d.message) return d.message;
  if (typeof d?.error === "string" && d.error) return d.error;
  return "Thy Cheat Code couldn't speak that reply — please try again.";
}

/** Whether this text can be sent at all: non-empty once
 *  trimmed, and inside the rail's cap. */
export function speakTextReady(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= WORLD_SPEAK_TEXT_MAX;
}
