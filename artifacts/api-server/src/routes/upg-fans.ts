import { Router, type Request, type Response } from "express";
import { randomInt } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import {
  db,
  collabProfilesTable,
  collabRequestsTable,
  collabSuggestionsTable,
  creatorProfilesTable,
  fanLinksTable,
  fanLinkEventsTable,
  playEventsTable,
  profileTracksTable,
  profileVideosTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  applySideMark,
  canonicalPair,
  generationDue,
  houseIntroMessage,
  pairKey,
  rankCandidates,
  sideOf,
  SUGGESTION_OPEN_TARGET,
  type CollabProfileFacts,
} from "../lib/collab-match";
import {
  fanLinkLandingPath,
  isFanLinkCode,
  isFanLinkContentType,
  mintFanLinkCode,
  rollupForCreator,
  statsForLink,
  type FanLinkEventRow,
  type FanLinkRow,
} from "../lib/fan-links";
import {
  attributeFanLinkSignup,
  loadFanLinkByCode,
  recordFanLinkClick,
} from "../lib/fan-link-events";
import { summarizeAudienceRoom } from "../lib/audience-room";

const router = Router();

/* ═══ #175 Collab Match — house-suggested pairings ═══════════════════════
   GET  /api/collab-match          → my open + connected suggestions
                                     (generates a fresh batch when due)
   POST /api/collab-match/:id/mark → { mark: "interested" | "passed" }
   Contact exists ONLY through a suggestion: when both sides mark
   interested, the broker writes one collab_requests intro row and the
   existing inbox flow takes over. A pass closes the pair quietly and
   forever — closed pairs are never listed to either side. */

function toFacts(row: typeof collabProfilesTable.$inferSelect): CollabProfileFacts {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    niche: row.niche,
    platforms: row.platforms ?? [],
    collabInterests: row.collab_interests ?? "",
    isPublic: row.is_public,
  };
}

async function myCollabProfile(userId: string) {
  const rows = await db
    .select()
    .from(collabProfilesTable)
    .where(eq(collabProfilesTable.user_id, userId))
    .limit(1);
  return rows[0] ?? null;
}

async function suggestionRowsFor(userId: string) {
  return db
    .select()
    .from(collabSuggestionsTable)
    .where(
      or(
        eq(collabSuggestionsTable.user_a_id, userId),
        eq(collabSuggestionsTable.user_b_id, userId),
      ),
    )
    .orderBy(desc(collabSuggestionsTable.created_at));
}

router.get("/collab-match", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const me = await myCollabProfile(req.userId!);
    if (!me) {
      res.json({ hasProfile: false, suggestions: [] });
      return;
    }
    let rows = await suggestionRowsFor(req.userId!);
    const openCount = rows.filter((r) => r.status === "open").length;
    const lastCreatedAt = rows.length > 0 ? rows[0].created_at : null;

    /* Generate a fresh batch when the cadence says one is due. Only
       public profiles pair; a pair with ANY existing row (open,
       connected, or closed) is never re-suggested. */
    if (me.is_public && generationDue({ openCount, lastCreatedAt, now: new Date() })) {
      const candidates = await db
        .select()
        .from(collabProfilesTable)
        .where(eq(collabProfilesTable.is_public, true))
        .limit(300);
      const existing = new Set(rows.map((r) => pairKey(r.user_a_id, r.user_b_id)));
      const ranked = rankCandidates(
        toFacts(me),
        candidates.map(toFacts),
        existing,
        SUGGESTION_OPEN_TARGET - openCount,
      );
      for (const pair of ranked) {
        const [aId, bId] = canonicalPair(req.userId!, pair.other.userId);
        try {
          await db
            .insert(collabSuggestionsTable)
            .values({
              user_a_id: aId,
              user_b_id: bId,
              score: pair.score,
              reasons: pair.reasons,
            })
            .onConflictDoNothing();
        } catch (err) {
          logger.warn({ err }, "[collab-match] suggestion insert skipped");
        }
      }
      rows = await suggestionRowsFor(req.userId!);
    }

    const visible = rows.filter((r) => r.status === "open" || r.status === "connected");
    const otherIds = visible.map((r) => (r.user_a_id === req.userId ? r.user_b_id : r.user_a_id));
    const profiles = otherIds.length
      ? await db.select().from(collabProfilesTable).where(inArray(collabProfilesTable.user_id, otherIds))
      : [];
    const byUser = new Map(profiles.map((p) => [p.user_id, p]));
    res.json({
      hasProfile: true,
      suggestions: visible.map((r) => {
        const side = sideOf({ userAId: r.user_a_id, userBId: r.user_b_id }, req.userId!);
        const other = byUser.get(r.user_a_id === req.userId ? r.user_b_id : r.user_a_id);
        return {
          id: r.id,
          status: r.status,
          score: r.score,
          reasons: r.reasons ?? [],
          myStatus: side === "a" ? r.a_status : r.b_status,
          introRequestId: r.intro_request_id,
          createdAt: r.created_at,
          other: other
            ? {
                userId: other.user_id,
                displayName: other.display_name,
                niche: other.niche,
                platforms: other.platforms ?? [],
              }
            : null,
        };
      }),
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[collab-match] list failed");
    res.status(500).json({ error: "Could not load your matches" });
  }
});

