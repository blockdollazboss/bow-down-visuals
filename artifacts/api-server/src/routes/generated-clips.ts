import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { invokeRailHandler, type RailCoreDeps, type RailCoreResult } from "../lib/rail-core";
import { db, generatedClipsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { recordRunwayClipHistory } from "../lib/payment-record";
import {
  markClipChargeDelivered,
  refundClipChargeOnSaveFailure,
} from "../lib/clip-charge-obligations";
import { chargedTasks } from "./generate/runway-clip";
import { refreshSupabaseStorageUrl, normalizeToStorageRef } from "../lib/objectStorage";
import { mirrorExternalMediaUrl } from "../lib/mirrorMedia";
import { getSupabaseAdmin } from "../lib/supabase-admin";

const router = Router();

const RUNWAY_CREDIT_COST = 400;

const SaveClipSchema = z.object({
  projectId:    z.string().uuid().optional().nullable(),
  sceneId:      z.string().optional().nullable(),
  title:        z.string().optional().nullable(),
  prompt:       z.string().optional().nullable(),
  finalPrompt:  z.string().optional().nullable(),
  runwayJobId:  z.string().optional().nullable(),
  /* The Creative Vault character this clip was made as (0142, G8). */
  artistVaultId: z.string().uuid().optional().nullable(),
  /* Accepts a stable Supabase storage ref (supabase://generated-clips/…)
     or any playable URL — legacy GCS signed URLs included. */
  videoUrl:     z.string().min(1),
  thumbnailUrl: z.string().optional().nullable(),
  status:       z.string().optional().default("completed"),
});

/* POST /api/generated-clips — save a clip immediately after generation */
const saveGeneratedClipHandler = async (req: Request, res: Response) => {
  const parsed = SaveClipSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid clip data", details: parsed.error.issues });
    return;
  }
  const d = parsed.data;

  /* Persist stable storage refs, never short-lived signed URLs — even if
     the client posts the 1-day preview URL from the generate poll response,
     the DB ends up with the ref and readers mint fresh URLs per read.
     Mirror-on-save (2026-10-13 law): a raw provider CDN URL is re-hosted
     into permanent storage — same normalize-then-mirror pattern as
     PATCH /projects/:id/scene-clip. */
  const normalizedVideoUrl = normalizeToStorageRef(d.videoUrl) ?? d.videoUrl;
  const storedVideoUrl =
    (await mirrorExternalMediaUrl(normalizedVideoUrl, { kind: "video", ownerKey: req.userId! })) ??
    normalizedVideoUrl;
  const normalizedThumbnailUrl = d.thumbnailUrl
    ? (normalizeToStorageRef(d.thumbnailUrl) ?? d.thumbnailUrl)
    : null;
  const storedThumbnailUrl = normalizedThumbnailUrl
    ? ((await mirrorExternalMediaUrl(normalizedThumbnailUrl, { kind: "image", ownerKey: req.userId! })) ??
      normalizedThumbnailUrl)
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
        artist_vault_id: d.artistVaultId ?? null,
        video_url:     storedVideoUrl,
        thumbnail_url: storedThumbnailUrl,
        status:        d.status ?? "completed",
      })
      .returning({ id: generatedClipsTable.id });

    req.log.info({ clipId: clip?.id, userId: req.userId }, "[generated-clips] clip saved");

    /* ── Clean up chargedTasks entry (save succeeded — no refund needed) ── */
    if (d.runwayJobId) {
      chargedTasks.delete(d.runwayJobId);
      /* D3: close the durable obligation too. If this mark is lost, the
         stale sweeper finds the landed clip row and completes the
         bookkeeping without refunding — so a mark failure is logged,
         never fatal to the save. */
      try {
        await markClipChargeDelivered(d.runwayJobId);
      } catch (markErr) {
        req.log.error(
          { err: markErr, taskId: d.runwayJobId },
          "[generated-clips] durable delivered-mark failed — sweeper will reconcile from the landed clip",
        );
      }
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

    /* ── Refund credits if they were already deducted for this clip ──
       D3: the durable obligation (clip_charge_obligations, migration
       0184) is the source of truth — its claim is atomic on
       status='pending', so this refund fires exactly once even across
       a server restart. The in-memory chargedTasks entry is passed as
       the fallback for charges that predate the durable record. */
    const taskId = d.runwayJobId ?? null;
    const memCharge = taskId ? chargedTasks.get(taskId) : null;
    let refundedCredits = 0;

    if (taskId) {
      try {
        const outcome = await refundClipChargeOnSaveFailure(taskId, {
          userId: req.userId!,
          projectId: d.projectId ?? null,
          memoryCharge: memCharge ?? null,
        });
        if (outcome.refunded) refundedCredits = outcome.credits;
      } catch (refundErr) {
        req.log.error({ err: refundErr, taskId }, "[generated-clips] refund FAILED — user lost credits");
      }
    }

    if (refundedCredits > 0) {
      res.status(500).json({
        error: msg,
        creditMessage: "Clip generated but saving failed. Your Visual Bucs were refunded.",
        creditsRefunded: refundedCredits,
      });
    } else {
      res.status(500).json({
        error: msg,
        creditMessage: "Clip generated but saving failed. No Visual Bucs were charged.",
      });
    }
  }
};

router.post("/generated-clips", requireAuth, saveGeneratedClipHandler);

/* Operator core (Phase 2 Lane E): the generate.video completion
   driver saves the finished clip through this exact handler
   in-process (lib/rail-core), so an operator-started clip lands in
   the member's library — with this rail's refund-on-save-failure
   protection intact. */
export async function runSaveGeneratedClip(
  deps: RailCoreDeps,
  body: unknown,
): Promise<RailCoreResult> {
  return invokeRailHandler(saveGeneratedClipHandler as never, deps, { body });
}

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

/* DELETE /api/generated-clips/:id — owner-scoped (the drafts.ts house
   pattern): a signed-in user can only delete their OWN clips. The
   response is the same success shape whether the clip was theirs,
   someone else's, or never existed — no existence leak. */
router.delete("/generated-clips/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    await db
      .delete(generatedClipsTable)
      .where(
        and(
          eq(generatedClipsTable.id, id),
          eq(generatedClipsTable.user_id, req.userId!),
        ),
      );
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete clip";
    res.status(500).json({ error: msg });
  }
});

export default router;
