import { Router } from "express";
import OpenAI, { toFile } from "openai";
import multer from "multer";
import { requireAuth } from "../middlewares/require-auth";

const router = Router();
const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
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
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
    });
    res.json({ transcript: transcription.text });
  } catch (err) {
    req.log.error({ err }, "Transcription failed");
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
      /* If SUPABASE_URL is malformed, skip check but log */
      req.log.warn("SUPABASE_URL is malformed — skipping SSRF host check");
    }
  }

  try {
    const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(90_000) });
    if (!audioRes.ok) {
      res.status(400).json({ error: `Could not fetch audio: HTTP ${audioRes.status}` });
      return;
    }

    const contentType = audioRes.headers.get("content-type") ?? "audio/mpeg";
    const buffer = Buffer.from(await audioRes.arrayBuffer());

    const fileName = parsedUrl.pathname.split("/").pop() ?? "audio.mp3";
    const audioFile = await toFile(buffer, decodeURIComponent(fileName), { type: contentType });

    type VerboseTranscription = {
      text: string;
      duration?: number;
      segments?: Array<{ id: number; start: number; end: number; text: string }>;
      language?: string;
    };

    const transcription = (await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      response_format: "verbose_json",
    })) as unknown as VerboseTranscription;

    res.json({
      transcript: transcription.text,
      segments: transcription.segments ?? null,
      duration: transcription.duration ?? null,
      language: transcription.language ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "URL transcription failed");
    const msg = err instanceof Error ? err.message : "Transcription failed";
    res.status(500).json({ error: `Could not transcribe song: ${msg}` });
  }
});

export default router;
