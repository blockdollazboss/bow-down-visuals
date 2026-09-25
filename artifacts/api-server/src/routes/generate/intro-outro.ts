import { Router } from "express";
import { createWriteStream, unlinkSync, existsSync, readFileSync } from "fs";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";
import RunwayML from "@runwayml/sdk";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits as chargeCreditsAtomic, refundCredits, LedgerWriteError } from "../../lib/credits";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import {
  buildIntroOutroPrompt,
  resolveIntroOutroCost,
  resolveIntroOutroRequest,
  INTRO_OUTRO_DURATION_SEC,
  INTRO_OUTRO_RATIO,
  INTRO_OUTRO_CREDITS_PER_SEC_FALLBACK,
} from "./intro-outro-pricing";

const router = Router();

/* Site credits per second of Seedance video. Env-overridable; mirrors the
   main video rate so intro pricing never drifts from scene pricing. */
const CREDITS_PER_SEC = Number(process.env["SEEDANCE_CREDITS_PER_SEC"]) || INTRO_OUTRO_CREDITS_PER_SEC_FALLBACK;
const CREDIT_COST = resolveIntroOutroCost(CREDITS_PER_SEC);

/** Supabase Storage bucket for generated brand videos. */
export const INTRO_OUTRO_BUCKET = "generated-clips";

/**
 * Tracks submitted Seedance intro/outro tasks — credits charged on SUCCEEDED only.
 * Key: Runway taskId  Value: { userId, credits }
 */
