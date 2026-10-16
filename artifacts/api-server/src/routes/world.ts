/**
 * world.ts — The World (the King's Hall): one shared VR room.
 *
 *   WS  /api/world/ws?token=<session?>   presence + voice signaling
 *   GET /api/world/screen                what the hall's big screen plays
 *
 * Presence is socket state (lib/world-room.ts) on the shared live
 * gateway — no DB rows, no migration: despawning is a socket close.
 * The token is OPTIONAL here, unlike chat: a valid session token makes
 * you a named member (voice + text); no token (or a stale one) makes
 * you a guest — present and visible, labeled a guest, look-only.
 *
 * The screen is honest programming: when a stream is actually live
 * site-wide, the screen carries that stream (its HLS, same playback
 * rules as the watch page); otherwise it plays the hall's featured
 * reel. Nothing is ever labeled "live" that isn't.
 */
import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db, creatorProfilesTable, liveStreamsTable } from "@workspace/db";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { playbackUrlsFromWhip } from "../lib/cloudflare-stream";
import {
  LiveWsGateway,
  RoomHub,
  verifyAccessToken,
  type AccessTokenVerifier,
  type WsClientSocket,
} from "../lib/live-ws";
import { WorldRoom, type WorldIdentity } from "../lib/world-room";

const router = Router();

/* ── The big screen ─────────────────────────────────────────────────────── */

export interface WorldScreenDto {
  mode: "live" | "featured";
  title: string;
  creatorName: string | null;
  streamId: string | null;
  /** HLS playlist URL when live (same-origin proxy path or provider URL). */
  hlsUrl: string | null;
  /** Plain video file URL when featured. */
  videoUrl: string | null;
}

/** The hall's featured reel when nothing is live: the King himself,
 *  looping — a file the site already ships (public/videos). */
export const WORLD_FEATURED_VIDEO_URL = "/videos/shark-king-360-loop.mp4";

/** Pure pick: a live row only becomes "live" on the screen when it has
 *  a playable HLS URL; a live-but-unplayable row falls back to the
 *  featured reel rather than a black screen labeled live. */
export function pickScreenContent(
  live: { id: string; title: string; creatorName: string | null; hlsUrl: string | null } | null,
): WorldScreenDto {
  if (live && live.hlsUrl) {
    return {
      mode: "live",
      title: live.title,
      creatorName: live.creatorName,
      streamId: live.id,
      hlsUrl: live.hlsUrl,
      videoUrl: null,
    };
  }
  return {
    mode: "featured",
    title: "The King's Reel",
    creatorName: null,
    streamId: null,
    hlsUrl: null,
    videoUrl: WORLD_FEATURED_VIDEO_URL,
  };
}

router.get("/world/screen", publicApiLimiter, async (_req, res) => {
  try {
    const [row] = await db
      .select()
      .from(liveStreamsTable)
      .where(eq(liveStreamsTable.status, "live"))
      .orderBy(desc(liveStreamsTable.started_at))
      .limit(1);
    if (!row) {
      res.json({ screen: pickScreenContent(null) });
      return;
    }
    const hlsUrl =
      row.provider === "own-server"
        ? `/api/live-streams/${row.id}/hls/playlist.m3u8`
        : playbackUrlsFromWhip(row.whip_url).hls_url;
    let creatorName: string | null = null;
    try {
      const [profile] = await db
        .select({ displayName: creatorProfilesTable.displayName })
        .from(creatorProfilesTable)
        .where(eq(creatorProfilesTable.id, row.profile_id))
        .limit(1);
      creatorName = profile?.displayName ?? null;
    } catch {
      /* the stream title still titles the screen honestly */
    }
    res.json({ screen: pickScreenContent({ id: row.id, title: row.title, creatorName, hlsUrl }) });
  } catch (err) {
    logger.error({ err }, "[world] screen lookup failed");
    res.status(500).json({ error: "Couldn't load the hall's screen. Try again." });
  }
});

/* ── Presence socket ────────────────────────────────────────────────────── */

export interface WorldWsDeps {
  verifyToken?: AccessTokenVerifier;
  resolveIdentity?: (userId: string) => Promise<WorldIdentity>;
}

/** Default identity: the member's creator profile when they have one
 *  (their display name + avatar ride the avatar), else a plain member
 *  name from their email. Identity failure never blocks entry — it
 *  degrades to a generic member, because the room is the product. */
async function defaultResolveIdentity(userId: string, email: string | null): Promise<WorldIdentity> {
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
    logger.warn({ err, userId }, "[world] identity profile lookup failed — generic member identity");
  }
  const fromEmail = email?.split("@")[0]?.trim();
  return { userId, displayName: fromEmail || "Creator", avatarUrl: null, profileSlug: null };
}

export function registerWorldWs(gateway: LiveWsGateway, deps: WorldWsDeps = {}): WorldRoom {
  const verify = deps.verifyToken ?? verifyAccessToken;
  const hub = new RoomHub();
  const room = new WorldRoom(hub);

  gateway.register("/api/world/ws", async ({ socket, query }) => {
    const token = query.get("token");
    const auth = token ? await verify(token).catch(() => null) : null;

    let identity: WorldIdentity;
    if (auth) {
      identity = deps.resolveIdentity
        ? await deps.resolveIdentity(auth.userId).catch(() => ({
            userId: auth.userId,
            displayName: "Creator",
            avatarUrl: null,
            profileSlug: null,
          }))
        : await defaultResolveIdentity(auth.userId, auth.email);
    } else {
      identity = { userId: null, displayName: "Guest", avatarUrl: null, profileSlug: null };
    }

    const client = socket as unknown as WsClientSocket;
    if (!room.attach(client, identity)) return; // room_full already sent
    socket.on("message", (data) => {
      try {
        room.handleFrame(client, data.toString());
      } catch (err) {
        logger.warn({ err }, "[world] frame handling failed");
      }
    });
    socket.on("close", () => room.detach(client));
    socket.on("error", () => room.detach(client));
  });

  return room;
}

export default router;
