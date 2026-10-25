import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and, asc, desc, gt, isNull, inArray } from "drizzle-orm";
import {
  db,
  liveStreamsTable,
  liveChatMessagesTable,
  liveChatMutesTable,
  liveStreamTipsTable,
  creatorProfilesTable,
  type LiveStream,
  type LiveChatMessage,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { RoomHub, verifyAccessToken, type LiveWsGateway, type WsClientSocket } from "../lib/live-ws";
import { getModeratorIds, chatRoleFor } from "../lib/live-moderators";
import { isTicketed, canEnterStream, ticketDoorInfo, countActiveTickets } from "../lib/live-tickets";
import { sweepIfLarge } from "../lib/sweep-map";
import { awardChatPoints } from "../lib/loyalty";
import { chatAutomodRulesTable, chatModActionsTable } from "@workspace/db";
import { evaluateAutomod } from "../lib/automod";

/** Stack 10 #4: record a moderation action in the unified console log.
 *  Best-effort by design — logging must never fail the action itself. */
export async function logModAction(entry: { profileId: string; streamId: string; actorUserId: string | null; targetUserId: string | null; action: string; reason: string; rule?: string | null; messageBody?: string | null }): Promise<void> {
  try {
    await db.insert(chatModActionsTable).values({
      profile_id: entry.profileId, stream_id: entry.streamId, actor_user_id: entry.actorUserId,
      target_user_id: entry.targetUserId, action: entry.action, reason: entry.reason,
      rule: entry.rule ?? null, message_body: entry.messageBody ?? null,
    });
  } catch { /* console log is additive; the action already happened */ }
}

/* ── Live stream chat ────────────────────────────────────────────────────
   Chat for native broadcasts (live_streams, migration 0129; chat rows
   in migration 0130). One shared panel serves the watch page and the
   studio; this router is its whole backend:

   GET    /live/:id/chat                (public) history + catch-up (?after=<messageId>)
   POST   /live/:id/chat                (auth)   post — live only, ~1 per 1.5s, mute-enforced
   DELETE /live/:id/chat/:messageId     (auth)   author or stream owner
   POST   /live/:id/chat/mute           (auth, owner) mute a chatter for this stream
   DELETE /live/:id/chat/mute/:userId   (auth, owner) unmute
   WS     /live/:id/chat/ws?token=…     (session token) live delivery room

   Writes go through POST (one write path: validation, rate limit and
   moderation all live here); the socket is delivery only — a posted
   message is broadcast to the stream's room after it is stored.
   Clients whose socket fails fall back to polling GET ?after=….
   Deleted messages are soft-deleted with the body cleared and are
   never served again; live clients get a message_deleted event so
   the row disappears in place. No presence counts are exposed —
   nothing here pretends to know who is "in" the chat. */

const router = Router();

const MAX_LIVE_MS = 12 * 60 * 60 * 1000; // matches live-streams' lifecycle cap
const HISTORY_LIMIT = 100;
const MAX_BODY_CHARS = 500;
const POST_INTERVAL_MS = 1500;
const MUTE_MS = MAX_LIVE_MS; // a mute lasts the rest of the stream (streams cap at 12h)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sockets subscribed to each stream's chat, keyed by stream id. */
export const liveChatHub = new RoomHub();

/* Per-user-per-stream post pacing (in-memory; single instance). */
const lastPostAt = new Map<string, number>();
export function __resetChatRateLimit(): void {
  lastPostAt.clear();
}

/* ------------------------------------------------------------ helpers */

/** Express 5 types route params as string | string[]; ours are single. */
function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

async function getStreamRow(id: string): Promise<LiveStream | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await db.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, id)).limit(1);
  return rows[0] ?? null;
}

/* ── Ticketed live door (Wave 4 #31) ─────────────────────────────────────
   The chat room is inside the ticket door: history, posting, and the
   delivery socket all consult the one predicate (lib/live-tickets
   canEnterStream — owner, appointed moderators, and ticket holders
   enter; everyone else gets the door facts and nothing of the room).
   A guest's history read is refused too — chat content is part of
   the show they haven't bought. */
async function optionalViewerId(req: Request): Promise<string | null> {
  const header = req.headers["authorization"];
  if (!header?.startsWith("Bearer ")) return null;
  const verified = await verifyAccessToken(header.slice(7)).catch(() => null);
  return verified?.userId ?? null;
}

