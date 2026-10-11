/**
 * deverb.ts — De-reverb / dialogue isolate backend.
 *
 *  POST /api/deverb              upload audio → server-owned job → de-reverbed MP3
 *  GET  /api/deverb/status       provider gate status (key configured? pricing approved?)
 *                                 — powers the frontend's disabled-state banner
 *  GET  /api/deverb/:jobId       poll job status
 *
 * ── WHY PROVIDER-GATED ────────────────────────────────────────────────
 * True de-reverb (removing room echo from vocals/dialogue) is a blind
 * source-separation problem that needs an AI model (e.g. a trained
 * dereverberation network). The stock ffmpeg build on the server has NO
 * de-reverb filter — `adeverb` does not exist, and `afftdn`/`anlmdn` are
 * spectral NOISE reducers, not reverb removers. Shipping a DSP-only
 * "de-reverb" would be a fake, so this endpoint stays gated until a real
 * de-reverb provider (API key in DEVERB_API_KEY) is wired into
 * callDeverbProvider() below.
 * ─────────────────────────────────────────────────────────────────────
 *
 * ── PRICING: PLACEHOLDER — NOT APPROVED ──────────────────────────────
 * DEVERB_CREDIT_COST (default 1000 credits = 10 Visual Bucs) is a
 * PROPOSAL. DEVERB_PRICING_APPROVED is false until the user explicitly
 * approves the price in a reviewed commit — never flip as a drive-by.
 * While false, the server refuses every deverb request BEFORE any
 * provider call, any credit check, or any charge: nothing generates and
 * nothing moves.
 * ─────────────────────────────────────────────────────────────────────
 */
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { Request, Response, Router } from "express";
import { z } from "zod";
import multer from "multer";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import { publicApiLimiter } from "../../lib/rate-limit";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();
const execFileAsync = promisify(execFile);

/* ── Pricing (PLACEHOLDER — NOT USER-APPROVED) ───────────────────────── */

/**
 * PLACEHOLDER — NOT USER-APPROVED. Proposed: 10 Visual Bucs per deverb
 * job (1000 credits). True de-reverb is an AI-provider call, priced on
 * the same order as other AI audio tools. Env override exists so ops can
 * tune without a code change, but the FINAL price needs the user's
 * explicit approval — see DEVERB_PRICING_APPROVED.
 */
export const DEVERB_CREDIT_COST =
  Number(process.env["DEVERB_CREDIT_COST"]) || 1000;

/** Explicit approval gate (same pattern as VEO_PRICING_APPROVED). */
export const DEVERB_PRICING_APPROVED = false;
/** Bump when the proposed rate changes, so an approval is tied to a version. */
export const DEVERB_PRICING_VERSION = "2026-10-11-placeholder";

/** Provider gate: which env var must hold a live key before jobs can run. */
export const DEVERB_PROVIDER_KEY_ENV = "DEVERB_API_KEY";

/** Max upload: deverb jobs run on a remote AI provider, keep them small. */
const DEVERB_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export type DeverbMode = "dialogue" | "vocal";
const MODES: DeverbMode[] = ["dialogue", "vocal"];

const MODE_LABELS: Record<DeverbMode, string> = {
  dialogue: "Dialogue Isolate",
  vocal: "Vocal De-Reverb",
};

function deverbProviderKey(): string | undefined {
  return process.env[DEVERB_PROVIDER_KEY_ENV];
}

/* ── Gate status (powers the frontend disabled banner) ───────────────── */

export type DeverbGateReason = "ok" | "provider_not_configured" | "pricing_pending";

export function deverbGateStatus(): {
  enabled: boolean;
  reason: DeverbGateReason;
  pricingApproved: boolean;
  providerConfigured: boolean;
  creditCost: number;
  pricingVersion: string;
} {
  const providerConfigured = Boolean(deverbProviderKey());
  const pricingApproved = DEVERB_PRICING_APPROVED;
  const enabled = providerConfigured && pricingApproved;
  const reason: DeverbGateReason = !providerConfigured
    ? "provider_not_configured"
    : !pricingApproved
      ? "pricing_pending"
      : "ok";
  return {
    enabled,
    reason,
    pricingApproved,
    providerConfigured,
    creditCost: DEVERB_CREDIT_COST,
    pricingVersion: DEVERB_PRICING_VERSION,
  };
}

router.get("/deverb/status", publicApiLimiter, (_req: Request, res: Response) => {
  res.json(deverbGateStatus());
});

/* ── Upload handling ─────────────────────────────────────────────────── */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DEVERB_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed (MP3, WAV, M4A)"));
    }
  },
});

const deverbSchema = z.object({
  mode: z.enum(["dialogue", "vocal"]),
});

/* ── Provider integration (NOT IMPLEMENTED — gate refuses until then) ── */

/**
 * Wire the real de-reverb provider here (e.g. an AI dereverberation API).
 * Must take raw audio at inputPath and write de-reverbed audio to
 * outputPath. ZERO paid calls may be made until DEVERB_PRICING_APPROVED
 * is true AND DEVERB_API_KEY is set — the POST route enforces both
 * before this function is ever reached.
 */
