/**
 * performance-bookings.ts — Book the Artist (#158), the pure core.
 *
 * A performance booking upgrades Paid Bookings with the sponsors
 * escrow pattern: a promoter/venue books an artist for a show (date,
 * venue facts, fee), the fee is held in escrow when funded, and it is
 * released to the artist only after the show completes and the
 * promoter releases it. This module owns everything about that shape
 * that does not need the database:
 *
 *   - the fee split (15% platform fee — the sponsors escrow rate —
 *     out of the fee at release; the promoter pays the agreed fee,
 *     nothing extra);
 *   - the lifecycle state machine (booking + escrow), so routes can
 *     refuse an out-of-order step with one honest answer instead of
 *     each endpoint inventing its own rules;
 *   - the plain-words terms summary (#164's plain-words deal,
 *     auto-attached): a deterministic plain-English rendering of the
 *     agreed terms, regenerated on every write that changes them and
 *     stored on the record (performance_bookings.plain_words) — the
 *     words a human reads are generated from the same facts the money
 *     moves on, so the two can never drift apart;
 *   - the deterministic Stripe idempotency key for escrow funding.
 *
 * Money here is REAL dollars via Stripe — never Visual Bucs.
 */
import { buildCheckoutSessionIdempotencyKey } from "./stripe-client";
import type { PerformanceBookingTerms } from "@workspace/db";

/* ═══════════════ Fee split (sponsors escrow rate) ═══════════════════ */

/* Platform cut in basis points — 1500 = 15%, the sponsors escrow rate
 * (SPONSOR_PLATFORM_FEE_BPS). Env-overridable without a deploy. */
export const PERFORMANCE_BOOKING_FEE_BPS =
  Number(process.env["PERFORMANCE_BOOKING_FEE_BPS"]) || 1500;

export function performanceFeeSplit(grossCents: number): { feeCents: number; netCents: number } {
  const feeCents = Math.round((grossCents * PERFORMANCE_BOOKING_FEE_BPS) / 10000);
  return { feeCents, netCents: grossCents - feeCents };
}

export function moneyCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ═══════════════ Lifecycle state machine ════════════════════════════ */

export type PerformanceBookingStatus =
  | "proposed" | "accepted" | "funded" | "completed" | "paid" | "declined" | "cancelled";

export type PerformanceEscrowStatus =
  | "unfunded" | "funding" | "funded" | "released" | "refunded";

/** The steps a booking can take, and who takes them. The routes check
 *  the actor AND this map — a step not listed here does not exist. */
export type PerformanceBookingAction =
  | "accept" | "decline" | "fund" | "complete" | "release" | "cancel";

export const ACTION_ACTOR: Record<PerformanceBookingAction, "artist" | "promoter" | "either"> = {
  accept: "artist",
  decline: "artist",
  fund: "promoter",
  complete: "artist",
  release: "promoter",
  cancel: "either",
};

const TRANSITIONS: Record<PerformanceBookingAction, {
  from: PerformanceBookingStatus[];
  to: PerformanceBookingStatus;
}> = {
  /* The artist agrees to the deal as proposed. Escrow stays unfunded —
   * accepting promises the show, it does not move money. */
  accept: { from: ["proposed"], to: "accepted" },
  decline: { from: ["proposed"], to: "declined" },
  /* Funding is not a status step of its own in this map: the fund
   * endpoint moves escrow unfunded → funding → funded while the
   * booking reads accepted → funded (see markPerformanceEscrowFunded).
   * The guard here is what the endpoint checks before it starts. */
  fund: { from: ["accepted"], to: "funded" },
  /* The artist marks the show done. Only a funded booking can
   * complete — an unfunded "show" has no escrow to release. */
  complete: { from: ["funded"], to: "completed" },
  /* The promoter releases the escrow. Terminal: paid. */
  release: { from: ["completed"], to: "paid" },
  /* Either side can walk away before the money is released. A funded
   * booking's cancel marks its escrow refunded (the refund itself
   * rides the payment-reversals rail, like sponsor escrow). */
  cancel: { from: ["proposed", "accepted", "funded"], to: "cancelled" },
};

