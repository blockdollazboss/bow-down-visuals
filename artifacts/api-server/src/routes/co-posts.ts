import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  db,
  postsTable,
  postCoAuthorsTable,
  collabRequestsTable,
  creatorProfilesTable,
  notificationsTable,
  contentWarningPreferencesTable,
  CONTENT_WARNING_LABELS,
  normalizeContentWarnings,
  type Attachment,
} from "@workspace/db";
import { contentCoverFor } from "../lib/content-warnings";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { mirrorExternalMediaUrl } from "../lib/mirrorMedia";
import {
  applyCoPostAction,
  deriveCoPostState,
  initialCoPost,
  isCoPostVisibleOnProfile,
  isMissingCoPostTable,
  sharedEngagement,
  sideForUser,
  CoPostError,
  CO_POST_NOT_READY,
  type CoPost,
} from "../lib/co-posts";
import {
  coAuthorSummaries,
  fetchProfilesById,
  loadCoPost,
  probeCoPostTable,
  rowsToCoPost,
} from "../lib/co-posts-db";

/* ─── Co-posts (Stack-100 #3, #24) ──────────────────────────────────────────
   The payoff step of the Collabs flow: an accepted collab (or a direct
   invite) becomes ONE Feed post on BOTH creators' profiles.

   POST   /api/co-posts                      create (initiator side is
                                              accepted; co-author side
                                              starts pending — NOT live)
   GET    /api/co-posts/mine                 every co-post I'm a side of,
                                              incl. pending approvals
   GET    /api/co-posts/by-profile/:id       a profile's LIVE co-posts
                                              (that side still standing)
   POST   /api/co-posts/:postId/accept       pending side approves → the
                                              post goes live when both have
   POST   /api/co-posts/:postId/decline      pending side says no (pre-live
                                              only; the co-post ends, it
                                              never becomes a solo post)
   POST   /api/co-posts/:postId/withdraw     accepted side withdraws THEIR
                                              side only — the post leaves
                                              their profile, the other
                                              creator keeps theirs

   FREE throughout: co-posting is pure interface (DB write + read), no
   compute — same pricing logic as collab requests. No price/fee exists
   here and none was invented.

   Co-posts are PUBLIC-audience in v1: the Feed's read-time audience
   gate keys off the primary author, so a followers-scoped co-post
   could silently hide from the co-author's own followers. Public-only
   keeps "both audiences see it" literally true; the UI says so.

   Until held migration 0205 (post_co_authors) lands, writes answer
   503 co_post_not_ready BEFORE creating anything. */

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const attachmentSchema = z
  .object({
    kind: z.string(),
    url: z.string().max(2000).optional(),
    id: z.string().max(100).optional(),
    title: z.string().max(200).optional(),
    thumb: z.string().max(2000).optional(),
    artwork: z.string().max(2000).optional(),
    image: z.string().max(2000).optional(),
    artistSlug: z.string().max(60).optional(),
    kindSlug: z.string().max(60).optional(),
    storeSlug: z.string().max(60).optional(),
    date: z.string().max(60).optional(),
    venue: z.string().max(200).optional(),
  })
  .passthrough();

const createCoPostSchema = z.object({
  body: z.string().trim().min(1).max(500),
  media_urls: z.array(attachmentSchema).max(10).optional().default([]),
  /* Identify the co-author by account (the Collabs surface knows user
     ids) or by creator profile — either is accepted, never both-wrong. */
  co_author_user_id: z.string().uuid().optional(),
  co_author_profile_id: z.string().uuid().optional(),
  /* When the co-post grows out of an accepted collab request, its id
     rides along as provenance — validated against the two parties. */
  collab_request_id: z.string().uuid().optional().nullable(),
  /* Content warnings (Wave 4 #40): the initiating author's own labels
     for the co-post — same author-only rule as every post. */
  content_warnings: z.array(z.enum(CONTENT_WARNING_LABELS)).max(CONTENT_WARNING_LABELS.length).optional().default([]),
});

