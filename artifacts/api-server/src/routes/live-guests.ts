import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and, asc, desc, inArray, sql } from "drizzle-orm";
import {
  db,
  liveStreamsTable,
  liveGuestInvitesTable,
  liveGuestSessionsTable,
  liveBackstageMessagesTable,
  creatorProfilesTable,
  type LiveStream,
  type LiveGuestInvite,
  type LiveGuestSession,
  type LiveBackstageMessage,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { RoomHub, verifyAccessToken, type LiveWsGateway, type WsClientSocket } from "../lib/live-ws";
import { effectiveStatus } from "./live-chat";
import {
  GUEST_ROOM_CAP,
  ON_STAGE_GUEST_CAP,
  BACKSTAGE_SAY_MAX,
  mintGuestToken,
  guestTokenLookup,
  guestTokenHint,
  getOrCreateBackstageRoom,
  getBackstageRoom,
  type BackstageGuestState,
} from "../lib/live-backstage";

/* ── Go Live guest invites + backstage (competitor study G3) ──────────
   The StreamYard mechanic on our own pipe. A signed-in host mints a
   shareable invite link for their live stream; a guest opening it
   joins BACKSTAGE — a private greenroom (WebRTC mesh + its own chat)
   where host and guests get ready together. The audience sees and
   hears NOTHING of backstage: backstage chat lives in its own table
   the audience rail never reads, and a guest reaches the audience
   only when the host promotes them to ON STAGE and the host's studio
   canvas mixes their feed into the program.

   Endpoints:
   POST   /live-streams/:id/guest-invites        (auth, owner) mint → plain token ONCE
   GET    /live-streams/:id/guest-invites        (auth, owner) links + guest roster
   DELETE /live-streams/:id/guest-invites/:inv   (auth, owner) revoke — kills its sessions at once
   POST   /live-streams/:id/guests/:sid/promote  (auth, owner) backstage → on stage
   POST   /live-streams/:id/guests/:sid/demote   (auth, owner) on stage → backstage
   POST   /live-streams/:id/guests/:sid/remove   (auth, owner) session ends now
   GET    /live-streams/:id/guests               (public)      ON-STAGE guests only (watch-page chips)
   GET    /live-streams/:id/backstage/messages   (auth, owner) greenroom chat history
   POST   /live-streams/:id/backstage/messages   (auth, owner) greenroom chat write
   GET    /live-guest-invites/:token             (public)      what a guest sees before joining
   POST   /live-guest-invites/:token/join        (public)      join → guest session token ONCE
   GET    /live-guest/session                    (guest)       my session + stream
   POST   /live-guest/session/heartbeat          (guest)       presence touch
   POST   /live-guest/session/leave              (guest)       leave for good
   GET    /live-guest/session/backstage/messages (guest)       greenroom chat history
   POST   /live-guest/session/backstage/messages (guest)       greenroom chat write
   WS     /live/:id/backstage/ws?token=… | ?guest=…            greenroom presence + media signaling

   Guest identity is honest by construction: a guest session has NO
   user id, the DTOs carry guest: true and kind: "guest", and every
   surface labels them "Guest". Host controls are owner-only and
   enforced here on the server, never just hidden in the UI.

   Abuse guards: tokens are 256-bit random, stored only as SHA-256
   lookups; minting is paced per host; joins are paced per IP+link and
   capped per link (max_joins) and per room (GUEST_ROOM_CAP);
   revocation is checked on EVERY guest call, so a revoked link's
   sessions die on their very next request (and their sockets are
   closed at revoke time).

   FREE: no credits code exists anywhere in this rail — going live is
   free, and guest/backstage monetization is an owner ruling, not
   something this code invents. */

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HISTORY_LIMIT = 100;
const POST_INTERVAL_MS = 1500;
const MAX_NAME_CHARS = 40;
const JOIN_WINDOW_MS = 10 * 60 * 1000;
const JOIN_MAX_PER_WINDOW = 10;
const MINT_WINDOW_MS = 60 * 60 * 1000;
const MINT_MAX_PER_WINDOW = 30;

/** Backstage sockets (host + guests) — keyed rooms: `backstage:<id>`. */
export const backstageHub = new RoomHub();

/* ── pacing (in-memory; single instance, like the chat rail) ───────── */
const lastPostAt = new Map<string, number>();
const joinAttempts = new Map<string, number[]>();
const mintAttempts = new Map<string, number[]>();
export function __resetGuestPacing(): void {
  lastPostAt.clear();
  joinAttempts.clear();
  mintAttempts.clear();
}
function windowHit(map: Map<string, number[]>, key: string, windowMs: number, max: number, now: number): boolean {
  const hits = (map.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    map.set(key, hits);
    return true;
  }
  hits.push(now);
  map.set(key, hits);
  return false;
}
function postTooSoon(key: string, now: number): boolean {
  const last = lastPostAt.get(key) ?? 0;
  if (now - last < POST_INTERVAL_MS) return true;
  lastPostAt.set(key, now);
  return false;
}

/* ------------------------------------------------------------ helpers */

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

async function getStreamRow(id: string): Promise<LiveStream | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await db.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Stream + ownership gate for every host rail. Answers the response
 *  itself on failure; returns the stream when the caller owns it. */
async function ownedStream(req: Request, res: Response): Promise<LiveStream | null> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to do that." });
    return null;
  }
  const stream = await getStreamRow(param(req, "id"));
  if (!stream) {
    res.status(404).json({ error: "That stream doesn't exist." });
    return null;
  }
  if (stream.user_id !== userId) {
    res.status(403).json({ error: "Only the streamer can do that — this is their stage." });
    return null;
  }
  return stream;
}

