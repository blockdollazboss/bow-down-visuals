import { Router, type Request, type Response } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  db,
  liveStreamsTable,
  liveStreamTipsTable,
  followsTable,
  creatorProfilesTable,
  type LiveStream,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  overlayHub,
  overlayRoom,
  emitOverlayAlert,
  getOrCreateOverlayToken,
  resetOverlayToken,
  resolveOverlayToken,
} from "../lib/overlay-events";
import type { LiveWsGateway, WsClientSocket } from "../lib/live-ws";

/* ── Stream overlays (stack900 lane C2) ──────────────────────────────────
   The Bow Down widgets that live OUTSIDE the website, on a creator's
   own stream: chromeless pages (/overlay/alerts, /overlay/goal) built
   to be pasted into OBS / Streamlabs as browser sources.

     GET  /overlay/state        (overlay token) the real data the
                                overlay pages render from: latest
                                follower, recent tips, and the tip
                                goal's progress — the same rows the
                                in-studio widgets read (routes/
                                live-widgets.ts), keyed by creator
                                instead of by stream. Honest nulls
                                when there is nothing real to show.
     GET  /overlay/me           (auth) the creator's token + the
                                paths the desk turns into links.
     POST /overlay/token/reset  (auth) a fresh token; every old
                                overlay link dies immediately.
     POST /overlay/test-alert   (auth) fire a clearly-labelled TEST
                                alert at the creator's own overlays.
     WS   /api/overlay/ws?token=…  the alert socket (registerOverlayWs).

   The token is the only credential an overlay holds. It is read-only
   and shows nothing beyond what the creator's own stream already
   shows publicly: tipper and follower display names, tip amounts,
   goal progress. No emails, no balances, no user ids. */

const router = Router();

function queryToken(req: Request): string {
  const v = req.query["token"];
  return typeof v === "string" ? v : "";
}

export interface OverlayStateDto {
  creator: { displayName: string };
  /** The stream the goal + tips describe: the live one when the
   *  creator is on air, otherwise their most recent. Null when the
   *  creator has never streamed. */
  stream: { id: string; status: string; title: string } | null;
  latestFollower: { displayName: string; followedAt: string } | null;
  recentTips: Array<{ tipperName: string; amountVb: number; createdAt: string }>;
  goal: { goalVb: number | null; totalVb: number; tipCount: number };
}

/** Build the overlay state for one creator from the real rows. The
 *  goal math mirrors routes/live-widgets.ts exactly: the recent
 *  window's sum, recounted over the full set when the window is
 *  full, so the bar never understates. */
export async function buildOverlayState(userId: string): Promise<OverlayStateDto> {
  const profiles = await db
    .select({ id: creatorProfilesTable.id, displayName: creatorProfilesTable.displayName })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  const profile = profiles[0];

  // The stream in view: live first, else the most recent.
  let stream: LiveStream | null = null;
  const liveRows = await db
    .select()
    .from(liveStreamsTable)
    .where(and(eq(liveStreamsTable.user_id, userId), eq(liveStreamsTable.status, "live")))
    .orderBy(desc(liveStreamsTable.created_at))
    .limit(1);
  if (liveRows[0]) {
    stream = liveRows[0];
  } else {
    const latest = await db
      .select()
      .from(liveStreamsTable)
      .where(eq(liveStreamsTable.user_id, userId))
      .orderBy(desc(liveStreamsTable.created_at))
      .limit(1);
    stream = latest[0] ?? null;
  }

  // Latest follower of the channel (real follows rows, newest first).
  let latestFollower: OverlayStateDto["latestFollower"] = null;
  if (profile) {
    const followRows = await db
      .select()
      .from(followsTable)
      .where(eq(followsTable.profileId, profile.id))
      .orderBy(desc(followsTable.createdAt))
      .limit(1);
    const follow = followRows[0];
    if (follow) {
      const followerProfiles = await db
        .select({ displayName: creatorProfilesTable.displayName })
        .from(creatorProfilesTable)
        .where(eq(creatorProfilesTable.userId, follow.followerUserId))
        .limit(1);
      latestFollower = {
        displayName: followerProfiles[0]?.displayName ?? "Someone",
        followedAt: new Date(follow.createdAt).toISOString(),
      };
    }
  }

  // Recent tips + goal progress for the stream in view.
  let recentTips: OverlayStateDto["recentTips"] = [];
  let goal: OverlayStateDto["goal"] = { goalVb: null, totalVb: 0, tipCount: 0 };
  if (stream) {
    const tipRows = await db
      .select()
      .from(liveStreamTipsTable)
      .where(eq(liveStreamTipsTable.stream_id, stream.id))
      .orderBy(desc(liveStreamTipsTable.created_at))
      .limit(10);
    const tipperIds = [...new Set(tipRows.map((t) => t.tipper_user_id))];
    const nameByUser = new Map<string, string>();
    if (tipperIds.length) {
      const tipperProfiles = await db
        .select({ userId: creatorProfilesTable.userId, displayName: creatorProfilesTable.displayName })
        .from(creatorProfilesTable)
        .where(inArray(creatorProfilesTable.userId, tipperIds));
      for (const p of tipperProfiles) nameByUser.set(p.userId, p.displayName);
    }
    recentTips = tipRows.map((t) => ({
      tipperName: nameByUser.get(t.tipper_user_id) ?? "Someone",
      amountVb: t.amount_vb,
      createdAt: new Date(t.created_at).toISOString(),
    }));
    let goalTotalVb = tipRows.reduce((sum, t) => sum + (t.amount_vb ?? 0), 0);
    let tipCount = tipRows.length;
    if (tipRows.length === 10) {
      const all = await db
        .select({ amount_vb: liveStreamTipsTable.amount_vb })
        .from(liveStreamTipsTable)
        .where(eq(liveStreamTipsTable.stream_id, stream.id));
      goalTotalVb = all.reduce((sum, t) => sum + (t.amount_vb ?? 0), 0);
      tipCount = all.length;
    }
    goal = { goalVb: stream.tip_goal_vb ?? null, totalVb: goalTotalVb, tipCount };
  }

  return {
    creator: { displayName: profile?.displayName ?? "Creator" },
    stream: stream ? { id: stream.id, status: stream.status, title: stream.title } : null,
    latestFollower,
    recentTips,
    goal,
  };
}

