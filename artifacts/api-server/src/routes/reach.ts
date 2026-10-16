import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import {
  db,
  liveStreamsTable,
  liveDestinationKeysTable,
  premieresTable,
  liveRaidsTable,
  streamWatchProgressTable,
  streamDropAwardsTable,
  loyaltySettingsTable,
  loyaltyBalancesTable,
  loyaltyRedemptionsTable,
  closeFriendsTable,
  broadcastChannelsTable,
  broadcastMembersTable,
  broadcastPostsTable,
  creatorProfilesTable,
  generatedClipsTable,
  followsTable,
  notificationsTable,
  type LiveStream,
  type CreatorProfile,
  type Premiere,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { protectKey } from "../lib/multistream";
import { sweepIfLarge } from "../lib/sweep-map";
import { attemptFanOut, stopDestinationRelay } from "../lib/fanout";
import { countViewers } from "./live-streams";
import { liveChatHub } from "./live-chat";
import { awardCrossedStreamDrops, STREAM_DROP_THRESHOLDS, STREAM_DROP_WEEKLY_CAP_VB, streamDropWeekSpendVb } from "../lib/stream-drops";
import { currentWeekStart } from "../lib/retention";
import {
  getLoyaltySettings,
  defaultLoyaltySettings,
  perkMenu,
  awardWatchPoints,
  LOYALTY_WATCH_MENU,
  LOYALTY_CHAT_MENU,
  LOYALTY_TIP_MENU,
  LOYALTY_CUSTOM_COST_MENU,
} from "../lib/loyalty";

/* ── Stack 9 "Reach" ────────────────────────────────────────────────────
   Multistream fan-out settings, premieres, raids, stream-linked
   drops, per-channel loyalty, close-friends circles, broadcast
   channels. DTOs are camelCase. Honest states everywhere: an error
   is an error (500 + message), an empty list is an empty list, and
   nothing here invents a viewer, a raid, a drop or a delivery. */

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}
function iso(v: unknown): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

async function myProfile(userId: string): Promise<CreatorProfile | null> {
  const rows = await db.select().from(creatorProfilesTable).where(eq(creatorProfilesTable.userId, userId)).limit(1);
  return rows[0] ?? null;
}
async function profileById(id: string): Promise<CreatorProfile | null> {
  const rows = await db.select().from(creatorProfilesTable).where(eq(creatorProfilesTable.id, id)).limit(1);
  return rows[0] ?? null;
}
async function streamById(id: string): Promise<LiveStream | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await db.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, id)).limit(1);
  return rows[0] ?? null;
}
function creatorCard(p: CreatorProfile | null) {
  return p ? { id: p.id, slug: p.slug, displayName: p.displayName, avatarUrl: p.avatarUrl ?? null } : null;
}

/* ════════════════ #1 Multistream destination keys ════════════════
   Write-only secrets: PUT accepts a key; every GET returns only
   { platform, ingestUrl, hasKey, updatedAt }. The key is never in
   a response, never logged. */

const destinationPutSchema = z.object({
  ingestUrl: z.string().trim().url().max(500).refine((u) => u.startsWith("rtmp://") || u.startsWith("rtmps://"), "Ingest URL must be an RTMP address"),
  streamKey: z.string().trim().min(1).max(500),
});

router.get("/reach/destinations", requireAuth, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(liveDestinationKeysTable)
      .where(eq(liveDestinationKeysTable.user_id, req.userId!));
    res.json({
      destinations: rows.map((r) => ({
        platform: r.platform,
        ingestUrl: r.ingest_url,
        hasKey: true,
        updatedAt: iso(r.updated_at),
      })),
    });
  } catch (err) {
    logger.error({ err }, "reach destinations list failed");
    res.status(500).json({ error: "Could not load your streaming destinations." });
  }
});

router.put("/reach/destinations/:platform", requireAuth, async (req: Request, res: Response) => {
  try {
    const platform = param(req, "platform").trim().toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(platform) || platform === "site") {
      res.status(400).json({ error: "That destination can't take a stream key." });
      return;
    }
    const parsed = destinationPutSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "An RTMP ingest URL and a stream key are required." });
      return;
    }
    const profile = await myProfile(req.userId!);
    if (!profile) {
      res.status(400).json({ error: "Create your creator profile first.", code: "NO_PROFILE" });
      return;
    }
    const now = new Date();
    await db
      .insert(liveDestinationKeysTable)
      .values({
        user_id: req.userId!,
        profile_id: profile.id,
        platform,
        ingest_url: parsed.data.ingestUrl,
        stream_key: protectKey(parsed.data.streamKey),
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [liveDestinationKeysTable.user_id, liveDestinationKeysTable.platform],
        set: { ingest_url: parsed.data.ingestUrl, stream_key: protectKey(parsed.data.streamKey), profile_id: profile.id, updated_at: now },
      });
    // If the creator is live right now, fan-out can start immediately.
    const live = await db
      .select()
      .from(liveStreamsTable)
      .where(and(eq(liveStreamsTable.user_id, req.userId!), eq(liveStreamsTable.status, "live")))
      .limit(1);
    if (live[0]) void attemptFanOut(live[0].id);
    res.json({ destination: { platform, ingestUrl: parsed.data.ingestUrl, hasKey: true, updatedAt: now.toISOString() } });
  } catch (err) {
    logger.error({ err }, "reach destination save failed");
    res.status(500).json({ error: "Could not save that destination." });
  }
});

router.delete("/reach/destinations/:platform", requireAuth, async (req: Request, res: Response) => {
  try {
    const platform = param(req, "platform").trim().toLowerCase();
    await db
      .delete(liveDestinationKeysTable)
      .where(and(eq(liveDestinationKeysTable.user_id, req.userId!), eq(liveDestinationKeysTable.platform, platform)));
    const live = await db
      .select()
      .from(liveStreamsTable)
      .where(and(eq(liveStreamsTable.user_id, req.userId!), eq(liveStreamsTable.status, "live")))
      .limit(1);
    if (live[0]) await stopDestinationRelay(live[0].id, platform).catch(() => undefined);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "reach destination delete failed");
    res.status(500).json({ error: "Could not remove that destination." });
  }
});