async function hostCard(userId: string): Promise<{ display_name: string; slug: string | null; avatar_url: string | null }> {
  const rows = await db
    .select({
      displayName: creatorProfilesTable.displayName,
      slug: creatorProfilesTable.slug,
      avatarUrl: creatorProfilesTable.avatarUrl,
    })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  const row = rows[0];
  return {
    display_name: row?.displayName ?? "Your host",
    slug: row?.slug ?? null,
    avatar_url: row?.avatarUrl ?? null,
  };
}

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

function inviteDto(inv: LiveGuestInvite) {
  return {
    id: inv.id,
    stream_id: inv.stream_id,
    label: inv.label,
    token_hint: inv.token_hint,
    expires_at: iso(inv.expires_at),
    max_joins: inv.max_joins,
    join_count: inv.join_count,
    revoked_at: iso(inv.revoked_at),
    created_at: iso(inv.created_at),
  };
}

function sessionDto(s: LiveGuestSession) {
  return {
    id: s.id,
    stream_id: s.stream_id,
    invite_id: s.invite_id,
    display_name: s.display_name,
    kind: "guest" as const,
    guest: true as const,
    state: s.state,
    joined_at: iso(s.joined_at),
    last_seen_at: iso(s.last_seen_at),
    ended_at: iso(s.ended_at),
  };
}

function messageDto(m: LiveBackstageMessage) {
  return {
    id: m.id,
    stream_id: m.stream_id,
    author_kind: m.author_kind,
    guest: m.author_kind === "guest",
    guest_session_id: m.guest_session_id,
    author_name: m.author_name,
    body: m.body,
    created_at: iso(m.created_at),
  };
}

/** An invite's live-truth: returns the refusal reason (one honest
 *  message for unknown/revoked/expired so a link can't be probed for
 *  which state it's in) or null when the link is good. */
function inviteRefusal(inv: LiveGuestInvite | null, now: number): string | null {
  if (!inv) return "link_dead";
  if (inv.revoked_at) return "link_dead";
  if (inv.expires_at && new Date(inv.expires_at).getTime() <= now) return "link_dead";
  return null;
}
const LINK_DEAD_ERROR = "That invite link doesn't work anymore — it may have expired or been revoked by the host.";

async function inviteByToken(token: string): Promise<LiveGuestInvite | null> {
  if (!token || token.length < 16 || token.length > 128) return null;
  const rows = await db
    .select()
    .from(liveGuestInvitesTable)
    .where(eq(liveGuestInvitesTable.token_lookup, guestTokenLookup(token)))
    .limit(1);
  return rows[0] ?? null;
}

