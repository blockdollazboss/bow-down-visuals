import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and, desc, gt } from "drizzle-orm";
import {
  db,
  liveStreamsTable,
  liveChatMessagesTable,
  liveChatMutesTable,
  liveStreamTipsTable,
  creatorProfilesTable,
  creditUsageTable,
  type LiveStream,
  type LiveStreamTip,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  chargeCredits,
  refundCredits,
  buildChargeIdempotencyKey,
  OutOfCreditsError,
  CreditsDisabledError,
  LedgerWriteError,
} from "../lib/credits";
import { addCreditsAtomic } from "../lib/supabase-admin";
import { recordCreditUsageStrict } from "../lib/payment-record";
import {
  LIVE_TIP_MINIMUM_VB,
  LIVE_TIP_MAXIMUM_VB,
  LIVE_TIP_PIN_MINIMUM_VB,
  LIVE_TIP_PIN_DURATION_MS,
} from "../lib/live-config";
import { liveChatHub, effectiveStatus, getActivePin, chatMessageDtos } from "./live-chat";
import { awardTipPoints } from "../lib/loyalty";

/* ── Stream tips + paid pinned messages ──────────────────────────────────
   POST /live/:id/tips   (auth) tip the stream's creator in Visual Bucs
   GET  /live/:id/tips   (public) recent tips — ticker / goal data

   A tip is a fan -> creator Visual Bucs transfer. There is no
   user-to-user transfer primitive in the house credits machinery
   (balances live in Supabase profiles; the ledger lives in Render
   Postgres — the two cannot share one transaction, exactly as
   chargeCredits documents), so the transfer is built from the house
   parts with resume-safe gates:
     1. debit the fan via chargeCredits (its own idempotency key
        makes a retry a no-op),
     2. record the tip row (UNIQUE idempotency key — second gate),
     3. credit the creator via addCreditsAtomic + a strict ledger
        row under a derived key; the tip row's creator_credited_at
        and a pre-credit ledger check make a retry resume here
        instead of paying twice.
   If the creator credit fails after the debit landed, the fan is
   refunded via refundCredits and the tip answers an honest 502.

   A tip at/above LIVE_TIP_PIN_MINIMUM_VB pins its message to the top
   of chat for LIVE_TIP_PIN_DURATION_MS — the pin rides the tip, no
   separate charge. One active pin per stream: a new pin expires
   the previous one in the same write path. */

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_CHARS = 500;

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

async function getStreamRow(id: string): Promise<LiveStream | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await db.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface LiveTipDto {
  id: string;
  streamId: string;
  tipperUserId: string;
  creatorUserId: string;
  amountVb: number;
  body: string;
  messageId: string | null;
  pinnedUntil: string | null;
  createdAt: string;
  tipper: { displayName: string; avatarUrl: string | null; slug: string | null };
}

async function tipperCard(userId: string) {
  const rows = await db
    .select({
      displayName: creatorProfilesTable.displayName,
      avatarUrl: creatorProfilesTable.avatarUrl,
      slug: creatorProfilesTable.slug,
    })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  const r = rows[0];
  return r
    ? { displayName: r.displayName, avatarUrl: r.avatarUrl ?? null, slug: r.slug ?? null }
    : { displayName: "Someone", avatarUrl: null, slug: null };
}

async function toTipDto(tip: LiveStreamTip, body: string): Promise<LiveTipDto> {
  return {
    id: tip.id,
    streamId: tip.stream_id,
    tipperUserId: tip.tipper_user_id,
    creatorUserId: tip.creator_user_id,
    amountVb: tip.amount_vb,
    body,
    messageId: tip.message_id ?? null,
    pinnedUntil: tip.pinned_until ? new Date(tip.pinned_until).toISOString() : null,
    createdAt: new Date(tip.created_at).toISOString(),
    tipper: await tipperCard(tip.tipper_user_id),
  };
}

const tipBodySchema = z.object({
  amountVb: z.number(),
  body: z.string().optional(),
  idempotencyKey: z.string().min(8).max(200),
});

