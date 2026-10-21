/**
 * party.ts — Party Games v1 (#7 owner's games pick): Trivia rooms and
 * Court Battle duels in WebSocket rooms inside the site.
 *
 *   POST /api/party/rooms            create a room (host = caller)
 *   GET  /api/party/rooms            open lobbies (discovery)
 *   GET  /api/party/rooms/:code      one room's public snapshot
 *   GET  /api/party/leaderboard      wins/points across finished matches
 *   GET  /api/party/me               caller's party record
 *   WS   /api/party/ws?token=…&code=…  join + play (lib/party-rooms.ts)
 *
 * Rooms are ephemeral socket state — no room rows. Only finished-match
 * RESULTS persist (party_match_results, migration 0141): scores and
 * wins, recorded against accounts. Auth is required throughout: a
 * result has to belong to somebody, and the token verifies exactly
 * like REST (the same Supabase check requireAuth uses).
 *
 * MONEY BOUNDARY: no Visual Bucs stakes, entry fees, or payouts exist
 * in v1 — wagering is the owner's ruling to make and he hasn't made
 * it. Nothing here imports or calls a credits function.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { db, creatorProfilesTable, partyMatchResultsTable, retentionPrefsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { logger } from "../lib/logger";
import {
  LiveWsGateway,
  RoomHub,
  verifyAccessToken,
  type AccessTokenVerifier,
  type WsClientSocket,
} from "../lib/live-ws";
import {
  PartyRooms,
  normalizeCode,
  type PartyGame,
  type PartyIdentity,
  type PartyMatchResult,
} from "../lib/party-rooms";

const router = Router();

/* ── Shared room manager (one per process; tests build their own) ───── */

export function createPartyRooms(deps?: ConstructorParameters<typeof PartyRooms>[1]): PartyRooms {
  return new PartyRooms(new RoomHub(), deps);
}

/** The process-wide manager: HTTP creation/discovery and the WS join
 *  must see the same rooms, so both layers share this instance. The
 *  default onMatchEnd persists results; registerPartyWs accepts an
 *  override for tests. */
export const partyRooms = createPartyRooms({
  onMatchEnd: (result) => {
    void recordMatchResults(result).catch((err) =>
      logger.error({ err, code: result.code }, "[party] result recording failed"),
    );
  },
});

/* Idle-room sweep on the gateway heartbeat's cadence class (30s):
 * rooms nobody is connected to anymore are dropped from memory. */
const sweepTimer = setInterval(() => partyRooms.sweep(), 30_000);
sweepTimer.unref?.();

/* ── Identity ───────────────────────────────────────────────────────── */

/** Member identity from their creator profile when they have one,
 *  else a plain name from their email. Mirrors the World's resolver:
 *  identity failure degrades to a generic member, never blocks play. */
async function defaultResolveIdentity(userId: string, email: string | null): Promise<PartyIdentity> {
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
    logger.warn({ err, userId }, "[party] identity profile lookup failed — generic member identity");
  }
  const fromEmail = email?.split("@")[0]?.trim();
  return { userId, displayName: fromEmail || "Creator", avatarUrl: null, profileSlug: null };
}

/** Identity for HTTP-created rooms: the host's profile context, so a
 *  room created from a profile carries that profile as its home. */
async function identityForUser(userId: string): Promise<PartyIdentity> {
  return defaultResolveIdentity(userId, null);
}

/* ── Result persistence + records ───────────────────────────────────── */

/** Write one row per player for a finished match. Called once per
 *  match by the engine's onMatchEnd hook — the engine guards the
 *  exactly-once (room.recorded), this just writes. */
export async function recordMatchResults(result: PartyMatchResult): Promise<void> {
  if (result.players.length === 0) return;
  await db.insert(partyMatchResultsTable).values(
    result.players.map((p) => ({
      roomCode: result.code,
      game: result.game,
      userId: p.userId,
      placement: p.placement,
      score: p.score,
      roundsWon: p.roundsWon,
      won: p.won,
      playerCount: result.playerCount,
    })),
  );
}

interface RecordRow {
  userId: string;
  matches: number;
  wins: number;
  points: number;
}

async function aggregateRecords(): Promise<RecordRow[]> {
  const rows = await db
    .select({
      userId: partyMatchResultsTable.userId,
      score: partyMatchResultsTable.score,
      won: partyMatchResultsTable.won,
    })
    .from(partyMatchResultsTable);
  const byUser = new Map<string, RecordRow>();
  for (const r of rows) {
    const cur = byUser.get(r.userId) ?? { userId: r.userId, matches: 0, wins: 0, points: 0 };
    cur.matches += 1;
    cur.points += r.score;
    if (r.won) cur.wins += 1;
    byUser.set(r.userId, cur);
  }
  return [...byUser.values()].sort(
    (a, b) => b.wins - a.wins || b.points - a.points || a.matches - b.matches,
  );
}

async function displayNames(userIds: string[]): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();
  if (userIds.length === 0) return nameMap;
  const { data: profiles } = await getSupabaseAdmin()
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds);
  for (const p of profiles ?? []) {
    const dn = (p as { display_name?: string | null }).display_name;
    if (dn) nameMap.set((p as { id: string }).id, dn);
  }
  return nameMap;
}

/* ── HTTP: rooms ────────────────────────────────────────────────────── */

const createSchema = z.object({
  game: z.enum(["trivia", "duel"]),
  streamId: z.string().max(128).optional(),
  profileSlug: z.string().max(128).optional(),
});

