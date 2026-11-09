import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, mkdtemp, rm, access } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createHash, randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits, refundCredits, OutOfCreditsError,
  buildChargeIdempotencyKey, voidChargeIdempotencyKey,
} from "../../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../../lib/generation-stored-results";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";
import { attachJobMapTtl } from "../../lib/job-map-sweeper";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── Freeze Frame + Masks (CapCut parity, pure ffmpeg) ───────────────────
 * Two timeline effects, one job engine:
 *
 *  POST /api/freeze-frame  — hold the frame at `timestamp` for
 *    `holdDuration` seconds (CapCut-style freeze). Output video =
 *    pre-roll + frozen frame + post-roll. The original audio keeps playing
 *    underneath uninterrupted (audio is NOT stretched — this matches the
 *    "hold the picture while the moment lands" feel).
 *
 *  POST /api/apply-mask    — shape/linear/radial mask reveal. The masked
 *    region stays sharp; everything outside is blurred + dimmed (spotlight
 *    style, single-layer friendly — no alpha channel needed, so the result
 *    plays everywhere an mp4 does). `animate: "wipe"` sweeps/grows the mask
 *    across the clip duration. Optional burned-in `text` caption and an
 *    optional "Made with Bow Down Visuals" credit line (virality attribution).
 *
 * Both endpoints are async: the charge happens up front, the render runs in
 * the background, and the client polls GET /api/freeze-mask/job/:jobId.
 * Credits are auto-refunded when the render fails.
 *
 * Pricing (Visual Bucs, ×100 units): freeze 150, mask 200. ffmpeg only —
 * zero paid provider spend. */

const FREEZE_COST = Number(process.env["FREEZE_FRAME_CREDITS"]) || 150;
const MASK_COST = Number(process.env["APPLY_MASK_CREDITS"]) || 200;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
const FFMPEG_TIMEOUT_MS = 600_000; // masks on long 1080p clips can take minutes
const JOB_TTL_MS = 60 * 60 * 1000;

const freezeSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  /** Seconds into the clip where the frame is frozen. */
  timestamp: z.number().min(0).max(86400),
  /** How long the frame is held, in seconds. */
  holdDuration: z.number().min(0.5).max(5).default(2),
  /** Burn "Made with Bow Down Visuals" into the export (virality credit). */
  credit: z.boolean().default(false),
});

const maskSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  shape: z.enum(["ellipse", "rectangle", "linear", "radial"]).default("ellipse"),
  /** Edge softness 0–100. */
  feather: z.number().min(0).max(100).default(25),
  /** Flip the mask: sharp outside, blurred inside. */
  invert: z.boolean().default(false),
  /** "wipe" animates the mask across the clip (reveal); "none" is static. */
  animate: z.enum(["none", "wipe"]).default("none"),
  /** Optional burned-in caption (max 80 chars), bottom-center. */
  text: z.string().trim().max(80).default(""),
  /** Burn "Made with Bow Down Visuals" into the export (virality credit). */
  credit: z.boolean().default(false),
});

/* ─── Async job store (in-memory; jobs are cheap, TTL'd) ─── */

type JobStatus = "processing" | "done" | "failed";

interface FreezeMaskJob {
  id: string;
  userId: string;
  kind: "freeze-frame" | "apply-mask";
  cost: number;
  status: JobStatus;
  url?: string;
  storageRef?: string;
  error?: string;
  createdAt: number;
  /* CA-2 replay plumbing (Pattern B): the charge's idempotency key and
     the exact POST body served at creation. */
  chargeKey?: string;
  replayBody?: Record<string, unknown>;
}

const jobs = new Map<string, FreezeMaskJob>();
attachJobMapTtl(jobs); // 2026-10-12 OOM fix: TTL eviction (lib/job-map-sweeper)

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}

/* ─── Shared helpers ─── */

