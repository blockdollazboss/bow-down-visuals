/**
 * api-error.ts — the one translator between server error payloads and
 * words a customer can act on (stack900 Lane L1, error-truth audit).
 *
 * The server answers failures as `{ error: "<code>", message: "<plain
 * words>" }` — most chargeable rails carry BOTH fields, some carry the
 * code alone, and older routes put a plain sentence in `error` itself.
 * The Gate #3 failure (Pass 5) was an FE surface rendering the raw code
 * `credits_disabled` to a customer. The law from that day: a raw server
 * code is a defect. An error a customer sees must say, in plain words,
 * what happened, what it means for their money/work, and what to do next.
 *
 * Two entry points:
 *  - `apiErrorMessage(body, fallback)` — for a parsed response body at
 *    the throw/set point. Prefers the server's own plain `message`
 *    (it names the specific action, cost, and refund truth), then a
 *    plain-sentence `error`, then the code map below. A code-shaped
 *    string is NEVER returned: an unmapped code yields the caller's
 *    own plain fallback for that action.
 *  - `plainErrorText(value, fallback)` — for a caught error / loose
 *    string at the render point. Same never-code guarantee, so the
 *    `msg === "out_of_credits"` signal idiom keeps working upstream:
 *    catches may keep comparing the raw message; only the words that
 *    finally render pass through here.
 *
 * Charge truth in this map is claimed ONLY where the code's semantics
 * guarantee it: a 402 refusal happens before any charge, the credit
 * lockdown refuses before any charge, and an interrupted export job
 * was never charged (the rail's own recovery words). Generation
 * failures do NOT claim a refund here — the server's `message` names
 * the refund when one happened, and it always wins over this map.
 */

