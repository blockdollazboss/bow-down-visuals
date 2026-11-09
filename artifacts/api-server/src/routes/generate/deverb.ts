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
 * ── PRICING: RATIFIED — owner ruling 2026-11-07 ─────────────────────
 * DEVERB_CREDIT_COST (default 1000 Visual Bucs) was a proposal until
 * the owner ratified the price as-is on 2026-11-07 (tapped in chat:
 * "Ratify them — keep these nine prices"). DEVERB_PRICING_APPROVED is
 * true from that ruling. The remaining gate is the provider key: while
 * DEVERB_API_KEY is unset, the server refuses every deverb request
 * BEFORE any provider call, any credit check, or any charge: nothing
 * generates and nothing moves.
 * ─────────────────────────────────────────────────────────────────────
 */
import { createHash } from "crypto";
import { execFile } from "child_process";
import { promises as fs, createReadStream } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError,
  buildChargeIdempotencyKey, voidChargeIdempotencyKey,
} from "../../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../../lib/generation-stored-results";
import { publicApiLimiter } from "../../lib/rate-limit";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";
import { attachJobMapTtl } from "../../lib/job-map-sweeper";
import { tmpUploadStorage, createAdminAwareUpload } from "../../lib/upload-storage";

const router = Router();
const execFileAsync = promisify(execFile);

/* ── Pricing (RATIFIED — owner ruling 2026-11-07) ────────────────────── */

/**
 * RATIFIED — owner ruling 2026-11-07: 1000 Visual Bucs per deverb job,
 * approved as-is. True de-reverb is an AI-provider call, priced on the
 * same order as other AI audio tools. Env override exists so ops can
 * tune without a code change — see DEVERB_PRICING_APPROVED.
 */
export const DEVERB_CREDIT_COST =
  Number(process.env["DEVERB_CREDIT_COST"]) || 1000;

/** Explicit approval gate (same pattern as VEO_PRICING_APPROVED). */
const DEVERB_PRICING_APPROVED = true; // flipped 2026-11-07 after the owner ratified the 1,000 VB price as-is
/** Bump when the proposed rate changes, so an approval is tied to a version. */
const DEVERB_PRICING_VERSION = "2026-11-07-approved";

/** Provider gate: which env var must hold a live key before jobs can run. */
const DEVERB_PROVIDER_KEY_ENV = "DEVERB_API_KEY";

/** Max upload: deverb jobs run on a remote AI provider, keep them small. */
const DEVERB_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

type DeverbMode = "dialogue" | "vocal";
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