interface GuestContext {
  session: LiveGuestSession;
  invite: LiveGuestInvite;
  stream: LiveStream;
}

/** Resolve + validate a guest session token from the x-guest-token
 *  header. Revocation and removal are enforced HERE, on every call —
 *  a killed session's very next request fails. */
async function guestContext(req: Request, res: Response): Promise<GuestContext | null> {
  const token = req.header("x-guest-token") ?? "";
  if (!token || token.length < 16 || token.length > 128) {
    res.status(401).json({ error: "That guest pass isn't valid. Join again from your invite link." });
    return null;
  }
  const rows = await db
    .select()
    .from(liveGuestSessionsTable)
    .where(eq(liveGuestSessionsTable.session_lookup, guestTokenLookup(token)))
    .limit(1);
  const session = rows[0];
  if (!session || session.state === "left" || session.state === "removed") {
    res.status(401).json({ error: "That guest pass isn't valid anymore. Join again from your invite link." });
    return null;
  }
  const invRows = await db
    .select()
    .from(liveGuestInvitesTable)
    .where(eq(liveGuestInvitesTable.id, session.invite_id))
    .limit(1);
  const invite = invRows[0];
  if (!invite || invite.revoked_at) {
    res.status(401).json({ error: "That invite link was revoked by the host, so this guest pass has ended." });
    return null;
  }
  const stream = await getStreamRow(session.stream_id);
  if (!stream) {
    res.status(404).json({ error: "That stream doesn't exist." });
    return null;
  }
  return { session, invite, stream };
}

async function backstageHistory(streamId: string): Promise<LiveBackstageMessage[]> {
  return db
    .select()
    .from(liveBackstageMessagesTable)
    .where(eq(liveBackstageMessagesTable.stream_id, streamId))
    .orderBy(desc(liveBackstageMessagesTable.created_at))
    .limit(HISTORY_LIMIT)
    .then((rows) => rows.reverse());
}

const bodySchema = z.object({ body: z.string().trim().min(1).max(BACKSTAGE_SAY_MAX) });

/* ------------------------------------------------------- host: invites */

router.post("/live-streams/:id/guest-invites", requireAuth, async (req: Request, res: Response) => {
  try {
    const stream = await ownedStream(req, res);
    if (!stream) return;
    if (windowHit(mintAttempts, `host:${stream.user_id}`, MINT_WINDOW_MS, MINT_MAX_PER_WINDOW, Date.now())) {
      res.status(429).json({ error: "You've made a lot of invite links this hour — give it a little while before minting more." });
      return;
    }
    const parsed = z
      .object({
        label: z.string().trim().max(60).optional(),
        expires_in_minutes: z.number().int().min(5).max(7 * 24 * 60).optional(),
        max_joins: z.number().int().min(1).max(50).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "That invite doesn't look right — check the expiry and guest limit." });
      return;
    }
    const token = mintGuestToken();
    const expiresAt = parsed.data.expires_in_minutes
      ? new Date(Date.now() + parsed.data.expires_in_minutes * 60_000)
      : null;
    const rows = await db
      .insert(liveGuestInvitesTable)
      .values({
        stream_id: stream.id,
        host_user_id: stream.user_id,
        token_lookup: guestTokenLookup(token),
        token_hint: guestTokenHint(token),
        label: parsed.data.label?.trim() ? parsed.data.label.trim() : null,
        expires_at: expiresAt,
        max_joins: parsed.data.max_joins ?? null,
      })
      .returning();
    const invite = rows[0];
    if (!invite) {
      res.status(500).json({ error: "That invite couldn't be made. Try again." });
      return;
    }
    res.status(201).json({
      invite: inviteDto(invite),
      /* The plain token is shown exactly once — here. It is never
         stored and can never be read back; a lost link is replaced by
         minting a new one (and revoking the old). */
      token,
      invite_path: `/live/guest/${token}`,
    });
  } catch (err) {
    logger.error({ err }, "guest invite mint failed");
    res.status(500).json({ error: "That invite couldn't be made. Try again." });
  }
});