router.post("/reach/streams/:id/fanout", requireAuth, async (req: Request, res: Response) => {
  try {
    const stream = await streamById(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    if (stream.user_id !== req.userId) {
      res.status(403).json({ error: "That's not your stream." });
      return;
    }
    if (stream.status !== "live") {
      res.status(409).json({ error: "Fan-out only runs while the stream is live.", code: "STREAM_NOT_LIVE" });
      return;
    }
    const verdicts = await attemptFanOut(stream.id);
    res.json({ verdicts });
  } catch (err) {
    logger.error({ err }, "reach fanout failed");
    res.status(500).json({ error: "Fan-out couldn't run. Try again in a moment." });
  }
});

/* ════════════════ #2 Premieres ════════════════ */

const premiereCreateSchema = z.object({
  clipId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  durationSeconds: z.number().int().min(10).max(4 * 3600),
  scheduledAt: z.string().datetime(),
});

export type PremierePhase = "scheduled" | "live" | "ended" | "cancelled";
export function premierePhase(p: Pick<Premiere, "status" | "scheduled_at" | "duration_seconds">, nowMs: number = Date.now()): PremierePhase {
  if (p.status === "cancelled") return "cancelled";
  const start = new Date(p.scheduled_at).getTime();
  const end = start + p.duration_seconds * 1000;
  if (nowMs < start) return "scheduled";
  if (nowMs < end) return "live";
  return "ended";
}

/** When a premiere is in its live window, make sure its chat room —
 *  a real live_streams row — exists. Returns the stream id or null
 *  (null honestly: e.g. the one-live-per-user index is held by the
 *  creator's own real broadcast). */
async function ensurePremiereStream(p: Premiere): Promise<string | null> {
  if (p.stream_id) return p.stream_id;
  try {
    const inserted = await db
      .insert(liveStreamsTable)
      .values({
        user_id: p.owner_user_id,
        profile_id: p.profile_id,
        title: p.title,
        status: "live",
        provider: "premiere",
        provider_input_id: null,
        playback_id: null,
        whip_url: null,
        destinations: [{ platform: "site", label: "Your profile", status: "active", save_recording: true, vod_url: null, vod_state: null }],
        started_at: new Date(),
      })
      .returning();
    const streamId = inserted[0]?.id ?? null;
    if (streamId) {
      await db.update(premieresTable).set({ stream_id: streamId, status: "live", updated_at: new Date() }).where(eq(premieresTable.id, p.id));
    }
    return streamId;
  } catch (err) {
    logger.warn({ err, premiereId: p.id }, "premiere: chat room could not be created (creator may already be live)");
    return null;
  }
}

async function premiereDto(p: Premiere, profile: CreatorProfile | null, nowMs: number = Date.now()) {
  const phase = premierePhase(p, nowMs);
  const start = new Date(p.scheduled_at).getTime();
  let streamId = p.stream_id;
  if (phase === "live") streamId = (await ensurePremiereStream(p)) ?? streamId;
  if (phase === "ended" && p.stream_id) {
    // Close the chat room with the premiere.
    await db
      .update(liveStreamsTable)
      .set({ status: "ended", ended_at: new Date(), viewer_count: 0, updated_at: new Date() })
      .where(and(eq(liveStreamsTable.id, p.stream_id), eq(liveStreamsTable.status, "live")))
      .catch(() => undefined);
    if (p.status !== "ended") {
      await db.update(premieresTable).set({ status: "ended", updated_at: new Date() }).where(eq(premieresTable.id, p.id)).catch(() => undefined);
    }
  }
  return {
    id: p.id,
    title: p.title,
    // Copy law: this is a Premiere — a scheduled playback of a
    // finished video — never presented as a live camera broadcast.
    kind: "premiere" as const,
    phase,
    scheduledAt: iso(p.scheduled_at),
    durationSeconds: p.duration_seconds,
    /* Watch-together position from the SERVER clock: seconds since
       the scheduled start. Late joiners land mid-video, honestly. */
    positionSeconds: phase === "live" ? Math.max(0, Math.floor((nowMs - start) / 1000)) : phase === "ended" ? p.duration_seconds : 0,
    /* The video itself is only served once the premiere starts;
       before that a countdown is all there honestly is. After it
       ends, this same URL is the normal VOD. */
    videoUrl: phase === "live" || phase === "ended" ? p.video_url : null,
    clipId: p.clip_id,
    chatStreamId: phase === "live" || phase === "ended" ? streamId : null,
    creator: creatorCard(profile),
  };
}

router.post("/reach/premieres", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = premiereCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "A finished video, a title, a duration and a start time are required." });
      return;
    }
    if (new Date(parsed.data.scheduledAt).getTime() <= Date.now()) {
      res.status(400).json({ error: "Schedule the premiere in the future." });
      return;
    }
    const profile = await myProfile(req.userId!);
    if (!profile) {
      res.status(400).json({ error: "Create your creator profile first.", code: "NO_PROFILE" });
      return;
    }
    const clips = await db.select().from(generatedClipsTable).where(eq(generatedClipsTable.id, parsed.data.clipId)).limit(1);
    const clip = clips[0];
    if (!clip || clip.user_id !== req.userId) {
      res.status(404).json({ error: "That video isn't in your finished videos." });
      return;
    }
    if (clip.status !== "completed" || !clip.video_url) {
      res.status(400).json({ error: "Only a finished video can premiere — that one isn't done yet." });
      return;
    }
    const inserted = await db
      .insert(premieresTable)
      .values({
        owner_user_id: req.userId!,
        profile_id: profile.id,
        clip_id: clip.id,
        title: parsed.data.title,
        video_url: clip.video_url,
        duration_seconds: parsed.data.durationSeconds,
        scheduled_at: new Date(parsed.data.scheduledAt),
        status: "scheduled",
      })
      .returning();
    res.status(201).json({ premiere: await premiereDto(inserted[0]!, profile) });
  } catch (err) {
    logger.error({ err }, "premiere create failed");
    res.status(500).json({ error: "Could not schedule that premiere." });
  }
});

