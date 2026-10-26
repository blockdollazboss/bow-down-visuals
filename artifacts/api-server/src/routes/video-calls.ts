/**
 * video-calls.ts — 1:1 video calls INSIDE Messages (Phase 1, Stack-200).
 *
 *   REST (mounted under /api, participant-gated exactly like the DM rail):
 *     GET  /dm/call-config              (auth) ICE config (STUN + coturn relay)
 *     POST /dm/:id/call                 (auth) start a call — creates the
 *                                        ringing ledger row, rings the callee
 *     GET  /dm/:id/calls                (auth) in-thread call history
 *     POST /dm/calls/:callId/accept     (auth; callee) answer
 *     POST /dm/calls/:callId/decline    (auth; callee) decline
 *     POST /dm/calls/:callId/end        (auth; caller=cancel pre-answer,
 *                                        either side=hangup once live)
 *   WS:
 *     /api/dm/calls/ws?token=…          (session token) signaling relay +
 *                                        call events (ring/accepted/…)
 *
 * Media is WebRTC peer-to-peer — the server never touches audio/video.
 * Signaling rides the existing LiveWsGateway (no socket.io, no paid
 * provider, $0). Writes go through REST so the ledger, the privacy
 * gate and the state machine each live in exactly one place; the
 * socket only relays SDP/ICE between the two participants of a live
 * call and pushes lifecycle events.
 *
 * Privacy is DM privacy, inherited exactly (lib/video-calls.ts
 * canCallConversation): only an `inbox` conversation can ring;
 * requests must be accepted first (a call must never be a dumber
 * interruption than a message); blocked conversations cannot call
 * and a block SEVERS any live/ringing call — the community block
 * handler calls severVideoCallsForConversation below. Guests have
 * no token and no conversation: 401 at REST, 4401 at the socket.
 *
 * Provisionals: the video_calls table lands via
 * lib/db/migrations/9999-video-calls.sql (provisional number, assigned
 * a real slot at join). Until that migration runs, every handler
 * degrades honestly: reads answer an empty history, a start answers
 * 503 calls_unavailable — the Messages page simply shows no call
 * history and the call button explains itself. Detection is the
 * house isUndefinedTable/isUndefinedColumn seam (lib/pg-errors).
 */

import { Router, type Request, type Response } from "express";
import { eq, and, or, desc, inArray } from "drizzle-orm";
import {
  db, conversationsTable, videoCallsTable, creatorProfilesTable,
  type VideoCall, type Conversation,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";
import { isUndefinedColumn, isUndefinedTable } from "../lib/pg-errors";
import { verifyAccessToken, type LiveWsGateway, type WsClientSocket } from "../lib/live-ws";
import { videoCallHub, type SignalingCallView } from "../lib/video-call-signaling";
import {
  canCallConversation, transitionCall, actorMayAct, callDurationSeconds,
  buildVideoCallIceConfig, isLiveCallStatus, RING_TIMEOUT_MS,
  type CallAction, type CallHistoryEntry, type CallStatus,
} from "../lib/video-calls";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function callsTableMissing(err: unknown): boolean {
  return isUndefinedTable(err) || isUndefinedColumn(err);
}

/* ── Ledger helpers ────────────────────────────────────────────────── */

async function getConversationRow(id: string): Promise<Conversation | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id)).limit(1);
  return rows[0] ?? null;
}

async function getCallRow(id: string): Promise<VideoCall | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await db.select().from(videoCallsTable).where(eq(videoCallsTable.id, id)).limit(1);
  return rows[0] ?? null;
}

function otherParticipant(conv: Conversation, me: string): string {
  return conv.participantA === me ? conv.participantB : conv.participantA;
}

function isParticipant(conv: Conversation, userId: string): boolean {
  return conv.participantA === userId || conv.participantB === userId;
}