const MarkSchema = z.object({ mark: z.enum(["interested", "passed"]) });

router.post("/collab-match/:id/mark", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = MarkSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid mark" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(collabSuggestionsTable)
      .where(eq(collabSuggestionsTable.id, String(req.params["id"])))
      .limit(1);
    const row = rows[0];
    const side = row ? sideOf({ userAId: row.user_a_id, userBId: row.user_b_id }, req.userId!) : null;
    if (!row || !side) {
      res.status(404).json({ error: "That match isn't yours to answer" });
      return;
    }
    const next = applySideMark(
      {
        aStatus: row.a_status as "pending" | "interested" | "passed",
        bStatus: row.b_status as "pending" | "interested" | "passed",
        status: row.status as "open" | "connected" | "closed",
      },
      side,
      parsed.data.mark,
    );
    let introRequestId = row.intro_request_id;
    if (next.status === "connected" && !introRequestId) {
      const [aProfile, bProfile] = await Promise.all([
        myCollabProfile(row.user_a_id),
        myCollabProfile(row.user_b_id),
      ]);
      const intro = await db
        .insert(collabRequestsTable)
        .values({
          from_user_id: row.user_a_id,
          to_user_id: row.user_b_id,
          message: houseIntroMessage(
            aProfile?.display_name ?? "Creator A",
            bProfile?.display_name ?? "Creator B",
            row.reasons ?? [],
          ),
          status: "pending",
        })
        .returning({ id: collabRequestsTable.id });
      introRequestId = intro[0]?.id ?? null;
    }
    await db
      .update(collabSuggestionsTable)
      .set({
        a_status: next.aStatus,
        b_status: next.bStatus,
        status: next.status,
        intro_request_id: introRequestId,
        updated_at: new Date(),
      })
      .where(eq(collabSuggestionsTable.id, row.id));
    res.json({ ok: true, status: next.status, introRequestId });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[collab-match] mark failed");
    res.status(500).json({ error: "Could not save your answer" });
  }
});

/* ═══ N17 Fan Links That Prove It ═══════════════════════════════════════
   POST /api/fan-links                    → mint (or return) my link
   GET  /api/fan-links/mine               → my links + proven stats
   GET  /api/fan-links/for-me             → creator view: rollup + fans
   GET  /api/f/:code                      → public redirect, records click
   POST /api/fan-links/attribute-signup   → post-signup attribution
   Arrivals land from the play endpoints (lib/fan-link-events.ts). */

const MintSchema = z.object({
  creatorUserId: z.string().uuid(),
  contentType: z.string(),
  contentId: z.string().trim().max(120).optional().nullable(),
});

