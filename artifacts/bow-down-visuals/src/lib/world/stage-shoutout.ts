/**
 * Stage shoutouts from seats — the pure client words (Ring 3,
 * item 3.3 remainder).
 *
 * The purchase is server truth: the room verifies the buyer, the
 * stage and the message, and lib/world-stage-shoutouts (server)
 * settles it on the site's shoutout rail — the performer's own
 * price from their shoutout_settings, the rail's flat 5% split.
 * This module only carries the seat control's client-side pieces:
 * the message bound (the room's own say bound, mirrored), the
 * performer's offer as the world endpoint serves it, and the map
 * from a refusal reason to its locale key. The copy itself lives
 * in the worldStageShoutout catalog namespace; the money lines in
 * it (the price button, the witnessed line, the insufficient and
 * generic refusal lines) stay English in every catalog — money
 * copy is never agent-drafted (the gift-desk discipline).
 */

/** The shoutout message bound — the room's SAY_MAX_CHARS
 *  (lib/world-room.ts on the server), mirrored so the composer
 *  can refuse an over-long message before it is sent: a paid
 *  message is never silently truncated, on either side. */
export const STAGE_SHOUTOUT_MESSAGE_MAX = 300;

/** The composer's pre-send check, in the room's own terms. */
export function stageShoutoutMessageProblem(message: string): "empty" | "too-long" | null {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return "empty";
  if (text.length > STAGE_SHOUTOUT_MESSAGE_MAX) return "too-long";
  return null;
}

/** The performer's offer, as GET /api/world/shoutout-offer/:slug
 *  serves it. */
export type ShoutoutOffer =
  | { state: "offered"; priceVb: number }
  | { state: "not-offered" };

/** Tolerant reader for the offer payload: anything unreadable is
 *  null (the caller shows its load-failed state with a retry) —
 *  never a guessed "not offered", never an invented price. */
export function parseShoutoutOffer(json: unknown): ShoutoutOffer | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (o.offered === false) return { state: "not-offered" };
  if (o.offered === true && typeof o.priceVb === "number" && Number.isFinite(o.priceVb) && o.priceVb >= 0) {
    return { state: "offered", priceVb: o.priceVb };
  }
  return null;
}

/** Why a shoutout was refused → its locale key under
 *  worldStageShoutout. Unknown reasons fall back to the generic
 *  line — never a raw server token on the bar. */
export function stageShoutoutDeniedKey(reason: string): string {
  switch (reason) {
    case "guests":
      return "worldStageShoutout.deniedGuests";
    case "no-stage":
      return "worldStageShoutout.deniedNoStage";
    case "self":
      return "worldStageShoutout.deniedSelf";
    case "message":
      return "worldStageShoutout.deniedMessage";
    case "too-fast":
      return "worldStageShoutout.deniedTooFast";
    case "not-offered":
      return "worldStageShoutout.deniedNotOffered";
    case "insufficient":
      return "worldStageShoutout.deniedInsufficient";
    case "disabled":
      return "worldStageShoutout.deniedDisabled";
    default:
      return "worldStageShoutout.deniedError";
  }
}