function assertLinkable(att: z.infer<typeof attachmentSchema>) {
  /* Same link-graph guard as POST /posts: an attachment that promises
     a destination must carry it. */
  if (att.kind === "product" && !(att.id && att.kindSlug)) {
    throw new Error("Product attachments must include id + kindSlug so they link to /store/buy/:kind/:id.");
  }
  if ((att.kind === "track" || att.kind === "watch") && !att.id) {
    throw new Error("Sound/video attachments must include the media id so they link to /track/:id or /watch/:id.");
  }
  if (att.kind === "event" && !att.id) {
    throw new Error("Event attachments must include the event id so they link to /shows.");
  }
}

const ATTACHMENT_URL_KIND: Record<string, "image" | "video" | "audio"> = {
  track: "audio",
  watch: "video",
};

async function mirrorAttachments<T extends Record<string, unknown>>(atts: T[], ownerKey: string): Promise<T[]> {
  return Promise.all(
    atts.map(async (att) => {
      const out: Record<string, unknown> = { ...att };
      const kind = ATTACHMENT_URL_KIND[String(att["kind"] ?? "")] ?? "image";
      if (typeof out["url"] === "string") {
        out["url"] = (await mirrorExternalMediaUrl(out["url"], { kind, ownerKey })) ?? out["url"];
      }
      for (const f of ["thumb", "artwork", "image"] as const) {
        if (typeof out[f] === "string") {
          out[f] = (await mirrorExternalMediaUrl(out[f] as string, { kind: "image", ownerKey })) ?? out[f];
        }
      }
      return out as T;
    }),
  );
}

async function notifyUser(userId: string, kind: string, title: string, body: string, link: string) {
  try {
    await db.insert(notificationsTable).values({ userId, kind, title, body, link });
  } catch {
    /* best-effort — never break the write path over a notification */
  }
}

async function myProfile(userId: string) {
  const [p] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  return p ?? null;
}

type PostRow = typeof postsTable.$inferSelect;

async function coPostDto(post: PostRow, co: CoPost, viewerUserId: string | null) {
  const profiles = await fetchProfilesById(co.sides.map((s) => s.profileId));
  const viewerSide = viewerUserId ? sideForUser(co, viewerUserId) : null;
  /* Content warnings (Wave 4 #40): this DTO ships media_urls raw, so
     the cover is applied here too — the same rule as enrichPosts. A
     side of the co-post is a creator of it (the invited co-author must
     see exactly what they're approving), so sides are never covered;
     everyone else gets the covered DTO and the reveal door. */
  const cwLabels = normalizeContentWarnings(post.contentWarnings ?? []);
  let viewerHiddenLabels: ReturnType<typeof normalizeContentWarnings> = [];
  if (viewerUserId && cwLabels.length > 0 && !viewerSide) {
    const [pref] = await db.select().from(contentWarningPreferencesTable)
      .where(eq(contentWarningPreferencesTable.userId, viewerUserId)).limit(1);
    viewerHiddenLabels = normalizeContentWarnings(pref?.hiddenLabels ?? []);
  }
  const cwCover = contentCoverFor({
    labels: cwLabels,
    mediaCount: (post.mediaUrls ?? []).length,
    isAuthor: !!viewerSide,
    viewerHiddenLabels,
  });
  return {
    id: post.id,
    body: post.body,
    media_urls: cwCover ? [] : (post.mediaUrls ?? []),
    content_warnings: cwLabels,
    content_cover: cwCover,
    audience: post.audience,
    created_at: post.createdAt,
    is_co_post: true,
    co_post_state: deriveCoPostState(co),
    /* ONE engagement record — the post row's own counts, identical on
       both profiles. Never summed across authors (lib/co-posts). */
    engagement: sharedEngagement(post),
    like_count: post.likeCount,
    reply_count: post.replyCount,
    repost_count: post.repostCount,
    authors: coAuthorSummaries(co, profiles),
    viewer_side: viewerSide
      ? { role: viewerSide.role, status: viewerSide.status, profile_id: viewerSide.profileId }
      : null,
  };
}

function notReady(res: Response) {
  return res.status(503).json({ ...CO_POST_NOT_READY });
}

