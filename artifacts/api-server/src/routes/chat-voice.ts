/**
 * chat-voice.ts — Thy Cheat Code chat voice-IN, the server fallback.
 *
 *  POST /api/chat/voice/transcribe → { transcript }
 *
 * Why this exists: chat voice input rides the browser's Web Speech API
 * (lib/chat-voice seam on the client) — free, instant, and absent in
 * some browsers, where voice-in simply did not exist. Browsers without
 * it now record the utterance with MediaRecorder and send it here; this
 * route transcribes it through the ONE shared timed-transcription seam
 * (lib/transcription.ts — ElevenLabs Scribe, env ELEVENLABS_SCRIBE_MODEL,
 * default scribe_v2) and hands the text back to the same chat send path
 * a typed message uses.
 *
 * THE MONEY RULE — stated here, in code, before anything else:
 * CHAT_VOICE_TRANSCRIBE_CREDITS is 0, permanently, for this endpoint.
 * Browser-first means the free Web Speech path stays the default
 * wherever it exists; this server path fires ONLY where that API is
 * unsupported. Free-chat is free, so its voice fallback is free too —
 * a chat utterance must NEVER silently become a charged transcription
 * (the song-file rails in routes/transcribe.ts charge 100 VB per call;
 * this is not that rail and never joins it). The house absorbs the
 * tiny per-utterance Scribe cost. This module therefore imports NO
 * credit code at all — there is nothing here that could charge — and
 * the route test pins both facts. If chat voice is ever to be priced,
 * that is an owner ruling and a different change, never a quiet edit
 * to this file.
 *
 * Caps: chat utterances are SHORT. The client stops recording at
 * CHAT_VOICE_MAX_UTTERANCE_SEC (30s — mirrored in the client's
 * lib/chat-voice.ts), and this route refuses audio over
 * CHAT_VOICE_MAX_AUDIO_BYTES before any provider call, so a song file
 * can never be smuggled through the free chat rail.
 *
 * Auth: requireAuth, like the rest of chat (chat-speak) — the fallback
 * is a signed-in member's microphone, not a public transcription API.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { transcribeAudioTimed } from "../lib/transcription";
import { logger } from "../lib/logger";

const router = Router();

/** Visual Bucs charged per chat-voice transcription: ZERO. See the
 *  money rule in the file header — free-chat is free, so its voice
 *  fallback is free; the house absorbs the provider cost. */
export const CHAT_VOICE_TRANSCRIBE_CREDITS = 0;

/** Max spoken length for one chat utterance, in seconds. The client
 *  enforces this while recording (lib/chat-voice.ts carries the same
 *  constant); the byte cap below is this route's own enforcement. */
export const CHAT_VOICE_MAX_UTTERANCE_SEC = 30;

/** Hard audio-size cap for one chat utterance. 30 seconds of any
 *  MediaRecorder format a browser produces (webm/opus, mp4/aac) lands
 *  far under this; the cap exists so the free chat rail can never be
 *  used as a free song-file transcriber. */
export const CHAT_VOICE_MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CHAT_VOICE_MAX_AUDIO_BYTES },
  fileFilter: (_req, file, cb) => {
    /* MediaRecorder reports audio/* everywhere (some browsers wrap it
       as video/webm for audio-only captures — same allowance the
       song transcription rail makes). */
    if (file.mimetype.startsWith("audio/") || file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed"));
    }
  },
});

/** Filename the transcription seam labels the upload with — derived
 *  from the recorded mime type, never from client-supplied names. */
function filenameForMime(mimeType: string): string {
  if (mimeType.includes("mp4")) return "chat-voice.m4a";
  if (mimeType.includes("ogg")) return "chat-voice.ogg";
  if (mimeType.includes("wav")) return "chat-voice.wav";
  if (mimeType.includes("mpeg")) return "chat-voice.mp3";
  return "chat-voice.webm";
}

router.post(
  "/chat/voice/transcribe",
  publicApiLimiter,
  requireAuth,
  upload.single("audio"),
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({
        error: "no_audio",
        message: "No audio was recorded — tap the mic and try again, or just type.",
      });
      return;
    }
    try {
      /* The shared Scribe seam. No charge before it, no charge after
         it, no charge on failure — see the money rule in the header. */
      const transcription = await transcribeAudioTimed({
        buffer: req.file.buffer,
        filename: filenameForMime(req.file.mimetype),
        mimeType: req.file.mimetype,
      });
      const transcript = transcription.text.trim();
      if (!transcript) {
        /* Heard nothing intelligible — say so honestly (the client
           maps this to its no-speech state), never invent words. */
        res.status(422).json({
          error: "no_speech",
          message: "I couldn't hear any words in that — tap the mic and try again.",
        });
        return;
      }
      res.json({ transcript });
    } catch (err) {
      logger.error({ err }, "chat-voice: transcription failed");
      res.status(502).json({
        error: "transcription_failed",
        message:
          "I recorded you, but couldn't turn it into text just now — tap the mic to try again, or just type.",
      });
      return;
    }
  },
);

/** Turn multer upload errors into clean JSON the client can show. */
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "too_long",
        message: `That was longer than a chat message can be — keep it under ${CHAT_VOICE_MAX_UTTERANCE_SEC} seconds, or just type it.`,
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
