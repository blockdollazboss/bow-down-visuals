import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  priorityDmSettingsTable,
  priorityDmsTable,
  conversationsTable,
  messagesTable,
} from "@workspace/db";
import { eq, and, desc, gte, asc } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, CreditsDisabledError, LedgerWriteError } from "../lib/credits";
import { addCreditsToProfile } from "../lib/supabase-admin";
import { recordCreditUsageStrict } from "../lib/payment-record";
import { notifyUserEvent } from "../lib/push-events";
import { logger } from "../lib/logger";
import {
  isPriorityDmPlatformEnabled,
  evaluateSellable,
  validateSettingsUpdate,
  sendPriorityDm,
  settlePriorityDms,
  priorityDmPriceVb,
  type PriorityDmDeps,
  type PriorityDmRow,
  type PriorityDmSettingsLike,
} from "../lib/priority-dms";

/**
 * Paid Priority DMs (Wave-4 #44) — routes. Mounted under /api:
 *   GET  /priority-dms/status?creator=<user_id>  fan-facing availability
 *   GET  /priority-dms/my-settings              my creator controls
 *   PUT  /priority-dms/my-settings              set opt-in / my price / my window
 *   POST /priority-dms/send                     buy + deliver one priority DM
 *   GET  /priority-dms/inbox                    my priority lane (as creator)
 *   GET  /priority-dms/mine                     my sent priority DMs (as fan)
 *   POST /priority-dms/settle                   settle my held rows now
 *
 * PRICE + GATE — OWNER RULED 2026-10-27: the gate is OPEN (the
 * PRIORITY_DM_ENABLED env flag remains only as an ops kill switch —
 * exactly "false" closes it) and the price is the platform's ruled
 * 100 VB per priority message, charged and displayed. While the kill
 * switch is off, status says so plainly, no price is exposed as
 * purchasable, and send refuses before any charge. Normal DMs
 * (routes/community.ts) are completely untouched by this file.
 *
 * Money: TEST MODE Visual Bucs on the existing rails only —
 * chargeCredits (personal balance, idempotency-keyed) holds the escrow,
 * refundCredits returns it, and a reply payout lands as a strict
 * negative ledger row via addCreditsToProfile + recordCreditUsageStrict
 * (the grant pattern). Every movement is guarded by the priority_dms
 * row's conditional held -> terminal transition in lib/priority-dms.
 */

const router = Router();