router.post("/party/rooms", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Pick a game: trivia or duel" });
    return;
  }
  const userId = req.userId!;
  try {
    const host = await identityForUser(userId);
    const room = partyRooms.createRoom(host, {
      game: parsed.data.game as PartyGame,
      streamId: parsed.data.streamId ?? null,
      profileSlug: parsed.data.profileSlug ?? null,
    });
    res.status(201).json({
      room,
      joinPath: `/party?room=${room.code}`,
      wsPath: "/api/party/ws",
    });
  } catch (err) {
    logger.error({ err, userId }, "[party] room creation failed");
    res.status(500).json({ error: "Could not open the room" });
  }
});

router.get("/party/rooms", requireAuth, publicApiLimiter, async (_req: Request, res: Response) => {
  res.json({ rooms: partyRooms.listOpenRooms() });
});

router.get("/party/rooms/:code", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const room = partyRooms.getRoom(normalizeCode(String(req.params["code"] ?? "")));
  if (!room) {
    res.status(404).json({ error: "That room isn't open. Check the code and try again." });
    return;
  }
  res.json({ room });
});

/* ── HTTP: records ──────────────────────────────────────────────────── */

router.get("/party/leaderboard", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const viewerId = req.userId!;
  try {
    const ranked = await aggregateRecords();
    // Honor the retention leaderboard opt-out (viewer always sees self).
    let hidden = new Set<string>();
    if (ranked.length > 0) {
      const prefRows = await db
        .select({ userId: retentionPrefsTable.userId, visible: retentionPrefsTable.leaderboardVisible })
        .from(retentionPrefsTable)
        .where(inArray(retentionPrefsTable.userId, ranked.map((r) => r.userId)));
      hidden = new Set(prefRows.filter((p) => p.visible === false).map((p) => p.userId));
    }
    const visible = ranked.filter((r) => !hidden.has(r.userId) || r.userId === viewerId);
    const top = visible.slice(0, 10);
    const names = await displayNames(top.map((r) => r.userId));
    const viewerIdx = visible.findIndex((r) => r.userId === viewerId);
    res.json({
      rows: top.map((r, i) => ({
        rank: i + 1,
        userId: r.userId,
        name: names.get(r.userId) ?? "Creator",
        wins: r.wins,
        matches: r.matches,
        points: r.points,
        isYou: r.userId === viewerId,
      })),
      viewerRank: viewerIdx >= 0 ? viewerIdx + 1 : null,
      viewer: viewerIdx >= 0 ? visible[viewerIdx] : null,
    });
  } catch (err) {
    logger.error({ err, userId: viewerId }, "[party] leaderboard failed");
    res.status(500).json({ error: "Could not load the party leaderboard" });
  }
});

export interface PartyGameStat {
  game: PartyGame;
  matches: number;
  wins: number;
  points: number;
  bestScore: number;
}

/** One user's party record per game (matches/wins/points/best score).
 *  Shared by /party/me (the caller) and the public profile game-stats
 *  surface (the profile owner) so both read the SAME aggregation. */
export async function partyStatsForUser(userId: string): Promise<{ games: PartyGameStat[]; totalMatches: number }> {
  const rows = await db
    .select()
    .from(partyMatchResultsTable)
    .where(eq(partyMatchResultsTable.userId, userId));
  const byGame = new Map<string, { matches: number; wins: number; points: number; bestScore: number }>();
  for (const r of rows) {
    const cur = byGame.get(r.game) ?? { matches: 0, wins: 0, points: 0, bestScore: 0 };
    cur.matches += 1;
    cur.points += r.score;
    cur.bestScore = Math.max(cur.bestScore, r.score);
    if (r.won) cur.wins += 1;
    byGame.set(r.game, cur);
  }
  return {
    games: (["trivia", "duel"] as PartyGame[]).map((game) => ({
      game,
      ...(byGame.get(game) ?? { matches: 0, wins: 0, points: 0, bestScore: 0 }),
    })),
    totalMatches: rows.length,
  };
}

router.get("/party/me", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    res.json(await partyStatsForUser(userId));
  } catch (err) {
    logger.error({ err, userId }, "[party] me failed");
    res.status(500).json({ error: "Could not load your party record" });
  }
});

/* ── WebSocket: join + play ─────────────────────────────────────────── */

export interface PartyWsDeps {
  verifyToken?: AccessTokenVerifier;
  resolveIdentity?: (userId: string, email: string | null) => Promise<PartyIdentity>;
  rooms?: PartyRooms;
}

export function registerPartyWs(gateway: LiveWsGateway, deps: PartyWsDeps = {}): PartyRooms {
  const verify = deps.verifyToken ?? verifyAccessToken;
  const rooms = deps.rooms ?? partyRooms;

  gateway.register("/api/party/ws", async ({ socket, query }) => {
    const code = normalizeCode(query.get("code") ?? "");
    const token = query.get("token");
    const auth = token ? await verify(token).catch(() => null) : null;
    const client = socket as unknown as WsClientSocket;
    if (!auth) {
      // No guests in the party rooms: results belong to accounts.
      try {
        client.send(JSON.stringify({ type: "error", code: "auth_required", message: "Sign in to join a party room." }));
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
        logger.warn({ err, code }, "[party] frame handling failed");
      }
    });
    socket.on("close", () => rooms.detach(client));
    socket.on("error", () => rooms.detach(client));
  });

  return rooms;
}

export default router;