router.get("/reach/premieres/upcoming", publicApiLimiter, async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(premieresTable)
      .where(inArray(premieresTable.status, ["scheduled", "live"]))
      .orderBy(premieresTable.scheduled_at)
      .limit(50);
    const live = rows.filter((p) => premierePhase(p) !== "ended" && premierePhase(p) !== "cancelled");
    const profiles = live.length
      ? await db.select().from(creatorProfilesTable).where(inArray(creatorProfilesTable.id, [...new Set(live.map((p) => p.profile_id))]))
      : [];
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const out = [];
    for (const p of live) out.push(await premiereDto(p, byId.get(p.profile_id) ?? null));
    res.json({ premieres: out });
  } catch (err) {
    logger.error({ err }, "premiere upcoming failed");
    res.status(500).json({ error: "Could not load premieres." });
  }
});

router.get("/reach/premieres/:id", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    if (!UUID_RE.test(id)) {
      res.status(404).json({ error: "That premiere doesn't exist." });
      return;
    }
    const rows = await db.select().from(premieresTable).where(eq(premieresTable.id, id)).limit(1);
    const p = rows[0];
    if (!p) {
      res.status(404).json({ error: "That premiere doesn't exist." });
      return;
    }
    const profile = await profileById(p.profile_id);
    res.json({ premiere: await premiereDto(p, profile) });
  } catch (err) {
    logger.error({ err }, "premiere get failed");
    res.status(500).json({ error: "Could not load that premiere." });
  }
});

router.post("/reach/premieres/:id/cancel", requireAuth, async (req: Request, res: Response) => {
  try {
    const rows = await db.select().from(premieresTable).where(eq(premieresTable.id, param(req, "id"))).limit(1);
    const p = rows[0];
    if (!p) {
      res.status(404).json({ error: "That premiere doesn't exist." });
      return;
    }
    if (p.owner_user_id !== req.userId) {
      res.status(403).json({ error: "That's not your premiere." });
      return;
    }
    if (premierePhase(p) !== "scheduled") {
      res.status(409).json({ error: "Only a premiere that hasn't started can be cancelled." });
      return;
    }
    await db.update(premieresTable).set({ status: "cancelled", updated_at: new Date() }).where(eq(premieresTable.id, p.id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "premiere cancel failed");
    res.status(500).json({ error: "Could not cancel that premiere." });
  }
});

/* ════════════════ #3 Raids ════════════════ */

const raidSchema = z.object({ targetStreamId: z.string().uuid() });
export const RAID_COUNTDOWN_SECONDS = 10;

router.post("/reach/streams/:id/raid", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = raidSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "A target stream is required." });
      return;
    }
    const source = await streamById(param(req, "id"));
    if (!source) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    if (source.user_id !== req.userId) {
      res.status(403).json({ error: "You can only raid from your own stream." });
      return;
    }
    if (source.status !== "live") {
      res.status(409).json({ error: "Your stream isn't live — a raid carries your live viewers.", code: "SOURCE_NOT_LIVE" });
      return;
    }
    const target = await streamById(parsed.data.targetStreamId);
    if (!target || target.id === source.id) {
      res.status(400).json({ error: "Pick another creator's stream to raid." });
      return;
    }
    if (target.status !== "live") {
      // Honest failure: never announce a raid into a dead room.
      res.status(409).json({ error: "That creator isn't live right now — a raid can only land on a live stream.", code: "TARGET_NOT_LIVE" });
      return;
    }
    // The real count from the heartbeat tracker — never invented.
    const viewerCount = countViewers(source.id);
    const inserted = await db
      .insert(liveRaidsTable)
      .values({
        source_stream_id: source.id,
        source_profile_id: source.profile_id,
        target_stream_id: target.id,
        target_profile_id: target.profile_id,
        viewer_count: viewerCount,
        status: "announced",
      })
      .returning();
    const raid = inserted[0]!;
    const [sourceProfile, targetProfile] = await Promise.all([profileById(source.profile_id), profileById(target.profile_id)]);
    const payload = {
      id: raid.id,
      sourceStreamId: source.id,
      targetStreamId: target.id,
      viewerCount,
      countdownSeconds: RAID_COUNTDOWN_SECONDS,
      raider: creatorCard(sourceProfile),
      target: creatorCard(targetProfile),
      createdAt: iso(raid.created_at),
    };
    // Source viewers get the banner/countdown; the target gets the
    // Stack 2-style alert (chat hub alert event + a notification).
    liveChatHub.broadcast(source.id, { type: "raid", raid: payload });
    liveChatHub.broadcast(target.id, {
      type: "alert",
      alert: {
        kind: "raid",
        title: `${sourceProfile?.displayName ?? "A creator"} is raiding with ${viewerCount} viewer${viewerCount === 1 ? "" : "s"}`,
        body: source.title,
        raid: payload,
      },
    });
    if (target.user_id !== req.userId) {
      await db
        .insert(notificationsTable)
        .values({
          userId: target.user_id,
          kind: "raid",
          title: `${sourceProfile?.displayName ?? "A creator"} raided your stream`,
          body: `${viewerCount} viewer${viewerCount === 1 ? "" : "s"} came over from “${source.title}”.`,
          link: `/live/${target.id}`,
        })
        .catch(() => undefined);
    }
    res.status(201).json({ raid: payload });
  } catch (err) {
    logger.error({ err }, "raid failed");
    res.status(500).json({ error: "The raid couldn't start. Try again in a moment." });
  }
});

