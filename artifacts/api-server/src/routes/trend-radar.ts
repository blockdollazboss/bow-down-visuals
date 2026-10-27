import { Router, type Request, type Response } from "express";
import { and, eq, gt, inArray, lte } from "drizzle-orm";
import {
  db,
  postsTable,
  profileVideosTable,
  followsTable,
  creatorProfilesTable,
} from "@workspace/db";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { buildRadarFeed, radarHeadline, type RadarSignalInput } from "../lib/trend-radar";

/* ─── Trend Radar (#178) ───────────────────────────────────────────────────
   GET /api/trend-radar/feed — the radar: REAL on-site signals only.
   Sources (each printed on its card, counts are measured, never modeled):
     • hashtags — posts + video tags, last 24h vs the prior 24h
     • rising creators — new follows, last 24h vs the prior 24h
   The AI Trend Predictor stays a separate paid feature; nothing predicted
   or estimated ever enters this feed (lib/trend-radar enforces the
   verified-only gate). Each source fails closed on its own: if one query
   errors, the feed ships the other source rather than a 500. */

const router = Router();

function extractHashtags(body: string): string[] {
  const out: string[] = [];
  const re = /#([a-z0-9_]{2,40})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push(m[1]!.toLowerCase());
  return out;
}

async function hashtagSignals(now: number): Promise<RadarSignalInput[]> {
  const dayMs = 24 * 3600_000;
  const curStart = new Date(now - dayMs);
  const prevStart = new Date(now - 2 * dayMs);
  const [curPosts, prevPosts, curVideos, prevVideos] = await Promise.all([
    db.select({ body: postsTable.body }).from(postsTable)
      .where(and(gt(postsTable.createdAt, curStart), eq(postsTable.audience, "public"))).limit(4000),
    db.select({ body: postsTable.body }).from(postsTable)
      .where(and(gt(postsTable.createdAt, prevStart), lte(postsTable.createdAt, curStart), eq(postsTable.audience, "public"))).limit(4000),
    db.select({ tags: profileVideosTable.tags }).from(profileVideosTable)
      .where(gt(profileVideosTable.createdAt, curStart)).limit(4000),
    db.select({ tags: profileVideosTable.tags }).from(profileVideosTable)
      .where(and(gt(profileVideosTable.createdAt, prevStart), lte(profileVideosTable.createdAt, curStart))).limit(4000),
  ]);
  const tally = (rows: { body?: string; tags?: string[] | null }[], into: Map<string, number>) => {
    for (const r of rows) {
      const tags = r.body ? extractHashtags(r.body) : (r.tags ?? []).map((t) => t.replace(/^#/, "").toLowerCase()).filter(Boolean);
      for (const t of tags) into.set(t, (into.get(t) ?? 0) + 1);
    }
  };
  const cur = new Map<string, number>();
  const prev = new Map<string, number>();
  tally(curPosts, cur); tally(curVideos, cur);
  tally(prevPosts, prev); tally(prevVideos, prev);
  return [...cur.entries()].map(([tag, count]) => ({
    kind: "hashtag" as const,
    key: tag,
    label: `#${tag}`,
    currentCount: count,
    baselineCount: prev.get(tag) ?? 0,
    source: "posts + videos on Bow Down, last 24h vs prior 24h",
    href: `/hashtag/${tag}`,
  }));
}

async function risingCreatorSignals(now: number): Promise<RadarSignalInput[]> {
  const dayMs = 24 * 3600_000;
  const curStart = new Date(now - dayMs);
  const prevStart = new Date(now - 2 * dayMs);
  const [cur, prev] = await Promise.all([
    db.select({ profileId: followsTable.profileId }).from(followsTable).where(gt(followsTable.createdAt, curStart)).limit(20000),
    db.select({ profileId: followsTable.profileId }).from(followsTable)
      .where(and(gt(followsTable.createdAt, prevStart), lte(followsTable.createdAt, curStart))).limit(20000),
  ]);
  const tally = (rows: { profileId: string }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.profileId, (m.get(r.profileId) ?? 0) + 1);
    return m;
  };
  const curM = tally(cur);
  const prevM = tally(prev);
  const top = [...curM.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (top.length === 0) return [];
  const profiles = await db
    .select({ id: creatorProfilesTable.id, displayName: creatorProfilesTable.displayName, slug: creatorProfilesTable.slug })
    .from(creatorProfilesTable)
    .where(inArray(creatorProfilesTable.id, top.map(([id]) => id)));
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return top.flatMap(([id, count]) => {
    const p = byId.get(id);
    if (!p) return [];
    return [{
      kind: "rising_creator" as const,
      key: id,
      label: p.displayName,
      currentCount: count,
      baselineCount: prevM.get(id) ?? 0,
      source: "new follows on Bow Down, last 24h vs prior 24h",
      href: `/artist/${p.slug}`,
    }];
  });
}

router.get("/trend-radar/feed", publicApiLimiter, async (_req: Request, res: Response) => {
  const now = Date.now();
  const inputs: RadarSignalInput[] = [];
  for (const gather of [hashtagSignals, risingCreatorSignals]) {
    try {
      inputs.push(...(await gather(now)));
    } catch (err) {
      logger.warn({ err }, "trend-radar: one signal source failed; feed continues without it");
    }
  }
  const feed = buildRadarFeed(inputs, 20);
  return res.json({ feed, headline: radarHeadline(feed), windowHours: 24 });
});

export default router;