async function ticketRequiredBody(stream: LiveStream) {
  return {
    error: "This show is ticketed — your ticket opens the chat.",
    code: "TICKET_REQUIRED",
    ticket: ticketDoorInfo(stream, await countActiveTickets(stream.id)),
  };
}

/** The status the chat acts on — a "live" row older than the stream
 *  lifetime cap is over, whatever the row still says (the streams
 *  router reconciles the row itself on its own reads). */
export function effectiveStatus(stream: LiveStream): "live" | "ended" {
  if (stream.status !== "live") return "ended";
  const started = stream.started_at ? new Date(stream.started_at).getTime() : 0;
  if (started && Date.now() - started > MAX_LIVE_MS) return "ended";
  return "live";
}

interface AuthorCard {
  displayName: string;
  avatarUrl: string | null;
  slug: string | null;
}

/** Batch-resolve chat authors to their creator profiles — the same
 *  pattern community.ts uses (profileCards). A chatter without a
 *  creator profile reads as "Someone", never as a fake name. */
async function authorCards(userIds: string[]): Promise<Map<string, AuthorCard>> {
  const out = new Map<string, AuthorCard>();
  const uniq = [...new Set(userIds.filter(Boolean))];
  if (!uniq.length) return out;
  const rows = await db
    .select({
      userId: creatorProfilesTable.userId,
      slug: creatorProfilesTable.slug,
      displayName: creatorProfilesTable.displayName,
      avatarUrl: creatorProfilesTable.avatarUrl,
    })
    .from(creatorProfilesTable)
    .where(inArray(creatorProfilesTable.userId, uniq));
  for (const r of rows) {
    out.set(r.userId, { displayName: r.displayName, avatarUrl: r.avatarUrl ?? null, slug: r.slug ?? null });
  }
  return out;
}

export interface LiveChatMessageDto {
  id: string;
  streamId: string;
  userId: string;
  body: string;
  createdAt: string;
  author: AuthorCard;
  /** 'chat' | 'tip' — tip messages carry their Visual Bucs amount. */
  kind: "chat" | "tip";
  tipAmountVb: number | null;
}

function toDto(row: LiveChatMessage, cards: Map<string, AuthorCard>): LiveChatMessageDto {
  return {
    id: row.id,
    streamId: row.stream_id,
    userId: row.user_id,
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
    author: cards.get(row.user_id) ?? { displayName: "Someone", avatarUrl: null, slug: null },
    kind: row.kind === "tip" ? "tip" : "chat",
    tipAmountVb: row.tip_amount_vb ?? null,
  };
}

export interface LiveChatPinDto {
  message: LiveChatMessageDto;
  pinnedUntil: string;
}

/** The stream's currently-active paid pin, straight from the tips
 *  table — clients render exactly this, never a pin they invented. */
export async function getActivePin(streamId: string): Promise<LiveChatPinDto | null> {
  const pins = await db
    .select()
    .from(liveStreamTipsTable)
    .where(and(eq(liveStreamTipsTable.stream_id, streamId), gt(liveStreamTipsTable.pinned_until, new Date())))
    .orderBy(desc(liveStreamTipsTable.pinned_until))
    .limit(1);
  const pin = pins[0];
  if (!pin?.message_id || !pin.pinned_until) return null;
  const rows = await db
    .select()
    .from(liveChatMessagesTable)
    .where(and(eq(liveChatMessagesTable.id, pin.message_id), isNull(liveChatMessagesTable.deleted_at)))
    .limit(1);
  const message = rows[0];
  if (!message) return null;
  const dto = (await toDtos([message]))[0];
  return dto ? { message: dto, pinnedUntil: new Date(pin.pinned_until).toISOString() } : null;
}

async function toDtos(rows: LiveChatMessage[]): Promise<LiveChatMessageDto[]> {
  const cards = await authorCards(rows.map((r) => r.user_id));
  return rows.map((r) => toDto(r, cards));
}

/** Shared with live-tips: a tip's chat row broadcasts as a message. */
export async function chatMessageDtos(rows: LiveChatMessage[]): Promise<LiveChatMessageDto[]> {
  return toDtos(rows);
}

/* ------------------------------------------------------------ routes */

