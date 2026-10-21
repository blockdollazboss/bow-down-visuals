import { Router, type Request, type Response, type NextFunction } from "express";
import { createHash } from "crypto";
import { getOpenAI, getPlainTranscribeModel } from "../lib/ai-clients";
import { transcribeAudioTimed } from "../lib/transcription";
import { toFile } from "openai";
import multer from "multer";
import { requireAuth } from "../middlewares/require-auth";
import { freeAiLimiter } from "../lib/rate-limit";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  LedgerWriteError,
  buildChargeIdempotencyKey,
} from "../lib/credits";

const router = Router();

/* Charged server-side at the price the UI has always displayed for
   these tools (frontend registry: "/api/transcribe" and
   "/api/transcribe-url" → 100 Visual Bucs each). Until the owner's
   2026-10-14 ruling both routes called the paid transcription models
   for free. */
const TRANSCRIBE_CREDIT_COST = 100;

/**
 * Charge the displayed transcription price before the paid provider
 * call. Returns the balance after the charge, or null after sending
 * the standard error response (402 out_of_credits / 500 ledger) — the
 * caller must return immediately on null. The idempotency key is
 * stable per (user, endpoint, request-intent): a double-tap or retry
 * of the same transcription can't double-charge.
 */
async function chargeForTranscription(
  req: Request,
  res: Response,
  scope: "transcribe" | "transcribe-url",
  clientKey: unknown,
  intent: unknown,
): Promise<number | null> {
  /* Balance fast-fail on the middleware balance (skipped in dev, the
     thumbnail-generator pattern); chargeCredits re-reads fresh and is
     authoritative. */
  const isDev = process.env["NODE_ENV"] === "development";
  if (!isDev && (req.userCredits ?? 0) < TRANSCRIBE_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You are out of Visual Bucs. Buy more Visual Bucs to keep creating.",
      required: TRANSCRIBE_CREDIT_COST,
    });
    return null;
  }
  const idempotencyKey = buildChargeIdempotencyKey(scope, req.userId!, clientKey, intent);
  try {
    return await chargeCredits(req.userId!, TRANSCRIBE_CREDIT_COST, {
      action: scope === "transcribe" ? "Transcribe Audio" : "Transcribe",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You are out of Visual Bucs. Buy more Visual Bucs to keep creating.",
        required: TRANSCRIBE_CREDIT_COST,
      });
      return null;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed — no Visual Bucs were charged. Please try again." });
      return null;
    }
    throw err;
  }
}

/** Refund a transcription charge after a provider-side failure. */
async function refundTranscription(req: Request): Promise<void> {
  await refundCredits(req.userId!, TRANSCRIBE_CREDIT_COST, {
    action: "Transcribe — Refund (transcription failed)",
  }).catch(() => {});
}

/** Whisper's hard file-size limit */
const WHISPER_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Bound the Whisper call so a slow/stalled transcription never hangs the
 * request forever. The frontend uses a slightly longer timeout so this
 * server-side error (with its clearer message) wins the race.
 */
const WHISPER_TIMEOUT_MS = 240_000; // 4 minutes

function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "TimeoutError" ||
    err.name === "AbortError" ||
    /timed out|timeout|aborted/i.test(err.message)
  );
}

function timeoutResponse(res: Response) {
  res.status(504).json({
    error: "TRANSCRIBE_TIMEOUT",
    message:
      "Transcription took too long. Try a shorter audio file (or a lower-bitrate MP3), or paste your lyrics manually.",
  });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: WHISPER_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("audio/") || file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed"));
    }
  },
});

router.post("/transcribe", requireAuth, freeAiLimiter, upload.single("audio"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No audio file provided" });
    return;
  }
  /* Charge the displayed price before the paid provider call. The
     request-intent is the uploaded file itself (bytes hash), so a
     retry of the same upload can't double-charge. */
  const fileHash = createHash("sha256").update(req.file.buffer).digest("hex");
  const creditsAfter = await chargeForTranscription(
    req,
    res,
    "transcribe",
    (req.body as { idempotencyKey?: unknown } | undefined)?.idempotencyKey,
    { fileHash, name: req.file.originalname ?? "" },
  );
  if (creditsAfter === null) return; // error response already sent
  try {
    const audioFile = await toFile(
      req.file.buffer,
      req.file.originalname || "audio.mp3",
      { type: req.file.mimetype },
    );
    const transcription = await getOpenAI().audio.transcriptions.create(
      {
        file: audioFile,
        // Plain text only — this route returns just the transcript, so it
        // runs on the plain-transcription model (gpt-transcribe). The
        // /transcribe-url route below uses the timed seam
        // (lib/transcription.ts): its clients align captions to the word
        // timestamps it returns.
        model: getPlainTranscribeModel(),
        response_format: "json",
      },
      { signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS) },
    );
    res.json({ transcript: transcription.text, creditsRemaining: creditsAfter });
  } catch (err) {
    req.log.error({ err }, "Transcription failed");
    /* Provider failure after the charge — refund with a ledger trace. */
    await refundTranscription(req);
    if (isTimeoutError(err)) {
      timeoutResponse(res);
      return;
    }
    res.status(500).json({ error: "Transcription failed" });
  }
});