/* POST /api/co-posts — create a co-post (pending the co-author's OK) */
router.post("/co-posts", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = createCoPostSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid", details: parsed.error.issues });
    }
    const d = parsed.data;
    if (!d.co_author_user_id && !d.co_author_profile_id) {
      return res.status(400).json({
        error: "no_co_author",
        message: "Pick the creator you're co-posting with.",
      });
    }
    try {
      d.media_urls.forEach(assertLinkable);
    } catch (e) {
      return res.status(400).json({ error: "unlinked_attachment", message: (e as Error).message });
    }

    const me = await myProfile(req.userId!);
    if (!me) {
      return res.status(403).json({
        error: "no_profile",
        message: "Create your creator profile first — a co-post lives on both creators' profiles.",
      });
    }

    /* Resolve the co-author's CREATOR profile (posts live on creator
       profiles, not collab-finder profiles). */
    let coProfile: typeof creatorProfilesTable.$inferSelect | null = null;
    if (d.co_author_profile_id) {
      const [p] = await db
        .select()
        .from(creatorProfilesTable)
        .where(eq(creatorProfilesTable.id, d.co_author_profile_id))
        .limit(1);
      coProfile = p ?? null;
    } else if (d.co_author_user_id) {
      coProfile = await myProfile(d.co_author_user_id);
    }
    if (!coProfile) {
      return res.status(400).json({
        error: "co_author_no_profile",
        message:
          "That creator hasn't set up their creator profile yet — a co-post lives on both creator profiles, so they need one first.",
      });
    }
    if (coProfile.id === me.id) {
      return res.status(400).json({ error: "same_creator", message: "A co-post needs two different creators." });
    }

    /* Provenance: a collab_request_id must name an ACCEPTED collab
       between exactly these two accounts (either direction). */
    if (d.collab_request_id) {
      const [cr] = await db
        .select()
        .from(collabRequestsTable)
        .where(eq(collabRequestsTable.id, d.collab_request_id))
        .limit(1);
      const parties = cr ? [cr.from_user_id, cr.to_user_id].sort().join(":") : "";
      const us = [req.userId!, coProfile.userId].sort().join(":");
      if (!cr || cr.status !== "accepted" || parties !== us) {
        return res.status(400).json({
          error: "collab_not_accepted",
          message: "That collab isn't an accepted collab between you two — co-posts start from an accepted collab, or invite a co-author directly.",
        });
      }
    }

    /* Migration gate: probe BEFORE writing anything. Pre-0205 this is
       the one honest answer — no post, no sides, no notification. */
    try {
      await probeCoPostTable();
    } catch (err) {
      if (isMissingCoPostTable(err)) return notReady(res);
      throw err;
    }

    const [post] = await db
      .insert(postsTable)
      .values({
        profileId: me.id,
        body: d.body,
        mediaUrls: (await mirrorAttachments(d.media_urls, req.userId!)) as unknown as Attachment[],
        kind: "post",
        audience: "public",
        contentWarnings: normalizeContentWarnings(d.content_warnings),
      })
      .returning();

    const co = initialCoPost(post.id, { profileId: me.id, userId: req.userId! }, { profileId: coProfile.id, userId: coProfile.userId });
    await db.insert(postCoAuthorsTable).values(
      co.sides.map((s) => ({
        post_id: post.id,
        profile_id: s.profileId,
        user_id: s.userId,
        role: s.role,
        status: s.status,
        accepted_at: s.acceptedAt instanceof Date ? s.acceptedAt : s.acceptedAt ? new Date(s.acceptedAt) : null,
        responded_at: s.role === "author" ? new Date() : null,
        collab_request_id: d.collab_request_id ?? null,
      })),
    );

    await notifyUser(
      coProfile.userId,
      "co_post_invite",
      `${me.displayName} invited you to co-post 🤝`,
      "It goes live on both profiles only when you approve it — one post, one shared set of likes and comments.",
      "/collabs?tab=coposts",
    );

    const dto = await coPostDto(post, co, req.userId!);
    return res.status(201).json({ post: dto });
  } catch (err) {
    if (isMissingCoPostTable(err)) return notReady(res);
    logger.error({ err }, "[co-posts] create failed");
    return res.status(500).json({ error: "co_post_failed", message: "Couldn't create that co-post." });
  }
});