router.get("/live-streams/:id/guest-invites", requireAuth, async (req: Request, res: Response) => {
  try {
    const stream = await ownedStream(req, res);
    if (!stream) return;
    const invites = await db
      .select()
      .from(liveGuestInvitesTable)
      .where(eq(liveGuestInvitesTable.stream_id, stream.id))
      .orderBy(desc(liveGuestInvitesTable.created_at));
    const sessions = await db
      .select()
      .from(liveGuestSessionsTable)
      .where(eq(liveGuestSessionsTable.stream_id, stream.id))
      .orderBy(asc(liveGuestSessionsTable.joined_at));
    res.json({ invites: invites.map(inviteDto), guests: sessions.map(sessionDto) });
  } catch (err) {
    logger.error({ err }, "guest invite list failed");
    res.status(500).json({ error: "The guest list couldn't load. Try again." });
  }
});

router.delete("/live-streams/:id/guest-invites/:inviteId", requireAuth, async (req: Request, res: Response) => {
  try {
    const stream = await ownedStream(req, res);
    if (!stream) return;
    const inviteId = param(req, "inviteId");
    if (!UUID_RE.test(inviteId)) {
      res.status(404).json({ error: "That invite doesn't exist." });
      return;
    }
    const rows = await db
      .select()
      .from(liveGuestInvitesTable)
      .where(and(eq(liveGuestInvitesTable.id, inviteId), eq(liveGuestInvitesTable.stream_id, stream.id)))
      .limit(1);
    const invite = rows[0];
    if (!invite) {
      res.status(404).json({ error: "That invite doesn't exist." });
      return;
    }
    if (!invite.revoked_at) {
      await db
        .update(liveGuestInvitesTable)
        .set({ revoked_at: new Date(), updated_at: new Date() })
        .where(eq(liveGuestInvitesTable.id, invite.id));
    }
    /* Revocation kills future joins AND every live session minted
       from this link, instantly: rows end here, sockets close in the
       room helper, and guestContext re-checks revoked_at on every
       later call regardless. */
    const active = await db
      .select()
      .from(liveGuestSessionsTable)
      .where(
        and(
          eq(liveGuestSessionsTable.invite_id, invite.id),
          inArray(liveGuestSessionsTable.state, ["backstage", "on_stage"]),
        ),
      );
    if (active.length) {
      await db
        .update(liveGuestSessionsTable)
        .set({ state: "removed", ended_at: new Date(), updated_at: new Date() })
        .where(
          and(
            eq(liveGuestSessionsTable.invite_id, invite.id),
            inArray(liveGuestSessionsTable.state, ["backstage", "on_stage"]),
          ),
        );
      const room = getBackstageRoom(stream.id);
      for (const s of active) room?.endGuestSession(s.id, "The invite link was revoked by the host.");
    }
    res.json({ ok: true, sessions_ended: active.length });
  } catch (err) {
    logger.error({ err }, "guest invite revoke failed");
    res.status(500).json({ error: "That invite couldn't be revoked. Try again." });
  }
});

/* ------------------------------------------------- host: guest control */

async function controlledSession(req: Request, res: Response, stream: LiveStream): Promise<LiveGuestSession | null> {
  const sessionId = param(req, "sessionId");
  if (!UUID_RE.test(sessionId)) {
    res.status(404).json({ error: "That guest isn't here." });
    return null;
  }
  const rows = await db
    .select()
    .from(liveGuestSessionsTable)
    .where(and(eq(liveGuestSessionsTable.id, sessionId), eq(liveGuestSessionsTable.stream_id, stream.id)))
    .limit(1);
  const session = rows[0];
  if (!session) {
    res.status(404).json({ error: "That guest isn't here." });
    return null;
  }
  return session;
}