function isMissingTable(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    const code = (cur as { code?: string }).code;
    if (code === "42P01" || code === "42703") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function toSettingsLike(r: typeof priorityDmSettingsTable.$inferSelect): PriorityDmSettingsLike {
  return {
    creatorUserId: r.creatorUserId,
    optedIn: r.optedIn,
    minPriceVb: r.minPriceVb ?? null,
    replyWindowHours: r.replyWindowHours,
  };
}

function toRow(r: typeof priorityDmsTable.$inferSelect): PriorityDmRow {
  return {
    id: r.id,
    conversationId: r.conversationId ?? null,
    messageId: r.messageId ?? null,
    senderUserId: r.senderUserId,
    creatorUserId: r.creatorUserId,
    amountVb: r.amountVb,
    status: r.status as PriorityDmRow["status"],
    idempotencyKey: r.idempotencyKey,
    replyDeadline: r.replyDeadline,
    repliedAt: r.repliedAt ?? null,
    settledAt: r.settledAt ?? null,
    createdAt: r.createdAt,
  };
}

function rowDto(r: PriorityDmRow) {
  return {
    id: r.id,
    conversation_id: r.conversationId,
    message_id: r.messageId,
    sender_user_id: r.senderUserId,
    creator_user_id: r.creatorUserId,
    amount_vb: r.amountVb,
    status: r.status,
    reply_deadline: r.replyDeadline,
    replied_at: r.repliedAt,
    settled_at: r.settledAt,
    created_at: r.createdAt,
  };
}

const store: PriorityDmDeps["store"] = {
  async getSettings(creatorUserId) {
    const [r] = await db.select().from(priorityDmSettingsTable)
      .where(eq(priorityDmSettingsTable.creatorUserId, creatorUserId)).limit(1);
    return r ? toSettingsLike(r) : null;
  },
  async findByIdempotencyKey(key) {
    const [r] = await db.select().from(priorityDmsTable)
      .where(eq(priorityDmsTable.idempotencyKey, key)).limit(1);
    return r ? toRow(r) : null;
  },
  async insertPriorityDm(input) {
    const [r] = await db.insert(priorityDmsTable).values(input).returning();
    return toRow(r!);
  },
  async transitionFromHeld(id, to, patch) {
    const updated = await db.update(priorityDmsTable)
      .set({ status: to, repliedAt: patch.repliedAt ?? undefined, settledAt: patch.settledAt ?? undefined })
      .where(and(eq(priorityDmsTable.id, id), eq(priorityDmsTable.status, "held")))
      .returning({ id: priorityDmsTable.id });
    return updated.length > 0;
  },
  async setDelivery(id, conversationId, messageId) {
    await db.update(priorityDmsTable)
      .set({ conversationId, messageId })
      .where(eq(priorityDmsTable.id, id));
  },
  async listHeld(filter) {
    const conds = [eq(priorityDmsTable.status, "held")];
    if (filter.creatorUserId) conds.push(eq(priorityDmsTable.creatorUserId, filter.creatorUserId));
    if (filter.senderUserId) conds.push(eq(priorityDmsTable.senderUserId, filter.senderUserId));
    const rows = await db.select().from(priorityDmsTable)
      .where(and(...conds)).orderBy(asc(priorityDmsTable.createdAt)).limit(200);
    return rows.map(toRow);
  },
  async findConversationBetween(aUserId, bUserId) {
    const [a, b] = canonicalPair(aUserId, bUserId);
    const [r] = await db.select().from(conversationsTable)
      .where(and(eq(conversationsTable.participantA, a), eq(conversationsTable.participantB, b))).limit(1);
    return r ? { id: r.id, status: r.status } : null;
  },
  async getConversationById(id) {
    const [r] = await db.select().from(conversationsTable)
      .where(eq(conversationsTable.id, id)).limit(1);
    return r ? { id: r.id, status: r.status } : null;
  },
  async getOrCreateInboxConversation(aUserId, bUserId, requestedBy) {
    const existing = await this.findConversationBetween(aUserId, bUserId);
    if (existing) return existing;
    const [a, b] = canonicalPair(aUserId, bUserId);
    const [r] = await db.insert(conversationsTable)
      .values({ participantA: a, participantB: b, status: "inbox", requestedBy })
      .returning();
    return { id: r!.id, status: r!.status };
  },
  async insertMessage(conversationId, senderUserId, body) {
    const [r] = await db.insert(messagesTable)
      .values({ conversationId, senderUserId, body }).returning();
    await db.update(conversationsTable)
      .set({ lastMessageAt: new Date() })
      .where(eq(conversationsTable.id, conversationId));
    return { id: r!.id };
  },
  async creatorReplyAt(conversationId, creatorUserId, since) {
    const [r] = await db.select({ createdAt: messagesTable.createdAt }).from(messagesTable)
      .where(and(
        eq(messagesTable.conversationId, conversationId),
        eq(messagesTable.senderUserId, creatorUserId),
        gte(messagesTable.createdAt, since),
      ))
      .orderBy(asc(messagesTable.createdAt)).limit(1);
    return r?.createdAt ?? null;
  },
};

const credits: PriorityDmDeps["credits"] = {
  async charge(userId, amountVb, idempotencyKey) {
    await chargeCredits(
      userId,
      amountVb,
      { action: "Priority DM — held" },
      { idempotencyKey, personalOnly: true },
    );
  },
  async refund(userId, amountVb, _rowId) {
    await refundCredits(userId, amountVb, { action: "Priority DM — refund" });
  },
  async payout(userId, amountVb, rowId) {
    await addCreditsToProfile(userId, amountVb);
    try {
      await recordCreditUsageStrict({
        userId,
        action: "Priority DM — reply earned",
        creditsUsed: -amountVb,
        idempotencyKey: `priority-dm:${rowId}:payout`,
      });
    } catch (err) {
      logger.error({ userId, amountVb, rowId, err },
        "[priority-dms] payout landed but its ledger write failed — balance is correct, ledger needs reconciliation");
    }
  },
};

function deps(): PriorityDmDeps {
  return {
    store,
    credits,
    platformEnabled: isPriorityDmPlatformEnabled(),
    priceVb: priorityDmPriceVb(),
    /* Push wiring #7: the real event door for the creator ping. */
    notifyEvent: (input) => notifyUserEvent(input),
  };
}

const sendSchema = z.object({
  creator_user_id: z.string().uuid(),
  body: z.string().min(1).max(2000),
  idempotency_key: z.string().max(200).optional(),
});

const settingsSchema = z.object({
  opted_in: z.boolean().optional(),
  min_price_vb: z.number().nullable().optional(),
  reply_window_hours: z.number().optional(),
});

/** Fan-facing availability for one creator. Gate-off never exposes a
 *  purchasable price — the surface explains itself honestly instead. */
router.get("/priority-dms/status", requireAuth, async (req, res) => {
  try {
    const platformEnabled = isPriorityDmPlatformEnabled();
    const creator = typeof req.query["creator"] === "string" ? req.query["creator"] : "";
    if (!platformEnabled) {
      res.json({ platform_enabled: false, available: false, reason: "gate_off" });
      return;
    }
    if (!creator) { res.status(400).json({ error: "Missing creator." }); return; }
    const settings = await store.getSettings(creator);
    const sellable = evaluateSellable(settings, true, priorityDmPriceVb());
    if (!sellable.sellable) {
      res.json({ platform_enabled: true, available: false, reason: sellable.reason });
      return;
    }
    res.json({
      platform_enabled: true,
      available: true,
      price_vb: sellable.priceVb,
      reply_window_hours: sellable.replyWindowHours,
    });
  } catch (err) {
    if (isMissingTable(err)) { res.json({ platform_enabled: isPriorityDmPlatformEnabled(), available: false, reason: "not_ready" }); return; }
    console.error("[priority-dms] GET /status failed", err);
    res.status(500).json({ error: "Couldn't check priority DMs — try again." });
  }
});

/** My creator controls: current state, gate included. `price_vb` is
 *  the platform's ruled per-message price (100 VB) — what fans pay;
 *  my legacy stated price stays visible to ME as a stored setting,
 *  never as the purchasable price. */
router.get("/priority-dms/my-settings", requireAuth, async (req, res) => {
  try {
    const settings = await store.getSettings(req.userId!);
    res.json({
      platform_enabled: isPriorityDmPlatformEnabled(),
      opted_in: settings?.optedIn ?? false,
      min_price_vb: settings?.minPriceVb ?? null,
      price_vb: priorityDmPriceVb(),
      reply_window_hours: settings?.replyWindowHours ?? 48,
    });
  } catch (err) {
    if (isMissingTable(err)) {
      res.json({ platform_enabled: isPriorityDmPlatformEnabled(), opted_in: false, min_price_vb: null, price_vb: priorityDmPriceVb(), reply_window_hours: 48, not_ready: true });
      return;
    }
    console.error("[priority-dms] GET /my-settings failed", err);
    res.status(500).json({ error: "Couldn't load your priority DM settings — try again." });
  }
});

router.put("/priority-dms/my-settings", requireAuth, async (req, res) => {
  try {
    const input = settingsSchema.parse(req.body ?? {});
    const current = await store.getSettings(req.userId!);
    const out = validateSettingsUpdate(current, input);
    if (!out.ok) { res.status(400).json({ error: out.message }); return; }
    await db.insert(priorityDmSettingsTable)
      .values({
        creatorUserId: req.userId!,
        optedIn: out.settings.optedIn,
        minPriceVb: out.settings.minPriceVb,
        replyWindowHours: out.settings.replyWindowHours,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: priorityDmSettingsTable.creatorUserId,
        set: {
          optedIn: out.settings.optedIn,
          minPriceVb: out.settings.minPriceVb,
          replyWindowHours: out.settings.replyWindowHours,
          updatedAt: new Date(),
        },
      });
    res.json({
      platform_enabled: isPriorityDmPlatformEnabled(),
      opted_in: out.settings.optedIn,
      min_price_vb: out.settings.minPriceVb,
      price_vb: priorityDmPriceVb(),
      reply_window_hours: out.settings.replyWindowHours,
    });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: "Invalid settings." }); return; }
    if (isMissingTable(err)) { res.status(503).json({ error: "Priority DMs aren't ready yet — try again soon." }); return; }
    console.error("[priority-dms] PUT /my-settings failed", err);
    res.status(500).json({ error: "Couldn't save your priority DM settings — try again." });
  }
});

