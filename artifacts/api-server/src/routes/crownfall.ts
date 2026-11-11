/**
 * crownfall.ts — Crownfall Run ONLINE (owner directive, Nov 10 2026:
 * "Crownfall Run should be multiplayer online 30 rooms max"): co-op
 * party rooms in the Arcade.
 *
 *   POST /api/arcade/crownfall/rooms        create a room (host = caller)
 *   GET  /api/arcade/crownfall/rooms        open lobbies (discovery)
 *   GET  /api/arcade/crownfall/rooms/:code  one room's public snapshot
 *   WS   /api/arcade/crownfall/ws?token=<JWT>&code=…  join + play
 *        (engine: lib/crownfall-rooms.ts)
 *
 * Rooms are ephemeral socket state — no room rows, no migration. The
 * durable output of a run is the score each player submits through
 * the existing POST /api/arcade/scores, which validates party runs
 * against the manager's in-memory run receipts (see
 * crownfallRooms.getReceipt). At most CROWNFALL_MAX_ROOMS (30) rooms
 * are live at once site-wide; the 31st create is refused with an
 * honest 429. Auth is required throughout: multiplayer is members'
 * play (guests can't play — the World access law), and a run's
 * receipt has to belong to somebody.
 *
 * MONEY BOUNDARY: no Visual Bucs stakes, entry fees, or payouts exist
 * here. Nothing in this file imports or calls a credits function.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, creatorProfilesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  LiveWsGateway,
  RoomHub,
  verifyAccessToken,
  type AccessTokenVerifier,
  type WsClientSocket,
} from "../lib/live-ws";
import {
  CrownfallRooms,
  CrownfallRoomCapError,
  CROWNFALL_MAX_ROOMS,
  normalizeCode,
  type CrownfallIdentity,
} from "../lib/crownfall-rooms";

const router = Router();

/* ── Shared room manager (one per process; tests build their own) ───── */

/** The process-wide manager: HTTP creation/discovery, the WS join,
 *  and the arcade score route's receipt lookups must all see the same
 *  rooms, so every layer shares this instance. */
export const crownfallRooms = new CrownfallRooms(new RoomHub());

/* Idle-room sweep on the gateway heartbeat's cadence class (30s):
 * rooms nobody is connected to anymore are dropped from memory. */
const sweepTimer = setInterval(() => crownfallRooms.sweep(), 30_000);
sweepTimer.unref?.();

/* ── Identity ───────────────────────────────────────────────────────── */

/** Member identity from their creator profile when they have one,
 *  else a plain name from their email. Mirrors the Party/World
 *  resolver: identity failure degrades to a generic member, never
 *  blocks play. */
async function defaultResolveIdentity(userId: string, email: string | null): Promise<CrownfallIdentity> {
  try {
    const [profile] = await db
      .select({
        displayName: creatorProfilesTable.displayName,
        avatarUrl: creatorProfilesTable.avatarUrl,
        slug: creatorProfilesTable.slug,
      })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId))
      .limit(1);
    if (profile) {
      return {
        userId,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl ?? null,
        profileSlug: profile.slug,
      };
    }
  } catch (err) {
    logger.warn({ err, userId }, "[crownfall] identity profile lookup failed — generic member identity");
  }
  const fromEmail = email?.split("@")[0]?.trim();
  return { userId, displayName: fromEmail || "Creator", avatarUrl: null, profileSlug: null };
}

/** Identity for HTTP-created rooms (the host's display name becomes
 *  the default room name: "<Name>'s Run"). */
async function identityForUser(userId: string): Promise<CrownfallIdentity> {
  return defaultResolveIdentity(userId, null);
}

/* ── HTTP: rooms ────────────────────────────────────────────────────── */

const createSchema = z.object({
  name: z.string().max(80).optional(),
});

router.post("/arcade/crownfall/rooms", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "That room name is too long — keep it under 80 characters." });
    return;
  }
  const userId = req.userId!;
  try {
    const host = await identityForUser(userId);
    const room = crownfallRooms.createRoom(host, { name: parsed.data.name ?? null });
    res.status(201).json({
      room,
      joinPath: `/arcade?room=${room.code}`,
      wsPath: "/api/arcade/crownfall/ws",
    });
  } catch (err) {
    if (err instanceof CrownfallRoomCapError) {
      res.status(429).json({
        error: `All ${CROWNFALL_MAX_ROOMS} Crownfall rooms are full right now — join one from the list, or try again in a bit.`,
        cap: CROWNFALL_MAX_ROOMS,
      });
      return;
    }
    logger.error({ err, userId }, "[crownfall] room creation failed");
    res.status(500).json({ error: "Could not open the room" });
  }
});

router.get("/arcade/crownfall/rooms", requireAuth, publicApiLimiter, async (_req: Request, res: Response) => {
  res.json({ rooms: crownfallRooms.listOpenRooms(), cap: CROWNFALL_MAX_ROOMS });
});

router.get("/arcade/crownfall/rooms/:code", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const room = crownfallRooms.getRoom(normalizeCode(String(req.params["code"] ?? "")));
  if (!room) {
    res.status(404).json({ error: "That room isn't open. Check the code and try again." });
    return;
  }
  res.json({ room });
});

/* ── WebSocket: join + play ─────────────────────────────────────────── */

interface CrownfallWsDeps {
  verifyToken?: AccessTokenVerifier;
  resolveIdentity?: (userId: string, email: string | null) => Promise<CrownfallIdentity>;
  rooms?: CrownfallRooms;
}

export function registerCrownfallWs(gateway: LiveWsGateway, deps: CrownfallWsDeps = {}): CrownfallRooms {
  const verify = deps.verifyToken ?? verifyAccessToken;
  const rooms = deps.rooms ?? crownfallRooms;

  gateway.register("/api/arcade/crownfall/ws", async ({ socket, query }) => {
    const code = normalizeCode(query.get("code") ?? "");
    const token = query.get("token");
    const auth = token ? await verify(token).catch(() => null) : null;
    const client = socket as unknown as WsClientSocket;
    if (!auth) {
      // No guests in the Crownfall rooms: multiplayer is members'
      // play, and a run receipt has to belong to an account.
      try {
        client.send(JSON.stringify({ type: "error", code: "auth_required", message: "Sign in to play Crownfall Run online." }));
      } catch {
        /* closing anyway */
      }
      try {
        socket.close(4401, "auth_required");
      } catch {
        /* already gone */
      }
      return;
    }
    const identity = deps.resolveIdentity
      ? await deps.resolveIdentity(auth.userId, auth.email).catch(() => ({
          userId: auth.userId,
          displayName: "Creator",
          avatarUrl: null,
          profileSlug: null,
        }))
      : await defaultResolveIdentity(auth.userId, auth.email);

    if (!rooms.attach(client, code, identity)) return; // refusal already sent
    socket.on("message", (data) => {
      try {
        rooms.handleFrame(client, data.toString());
      } catch (err) {
        logger.warn({ err, code }, "[crownfall] frame handling failed");
      }
    });
    socket.on("close", () => rooms.detach(client));
    socket.on("error", () => rooms.detach(client));
  });

  return rooms;
}

export default router;
