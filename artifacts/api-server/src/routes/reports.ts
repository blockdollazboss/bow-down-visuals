/**
 * reports.ts — member content reports (Stack-4 #3).
 *
 *   POST /api/reports   (auth) file a report on a post, a comment,
 *                       or a creator profile.
 *
 * The admin half of the loop — GET/PATCH /api/admin/reports — lives
 * in routes/admin.ts beside the DMCA bench it mirrors.
 *
 * Before this route, a member had NO way to report anything: the
 * Stack-3 #29 survey proved there was no table, no endpoint, and no
 * UI for it (the DMCA intake is a public copyright form with a sworn
 * statement — a different contract, not a member report button).
 *
 * THE RULES THIS ROUTE KEEPS:
 * - Members only (requireAuth): a report names its reporter, so the
 *   queue can weigh repeat filers; guests get 401, never a form.
 * - The target must EXIST and match its claimed type. Comment
 *   targets resolve in a fixed order — post thread-replies (posts,
 *   kind 'thread_reply'), profile_comments (Shout Wall),
 *   media_comments (track/video threads) — the three comment stores
 *   the site actually renders. Anything else is an honest 404.
 * - Nobody reports their own content: the target's owner is resolved
 *   server-side and a self-report is a 400, never a queued row.
 * - One OPEN report per (reporter, target): re-filing while an
 *   earlier report is still new/reviewing returns that open row
 *   ({ duplicate: true }) instead of stacking a second row. The
 *   partial unique index in migration 0174 is the database half of
 *   the same rule; once a report is decided, filing again is a
 *   fresh row.
 * - Filing a report NEVER acts on the target. No auto-hide, no
 *   auto-ban, no notification — the report only queues the target
 *   for a human admin on the bench.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  contentReportsTable,
  postsTable,
  creatorProfilesTable,
  profileCommentsTable,
  mediaCommentsTable,
  CONTENT_REPORT_TARGET_TYPES,
  CONTENT_REPORT_REASONS,
  CONTENT_REPORT_OPEN_STATUSES,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { reportWriteLimiter } from "../lib/rate-limit";

const router = Router();

const contentReportDto = {
  id: contentReportsTable.id,
  reporterUserId: contentReportsTable.reporterUserId,
  targetType: contentReportsTable.targetType,
  targetId: contentReportsTable.targetId,
  targetOwnerUserId: contentReportsTable.targetOwnerUserId,
  targetSummary: contentReportsTable.targetSummary,
  reason: contentReportsTable.reason,
  note: contentReportsTable.note,
  status: contentReportsTable.status,
  createdAt: contentReportsTable.createdAt,
};

const CreateReportSchema = z.object({
  target_type: z.enum(CONTENT_REPORT_TARGET_TYPES),
  target_id: z.string().uuid(),
  reason: z.enum(CONTENT_REPORT_REASONS),
  note: z.string().trim().max(500).optional(),
});

/** Filed-time context for the admin queue: one collapsed line of the
 *  target's own words (or the profile's name), capped short. */
function excerpt(body: string | null | undefined): string {
  return (body ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
}

interface ResolvedTarget {
  ownerUserId: string | null;
  summary: string;
}

/** Resolve a post target (top-level posts only — a thread reply is a
 *  comment, and filing one as a "post" is an honest 404) to its owner. */
async function resolvePost(targetId: string): Promise<ResolvedTarget | null> {
  const [post] = await db
    .select({ profileId: postsTable.profileId, kind: postsTable.kind, body: postsTable.body })
    .from(postsTable)
    .where(eq(postsTable.id, targetId));
  if (!post || post.kind === "thread_reply") return null;
  const [profile] = await db
    .select({ userId: creatorProfilesTable.userId })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.id, post.profileId));
  return { ownerUserId: profile?.userId ?? null, summary: excerpt(post.body) };
}

/** Resolve a comment target across the three comment stores, in the
 *  fixed order named in the header: post replies, Shout Wall
 *  comments, media comments. */
