/**
 * Drop spectacles — the pure client words + claim bookkeeping
 * (World Events, item 3.4).
 *
 * The spectacle itself is server truth: the room's `drop` state
 * (lib/world/world-client.ts) says what landed here, how much a
 * claim pays, and how many claims stand; the room enforces
 * members-only, in-room, first-come on every claim, and the
 * route layer pays claims out of the combined weekly drop pool.
 * This module only turns that state into the words the drop card
 * shows and keeps the page's own claim bookkeeping (which chest
 * MY claim is out on, which chest is already in my hand) as pure
 * transitions, so both are unit-testable without a DOM. Whether a
 * witnessed claim was MINE is decided by the page off the frame's
 * name against the client's own display name — the frame carries
 * name + amount only, both server truth.
 */

import type { WorldDropState } from "./world-client";

/** The shared weekly pool every drop claim draws on — the number
 *  the card's words may name. The server enforces it
 *  (STREAM_DROP_WEEKLY_CAP_VB in lib/stream-drops, server side);
 *  this restatement is copy, never a check. */
export const DROP_WEEKLY_POOL_VB = 1_000;

/** My claim bookkeeping for the standing chest, keyed by the
 *  drop's event id so a swept or previous chest never leaks into
 *  the next one:
 *  - claimedId: the drop MY landed claim took (witnessed).
 *  - sentId:    the drop MY claim is still out on (unresolved). */
export interface DropClaimBook {
  claimedId: string | null;
  sentId: string | null;
}

export const EMPTY_DROP_BOOK: DropClaimBook = { claimedId: null, sentId: null };

/** The standing drop changed (a landing, a state frame, a sweep,
 *  a room walk): ids that name a different chest — or no chest —
 *  are dead. Returns the same object when nothing changed, so
 *  state writes stay quiet. */
export function dropBookForDrop(book: DropClaimBook, drop: WorldDropState | null): DropClaimBook {
  if (!drop) {
    return book.claimedId === null && book.sentId === null ? book : EMPTY_DROP_BOOK;
  }
  const claimedId = book.claimedId === drop.eventId ? book.claimedId : null;
  const sentId = book.sentId === drop.eventId ? book.sentId : null;
  return claimedId === book.claimedId && sentId === book.sentId ? book : { claimedId, sentId };
}

/** I tapped claim on the standing chest: the claim is out until
 *  the room witnesses it (claimed) or the room refuses it (denied). */
export function dropBookClaimSent(book: DropClaimBook, drop: WorldDropState): DropClaimBook {
  return { claimedId: book.claimedId, sentId: drop.eventId };
}

/** A claim landed in the room, witnessed. Only MY OWN landed claim
 *  (the page judges `mine` off the frame's name) moves my book —
 *  another member's claim never resolves a claim of mine still
 *  out, and never marks a chest claimed for me. */
export function dropBookClaimed(
  book: DropClaimBook,
  drop: WorldDropState | null,
  mine: boolean,
): DropClaimBook {
  if (!mine || !drop) return book;
  return { claimedId: drop.eventId, sentId: null };
}

/** My claim was refused: the out-claim resolves. The one refusal
 *  that also proves a claim — "already-claimed" can only be said
 *  to a member whose earlier claim on this chest already landed
 *  (its witnessed frame may have been missed, e.g. across a quiet
 *  reconnect) — so the book takes the server's word for it. */
export function dropBookDenied(
  book: DropClaimBook,
  drop: WorldDropState | null,
  reason: string,
): DropClaimBook {
  const claimedId =
    reason === "already-claimed" && drop ? drop.eventId : book.claimedId;
  return claimedId === book.claimedId && book.sentId === null
    ? book
    : { claimedId, sentId: null };
}

/** Is a claim of mine still out on this chest? (The claim control
 *  rests while it is — one claim in flight at a time.) */
export function dropClaimInFlight(drop: WorldDropState, book: DropClaimBook): boolean {
  return book.sentId === drop.eventId;
}

/** The claim control's state for one viewer:
 *  - "guest":   sign in first — guests witness spectacles only.
 *  - "claimed": this chest already paid me.
 *  - "out":     every claim stands taken; the chest is empty.
 *  - "open":    claims stand and I haven't taken mine. */
export type DropClaimView = "guest" | "claimed" | "out" | "open";

export function dropClaimView(
  drop: WorldDropState,
  isGuest: boolean,
  book: DropClaimBook,
): DropClaimView {
  if (isGuest) return "guest";
  if (book.claimedId === drop.eventId) return "claimed";
  if (drop.claimsLeft <= 0) return "out";
  return "open";
}

/** The card's headline — the spectacle's own booked title, server
 *  truth, restated verbatim. */
export function dropHeadline(drop: WorldDropState): string {
  return drop.title;
}

/** The card's supporting line for the viewer's state — the rules
 *  in one breath: where claims live (this room, members, first
 *  come) and what pays them (the shared weekly pool). */
export function dropLine(drop: WorldDropState, view: DropClaimView): string {
  const amount = drop.amountVb.toLocaleString("en-US");
  switch (view) {
    case "guest":
      return "A drop landed in this room — claims are for members standing here. Sign in to hold a hand.";
    case "claimed":
      return `Your claim landed — ${amount} VB from this drop is yours. One claim per member per drop.`;
    case "out":
      return "Every claim on this drop is taken — the chest stands empty.";
    default:
      return `${amount} VB a claim, first come — ${drop.claimsLeft} of ${drop.claimCap} claims stand. Claims draw on a shared drop pool of ${DROP_WEEKLY_POOL_VB.toLocaleString("en-US")} VB a week.`;
  }
}

/** The witnessed-claim line (the say log + the moment toast): who
 *  took the chest's money and how much — server truth. */
export function dropClaimedLine(claim: { name: string; amountVb: number }): string {
  return `${claim.name} claimed the drop — ${claim.amountVb.toLocaleString("en-US")} VB.`;
}

/** Why a claim was refused, in the member's words. The "budget"
 *  line is where the weekly pool surfaces: the pool is spent, so
 *  claims wait for the week to turn even while a chest stands.
 *  Unknown reasons fall back to the generic line — never a raw
 *  server token. */
export function dropDeniedLine(reason: string): string {
  switch (reason) {
    case "guests":
      return "Drops are for members — sign in to claim.";
    case "no-drop":
      return "That drop is gone — the chest was swept before your claim landed.";
    case "already-claimed":
      return "You've claimed this drop already — one claim per member per drop.";
    case "claimed-out":
      return "Every claim on this drop was just taken — first come, and the room was faster.";
    case "budget":
      return `This week's shared drop pool is spent — drops pay from one ${DROP_WEEKLY_POOL_VB.toLocaleString("en-US")} VB weekly pool, and it refills when the week turns.`;
    default:
      return "That claim didn't land — try again while the drop stands.";
  }
}
