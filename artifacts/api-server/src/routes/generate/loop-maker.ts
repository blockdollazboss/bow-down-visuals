import { Router, type Response } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
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

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── AI seamless loop maker ───
   Repeats a video into a seamless loop. Each loop point is blended with an
   xfade/acrossfade crossfade, and the base segment itself is pre-blended so
   its tail melts back into its head — looping the output in a player shows
   no visible jump. 150 Visual Bucs. */

const LOOP_COST = Number(process.env["LOOP_MAKER_CREDITS"]) || 150;

const loopSchema = z
  .object({
    videoUrl: z.string().trim().min(1).max(2048),
    loops: z.number().int().min(1).max(20).optional(),
    duration: z.number().min(1).max(3600).optional(),
    crossfade: z.number().min(0.1).max(2).optional().default(0.5),
  })
  .refine((d) => (d.loops !== undefined) !== (d.duration !== undefined), {
    message: "Provide exactly one of loops (1-20) or duration (seconds).",
    path: ["loops"],
  });

/* ── CA-3 replay protection (charge audit C-38) ───────────────────────
   This rail used to charge with NO idempotency key: a retry of a
   SUCCESSFUL request re-charged 150 and re-rendered the loop. Now the
   server derives the key from the request intent on EVERY call, a
   stored-result pre-check (durable table, migration 0333, then the
   in-process cache) answers a replay with no charge and no render,
   and a failed attempt refunds AND voids its key so a genuine retry
   charges fresh. An identical ask serves the stored loop with
   replayed: true instead of charging again (C-36 ruling). */
const LOOP_SCOPE = "loop-maker";
const LOOP_REPLAY_NOTE =
  "This is the loop you already made for this request — change the video, loop count or crossfade for a fresh one.";

interface StoredResult { body: Record<string, unknown>; at: number }
const storedResults = new Map<string, StoredResult>();
const inFlight = new Map<string, Promise<Record<string, unknown>>>();
const MAX_STORED_RESULTS = 500;

/** Test hook: forget every stored result and in-flight wait. */
export function __resetLoopMakerReplayCache(): void {
  storedResults.clear();
  inFlight.clear();
}

/**
 * Serve one replayable run: durable + in-process stored-result
 * pre-checks before any funding, the in-flight twin wait for a
 * concurrent duplicate, then the run itself. A success is stored
 * BEFORE answering (contracts / post-assist pattern); an error body
 * (carrying __status) is answered bare and never stored.
 */
async function serveReplayableRun(args: {
  res: Response;
  userId: string;
  idempotencyKey: string;
  run: () => Promise<Record<string, unknown>>;
}): Promise<void> {
  const { res, userId, idempotencyKey } = args;
  const replayOf = (body: Record<string, unknown>) => ({
    ...body, replayed: true, replayNote: LOOP_REPLAY_NOTE,
  });

  const durable = await findStoredGenerationResult(LOOP_SCOPE, idempotencyKey, userId);
  if (durable) {
    res.json(replayOf(durable));
    return;
  }
  const stored = storedResults.get(idempotencyKey);
  if (stored) {
    res.json(replayOf(stored.body));
    return;
  }
  const pending = inFlight.get(idempotencyKey);
  if (pending) {
    const twinBody = await pending.catch(() => null);
    if (twinBody && typeof twinBody["__status"] !== "number") {
      res.json(replayOf(twinBody));
      return;
    }
    /* The twin failed (refunded + key voided) — fall through fresh. */
  }

  const runPromise = args.run();
  inFlight.set(idempotencyKey, runPromise);
  let body: Record<string, unknown>;
  try {
    body = await runPromise;
  } finally {
    if (inFlight.get(idempotencyKey) === runPromise) inFlight.delete(idempotencyKey);
  }

  const status = typeof body["__status"] === "number" ? (body["__status"] as number) : 200;
  if (status !== 200) {
    const { __status: _ignored, ...errorBody } = body;
    res.status(status).json(errorBody);
    return;
  }

  try {
    if (storedResults.size >= MAX_STORED_RESULTS) {
      const oldest = storedResults.keys().next().value as string | undefined;
      if (oldest !== undefined) storedResults.delete(oldest);
    }
    storedResults.set(idempotencyKey, { body, at: Date.now() });
    await storeGenerationResult(LOOP_SCOPE, idempotencyKey, userId, { ...body });
  } catch { /* storing is best-effort — never fail a paid success over it */ }

  const postCharge = storedResults.get(idempotencyKey);
  if (postCharge && postCharge.body !== body) {
    res.json(replayOf(postCharge.body));
    return;
  }
  res.json(body);
}

async function probeDuration(path: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      path,
    ],
    { timeout: 60_000 },
  );
  const d = parseFloat(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error("Could not read video duration.");
  return d;
}

async function hasAudioStream(path: string): Promise<boolean> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v", "error",
      "-select_streams", "a",
      "-show_entries", "stream=index",
      "-of", "csv=p=0",
      path,
    ],
    { timeout: 60_000 },
  );
  return stdout.trim().length > 0;
}