async function latestRaid(direction: "source" | "target", streamId: string, withinMs: number) {
  const col = direction === "source" ? liveRaidsTable.source_stream_id : liveRaidsTable.target_stream_id;
  const rows = await db
    .select()
    .from(liveRaidsTable)
    .where(and(eq(col, streamId), eq(liveRaidsTable.status, "announced")))
    .orderBy(desc(liveRaidsTable.created_at))
    .limit(1);
  const raid = rows[0];
  if (!raid || Date.now() - new Date(raid.created_at).getTime() > withinMs) return null;
  const [sourceProfile, targetProfile] = await Promise.all([profileById(raid.source_profile_id), profileById(raid.target_profile_id)]);
  return {
    id: raid.id,
    sourceStreamId: raid.source_stream_id,
    targetStreamId: raid.target_stream_id,
    viewerCount: raid.viewer_count,
    countdownSeconds: RAID_COUNTDOWN_SECONDS,
    raider: creatorCard(sourceProfile),
    target: creatorCard(targetProfile),
    createdAt: iso(raid.created_at),
  };
}

router.get("/reach/streams/:id/raid-outgoing", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json({ raid: await latestRaid("source", param(req, "id"), RAID_COUNTDOWN_SECONDS * 1000 + 5000) });
  } catch (err) {
    logger.error({ err }, "raid-outgoing failed");
    res.status(500).json({ error: "Could not check for a raid." });
  }
});

router.get("/reach/streams/:id/raid-incoming", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json({ raid: await latestRaid("target", param(req, "id"), 120_000) });
  } catch (err) {
    logger.error({ err }, "raid-incoming failed");
    res.status(500).json({ error: "Could not check for incoming raids." });
  }
});

/* ════════════════ #5 Watch accrual (drops + loyalty watch) ════════════════
   The server measures time between a viewer's watch heartbeats;
   the client never states seconds. A delta is capped at 30s, so a
   forgotten tab or a lying client can't mint watch time. */

const watchLastAt = new Map<string, number>();
export function __resetWatchTracker(): void {
  watchLastAt.clear();
}
const WATCH_MAX_DELTA_SECONDS = 30;

const watchSchema = z.object({ sessionId: z.string().min(8).max(64) });

async function dropProgressDto(userId: string, streamId: string) {
  const prog = await db
    .select()
    .from(streamWatchProgressTable)
    .where(and(eq(streamWatchProgressTable.user_id, userId), eq(streamWatchProgressTable.stream_id, streamId)))
    .limit(1);
  const secondsWatched = prog[0]?.seconds_watched ?? 0;
  const awards = await db
    .select()
    .from(streamDropAwardsTable)
    .where(and(eq(streamDropAwardsTable.user_id, userId), eq(streamDropAwardsTable.stream_id, streamId)));
  const earned = new Set(awards.map((a) => a.threshold_seconds));
  const weekSpent = await streamDropWeekSpendVb(currentWeekStart());
  return {
    secondsWatched,
    thresholds: STREAM_DROP_THRESHOLDS.map((t) => ({
      seconds: t.seconds,
      amountVb: t.amountVb,
      earned: earned.has(t.seconds),
      progressSeconds: Math.min(secondsWatched, t.seconds),
    })),
    weeklyBudget: {
      capVb: STREAM_DROP_WEEKLY_CAP_VB,
      spentVb: weekSpent,
      remainingVb: Math.max(0, STREAM_DROP_WEEKLY_CAP_VB - weekSpent),
    },
  };
}

router.post("/reach/streams/:id/watch", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = watchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "A viewer session id is required." });
      return;
    }
    const stream = await streamById(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    if (stream.status !== "live") {
      res.status(410).json({ error: "That stream has ended.", code: "STREAM_ENDED" });
      return;
    }
    const key = `${stream.id}:${req.userId}:${parsed.data.sessionId}`;
    const now = Date.now();
    const last = watchLastAt.get(key);
    const delta = last === undefined ? 0 : Math.min(WATCH_MAX_DELTA_SECONDS, Math.max(0, Math.floor((now - last) / 1000)));
    watchLastAt.set(key, now);
    /* Flag S-4: session ids are client-supplied, so keys are mintable —
       sweep entries idle past 10 minutes (a delta from them would cap
       at 30s anyway; past that they're indistinguishable from new). */
    sweepIfLarge(watchLastAt, 5000, 10 * 60_000, now);

    let secondsWatched = 0;
    if (delta > 0) {
      const upserted = await db
        .insert(streamWatchProgressTable)
        .values({ user_id: req.userId!, stream_id: stream.id, seconds_watched: delta, updated_at: new Date() })
        .onConflictDoUpdate({
          target: [streamWatchProgressTable.user_id, streamWatchProgressTable.stream_id],
          set: { seconds_watched: sql`${streamWatchProgressTable.seconds_watched} + ${delta}`, updated_at: new Date() },
        })
        .returning();
      secondsWatched = upserted[0]?.seconds_watched ?? delta;
    } else {
      const prog = await db
        .select()
        .from(streamWatchProgressTable)
        .where(and(eq(streamWatchProgressTable.user_id, req.userId!), eq(streamWatchProgressTable.stream_id, stream.id)))
        .limit(1);
      secondsWatched = prog[0]?.seconds_watched ?? 0;
    }

    // Drops pay from real accrued time; loyalty converts the same
    // real seconds into the channel's points.
    const drops = await awardCrossedStreamDrops(req.userId!, stream.id, secondsWatched);
    await awardWatchPoints(req.userId!, stream.profile_id, stream.user_id, secondsWatched);
    const progress = await dropProgressDto(req.userId!, stream.id);
    res.json({ ...progress, justAwarded: drops.awarded, budgetReached: drops.budgetReached });
  } catch (err) {
    logger.error({ err }, "watch accrual failed");
    res.status(500).json({ error: "Could not record your watch time." });
  }
});