/** Buy + deliver one priority DM. Exactly-once per intent key. */
router.post("/priority-dms/send", requireAuth, async (req, res) => {
  try {
    const { creator_user_id, body, idempotency_key } = sendSchema.parse(req.body ?? {});
    const out = await sendPriorityDm(deps(), {
      senderUserId: req.userId!,
      creatorUserId: creator_user_id,
      body,
      clientKey: idempotency_key,
    });
    switch (out.kind) {
      case "gate_off":
        res.status(403).json({ error: "priority_dm_unavailable", platform_enabled: false, message: "Priority DMs aren't available yet." });
        return;
      case "invalid":
        res.status(400).json({ error: out.message });
        return;
      case "not_available":
        res.status(409).json({ error: "priority_dm_not_available", reason: out.reason, message: "This creator isn't taking priority DMs right now. A normal message is free." });
        return;
      case "blocked":
        res.status(403).json({ error: "This conversation is blocked — no charge was made." });
        return;
      case "duplicate":
        res.status(200).json({ duplicate: true, priority_dm: rowDto(out.row) });
        return;
      case "refunded_blocked":
        res.status(409).json({ error: "priority_dm_refunded_blocked", message: "That conversation is blocked, so your priority DM wasn't delivered — your Visual Bucs were refunded in full.", priority_dm: rowDto(out.row) });
        return;
      case "sent":
        res.status(201).json({ priority_dm: rowDto(out.row) });
        return;
    }
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: "Invalid priority DM." }); return; }
    if (err instanceof OutOfCreditsError) { res.status(402).json({ error: "out_of_credits" }); return; }
    if (err instanceof CreditsDisabledError) { res.status(403).json({ error: "credits_disabled" }); return; }
    if (err instanceof LedgerWriteError) { res.status(500).json({ error: "ledger_write_failed" }); return; }
    if (isMissingTable(err)) { res.status(503).json({ error: "Priority DMs aren't ready yet — try again soon." }); return; }
    console.error("[priority-dms] POST /send failed", err);
    res.status(500).json({ error: "Couldn't send your priority DM — try again. You were not charged twice; a retry with the same tap is safe." });
  }
});