router.post("/live-streams/:id/guests/:sessionId/promote", requireAuth, async (req: Request, res: Response) => {
  try {
    const stream = await ownedStream(req, res);
    if (!stream) return;
    const session = await controlledSession(req, res, stream);
    if (!session) return;
    if (session.state === "on_stage") {
      res.json({ guest: sessionDto(session) });
      return;
    }
    if (session.state !== "backstage") {
      res.status(409).json({ error: "That guest has already left backstage." });
      return;
    }
    const onStage = await db
      .select({ id: liveGuestSessionsTable.id })
      .from(liveGuestSessionsTable)
      .where(and(eq(liveGuestSessionsTable.stream_id, stream.id), eq(liveGuestSessionsTable.state, "on_stage")));
    if (onStage.length >= ON_STAGE_GUEST_CAP) {
      res.status(409).json({
        error: `The stage is full — ${ON_STAGE_GUEST_CAP} guests on stage at once is the limit. Bring someone back to backstage first.`,
      });
      return;
    }
    const updated = await db
      .update(liveGuestSessionsTable)
      .set({ state: "on_stage", updated_at: new Date() })
      .where(eq(liveGuestSessionsTable.id, session.id))
      .returning();
    getBackstageRoom(stream.id)?.applyGuestState(session.id, "on_stage");
    res.json({ guest: sessionDto(updated[0] ?? { ...session, state: "on_stage" }) });
  } catch (err) {
    logger.error({ err }, "guest promote failed");
    res.status(500).json({ error: "That guest couldn't be brought on stage. Try again." });
  }
});

router.post("/live-streams/:id/guests/:sessionId/demote", requireAuth, async (req: Request, res: Response) => {
  try {
    const stream = await ownedStream(req, res);
    if (!stream) return;
    const session = await controlledSession(req, res, stream);
    if (!session) return;
    if (session.state === "backstage") {
      res.json({ guest: sessionDto(session) });
      return;
    }
    if (session.state !== "on_stage") {
      res.status(409).json({ error: "That guest has already left backstage." });
      return;
    }
    const updated = await db
      .update(liveGuestSessionsTable)
      .set({ state: "backstage", updated_at: new Date() })
      .where(eq(liveGuestSessionsTable.id, session.id))
      .returning();
    getBackstageRoom(stream.id)?.applyGuestState(session.id, "backstage");
    res.json({ guest: sessionDto(updated[0] ?? { ...session, state: "backstage" }) });
  } catch (err) {
    logger.error({ err }, "guest demote failed");
    res.status(500).json({ error: "That guest couldn't be moved backstage. Try again." });
  }
});

router.post("/live-streams/:id/guests/:sessionId/remove", requireAuth, async (req: Request, res: Response) => {
  try {
    const stream = await ownedStream(req, res);
    if (!stream) return;
    const session = await controlledSession(req, res, stream);
    if (!session) return;
    if (session.state === "left" || session.state === "removed") {
      res.json({ ok: true });
      return;
    }
    await db
      .update(liveGuestSessionsTable)
      .set({ state: "removed", ended_at: new Date(), updated_at: new Date() })
      .where(eq(liveGuestSessionsTable.id, session.id));
    getBackstageRoom(stream.id)?.endGuestSession(session.id, "The host removed you from backstage.");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "guest remove failed");
    res.status(500).json({ error: "That guest couldn't be removed. Try again." });
  }
});

/* ------------------------------------------- public: on-stage roster */

router.get("/live-streams/:id/guests", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const stream = await getStreamRow(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    /* The audience learns ONLY who is on stage — backstage guests are
       invisible here by construction (state filter), never just
       hidden in the UI. */
    const rows = await db
      .select({ display_name: liveGuestSessionsTable.display_name, joined_at: liveGuestSessionsTable.joined_at })
      .from(liveGuestSessionsTable)
      .where(and(eq(liveGuestSessionsTable.stream_id, stream.id), eq(liveGuestSessionsTable.state, "on_stage")))
      .orderBy(asc(liveGuestSessionsTable.joined_at));
    res.json({
      on_stage: rows.map((r) => ({ display_name: r.display_name, kind: "guest" as const, guest: true as const })),
    });
  } catch (err) {
    logger.error({ err }, "public on-stage roster failed");
    res.status(500).json({ error: "The stage roster couldn't load." });
  }
});