router.get("/reach/streams/:id/watch-progress", requireAuth, async (req: Request, res: Response) => {
  try {
    const stream = await streamById(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    res.json(await dropProgressDto(req.userId!, stream.id));
  } catch (err) {
    logger.error({ err }, "watch progress failed");
    res.status(500).json({ error: "Could not load your drop progress." });
  }
});

/* ════════════════ #6 Loyalty ════════════════ */

function loyaltyDto(settings: Awaited<ReturnType<typeof getLoyaltySettings>>, profileId: string) {
  const s = settings ?? defaultLoyaltySettings(profileId);
  return {
    profileId,
    enabled: s.enabled,
    watchPointsPer10Min: s.watch_points_per_10min,
    chatPoints: s.chat_points,
    tipPointsPer100Vb: s.tip_points_per_100vb,
    customRewardLabel: s.custom_reward_label,
    customRewardCost: s.custom_reward_cost,
    perks: perkMenu(settings ?? null),
    /* Standing copy law for this system, served with the data:
       points are the channel's own, never Visual Bucs. */
    notice: "Loyalty points belong to this channel only. They are not Visual Bucs and can't be turned into Visual Bucs or money.",
  };
}

router.get("/reach/loyalty/:profileId", requireAuth, async (req: Request, res: Response) => {
  try {
    const profileId = param(req, "profileId");
    if (!UUID_RE.test(profileId)) {
      res.status(404).json({ error: "That channel doesn't exist." });
      return;
    }
    const profile = await profileById(profileId);
    if (!profile) {
      res.status(404).json({ error: "That channel doesn't exist." });
      return;
    }
    const settings = await getLoyaltySettings(profileId);
    const bal = await db
      .select()
      .from(loyaltyBalancesTable)
      .where(and(eq(loyaltyBalancesTable.user_id, req.userId!), eq(loyaltyBalancesTable.profile_id, profileId)))
      .limit(1);
    const mine = await db
      .select()
      .from(loyaltyRedemptionsTable)
      .where(and(eq(loyaltyRedemptionsTable.user_id, req.userId!), eq(loyaltyRedemptionsTable.profile_id, profileId)))
      .orderBy(desc(loyaltyRedemptionsTable.created_at))
      .limit(20);
    res.json({
      ...loyaltyDto(settings, profileId),
      myPoints: bal[0]?.points ?? 0,
      myRedemptions: mine.map((r) => ({
        id: r.id,
        perkKind: r.perk_kind,
        perkLabel: r.perk_label,
        pointsCost: r.points_cost,
        status: r.status,
        createdAt: iso(r.created_at),
      })),
    });
  } catch (err) {
    logger.error({ err }, "loyalty get failed");
    res.status(500).json({ error: "Could not load loyalty points." });
  }
});

const loyaltySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  watchPointsPer10Min: z.number().int().refine((v) => (LOYALTY_WATCH_MENU as readonly number[]).includes(v), "Pick a watch rate from the menu"),
  chatPoints: z.number().int().refine((v) => (LOYALTY_CHAT_MENU as readonly number[]).includes(v), "Pick a chat rate from the menu"),
  tipPointsPer100Vb: z.number().int().refine((v) => (LOYALTY_TIP_MENU as readonly number[]).includes(v), "Pick a tip rate from the menu"),
  customRewardLabel: z.string().trim().max(80).nullable().optional(),
  customRewardCost: z
    .number()
    .int()
    .refine((v) => (LOYALTY_CUSTOM_COST_MENU as readonly number[]).includes(v), "Pick a custom reward cost from the menu")
    .nullable()
    .optional(),
});

router.put("/reach/loyalty/:profileId/settings", requireAuth, async (req: Request, res: Response) => {
  try {
    const profileId = param(req, "profileId");
    const profile = await profileById(profileId);
    if (!profile) {
      res.status(404).json({ error: "That channel doesn't exist." });
      return;
    }
    if (profile.userId !== req.userId) {
      res.status(403).json({ error: "Only the channel's creator sets its loyalty rules." });
      return;
    }
    const parsed = loyaltySettingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Loyalty rules come from the fixed menu." });
      return;
    }
    const d = parsed.data;
    const label = d.customRewardLabel?.trim() ? d.customRewardLabel.trim() : null;
    const cost = label ? (d.customRewardCost ?? null) : null;
    if (label && !cost) {
      res.status(400).json({ error: "Name a cost from the menu for your custom reward." });
      return;
    }
    await db
      .insert(loyaltySettingsTable)
      .values({
        profile_id: profileId,
        enabled: d.enabled ?? true,
        watch_points_per_10min: d.watchPointsPer10Min,
        chat_points: d.chatPoints,
        tip_points_per_100vb: d.tipPointsPer100Vb,
        custom_reward_label: label,
        custom_reward_cost: cost,
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: loyaltySettingsTable.profile_id,
        set: {
          enabled: d.enabled ?? true,
          watch_points_per_10min: d.watchPointsPer10Min,
          chat_points: d.chatPoints,
          tip_points_per_100vb: d.tipPointsPer100Vb,
          custom_reward_label: label,
          custom_reward_cost: cost,
          updated_at: new Date(),
        },
      });
    res.json(loyaltyDto(await getLoyaltySettings(profileId), profileId));
  } catch (err) {
    logger.error({ err }, "loyalty settings failed");
    res.status(500).json({ error: "Could not save loyalty settings." });
  }
});

const redeemSchema = z.object({ perkKind: z.enum(["shoutout", "priority_chat", "custom"]) });