export function toCallEntry(row: VideoCall): CallHistoryEntry {
  return {
    id: row.id,
    conversationId: row.conversationId,
    callerUserId: row.callerUserId,
    calleeUserId: row.calleeUserId,
    status: row.status as CallStatus,
    endReason: row.endReason ?? null,
    durationSeconds: row.durationSeconds ?? null,
    createdAt: new Date(row.createdAt).toISOString(),
    answeredAt: row.answeredAt ? new Date(row.answeredAt).toISOString() : null,
    endedAt: row.endedAt ? new Date(row.endedAt).toISOString() : null,
  };
}

/** Display name for the ring payload — a profile name when there is
 *  one, an honest generic when there isn't (never an invented name). */
async function displayNameFor(userId: string): Promise<string> {
  try {
    const rows = await db.select({ displayName: creatorProfilesTable.displayName })
      .from(creatorProfilesTable).where(eq(creatorProfilesTable.userId, userId)).limit(1);
    return rows[0]?.displayName ?? "A creator";
  } catch {
    return "A creator";
  }
}

/* Ring timers: a ringing call that nobody answers settles as missed
   after RING_TIMEOUT_MS. In-memory (single instance, like the house's
   other pacing maps); a restart loses the timer but the row is swept
   by settleStaleRingingCalls on the next read/write touch. */
const ringTimers = new Map<string, ReturnType<typeof setTimeout>>();

function armRingTimer(callId: string): void {
  clearRingTimer(callId);
  const t = setTimeout(() => {
    ringTimers.delete(callId);
    void settleCall(callId, "timeout").catch((err) =>
      logger.error({ err, callId }, "[video-calls] ring timeout settle failed"));
  }, RING_TIMEOUT_MS);
  (t as { unref?: () => void }).unref?.();
  ringTimers.set(callId, t);
}

function clearRingTimer(callId: string): void {
  const t = ringTimers.get(callId);
  if (t) { clearTimeout(t); ringTimers.delete(callId); }
}

export function __clearRingTimers(): void {
  for (const t of ringTimers.values()) clearTimeout(t);
  ringTimers.clear();
}

/**
 * THE settlement path — REST actions, the ring timer, the block sever
 * and socket disconnects all settle through here, so a call settles
 * exactly once and both sides always hear the same outcome. Returns
 * the settled entry, or null when the call is gone / already settled
 * / the transition is illegal from its current status.
 */
export async function settleCall(
  callId: string,
  action: CallAction,
  opts: { now?: Date } = {},
): Promise<CallHistoryEntry | null> {
  const row = await getCallRow(callId);
  if (!row) return null;
  const next = transitionCall(row.status as CallStatus, action);
  if (!next) return null;
  const now = opts.now ?? new Date();
  const isLive = next.status === "accepted";
  const answeredAt = isLive ? now : row.answeredAt;
  const endedAt = isLive ? null : now;
  const duration = isLive ? null : callDurationSeconds(row.answeredAt, endedAt);
  const [updated] = await db.update(videoCallsTable)
    .set({
      status: next.status,
      endReason: next.endReason === "" ? row.endReason : next.endReason,
      answeredAt: answeredAt ?? null,
      endedAt,
      durationSeconds: duration,
      updatedAt: now,
    })
    .where(eq(videoCallsTable.id, callId))
    .returning();
  if (!updated) return null;
  if (next.status !== "ringing") clearRingTimer(callId);
  const entry = toCallEntry(updated);
  /* Both sides hear it, whichever door settled it. */
  const event = isLive
    ? { type: "call.accepted" as const, callId, conversationId: row.conversationId }
    : next.status === "declined"
      ? { type: "call.declined" as const, callId, conversationId: row.conversationId }
      : { type: "call.ended" as const, callId, conversationId: row.conversationId, status: entry.status, endReason: entry.endReason, durationSeconds: entry.durationSeconds };
  videoCallHub.sendToUser(row.callerUserId, event);
  videoCallHub.sendToUser(row.calleeUserId, event);
  return entry;
}

