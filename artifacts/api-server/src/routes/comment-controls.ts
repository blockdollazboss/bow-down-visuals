import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  creatorProfilesTable,
  profileTracksTable,
  profileVideosTable,
  profileCommentsTable,
  mediaCommentsTable,
  creatorCommentSettingsTable,
} from "@workspace/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import {
  normalizeSettings,
  normalizeBlockedWords,
  normalizeCommentStatus,
  transitionFor,
  isMissingCommentControlsSchema,
  COMMENT_CONTROL_ACTIONS,
  HELD_COPY,
  type CommentControlAction,
} from "../lib/comment-controls";

/**
 * Creator comment controls (Stack-100 #3, #27) — the creator-owned half
 * of comment moderation. The platform's AI flagging pass is separate;
 * everything here is the CREATOR acting on comments on THEIR OWN
 * content, enforced server-side on every route:
 *
 *   GET  /creator-profiles/me/comment-settings   own settings (defaults OFF)
 *   PUT  /creator-profiles/me/comment-settings   save hold mode + blocklist
 *   GET  /creator-profiles/me/held-comments      own held queue (wall+media)
 *   POST /creator-comments/:commentId/action     pin|unpin|hide|unhide|
 *                                                approve|reject (owner only)
 *
 * Settings and the queue are keyed to the CALLER's own creator profile —
 * there is no parameter that can point them at someone else's content.
 * The action route resolves the comment's owning profile from the
 * comment row itself and 403s when it is not the caller's.
 *
 * A held comment is a DELAY, never a silent deletion; reject moves a
 * held comment to hidden (still visible to creator + author), never a
 * delete. No route in this file deletes a comment. Free: no charges.
 *
 * Until the held migration lands (.lane/MIGRATION-NEEDED.md), reads of
 * settings degrade to OFF defaults and writes that need the new schema
 * answer 503 comment_controls_not_ready.
 */

const router = Router();

const NOT_READY = {
  error: "comment_controls_not_ready",
  message: "Creator comment controls are not switched on for this database yet — nothing was changed.",
};

async function getOwnProfile(userId: string) {
  const [row] = await db.select().from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId)).limit(1);
  return row ?? null;
}

function commentDto(
  c: { id: string; authorUserId: string; body: string; createdAt: Date | string; status?: string | null; pinned?: boolean | null; heldReason?: string | null },
  extra: Record<string, unknown>,
) {
  const status = normalizeCommentStatus(c.status);
  return {
    id: c.id,
    body: c.body,
    author_user_id: c.authorUserId,
    user_id: c.authorUserId,
    status,
    is_held: status === "held",
    is_hidden: status === "hidden",
    held_reason: c.heldReason ?? null,
    held_copy: status === "held" ? HELD_COPY : null,
    pinned: c.pinned === true,
    is_pinned: c.pinned === true,
    created_at: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
    ...extra,
  };
}

/* ── Settings ─────────────────────────────────────────────────────────────── */

router.get("/creator-profiles/me/comment-settings", requireAuth, async (req, res) => {
  try {
    const profile = await getOwnProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "Set up your creator profile first — comment controls live on it." });
      return;
    }
    let settings = normalizeSettings(null);
    try {
      const [row] = await db.select().from(creatorCommentSettingsTable)
        .where(eq(creatorCommentSettingsTable.profileId, profile.id)).limit(1);
      settings = normalizeSettings(row ?? null);
    } catch (err) {
      if (!isMissingCommentControlsSchema(err)) throw err;
      /* pre-migration: defaults (OFF) are the truth */
    }
    res.json({
      settings: {
        hold_mode: settings.holdMode,
        blocked_words: settings.blockedWords,
        /* Defaults OFF / creator-chosen, stated in the payload so every
           client renders the same promise. */
        defaults_off: settings.holdMode === "off" && settings.blockedWords.length === 0,
        held_copy: HELD_COPY,
      },
    });
  } catch (err) {
    req.log.error({ err }, "comment settings GET error");
    res.status(500).json({ error: "Comment settings wouldn't load. Try again." });
  }
});

const settingsSchema = z.object({
  hold_mode: z.enum(["off", "all", "first_time"]).optional(),
  blocked_words: z.array(z.string().trim().max(60)).max(50).optional(),
});

