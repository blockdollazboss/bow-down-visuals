import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, and, count } from "drizzle-orm";
import {
  db,
  liveStreamTicketsTable,
  creditUsageTable,
  notificationsTable,
  type LiveStream,
  type LiveStreamTicket,
} from "@workspace/db";
import {
  chargeCredits,
  refundCredits,
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
  OutOfCreditsError,
  CreditsDisabledError,
  LedgerWriteError,
} from "./credits";
import { addCreditsAtomic } from "./supabase-admin";
import { recordCreditUsageStrict } from "./payment-record";
import { feeSplit } from "./platform-fees";
import { isChannelModerator } from "./live-moderators";
import { logger } from "./logger";

/* ── Ticketed live — pay-per-view doors on Go Live (Wave 4 #31) ─────────
   A creator sets a ticket price (Visual Bucs) + optional seat capacity
   at Go Live setup; the values ride the stream row (migration 0231).
   Entry to a ticketed stream — watch feed, HLS media plane, viewer
   heartbeat, chat room, tips — is granted by ONE predicate,
   canEnterStream, consulted by every entry surface:

     free stream (no price)  → everyone, guests included (as before)
     stream owner            → always
     appointed channel mod   → always (the creator's staff work the room)
     active ticket holder    → always
     anyone else             → the door: public preview + the price,
                               never the feed, the room, or presence.

   A purchase is a fan -> creator Visual Bucs transfer built from the
   same house parts as stream tips (routes/live-tips.ts), because the
   money lives in two stores that cannot share one transaction
   (Supabase profile balances vs the Postgres ledger):

     1. debit the fan via chargeCredits under an INTENT-DERIVED
        idempotency key (see buyStreamTicket — a ticket is a singleton
        purchase, so every retry of it is the same purchase),
     2. record the ticket row (UNIQUE idempotency key + UNIQUE
        (stream, buyer) — the second and third exactly-once gates),
     3. credit the creator the NET via addCreditsAtomic + a strict
        ledger row under a derived key; the row's creator_credited_at
        makes a retry resume here instead of paying twice.

   The split runs through lib/platform-fees feeSplit at
   PLATFORM_FEE_BPS (flat 5% — the fee module whose header names
   tickets as a surface it owns; the same 5% Paid Series and live
   shopping charge). No new fee constant exists for this feature.

   Failure posture mirrors tips exactly: anything that fails after the
   debit compensates (reverse a landed credit, refund the fan, void
   the debit key, drop the row) and answers honestly; a compensation
   that itself fails is logged CRITICAL for reconciliation — never
   dressed up as success. */

/** The slice of a stream row the door logic reads. */
export type TicketDoorStream = Pick<
  LiveStream,
  "id" | "user_id" | "profile_id" | "title" | "ticket_price_vb" | "ticket_capacity"
>;

/** A stream is ticketed when it carries a real price. 0/NULL = free. */
export function isTicketed(stream: Pick<LiveStream, "ticket_price_vb">): boolean {
  return typeof stream.ticket_price_vb === "number" && stream.ticket_price_vb > 0;
}

/** Public door facts for DTOs: the price is public, the seat count is
 *  public (an event would print both); playback never rides along. */
export interface TicketDoorInfo {
  price_vb: number;
  capacity: number | null;
  sold: number;
  seats_left: number | null;
}

export function ticketDoorInfo(stream: TicketDoorStream, sold: number): TicketDoorInfo | null {
  if (!isTicketed(stream)) return null;
  const capacity = stream.ticket_capacity ?? null;
  return {
    price_vb: stream.ticket_price_vb!,
    capacity,
    sold,
    seats_left: capacity === null ? null : Math.max(0, capacity - sold),
  };
}