export async function callDeverbProvider(
  inputPath: string,
  _mode: DeverbMode,
  _outputPath: string,
): Promise<void> {
  void inputPath;
  throw new Error(
    "De-reverb provider is not integrated yet (no DEVERB_API_KEY provider call implemented). " +
    "This is the deliberate gate — no DSP-only fake is shipped in its place."
  );
}

/* ── Server-owned background jobs (in-memory; not tab-dependent) ────── */

export type DeverbJobStatus = "queued" | "processing" | "done" | "failed";

export interface DeverbJob {
  id: string;
  userId: string;
  status: DeverbJobStatus;
  mode: DeverbMode;
  sourceName: string;
  outputUrl: string | null;
  outputRef: string | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
}

const jobs = new Map<string, DeverbJob>();

export function getDeverbJob(id: string): DeverbJob | undefined {
  return jobs.get(id);
}

/** Test hook: clear the in-memory job store. */
export function __clearDeverbJobs(): void {
  jobs.clear();
}

/** Exported for tests. */
export async function runDeverbJob(
  job: DeverbJob,
  inputBuffer: Buffer,
  originalName: string,
): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "deverb-"));
  const ext = (originalName.split(".").pop() ?? "mp3").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
  const inputPath = join(workDir, `input.${ext}`);
  const outputPath = join(workDir, `deverbed.mp3`);

  try {
    job.status = "processing";
    await fs.writeFile(inputPath, inputBuffer);

    // Real de-reverb via the configured AI provider.
    await callDeverbProvider(inputPath, job.mode, outputPath);

    const outBuffer = await fs.readFile(outputPath);
    const objectName = `deverb/${job.userId}/${Date.now()}-${job.id}.mp3`;
    const ref = await uploadMediaToSupabaseStorage(objectName, outBuffer, "audio/mpeg");
    const url = await refreshSupabaseStorageUrl(ref);

    job.status = "done";
    job.outputUrl = url;
    job.outputRef = ref;
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "De-reverb failed";
    // Refund: the user paid for an output they didn't get.
    try {
      await refundCredits(job.userId, job.creditsCharged, {
        action: "De-Reverb — Refund (job failed)",
      });
    } catch (refundErr) {
      // Logged inside refundCredits; don't mask the original failure.
      void refundErr;
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ── Routes ──────────────────────────────────────────────────────────── */

/**
 * POST /api/deverb
 *
 * De-reverb / dialogue isolate: strips room echo from dialogue and
 * vocals via an AI provider.
 *
 * Gate order (nothing generates, nothing moves until both pass):
 *  1. Provider configured? (DEVERB_API_KEY) → 503 DEVERB_PROVIDER_NOT_CONFIGURED
 *  2. Pricing approved? (DEVERB_PRICING_APPROVED) → 402 pricing_pending
 *  3. Credit check + charge → 402 out_of_credits on failure
 *
 * Then: server-owned background job → poll GET /api/deverb/:jobId →
 * download result. Failed jobs are refunded automatically.
 */
router.post("/deverb", requireAuth, upload.single("audio"), async (req: Request, res: Response) => {
  const gate = deverbGateStatus();

  // Gate 1: provider must be wired before ANYTHING else happens.
  if (!gate.providerConfigured) {
    res.status(503).json({
      error: "DEVERB_PROVIDER_NOT_CONFIGURED",
      message:
        "De-reverb isn't available yet — the AI de-reverb provider hasn't been connected " +
        "(DEVERB_API_KEY is not set on the server). No credits were charged.",
    });
    return;
  }

  // Gate 2: pricing needs the user's explicit approval before any charge.
  if (!gate.pricingApproved) {
    res.status(402).json({
      error: "pricing_pending",
      message:
        "De-reverb pricing hasn't been approved yet, so the tool is disabled. No credits were charged.",
    });
    return;
  }

  const parsed = deverbSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { mode } = parsed.data;
  if (!req.file) {
    res.status(400).json({ error: "No audio file provided" });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < DEVERB_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to de-reverb audio.",
    });
    return;
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, DEVERB_CREDIT_COST, {
      action: `De-Reverb (${MODE_LABELS[mode]})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to de-reverb audio.",
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "Could not record the Visual Buc charge. Please try again." });
      return;
    }
    throw err;
  }

  const job: DeverbJob = {
    id: randomUUID(),
    userId: req.userId!,
    status: "queued",
    mode,
    sourceName: req.file.originalname,
    outputUrl: null,
    outputRef: null,
    error: null,
    creditsCharged: DEVERB_CREDIT_COST,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  // Server-owned: runs detached from the request/tab lifecycle.
  void runDeverbJob(job, req.file.buffer, req.file.originalname);

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    mode: job.mode,
    creditsCharged: DEVERB_CREDIT_COST,
    creditsRemaining,
  });
});

/**
 * GET /api/deverb/:jobId
 *
 * Poll job status. Returns outputUrl when done (a signed, reviewable
 * URL for the de-reverbed audio retained in Supabase storage).
 */
router.get("/deverb/:jobId", requireAuth, (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = jobs.get(jobId);
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    mode: job.mode,
    sourceName: job.sourceName,
    outputUrl: job.outputUrl,
    error: job.error,
    createdAt: job.createdAt,
  });
});

export default router;