/** Exact code → plain words. Keys are matched case-insensitively. */
export const API_ERROR_CODE_MESSAGES: Record<string, string> = {
  /* ── Money: credits, charges, refunds ─────────────────────────── */
  out_of_credits:
    "Not enough Visual Bucs — top up and try again. You weren't charged.",
  insufficient_balance:
    "Not enough Visual Bucs — top up and try again. You weren't charged.",
  insufficient_vb:
    "Not enough Visual Bucs — top up and try again. You weren't charged.",
  no_balance:
    "Not enough Visual Bucs — top up and try again. You weren't charged.",
  credits_disabled:
    "Spending is paused right now — nothing was charged. Please try again later.",
  ledger_write_failed:
    "Something went wrong on our side while recording that. Check your balance, then try again.",
  ledger_failed:
    "Something went wrong on our side while recording that. Check your balance, then try again.",
  ledger_error:
    "Something went wrong on our side while recording that. Check your balance, then try again.",
  credit_failed:
    "That credit change didn't go through — check your balance, then try again.",
  charge_failed: "The charge didn't go through — you weren't charged. Please try again.",
  refund_failed:
    "The refund didn't go through. Give it a moment and check your balance — if it's still missing, contact support.",
  purchase_failed: "That purchase didn't go through — you weren't charged. Please try again.",
  sold_out_after_payment:
    "That sold out right as you paid — your payment is being refunded. Check your balance shortly.",
  proof_not_approved:
    "Your design proof isn't approved yet — approve the proof first, then try again.",
  priority_dm_refunded_blocked:
    "That priority message was already refunded, so it can't be sent again.",

  /* ── Sign-in / permission ─────────────────────────────────────── */
  unauthorized: "Please sign in to do that.",
  auth_required: "Please sign in to do that.",
  account_required: "Please sign in to do that.",
  admin_required: "That needs an admin account.",
  token_expired: "Your session expired — sign in again to continue.",
  access_token_invalid: "Your session expired — sign in again to continue.",
  invalid_access_token: "Your session expired — sign in again to continue.",
  token_not_found: "That link has expired — request a fresh one.",
  staging_locked: "The site is locked for testing right now — check back soon.",
  forbidden: "You don't have permission to do that.",
  not_owner: "That's not yours to change.",
  not_yours: "That's not yours to change.",
  not_the_seller: "Only the seller can do that.",
  not_author: "Only the author can do that.",
  members_only: "That's for members only.",
  circle_only: "That's only shared with their circle.",
  front_row_required: "That's for Front Row members only.",
  pro_tier_required: "That needs the Pro plan — upgrade to use it.",
  tier_required: "That needs a higher plan — upgrade to use it.",

  /* ── Paused / not set up / provider down ──────────────────────── */
  not_configured: "That isn't set up yet — please try again later.",
  ai_unavailable: "The AI is unavailable right now — please try again in a moment.",
  audio_gen_unavailable: "Audio generation isn't set up yet — please try again later.",
  video_gen_unavailable: "Video generation isn't set up yet — please try again later.",
  provider_not_connected: "That service isn't connected yet — connect it first, then try again.",
  provider_error: "The outside service hit a problem — please try again in a moment.",
  provider_failed: "The outside service hit a problem — please try again in a moment.",
  provider_busy_timeout: "The outside service is busy — please try again in a moment.",
  ffmpeg_unavailable: "Video processing is unavailable right now — please try again later.",
  storage_unavailable: "Storage is unavailable right now — please try again later.",
  calls_unavailable: "Calls are unavailable right now — please try again later.",

  /* ── Rate limits / capacity ───────────────────────────────────── */
  rate_limited: "Too many tries in a row — wait a moment, then try again.",
  rate_limit: "Too many tries in a row — wait a moment, then try again.",
  rate_limit_exceeded: "Too many tries in a row — wait a moment, then try again.",
  queue_full: "The line is full right now — wait a moment, then try again.",
  capacity: "That's at capacity right now — try again later.",
  live_capacity: "Live is at capacity right now — try again later.",

  /* ── Generation / processing failures ─────────────────────────── */
  generation_failed: "That generation didn't finish — please try again.",
  ai_failed: "The AI couldn't finish that — please try again.",
  analysis_failed: "That analysis didn't finish — please try again.",
  detection_failed: "That scan didn't finish — please try again.",
  upload_failed: "That upload didn't go through — check your connection and try again.",
  upload_error: "That upload didn't go through — check your connection and try again.",
  save_failed: "That didn't save — please try again.",
  publish_failed: "That didn't publish — please try again.",
  publish_in_progress: "That's already publishing — give it a moment.",
  export_failed: "That export didn't finish — please try again.",
  transcription_failed: "That transcription didn't finish — please try again.",
  clone_failed: "That clone didn't finish — please try again.",
  remix_failed: "That remix didn't finish — please try again.",
  replace_failed: "That replacement didn't finish — please try again.",
  highlight_failed: "Those highlights didn't finish — please try again.",
  highlights_failed: "Those highlights didn't finish — please try again.",
  post_failed: "That post didn't go through — please try again.",
  reply_failed: "That reply didn't go through — please try again.",
  react_failed: "That reaction didn't land — please try again.",
  delete_failed: "That delete didn't go through — please try again.",
  update_failed: "That change didn't save — please try again.",
  create_failed: "That didn't get created — please try again.",
  edit_failed: "That edit didn't save — please try again.",
  vote_failed: "That vote didn't land — please try again.",
  repost_failed: "That repost didn't go through — please try again.",
  import_failed: "That import didn't finish — please try again.",
  processing_failed: "That didn't finish processing — please try again.",
  server_error: "Something went wrong on our side — please try again in a moment.",
  unhandled: "Something went wrong on our side — please try again in a moment.",
  exception: "Something went wrong on our side — please try again in a moment.",
  internal: "Something went wrong on our side — please try again in a moment.",
  network_error: "Network trouble — check your connection and try again.",
  fetch_failed: "Network trouble — check your connection and try again.",

  /* ── Interrupted / stale jobs (the honest export pattern) ─────── */
  interrupted:
    "That was interrupted partway — you were not charged. Please start it again.",
  prepare_stale:
    "That took too long to get going and expired — you were not charged. Please start it again.",

  /* ── State conflicts ──────────────────────────────────────────── */
  sold_out: "That's sold out.",
  handle_taken: "That handle is already taken — try another.",
  slug_taken: "That link name is already taken — try another.",
  code_taken: "That code is already taken — try another.",
  duplicate_email: "That email is already on the list.",
  invalid_transition: "That can't be done from where it stands now — refresh and check its status.",
  window_closed: "That window has closed.",
  not_ready: "That isn't ready yet — give it a moment and try again.",
  not_live: "That isn't live right now.",
  stream_not_live: "That stream isn't live right now.",
  drop_not_live: "That drop isn't live right now.",
  self_tip: "You can't tip yourself.",
  same_creator: "That needs a different creator.",
  own_profile: "That's your own profile.",
  sample_clearance_ack_required:
    "Tick the sample-clearance acknowledgement first, then try again.",

  /* ── Missing pieces of the request ────────────────────────────── */
  no_profile: "Set up your creator profile first, then try again.",
  no_audio: "Add an audio file first, then try again.",
  no_file: "Add a file first, then try again.",
  no_stems: "No stems were found for that — upload the track again.",
  no_source: "The source for that is missing — add it again.",
  missing_prompt: "Add a prompt describing what you want first.",
  empty_file: "That file is empty — pick another one.",
  file_too_large: "That file is too large — pick a smaller one.",
  too_large: "That's too large — make it smaller and try again.",
  too_long: "That's too long — trim it and try again.",
  too_short: "That's too short — add a little more and try again.",
  song_too_long: "That song is too long for this — trim it and try again.",
  unsupported_type: "That file type isn't supported.",
  unsupported_url: "That link isn't supported.",
  invalid_url: "That link doesn't look right — check it and try again.",

  /* ── Validation (generic bucket) ──────────────────────────────── */
  invalid: "Something in that didn't check out — review it and try again.",
  invalid_request: "Something in that request didn't check out — review it and try again.",
  invalid_input: "Something in that didn't check out — review it and try again.",
  invalid_body: "Something in that didn't check out — review it and try again.",
  bad_request: "Something in that request didn't check out — review it and try again.",
  bad_input: "Something in that didn't check out — review it and try again.",
  bad_body: "Something in that request didn't check out — review it and try again.",
  validation: "Something in that didn't check out — review it and try again.",
  invalid_id: "That item couldn't be found — it may have been removed.",
  bad_id: "That item couldn't be found — it may have been removed.",
  job_not_found: "That job couldn't be found — it may have expired. Start it again.",
  not_found: "We couldn't find that — it may have been removed.",
};