/**
 * Block sever (called by the community DM block handler): every
 * ringing/live call on this conversation settles as `blocked` and
 * both sides' clients are told the call is over. Best-effort by
 * design — the block itself already landed; a sever failure is
 * logged, never a failed block.
 */
export async function severVideoCallsForConversation(conversationId: string): Promise<void> {
  try {
    const rows = await db.select().from(videoCallsTable)
      .where(and(
        eq(videoCallsTable.conversationId, conversationId),
        inArray(videoCallsTable.status, ["ringing", "accepted"]),
      ));
    for (const row of rows) {
      await settleCall(row.id, "block");
    }
  } catch (err) {
    if (callsTableMissing(err)) return; // ledger not migrated yet — nothing to sever
    logger.error({ err, conversationId }, "[video-calls] block sever failed");
  }
}

/** A ringing row older than the ring window (e.g. its timer died in a
 *  restart) settles as missed on touch — history never shows a call
 *  "ringing" from yesterday. */
async function settleStaleRinging(row: VideoCall): Promise<VideoCall> {
  if (row.status !== "ringing") return row;
  if (Date.now() - new Date(row.createdAt).getTime() <= RING_TIMEOUT_MS) return row;
  const settled = await settleCall(row.id, "timeout");
  if (!settled) return row;
  const fresh = await getCallRow(row.id);
  return fresh ?? row;
}

/* ── REST ──────────────────────────────────────────────────────────── */

/** ICE config for the caller's own peer connection. Signed-in only:
 *  the ephemeral TURN pair is minted for THIS member. */
router.get("/dm/call-config", requireAuth, async (req, res) => {
  const config = buildVideoCallIceConfig(process.env, { userId: req.userId! });
  return res.json({ ice: config, ringTimeoutMs: RING_TIMEOUT_MS });
});

/** Start a call. One live call per person on either side: a caller
 *  already in a call gets 409; a callee already in a call settles
 *  this attempt as `busy` (and hears about it) instead of ringing
 *  over their live call — no stacked interruptions (smart law). */
router.post("/dm/:id/call", requireAuth, async (req, res) => {
  try {
    const me = req.userId!;
    const conv = await getConversationRow(param(req, "id"));
    if (!conv) { res.status(404).json({ error: "Conversation not found." }); return; }
    if (!isParticipant(conv, me)) { res.status(403).json({ error: "Conversation not found." }); return; }
    const callee = otherParticipant(conv, me);
    const gate = canCallConversation({
      conversationStatus: conv.status, callerUserId: me, calleeUserId: callee,
      callerIsParticipant: true,
    });
    if (!gate.allowed) {
      res.status(403).json({ error: gate.message, code: gate.code });
      return;
    }

    let inserted: VideoCall | undefined;
    try {
      const live = await db.select().from(videoCallsTable)
        .where(and(
          or(eq(videoCallsTable.callerUserId, me), eq(videoCallsTable.calleeUserId, me),
             eq(videoCallsTable.callerUserId, callee), eq(videoCallsTable.calleeUserId, callee)),
          inArray(videoCallsTable.status, ["ringing", "accepted"]),
        ));
      const fresh: VideoCall[] = [];
      for (const row of live) fresh.push(await settleStaleRinging(row));
      const mineLive = fresh.find((r) => isLiveCallStatus(r.status as CallStatus) &&
        (r.callerUserId === me || r.calleeUserId === me));
      if (mineLive) {
        res.status(409).json({ error: "You're already on a call.", code: "already_in_call", call: toCallEntry(mineLive) });
        return;
      }
      const calleeBusy = fresh.some((r) => isLiveCallStatus(r.status as CallStatus) &&
        (r.callerUserId === callee || r.calleeUserId === callee));
      const [row] = await db.insert(videoCallsTable).values({
        conversationId: conv.id, callerUserId: me, calleeUserId: callee, status: "ringing",
      }).returning();
      inserted = row;
      if (!inserted) { res.status(500).json({ error: "Couldn't start the call — try again." }); return; }
      if (calleeBusy) {
        const settled = await settleCall(inserted.id, "busy");
        videoCallHub.sendToUser(me, { type: "call.busy", callId: inserted.id, conversationId: conv.id });
        res.status(201).json({ call: settled ?? toCallEntry(inserted), busy: true });
        return;
      }
    } catch (err) {
      if (callsTableMissing(err)) {
        res.status(503).json({ error: "Video calls are warming up — try again shortly.", code: "calls_unavailable" });
        return;
      }
      throw err;
    }

    armRingTimer(inserted.id);
    const entry = toCallEntry(inserted);
    const callerName = await displayNameFor(me);
    videoCallHub.sendToUser(callee, { type: "call.ring", call: entry, callerName });
    res.status(201).json({ call: entry, ice: buildVideoCallIceConfig(process.env, { userId: me }) });
  } catch (err) {
    logger.error({ err }, "[video-calls] start failed");
    res.status(500).json({ error: "Couldn't start the call — try again." });
  }
});