/* ------------------------------------------------ host: backstage chat */

router.get("/live-streams/:id/backstage/messages", requireAuth, async (req: Request, res: Response) => {
  try {
    const stream = await ownedStream(req, res);
    if (!stream) return;
    const rows = await backstageHistory(stream.id);
    res.json({ messages: rows.map(messageDto) });
  } catch (err) {
    logger.error({ err }, "backstage history (host) failed");
    res.status(500).json({ error: "Backstage chat couldn't load. Try again." });
  }
});

router.post("/live-streams/:id/backstage/messages", requireAuth, async (req: Request, res: Response) => {
  try {
    const stream = await ownedStream(req, res);
    if (!stream) return;
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Backstage messages are 1–500 characters." });
      return;
    }
    if (postTooSoon(`host:${stream.user_id}`, Date.now())) {
      res.status(429).json({ error: "One message at a time — give it a beat." });
      return;
    }
    const host = await hostCard(stream.user_id);
    const rows = await db
      .insert(liveBackstageMessagesTable)
      .values({
        stream_id: stream.id,
        author_kind: "host",
        author_user_id: stream.user_id,
        guest_session_id: null,
        author_name: host.display_name,
        body: parsed.data.body,
      })
      .returning();
    const message = rows[0];
    if (!message) {
      res.status(500).json({ error: "That message couldn't be sent. Try again." });
      return;
    }
    const dto = messageDto(message);
    getBackstageRoom(stream.id)?.deliverChat({ type: "backstage.chat", message: dto });
    res.status(201).json({ message: dto });
  } catch (err) {
    logger.error({ err }, "backstage post (host) failed");
    res.status(500).json({ error: "That message couldn't be sent. Try again." });
  }
});

/* --------------------------------------------------------- guest doors */

router.get("/live-guest-invites/:token", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const invite = await inviteByToken(param(req, "token"));
    if (inviteRefusal(invite, Date.now()) || !invite) {
      res.status(404).json({ error: LINK_DEAD_ERROR });
      return;
    }
    const stream = await getStreamRow(invite.stream_id);
    if (!stream) {
      res.status(404).json({ error: LINK_DEAD_ERROR });
      return;
    }
    const host = await hostCard(stream.user_id);
    res.json({
      invite: { label: invite.label, expires_at: iso(invite.expires_at) },
      stream: {
        id: stream.id,
        title: stream.title,
        status: effectiveStatus(stream),
        watch_path: `/live/${stream.id}`,
      },
      host,
    });
  } catch (err) {
    logger.error({ err }, "guest invite read failed");
    res.status(500).json({ error: "That invite couldn't be checked. Try again." });
  }
});