router.get("/live/:id/chat", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const stream = await getStreamRow(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    if (isTicketed(stream)) {
      const viewerId = await optionalViewerId(req);
      if (!(await canEnterStream(stream, viewerId))) {
        res.status(402).json(await ticketRequiredBody(stream));
        return;
      }
    }
    const after = typeof req.query.after === "string" ? req.query.after : null;
    let cursor: LiveChatMessage | null = null;
    if (after && UUID_RE.test(after)) {
      const rows = await db
        .select()
        .from(liveChatMessagesTable)
        .where(and(eq(liveChatMessagesTable.id, after), eq(liveChatMessagesTable.stream_id, stream.id)))
        .limit(1);
      cursor = rows[0] ?? null; // unknown cursor → full history, never a dead end
    }

    let rows: LiveChatMessage[];
    let hasMore = false;
    if (cursor) {
      rows = await db
        .select()
        .from(liveChatMessagesTable)
        .where(
          and(
            eq(liveChatMessagesTable.stream_id, stream.id),
            isNull(liveChatMessagesTable.deleted_at),
            gt(liveChatMessagesTable.created_at, cursor.created_at),
          ),
        )
        .orderBy(asc(liveChatMessagesTable.created_at), asc(liveChatMessagesTable.id))
        .limit(HISTORY_LIMIT + 1);
      hasMore = rows.length > HISTORY_LIMIT;
      rows = rows.slice(0, HISTORY_LIMIT);
    } else {
      rows = await db
        .select()
        .from(liveChatMessagesTable)
        .where(and(eq(liveChatMessagesTable.stream_id, stream.id), isNull(liveChatMessagesTable.deleted_at)))
        .orderBy(desc(liveChatMessagesTable.created_at), desc(liveChatMessagesTable.id))
        .limit(HISTORY_LIMIT);
      rows = rows.reverse();
    }

    res.json({
      streamId: stream.id,
      streamStatus: effectiveStatus(stream),
      streamTitle: stream.title,
      ownerId: stream.user_id,
      messages: await toDtos(rows),
      hasMore,
      pinned: await getActivePin(stream.id).catch(() => null),
      moderatorIds: await getModeratorIds(stream.profile_id).catch(() => [] as string[]),
    });
  } catch (err) {
    logger.error({ err }, "live chat history failed");
    res.status(500).json({ error: "Chat couldn't load. Try again in a moment." });
  }
});

const postBodySchema = z.object({ body: z.string() });

router.post("/live/:id/chat", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Sign in to chat." });
      return;
    }
    const stream = await getStreamRow(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    if (effectiveStatus(stream) !== "live") {
      res.status(409).json({ error: "Chat is closed — this stream isn't live right now.", code: "STREAM_NOT_LIVE" });
      return;
    }
    if (isTicketed(stream) && !(await canEnterStream(stream, userId))) {
      res.status(402).json(await ticketRequiredBody(stream));
      return;
    }

    const parsed = postBodySchema.safeParse(req.body ?? {});
    const body = parsed.success ? parsed.data.body.trim() : "";
    if (!parsed.success || body.length < 1 || body.length > MAX_BODY_CHARS) {
      res.status(400).json({ error: `Messages run 1–${MAX_BODY_CHARS} characters.`, code: "BAD_BODY" });
      return;
    }

    const mutes = await db
      .select()
      .from(liveChatMutesTable)
      .where(and(eq(liveChatMutesTable.stream_id, stream.id), eq(liveChatMutesTable.user_id, userId)))
      .limit(1);
    const mute = mutes[0];
    if (mute && new Date(mute.muted_until).getTime() > Date.now()) {
      res.status(403).json({
        error: "You've been muted in this stream by the streamer.",
        code: "MUTED",
        mutedUntil: new Date(mute.muted_until).toISOString(),
      });
      return;
    }

    /* Stack 10 #4 automod: the creator's configured rules for this
       channel. A flagged message is NOT posted and NOT silently
       dropped — the chatter gets the honest reason, and the flag is
       logged in the unified mod console with the rule that fired. */
    try {
      const ruleRows = await db.select().from(chatAutomodRulesTable)
        .where(eq(chatAutomodRulesTable.profile_id, stream.profile_id)).limit(1);
      const r = ruleRows[0];
      if (r) {
        const verdict = evaluateAutomod(body, {
          blockLinks: r.block_links, blockedWords: r.blocked_words ?? [],
          capsPercent: r.caps_percent, capsMinLength: r.caps_min_length,
        });
        if (verdict.action === "flag") {
          await logModAction({ profileId: stream.profile_id, streamId: stream.id, actorUserId: null, targetUserId: userId, action: "automod_flag", reason: verdict.reason ?? "Flagged by automod.", rule: verdict.rule, messageBody: body });
          res.status(422).json({ error: verdict.reason, code: "AUTOMOD_FLAGGED", rule: verdict.rule });
          return;
        }
      }
    } catch { /* no automod configured / table absent → chat proceeds */ }

    const rateKey = `${stream.id}:${userId}`;
    const now = Date.now();
    const last = lastPostAt.get(rateKey) ?? 0;
    if (now - last < POST_INTERVAL_MS) {
      res.status(429).json({
        error: "Slow down a touch — one message every couple of seconds.",
        code: "RATE_LIMITED",
        retryAfterMs: POST_INTERVAL_MS - (now - last),
      });
      return;
    }

    const inserted = await db
      .insert(liveChatMessagesTable)
      .values({ stream_id: stream.id, user_id: userId, body })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error("chat insert returned no row");
    lastPostAt.set(rateKey, now);
    /* Flag S-4: pacing entries older than the 1.5s window are dead
       weight — sweep them once the map grows past a threshold so it
       can't accumulate one entry per chatter forever. */
    sweepIfLarge(lastPostAt, 5000, 60_000, now);

    const dto = (await toDtos([row]))[0];
    liveChatHub.broadcast(stream.id, { type: "message", message: dto });
    // Loyalty (Stack 9 #6): chatting earns the channel's points —
    // fire-and-forget, it can never fail the message itself.
    void awardChatPoints(userId, stream.profile_id, stream.user_id);
    res.status(201).json({ message: dto });
  } catch (err) {
    logger.error({ err }, "live chat post failed");
    res.status(500).json({ error: "Your message didn't go through. Try again." });
  }
});

