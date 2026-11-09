import { Router, type Response } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, mkdtemp } from "fs/promises";
import { existsSync } from "fs";
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

/* ─── Branded intro/outro generator (ffmpeg, no provider cost) ───
   Generates a 3-second animated intro (logo/brand reveal) and a 5-second
   outro (thanks + subscribe CTA) on a branded background using ffmpeg
   drawtext/drawbox animations. 350 Visual Bucs for both.
   NOTE: distinct from the Seedance-based /generate-intro-outro route. */

const INTRO_OUTRO_COST = Number(process.env["FFMPEG_INTRO_OUTRO_CREDITS"]) || 350;

const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const fontfileOpt = existsSync(FONT_BOLD) ? `fontfile='${FONT_BOLD}':` : "";

const STYLES = {
  gold: {
    label: "Gold Luxury",
    blurb: "Black + gold — the Bow Down Visuals house look",
    bg: "0x0a0a0a",
    text: "0xFFD166",
    accent: "0xFFD166",
    sub: "0xFFFFFF",
    border: true,
  },
  neon: {
    label: "Neon Nights",
    blurb: "Dark stage, electric cyan + magenta",
    bg: "0x060614",
    text: "0x00F0FF",
    accent: "0xFF2FD6",
    sub: "0xFFFFFF",
    border: true,
  },
  minimal: {
    label: "Minimal Clean",
    blurb: "White canvas, sharp black type",
    bg: "0xFFFFFF",
    text: "0x141414",
    accent: "0x141414",
    sub: "0x555555",
    border: false,
  },
  sunset: {
    label: "Sunset Glow",
    blurb: "Deep purple dusk, warm amber type",
    bg: "0x1B0B2E",
    text: "0xFFB347",
    accent: "0xFF5E78",
    sub: "0xFFFFFF",
    border: true,
  },
} as const;

type StyleKey = keyof typeof STYLES;

const RATIOS = {
  "16:9": { w: 1920, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
  "1:1": { w: 1080, h: 1080 },
} as const;

function escapeDrawtext(t: string): string {
  return t
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/%/g, "%%")
    .replace(/\r?\n/g, " ");
}

const introOutroSchema = z.object({
  brandName: z.string().trim().min(1).max(60),
  style: z.string().refine((v): v is StyleKey => v in STYLES, {
    message: `Style must be one of: ${Object.keys(STYLES).join(", ")}`,
  }).optional().default("gold"),
  tagline: z.string().trim().max(120).optional().default(""),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional().default("16:9"),
});

router.get("/intro-outro/styles", requireAuth, (_req, res) => {
  res.json({
    styles: Object.entries(STYLES).map(([key, v]) => ({
      key,
      label: v.label,
      blurb: v.blurb,
    })),
  });
});

function buildIntroFilter(
  brand: string, tagline: string, style: (typeof STYLES)[StyleKey],
  w: number, h: number,
): string {
  const s = Math.min(w, h) / 1080;
  const brandSize = Math.round(120 * s);
  const tagSize = Math.round(46 * s);
  const barW = Math.round(w * 0.28);
  const barH = Math.max(6, Math.round(8 * s));
  const border = style.border ? `:borderw=3:bordercolor=black@0.7` : "";
  const parts: string[] = [];

  // Brand name — rises in and fades up
  parts.push(
    `drawtext=${fontfileOpt}text='${escapeDrawtext(brand.toUpperCase())}'` +
    `:fontsize=${brandSize}:fontcolor=${style.text}` +
    `:x=(w-text_w)/2` +
    `:y='h*0.42-text_h/2-50*(1-clip((t-0.3)/1.0\\,0\\,1))'` +
    `:alpha='clip((t-0.3)/0.9\\,0\\,1)'${border}`,
  );
  // Accent bar — grows left→right under the brand
  parts.push(
    `drawbox=x='(w-${barW}*clip((t-0.9)/0.6\\,0\\,1))/2':y=h*0.56` +
    `:w='${barW}*clip((t-0.9)/0.6\\,0\\,1)':h=${barH}:color=${style.accent}:t=fill`,
  );
  // Tagline — fades in late
  if (tagline) {
    parts.push(
      `drawtext=${fontfileOpt}text='${escapeDrawtext(tagline)}'` +
      `:fontsize=${tagSize}:fontcolor=${style.sub}` +
      `:x=(w-text_w)/2:y=h*0.62` +
      `:alpha='clip((t-1.3)/0.7\\,0\\,1)'`,
    );
  }
  parts.push("fade=t=in:st=0:d=0.4", "fade=t=out:st=2.5:d=0.5", "format=yuv420p");
  return parts.join(",");
}

