/**
 * Stage tips from seats — the pure client words (Ring 3, item 3.3).
 *
 * The transfer is server truth: the room verifies the tipper, the
 * stage and the amount, and lib/world-stage-tips (server) moves
 * the Visual Bucs. This module only phrases what the room reports
 * — the witnessed line for a landed tip and the plain-words reason
 * for a refused one — and names the preset amounts the seat
 * control offers. The bounds themselves (100–1,000,000 VB) are the
 * server's (lib/live-config on the server side); the presets sit
 * well inside them.
 */

/** The seat control's preset amounts (VB). */
export const STAGE_TIP_PRESETS: readonly number[] = [100, 250, 500, 1_000];

/** The witnessed line (the say log + the moment toast): who tipped
 *  the stage, and how much — the frame's numbers are server truth. */
export function stageTippedLine(tip: {
  name: string;
  performerName: string;
  amountVb: number;
}): string {
  return `${tip.name} tipped ${tip.performerName} ${tip.amountVb.toLocaleString("en-US")} VB from the seats.`;
}

/** Why a tip was refused, in the tipper's words. Unknown reasons
 *  fall back to the generic line — never a raw server token. */
export function stageTipDeniedLine(reason: string): string {
  switch (reason) {
    case "guests":
      return "Tips are for members — sign in to tip the stage.";
    case "no-stage":
      return "Nobody holds the stage right now — tips land while a show is on.";
    case "self":
      return "That's your stage — you can't tip yourself.";
    case "amount":
      return "Stage tips run 100 to 1,000,000 Visual Bucs.";
    case "too-fast":
      return "One tip at a time — give it a couple of seconds.";
    case "insufficient":
      return "Not enough Visual Bucs for that tip — your balance hasn't changed.";
    case "disabled":
      return "Tips aren't available on your account right now.";
    default:
      return "That tip didn't land — no Visual Bucs moved. Try again.";
  }
}