router.delete("/live/:id/chat/:messageId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Sign in to do that." });
      return;
    }
    const stream = await getStreamRow(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    if (!UUID_RE.test(param(req, "messageId"))) {
      res.status(404).json({ error: "That message doesn't exist." });
      return;
    }
    const rows = await db
      .select()
      .from(liveChatMessagesTable)
      .where(and(eq(liveChatMessagesTable.id, param(req, "messageId")), eq(liveChatMessagesTable.stream_id, stream.id)))
      .limit(1);
    const message = rows[0];
    if (!message) {
      res.status(404).json({ error: "That message doesn't exist." });
      return;
    }
    const isAuthor = message.user_id === userId;
    const isOwner = stream.user_id === userId;
    // Appointed moderators can remove chatter messages too — but
    // never the owner's: only the owner moderates their own words.
    const role = isAuthor || isOwner ? null : await chatRoleFor(stream, userId).catch(() => "viewer" as const);
    const isMod = role === "moderator";
    if (!isAuthor && !isOwner && !(isMod && message.user_id !== stream.user_id)) {
      res.status(403).json({ error: "You can only remove your own messages here." });
      return;
    }
    if (!message.deleted_at) {
      // Soft delete: the body is cleared in the same write, so the text
      // is gone from storage too — not just hidden from readers.
      await db
        .update(liveChatMessagesTable)
        .set({ deleted_at: new Date(), body: "" })
        .where(eq(liveChatMessagesTable.id, message.id));
      liveChatHub.broadcast(stream.id, { type: "message_deleted", messageId: message.id });
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "live chat delete failed");
    res.status(500).json({ error: "That message couldn't be removed. Try again." });
  }
});

const muteBodySchema = z.object({ userId: z.string().uuid() });