function buildOutroFilter(
  brand: string, style: (typeof STYLES)[StyleKey],
  w: number, h: number,
): string {
  const s = Math.min(w, h) / 1080;
  const thanksSize = Math.round(72 * s);
  const brandSize = Math.round(96 * s);
  const ctaSize = Math.round(52 * s);
  const pillW = Math.round(w * 0.26);
  const pillH = Math.round(120 * s);
  const border = style.border ? `:borderw=3:bordercolor=black@0.7` : "";
  const parts: string[] = [];

  // "Thanks for watching" — fades in
  parts.push(
    `drawtext=${fontfileOpt}text='THANKS FOR WATCHING'` +
    `:fontsize=${thanksSize}:fontcolor=${style.sub}` +
    `:x=(w-text_w)/2:y='h*0.28-text_h/2-30*(1-clip((t-0.2)/0.9\\,0\\,1))'` +
    `:alpha='clip((t-0.2)/0.8\\,0\\,1)'${border}`,
  );
  // Brand name
  parts.push(
    `drawtext=${fontfileOpt}text='${escapeDrawtext(brand.toUpperCase())}'` +
    `:fontsize=${brandSize}:fontcolor=${style.text}` +
    `:x=(w-text_w)/2:y=h*0.44-text_h/2` +
    `:alpha='clip((t-0.6)/0.8\\,0\\,1)'${border}`,
  );
  // Subscribe pill + pulsing CTA (drawbox has no alpha option — use timeline enable)
  parts.push(
    `drawbox=x=(w-${pillW})/2:y=h*0.64:w=${pillW}:h=${pillH}:color=${style.accent}:t=fill` +
    `:enable='gte(t\\,1.0)'`,
  );
  parts.push(
    `drawtext=${fontfileOpt}text='SUBSCRIBE'` +
    `:fontsize=${ctaSize}:fontcolor=${style.bg}` +
    `:x=(w-text_w)/2:y=h*0.64+(${pillH}-text_h)/2` +
    `:alpha='clip((t-1.0)/0.4\\,0\\,1)*(0.65+0.35*sin(2*PI*t/1.5))'`,
  );
  parts.push("fade=t=in:st=0:d=0.4", "fade=t=out:st=4.4:d=0.6", "format=yuv420p");
  return parts.join(",");
}


/* ── CA-3 replay protection (charge audit C-38) ───────────────────────
   This rail used to charge with NO idempotency key: a retry of a
   SUCCESSFUL request re-charged and re-ran the work. Now the server
   derives the key from the request intent on EVERY call, a
   stored-result pre-check (durable table, migration 0333, then the
   in-process cache) answers a replay with no charge and no provider
   call, and a failed attempt refunds AND voids its key so a genuine
   retry charges fresh. An identical ask serves the stored result
   with replayed: true instead of charging again (C-36 ruling). */
const INTRO_OUTRO_SCOPE = "intro-outro-ffmpeg";
const INTRO_OUTRO_REPLAY_NOTE =
  "This is the intro + outro you already made for this request — change the brand, style or tagline for a fresh pair.";

interface StoredResult { body: Record<string, unknown>; at: number }
const storedResults = new Map<string, StoredResult>();
const inFlight = new Map<string, Promise<Record<string, unknown>>>();
const MAX_STORED_RESULTS = 500;