router.post("/live-guest-invites/:token/join", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const invite = await inviteByToken(param(req, "token"));
    if (inviteRefusal(invite, Date.now()) || !invite) {
      res.status(404).json({ error: LINK_DEAD_ERROR });
      return;
    }
    const ip = req.ip ?? "unknown";
    if (windowHit(joinAttempts, `${ip}:${invite.id}`, JOIN_WINDOW_MS, JOIN_MAX_PER_WINDOW, Date.now())) {
      res.status(429).json({ error: "Too many join tries from here — wait a few minutes and try the link again." });
      return;
    }
    const parsed = z.object({ display_name: z.string().trim().min(1).max(MAX_NAME_CHARS) }).safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: `Pick a name the host will see (1–${MAX_NAME_CHARS} characters).` });
      return;
    }
    const stream = await getStreamRow(invite.stream_id);
    if (!stream) {
      res.status(404).json({ error: LINK_DEAD_ERROR });
      return;
    }
    if (effectiveStatus(stream) !== "live") {
      res.status(410).json({ error: "That stream has ended — the backstage is closed." });
      return;
    }
    if (invite.max_joins !== null && invite.join_count >= invite.max_joins) {
      res.status(410).json({ error: "That invite link has reached its guest limit. Ask the host for a fresh link." });
      return;
    }
    const active = await db
      .select({ id: liveGuestSessionsTable.id })
      .from(liveGuestSessionsTable)
      .where(
        and(
          eq(liveGuestSessionsTable.stream_id, stream.id),
          inArray(liveGuestSessionsTable.state, ["backstage", "on_stage"]),
        ),
      );
    if (active.length >= GUEST_ROOM_CAP) {
      res.status(429).json({ error: "Backstage is full right now — the host can make room and you can try again." });
      return;
    }
    const sessionToken = mintGuestToken();
    const rows = await db
      .insert(liveGuestSessionsTable)
      .values({
        invite_id: invite.id,
        stream_id: stream.id,
        display_name: parsed.data.display_name,
        session_lookup: guestTokenLookup(sessionToken),
        state: "backstage",
      })
      .returning();
    const session = rows[0];
    if (!session) {
      res.status(500).json({ error: "Backstage couldn't let you in. Try again." });
      return;
    }
    await db
      .update(liveGuestInvitesTable)
      .set({ join_count: sql`${liveGuestInvitesTable.join_count} + 1`, updated_at: new Date() })
      .where(eq(liveGuestInvitesTable.id, invite.id));
    const host = await hostCard(stream.user_id);
    res.status(201).json({
      /* The guest session token is shown exactly once — here. */
      session_token: sessionToken,
      session: sessionDto(session),
      stream: { id: stream.id, title: stream.title, status: "live" as const, watch_path: `/live/${stream.id}` },
      host,
    });
  } catch (err) {
    logger.error({ err }, "guest join failed");
    res.status(500).json({ error: "Backstage couldn't let you in. Try again." });
  }
});

/* ------------------------------------------------------ guest: session */

router.get("/live-guest/session", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const ctx = await guestContext(req, res);
    if (!ctx) return;
    const host = await hostCard(ctx.stream.user_id);
    res.json({
      session: sessionDto(ctx.session),
      stream: {
        id: ctx.stream.id,
        title: ctx.stream.title,
        status: effectiveStatus(ctx.stream),
        watch_path: `/live/${ctx.stream.id}`,
      },
      host,
      peers: getBackstageRoom(ctx.stream.id)?.peersDto() ?? [],
    });
  } catch (err) {
    logger.error({ err }, "guest session read failed");
    res.status(500).json({ error: "Your guest pass couldn't be checked. Try again." });
  }
});

router.post("/live-guest/session/heartbeat", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const ctx = await guestContext(req, res);
    if (!ctx) return;
    await db
      .update(liveGuestSessionsTable)
      .set({ last_seen_at: new Date(), updated_at: new Date() })
      .where(eq(liveGuestSessionsTable.id, ctx.session.id));
    res.json({ ok: true, state: ctx.session.state, stream_status: effectiveStatus(ctx.stream) });
  } catch (err) {
    logger.error({ err }, "guest heartbeat failed");
    res.status(500).json({ error: "That heartbeat couldn't be recorded." });
  }
});

router.post("/live-guest/session/leave", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const ctx = await guestContext(req, res);
    if (!ctx) return;
    await db
      .update(liveGuestSessionsTable)
      .set({ state: "left", ended_at: new Date(), updated_at: new Date() })
      .where(eq(liveGuestSessionsTable.id, ctx.session.id));
    getBackstageRoom(ctx.stream.id)?.endGuestSession(ctx.session.id, "You left backstage.");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "guest leave failed");
    res.status(500).json({ error: "Leaving couldn't be recorded. Try again." });
  }
});

router.get("/live-guest/session/backstage/messages", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const ctx = await guestContext(req, res);
    if (!ctx) return;
    const rows = await backstageHistory(ctx.stream.id);
    res.json({ messages: rows.map(messageDto) });
  } catch (err) {
    logger.error({ err }, "backstage history (guest) failed");
    res.status(500).json({ error: "Backstage chat couldn't load. Try again." });
  }
});