async function downloadVideo(videoUrl: string, workDir: string): Promise<string> {
  const inputPath = join(workDir, "input.mp4");
  const vidRes = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
  if (!vidRes.ok) throw new Error("Could not download the video.");
  const inputBytes = Buffer.from(await vidRes.arrayBuffer());
  if (inputBytes.length > MAX_DOWNLOAD_BYTES) {
    throw new Error("Video is too large (max 100 MB).");
  }
  await writeFile(inputPath, inputBytes);
  return inputPath;
}

interface ProbeInfo {
  duration: number;
  fps: number;
  hasAudio: boolean;
}

async function probeVideo(inputPath: string): Promise<ProbeInfo> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=avg_frame_rate:format=duration",
      "-of", "default=nw=1:nk=1",
      inputPath,
    ],
    { timeout: 30_000 },
  );
  const lines = stdout.trim().split("\n");
  const rateStr = (lines[0] ?? "").trim();
  const dur = parseFloat((lines[1] ?? "").trim());
  let fps = 30;
  const m = rateStr.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m && Number(m[2]) > 0) {
    const f = Number(m[1]) / Number(m[2]);
    if (Number.isFinite(f) && f > 0 && f <= 240) fps = f;
  }
  const hasAudio = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", inputPath],
  )
    .then((r) => r.stdout.trim().length > 0)
    .catch(() => false);
  return { duration: Number.isFinite(dur) && dur > 0 ? dur : 0, fps, hasAudio };
}

const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
];