router.post("/live/:id/chat/mute", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Sign in to do that." });
      return;
    }
    const stream = await getStreamRow(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    // Owner OR an appointed channel moderator may mute. A moderator
    // can never mute the owner or another moderator — only the
    // owner moderates the moderators.
    const callerRole = await chatRoleFor(stream, userId).catch(() => "viewer" as const);
    if (callerRole === "viewer") {
      res.status(403).json({ error: "Only the streamer and their moderators can mute here." });
      return;
    }
    const parsed = muteBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "That chatter couldn't be muted." });
      return;
    }
    const targetId = parsed.data.userId;
    if (targetId === stream.user_id) {
      res.status(400).json({ error: "The streamer can't be muted in their own stream." });
      return;
    }
    if (callerRole === "moderator") {
      if (targetId === userId) {
        res.status(400).json({ error: "You can't mute yourself." });
        return;
      }
      const targetRole = await chatRoleFor(stream, targetId).catch(() => "viewer" as const);
      if (targetRole === "moderator") {
        res.status(403).json({ error: "Moderators can't mute other moderators — that's the streamer's call." });
        return;
      }
    }
    const mutedUntil = new Date(Date.now() + MUTE_MS);
    const existing = await db
      .select()
      .from(liveChatMutesTable)
      .where(and(eq(liveChatMutesTable.stream_id, stream.id), eq(liveChatMutesTable.user_id, targetId)))
      .limit(1);
    if (existing[0]) {
      await db
        .update(liveChatMutesTable)
        .set({ muted_until: mutedUntil })
        .where(and(eq(liveChatMutesTable.stream_id, stream.id), eq(liveChatMutesTable.user_id, targetId)));
    } else {
      await db.insert(liveChatMutesTable).values({ stream_id: stream.id, user_id: targetId, muted_until: mutedUntil });
    }
    liveChatHub.broadcast(stream.id, { type: "user_muted", userId: targetId });
    res.json({ ok: true, mutedUntil: mutedUntil.toISOString() });
  } catch (err) {
    logger.error({ err }, "live chat mute failed");
    res.status(500).json({ error: "That chatter couldn't be muted. Try again." });
  }
});

router.delete("/live/:id/chat/mute/:userId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Sign in to do that." });
      return;
    }
    const stream = await getStreamRow(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    // Unmute follows the same shape as mute: owner OR moderator,
    // and a moderator can't lift a mute on another moderator.
    const callerRole = await chatRoleFor(stream, userId).catch(() => "viewer" as const);
    if (callerRole === "viewer") {
      res.status(403).json({ error: "Only the streamer and their moderators can unmute here." });
      return;
    }
    if (callerRole === "moderator" && UUID_RE.test(param(req, "userId"))) {
      const targetRole = await chatRoleFor(stream, param(req, "userId")).catch(() => "viewer" as const);
      if (targetRole === "moderator") {
        res.status(403).json({ error: "Moderators can't unmute other moderators — that's the streamer's call." });
        return;
      }
    }
    if (!UUID_RE.test(param(req, "userId"))) {
      res.status(404).json({ error: "That chatter isn't muted here." });
      return;
    }
    await db
      .delete(liveChatMutesTable)
      .where(and(eq(liveChatMutesTable.stream_id, stream.id), eq(liveChatMutesTable.user_id, param(req, "userId"))));
    liveChatHub.broadcast(stream.id, { type: "user_unmuted", userId: param(req, "userId") });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "live chat unmute failed");
    res.status(500).json({ error: "That chatter couldn't be unmuted. Try again." });
  }
});

/* ------------------------------------------------------------ websocket */

/**
 * Register the chat delivery socket on the shared gateway. Session
 * token auth (see live-ws.ts); the socket is delivery-only — writes
 * stay on POST so validation, pacing and moderation have one home.
 * Guests are refused here (4401) and the panel polls instead.
 */
export function registerLiveChatWs(
  gateway: LiveWsGateway,
  deps: { verifyToken?: typeof verifyAccessToken } = {},
): void {
  const verifyToken = deps.verifyToken ?? verifyAccessToken;
  gateway.register("/api/live/:id/chat/ws", async ({ socket, params, query }) => {
    const token = query.get("token") ?? "";
    const auth = await verifyToken(token);
    if (!auth) {
      socket.close(4401, "Sign in to join the chat live");
      return;
    }
    const stream = await getStreamRow(params.id);
    if (!stream) {
      socket.close(4404, "That stream doesn't exist");
      return;
    }
    if (isTicketed(stream) && !(await canEnterStream(stream, auth.userId))) {
      socket.close(4403, "This show is ticketed — your ticket opens the chat");
      return;
    }
    const client = socket as unknown as WsClientSocket;
    liveChatHub.join(stream.id, client);
    socket.on("close", () => liveChatHub.leave(stream.id, client));
    socket.send(JSON.stringify({ type: "hello", streamId: stream.id, streamStatus: effectiveStatus(stream) }));
  });
}

export default router;
