import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { db, generatedClipsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { recordRunwayClipHistory, recordCreditUsage } from "../lib/payment-record";
import { chargedTasks } from "./generate/runway-clip";
import { refreshSupabaseStorageUrl, normalizeToStorageRef } from "../lib/objectStorage";
import { getSupabaseAdmin } from "../lib/supabase-admin";

const router = Router();

const RUNWAY_CREDIT_COST = 5;

const SaveClipSchema = z.object({
  projectId:    z.string().uuid().optional().nullable(),
  sceneId:      z.string().optional().nullable(),
  title:        z.string().optional().nullable(),
  prompt:       z.string().optional().nullable(),
  finalPrompt:  z.string().optional().nullable(),
  runwayJobId:  z.string().optional().nullable(),
  /* Accepts a stable Supabase storage ref (supabase://generated-clips/…)
     or any playable URL — legacy GCS signed URLs included. */
  videoUrl:     z.string().min(1),
  thumbnailUrl: z.string().optional().nullable(),
  status:       z.string().optional().default("completed"),
});

/* POST /api/generated-clips — save a clip immediately after generation */
router.post("/generated-clips", requireAuth, async (req, res) => {
  const parsed = SaveClipSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid clip data", details: parsed.error.issues });
    return;
  }
  const d = parsed.data;

  /* Persist stable storage refs, never short-lived signed URLs — even if
     the client posts the 1-day preview URL from the generate poll response,
     the DB ends up with the ref and readers mint fresh URLs per read. */
  const storedVideoUrl = normalizeToStorageRef(d.videoUrl) ?? d.videoUrl;
  const storedThumbnailUrl = d.thumbnailUrl
    ? (normalizeToStorageRef(d.thumbnailUrl) ?? d.thumbnailUrl)
    : null;

  try {
    const [clip] = await db
      .insert(generatedClipsTable)
      .values({
        user_id:       req.userId!,
        project_id:    d.projectId ?? null,
        scene_id:      d.sceneId ?? null,
        title:         d.title ?? null,
        prompt:        d.prompt ?? null,
        final_prompt:  d.finalPrompt ?? null,
        runway_job_id: d.runwayJobId ?? null,
        video_url:     storedVideoUrl,
        thumbnail_url: storedThumbnailUrl,
        status:        d.status ?? "completed",
      })
      .returning({ id: generatedClipsTable.id });

    req.log.info({ clipId: clip?.id, userId: req.userId }, "[generated-clips] clip saved");

    /* ── Clean up chargedTasks entry (save succeeded — no refund needed) ── */
    if (d.runwayJobId) {
      chargedTasks.delete(d.runwayJobId);
    }

    /* ── Fire-and-forget: generation_history so it appears in Generation History tab ── */
    recordRunwayClipHistory({
      userId:       req.userId!,
      projectId:    d.projectId ?? null,
      sceneId:      d.sceneId ?? null,
      prompt:       d.finalPrompt ?? d.prompt ?? null,
      videoUrl:     storedVideoUrl,
      thumbnailUrl: storedThumbnailUrl,
      creditsUsed:  RUNWAY_CREDIT_COST,
      title:        d.title ?? null,
    }).catch(() => {});

    req.log.info({ userId: req.userId }, "[generated-clips] dashboard credits should refresh — clip and history saved");

    res.status(201).json({ id: clip?.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save clip";
    req.log.error({ err: msg, userId: req.userId }, "[generated-clips] save FAILED");

    /* ── Refund credits if they were already deducted for this clip ── */
    const taskId = d.runwayJobId ?? null;
    const charge = taskId ? chargedTasks.get(taskId) : null;

    if (charge && charge.userId === req.userId && !charge.refunded) {
      charge.refunded = true; /* mark immediately to prevent double-refund */

      try {
        const { data: freshProfile } = await req.userSupabase!
          .from("profiles")
          .select("credits")
          .eq("id", req.userId!)
          .single();
        const freshCredits: number = (freshProfile as { credits?: number } | null)?.credits ?? 0;
        const refundedCredits = freshCredits + charge.credits;

        /* profiles UPDATE via user-scoped client silently no-ops under broken RLS UPDATE policy — use service role. */
        const { error: refundErr } = await getSupabaseAdmin()
          .from("profiles")
          .update({ credits: refundedCredits })
          .eq("id", req.userId!);

        if (refundErr) {
          req.log.error({ err: refundErr, taskId }, "[generated-clips] refund FAILED — user lost credits");
        } else {
          req.log.info(
            { taskId, userId: req.userId, refundedCredits: charge.credits, newTotal: refundedCredits },
            "[generated-clips] refund completed",
          );
          /* Record the refund as a negative credit_usage so Credit History reflects it */
          recordCreditUsage({
            userId:      req.userId!,
            action:      "Runway Video Clip — Refund (save failed)",
            creditsUsed: -charge.credits,
            projectId:   d.projectId ?? null,
          }).catch(() => {});
        }
      } catch (refundEx) {
        req.log.error({ err: refundEx, taskId }, "[generated-clips] refund threw — user may have lost credits");
      }

      res.status(500).json({
        error: msg,
        creditMessage: "Clip generated but saving failed. Your credits were refunded.",
        creditsRefunded: charge.credits,
      });
    } else {
      res.status(500).json({
        error: msg,
        creditMessage: "Clip generated but saving failed. No credits were charged.",
      });
    }
  }
});

/* GET /api/generated-clips — list all clips for the current user */
router.get("/generated-clips", requireAuth, async (req, res) => {
  try {
    const clips = await db
      .select()
      .from(generatedClipsTable)
      .where(eq(generatedClipsTable.user_id, req.userId!))
      .orderBy(desc(generatedClipsTable.created_at))
      .limit(200);

    /* Stored values are stable storage refs (or legacy URLs) — mint a fresh
       signed URL per read so playback never expires. */
    const refreshedClips = await Promise.all(
      clips.map(async (clip) => ({
        ...clip,
        video_url: clip.video_url ? await refreshSupabaseStorageUrl(clip.video_url) : clip.video_url,
        thumbnail_url: clip.thumbnail_url ? await refreshSupabaseStorageUrl(clip.thumbnail_url) : clip.thumbnail_url,
      })),
    );

    res.json({ clips: refreshedClips });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch clips";
    res.status(500).json({ error: msg });
  }
});

/* DELETE /api/generated-clips/:id */
router.delete("/generated-clips/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    await db
      .delete(generatedClipsTable)
      .where(eq(generatedClipsTable.id, id));
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete clip";
    res.status(500).json({ error: msg });
  }
});

export default router;