router.post("/reach/loyalty/:profileId/redeem", requireAuth, async (req: Request, res: Response) => {
  try {
    const profileId = param(req, "profileId");
    const profile = await profileById(profileId);
    if (!profile) {
      res.status(404).json({ error: "That channel doesn't exist." });
      return;
    }
    const parsed = redeemSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Pick a perk from the menu." });
      return;
    }
    const settings = await getLoyaltySettings(profileId);
    if (settings && !settings.enabled) {
      res.status(409).json({ error: "This channel's loyalty program is switched off right now." });
      return;
    }
    const perk = perkMenu(settings).find((p) => p.kind === parsed.data.perkKind);
    if (!perk) {
      res.status(400).json({ error: "That perk isn't on this channel's menu." });
      return;
    }
    // Conditional spend: the balance only moves if it covers the cost.
    const spent = await db
      .update(loyaltyBalancesTable)
      .set({ points: sql`${loyaltyBalancesTable.points} - ${perk.cost}`, updated_at: new Date() })
      .where(
        and(
          eq(loyaltyBalancesTable.user_id, req.userId!),
          eq(loyaltyBalancesTable.profile_id, profileId),
          sql`${loyaltyBalancesTable.points} >= ${perk.cost}`,
        ),
      )
      .returning();
    if (!spent[0]) {
      res.status(400).json({ error: `That perk costs ${perk.cost} points — you don't have that many on this channel yet.` });
      return;
    }
    const inserted = await db
      .insert(loyaltyRedemptionsTable)
      .values({ user_id: req.userId!, profile_id: profileId, perk_kind: perk.kind, perk_label: perk.label, points_cost: perk.cost, status: "pending" })
      .returning();
    res.status(201).json({
      redemption: {
        id: inserted[0]!.id,
        perkKind: perk.kind,
        perkLabel: perk.label,
        pointsCost: perk.cost,
        status: "pending",
        createdAt: iso(inserted[0]!.created_at),
      },
      myPoints: spent[0].points,
    });
  } catch (err) {
    logger.error({ err }, "loyalty redeem failed");
    res.status(500).json({ error: "Could not redeem that perk." });
  }
});

router.get("/reach/loyalty/:profileId/redemptions", requireAuth, async (req: Request, res: Response) => {
  try {
    const profileId = param(req, "profileId");
    const profile = await profileById(profileId);
    if (!profile) {
      res.status(404).json({ error: "That channel doesn't exist." });
      return;
    }
    if (profile.userId !== req.userId) {
      res.status(403).json({ error: "Only the channel's creator sees its redemption queue." });
      return;
    }
    const rows = await db
      .select()
      .from(loyaltyRedemptionsTable)
      .where(eq(loyaltyRedemptionsTable.profile_id, profileId))
      .orderBy(desc(loyaltyRedemptionsTable.created_at))
      .limit(100);
    res.json({
      redemptions: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        perkKind: r.perk_kind,
        perkLabel: r.perk_label,
        pointsCost: r.points_cost,
        status: r.status,
        createdAt: iso(r.created_at),
        resolvedAt: iso(r.resolved_at),
      })),
    });
  } catch (err) {
    logger.error({ err }, "loyalty redemptions failed");
    res.status(500).json({ error: "Could not load the redemption queue." });
  }
});

const resolveSchema = z.object({ decision: z.enum(["fulfilled", "declined"]) });

router.post("/reach/loyalty/redemptions/:id/resolve", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = resolveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Say fulfilled or declined." });
      return;
    }
    const rows = await db.select().from(loyaltyRedemptionsTable).where(eq(loyaltyRedemptionsTable.id, param(req, "id"))).limit(1);
    const redemption = rows[0];
    if (!redemption) {
      res.status(404).json({ error: "That redemption doesn't exist." });
      return;
    }
    const profile = await profileById(redemption.profile_id);
    if (!profile || profile.userId !== req.userId) {
      res.status(403).json({ error: "Only the channel's creator resolves its redemptions." });
      return;
    }
    if (redemption.status !== "pending") {
      res.status(409).json({ error: "That redemption is already resolved." });
      return;
    }
    await db
      .update(loyaltyRedemptionsTable)
      .set({ status: parsed.data.decision, resolved_at: new Date(), resolved_by: req.userId! })
      .where(eq(loyaltyRedemptionsTable.id, redemption.id));
    if (parsed.data.decision === "declined") {
      // A decline refunds the points in full — the fan paid for a
      // perk they didn't get.
      await db
        .insert(loyaltyBalancesTable)
        .values({ user_id: redemption.user_id, profile_id: redemption.profile_id, points: redemption.points_cost, updated_at: new Date() })
        .onConflictDoUpdate({
          target: [loyaltyBalancesTable.user_id, loyaltyBalancesTable.profile_id],
          set: { points: sql`${loyaltyBalancesTable.points} + ${redemption.points_cost}`, updated_at: new Date() },
        });
    }
    res.json({ ok: true, status: parsed.data.decision });
  } catch (err) {
    logger.error({ err }, "loyalty resolve failed");
    res.status(500).json({ error: "Could not resolve that redemption." });
  }
});

/* ════════════════ #7 Close-friends circles ════════════════ */

router.get("/reach/close-friends", requireAuth, async (req: Request, res: Response) => {
  try {
    const rows = await db.select().from(closeFriendsTable).where(eq(closeFriendsTable.owner_user_id, req.userId!));
    const ids = rows.map((r) => r.friend_profile_id).filter((x): x is string => !!x);
    const profiles = ids.length ? await db.select().from(creatorProfilesTable).where(inArray(creatorProfilesTable.id, ids)) : [];
    const byId = new Map(profiles.map((p) => [p.id, p]));
    res.json({
      friends: rows.map((r) => ({
        userId: r.friend_user_id,
        profile: r.friend_profile_id ? creatorCard(byId.get(r.friend_profile_id) ?? null) : null,
        addedAt: iso(r.created_at),
      })),
    });
  } catch (err) {
    logger.error({ err }, "close-friends list failed");
    res.status(500).json({ error: "Could not load your close-friends circle." });
  }
});

const closeFriendSchema = z.object({ friendProfileId: z.string().uuid() });