async function stateForToken(req: Request, res: Response): Promise<void> {
  const userId = await resolveOverlayToken(queryToken(req));
  if (!userId) {
    res.status(401).json({ error: "That overlay link is no longer valid. Get a fresh one from your Stream Widgets desk." });
    return;
  }
  const state = await buildOverlayState(userId);
  res.json(state);
}

router.get("/overlay/state", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    await stateForToken(req, res);
  } catch (err) {
    logger.error({ err }, "overlay state failed");
    res.status(500).json({ error: "The overlay couldn't load. Try again in a moment." });
  }
});

export interface OverlayDeskDto {
  token: string;
  paths: { alerts: string; goal: string; nowPlaying: string };
}

/** The overlay link paths for one token. The desk prefixes the site
 *  origin; the token is the only secret in the URL. */
export function overlayPaths(token: string): OverlayDeskDto["paths"] {
  return {
    alerts: `/overlay/alerts?token=${token}`,
    goal: `/overlay/goal?token=${token}`,
    /* Lane D3's now-playing source — the third desk row (added at
       the stack900 join, per D3's seam note). */
    nowPlaying: `/overlay/now-playing?token=${token}`,
  };
}

router.get("/overlay/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Sign in to do that." });
      return;
    }
    const token = await getOrCreateOverlayToken(userId);
    const dto: OverlayDeskDto = { token, paths: overlayPaths(token) };
    res.json(dto);
  } catch (err) {
    logger.error({ err }, "overlay desk load failed");
    res.status(500).json({ error: "Your overlay links couldn't load. Try again in a moment." });
  }
});

router.post("/overlay/token/reset", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Sign in to do that." });
      return;
    }
    const token = await resetOverlayToken(userId);
    const dto: OverlayDeskDto = { token, paths: overlayPaths(token) };
    res.json(dto);
  } catch (err) {
    logger.error({ err }, "overlay token reset failed");
    res.status(500).json({ error: "The new link couldn't be made. Try again in a moment." });
  }
});

router.post("/overlay/test-alert", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Sign in to do that." });
      return;
    }
    const profiles = await db
      .select({ displayName: creatorProfilesTable.displayName })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId))
      .limit(1);
    const name = profiles[0]?.displayName ?? "You";
    emitOverlayAlert(userId, {
      kind: "test",
      title: `TEST — ${name}, your overlay is working`,
      body: "This is a test alert. Real tips and fans will pop up just like this.",
      test: true,
    });
    res.json({ ok: true, delivered: overlayHub.roomSize(overlayRoom(userId)) });
  } catch (err) {
    logger.error({ err }, "overlay test alert failed");
    res.status(500).json({ error: "The test alert couldn't be sent. Try again in a moment." });
  }
});

/**
 * Register the overlay alert socket on the shared gateway. The
 * overlay token is the auth (a browser source holds no session);
 * the socket is delivery-only — state comes from GET
 * /overlay/state, and the only writes in the system stay on the
 * real tip / follow / join rails. A dead token is refused (4401)
 * so a reset link stops working everywhere at once.
 */
export function registerOverlayWs(gateway: LiveWsGateway): void {
  gateway.register("/api/overlay/ws", async ({ socket, query }) => {
    const token = query.get("token") ?? "";
    const userId = await resolveOverlayToken(token).catch(() => null);
    if (!userId) {
      socket.close(4401, "That overlay link is no longer valid");
      return;
    }
    const client = socket as unknown as WsClientSocket;
    overlayHub.join(overlayRoom(userId), client);
    socket.on("close", () => overlayHub.leave(overlayRoom(userId), client));
    try {
      const state = await buildOverlayState(userId);
      const hello: { type: "state"; state: OverlayStateDto } = { type: "state", state };
      socket.send(JSON.stringify(hello));
    } catch (err) {
      logger.warn({ err, userId }, "overlay hello state failed (socket stays live for alerts)");
    }
  });
}

export default router;
