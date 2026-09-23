import { Router, type Request, type Response, type NextFunction } from "express";
import { getOpenAI } from "../lib/ai-clients";
import { toFile } from "openai";
import multer from "multer";
import { requireAuth } from "../middlewares/require-auth";

const router = Router();

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

router.post("/transcribe", requireAuth, upload.single("audio"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No audio file provided" });
    return;
  }
  try {
    const audioFile = await toFile(
      req.file.buffer,
      req.file.originalname || "audio.mp3",
      { type: req.file.mimetype },
    );
    const transcription = await getOpenAI().audio.transcriptions.create(
      {
        file: audioFile,
        model: "whisper-1",
      },
      { signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS) },
    );
    res.json({ transcript: transcription.text });
  } catch (err) {
    req.log.error({ err }, "Transcription failed");
    if (isTimeoutError(err)) {
      timeoutResponse(res);
      return;
    }
    res.status(500).json({ error: "Transcription failed" });
  }
});

/** Transcribe an already-uploaded audio file by URL (Supabase storage). */
router.post("/transcribe-url", requireAuth, async (req, res) => {
  const { audioUrl } = req.body as { audioUrl?: string };

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

    const fileName = parsedUrl.pathname.split("/").pop() ?? "audio.mp3";
    const audioFile = await toFile(buffer, decodeURIComponent(fileName), { type: contentType });

    type VerboseTranscription = {
      text: string;
      duration?: number;
      segments?: Array<{ id: number; start: number; end: number; text: string }>;
      words?: Array<{ word: string; start: number; end: number }>;
      language?: string;
    };

    // Requesting word-level granularity (in addition to segment-level) gives
    // much finer-grained timestamps than segment boundaries alone — segments
    // can span several seconds/several words, which is too coarse to track
    // sung vocals (melisma, held notes, word stretching) accurately. Word
    // timestamps let the client align each caption line to the actual words
    // being sung rather than the whole segment they fall within.
    const transcription = (await getOpenAI().audio.transcriptions.create(
      {
        file: audioFile,
        model: "whisper-1",
        response_format: "verbose_json",
        timestamp_granularities: ["word", "segment"],
      },
      { signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS) },
    )) as unknown as VerboseTranscription;

    res.json({
      transcript: transcription.text,
      segments: transcription.segments ?? null,
      words: transcription.words ?? null,
      duration: transcription.duration ?? null,
      language: transcription.language ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "URL transcription failed");
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