router.put("/creator-profiles/me/comment-settings", requireAuth, async (req, res) => {
  try {
    const profile = await getOwnProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "Set up your creator profile first — comment controls live on it." });
      return;
    }
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Those comment settings didn't pass the vibe check.", details: parsed.error.issues });
      return;
    }
    let current = normalizeSettings(null);
    try {
      const [row] = await db.select().from(creatorCommentSettingsTable)
        .where(eq(creatorCommentSettingsTable.profileId, profile.id)).limit(1);
      current = normalizeSettings(row ?? null);
    } catch (err) {
      if (!isMissingCommentControlsSchema(err)) throw err;
      res.status(503).json(NOT_READY);
      return;
    }
    const next = {
      holdMode: parsed.data.hold_mode ?? current.holdMode,
      blockedWords: parsed.data.blocked_words !== undefined
        ? normalizeBlockedWords(parsed.data.blocked_words)
        : current.blockedWords,
    };
    try {
      await db.insert(creatorCommentSettingsTable)
        .values({ profileId: profile.id, holdMode: next.holdMode, blockedWords: next.blockedWords })
        .onConflictDoUpdate({
          target: creatorCommentSettingsTable.profileId,
          set: { holdMode: next.holdMode, blockedWords: next.blockedWords, updatedAt: new Date() },
        });
    } catch (err) {
      if (isMissingCommentControlsSchema(err)) {
        res.status(503).json(NOT_READY);
        return;
      }
      throw err;
    }
    res.json({
      settings: {
        hold_mode: next.holdMode,
        blocked_words: next.blockedWords,
        defaults_off: next.holdMode === "off" && next.blockedWords.length === 0,
        held_copy: HELD_COPY,
      },
    });
  } catch (err) {
    req.log.error({ err }, "comment settings PUT error");
    res.status(500).json({ error: "Comment settings didn't save. Try again." });
  }
});

/* ── Held queue ───────────────────────────────────────────────────────────── */

router.get("/creator-profiles/me/held-comments", requireAuth, async (req, res) => {
  try {
    const profile = await getOwnProfile(req.userId!);
    if (!profile) {
      res.status(404).json({ error: "Set up your creator profile first — comment controls live on it." });
      return;
    }
    const items: Array<Record<string, unknown>> = [];
    try {
      const wallHeld = await db.select().from(profileCommentsTable)
        .where(and(eq(profileCommentsTable.profileId, profile.id), eq(profileCommentsTable.status, "held")))
        .orderBy(desc(profileCommentsTable.createdAt));
      for (const c of wallHeld) {
        items.push(commentDto(c, { surface: "wall", profile_id: profile.id, media_id: null, media_kind: null, media_title: null }));
      }
      const tracks = await db.select().from(profileTracksTable)
        .where(eq(profileTracksTable.profileId, profile.id));
      const videos = await db.select().from(profileVideosTable)
        .where(eq(profileVideosTable.profileId, profile.id));
      const mediaMeta = new Map<string, { kind: string; title: string }>();
      for (const t of tracks) mediaMeta.set(t.id, { kind: "track", title: t.title });
      for (const v of videos) mediaMeta.set(v.id, { kind: "video", title: v.title });
      if (mediaMeta.size > 0) {
        const mediaHeld = await db.select().from(mediaCommentsTable)
          .where(and(inArray(mediaCommentsTable.mediaId, [...mediaMeta.keys()]), eq(mediaCommentsTable.status, "held")))
          .orderBy(desc(mediaCommentsTable.createdAt));
        for (const c of mediaHeld) {
          const meta = mediaMeta.get(c.mediaId);
          items.push(commentDto(c, {
            surface: "media", profile_id: profile.id,
            media_id: c.mediaId, media_kind: meta?.kind ?? c.kind, media_title: meta?.title ?? null,
          }));
        }
      }
    } catch (err) {
      if (isMissingCommentControlsSchema(err)) {
        res.status(503).json(NOT_READY);
        return;
      }
      throw err;
    }
    items.sort((a, b) => String(b["created_at"]).localeCompare(String(a["created_at"])));
    res.json({ comments: items, held_copy: HELD_COPY });
  } catch (err) {
    req.log.error({ err }, "held comments GET error");
    res.status(500).json({ error: "The held queue wouldn't load. Try again." });
  }
});

/* ── Actions (pin / hide / approve / reject …) ────────────────────────────── */

const actionSchema = z.object({
  surface: z.enum(["wall", "media"]),
  action: z.enum(COMMENT_CONTROL_ACTIONS as unknown as [string, ...string[]]),
});

/** Media comment_count moves only when a comment crosses public<->non-public. */
async function bumpMediaCounter(kind: string, mediaId: string, delta: 1 | -1): Promise<void> {
  const table = kind === "track" ? "profile_tracks" : "profile_videos";
  await db.execute(sql`
    UPDATE ${sql.identifier(table)}
    SET ${sql.identifier("comment_count")} = GREATEST(${sql.identifier("comment_count")} + ${delta}, 0)
    WHERE ${sql.identifier("id")} = ${mediaId}
  `);
}