/** In-thread call history (newest last, capped like the message read). */
router.get("/dm/:id/calls", requireAuth, async (req, res) => {
  try {
    const me = req.userId!;
    const conv = await getConversationRow(param(req, "id"));
    if (!conv) { res.status(404).json({ error: "Conversation not found." }); return; }
    if (!isParticipant(conv, me)) { res.status(403).json({ error: "Conversation not found." }); return; }
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query["limit"] ?? 50) || 50));
      const rows = await db.select().from(videoCallsTable)
        .where(eq(videoCallsTable.conversationId, conv.id))
        .orderBy(desc(videoCallsTable.createdAt)).limit(limit);
      const settled: VideoCall[] = [];
      for (const row of rows.reverse()) settled.push(await settleStaleRinging(row));
      res.json({ calls: settled.map(toCallEntry) });
    } catch (err) {
      if (callsTableMissing(err)) { res.json({ calls: [] }); return; }
      throw err;
    }
  } catch (err) {
    logger.error({ err }, "[video-calls] history failed");
    res.status(500).json({ error: "Couldn't load call history — try again." });
  }
});

async function participantCall(req: Request, res: Response): Promise<{ call: VideoCall; conv: Conversation } | null> {
  const me = req.userId!;
  const call = await getCallRow(param(req, "callId"));
  if (!call) { res.status(404).json({ error: "Call not found." }); return null; }
  if (call.callerUserId !== me && call.calleeUserId !== me) {
    res.status(403).json({ error: "Call not found." });
    return null;
  }
  const conv = await getConversationRow(call.conversationId);
  if (!conv) { res.status(404).json({ error: "Call not found." }); return null; }
  return { call, conv };
}

async function actOnCall(req: Request, res: Response, action: CallAction): Promise<void> {
  try {
    const me = req.userId!;
    const found = await participantCall(req, res);
    if (!found) return;
    const { call, conv } = found;
    /* A block that already landed wins over any late action: the call
       is severed, whatever button a stale client just pressed. */
    if (conv.status === "blocked" && isLiveCallStatus(call.status as CallStatus)) {
      const settled = await settleCall(call.id, "block");
      res.status(403).json({ error: "This conversation is blocked — calls are off.", code: "blocked", call: settled });
      return;
    }
    if (!actorMayAct({
      action, status: call.status as CallStatus, actorUserId: me,
      callerUserId: call.callerUserId, calleeUserId: call.calleeUserId,
    })) {
      res.status(409).json({ error: "That call can't do that anymore.", code: "invalid_transition", call: toCallEntry(call) });
      return;
    }
    const settled = await settleCall(call.id, action);
    if (!settled) {
      res.status(409).json({ error: "That call can't do that anymore.", code: "invalid_transition" });
      return;
    }
    res.json({ call: settled, ice: buildVideoCallIceConfig(process.env, { userId: me }) });
  } catch (err) {
    if (callsTableMissing(err)) {
      res.status(503).json({ error: "Video calls are warming up — try again shortly.", code: "calls_unavailable" });
      return;
    }
    logger.error({ err }, "[video-calls] call action failed");
    res.status(500).json({ error: "Something went wrong with that call — try again." });
  }
}