/* GET /api/co-posts/mine — my co-posts in every state (approval inbox) */
router.get("/co-posts/mine", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  try {
    let sideRows: Array<typeof postCoAuthorsTable.$inferSelect>;
    try {
      sideRows = await db
        .select()
        .from(postCoAuthorsTable)
        .where(eq(postCoAuthorsTable.user_id, req.userId!))
        .orderBy(desc(postCoAuthorsTable.created_at))
        .limit(100);
    } catch (err) {
      if (isMissingCoPostTable(err)) return res.json({ posts: [], pending_setup: true });
      throw err;
    }
    if (sideRows.length === 0) return res.json({ posts: [] });
    const postIds = [...new Set(sideRows.map((r) => r.post_id))];
    const [posts, allSides] = await Promise.all([
      db.select().from(postsTable).where(inArray(postsTable.id, postIds)),
      db.select().from(postCoAuthorsTable).where(inArray(postCoAuthorsTable.post_id, postIds)),
    ]);
    const postById = new Map(posts.map((p) => [p.id, p]));
    const sidesByPost = new Map<string, Array<typeof postCoAuthorsTable.$inferSelect>>();
    for (const r of allSides) {
      const arr = sidesByPost.get(r.post_id) ?? [];
      arr.push(r);
      sidesByPost.set(r.post_id, arr);
    }
    const out = [];
    for (const postId of postIds) {
      const post = postById.get(postId);
      const rows = sidesByPost.get(postId) ?? [];
      if (!post || rows.length === 0) continue;
      const co = rowsToCoPost(postId, rows);
      if (!co) continue;
      out.push(await coPostDto(post, co, req.userId!));
    }
    out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return res.json({ posts: out });
  } catch (err) {
    logger.error({ err }, "[co-posts] mine failed");
    return res.status(500).json({ error: "co_posts_failed", message: "Couldn't load your co-posts." });
  }
});

/* GET /api/co-posts/by-profile/:profileId — that profile's LIVE co-posts.
   A withdrawn side's profile never appears here (their withdrawal
   removed it); the other side's profile still lists it. Public read —
   only posts that went live and still stand on this side are served. */
router.get("/co-posts/by-profile/:profileId", async (req: Request, res: Response) => {
  try {
    const profileId = String(req.params["profileId"] ?? "");
    if (!UUID_RE.test(profileId)) return res.status(400).json({ error: "invalid_id" });
    let sideRows: Array<typeof postCoAuthorsTable.$inferSelect>;
    try {
      sideRows = await db
        .select()
        .from(postCoAuthorsTable)
        .where(and(eq(postCoAuthorsTable.profile_id, profileId), eq(postCoAuthorsTable.status, "accepted")))
        .orderBy(desc(postCoAuthorsTable.created_at))
        .limit(100);
    } catch (err) {
      if (isMissingCoPostTable(err)) return res.json({ posts: [] });
      throw err;
    }
    if (sideRows.length === 0) return res.json({ posts: [] });
    const postIds = [...new Set(sideRows.map((r) => r.post_id))];
    const [posts, allSides] = await Promise.all([
      db.select().from(postsTable).where(inArray(postsTable.id, postIds)),
      db.select().from(postCoAuthorsTable).where(inArray(postCoAuthorsTable.post_id, postIds)),
    ]);
    const sidesByPost = new Map<string, Array<typeof postCoAuthorsTable.$inferSelect>>();
    for (const r of allSides) {
      const arr = sidesByPost.get(r.post_id) ?? [];
      arr.push(r);
      sidesByPost.set(r.post_id, arr);
    }
    const out = [];
    for (const post of posts) {
      if (post.removedAt) continue; // moderation removal wins over co-post visibility
      const rows = sidesByPost.get(post.id) ?? [];
      if (rows.length === 0) continue;
      const co = rowsToCoPost(post.id, rows);
      if (!co || !isCoPostVisibleOnProfile(co, profileId)) continue;
      out.push(await coPostDto(post, co, null));
    }
    out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return res.json({ posts: out });
  } catch (err) {
    logger.error({ err }, "[co-posts] by-profile failed");
    return res.status(500).json({ error: "co_posts_failed", message: "Couldn't load co-posts for that profile." });
  }
});

