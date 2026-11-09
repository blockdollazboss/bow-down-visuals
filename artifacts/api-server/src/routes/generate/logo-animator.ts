import { Router, type Response } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
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

/* ─── AI logo animator ───
   Turns a static logo into a 3-second animated logo sting
   (fade-in, slide-up, spin, pulse, glitch). 200 Visual Bucs. */

const LOGO_ANIMATOR_COST = Number(process.env["LOGO_ANIMATOR_CREDITS"]) || 200;
const STING_DURATION = 3;
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const LOGO_TARGET_W = 800;

const ANIMATION_STYLES = {
  "fade-in": {
    label: "Fade In",
    blurb: "Elegant fade in, hold, fade out",
    logoChain: "fade=t=in:st=0:d=1:alpha=1",
    x: "(W-w)/2",
    y: "(H-h)/2",
    tail: "fade=t=out:st=2:d=1",
  },
  "slide-up": {
    label: "Slide Up",
    blurb: "Slides up into frame, settles in the center",
    logoChain: "",
    x: "(W-w)/2",
    // Starts fully below the frame (y=H), settles centered by t=1.
    y: "'H-(H-(H-h)/2)*min(t\\,1)'",
    tail: "fade=t=in:st=0:d=0.5,fade=t=out:st=2:d=1",
  },
  spin: {
    label: "Spin",
    blurb: "Full 360° spin-in, holds steady",
    logoChain: "rotate=a='2*PI*t/1.5':fillcolor=black@0",
    x: "(W-w)/2",
    y: "(H-h)/2",
    tail: "fade=t=in:st=0:d=0.3,fade=t=out:st=2:d=1",
  },
  pulse: {
    label: "Pulse",
    blurb: "Breathing scale pulse",
    logoChain: "scale=w='800*(1+0.08*sin(2*PI*t))':h=-1:eval=frame",
    x: "(W-w)/2",
    y: "(H-h)/2",
    tail: "fade=t=in:st=0:d=0.5,fade=t=out:st=2:d=1",
  },
  glitch: {
    label: "Glitch",
    blurb: "Digital glitch bursts with jitter and grain",
    logoChain:
      "pad=iw:ih+24:0:12:black,crop=iw:ih:x='12*random(1)':y='24*random(1)',noise=alls=16:allf=t,eq=brightness='0.15*sin(28*PI*t)':saturation='1+0.6*gt(mod(t\\,0.75)\\,0.7)'",
    x: "(W-w)/2",
    y: "(H-h)/2",
    tail: "fade=t=in:st=0:d=0.5,fade=t=out:st=2:d=1",
  },
} as const;

type AnimationStyle = keyof typeof ANIMATION_STYLES;

const logoAnimatorSchema = z.object({
  logoUrl: z.string().trim().min(1).max(2048),
  style: z
    .string()
    .refine((v): v is AnimationStyle => v in ANIMATION_STYLES, {
      message: `Style must be one of: ${Object.keys(ANIMATION_STYLES).join(", ")}`,
    })
    .optional()
    .default("fade-in"),
  /** 6-digit hex background color, e.g. "0a0a0a". Defaults to black. */
  backgroundColor: z
    .string()
    .trim()
    .regex(/^#?[0-9a-fA-F]{6}$/, "backgroundColor must be a 6-digit hex color")
    .optional()
    .default("000000"),
});

router.get("/logo-animations", requireAuth, (_req, res) => {
  res.json({
    styles: Object.entries(ANIMATION_STYLES).map(([key, v]) => ({
      key,
      label: v.label,
      blurb: v.blurb,
    })),
  });
});


/* ── CA-3 replay protection (charge audit C-38) ───────────────────────
   This rail used to charge with NO idempotency key: a retry of a
   SUCCESSFUL request re-charged and re-ran the work. Now the server
   derives the key from the request intent on EVERY call, a
   stored-result pre-check (durable table, migration 0333, then the
   in-process cache) answers a replay with no charge and no provider
   call, and a failed attempt refunds AND voids its key so a genuine
   retry charges fresh. An identical ask serves the stored result
   with replayed: true instead of charging again (C-36 ruling). */
const LOGO_ANIMATOR_SCOPE = "logo-animator";
const LOGO_ANIMATOR_REPLAY_NOTE =
  "This is the logo sting you already made for this request — change the logo, style or background for a fresh one.";

interface StoredResult { body: Record<string, unknown>; at: number }
const storedResults = new Map<string, StoredResult>();
const inFlight = new Map<string, Promise<Record<string, unknown>>>();
const MAX_STORED_RESULTS = 500;

/** Test hook: forget every stored result and in-flight wait. */
export function __resetLogoAnimatorReplayCache(): void {
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
    ...body, replayed: true, replayNote: LOGO_ANIMATOR_REPLAY_NOTE,
  });

  const durable = await findStoredGenerationResult(LOGO_ANIMATOR_SCOPE, idempotencyKey, userId);
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
    await storeGenerationResult(LOGO_ANIMATOR_SCOPE, idempotencyKey, userId, { ...body });
  } catch { /* storing is best-effort — never fail a paid success over it */ }

  const postCharge = storedResults.get(idempotencyKey);
  if (postCharge && postCharge.body !== body) {
    res.json(replayOf(postCharge.body));
    return;
  }
  res.json(body);
}