/** My priority lane as a creator. Reading it settles my held rows
 *  first (reply payouts, expiry + block refunds), so what I see is
 *  already honest. */
router.get("/priority-dms/inbox", requireAuth, async (req, res) => {
  try {
    await settlePriorityDms(deps(), { creatorUserId: req.userId! });
    const rows = await db.select().from(priorityDmsTable)
      .where(eq(priorityDmsTable.creatorUserId, req.userId!))
      .orderBy(desc(priorityDmsTable.createdAt)).limit(50);
    res.json({ platform_enabled: isPriorityDmPlatformEnabled(), priority: rows.map((r) => rowDto(toRow(r))) });
  } catch (err) {
    if (isMissingTable(err)) { res.json({ platform_enabled: isPriorityDmPlatformEnabled(), priority: [] }); return; }
    console.error("[priority-dms] GET /inbox failed", err);
    res.status(500).json({ error: "Couldn't load your priority inbox — try again." });
  }
});

/** My sent priority DMs as a fan (held / replied / refunded, stated). */
router.get("/priority-dms/mine", requireAuth, async (req, res) => {
  try {
    await settlePriorityDms(deps(), { senderUserId: req.userId! });
    const rows = await db.select().from(priorityDmsTable)
      .where(eq(priorityDmsTable.senderUserId, req.userId!))
      .orderBy(desc(priorityDmsTable.createdAt)).limit(50);
    res.json({ platform_enabled: isPriorityDmPlatformEnabled(), priority: rows.map((r) => rowDto(toRow(r))) });
  } catch (err) {
    if (isMissingTable(err)) { res.json({ platform_enabled: isPriorityDmPlatformEnabled(), priority: [] }); return; }
    console.error("[priority-dms] GET /mine failed", err);
    res.status(500).json({ error: "Couldn't load your priority DMs — try again." });
  }
});

/** Settle my held rows (both directions) right now. */
router.post("/priority-dms/settle", requireAuth, async (req, res) => {
  try {
    const asCreator = await settlePriorityDms(deps(), { creatorUserId: req.userId! });
    const asSender = await settlePriorityDms(deps(), { senderUserId: req.userId! });
    res.json({
      replied: asCreator.replied + asSender.replied,
      refunded_expired: asCreator.refundedExpired + asSender.refundedExpired,
      refunded_blocked: asCreator.refundedBlocked + asSender.refundedBlocked,
      still_held: asCreator.stillHeld + asSender.stillHeld,
    });
  } catch (err) {
    if (isMissingTable(err)) { res.json({ replied: 0, refunded_expired: 0, refunded_blocked: 0, still_held: 0 }); return; }
    console.error("[priority-dms] POST /settle failed", err);
    res.status(500).json({ error: "Couldn't settle priority DMs — try again." });
  }
});

export default router;