/** Test hook: forget every stored result and in-flight wait. */
export function __resetIntroOutroReplayCache(): void {
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
    ...body, replayed: true, replayNote: INTRO_OUTRO_REPLAY_NOTE,
  });

  const durable = await findStoredGenerationResult(INTRO_OUTRO_SCOPE, idempotencyKey, userId);
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
    await storeGenerationResult(INTRO_OUTRO_SCOPE, idempotencyKey, userId, { ...body });
  } catch { /* storing is best-effort — never fail a paid success over it */ }

  const postCharge = storedResults.get(idempotencyKey);
  if (postCharge && postCharge.body !== body) {
    res.json(replayOf(postCharge.body));
    return;
  }
  res.json(body);
}

async function runIntroOutro(
  userId: string,
  userCredits: number,
  data: z.infer<typeof introOutroSchema>,
  idempotencyKey: string,
  log: { error: (obj: object, msg: string) => void },
): Promise<Record<string, unknown>> {
  if (userCredits < INTRO_OUTRO_COST) {
    return {
      __status: 402,
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    };
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(userId, INTRO_OUTRO_COST, {
      action: "Branded Intro + Outro",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return { __status: 402, error: "out_of_credits", message: "Not enough Visual Bucs." };
    }
    throw err;
  }

  const { brandName, style: styleKey, tagline, aspectRatio } = data;
  const style = STYLES[styleKey];
  const { w, h } = RATIOS[aspectRatio];
  const workDir = await mkdtemp(join(tmpdir(), "intro-outro-"));
  const introPath = join(workDir, "intro.mp4");
  const outroPath = join(workDir, "outro.mp4");

  try {
    await Promise.all([
      execFileAsync("ffmpeg", [
        "-y",
        "-f", "lavfi", "-i", `color=c=${style.bg}:s=${w}x${h}:d=3:r=30`,
        "-vf", buildIntroFilter(brandName, tagline, style, w, h),
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        introPath,
      ], { timeout: 120_000 }),
      execFileAsync("ffmpeg", [
        "-y",
        "-f", "lavfi", "-i", `color=c=${style.bg}:s=${w}x${h}:d=5:r=30`,
        "-vf", buildOutroFilter(brandName, style, w, h),
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        outroPath,
      ], { timeout: 120_000 }),
    ]);

    const [introBuf, outroBuf] = await Promise.all([
      readFile(introPath),
      readFile(outroPath),
    ]);

    const [introRef, outroRef] = await Promise.all([
      uploadMediaToSupabaseStorage(`intro-outro/${userId}/${randomUUID()}-intro.mp4`, introBuf, "video/mp4"),
      uploadMediaToSupabaseStorage(`intro-outro/${userId}/${randomUUID()}-outro.mp4`, outroBuf, "video/mp4"),
    ]);
    const [introUrl, outroUrl] = await Promise.all([
      refreshSupabaseStorageUrl(introRef),
      refreshSupabaseStorageUrl(outroRef),
    ]);

    return {
      introUrl,
      introStorageRef: introRef,
      outroUrl,
      outroStorageRef: outroRef,
      style: styleKey,
      aspectRatio,
      creditsRemaining: creditsAfter,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Intro/outro generation failed.";
    log.error({ err: message }, "[intro-outro] failed");
    /* Refund + VOID so a genuine retry charges fresh instead of
       being suppressed as a replay and running free. */
    let refunded = true;
    try {
      await refundCredits(userId, INTRO_OUTRO_COST, {
        action: "Branded Intro + Outro — Refund",
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

router.post("/intro-outro", requireAuth, async (req, res) => {
  const parsed = introOutroSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  /* Idempotency (CA-3): the server derives the key from the request
     intent on EVERY call — a replay of the same ask is served from
     the stored pair instead of charging again. */
  const idempotencyKey = buildChargeIdempotencyKey(
    INTRO_OUTRO_SCOPE, req.userId!, undefined,
    {
      brandName: parsed.data.brandName, style: parsed.data.style,
      tagline: parsed.data.tagline, aspectRatio: parsed.data.aspectRatio,
    },
  );

  await serveReplayableRun({
    res,
    userId: req.userId!,
    idempotencyKey,
    run: () => runIntroOutro(
      req.userId!, req.userCredits ?? 0, parsed.data, idempotencyKey, req.log,
    ),
  });
});

export default router;