async function runLogoAnimation(
  userId: string,
  userCredits: number,
  data: z.infer<typeof logoAnimatorSchema>,
  idempotencyKey: string,
  log: { error: (obj: object, msg: string) => void },
): Promise<Record<string, unknown>> {
  if (userCredits < LOGO_ANIMATOR_COST) {
    return {
      __status: 402,
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    };
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(userId, LOGO_ANIMATOR_COST, {
      action: `Logo Animator (${data.style})`,
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return { __status: 402, error: "out_of_credits", message: "Not enough Visual Bucs." };
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "logo-anim-"));
  const inputPath = join(workDir, "logo.png");
  const outputPath = join(workDir, "sting.mp4");

  try {
    const logoRes = await fetch(data.logoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!logoRes.ok) throw new Error("Could not download the logo.");
    await writeFile(inputPath, Buffer.from(await logoRes.arrayBuffer()));

    const style = ANIMATION_STYLES[data.style];
    const bgColor = data.backgroundColor.replace(/^#/, "").toLowerCase();

    // Scale the logo to a target width (pulse scales dynamically instead).
    const logoScale =
      data.style === "pulse" ? "" : `scale=${LOGO_TARGET_W}:-1,`;
    const logoChain = style.logoChain ? `,${style.logoChain}` : "";

    const filterComplex =
      `[1:v]${logoScale}format=rgba${logoChain}[logo];` +
      `[0:v][logo]overlay=x=${style.x}:y=${style.y},` +
      `${style.tail},format=yuv420p[v]`;

    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-f", "lavfi",
        "-i", `color=c=0x${bgColor}:s=${WIDTH}x${HEIGHT}:d=${STING_DURATION}:r=${FPS}`,
        "-loop", "1",
        "-framerate", String(FPS),
        "-i", inputPath,
        "-filter_complex", filterComplex,
        "-map", "[v]",
        "-t", String(STING_DURATION),
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        outputPath,
      ],
      { timeout: 300_000 }
    );

    const buffer = await readFile(outputPath);
    const objectName = `logo-animator/${userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    return {
      url,
      storageRef,
      style: data.style,
      durationSec: STING_DURATION,
      creditsRemaining: creditsAfter,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Logo animation failed.";
    log.error({ err: message }, "[animate-logo] failed");
    /* Refund + VOID so a genuine retry charges fresh instead of
       being suppressed as a replay and running free. */
    let refunded = true;
    try {
      await refundCredits(userId, LOGO_ANIMATOR_COST, {
        action: "Logo Animator — Refund",
      });
    } catch {
      refunded = false;
    }
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey);
    }
    return { __status: 500, error: message };
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

router.post("/animate-logo", requireAuth, async (req, res) => {
  const parsed = logoAnimatorSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }

  /* Idempotency (CA-3): the server derives the key from the request
     intent on EVERY call — a replay of the same ask is served from
     the stored sting instead of charging again. */
  const idempotencyKey = buildChargeIdempotencyKey(
    LOGO_ANIMATOR_SCOPE, req.userId!, undefined,
    {
      logoUrl: parsed.data.logoUrl, style: parsed.data.style,
      backgroundColor: parsed.data.backgroundColor,
    },
  );

  await serveReplayableRun({
    res,
    userId: req.userId!,
    idempotencyKey,
    run: () => runLogoAnimation(
      req.userId!, req.userCredits ?? 0, parsed.data, idempotencyKey, req.log,
    ),
  });
});

export default router;