export function canTakeAction(
  status: string,
  action: PerformanceBookingAction,
): { ok: true; to: PerformanceBookingStatus } | { ok: false; message: string } {
  const t = TRANSITIONS[action];
  if ((t.from as string[]).includes(status)) return { ok: true, to: t.to };
  const why: Record<PerformanceBookingAction, string> = {
    accept: "Only a booking still waiting for an answer can be accepted.",
    decline: "Only a booking still waiting for an answer can be declined.",
    fund: "The artist has to accept the booking before it can be funded.",
    complete: "The escrow has to be funded before the show can be marked complete.",
    release: "The show has to be marked complete before the fee can be released.",
    cancel: "This booking can no longer be cancelled.",
  };
  return { ok: false, message: `${why[action]} (This booking is ${status}.)` };
}

/** The escrow state a cancel leaves behind: money that never moved
 *  stays 'unfunded'; money sitting in escrow is owed back to the
 *  promoter and reads 'refunded' once marked. */
export function escrowStatusAfterCancel(escrowStatus: string): PerformanceEscrowStatus {
  return escrowStatus === "funded" || escrowStatus === "funding" ? "refunded" : "unfunded";
}

/* ═══════════════ Plain-words terms (auto-attached, #164) ════════════ */

export interface PlainWordsFacts {
  artistName: string;
  promoterName: string;
  eventTitle: string;
  /** Show instant (ISO or Date). Rendered in UTC with the weekday —
   *  the durable record's clock; each client localizes for display. */
  eventDate: string | Date;
  venueName: string;
  venueAddress: string;
  venueCity: string;
  feeCents: number;
  terms: PerformanceBookingTerms;
}

/**
 * The deal in plain words. Deterministic: same facts in, same words
 * out — the record's summary is regenerated on every terms-changing
 * write, so what either side reads always matches what was agreed.
 * No legalese: who, what, when, where, how much, where the money sits,
 * and how it moves.
 */
export function buildPlainWordsTerms(f: PlainWordsFacts): string {
  const { feeCents, netCents } = performanceFeeSplit(f.feeCents);
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(f.eventDate));
  const lines: string[] = [
    `${f.promoterName} is booking ${f.artistName} to perform at ${f.eventTitle}.`,
    `The show is on ${when} at ${f.venueName}, ${f.venueAddress}, ${f.venueCity}.`,
    `The performance: ${f.terms.performance}.`,
  ];
  if (f.terms.setLengthMin) lines.push(`The set runs about ${f.terms.setLengthMin} minutes.`);
  if (f.terms.productionNotes) lines.push(`Sound, lights, and setup: ${f.terms.productionNotes}.`);
  lines.push(
    `The fee is ${moneyCents(f.feeCents)}. ${f.promoterName} puts the full fee into escrow — a safe holding place — before the show. ` +
    `The money stays there until the show is done and ${f.promoterName} releases it. ` +
    `When it is released, ${f.artistName} receives ${moneyCents(netCents)} and Bow Down Visuals keeps ${moneyCents(feeCents)} as its fee. ` +
    `${f.promoterName} never pays more than the agreed fee.`,
  );
  if (f.terms.cancellationTerms) {
    lines.push(`If the show is cancelled: ${f.terms.cancellationTerms}.`);
  } else {
    lines.push(
      `If the show is cancelled before it happens, the full fee goes back to ${f.promoterName}.`,
    );
  }
  return lines.join("\n");
}

/* ═══════════════ Escrow funding idempotency ═════════════════════════ */

/** Deterministic Stripe idempotency key for funding one booking's
 *  escrow (the sponsors pattern): the intent is the booking + its fee,
 *  so a retried or double-tapped fund reuses the original session
 *  instead of minting a second payable one. A booking funds exactly
 *  once — its state machine refuses later attempts. */
export function buildPerformanceEscrowCheckoutKey(args: {
  promoterUserId: string;
  bookingId: string;
  feeCents: number;
}): string {
  return buildCheckoutSessionIdempotencyKey({
    memberId: args.promoterUserId,
    rail: "performance-escrow",
    purchaseIntent: { bookingId: args.bookingId, feeCents: args.feeCents },
  });
}