router.post("/live-guest/session/backstage/messages", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const ctx = await guestContext(req, res);
    if (!ctx) return;
    if (effectiveStatus(ctx.stream) !== "live") {
      res.status(410).json({ error: "That stream has ended — backstage is closed." });
      return;
    }
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Backstage messages are 1–500 characters." });
      return;
    }
    if (postTooSoon(`guest:${ctx.session.id}`, Date.now())) {
      res.status(429).json({ error: "One message at a time — give it a beat." });
      return;
    }
    const rows = await db
      .insert(liveBackstageMessagesTable)
      .values({
        stream_id: ctx.stream.id,
        author_kind: "guest",
        author_user_id: null,
        guest_session_id: ctx.session.id,
        author_name: ctx.session.display_name,
        body: parsed.data.body,
      })
      .returning();
    const message = rows[0];
    if (!message) {
      res.status(500).json({ error: "That message couldn't be sent. Try again." });
      return;
    }
    const dto = messageDto(message);
    getBackstageRoom(ctx.stream.id)?.deliverChat({ type: "backstage.chat", message: dto });
    res.status(201).json({ message: dto });
  } catch (err) {
    logger.error({ err }, "backstage post (guest) failed");
    res.status(500).json({ error: "That message couldn't be sent. Try again." });
  }
});

/* ------------------------------------------------------------ websocket */

/**
 * Register the backstage socket on the shared gateway. Two doors in:
 * `?token=` — the host's session token (must be the stream's owner);
 * `?guest=` — a guest session token (validated exactly like REST:
 * session active + invite not revoked). The socket carries presence,
 * state mirrors and media signaling; chat writes stay on REST so
 * pacing and persistence have one home.
 */
export function registerLiveBackstageWs(
  gateway: LiveWsGateway,
  deps: { verifyToken?: typeof verifyAccessToken } = {},
): void {
  const verifyToken = deps.verifyToken ?? verifyAccessToken;
  gateway.register("/api/live/:id/backstage/ws", async ({ socket, params, query }) => {
    const stream = await getStreamRow(params.id);
    if (!stream) {
      socket.close(4404, "That stream doesn't exist");
      return;
    }
    const client = socket as unknown as WsClientSocket;
    const guestToken = query.get("guest") ?? "";
    if (guestToken) {
      const rows = await db
        .select()
        .from(liveGuestSessionsTable)
        .where(eq(liveGuestSessionsTable.session_lookup, guestTokenLookup(guestToken)))
        .limit(1);
      const session = rows[0];
      if (!session || session.stream_id !== stream.id || session.state === "left" || session.state === "removed") {
        socket.close(4401, "That guest pass isn't valid anymore");
        return;
      }
      const invRows = await db
        .select()
        .from(liveGuestInvitesTable)
        .where(eq(liveGuestInvitesTable.id, session.invite_id))
        .limit(1);
      if (!invRows[0] || invRows[0].revoked_at) {
        socket.close(4401, "That invite link was revoked");
        return;
      }
      const room = getOrCreateBackstageRoom(backstageHub, stream.id, stream.user_id);
      const attached = room.attach(client, {
        kind: "guest",
        userId: null,
        guestSessionId: session.id,
        displayName: session.display_name,
        guestState: session.state === "on_stage" ? "on_stage" : "backstage",
      });
      if (!attached) return;
      socket.on("message", (data: unknown) => room.handleFrame(client, String(data)));
      socket.on("close", () => room.detach(client));
      return;
    }
    const token = query.get("token") ?? "";
    const auth = token ? await verifyToken(token) : null;
    if (!auth) {
      socket.close(4401, "Sign in to enter backstage");
      return;
    }
    if (auth.userId !== stream.user_id) {
      socket.close(4403, "Backstage is the host's and their invited guests'");
      return;
    }
    const host = await hostCard(stream.user_id);
    const room = getOrCreateBackstageRoom(backstageHub, stream.id, stream.user_id);
    const attached = room.attach(client, {
      kind: "host",
      userId: auth.userId,
      guestSessionId: null,
      displayName: host.display_name,
      guestState: null,
    });
    if (!attached) return;
    socket.on("message", (data: unknown) => room.handleFrame(client, String(data)));
    socket.on("close", () => room.detach(client));
  });
}

export default router;
