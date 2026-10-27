/**
 * Paid Priority DMs (Wave-4 #44) — frontend helpers for the lane
 * inside Messages. Pure functions only; the panel component
 * (components/PriorityDmPanel) does the fetching.
 *
 * Honesty rules carried to the surface:
 *   - PRICE + GATE — OWNER RULED 2026-10-27: the platform gate is
 *     OPEN and the price is the platform's ruled 100 VB per message.
 *     If the kill switch ever closes the gate there is NO price
 *     anywhere in this UI — the copy says priority DMs are off.
 *   - When on, the only price ever shown is the ruled platform price
 *     from the status response, next to the creator's stated reply
 *     window and the auto-refund text — all three before the fan pays.
 */

export interface PriorityStatusResponse {
  platform_enabled: boolean;
  available: boolean;
  reason?: string;
  price_vb?: number;
  reply_window_hours?: number;
}

export interface PriorityDmRowDto {
  id: string;
  conversation_id: string | null;
  message_id: string | null;
  sender_user_id: string;
  creator_user_id: string;
  amount_vb: number;
  status: "held" | "replied" | "refunded_expired" | "refunded_blocked";
  reply_deadline: string;
  replied_at: string | null;
  settled_at: string | null;
  created_at: string;
}

/** The gate-off explanation — shown verbatim instead of any price
 *  (only reachable via the platform kill switch). */
export const PRIORITY_DM_GATE_OFF_COPY =
  "Priority DMs are switched off right now. Normal messages are free and work exactly as always.";

/** Can the fan buy right now? Only a live platform + an opted-in
 *  creator with the ruled platform price stated counts — nothing else. */
export function canBuyPriority(status: PriorityStatusResponse | null): boolean {
  return Boolean(
    status?.platform_enabled &&
    status.available &&
    typeof status.price_vb === "number" &&
    typeof status.reply_window_hours === "number",
  );
}

/** The pre-purchase statement: price + window + refund rule, together.
 *  Returns null unless every fact is present — a partial statement is
 *  never shown. */
export function priorityPurchaseStatement(status: PriorityStatusResponse | null): string | null {
  if (!canBuyPriority(status)) return null;
  return `${status!.price_vb} Visual Bucs · replies within ${formatReplyWindow(status!.reply_window_hours!)} or your Visual Bucs come back in full, automatically.`;
}

export function formatReplyWindow(hours: number): string {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? "24 hours" : `${days} days`;
  }
  return `${hours} hours`;
}

/** Plain-language state of one priority DM, for either side. */
export function priorityRowLabel(row: PriorityDmRowDto, now: Date = new Date()): string {
  switch (row.status) {
    case "replied":
      return "Replied — settled to the creator";
    case "refunded_expired":
      return "Refunded in full — no reply in the stated window";
    case "refunded_blocked":
      return "Refunded in full — blocked";
    case "held": {
      const deadline = new Date(row.reply_deadline);
      if (deadline.getTime() <= now.getTime()) return "Window closed — refund on its way";
      return `Waiting for a reply — full refund if unanswered by ${deadline.toLocaleString()}`;
    }
  }
}

/** One intent key per purchase tap: a retry of the same tap reuses
 *  it (the server returns the original purchase, never a second
 *  charge); a new tap gets a fresh key. */
export function newPriorityIntentKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `pd-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}