router.post("/reach/close-friends", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = closeFriendSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Pick a creator to add to your circle." });
      return;
    }
    const me = await myProfile(req.userId!);
    if (!me) {
      res.status(400).json({ error: "Create your creator profile first.", code: "NO_PROFILE" });
      return;
    }
    const friend = await profileById(parsed.data.friendProfileId);
    if (!friend) {
      res.status(404).json({ error: "That creator doesn't exist." });
      return;
    }
    if (friend.userId === req.userId) {
      res.status(400).json({ error: "You're already in your own circle." });
      return;
    }
    await db
      .insert(closeFriendsTable)
      .values({ owner_user_id: req.userId!, owner_profile_id: me.id, friend_user_id: friend.userId, friend_profile_id: friend.id })
      .onConflictDoNothing();
    res.status(201).json({ ok: true, friend: { userId: friend.userId, profile: creatorCard(friend) } });
  } catch (err) {
    logger.error({ err }, "close-friends add failed");
    res.status(500).json({ error: "Could not add them to your circle." });
  }
});

router.delete("/reach/close-friends/:friendProfileId", requireAuth, async (req: Request, res: Response) => {
  try {
    const friend = await profileById(param(req, "friendProfileId"));
    if (!friend) {
      res.status(404).json({ error: "That creator doesn't exist." });
      return;
    }
    await db
      .delete(closeFriendsTable)
      .where(and(eq(closeFriendsTable.owner_user_id, req.userId!), eq(closeFriendsTable.friend_user_id, friend.userId)));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "close-friends remove failed");
    res.status(500).json({ error: "Could not remove them from your circle." });
  }
});

/* ════════════════ #8 Broadcast channels ════════════════
   One-to-many: only the creator posts; followers join and read.
   Available from creator level one — no follower-count gate, no
   pay-to-open gate (§15). */

const broadcastCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional().default(""),
});

function channelDto(ch: typeof broadcastChannelsTable.$inferSelect, memberCount: number, isMember: boolean, isOwner: boolean) {
  return {
    id: ch.id,
    profileId: ch.profile_id,
    name: ch.name,
    description: ch.description,
    memberCount,
    isMember,
    isOwner,
    createdAt: iso(ch.created_at),
  };
}

async function memberCount(channelId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(broadcastMembersTable)
    .where(eq(broadcastMembersTable.channel_id, channelId));
  return rows[0]?.n ?? 0;
}

router.post("/reach/broadcast/channels", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = broadcastCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Give your broadcast channel a name." });
      return;
    }
    const me = await myProfile(req.userId!);
    if (!me) {
      res.status(400).json({ error: "Create your creator profile first — your broadcast channel lives on it.", code: "NO_PROFILE" });
      return;
    }
    const existing = await db.select().from(broadcastChannelsTable).where(eq(broadcastChannelsTable.profile_id, me.id)).limit(1);
    if (existing[0]) {
      res.status(409).json({ error: "You already have a broadcast channel.", channel: channelDto(existing[0], await memberCount(existing[0].id), true, true) });
      return;
    }
    const inserted = await db
      .insert(broadcastChannelsTable)
      .values({ profile_id: me.id, owner_user_id: req.userId!, name: parsed.data.name, description: parsed.data.description })
      .returning();
    res.status(201).json({ channel: channelDto(inserted[0]!, 0, true, true) });
  } catch (err) {
    logger.error({ err }, "broadcast channel create failed");
    res.status(500).json({ error: "Could not open your broadcast channel." });
  }
});

router.get("/reach/broadcast/channels", requireAuth, async (req: Request, res: Response) => {
  try {
    const channels = await db.select().from(broadcastChannelsTable).orderBy(desc(broadcastChannelsTable.created_at)).limit(50);
    const memberships = await db.select().from(broadcastMembersTable).where(eq(broadcastMembersTable.user_id, req.userId!));
    const memberOf = new Set(memberships.map((m) => m.channel_id));
    const profileIds = [...new Set(channels.map((c) => c.profile_id))];
    const profiles = profileIds.length ? await db.select().from(creatorProfilesTable).where(inArray(creatorProfilesTable.id, profileIds)) : [];
    const byId = new Map(profiles.map((pr) => [pr.id, pr]));
    const out = [];
    for (const ch of channels) {
      out.push({
        ...channelDto(ch, await memberCount(ch.id), memberOf.has(ch.id), ch.owner_user_id === req.userId),
        creator: creatorCard(byId.get(ch.profile_id) ?? null),
      });
    }
    res.json({ channels: out });
  } catch (err) {
    logger.error({ err }, "broadcast channels list failed");
    res.status(500).json({ error: "Could not load broadcast channels." });
  }
});

router.get("/reach/broadcast/by-profile/:profileId", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const rows = await db.select().from(broadcastChannelsTable).where(eq(broadcastChannelsTable.profile_id, param(req, "profileId"))).limit(1);
    const ch = rows[0];
    if (!ch) {
      res.json({ channel: null });
      return;
    }
    const viewerId = (req as Request & { userId?: string }).userId ?? null;
    let isMember = false;
    if (viewerId) {
      const m = await db
        .select()
        .from(broadcastMembersTable)
        .where(and(eq(broadcastMembersTable.channel_id, ch.id), eq(broadcastMembersTable.user_id, viewerId)))
        .limit(1);
      isMember = !!m[0];
    }
    res.json({ channel: channelDto(ch, await memberCount(ch.id), isMember, viewerId === ch.owner_user_id) });
  } catch (err) {
    logger.error({ err }, "broadcast by-profile failed");
    res.status(500).json({ error: "Could not load that broadcast channel." });
  }
});

async function channelById(id: string) {
  if (!UUID_RE.test(id)) return null;
  const rows = await db.select().from(broadcastChannelsTable).where(eq(broadcastChannelsTable.id, id)).limit(1);
  return rows[0] ?? null;
}