router.post("/fan-links", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = MintSchema.safeParse(req.body ?? {});
  if (!parsed.success || !isFanLinkContentType(parsed.data?.contentType)) {
    res.status(400).json({ error: "Invalid fan link" });
    return;
  }
  const { creatorUserId, contentType } = parsed.data;
  const contentId = parsed.data.contentId ?? null;
  if (creatorUserId === req.userId) {
    res.status(400).json({ error: "That's your own content — fan links are for fans to share." });
    return;
  }
  try {
    const creator = await db
      .select({ id: creatorProfilesTable.id })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, creatorUserId))
      .limit(1);
    if (!creator[0]) {
      res.status(404).json({ error: "That creator doesn't have a public page here." });
      return;
    }
    const existing = await db
      .select()
      .from(fanLinksTable)
      .where(
        and(
          eq(fanLinksTable.fan_user_id, req.userId!),
          eq(fanLinksTable.content_type, contentType),
          contentId
            ? eq(fanLinksTable.content_id, contentId)
            : eq(fanLinksTable.creator_user_id, creatorUserId),
        ),
      )
      .limit(5);
    const dupe = existing.find(
      (l) => l.creator_user_id === creatorUserId && l.content_id === contentId,
    );
    if (dupe) {
      res.json({ link: dupe, path: `/api/f/${dupe.code}` });
      return;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = mintFanLinkCode(() => randomInt(0, 1_000_000) / 1_000_000);
      try {
        const inserted = await db
          .insert(fanLinksTable)
          .values({
            code,
            fan_user_id: req.userId!,
            creator_user_id: creatorUserId,
            content_type: contentType,
            content_id: contentId,
          })
          .returning();
        res.json({ link: inserted[0], path: `/api/f/${code}` });
        return;
      } catch {
        /* code collision — mint another */
      }
    }
    res.status(500).json({ error: "Could not mint your link — try again." });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[fan-links] mint failed");
    res.status(500).json({ error: "Could not mint your link" });
  }
});

async function eventsForLinks(linkIds: string[]): Promise<FanLinkEventRow[]> {
  if (!linkIds.length) return [];
  const rows = await db
    .select()
    .from(fanLinkEventsTable)
    .where(inArray(fanLinkEventsTable.fan_link_id, linkIds));
  return rows.map((r) => ({
    fanLinkId: r.fan_link_id,
    kind: r.kind,
    visitorUserId: r.visitor_user_id,
    createdAt: r.created_at,
  }));
}

function toLinkRow(r: typeof fanLinksTable.$inferSelect): FanLinkRow {
  return {
    id: r.id,
    code: r.code,
    fanUserId: r.fan_user_id,
    creatorUserId: r.creator_user_id,
    contentType: r.content_type,
    contentId: r.content_id,
    createdAt: r.created_at,
  };
}

router.get("/fan-links/mine", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const links = await db
      .select()
      .from(fanLinksTable)
      .where(eq(fanLinksTable.fan_user_id, req.userId!))
      .orderBy(desc(fanLinksTable.created_at));
    const events = await eventsForLinks(links.map((l) => l.id));
    res.json({
      links: links.map((l) => ({
        ...toLinkRow(l),
        path: `/api/f/${l.code}`,
        stats: statsForLink(l.id, events),
      })),
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[fan-links] mine failed");
    res.status(500).json({ error: "Could not load your fan links" });
  }
});

router.get("/fan-links/for-me", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const links = await db
      .select()
      .from(fanLinksTable)
      .where(eq(fanLinksTable.creator_user_id, req.userId!));
    const events = await eventsForLinks(links.map((l) => l.id));
    const rollup = rollupForCreator(links.map(toLinkRow), events, req.userId!);
    const fanIds = [...new Set(links.map((l) => l.fan_user_id))];
    const fanProfiles = fanIds.length
      ? await db
          .select({ userId: creatorProfilesTable.userId, displayName: creatorProfilesTable.displayName })
          .from(creatorProfilesTable)
          .where(inArray(creatorProfilesTable.userId, fanIds))
      : [];
    const nameOf = new Map(fanProfiles.map((p) => [p.userId, p.displayName]));
    res.json({
      rollup,
      topFans: rollup.topFans.map((f) => ({
        ...f,
        displayName: nameOf.get(f.fanUserId) ?? "A fan",
      })),
      links: links.map((l) => ({
        ...toLinkRow(l),
        fanDisplayName: nameOf.get(l.fan_user_id) ?? "A fan",
        stats: statsForLink(l.id, events),
      })),
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[fan-links] for-me failed");
    res.status(500).json({ error: "Could not load your fan links" });
  }
});

