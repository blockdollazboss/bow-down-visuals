/**
 * transcription.ts — the ONE shared seam for TIMED transcription
 * (call sites that consume word and/or segment timestamps: captions,
 * lyric alignment, dubbing, chapters, filler removal, …).
 *
 * These paths used to call OpenAI whisper-1 with
 * `response_format: "verbose_json"`. whisper-1 is removed from the
 * OpenAI API on 2027-02-26, and its plain-text successor
 * (gpt-transcribe, see getPlainTranscribeModel in lib/ai-clients.ts)
 * is NOT a replacement here: it returns no timestamps and rejects
 * verbose_json. Timed transcription therefore runs on ElevenLabs
 * Scribe, which returns word-level timestamps; this seam adapts the
 * Scribe response into the verbose_json shape every existing consumer
 * already reads ({ text, duration, language, words, segments }), so
 * the next model change is a one-line change here, not another
 * fourteen-site sweep.
 *
 * The one honest adaptation: Scribe returns words, not segments.
 * Segments are DERIVED from the word stream at this seam (split on
 * pauses, sentence ends, and a length cap) — the same fields consumers
 * use (start / end / text) with boundaries chosen from the words
 * themselves, never invented timings.
 *
 * Plain-text-only transcription does NOT belong here — it stays on
 * getPlainTranscribeModel() (gpt-transcribe) in lib/ai-clients.ts.
 */

const ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";

/** Callers that pass no AbortSignal get the old SDK-style ceiling. */
const DEFAULT_TIMEOUT_MS = 600_000;

/* Segment derivation from the word stream. Whisper's own segment
   boundaries were model-chosen too; these rules choose them from the
   words Scribe actually returned. */
const SEGMENT_PAUSE_SEC = 1.0;
const SEGMENT_MAX_SEC = 30;
const SEGMENT_MIN_SENTENCE_WORDS = 3;
const SEGMENT_MIN_SENTENCE_SEC = 1.5;
const SENTENCE_END = /[.!?…]["'”’)]?$/;

/** Timed-transcription model — env-overridable like its siblings
 *  (OPENAI_TRANSCRIBE_MODEL for plain transcription, ELEVENLABS_STS_MODEL
 *  for speech-to-speech). */
export function getTimedTranscribeModel(): string {
  return process.env["ELEVENLABS_SCRIBE_MODEL"] || "scribe_v2";
}

export interface TimedWord {
  word: string;
  start: number;
  end: number;
}

export interface TimedSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words: TimedWord[];
}

/** The verbose_json shape the timed consumers already read. */
export interface TimedTranscription {
  text: string;
  duration: number | null;
  language: string | null;
  words: TimedWord[];
  segments: TimedSegment[];
}

/** Raw ElevenLabs Scribe response (only the fields this seam reads). */
export interface ScribeTranscriptionResponse {
  text?: string;
  language_code?: string;
  audio_duration_secs?: number;
  words?: Array<{
    text?: string;
    start?: number;
    end?: number;
    /** "word" | "spacing" | "audio_event" — only real words are kept. */
    type?: string;
  }>;
}

/** Group a flat word stream into segments. Exported for tests. */
export function buildSegmentsFromWords(words: TimedWord[]): TimedSegment[] {
  const segments: TimedSegment[] = [];
  let current: TimedWord[] = [];
  const flush = () => {
    if (current.length === 0) return;
    segments.push({
      id: segments.length,
      start: current[0]!.start,
      end: current[current.length - 1]!.end,
      text: current.map((w) => w.word).join(" "),
      words: current,
    });
    current = [];
  };
  for (const w of words) {
    if (current.length > 0) {
      const prev = current[current.length - 1]!;
      const segStart = current[0]!.start;
      const pause = w.start - prev.end;
      const segSpan = prev.end - segStart;
      if (
        pause > SEGMENT_PAUSE_SEC ||
        segSpan >= SEGMENT_MAX_SEC ||
        (SENTENCE_END.test(prev.word) &&
          current.length >= SEGMENT_MIN_SENTENCE_WORDS &&
          segSpan >= SEGMENT_MIN_SENTENCE_SEC)
      ) {
        flush();
      }
    }
    current.push(w);
  }
  flush();
  return segments;
}

/**
 * Adapt a raw Scribe response to the verbose_json shape.
 * Pure — exported for tests.
 */
export function adaptScribeTranscription(raw: ScribeTranscriptionResponse): TimedTranscription {
  const words: TimedWord[] = [];
  for (const w of raw.words ?? []) {
    if ((w.type ?? "word") !== "word") continue;
    const text = (w.text ?? "").trim();
    if (!text) continue;
    if (
      typeof w.start !== "number" ||
      typeof w.end !== "number" ||
      !Number.isFinite(w.start) ||
      !Number.isFinite(w.end)
    ) {
      continue;
    }
    const start = Math.max(0, w.start);
    words.push({ word: text, start, end: Math.max(start, w.end) });
  }
  words.sort((a, b) => a.start - b.start);

  const segments = buildSegmentsFromWords(words);
  const text =
    (raw.text ?? "").trim() || words.map((w) => w.word).join(" ");
  const duration =
    typeof raw.audio_duration_secs === "number" &&
    Number.isFinite(raw.audio_duration_secs) &&
    raw.audio_duration_secs > 0
      ? raw.audio_duration_secs
      : words.length > 0
        ? words[words.length - 1]!.end
        : null;

  return {
    text,
    duration,
    language: raw.language_code ?? null,
    words,
    segments,
  };
}

/**
 * Transcribe audio with word + segment timestamps via the timed seam.
 * Throws when ELEVENLABS_API_KEY is unconfigured (message names the env
 * var, matching the codebase's other unconfigured-provider errors) and
 * on any provider failure — callers keep their existing charge/refund
 * and error-handling behavior around this call.
 */
export async function transcribeAudioTimed(input: {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
  /** ISO language code; omit for auto-detect (the old default). */
  language?: string;
  signal?: AbortSignal;
}): Promise<TimedTranscription> {
  const apiKey = process.env["ELEVENLABS_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "ELEVENLABS_API_KEY is not configured — timed transcription is unavailable on this server.",
    );
  }
  const form = new FormData();
  form.append(
    "file",
    new Blob([Uint8Array.from(input.buffer)], { type: input.mimeType ?? "audio/mpeg" }),
    input.filename,
  );
  form.append("model_id", getTimedTranscribeModel());
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "false");
  form.append("diarize", "false");
  if (input.language) form.append("language_code", input.language);

  const res = await fetch(ELEVENLABS_STT_URL, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
    signal: input.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Timed transcription failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }
  const raw = (await res.json()) as ScribeTranscriptionResponse;
  return adaptScribeTranscription(raw);
}