router.post("/reach/broadcast/channels/:id/join", requireAuth, async (req: Request, res: Response) => {
  try {
    const ch = await channelById(param(req, "id"));
    if (!ch) {
      res.status(404).json({ error: "That broadcast channel doesn't exist." });
      return;
    }
    await db.insert(broadcastMembersTable).values({ channel_id: ch.id, user_id: req.userId! }).onConflictDoNothing();
    res.json({ ok: true, memberCount: await memberCount(ch.id) });
  } catch (err) {
    logger.error({ err }, "broadcast join failed");
    res.status(500).json({ error: "Could not join that channel." });
  }
});

router.post("/reach/broadcast/channels/:id/leave", requireAuth, async (req: Request, res: Response) => {
  try {
    const ch = await channelById(param(req, "id"));
    if (!ch) {
      res.status(404).json({ error: "That broadcast channel doesn't exist." });
      return;
    }
    await db
      .delete(broadcastMembersTable)
      .where(and(eq(broadcastMembersTable.channel_id, ch.id), eq(broadcastMembersTable.user_id, req.userId!)));
    res.json({ ok: true, memberCount: await memberCount(ch.id) });
  } catch (err) {
    logger.error({ err }, "broadcast leave failed");
    res.status(500).json({ error: "Could not leave that channel." });
  }
});

const broadcastPostSchema = z.object({ body: z.string().trim().min(1).max(2000) });

router.post("/reach/broadcast/channels/:id/posts", requireAuth, async (req: Request, res: Response) => {
  try {
    const ch = await channelById(param(req, "id"));
    if (!ch) {
      res.status(404).json({ error: "That broadcast channel doesn't exist." });
      return;
    }
    if (ch.owner_user_id !== req.userId) {
      // One-to-many means exactly that: members read, the creator posts.
      res.status(403).json({ error: "Only the creator posts in their broadcast channel." });
      return;
    }
    const parsed = broadcastPostSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Write something to broadcast." });
      return;
    }
    const inserted = await db.insert(broadcastPostsTable).values({ channel_id: ch.id, body: parsed.data.body }).returning();
    res.status(201).json({ post: { id: inserted[0]!.id, channelId: ch.id, body: inserted[0]!.body, createdAt: iso(inserted[0]!.created_at) } });
  } catch (err) {
    logger.error({ err }, "broadcast post failed");
    res.status(500).json({ error: "Could not post to your broadcast channel." });
  }
});

router.get("/reach/broadcast/channels/:id/posts", requireAuth, async (req: Request, res: Response) => {
  try {
    const ch = await channelById(param(req, "id"));
    if (!ch) {
      res.status(404).json({ error: "That broadcast channel doesn't exist." });
      return;
    }
    const isOwner = ch.owner_user_id === req.userId;
    if (!isOwner) {
      const m = await db
        .select()
        .from(broadcastMembersTable)
        .where(and(eq(broadcastMembersTable.channel_id, ch.id), eq(broadcastMembersTable.user_id, req.userId!)))
        .limit(1);
      if (!m[0]) {
        res.status(403).json({ error: "Join this broadcast channel to read its posts.", code: "NOT_A_MEMBER" });
        return;
      }
    }
    const rows = await db
      .select()
      .from(broadcastPostsTable)
      .where(eq(broadcastPostsTable.channel_id, ch.id))
      .orderBy(desc(broadcastPostsTable.created_at))
      .limit(50);
    res.json({ posts: rows.map((p) => ({ id: p.id, channelId: p.channel_id, body: p.body, createdAt: iso(p.created_at) })) });
  } catch (err) {
    logger.error({ err }, "broadcast posts failed");
    res.status(500).json({ error: "Could not load broadcast posts." });
  }
});

router.get("/reach/broadcast/inbox", requireAuth, async (req: Request, res: Response) => {
  try {
    const memberships = await db.select().from(broadcastMembersTable).where(eq(broadcastMembersTable.user_id, req.userId!));
    const channelIds = memberships.map((m) => m.channel_id);
    // Channels the user owns are part of their broadcast world too.
    const owned = await db.select().from(broadcastChannelsTable).where(eq(broadcastChannelsTable.owner_user_id, req.userId!));
    for (const ch of owned) if (!channelIds.includes(ch.id)) channelIds.push(ch.id);
    if (!channelIds.length) {
      res.json({ posts: [], channels: [] });
      return;
    }
    const channels = await db.select().from(broadcastChannelsTable).where(inArray(broadcastChannelsTable.id, channelIds));
    const byId = new Map(channels.map((c) => [c.id, c]));
    const profileIds = [...new Set(channels.map((c) => c.profile_id))];
    const profiles = profileIds.length ? await db.select().from(creatorProfilesTable).where(inArray(creatorProfilesTable.id, profileIds)) : [];
    const profileByIdMap = new Map(profiles.map((p) => [p.id, p]));
    const rows = await db
      .select()
      .from(broadcastPostsTable)
      .where(inArray(broadcastPostsTable.channel_id, channelIds))
      .orderBy(desc(broadcastPostsTable.created_at))
      .limit(50);
    res.json({
      channels: channels.map((c) => ({ id: c.id, name: c.name, profileId: c.profile_id, creator: creatorCard(profileByIdMap.get(c.profile_id) ?? null) })),
      posts: rows.map((p) => {
        const ch = byId.get(p.channel_id);
        return {
          id: p.id,
          channelId: p.channel_id,
          channelName: ch?.name ?? "",
          creator: ch ? creatorCard(profileByIdMap.get(ch.profile_id) ?? null) : null,
          body: p.body,
          createdAt: iso(p.created_at),
        };
      }),
    });
  } catch (err) {
    logger.error({ err }, "broadcast inbox failed");
    res.status(500).json({ error: "Could not load your broadcast inbox." });
  }
});

/* Follow lookup used by broadcast discover — followers of a profile
   are the channel's natural audience; kept here so the join surface
   can check without a second router. */
export async function isFollower(userId: string, profileId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(followsTable)
    .where(and(eq(followsTable.followerUserId, userId), eq(followsTable.profileId, profileId)))
    .limit(1);
  return !!rows[0];
}

export default router;
