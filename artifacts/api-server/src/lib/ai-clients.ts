import OpenAI from "openai";

/* Lazy OpenAI client — constructed on first use, not at import time.
   Several routes used to do `new OpenAI(...)` at module load, which throws
   when OPENAI_API_KEY is absent and crashes the entire server at boot.
   With this helper, a missing key only fails the routes that need it. */
let cached: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!cached) {
    const key = process.env["OPENAI_API_KEY"];
    if (!key) {
      throw new Error(
        "OPENAI_API_KEY is not configured — this AI feature is unavailable."
      );
    }
    cached = new OpenAI({ apiKey: key });
  }
  return cached;
}

/* Default OpenAI text model for every prompt-generation route — env-overridable.
   gpt-6-sol is the current price/performance pick ($2 input / $10 output per 1M
   tokens). Override with OPENAI_TEXT_MODEL (e.g. gpt-6-astra for flagship,
   gpt-6-luna for the cheapest tier). */
export function getTextModel(): string {
  return process.env["OPENAI_TEXT_MODEL"] || "gpt-6-sol";
}

/* Plain-transcription model — for call sites that consume ONLY the
   transcript text (no word/segment timestamps). gpt-transcribe is the
   whisper-1 successor for these uses (whisper-1 is removed from the
   API on 2027-02-26). The TIMED paths (captions, lyric alignment,
   dubbing, chapters, and the other timestamp consumers) do NOT belong
   here: gpt-transcribe returns no timestamps and rejects verbose_json,
   so they run through the shared timed seam in lib/transcription.ts
   (ElevenLabs Scribe, adapted to the verbose_json shape). */
export function getPlainTranscribeModel(): string {
  return process.env["OPENAI_TRANSCRIBE_MODEL"] || "gpt-transcribe";
}