async function findFont(): Promise<string | null> {
  for (const p of FONT_CANDIDATES) {
    try {
      await access(p);
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** drawtext chain for the optional virality credit + caption. */
async function captionFilters(workDir: string, text: string, credit: boolean): Promise<{ filters: string[]; files: string[] }> {
  const filters: string[] = [];
  const files: string[] = [];
  if (!text && !credit) return { filters, files };
  const font = await findFont();
  if (!font) return { filters, files }; // no font on this box — skip silently
  if (text) {
    const textPath = join(workDir, "caption.txt");
    await writeFile(textPath, text);
    files.push(textPath);
    filters.push(
      `drawtext=fontfile=${font}:textfile=${textPath}:fontsize=h/13:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-text_h-56`,
    );
  }
  if (credit) {
    const creditPath = join(workDir, "credit.txt");
    await writeFile(creditPath, "Made with Bow Down Visuals");
    files.push(creditPath);
    // Small gold-ish tag, bottom-right — visible attribution, never in the way.
    filters.push(
      `drawtext=fontfile=${font}:textfile=${creditPath}:fontsize=h/26:fontcolor=0xE8C96A:borderw=1:bordercolor=black:x=w-text_w-24:y=h-text_h-24`,
    );
  }
  return { filters, files };
}

const BASE_ENCODE = [
  "-c:v", "libx264",
  "-crf", "18",
  "-preset", "veryfast",
  "-pix_fmt", "yuv420p",
  "-c:a", "aac",
  "-movflags", "+faststart",
];

/* ─── Freeze-frame render ─── */

async function renderFreezeFrame(
  inputPath: string,
  outputPath: string,
  workDir: string,
  opts: { timestamp: number; holdDuration: number; credit: boolean },
): Promise<void> {
  const { duration } = await probeVideo(inputPath);
  if (duration < 0.8) throw new Error("Clip is too short to freeze (under 1s).");
  const T = Math.min(Math.max(opts.timestamp, 0.2), duration - 0.2);
  const D = opts.holdDuration;
  // Normalize to 30 fps so the select() frame number is exact.
  const FN = Math.round(T * 30);
  const LOOP = Math.ceil(D * 30) + 30; // overshoot; trim() pins the exact length

  const { filters: capFilters } = await captionFilters(workDir, "", opts.credit);

  const filter =
    `[0:v]fps=30,split=3[vp][vf][vn];` +
    `[vp]trim=start=0:end=${T.toFixed(3)},setpts=PTS-STARTPTS[pre];` +
    `[vf]select='eq(n,${FN})',setpts=PTS-STARTPTS,loop=loop=${LOOP}:size=1,` +
    `trim=start=0:duration=${D.toFixed(3)},fps=30,setpts=PTS-STARTPTS[frz];` +
    `[vn]trim=start=${T.toFixed(3)},setpts=PTS-STARTPTS[post];` +
    `[pre][frz][post]concat=n=3:v=1:a=0` +
    (capFilters.length > 0 ? `,${capFilters.join(",")}` : "") +
    `[vout]`;

  const args = [
    "-y", "-i", inputPath,
    "-filter_complex", filter,
    "-map", "[vout]",
    "-map", "0:a?",
    ...BASE_ENCODE,
    outputPath,
  ];
  await execFileAsync("ffmpeg", args, { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
}

/* ─── Mask render ─── */

type MaskShape = "ellipse" | "rectangle" | "linear" | "radial";

/**
 * Build the geq luminance expression for the mask. All expressions are
 * resolution-relative (X/W, Y/H) and run on a half-res copy for speed —
 * the mask is inherently soft, so no visible quality is lost.
 * `prog` is the reveal progress expression (0→1 across the clip).
 */
function maskExpression(shape: MaskShape, animate: "none" | "wipe", prog: string): string {
  switch (shape) {
    case "ellipse":
      if (animate === "wipe") {
        // Circle wipe: the circle grows from a point to cover the frame.
        const k = `(0.08+0.52*${prog})`;
        return `if(lt(((X-W/2)/(W*${k}))^2+((Y-H/2)/(H*${k})))^2,1),255,0)`;
      }
      return `if(lt(((X-W/2)/(W*0.36))^2+((Y-H/2)/(H*0.36))^2,1),255,0)`;
    case "rectangle":
      if (animate === "wipe") {
        // Bar reveal: a vertical bar sweeps left → right.
        // (geq has no and(): nest if() — comparisons return 0/1.)
        return `if(gt(X,W*${prog}-W*0.14),if(lt(X,W*${prog}+W*0.14),255,0),0)`;
      }
      return `if(gt(X,W*0.18),if(lt(X,W*0.82),if(gt(Y,H*0.12),if(lt(Y,H*0.88),255,0),0),0),0)`;
    case "linear":
      if (animate === "wipe") {
        // Reveal sweep: a soft gradient edge travels left → right.
        return `255*clip(X/W-(1-${prog}),0,1)`;
      }
      return `255*clip(X/W,0,1)`;
    case "radial":
      if (animate === "wipe") {
        // Spotlight: the lit circle grows from a point to full frame.
        return `255*clip(1-sqrt(((X-W/2)/(W*0.5))^2+((Y-H/2)/(H*0.5))^2)+2*(${prog}-0.5),0,1)`;
      }
      return `255*(1-clip(sqrt(((X-W/2)/(W*0.5))^2+((Y-H/2)/(H*0.5))^2),0,1))`;
  }
}

async function renderMask(
  inputPath: string,
  outputPath: string,
  workDir: string,
  opts: { shape: MaskShape; feather: number; invert: boolean; animate: "none" | "wipe"; text: string; credit: boolean },
): Promise<void> {
  const { duration } = await probeVideo(inputPath);
  if (duration <= 0) throw new Error("Could not read the video duration.");
  const prog = `(T/${duration.toFixed(3)})`;
  const expr = maskExpression(opts.shape, opts.animate, prog);

  // Feather is applied on the half-res mask, so halve the sigma; the
  // upscale back to full res adds a little extra softness for free.
  const featherSigma = (opts.feather / 100) * 10;
  const maskChain =
    `format=gray,scale=iw/2:ih/2,geq=lum='${expr}'` +
    (featherSigma > 0.1 ? `,gblur=sigma=${featherSigma.toFixed(2)}` : "") +
    `,format=gray`;

  const { filters: capFilters } = await captionFilters(workDir, opts.text, opts.credit);

  const filter =
    `[0:v]split=3[bg][fg][mk];` +
    // Outside the mask: blurred + dimmed backdrop (the spotlight look).
    `[bg]gblur=sigma=16,eq=brightness=-0.35:saturation=0.6[bgd];` +
    `[mk]${maskChain}[masksmall];` +
    // scale2ref keeps the mask pixel-aligned with the frame (odd dims safe).
    `[masksmall][fg]scale2ref=flags=bilinear[mask][fgR];` +
    (opts.invert ? `[mask]negate,format=gray[maski];` : "") +
    `[fgR]format=yuva420p[fgA];` +
    `[fgA][${opts.invert ? "maski" : "mask"}]alphamerge[fgM];` +
    `[bgd][fgM]overlay=0:0:format=yuv420` +
    (capFilters.length > 0 ? `,${capFilters.join(",")}` : "") +
    `[vout]`;

  const args = [
    "-y", "-i", inputPath,
    "-filter_complex", filter,
    "-map", "[vout]",
    "-map", "0:a?",
    ...BASE_ENCODE,
    outputPath,
  ];
  await execFileAsync("ffmpeg", args, { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
}

/* ─── Job runner ─── */

async function runJob(job: FreezeMaskJob, params: Record<string, unknown>, log: (obj: object, msg: string) => void) {
  const workDir = await mkdtemp(join(tmpdir(), "freeze-mask-"));
  try {
    const inputPath = await downloadVideo(params["videoUrl"] as string, workDir);
    const outputPath = join(workDir, "output.mp4");
    if (job.kind === "freeze-frame") {
      await renderFreezeFrame(inputPath, outputPath, workDir, {
        timestamp: params["timestamp"] as number,
        holdDuration: params["holdDuration"] as number,
        credit: params["credit"] as boolean,
      });
    } else {
      await renderMask(inputPath, outputPath, workDir, {
        shape: params["shape"] as MaskShape,
        feather: params["feather"] as number,
        invert: params["invert"] as boolean,
        animate: params["animate"] as "none" | "wipe",
        text: params["text"] as string,
        credit: params["credit"] as boolean,
      });
    }
    const buffer = await readFile(outputPath);
    const objectName = `freeze-mask/${job.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);
    job.status = "done";
    job.url = url;
    job.storageRef = storageRef;
    /* CA-2: persist the creation result under the charge key once the
       render has COMPLETED — a replay after the in-memory job is gone
       is served from the durable row instead of charging again. */
    if (job.chargeKey && job.replayBody) {
      await storeGenerationResult(job.kind, job.chargeKey, job.userId, job.replayBody);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Render failed.";
    log({ err: message }, `[freeze-mask] ${job.kind} job ${job.id} failed`);
    /* Refund landed → VOID the charge's idempotency key (fire-and-forget
       chain, response behavior unchanged): without the void a retry
       would be suppressed as a replay and render free. */
    await refundCredits(job.userId, job.cost, {
      action: `${job.kind === "freeze-frame" ? "Freeze frame" : "Mask effect"} — Refund`,
    })
      .then(() => (job.chargeKey ? voidChargeIdempotencyKey(job.chargeKey) : undefined))
      .catch(() => {});
    job.status = "failed";
    job.error = message;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function badRequest(res: { status: (c: number) => { json: (b: unknown) => void } }, issues: { field: string; message: string }[]) {
  res.status(400).json({ error: "Invalid request.", details: issues });
}

/* ── CA-2 replay plumbing (Pattern B, avatar-presenter shape) ──────────
   One helper serves TWO products (freeze frame / mask), so each kind
   gets its OWN scope/rail and the intent carries the kind plus its
   full params. The job's identity derives from the charge key (the
   job id is the key's hash): a replay of the same ask lands on the
   SAME job — no second charge, no second render. An in-flight twin
   map closes the concurrent window between charge and job-mint. */
interface FreezeCreationOutcome {
  status: number;
  body: Record<string, unknown>;
}

const freezeCreationsInFlight = new Map<string, Promise<FreezeCreationOutcome>>();

async function runFreezeCreationOnce(
  idempotencyKey: string,
  work: () => Promise<FreezeCreationOutcome>,
): Promise<FreezeCreationOutcome & { replayed: boolean }> {
  const pending = freezeCreationsInFlight.get(idempotencyKey);
  if (pending) {
    const twin = await pending.catch(() => null);
    if (twin && twin.status === 202) return { ...twin, replayed: true };
    /* The twin failed — run this request fresh. */
  }
  const run = work();
  freezeCreationsInFlight.set(idempotencyKey, run);
  try {
    const outcome = await run;
    return { ...outcome, replayed: false };
  } finally {
    if (freezeCreationsInFlight.get(idempotencyKey) === run) {
      freezeCreationsInFlight.delete(idempotencyKey);
    }
  }
}

async function startJob(
  req: { userId?: string; userCredits?: number; log: { error: (o: object, m: string) => void } },
  res: { status: (c: number) => { json: (b: unknown) => void }; json: (b: unknown) => void },
  kind: "freeze-frame" | "apply-mask",
  cost: number,
  label: string,
  params: Record<string, unknown>,
) {
  /* Idempotency (CA-2, Pattern B): server-derived key on EVERY call —
     the schemas accept no client key, so the intent hash IS the key. */
  const idempotencyKey = buildChargeIdempotencyKey(kind, req.userId!, undefined, {
    kind,
    ...params,
  });
  const jobId = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32);

  /* Replay, in-memory first: the same ask returns the SAME job. A
     FAILED job (refunded + key voided by the runner) is dropped so
     this request runs fresh below. */
  const existing = jobs.get(jobId);
  if (existing && existing.userId === req.userId) {
    if (existing.status !== "failed") {
      res.status(202).json({
        ...(existing.replayBody ?? { jobId: existing.id, status: existing.status, cost: existing.cost }),
        replayed: true,
      });
      return;
    }
    jobs.delete(jobId);
  }

  /* Stored-result pre-check BEFORE any funding: serves a COMPLETED
     job's creation result after the in-memory job has been evicted. */
  const storedResult = await findStoredGenerationResult(kind, idempotencyKey, req.userId!);
  if (storedResult) {
    res.status(202).json({ ...storedResult, replayed: true });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < cost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  const outcome = await runFreezeCreationOnce(idempotencyKey, async (): Promise<FreezeCreationOutcome> => {
    try {
      await chargeCredits(req.userId!, cost, { action: label }, { idempotencyKey });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        return { status: 402, body: { error: "out_of_credits", message: "Not enough Visual Bucs." } };
      }
      throw err;
    }

    pruneJobs();
    const job: FreezeMaskJob = {
      id: jobId,
      userId: req.userId!,
      kind,
      cost,
      status: "processing",
      createdAt: Date.now(),
      chargeKey: idempotencyKey,
    };
    const body: Record<string, unknown> = { jobId: job.id, status: "processing", cost };
    job.replayBody = body;
    jobs.set(job.id, job);
    // Fire and forget — the client polls for completion.
    void runJob(job, params, req.log.error.bind(req.log));
    return { status: 202, body };
  });

  if (outcome.replayed && outcome.status === 202) {
    res.status(202).json({ ...outcome.body, replayed: true });
    return;
  }
  res.status(outcome.status).json(outcome.body);
}

/* ─── Routes ─── */

router.post("/freeze-frame", requireAuth, async (req, res) => {
  const parsed = freezeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    badRequest(res, parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
    return;
  }
  await startJob(req, res, "freeze-frame", FREEZE_COST, "Freeze frame", parsed.data);
});

router.post("/apply-mask", requireAuth, async (req, res) => {
  const parsed = maskSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    badRequest(res, parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
    return;
  }
  await startJob(req, res, "apply-mask", MASK_COST, "Mask effect", parsed.data);
});

router.get("/freeze-mask/job/:jobId", requireAuth, async (req, res) => {
  const rawJobId = req.params["jobId"];
  const jobId = Array.isArray(rawJobId) ? rawJobId[0] ?? "" : rawJobId ?? "";
  const job = jobs.get(jobId);
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found." });
    return;
  }
  res.json({
    status: job.status,
    kind: job.kind,
    url: job.url ?? null,
    storageRef: job.storageRef ?? null,
    error: job.error ?? null,
  });
});

export default router;
