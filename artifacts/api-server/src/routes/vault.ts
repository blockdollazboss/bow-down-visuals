/**
 * vault.ts — The Vault (Stack-200 UPGRADE #162): one-tap FULL export.
 *
 *  POST /api/account/vault          start packaging → 202 { jobId, state }
 *                                   (or 200 with the live job when one is
 *                                   already packaging — never duplicates)
 *  GET  /api/account/vault/:jobId   poll → { state, stage, progress,
 *                                   downloadUrl?, result?, error? }
 *
 * The archive itself is built by lib/vault-runner.ts as a durable
 * background job (lib/vault-jobs.ts): originals at full quality in one
 * ZIP on R2 + the account data payload. The download URL is a fresh
 * signed URL minted per poll — nothing long-lived is ever stored.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { r2GetSignedUrl } from "../lib/r2-client";
import {
  createVaultJob,
  describeVaultProgress,
  getActiveVaultJobForUser,
  getVaultJob,
  type VaultJob,
} from "../lib/vault-jobs";
import { startVaultJob } from "../lib/vault-runner";

const router = Router();

async function jobView(job: VaultJob): Promise<Record<string, unknown>> {
  const { stage, progress } = describeVaultProgress(job);
  const view: Record<string, unknown> = {
    jobId: job.id,
    state: job.state,
    stage,
    progress,
    createdAt: new Date(job.createdAt).toISOString(),
  };
  if (job.state === "done" && job.result) {
    view["result"] = {
      fileName: job.result.fileName,
      sizeBytes: job.result.sizeBytes,
      fileCount: job.result.fileCount,
      skippedCount: job.result.skippedCount,
    };
    try {
      view["downloadUrl"] = await r2GetSignedUrl(job.result.r2Key, 3600);
    } catch {
      view["downloadUrl"] = null;
    }
  }
  if (job.state === "failed" && job.error) {
    view["error"] = job.error.message;
  }
  return view;
}

router.post("/account/vault", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const existing = await getActiveVaultJobForUser(userId).catch(() => undefined);
    if (existing) {
      res.status(200).json({ alreadyRunning: true, ...(await jobView(existing)) });
      return;
    }
    const job = await createVaultJob(userId);
    startVaultJob(job);
    req.log.info({ userId, jobId: job.id }, "vault: packaging started");
    res.status(202).json({ alreadyRunning: false, ...(await jobView(job)) });
  } catch (err) {
    req.log.error({ err }, "vault: start failed");
    res.status(500).json({ error: "Could not start your Vault. Please try again." });
  }
});

router.get("/account/vault/:jobId", requireAuth, async (req: Request, res: Response) => {
  try {
    const job = await getVaultJob(String(req.params["jobId"] ?? ""));
    if (!job || job.userId !== req.userId) {
      res.status(404).json({ error: "Vault job not found." });
      return;
    }
    res.json(await jobView(job));
  } catch (err) {
    req.log.error({ err }, "vault: status failed");
    res.status(500).json({ error: "Could not read your Vault's progress. Please try again." });
  }
});

export default router;