router.post("/creator-comments/:commentId/action", requireAuth, async (req, res) => {
  try {
    const parsed = actionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "That comment action didn't pass the vibe check.", details: parsed.error.issues });
      return;
    }
    const action = parsed.data.action as CommentControlAction;
    const commentId = String(req.params["commentId"]);

    type AnyComment = typeof profileCommentsTable.$inferSelect & { kind?: string; mediaId?: string; profileId?: string };
    let comment: AnyComment | null = null;
    let ownerProfileId: string | null = null;
    let mediaKind: string | null = null;
    let mediaId: string | null = null;

    if (parsed.data.surface === "wall") {
      const [row] = await db.select().from(profileCommentsTable)
        .where(eq(profileCommentsTable.id, commentId)).limit(1);
      if (row) {
        comment = row as AnyComment;
        ownerProfileId = row.profileId;
      }
    } else {
      const [row] = await db.select().from(mediaCommentsTable)
        .where(eq(mediaCommentsTable.id, commentId)).limit(1);
      if (row) {
        comment = row as AnyComment;
        mediaKind = row.kind;
        mediaId = row.mediaId;
        const table = row.kind === "track" ? profileTracksTable : profileVideosTable;
        const [media] = await db.select().from(table)
          .where(eq(table.id, row.mediaId)).limit(1);
        ownerProfileId = media?.profileId ?? null;
      }
    }
    if (!comment || !ownerProfileId) {
      res.status(404).json({ error: "That comment doesn't exist here. Dead link, chief." });
      return;
    }

    /* OWNERSHIP: the comment's owning profile must be the caller's own.
       Resolved from the comment row itself — never from client input. */
    const [ownerProfile] = await db.select().from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.id, ownerProfileId)).limit(1);
    if (!ownerProfile || ownerProfile.userId !== req.userId) {
      res.status(403).json({ error: "Those aren't your comments to control — creators control comments on their own content only." });
      return;
    }

    const transition = transitionFor(action, comment);
    if (!transition) {
      res.status(409).json({
        error: "action_not_applicable",
        message: `You can't ${action} a comment that is ${normalizeCommentStatus(comment.status)}${comment.pinned ? " (pinned)" : ""}.`,
      });
      return;
    }

    try {
      if (parsed.data.surface === "wall") {
        if (action === "pin") {
          /* One pinned comment per wall: clear the previous pin first. */
          await db.update(profileCommentsTable)
            .set({ pinned: false, pinnedAt: null })
            .where(and(eq(profileCommentsTable.profileId, ownerProfileId), eq(profileCommentsTable.pinned, true)));
        }
        await db.update(profileCommentsTable)
          .set({
            status: transition.status,
            pinned: transition.pinned,
            pinnedAt: transition.pinned ? new Date() : null,
            heldReason: transition.status === "public" ? null : (comment.heldReason ?? null),
          })
          .where(eq(profileCommentsTable.id, commentId));
      } else {
        if (action === "pin") {
          await db.update(mediaCommentsTable)
            .set({ pinned: false, pinnedAt: null })
            .where(and(
              eq(mediaCommentsTable.kind, mediaKind!),
              eq(mediaCommentsTable.mediaId, mediaId!),
              eq(mediaCommentsTable.pinned, true),
            ));
        }
        await db.update(mediaCommentsTable)
          .set({
            status: transition.status,
            pinned: transition.pinned,
            pinnedAt: transition.pinned ? new Date() : null,
            heldReason: transition.status === "public" ? null : (comment.heldReason ?? null),
          })
          .where(eq(mediaCommentsTable.id, commentId));
        const wasPublic = normalizeCommentStatus(comment.status) === "public";
        const isPublic = transition.status === "public";
        if (mediaKind && mediaId && wasPublic !== isPublic) {
          await bumpMediaCounter(mediaKind, mediaId, isPublic ? 1 : -1);
        }
      }
    } catch (err) {
      if (isMissingCommentControlsSchema(err)) {
        res.status(503).json(NOT_READY);
        return;
      }
      throw err;
    }

    res.json({
      comment: commentDto(
        { ...comment, status: transition.status, pinned: transition.pinned, heldReason: transition.status === "public" ? null : (comment.heldReason ?? null) },
        { surface: parsed.data.surface, profile_id: ownerProfileId, media_id: mediaId, media_kind: mediaKind },
      ),
      action,
    });
  } catch (err) {
    req.log.error({ err }, "comment action error");
    res.status(500).json({ error: "That comment action didn't stick. Try again." });
  }
});

export default router;