/**
 * Family rules for the long tail, applied when no exact entry matches.
 * Order matters: first matching rule wins. Each returns plain words with
 * a next step; none of them echoes the code.
 */
const FAMILY_RULES: Array<[RegExp, string]> = [
  [/_not_found$|^not_found$/, "We couldn't find that — it may have been removed."],
  [/_not_configured$|_not_ready$|_not_deployed$|_not_live_yet$/, "That isn't set up yet — please try again later."],
  [/_unavailable$/, "That is unavailable right now — please try again later."],
  [/_not_connected$/, "That service isn't connected yet — connect it first, then try again."],
  [/^already_/, "That's already done."],
  [/^invalid_|_invalid$/, "Something in that didn't check out — review it and try again."],
  [/^bad_/, "Something in that didn't check out — review it and try again."],
  [/^no_/, "Something that needs is missing — add it and try again."],
  [/^missing_/, "Something that needs is missing — add it and try again."],
  [/_failed$/, "That didn't go through — please try again."],
  [/_error$/, "Something went wrong on our side — please try again in a moment."],
];

/** A single token with no spaces or sentence punctuation — code-shaped. */
const CODE_SHAPE = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * True when a string is shaped like a server code rather than words for
 * a person: a single token that is a known code (matched
 * case-insensitively — the server's own "Unauthorized" IS the
 * `unauthorized` code, and the map's fuller words win), contains an
 * underscore (sentences don't), or is an ALL-CAPS/digits token of 4+
 * characters. A lone word that is NOT a known code ("Failed") is not
 * code-shaped — it is terse, but it is plain English and may render.
 */
export function isErrorCodeShape(value: string): boolean {
  const s = value.trim();
  if (!s || !CODE_SHAPE.test(s)) return false;
  if (API_ERROR_CODE_MESSAGES[s.toLowerCase()]) return true;
  if (s.includes("_")) return true;
  if (s.length >= 4 && /^[A-Z0-9]+$/.test(s)) return true;
  return false;
}

/** Map one code to plain words, or null when no words are known for it. */
export function messageForErrorCode(code: string): string | null {
  const key = code.trim().toLowerCase();
  const exact = API_ERROR_CODE_MESSAGES[key];
  if (exact) return exact;
  for (const [pattern, words] of FAMILY_RULES) {
    if (pattern.test(key)) return words;
  }
  return null;
}

/** The plain words in a string field, or null when it is a raw code. */
function plainField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  return isErrorCodeShape(s) ? null : s;
}

/** The code carried by a field, or null when the field holds plain words. */
function codeField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  return isErrorCodeShape(s) ? s : null;
}

/**
 * The words a customer should see for a parsed API error body.
 * Preference order: the server's plain `message` (it carries the
 * action-specific truth — cost, refund, next step) → a plain-sentence
 * `error` → the code map for a code in `error`/`code` → `fallback`.
 * The return value is never a raw code.
 */
export function apiErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const message = plainField(record.message);
    if (message) return message;
    const sentence = plainField(record.error);
    if (sentence) return sentence;
    for (const field of [record.error, record.code, record.message]) {
      const code = codeField(field);
      if (code) {
        const words = messageForErrorCode(code);
        if (words) return words;
      }
    }
  }
  if (typeof body === "string") return plainErrorText(body, fallback);
  return fallback;
}

/**
 * The words a customer should see for a caught error or loose value at
 * a render point. Plain sentences pass through untouched; a string that
 * is exactly a known/family code becomes its plain words; an unknown
 * code becomes `fallback`. Never returns a raw code.
 */
export function plainErrorText(value: unknown, fallback: string): string {
  if (value instanceof Error) return plainErrorText(value.message, fallback);
  if (typeof value !== "string") return fallback;
  const s = value.trim();
  if (!s) return fallback;
  if (!isErrorCodeShape(s)) return s;
  return messageForErrorCode(s) ?? fallback;
}

/**
 * The message for an Error thrown at a site whose catches speak the
 * out-of-credits signal protocol: across the app, catches compare the
 * thrown message to the literal "out_of_credits" to open the top-up
 * door (the `handleApiError` / `msg === "out_of_credits"` idiom). For a
 * 402 / out_of_credits body this returns exactly that literal, so the
 * door keeps working; every other failure returns the plain words from
 * `apiErrorMessage`. The signal is internal — any catch that renders
 * the message without branching on it must pass it through
 * `plainErrorText` first.
 */
export function apiThrowMessage(body: unknown, fallback: string, status?: number): string {
  if (status === 402) return "out_of_credits";
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (record.error === "out_of_credits" || record.code === "out_of_credits") {
      return "out_of_credits";
    }
  }
  return apiErrorMessage(body, fallback);
}