router.post("/dm/calls/:callId/accept", requireAuth, async (req, res) => { await actOnCall(req, res, "accept"); });
router.post("/dm/calls/:callId/decline", requireAuth, async (req, res) => { await actOnCall(req, res, "decline"); });

/** End: pre-answer the caller cancels; once live either side hangs up.
 *  The SAME endpoint serves both — the state machine + actor rule
 *  decide which settlement the action means. */
router.post("/dm/calls/:callId/end", requireAuth, async (req, res) => {
  const call = await getCallRow(param(req, "callId")).catch(() => null);
  const action: CallAction = call && call.status === "accepted" ? "hangup" : "cancel";
  /* When the row can't be read (unmigrated ledger), actOnCall answers
     the honest 503/404 — pre-deciding the action here only picks the
     actor rule; a ringing-row miss falls through as cancel. */
  await actOnCall(req, res, action);
});

/* ── WebSocket signaling ───────────────────────────────────────────── */

async function signalingCallView(callId: string): Promise<SignalingCallView | null> {
  const call = await getCallRow(callId);
  if (!call) return null;
  const conv = await getConversationRow(call.conversationId);
  if (!conv) return null;
  const fresh = await settleStaleRinging(call);
  return {
    id: fresh.id, conversationId: fresh.conversationId,
    callerUserId: fresh.callerUserId, calleeUserId: fresh.calleeUserId,
    status: fresh.status as CallStatus, conversationStatus: conv.status,
  };
}

export function registerVideoCallWs(
  gateway: LiveWsGateway,
  deps: { verifyToken?: typeof verifyAccessToken } = {},
): void {
  const verifyToken = deps.verifyToken ?? verifyAccessToken;
  gateway.register("/api/dm/calls/ws", async ({ socket, query }) => {
    const token = query.get("token") ?? "";
    const auth = await verifyToken(token).catch(() => null);
    if (!auth) {
      /* Guests cannot call — no token, no socket, no exceptions. */
      socket.close(4401, "Sign in to use video calls");
      return;
    }
    const client = socket as unknown as WsClientSocket;
    const userId = auth.userId;
    videoCallHub.attach(userId, client);
    socket.send(JSON.stringify({ type: "call.hello", userId }));
    socket.on("message", (data) => {
      void videoCallHub.relayFrame(userId, data.toString(), signalingCallView)
        .catch((err) => logger.warn({ err }, "[video-calls] relay failed"));
    });
    socket.on("close", () => {
      videoCallHub.detach(client);
      /* A peer who vanishes mid-ring settles the ring as missed; a
         peer who vanishes mid-call ends it — but ONLY when they hold
         no other live socket (a phone closing one tab while the
         laptop call continues must not kill the call). Best-effort. */
      if (videoCallHub.isOnline(userId)) return;
      void (async () => {
        try {
          const live = await db.select().from(videoCallsTable)
            .where(and(
              or(eq(videoCallsTable.callerUserId, userId), eq(videoCallsTable.calleeUserId, userId)),
              inArray(videoCallsTable.status, ["ringing", "accepted"]),
            ));
          for (const row of live) {
            /* Only the caller's disappearance settles a ring (the
               callee simply wasn't reachable — the ring timer owns
               that settlement); either side's ends a live call. */
            if (row.status === "accepted") await settleCall(row.id, "disconnect");
            else if (row.callerUserId === userId) await settleCall(row.id, "disconnect");
          }
        } catch { /* unmigrated ledger or transient — the timer/read sweep owns leftovers */ }
      })();
    });
    socket.on("error", () => videoCallHub.detach(client));
  });
}

export default router;