/* Shared accept / decline / withdraw handler — the pure machine decides
   whether the transition is legal; only the ACTOR's side row is ever
   written, so one side can never consent or withdraw for the other. */
function actionRoute(action: "accept" | "decline" | "withdraw") {
  return async (req: Request, res: Response) => {
    try {
      const postId = String(req.params["postId"] ?? "");
      if (!UUID_RE.test(postId)) return res.status(400).json({ error: "invalid_id" });

      let co: CoPost | null;
      try {
        co = await loadCoPost(postId);
      } catch (err) {
        if (isMissingCoPostTable(err)) return notReady(res);
        throw err;
      }
      if (!co) return res.status(404).json({ error: "not_found", message: "That co-post doesn't exist." });

      const mySide = sideForUser(co, req.userId!);
      if (!mySide) {
        return res.status(403).json({ error: "not_a_co_author", message: "Only the two creators on this co-post can do that." });
      }

      let next: CoPost;
      try {
        next = applyCoPostAction(co, mySide.profileId, action);
      } catch (e) {
        if (e instanceof CoPostError) {
          return res.status(409).json({ error: e.code, message: e.message });
        }
        throw e;
      }

      const changed = next.sides.find((s) => s.profileId === mySide.profileId)!;
      const now = new Date();
      await db
        .update(postCoAuthorsTable)
        .set({
          status: changed.status,
          accepted_at:
            changed.acceptedAt instanceof Date
              ? changed.acceptedAt
              : changed.acceptedAt
                ? new Date(changed.acceptedAt)
                : null,
          responded_at: action === "accept" || action === "decline" ? now : undefined,
          withdrawn_at: action === "withdraw" ? now : undefined,
          updated_at: now,
        })
        .where(
          and(
            eq(postCoAuthorsTable.post_id, postId),
            eq(postCoAuthorsTable.profile_id, mySide.profileId),
          ),
        );

      /* Tell the OTHER side what happened — their state changed too
         (live / ended / one-sided), even though their row didn't. */
      const [post] = await db.select().from(postsTable).where(eq(postsTable.id, postId)).limit(1);
      const other = next.sides.find((s) => s.profileId !== mySide.profileId);
      if (post && other) {
        const state = deriveCoPostState(next);
        const titles: Record<string, string> = {
          accept:
            state === "live"
              ? "Your co-post is live on both profiles 🤝"
              : "Your co-author approved the co-post 🤝",
          decline: "Your co-post invite was declined",
          withdraw:
            state === "live_one_side"
              ? "Your co-author withdrew their side of your co-post"
              : "Your co-post was withdrawn before it went live",
        };
        const bodies: Record<string, string> = {
          accept: "One post, both profiles, one shared set of likes and comments.",
          decline: "A declined co-post never goes live and never becomes a solo post — you can still post it yourself from the composer.",
          withdraw:
            state === "live_one_side"
              ? "The post leaves their profile only — it stays live on yours, with the same likes and comments."
              : "The co-post ended before going live.",
        };
        await notifyUser(other.userId, `co_post_${action}`, titles[action], bodies[action], "/collabs?tab=coposts");
        const dto = await coPostDto(post, next, req.userId!);
        return res.json({ post: dto });
      }
      return res.json({ ok: true, state: deriveCoPostState(next) });
    } catch (err) {
      if (isMissingCoPostTable(err)) return notReady(res);
      logger.error({ err, action }, "[co-posts] action failed");
      return res.status(500).json({ error: "co_post_action_failed", message: "Couldn't update that co-post." });
    }
  };
}

router.post("/co-posts/:postId/accept", publicApiLimiter, requireAuth, actionRoute("accept"));
router.post("/co-posts/:postId/decline", publicApiLimiter, requireAuth, actionRoute("decline"));
router.post("/co-posts/:postId/withdraw", publicApiLimiter, requireAuth, actionRoute("withdraw"));

export default router;