function deverbGateStatus(): {
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

const upload = createAdminAwareUpload({
  storage: tmpUploadStorage,
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
async function callDeverbProvider(
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

interface DeverbJob {
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
  /* CA-2 replay plumbing (Pattern B): the charge's idempotency key and
     the exact POST body served at creation. */
  chargeKey?: string;
  replayBody?: Record<string, unknown>;
}

const jobs = new Map<string, DeverbJob>();
attachJobMapTtl(jobs); // 2026-10-12 OOM fix: TTL eviction (lib/job-map-sweeper)


/** Test hook: clear the in-memory job store. */

/** Exported for tests. */
async function runDeverbJob(
  job: DeverbJob,
  uploadedPath: string,
  originalName: string,
): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "deverb-"));
  const ext = (originalName.split(".").pop() ?? "mp3").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
  const inputPath = join(workDir, `input.${ext}`);
  const outputPath = join(workDir, `deverbed.mp3`);

  try {
    job.status = "processing";
    await fs.copyFile(uploadedPath, inputPath); // 2026-10-12 OOM fix: upload is disk-backed, never a RAM Buffer

    // Real de-reverb via the configured AI provider.
    await callDeverbProvider(inputPath, job.mode, outputPath);

    const outBuffer = await fs.readFile(outputPath);
    const objectName = `deverb/${job.userId}/${Date.now()}-${job.id}.mp3`;
    const ref = await uploadMediaToSupabaseStorage(objectName, outBuffer, "audio/mpeg");
    const url = await refreshSupabaseStorageUrl(ref);

    job.status = "done";
    job.outputUrl = url;
    job.outputRef = ref;
    /* CA-2: persist the creation result under the charge key once the
       job has COMPLETED — a replay after the in-memory job is gone is
       served from the durable row instead of charging again. */
    if (job.chargeKey && job.replayBody) {
      await storeGenerationResult("deverb", job.chargeKey, job.userId, job.replayBody);
    }
  } catch (err) {
    job.error = err instanceof Error ? err.message : "De-reverb failed";
    // Refund: the user paid for an output they didn't get. The refund
    // lands (and the key is voided) BEFORE the job reads "failed", so
    // a retry that sees the failed job always charges fresh.
    let refunded = true;
    try {
      await refundCredits(job.userId, job.creditsCharged, {
        action: "De-Reverb — Refund (job failed)",
      });
    } catch (refundErr) {
      refunded = false;
      // Logged inside refundCredits; don't mask the original failure.
      void refundErr;
    }
    if (refunded && job.chargeKey) {
      try {
        await voidChargeIdempotencyKey(job.chargeKey);
      } catch {
        /* void is best-effort here; a failed void is logged in credits */
      }
    }
    job.status = "failed";
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await fs.unlink(uploadedPath).catch(() => {});
  }
}

/* ── CA-2 replay plumbing (Pattern B, avatar-presenter shape) ──────────
   The job's identity derives from the charge idempotency key: the key
   is built from the request intent (mode + a sha256 of the uploaded
   bytes — the file IS the defining input), and the job id is that
   key's hash. A replay of the same ask lands on the SAME job: no
   second charge, no second provider run. An in-flight twin map
   closes the concurrent window between charge and job-mint. */
async function hashFileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

interface DeverbCreationOutcome {
  status: number;
  body: Record<string, unknown>;
}

const deverbCreationsInFlight = new Map<string, Promise<DeverbCreationOutcome>>();

async function runDeverbCreationOnce(
  idempotencyKey: string,
  work: () => Promise<DeverbCreationOutcome>,
): Promise<DeverbCreationOutcome & { replayed: boolean }> {
  const pending = deverbCreationsInFlight.get(idempotencyKey);
  if (pending) {
    const twin = await pending.catch(() => null);
    if (twin && twin.status === 202) return { ...twin, replayed: true };
    /* The twin failed — run this request fresh. */
  }
  const run = work();
  deverbCreationsInFlight.set(idempotencyKey, run);
  try {
    const outcome = await run;
    return { ...outcome, replayed: false };
  } finally {
    if (deverbCreationsInFlight.get(idempotencyKey) === run) {
      deverbCreationsInFlight.delete(idempotencyKey);
    }
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

  /* Idempotency (CA-2, Pattern B): server-derived key on EVERY call —
     the schema accepts no client key, so the intent hash IS the key.
     Intent = the mode + sha256 of the uploaded bytes. */
  const fileSha256 = await hashFileSha256(req.file.path);
  const idempotencyKey = buildChargeIdempotencyKey("deverb", req.userId!, undefined, {
    mode,
    fileSha256,
  });
  const jobId = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32);

  /* Replay, in-memory first: the same ask returns the SAME job. A
     FAILED job (refunded + key voided by the runner) is dropped so
     this request runs fresh below. */
  const existing = jobs.get(jobId);
  if (existing && existing.userId === req.userId) {
    if (existing.status !== "failed") {
      res.status(202).json({
        ...(existing.replayBody ?? {
          jobId: existing.id,
          status: existing.status,
          mode: existing.mode,
          creditsCharged: existing.creditsCharged,
        }),
        replayed: true,
      });
      return;
    }
    jobs.delete(jobId);
  }

  /* Stored-result pre-check BEFORE any funding: serves a COMPLETED
     job's creation result after the in-memory job has been evicted. */
  const storedResult = await findStoredGenerationResult("deverb", idempotencyKey, req.userId!);
  if (storedResult) {
    res.status(202).json({ ...storedResult, replayed: true });
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

  const uploadedPath = req.file.path;
  const originalName = req.file.originalname;
  const outcome = await runDeverbCreationOnce(idempotencyKey, async (): Promise<DeverbCreationOutcome> => {
    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, DEVERB_CREDIT_COST, {
        action: `De-Reverb (${MODE_LABELS[mode]})`,
      }, { idempotencyKey });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        return {
          status: 402,
          body: {
            error: "out_of_credits",
            message: "You're out of Visual Bucs — top up to de-reverb audio.",
          },
        };
      }
      if (err instanceof LedgerWriteError) {
        return { status: 500, body: { error: "Could not record the Visual Buc charge. Please try again." } };
      }
      throw err;
    }

    const job: DeverbJob = {
      id: jobId,
      userId: req.userId!,
      status: "queued",
      mode,
      sourceName: originalName,
      outputUrl: null,
      outputRef: null,
      error: null,
      creditsCharged: DEVERB_CREDIT_COST,
      createdAt: Date.now(),
      chargeKey: idempotencyKey,
    };
    const body: Record<string, unknown> = {
      jobId: job.id,
      status: job.status,
      mode: job.mode,
      creditsCharged: DEVERB_CREDIT_COST,
      creditsRemaining,
    };
    job.replayBody = body;
    jobs.set(job.id, job);

    // Server-owned: runs detached from the request/tab lifecycle.
    void runDeverbJob(job, uploadedPath, originalName);

    return { status: 202, body };
  });

  if (outcome.replayed && outcome.status === 202) {
    res.status(202).json({ ...outcome.body, replayed: true });
    return;
  }
  res.status(outcome.status).json(outcome.body);
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