async function runLoopVideo(
  userId: string,
  userCredits: number,
  data: z.infer<typeof loopSchema>,
  idempotencyKey: string,
  log: { error: (obj: object, msg: string) => void },
): Promise<Record<string, unknown>> {
  if (userCredits < LOOP_COST) {
    return {
      __status: 402,
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    };
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(userId, LOOP_COST, {
      action: "Seamless loop video",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return { __status: 402, error: "out_of_credits", message: "Not enough Visual Bucs." };
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "loop-"));
  const inputPath = join(workDir, "input.mp4");
  const outputPath = join(workDir, "output.mp4");

  try {
    const vidRes = await fetch(data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const segDuration = await probeDuration(inputPath);
    const hasAudio = await hasAudioStream(inputPath);

    // Clamp the crossfade so it never eats more than a quarter of the clip.
    const fade = Math.min(data.crossfade, Math.max(0.1, segDuration / 4));

    const loops =
      data.loops !== undefined
        ? data.loops
        : Math.max(1, Math.round(data.duration! / segDuration));

    /* Build a seamless base segment: crossfade the clip into itself at
       offset (T - fade), then trim to T. The tail now melts into the head,
       so repeating the segment shows no jump at loop points. */
    const vParts: string[] = [];
    const aParts: string[] = [];
    const vLabels: string[] = [];
    const aLabels: string[] = [];

    if (loops === 1) {
      vParts.push(
        `[0:v][0:v]xfade=transition=fade:duration=${fade}:offset=${segDuration - fade},trim=duration=${segDuration},setpts=PTS-STARTPTS[vout]`,
      );
      vLabels.push("[vout]");
      if (hasAudio) {
        aParts.push(
          `[0:a][0:a]acrossfade=d=${fade}:c1=tri:c2=tri,atrim=duration=${segDuration},asetpts=PTS-STARTPTS[aout]`,
        );
        aLabels.push("[aout]");
      }
    } else {
      // First make the seamless base segment once.
      vParts.push(
        `[0:v][0:v]xfade=transition=fade:duration=${fade}:offset=${segDuration - fade},trim=duration=${segDuration},setpts=PTS-STARTPTS[base]`,
      );
      if (hasAudio) {
        aParts.push(
          `[0:a][0:a]acrossfade=d=${fade}:c1=tri:c2=tri,atrim=duration=${segDuration},asetpts=PTS-STARTPTS[abase]`,
        );
      }
      // Split the base into N copies and chain xfades at each boundary.
      const vSplits = Array.from({ length: loops }, (_, i) => `[v${i}]`).join("");
      vParts.push(`[base]split=${loops}${vSplits}`);
      let prev = "[v0]";
      for (let k = 1; k < loops; k++) {
        const out = k === loops - 1 ? "[vout]" : `[x${k}]`;
        const offset = k * (segDuration - fade);
        vParts.push(
          `${prev}[v${k}]xfade=transition=fade:duration=${fade}:offset=${offset}${out}`,
        );
        prev = out;
      }
      vLabels.push("[vout]");
      if (hasAudio) {
        const aSplits = Array.from({ length: loops }, (_, i) => `[a${i}]`).join("");
        aParts.push(`[abase]asplit=${loops}${aSplits}`);
        let aprev = "[a0]";
        for (let k = 1; k < loops; k++) {
          const out = k === loops - 1 ? "[aout]" : `[ax${k}]`;
          aParts.push(`${aprev}[a${k}]acrossfade=d=${fade}:c1=tri:c2=tri${out}`);
          aprev = out;
        }
        aLabels.push("[aout]");
      }
    }

    const filter = [...vParts, ...aParts].join(";");
    const totalDuration = loops * segDuration - (loops - 1) * fade;

    const args = ["-y", "-i", inputPath, "-filter_complex", filter];
    for (const l of vLabels) args.push("-map", l);
    for (const l of aLabels) args.push("-map", l);
    args.push(
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "+faststart",
      outputPath,
    );

    await execFileAsync("ffmpeg", args, { timeout: 600_000 });

    const buffer = await readFile(outputPath);
    const objectName = `loop/${userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    return {
      url,
      storageRef,
      loops,
      segmentDuration: Number(segDuration.toFixed(2)),
      totalDuration: Number(totalDuration.toFixed(2)),
      crossfade: fade,
      creditsRemaining: creditsAfter,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Loop video failed.";
    log.error({ err: message }, "[loop-video] failed");
    /* Refund + VOID so a genuine retry charges fresh instead of
       being suppressed as a replay and running free. */
    let refunded = true;
    try {
      await refundCredits(userId, LOOP_COST, {
        action: "Seamless loop video — Refund",
      });
    } catch {
      refunded = false;
    }
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey);
    }
    return { __status: 500, error: message };
  } finally {
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

router.post("/loop-video", requireAuth, async (req, res) => {
  const parsed = loopSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  /* Idempotency (CA-3): the server derives the key from the request
     intent on EVERY call — a replay of the same ask is served from
     the stored loop instead of charging again. */
  const idempotencyKey = buildChargeIdempotencyKey(
    LOOP_SCOPE, req.userId!, undefined,
    {
      videoUrl: parsed.data.videoUrl,
      loops: parsed.data.loops ?? null,
      duration: parsed.data.duration ?? null,
      crossfade: parsed.data.crossfade,
    },
  );

  await serveReplayableRun({
    res,
    userId: req.userId!,
    idempotencyKey,
    run: () => runLoopVideo(
      req.userId!, req.userCredits ?? 0, parsed.data, idempotencyKey, req.log,
    ),
  });
});

router.get("/loop-info", (_req, res) => {
  res.json({
    price: LOOP_COST,
    maxLoops: 20,
    maxDurationSec: 3600,
    description:
      "Repeats a video into a seamless loop with crossfade blending at every loop point.",
  });
});

export default router;
