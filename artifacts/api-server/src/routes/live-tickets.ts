import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  liveStreamsTable,
  creatorProfilesTable,
  type LiveStream,
  type LiveStreamTicket,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";
import {
  isTicketed,
  ticketDoorInfo,
  countActiveTickets,
  getActiveTicket,
  buyStreamTicket,
  listStreamTickets,
} from "../lib/live-tickets";
import { effectiveStatus } from "./live-chat";

/* ── Ticketed live — the door endpoints (Wave 4 #31) ─────────────────────
   POST /live-streams/:id/ticket   (auth)  buy my ticket (exactly once)
   GET  /live-streams/:id/ticket   (auth)  my ticket state for this show
   GET  /live-streams/:id/tickets  (auth, owner) buyer list + door totals

   All money movement lives in lib/live-tickets.ts (the purchase is a
   fan -> creator VB transfer on the credits rails, split through
   lib/platform-fees at the flat 5% PLATFORM_FEE_BPS). These handlers
   own only the HTTP shape: who may call, what the stream's state
   allows, and the door facts every surface renders. Entry itself is
   enforced at the entry surfaces (watch DTO, HLS plane, heartbeat,
   chat, tips) through the same lib's canEnterStream — buying here is
   the only way in, and there is no second door. */

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

async function getStreamRow(id: string): Promise<LiveStream | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await db.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, id)).limit(1);
  return rows[0] ?? null;
}

/** The buyer's public card for the sale notification — the same
 *  profile-card read the tips rail makes (a fan without a creator
 *  profile reads as "Someone", never as an invented name). */
async function buyerDisplayName(userId: string): Promise<string | null> {
  const rows = await db
    .select({ displayName: creatorProfilesTable.displayName })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  return rows[0]?.displayName ?? null;
}

async function buyerCards(userIds: string[]) {
  const out = new Map<string, { display_name: string; avatar_url: string | null; slug: string | null }>();
  const uniq = [...new Set(userIds.filter(Boolean))];
  if (!uniq.length) return out;
  const rows = await db
    .select({
      userId: creatorProfilesTable.userId,
      displayName: creatorProfilesTable.displayName,
      avatarUrl: creatorProfilesTable.avatarUrl,
      slug: creatorProfilesTable.slug,
    })
    .from(creatorProfilesTable)
    .where(inArray(creatorProfilesTable.userId, uniq));
  for (const r of rows) {
    out.set(r.userId, { display_name: r.displayName, avatar_url: r.avatarUrl ?? null, slug: r.slug ?? null });
  }
  return out;
}

function ticketDto(t: LiveStreamTicket) {
  return {
    id: t.id,
    stream_id: t.stream_id,
    buyer_user_id: t.buyer_user_id,
    price_vb: t.price_vb,
    platform_fee_vb: t.platform_fee_vb,
    creator_net_vb: t.creator_net_vb,
    status: t.status,
    created_at: new Date(t.created_at).toISOString(),
  };
}

const buyBodySchema = z.object({
  /* Accepted for API coherence with the other VB rails. The ticket
     rail derives its charge key from the purchase intent itself (a
     ticket is a singleton — see lib/live-tickets), so a client key
     is neither required nor able to split one purchase into two. */
  idempotencyKey: z.string().min(8).max(200).optional(),
});

router.post("/live-streams/:id/ticket", requireAuth, async (req: Request, res: Response) => {
  try {
    const buyerUserId = req.userId;
    if (!buyerUserId) {
      res.status(401).json({ error: "Sign in to buy a ticket." });
      return;
    }
    const stream = await getStreamRow(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    if (!isTicketed(stream)) {
      res.status(400).json({ error: "This stream is free — just walk in.", code: "NOT_TICKETED" });
      return;
    }
    if (stream.user_id === buyerUserId) {
      res.status(400).json({ error: "This is your stream — you're already inside, no ticket needed.", code: "OWN_STREAM" });
      return;
    }
    if (effectiveStatus(stream) !== "live") {
      res.status(409).json({ error: "Tickets are on sale while the show is live.", code: "STREAM_NOT_LIVE" });
      return;
    }
    if (!buyBodySchema.safeParse(req.body ?? {}).success) {
      res.status(400).json({ error: "That purchase couldn't be read.", code: "BAD_BODY" });
      return;
    }
    const result = await buyStreamTicket({
      stream,
      buyerUserId,
      buyerDisplayName: await buyerDisplayName(buyerUserId).catch(() => null),
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error, code: result.code });
      return;
    }
    const sold = await countActiveTickets(stream.id);
    res.status(result.alreadyHad ? 200 : 201).json({
      ticket: ticketDto(result.ticket),
      already_had: result.alreadyHad,
      door: ticketDoorInfo(stream, sold),
    });
  } catch (err) {
    logger.error({ err }, "live ticket purchase failed");
    res.status(500).json({ error: "That purchase didn't go through. Try again." });
  }
});

router.get("/live-streams/:id/ticket", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Sign in to see your ticket." });
      return;
    }
    const stream = await getStreamRow(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    const [ticket, sold] = await Promise.all([
      getActiveTicket(stream.id, userId),
      countActiveTickets(stream.id),
    ]);
    res.json({
      ticketed: isTicketed(stream),
      has_ticket: !!ticket || stream.user_id === userId,
      ticket: ticket ? ticketDto(ticket) : null,
      door: ticketDoorInfo(stream, sold),
    });
  } catch (err) {
    logger.error({ err }, "live ticket state failed");
    res.status(500).json({ error: "Could not load your ticket state." });
  }
});

router.get("/live-streams/:id/tickets", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Sign in to see your buyer list." });
      return;
    }
    const stream = await getStreamRow(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    if (stream.user_id !== userId) {
      res.status(403).json({ error: "The buyer list belongs to the streamer." });
      return;
    }
    const rows = await listStreamTickets(stream.id);
    const cards = await buyerCards(rows.map((r) => r.buyer_user_id));
    const active = rows.filter((r) => r.status === "active");
    res.json({
      buyers: rows.map((r) => ({
        ...ticketDto(r),
        buyer: cards.get(r.buyer_user_id) ?? { display_name: "Someone", avatar_url: null, slug: null },
      })),
      sold: active.length,
      gross_vb: active.reduce((sum, r) => sum + r.price_vb, 0),
      platform_fee_vb: active.reduce((sum, r) => sum + r.platform_fee_vb, 0),
      creator_net_vb: active.reduce((sum, r) => sum + r.creator_net_vb, 0),
      door: ticketDoorInfo(stream, active.length),
    });
  } catch (err) {
    logger.error({ err }, "live ticket buyer list failed");
    res.status(500).json({ error: "Could not load the buyer list." });
  }
});

export default router;