/* Optional auth for the public redirect: a signed-in clicker is a
   known visitor; anonymous clicks still count (visitor null). */
async function optionalVisitorId(req: Request): Promise<string | null> {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "";
    const key = process.env["SUPABASE_ANON_KEY"] ?? process.env["VITE_SUPABASE_ANON_KEY"] ?? "";
    if (!url || !key) return null;
    const client = createClient(url, key, { auth: { persistSession: false } });
    const { data: { user } } = await client.auth.getUser(authHeader.slice(7));
    return user?.id ?? null;
  } catch {
    return null;
  }
}

router.get("/f/:code", publicApiLimiter, async (req: Request, res: Response) => {
  const code = String(req.params["code"] ?? "");
  if (!isFanLinkCode(code)) {
    res.redirect(302, "/");
    return;
  }
  try {
    const link = await loadFanLinkByCode(code);
    if (!link) {
      res.redirect(302, "/");
      return;
    }
    const creator = await db
      .select({ slug: creatorProfilesTable.slug })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, link.creator_user_id))
      .limit(1);
    if (!creator[0]) {
      res.redirect(302, "/");
      return;
    }
    const visitorUserId = await optionalVisitorId(req);
    /* Click is recorded before the redirect — a proven touch, counted
       once per landing. Best-effort: never block the fan's trip. */
    await recordFanLinkClick({ fanLinkId: link.id, visitorUserId });
    res.redirect(
      302,
      fanLinkLandingPath({
        creatorSlug: creator[0].slug,
        contentType: link.content_type,
        contentId: link.content_id,
        code: link.code,
      }),
    );
  } catch (err) {
    logger.error({ err }, "[fan-links] redirect failed");
    res.redirect(302, "/");
  }
});

const AttributeSchema = z.object({ code: z.string() });

router.post("/fan-links/attribute-signup", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = AttributeSchema.safeParse(req.body ?? {});
  if (!parsed.success || !isFanLinkCode(parsed.data.code)) {
    res.status(400).json({ error: "Invalid fan link code" });
    return;
  }
  const result = await attributeFanLinkSignup({ code: parsed.data.code, newUserId: req.userId! });
  if (result === "refused") {
    res.status(400).json({ error: "That signup can't be attributed to this link." });
    return;
  }
  res.json({ ok: true, alreadyAttributed: result === "already" });
});

/* ═══ N16 Audience Room ═════════════════════════════════════════════════
   GET /api/audience-room → last 28 days of MY plays: best hours (UTC),
   declared-source breakdown, untracked count, fan city honestly
   unavailable. Only plays of my own media count. */
const AUDIENCE_WINDOW_DAYS = 28;

router.get("/audience-room", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const profiles = await db
      .select({ id: creatorProfilesTable.id })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, req.userId!))
      .limit(1);
    if (!profiles[0]) {
      res.status(404).json({ error: "Set up your creator profile to open your Audience Room." });
      return;
    }
    const profileId = profiles[0].id;
    const [tracks, videos] = await Promise.all([
      db.select({ id: profileTracksTable.id }).from(profileTracksTable).where(eq(profileTracksTable.profileId, profileId)),
      db.select({ id: profileVideosTable.id }).from(profileVideosTable).where(eq(profileVideosTable.profileId, profileId)),
    ]);
    const mediaIds = [...tracks.map((t) => t.id), ...videos.map((v) => v.id)];
    if (!mediaIds.length) {
      res.json({ windowDays: AUDIENCE_WINDOW_DAYS, ...summarizeAudienceRoom([]) });
      return;
    }
    const since = new Date(Date.now() - AUDIENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const plays = await db
      .select({ playedAt: playEventsTable.playedAt, source: playEventsTable.source })
      .from(playEventsTable)
      .where(and(inArray(playEventsTable.mediaId, mediaIds), gte(playEventsTable.playedAt, since)))
      .limit(5000);
    res.json({ windowDays: AUDIENCE_WINDOW_DAYS, ...summarizeAudienceRoom(plays) });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[audience-room] load failed");
    res.status(500).json({ error: "Could not load your Audience Room" });
  }
});

export default router;