/** The fan's active ticket for a stream, if they hold one. */
export async function getActiveTicket(streamId: string, userId: string): Promise<LiveStreamTicket | null> {
  const rows = await db
    .select()
    .from(liveStreamTicketsTable)
    .where(
      and(
        eq(liveStreamTicketsTable.stream_id, streamId),
        eq(liveStreamTicketsTable.buyer_user_id, userId),
        eq(liveStreamTicketsTable.status, "active"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function countActiveTickets(streamId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(liveStreamTicketsTable)
    .where(
      and(eq(liveStreamTicketsTable.stream_id, streamId), eq(liveStreamTicketsTable.status, "active")),
    );
  return rows[0]?.n ?? 0;
}

/**
 * THE door predicate. Every entry surface (watch DTO, HLS plane,
 * heartbeat, chat REST + WS, tips, the World screen) consults this —
 * there is no second opinion anywhere in the codebase.
 */
export async function canEnterStream(stream: TicketDoorStream, userId: string | null): Promise<boolean> {
  if (!isTicketed(stream)) return true;
  if (!userId) return false;
  if (stream.user_id === userId) return true;
  if (await getActiveTicket(stream.id, userId)) return true;
  return isChannelModerator(stream.profile_id, userId);
}

/* ── Playback tokens ─────────────────────────────────────────────────────
   The own-server HLS plane is a plain file server (playlist + segment
   GETs, no auth headers — hls.js and native players can't send the
   session token). For ticketed streams the watch DTO therefore hands
   an entitled viewer a signed playback token, the HLS route requires
   it on every file, and the playlist is served with the token carried
   into its segment lines so the gate holds past the playlist. The
   token is HMAC-signed over (stream, user, expiry) — it proves an
   entitled user was issued entry; it is not a session and grants
   nothing else. Fail closed: with no server secret configured, no
   token can be minted or verified. */

const PLAYBACK_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

function playbackSecret(): string {
  return process.env["LIVE_PLAYBACK_SECRET"] || process.env["SUPABASE_SERVICE_ROLE_KEY"] || "";
}

export function mintPlaybackToken(streamId: string, userId: string, now: number = Date.now()): string | null {
  const secret = playbackSecret();
  if (!secret) return null;
  const payload = `${streamId}.${userId}.${now + PLAYBACK_TOKEN_TTL_MS}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

/** Returns the userId the token was minted for, or null. */
export function verifyPlaybackToken(streamId: string, token: string | null | undefined, now: number = Date.now()): string | null {
  const secret = playbackSecret();
  if (!secret || !token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  let payload: string;
  try {
    payload = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const given = token.slice(dot + 1);
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [tokenStreamId, userId, expRaw] = payload.split(".");
  if (tokenStreamId !== streamId || !userId) return null;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= now) return null;
  return userId;
}

/* ── The purchase ──────────────────────────────────────────────────────── */

export type BuyTicketResult =
  | { ok: true; ticket: LiveStreamTicket; alreadyHad: boolean }
  | { ok: false; status: number; code: string; error: string };

/** True when a strict ledger row already carries this key — the
 *  resume marker every money step below is gated on. A failed read
 *  answers "absent" (the caller's compensation posture covers the
 *  rest), exactly as the tips credit step treats its own check. */
async function ledgerKeyExists(key: string): Promise<boolean> {
  const rows = await db
    .select({ id: creditUsageTable.id })
    .from(creditUsageTable)
    .where(eq(creditUsageTable.idempotencyKey, key))
    .limit(1)
    .catch(() => [] as Array<{ id: string }>);
  return !!rows[0];
}

type DebitOutcome = { ok: true } | { ok: false; failure: BuyTicketResult & { ok: false } };

/** The fan debit, with the credits rail's typed failures mapped to
 *  the route's honest answers. chargeCredits dedupes on the key
 *  itself, so calling this on a resumed purchase is safe. */
async function debitFan(buyerUserId: string, priceVb: number, scopedKey: string): Promise<DebitOutcome> {
  try {
    await chargeCredits(
      buyerUserId,
      priceVb,
      { action: "Live Stream Ticket" },
      { personalOnly: true, idempotencyKey: scopedKey },
    );
    return { ok: true };
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return {
        ok: false,
        failure: {
          ok: false,
          status: 402,
          code: "INSUFFICIENT_BALANCE",
          error: "Not enough Visual Bucs for that ticket — your balance hasn't changed.",
        },
      };
    }
    if (err instanceof CreditsDisabledError) {
      return {
        ok: false,
        failure: { ok: false, status: 403, code: "CREDITS_DISABLED", error: "Tickets aren't available on your account right now." },
      };
    }
    if (err instanceof LedgerWriteError) {
      return {
        ok: false,
        failure: {
          ok: false,
          status: 500,
          code: "LEDGER_FAILED",
          error: "That purchase couldn't be recorded safely, so it wasn't charged. Try again.",
        },
      };
    }
    throw err;
  }
}

/**
 * Buy a fan's ticket to a ticketed stream. Caller (the route) has
 * already established: the stream exists, is live, and is ticketed.
 *
 * The charge key is DERIVED from the purchase intent (stream + price),
 * never from a client-supplied key: a ticket is a singleton — one fan,
 * one show, one seat — so any retry, double-tap, or fresh-key second
 * attempt IS the same purchase and must land on the same key. (The
 * derived-key trade-off buildChargeIdempotencyKey documents — an
 * identical re-run is the same purchase — is exactly right here.)
 *
 * Purchase shapes, told apart by the fan's existing row:
 *   - active + credited      → already bought; charge nothing.
 *   - active + not credited  → a crashed attempt: the debit landed
 *     (chargeCredits would dedupe it anyway); resume at the credit
 *     step with retry semantics.
 *   - refunded               → a fresh purchase reviving the row: the
 *     refund voided the old debit key, so the debit charges again;
 *     the row flips back to active and the credit step runs fresh.
 *   - no row                 → debit, insert, credit.
 */
export async function buyStreamTicket(input: {
  stream: TicketDoorStream & { status: string };
  buyerUserId: string;
  buyerDisplayName?: string | null;
}): Promise<BuyTicketResult> {
  const { stream, buyerUserId } = input;
  const priceVb = stream.ticket_price_vb!;
  const split = feeSplit(priceVb);

  if (stream.user_id === buyerUserId) {
    return {
      ok: false,
      status: 400,
      code: "OWN_STREAM",
      error: "This is your stream — you're already inside, no ticket needed.",
    };
  }

  const priorRows = await db
    .select()
    .from(liveStreamTicketsTable)
    .where(
      and(eq(liveStreamTicketsTable.stream_id, stream.id), eq(liveStreamTicketsTable.buyer_user_id, buyerUserId)),
    )
    .limit(1);
  const prior = priorRows[0] ?? null;

  if (prior && prior.status === "active" && prior.creator_credited_at) {
    return { ok: true, ticket: prior, alreadyHad: true };
  }

  const scopedKey = buildChargeIdempotencyKey("live-ticket", buyerUserId, null, {
    streamId: stream.id,
    priceVb,
  });
  /* A revival is a NEW purchase of the same seat: its key derives
     from the refund it follows, so its debit and its creator credit
     land under fresh keys — the refunded cycle's ledger rows (the
     original credit included) are never mistaken for this cycle's.
     refundStreamTicket reads the row's CURRENT key, so each cycle's
     unwind targets its own rows. */
  const purchaseKey =
    prior && prior.status === "refunded"
      ? buildChargeIdempotencyKey("live-ticket", buyerUserId, null, {
          streamId: stream.id,
          priceVb,
          revivalOf: prior.id,
          refundedAt: prior.refunded_at ? new Date(prior.refunded_at).toISOString() : null,
        })
      : scopedKey;

  let ticket: LiveStreamTicket | null = null;
  /* How a credit-step failure is compensated:
       "fresh"  — this call took the fan's money: refund them in full
                  and put the row back the way the call found it
                  (deleted for a new purchase, re-refunded for a
                  revival), then void the debit key.
       "resume" — the money moved in an EARLIER attempt: never refund
                  or delete here (the tips posture); the ticket stands
                  recorded and the credit reconciles on a later retry. */
  let failureMode: "fresh" | "resume" = "fresh";

  if (prior && prior.status === "active") {
    // Crashed attempt: row + debit exist; only the credit is owed.
    ticket = prior;
    failureMode = "resume";
  } else {
    // Capacity is counted before any money moves — and a revival does
    // not consume a new seat read: the row's seat was already counted
    // when active, and while refunded it isn't, so a revival into a
    // since-sold-out show is refused like any new purchase.
    // Two buyers racing the last seat can both pass this read (the
    // money flow spans two stores and cannot hold a lock across it) —
    // the same accepted posture as tips' resume gates: the overshoot
    // is bounded by genuinely simultaneous purchases and the creator
    // sees the true sold count on the buyer list.
    if (stream.ticket_capacity !== null && stream.ticket_capacity !== undefined) {
      const sold = await countActiveTickets(stream.id);
      if (sold >= stream.ticket_capacity) {
        return {
          ok: false,
          status: 409,
          code: "SOLD_OUT",
          error: "This show is sold out — every seat is taken.",
        };
      }
    }

    const debit = await debitFan(buyerUserId, priceVb, purchaseKey);
    if (!debit.ok) return debit.failure;

    if (prior && prior.status === "refunded") {
      // Revival: flip the row back to active with this purchase's
      // amounts; the credit step below runs with creator_credited_at
      // cleared, so the creator is paid for the new sale.
      const revived = await db
        .update(liveStreamTicketsTable)
        .set({
          status: "active",
          price_vb: priceVb,
          platform_fee_vb: split.fee,
          creator_net_vb: split.net,
          idempotency_key: purchaseKey,
          creator_credited_at: null,
          refunded_at: null,
        })
        .where(eq(liveStreamTicketsTable.id, prior.id))
        .returning();
      ticket = revived[0] ?? { ...prior, status: "active", creator_credited_at: null, refunded_at: null };
    } else {
      // Fresh purchase: record the ticket row. The debit has landed
      // by now — if the insert fails, refund IMMEDIATELY, void the
      // debit key, and answer honestly (the live-tips F6 discipline).
      try {
        const inserted = await db
          .insert(liveStreamTicketsTable)
          .values({
            stream_id: stream.id,
            buyer_user_id: buyerUserId,
            creator_user_id: stream.user_id,
            price_vb: priceVb,
            platform_fee_vb: split.fee,
            creator_net_vb: split.net,
            idempotency_key: purchaseKey,
          })
          .returning();
        ticket = inserted[0] ?? null;
        if (!ticket) throw new Error("ticket insert returned no row");
      } catch (insertErr) {
        logger.error({ insertErr }, "live ticket: record failed after debit — refunding the fan");
        let refundOk = false;
        try {
          await refundCredits(buyerUserId, priceVb, { action: "Live Stream Ticket — Refund (record failed)" });
          refundOk = true;
        } catch (refundErr) {
          logger.error({ refundErr }, "live ticket: CRITICAL refund after record failure also failed — manual reconciliation required");
        }
        if (refundOk) await voidChargeIdempotencyKey(purchaseKey);
        return {
          ok: false,
          status: 500,
          code: "RECORD_FAILED",
          error: refundOk
            ? "That purchase couldn't be recorded, so you've been refunded in full."
            : "That purchase couldn't be recorded and the refund didn't land either — it's been flagged for reconciliation.",
        };
      }
    }
  }

  // Credit the creator the NET — once. The derived ledger key is
  // checked first so a retry after a landed credit never pays twice.
  if (!ticket.creator_credited_at) {
    const creditKey = `${purchaseKey}:credit`;
    let creditLanded = false;
    try {
      if (!(await ledgerKeyExists(creditKey))) {
        await addCreditsAtomic(stream.user_id, split.net);
        creditLanded = true;
        await recordCreditUsageStrict({
          userId: stream.user_id,
          action: "Live Stream Ticket — Received",
          creditsUsed: -split.net,
          idempotencyKey: creditKey,
        });
      }
    } catch (err) {
      logger.error({ err, ticketId: ticket.id }, "live ticket: creator credit failed");
      if (creditLanded) {
        try {
          await addCreditsAtomic(stream.user_id, -split.net);
        } catch (revErr) {
          logger.error({ revErr, ticketId: ticket.id }, "live ticket: CRITICAL creator-credit reversal failed — duplicated value possible, manual reconciliation required");
        }
      }
      if (failureMode === "resume") {
        return {
          ok: false,
          status: 502,
          code: "CREDIT_FAILED",
          error: "That ticket is recorded but the payout step hiccuped — it will be reconciled, and you were not charged twice.",
        };
      }
      let refundOk = false;
      try {
        await refundCredits(buyerUserId, priceVb, { action: "Live Stream Ticket — Refund (credit failed)" });
        refundOk = true;
      } catch (refundErr) {
        logger.error({ refundErr, ticketId: ticket.id }, "live ticket: CRITICAL refund after credit failure also failed");
      }
      if (refundOk) {
        // Fully unwound: the row returns to the state this call found
        // it in, and the debit key is voided so a fresh retry charges
        // cleanly instead of replaying free (the F1 discipline).
        if (prior && prior.status === "refunded") {
          await db
            .update(liveStreamTicketsTable)
            .set({ status: "refunded", refunded_at: new Date(), creator_credited_at: null })
            .where(eq(liveStreamTicketsTable.id, ticket.id))
            .catch(() => {});
        } else {
          await db.delete(liveStreamTicketsTable).where(eq(liveStreamTicketsTable.id, ticket.id)).catch(() => {});
        }
        await voidChargeIdempotencyKey(purchaseKey);
      }
      return {
        ok: false,
        status: 502,
        code: "CREDIT_FAILED",
        error: refundOk
          ? "That ticket didn't go through — you've been refunded in full."
          : "That ticket didn't go through, and the refund didn't land either — it's been flagged for reconciliation. You have not been charged twice.",
      };
    }
    const credited = await db
      .update(liveStreamTicketsTable)
      .set({ creator_credited_at: new Date() })
      .where(eq(liveStreamTicketsTable.id, ticket.id))
      .returning();
    if (credited[0]) ticket = credited[0];

    // The creator's bell learns about the sale — once per purchase
    // (this block runs only while creator_credited_at was unset).
    // Best-effort, like every house notification.
    try {
      await db.insert(notificationsTable).values({
        userId: stream.user_id,
        kind: "live_ticket",
        title: `${input.buyerDisplayName?.trim() || "Someone"} bought a ticket to your stream`,
        body: `${split.net.toLocaleString("en-US")} Visual Bucs from a ${priceVb.toLocaleString("en-US")} VB ticket${stream.title ? ` to "${stream.title}"` : ""}.`,
        link: `/live/${stream.id}`,
      });
    } catch (notifyErr) {
      logger.warn({ notifyErr, ticketId: ticket.id }, "live ticket: bell notification failed (sale itself landed)");
    }
  }

  return { ok: true, ticket, alreadyHad: false };
}

/* ── The refund unwind ───────────────────────────────────────────────────
   The store's ticket kind (storefront.ts) has no refund path, and
   native streams have no cancel door (a stream is created live), so
   no public endpoint calls this in v1 — it is the tested money unwind
   the tickets table's status column exists for: the moment a cancel
   surface lands (or support needs one), the refund is THIS, never an
   improvised one. Full and total, per the board's main-risk rule:
   the fan gets every VB back; the creator returns the net they were
   credited; the platform's fee simply unwinds with the sale.
   Each money step is gated on a keyed ledger marker so a retried
   refund resumes instead of paying twice, and the original charge
   key is voided at the end so a later re-purchase charges again
   (the credits F1 discipline). */

export async function refundStreamTicket(ticket: LiveStreamTicket): Promise<LiveStreamTicket> {
  if (ticket.status === "refunded") return ticket;
  const priceVb = ticket.price_vb;
  const netVb = ticket.creator_net_vb;
  const scopedKey = ticket.idempotency_key;

  // 1) The creator returns the net — keyed ledger row first (it is
  // the resume marker), then the balance move it records.
  const reversalKey = `${scopedKey}:credit-reversal`;
  if (ticket.creator_credited_at && !(await ledgerKeyExists(reversalKey))) {
    await addCreditsAtomic(ticket.creator_user_id, -netVb);
    try {
      await recordCreditUsageStrict({
        userId: ticket.creator_user_id,
        action: "Live Stream Ticket — Refund (creator reversal)",
        creditsUsed: netVb,
        idempotencyKey: reversalKey,
      });
    } catch (err) {
      try {
        await addCreditsAtomic(ticket.creator_user_id, netVb);
      } catch (revErr) {
        logger.error({ revErr, ticketId: ticket.id }, "live ticket refund: CRITICAL creator-reversal undo failed — manual reconciliation required");
      }
      throw err;
    }
  }

  // 2) The fan is made whole: balance restored + the refund's ledger
  // entry written as ONE keyed strict row (the key is the resume
  // marker — a retry that finds it knows the refund already landed).
  // Composed from the house parts rather than refundCredits, whose
  // ledger row carries no key and so cannot be resumed safely. If
  // the ledger write fails after the balance moved, the balance move
  // is reversed before the failure surfaces (the tips F2 discipline);
  // a process crash inside the window is a reconciliation case, as
  // on every two-store rail in the house.
  const fanRefundKey = `${scopedKey}:refund-fan`;
  if (!(await ledgerKeyExists(fanRefundKey))) {
    await addCreditsAtomic(ticket.buyer_user_id, priceVb);
    try {
      await recordCreditUsageStrict({
        userId: ticket.buyer_user_id,
        action: "Live Stream Ticket — Refund",
        creditsUsed: -priceVb,
        idempotencyKey: fanRefundKey,
      });
    } catch (err) {
      try {
        await addCreditsAtomic(ticket.buyer_user_id, -priceVb);
      } catch (revErr) {
        logger.error({ revErr, ticketId: ticket.id }, "live ticket refund: CRITICAL fan-refund reversal failed — manual reconciliation required");
      }
      throw err;
    }
  }

  // 3) The row flips — entry is revoked from this moment — and the
  // original charge key is voided so a re-purchase can charge again.
  const updated = await db
    .update(liveStreamTicketsTable)
    .set({ status: "refunded", refunded_at: new Date() })
    .where(eq(liveStreamTicketsTable.id, ticket.id))
    .returning();
  await voidChargeIdempotencyKey(scopedKey);
  return updated[0] ?? { ...ticket, status: "refunded", refunded_at: new Date() };
}

/** Buyer list rows for the owner's door view (newest first). */
export async function listStreamTickets(streamId: string): Promise<LiveStreamTicket[]> {
  const rows = await db
    .select()
    .from(liveStreamTicketsTable)
    .where(eq(liveStreamTicketsTable.stream_id, streamId));
  return rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}