const pendingIntroTasks = new Map<string, { userId: string; credits: number }>();
/** Test hook — clears the in-memory task map. */
export function __clearPendingIntroTasks() {
  pendingIntroTasks.clear();
}
/** Test hook — read the pending map size. */
export function __pendingIntroTaskCount() {
  return pendingIntroTasks.size;
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url.slice(0, 80)}`);
  const ws = createWriteStream(dest);
  await pipeline(res.body as Parameters<typeof pipeline>[0], ws);
}

function cleanup(f: string) {
  try { if (existsSync(f)) unlinkSync(f); } catch { /* best-effort */ }
}

/* ─────────────────────────────────────────────────────────────────────────────
   POST /generate-intro-outro
   1. Validate channelName + type. 2. Credit pre-check (402 when broke).
   3. Submit 5s Seedance 2.5 job to Runway. 4. Track task — charge on SUCCEEDED.
───────────────────────────────────────────────────────────────────────────── */
router.post("/generate-intro-outro", requireAuth, async (req, res) => {
  const resolved = resolveIntroOutroRequest(req.body ?? {});
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }

  /* ── Credit pre-check — always enforced ── */
  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough credits. Please buy more credits to continue.",
    });
    return;
  }

  const apiKey = process.env["RUNWAYML_API_SECRET"];
  if (!apiKey) {
    res.status(500).json({ error: "Runway API key is not configured on the server" });
    return;
  }

  const prompt = buildIntroOutroPrompt(resolved.channelName, resolved.type, resolved.tagline);
  const client = new RunwayML({ apiKey });

  req.log.info(
    { userId: req.userId, type: resolved.type, durationSec: INTRO_OUTRO_DURATION_SEC },
    "[intro-outro] Runway Seedance generation started",
  );

  try {
    const task = resolved.refImage
      ? await client.imageToVideo.create({
          model: "seedance2_5",
          promptImage: resolved.refImage,
          promptText: prompt.slice(0, 4000),
          duration: INTRO_OUTRO_DURATION_SEC,
          ratio: INTRO_OUTRO_RATIO,
          audio: false,
        })
      : await client.textToVideo.create({
          model: "seedance2_5",
          promptText: prompt.slice(0, 4000),
          duration: INTRO_OUTRO_DURATION_SEC,
          ratio: INTRO_OUTRO_RATIO,
          audio: false,
        });

    pendingIntroTasks.set(task.id, { userId: req.userId!, credits: CREDIT_COST });
    req.log.info({ taskId: task.id, userId: req.userId }, "[intro-outro] task submitted — credits pending on SUCCEEDED");
    res.json({ taskId: task.id, creditCost: CREDIT_COST, type: resolved.type, durationSec: INTRO_OUTRO_DURATION_SEC, status: "processing" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Runway API returned an error";
    req.log.error({ err: msg }, "[intro-outro] submission failed — no credits charged");
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /generate-intro-outro/:taskId
   Poll Runway task status.
   - SUCCEEDED → deduct credits → upload to generated-clips → return URL
   - FAILED/CANCELLED → no charge → return error
   - Still running → return { status: "processing" }
───────────────────────────────────────────────────────────────────────────── */
router.get("/generate-intro-outro/:taskId", requireAuth, async (req, res) => {
  const { taskId } = req.params as { taskId: string };

  const apiKey = process.env["RUNWAYML_API_SECRET"];
  if (!apiKey) {
    res.status(500).json({ error: "Runway API key is not configured on the server" });
    return;
  }

  const client = new RunwayML({ apiKey });

  try {
    const task = await client.tasks.retrieve(taskId);

    if (task.status === "SUCCEEDED") {
      const runwayUrl = (task.output as string[] | undefined)?.[0] ?? null;
      if (!runwayUrl) {
        pendingIntroTasks.delete(taskId);
        req.log.warn({ taskId }, "[intro-outro] SUCCEEDED but no output URL — no credits charged");
        res.json({ status: "succeeded", url: null });
        return;
      }

      const pending = pendingIntroTasks.get(taskId);
      let creditsRemaining: number | undefined;

      /* ── Charge credits (only once, guarded by pendingIntroTasks presence) ── */
      if (pending && pending.userId === req.userId) {
        try {
          creditsRemaining = await chargeCreditsAtomic(
            req.userId!,
            pending.credits,
            { action: "Intro/Outro Video" },
            { rollbackOnLedgerFailure: false },
          );
          req.log.info({ taskId, userId: req.userId, creditsAfter: creditsRemaining, deducted: pending.credits }, "[intro-outro] credits deducted");
        } catch (err) {
          if (err instanceof LedgerWriteError) {
            req.log.error({ err, taskId }, "[intro-outro] CRITICAL: ledger write failed after deduction");
          } else {
            req.log.error({ err, taskId }, "[intro-outro] credit deduction FAILED — video delivered without charge");
          }
        }
        pendingIntroTasks.delete(taskId);
      }

      /* ── Upload to Supabase Storage ── */
      const tmpFile = path.join(os.tmpdir(), `intro-outro-${randomUUID()}.mp4`);
      try {
        await downloadToFile(runwayUrl, tmpFile);
        const objectName = `intros-outros/${randomUUID()}.mp4`;
        const { error: upErr } = await getSupabaseAdmin().storage
          .from(INTRO_OUTRO_BUCKET)
          .upload(objectName, readFileSync(tmpFile), { contentType: "video/mp4", upsert: false });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = getSupabaseAdmin().storage
          .from(INTRO_OUTRO_BUCKET)
          .getPublicUrl(objectName);
        res.json({ status: "succeeded", url: publicUrl, path: objectName, creditsRemaining });
      } catch (uploadErr: unknown) {
        /* Upload failed after a successful charge — refund so the user
           never pays for a video they can't access. */
        if (pending && pending.userId === req.userId) {
          try {
            await refundCredits(req.userId!, pending.credits, { action: "Intro/Outro — Refund (upload failed)" });
            req.log.info({ taskId, userId: req.userId, refunded: pending.credits }, "[intro-outro] refunded after upload failure");
          } catch (refundErr) {
            req.log.error({ err: refundErr, taskId }, "[intro-outro] CRITICAL: refund failed after upload failure");
          }
        }
        req.log.error({ err: uploadErr }, "[intro-outro] bucket upload failed — returning raw Runway URL as fallback");
        res.json({ status: "succeeded", url: runwayUrl, path: null, creditsRemaining, refunded: true });
      } finally {
        cleanup(tmpFile);
      }

    } else if (task.status === "FAILED" || task.status === "CANCELLED") {
      pendingIntroTasks.delete(taskId);
      req.log.info({ taskId, status: task.status }, "[intro-outro] task failed — no credits charged");
      res.json({
        status: task.status === "CANCELLED" ? "cancelled" : "failed",
        error: (task as { failure?: string }).failure ?? "Intro/outro generation failed.",
      });
    } else {
      const running = task as { progress?: number };
      res.json({ status: "processing", progress: running.progress ?? null });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to poll intro/outro task";
    res.status(500).json({ error: msg });
  }
});

export default router;