router.post("/live/:id/tips", requireAuth, async (req: Request, res: Response) => {
  try {
    const tipperUserId = req.userId;
    if (!tipperUserId) {
      res.status(401).json({ error: "Sign in to tip." });
      return;
    }
    const stream = await getStreamRow(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    if (effectiveStatus(stream) !== "live") {
      res.status(409).json({ error: "Tips open while the stream is live.", code: "STREAM_NOT_LIVE" });
      return;
    }
    if (stream.user_id === tipperUserId) {
      res.status(400).json({ error: "You can't tip your own stream.", code: "SELF_TIP" });
      return;
    }
    const parsed = tipBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "A tip needs an amount and a retry key.", code: "BAD_TIP" });
      return;
    }
    const amountVb = parsed.data.amountVb;
    if (!Number.isInteger(amountVb) || amountVb < LIVE_TIP_MINIMUM_VB || amountVb > LIVE_TIP_MAXIMUM_VB) {
      res.status(400).json({
        error: `Tips run ${LIVE_TIP_MINIMUM_VB}–${LIVE_TIP_MAXIMUM_VB.toLocaleString("en-US")} Visual Bucs.`,
        code: "BAD_AMOUNT",
      });
      return;
    }
    const body = (parsed.data.body ?? "").trim();
    if (body.length > MAX_BODY_CHARS) {
      res.status(400).json({ error: `Tip messages run up to ${MAX_BODY_CHARS} characters.`, code: "BAD_BODY" });
      return;
    }

    // A muted chatter can't put a message in chat — and a tip IS a
    // chat message, so the mute gates the tip before any money moves.
    const mutes = await db
      .select()
      .from(liveChatMutesTable)
      .where(and(eq(liveChatMutesTable.stream_id, stream.id), eq(liveChatMutesTable.user_id, tipperUserId)))
      .limit(1);
    if (mutes[0] && new Date(mutes[0].muted_until).getTime() > Date.now()) {
      res.status(403).json({ error: "You've been muted in this stream by the streamer.", code: "MUTED" });
      return;
    }

    const scopedKey = buildChargeIdempotencyKey("live-tip", tipperUserId, parsed.data.idempotencyKey, {
      streamId: stream.id,
      amountVb,
      body,
    });

    // Resume gate: an existing tip row for this key means a previous
    // attempt already debited (chargeCredits dedupes the debit too).
    const existingRows = await db
      .select()
      .from(liveStreamTipsTable)
      .where(eq(liveStreamTipsTable.idempotency_key, scopedKey))
      .limit(1);
    let tip = existingRows[0] ?? null;
    const isRetry = !!tip;

    if (!tip) {
      // 1) Debit the fan (idempotent on scopedKey inside chargeCredits).
      try {
        await chargeCredits(
          tipperUserId,
          amountVb,
          { action: "Live Stream Tip" },
          { personalOnly: true, idempotencyKey: scopedKey },
        );
      } catch (err) {
        if (err instanceof OutOfCreditsError) {
          res.status(402).json({
            error: "Not enough Visual Bucs for that tip — your balance hasn't changed.",
            code: "INSUFFICIENT_BALANCE",
          });
          return;
        }
        if (err instanceof CreditsDisabledError) {
          res.status(403).json({ error: "Tips aren't available on your account right now.", code: "CREDITS_DISABLED" });
          return;
        }
        if (err instanceof LedgerWriteError) {
          res.status(500).json({ error: "That tip couldn't be recorded safely, so it wasn't charged. Try again." });
          return;
        }
        throw err;
      }

      // 2) The tip's chat message + the tip row. A tip with no text
      // still lands in chat as a tip notice (its body is generated
      // from the real amount, never invented copy about the fan).
      const insertedMessage = await db
        .insert(liveChatMessagesTable)
        .values({
          stream_id: stream.id,
          user_id: tipperUserId,
          body,
          kind: "tip",
          tip_amount_vb: amountVb,
        })
        .returning();
      const messageRow = insertedMessage[0];
      const insertedTip = await db
        .insert(liveStreamTipsTable)
        .values({
          stream_id: stream.id,
          tipper_user_id: tipperUserId,
          creator_user_id: stream.user_id,
          amount_vb: amountVb,
          message_id: messageRow?.id ?? null,
          idempotency_key: scopedKey,
        })
        .returning();
      tip = insertedTip[0] ?? null;
      if (!tip) throw new Error("tip insert returned no row");
    }

    // 3) Credit the creator — once. The derived ledger key is checked
    // first so a retry after a landed credit never pays twice.
    if (!tip.creator_credited_at) {
      const creditKey = `${scopedKey}:credit`;
      const priorCredit = await db
        .select({ id: creditUsageTable.id })
        .from(creditUsageTable)
        .where(eq(creditUsageTable.idempotencyKey, creditKey))
        .limit(1)
        .catch(() => [] as Array<{ id: string }>);
      try {
        if (!priorCredit[0]) {
          await addCreditsAtomic(stream.user_id, amountVb);
          await recordCreditUsageStrict({
            userId: stream.user_id,
            action: "Live Stream Tip — Received",
            creditsUsed: -amountVb,
            idempotencyKey: creditKey,
          });
        }
      } catch (err) {
        logger.error({ err, tipId: tip.id }, "live tip: creator credit failed — refunding the fan");
        if (!isRetry) {
          await refundCredits(tipperUserId, amountVb, { action: "Live Stream Tip — Refund (credit failed)" }).catch(
            (refundErr) => logger.error({ refundErr, tipId: tip.id }, "live tip: CRITICAL refund after credit failure also failed"),
          );
        }
        res.status(502).json({
          error: isRetry
            ? "That tip is recorded but the payout step hiccuped — it will be reconciled, and you were not charged twice."
            : "That tip didn't go through — you've been refunded in full.",
          code: "CREDIT_FAILED",
        });
        return;
      }
      const credited = await db
        .update(liveStreamTipsTable)
        .set({ creator_credited_at: new Date() })
        .where(eq(liveStreamTipsTable.id, tip.id))
        .returning();
      if (credited[0]) tip = credited[0];
    }

    // 4) The pin rides the tip: at/above the minimum, this tip's
    // message pins — expiring any previous pin in the same breath.
    let pinnedUntil: Date | null = null;
    if (amountVb >= LIVE_TIP_PIN_MINIMUM_VB && tip.message_id) {
      pinnedUntil = new Date(Date.now() + LIVE_TIP_PIN_DURATION_MS);
      const now = new Date();
      const priorPins = await db
        .select()
        .from(liveStreamTipsTable)
        .where(and(eq(liveStreamTipsTable.stream_id, stream.id), gt(liveStreamTipsTable.pinned_until, now)));
      for (const prior of priorPins) {
        if (prior.id !== tip.id) {
          await db
            .update(liveStreamTipsTable)
            .set({ pinned_until: now })
            .where(eq(liveStreamTipsTable.id, prior.id));
        }
      }
      const updated = await db
        .update(liveStreamTipsTable)
        .set({ pinned_until: pinnedUntil })
        .where(eq(liveStreamTipsTable.id, tip.id))
        .returning();
      if (updated[0]) tip = updated[0];
    }

    // Loyalty (Stack 9 #6): tipping earns the channel's points.
    void awardTipPoints(tipperUserId, stream.profile_id, stream.user_id, amountVb);
    const dto = await toTipDto(tip, body);
    // The chat message body for a resumed tip comes from the row.
    if (isRetry && tip.message_id) {
      const rows = await db
        .select()
        .from(liveChatMessagesTable)
        .where(eq(liveChatMessagesTable.id, tip.message_id))
        .limit(1);
      if (rows[0]) dto.body = rows[0].body;
    }

    if (!isRetry) {
      // Chat delivery: the tip message, then the alert event the
      // studio overlay + ticker ride on, then the pin state.
      if (tip.message_id) {
        const rows = await db
          .select()
          .from(liveChatMessagesTable)
          .where(eq(liveChatMessagesTable.id, tip.message_id))
          .limit(1);
        if (rows[0]) {
          const messageDto = (await chatMessageDtos([rows[0]]))[0];
          if (messageDto) liveChatHub.broadcast(stream.id, { type: "message", message: messageDto });
        }
      }
      liveChatHub.broadcast(stream.id, { type: "tip", tip: dto });
      liveChatHub.broadcast(stream.id, {
        type: "alert",
        alert: {
          kind: "tip",
          title: `${dto.tipper.displayName} tipped ${amountVb.toLocaleString("en-US")} Visual Bucs`,
          body: dto.body,
          amountVb,
        },
      });
      if (pinnedUntil) {
        const pin = await getActivePin(stream.id).catch(() => null);
        liveChatHub.broadcast(stream.id, { type: "pin_updated", pinned: pin });
      }
    }

    res.status(isRetry ? 200 : 201).json({
      tip: dto,
      duplicate: isRetry,
      pinMinimumVb: LIVE_TIP_PIN_MINIMUM_VB,
      pinnedUntil: pinnedUntil ? pinnedUntil.toISOString() : (dto.pinnedUntil ?? null),
    });
  } catch (err) {
    logger.error({ err }, "live tip failed");
    res.status(500).json({ error: "That tip didn't go through. Try again." });
  }
});

router.get("/live/:id/tips", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const stream = await getStreamRow(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    const rows = await db
      .select()
      .from(liveStreamTipsTable)
      .where(eq(liveStreamTipsTable.stream_id, stream.id))
      .orderBy(desc(liveStreamTipsTable.created_at))
      .limit(20);
    const bodies = new Map<string, string>();
    for (const tip of rows) {
      if (!tip.message_id) continue;
      const msgs = await db
        .select()
        .from(liveChatMessagesTable)
        .where(eq(liveChatMessagesTable.id, tip.message_id))
        .limit(1);
      if (msgs[0]) bodies.set(tip.id, msgs[0].body);
    }
    const tips = await Promise.all(rows.map((t) => toTipDto(t, bodies.get(t.id) ?? "")));
    const totalVb = rows.reduce((sum, t) => sum + (t.amount_vb ?? 0), 0);
    res.json({ streamId: stream.id, tips, totalVb, pinMinimumVb: LIVE_TIP_PIN_MINIMUM_VB });
  } catch (err) {
    logger.error({ err }, "live tips list failed");
    res.status(500).json({ error: "Tips couldn't load. Try again in a moment." });
  }
});

export default router;