/** Transcribe an already-uploaded audio file by URL (Supabase storage). */
router.post("/transcribe-url", requireAuth, freeAiLimiter, async (req, res) => {
  const { audioUrl, idempotencyKey: clientIdempotencyKey } = req.body as {
    audioUrl?: string;
    idempotencyKey?: unknown;
  };

  if (!audioUrl) {
    res.status(400).json({ error: "audioUrl is required" });
    return;
  }

  /* SSRF protection — only allow URLs from the project's Supabase storage */
  const supabaseUrl = process.env["SUPABASE_URL"] ?? "";
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(audioUrl);
  } catch {
    res.status(400).json({ error: "Invalid audio URL." });
    return;
  }

  if (supabaseUrl) {
    try {
      const allowed = new URL(supabaseUrl).hostname;
      if (parsedUrl.hostname !== allowed) {
        res.status(400).json({ error: "Audio URL must be from your project storage." });
        return;
      }
    } catch {
      req.log.warn("SUPABASE_URL is malformed — skipping SSRF host check");
    }
  }

  /* Tracks whether the charge landed, so the catch block refunds only
     failures that happen after it (fetch/size failures before the
     charge were never charged). */
  let charged = false;
  try {
    /* ── HEAD request: check Content-Length before downloading ── */
    const headRes = await fetch(audioUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(15_000),
    });
    const contentLength = headRes.headers.get("content-length");
    if (contentLength && Number(contentLength) > WHISPER_MAX_BYTES) {
      const sizeMB = (Number(contentLength) / (1024 * 1024)).toFixed(1);
      res.status(413).json({
        error: "FILE_TOO_LARGE",
        message: `This song file is ${sizeMB} MB, which exceeds the 25 MB transcription limit. Please upload a smaller MP3 or paste your lyrics manually.`,
      });
      return;
    }

    /* ── Download ── */
    const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(90_000) });
    if (!audioRes.ok) {
      res.status(400).json({ error: `Could not fetch audio: HTTP ${audioRes.status}` });
      return;
    }

    const contentType = audioRes.headers.get("content-type") ?? "audio/mpeg";
    const buffer = Buffer.from(await audioRes.arrayBuffer());

    /* ── Size guard (catches files where Content-Length was missing) ── */
    if (buffer.length > WHISPER_MAX_BYTES) {
      const sizeMB = (buffer.length / (1024 * 1024)).toFixed(1);
      res.status(413).json({
        error: "FILE_TOO_LARGE",
        message: `This song file is ${sizeMB} MB, which exceeds the 25 MB transcription limit. Please upload a smaller MP3 or paste your lyrics manually.`,
      });
      return;
    }

    /* ── Charge the displayed price — every free validation (SSRF,
       reachability, size) has passed; the paid provider call is next.
       The request-intent is the audio URL, so a retry of the same
       transcription can't double-charge. ── */
    const creditsAfter = await chargeForTranscription(
      req,
      res,
      "transcribe-url",
      clientIdempotencyKey,
      { audioUrl },
    );
    if (creditsAfter === null) return; // error response already sent
    charged = true;

    const fileName = parsedUrl.pathname.split("/").pop() ?? "audio.mp3";

    // Word-level timestamps (in addition to segment-level) give much
    // finer-grained timing than segment boundaries alone — segments can
    // span several seconds/several words, which is too coarse to track
    // sung vocals (melisma, held notes, word stretching) accurately.
    // Word timestamps let the client align each caption line to the
    // actual words being sung rather than the whole segment they fall
    // within. The timed seam returns exactly this shape.
    const transcription = await transcribeAudioTimed({
      buffer,
      filename: decodeURIComponent(fileName),
      mimeType: contentType,
      signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS),
    });

    res.json({
      transcript: transcription.text,
      segments: transcription.segments ?? null,
      words: transcription.words ?? null,
      duration: transcription.duration ?? null,
      language: transcription.language ?? null,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    req.log.error({ err }, "URL transcription failed");
    /* Provider failure after the charge — refund with a ledger trace. */
    if (charged) await refundTranscription(req);
    /* Admin-only lockdown (thrown by the charge): use the same shape
       the global error handler gives it, not a transcription 500. */
    if (err instanceof Error && err.name === "CreditsDisabledError") {
      res.status(403).json({
        error: "credits_disabled",
        message: "Credit spending is temporarily disabled. Please try again later.",
      });
      return;
    }
    const msg = err instanceof Error ? err.message : "Transcription failed";
    if (isTimeoutError(err)) {
      timeoutResponse(res);
      return;
    }
    /* Surface OpenAI's own 413 / content-length errors cleanly */
    if (msg.toLowerCase().includes("413") || msg.toLowerCase().includes("content size") || msg.toLowerCase().includes("too large")) {
      res.status(413).json({
        error: "FILE_TOO_LARGE",
        message: "This song file is too large to transcribe. Please upload a smaller MP3 or paste your lyrics manually.",
      });
      return;
    }
    res.status(500).json({ error: `Could not transcribe song: ${msg}` });
  }
});

/** Turn multer upload errors into clean JSON the frontend can display. */
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "FILE_TOO_LARGE",
        message:
          "This song file exceeds the 25 MB transcription limit. Please upload a smaller MP3 or paste your lyrics manually.",
      });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof Error && err.message === "Only audio files are allowed") {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
});

export default router;