async function resolveComment(targetId: string): Promise<ResolvedTarget | null> {
  const [reply] = await db
    .select({ profileId: postsTable.profileId, kind: postsTable.kind, body: postsTable.body })
    .from(postsTable)
    .where(eq(postsTable.id, targetId));
  if (reply && reply.kind === "thread_reply") {
    const [profile] = await db
      .select({ userId: creatorProfilesTable.userId })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.id, reply.profileId));
    return { ownerUserId: profile?.userId ?? null, summary: excerpt(reply.body) };
  }
  const [wall] = await db
    .select({ authorUserId: profileCommentsTable.authorUserId, body: profileCommentsTable.body })
    .from(profileCommentsTable)
    .where(eq(profileCommentsTable.id, targetId));
  if (wall) return { ownerUserId: wall.authorUserId, summary: excerpt(wall.body) };
  const [media] = await db
    .select({ authorUserId: mediaCommentsTable.authorUserId, body: mediaCommentsTable.body })
    .from(mediaCommentsTable)
    .where(eq(mediaCommentsTable.id, targetId));
  if (media) return { ownerUserId: media.authorUserId, summary: excerpt(media.body) };
  return null;
}

async function resolveProfile(targetId: string): Promise<ResolvedTarget | null> {
  const [profile] = await db
    .select({ userId: creatorProfilesTable.userId, displayName: creatorProfilesTable.displayName })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.id, targetId));
  if (!profile) return null;
  return { ownerUserId: profile.userId, summary: excerpt(profile.displayName) };
}

async function findOpenReport(reporterUserId: string, targetType: string, targetId: string) {
  const [open] = await db
    .select(contentReportDto)
    .from(contentReportsTable)
    .where(
      and(
        eq(contentReportsTable.reporterUserId, reporterUserId),
        eq(contentReportsTable.targetType, targetType),
        eq(contentReportsTable.targetId, targetId),
        inArray(contentReportsTable.status, [...CONTENT_REPORT_OPEN_STATUSES]),
      ),
    );
  return open ?? null;
}

router.post("/reports", requireAuth, reportWriteLimiter, async (req: Request, res: Response) => {
  const parsed = CreateReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: `Invalid report. A target (post, comment, or profile), a reason (one of: ${CONTENT_REPORT_REASONS.join(", ")}), and an optional note of at most 500 characters are required.`,
    });
    return;
  }
  const { target_type: targetType, target_id: targetId, reason, note } = parsed.data;
  const reporterUserId = req.userId!;

  try {
    const resolved =
      targetType === "post"
        ? await resolvePost(targetId)
        : targetType === "comment"
          ? await resolveComment(targetId)
          : await resolveProfile(targetId);
    if (!resolved) {
      res.status(404).json({
        error: targetType === "post" ? "Post not found." : targetType === "comment" ? "Comment not found." : "Profile not found.",
      });
      return;
    }
    if (resolved.ownerUserId && resolved.ownerUserId === reporterUserId) {
      res.status(400).json({
        error: targetType === "profile" ? "You can't report your own profile." : "You can't report your own content.",
      });
      return;
    }

    const existing = await findOpenReport(reporterUserId, targetType, targetId);
    if (existing) {
      res.json({ report: existing, duplicate: true });
      return;
    }

    const [report] = await db
      .insert(contentReportsTable)
      .values({
        reporterUserId,
        targetType,
        targetId,
        targetOwnerUserId: resolved.ownerUserId,
        targetSummary: resolved.summary,
        reason,
        note: note && note.length > 0 ? note : null,
      })
      .onConflictDoNothing()
      .returning(contentReportDto);

    if (!report) {
      /* Lost a same-instant race: the partial unique index held the
         one-open-report line, so the winner's row is the answer. */
      const winner = await findOpenReport(reporterUserId, targetType, targetId);
      if (winner) {
        res.json({ report: winner, duplicate: true });
        return;
      }
      res.status(500).json({ error: "Could not file your report." });
      return;
    }

    req.log.info(
      { reporterUserId, targetType, targetId, reason, reportId: report.id },
      "reports: content report filed",
    );
    res.status(201).json({ report });
  } catch (err) {
    req.log.error({ err }, "reports: file content report failed");
    res.status(500).json({ error: "Could not file your report." });
  }
});

export default router;
