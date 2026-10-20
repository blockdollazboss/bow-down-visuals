/**
 * Pins for the shared timed-transcription seam (lib/transcription.ts).
 *
 * whisper-1 is removed on 2027-02-26; every timed transcription path
 * (captions, lyric alignment, dubbing, karaoke, chapters…) now goes
 * through transcribeAudioTimed(), which adapts the timed provider's
 * word stream into the verbose_json-style shape consumers have always
 * read (text / duration / language / words[] / segments[] with nested
 * words). These tests pin:
 *   - the adapter's cleaning rules (spacing/audio-event tokens dropped,
 *     invalid timings dropped, clamping, sorting),
 *   - the derived-segment rules (pause / sentence / 30s-cap splits),
 *   - the request the seam sends (URL, key header, form fields, the
 *     env-overridable model), with fetch stubbed — no live calls,
 *   - the repo-wide invariant: no non-test source file passes
 *     model: "whisper-1" anymore.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptScribeTranscription,
  buildSegmentsFromWords,
  getTimedTranscribeModel,
  transcribeAudioTimed,
  type TimedWord,
} from "../transcription";

const w = (word: string, start: number, end: number): TimedWord => ({ word, start, end });

/* ── adapter ─────────────────────────────────────────────────────────── */

describe("adaptScribeTranscription", () => {
  it("keeps only word tokens, trimmed, clamped and sorted", () => {
    const out = adaptScribeTranscription({
      text: "hello world",
      language_code: "en",
      audio_duration_secs: 3,
      words: [
        { text: "world", start: 1.2, end: 1.8, type: "word" },
        { text: " ", start: 1.1, end: 1.2, type: "spacing" },
        { text: "[music]", start: 0.8, end: 1.1, type: "audio_event" },
        { text: "  hello ", start: -0.2, end: 0.6, type: "word" },
        { text: "bad-end", start: 2.5, end: 2.1, type: "word" },
        { text: "no-times", type: "word" },
      ],
    });
    expect(out.words).toEqual([
      w("hello", 0, 0.6),
      w("world", 1.2, 1.8),
      w("bad-end", 2.5, 2.5),
    ]);
    expect(out.text).toBe("hello world");
    expect(out.language).toBe("en");
    expect(out.duration).toBe(3);
  });

  it("duration falls back to the last word end, then null", () => {
    const withWords = adaptScribeTranscription({
      words: [{ text: "a", start: 0, end: 1.25, type: "word" }],
    });
    expect(withWords.duration).toBe(1.25);
    const empty = adaptScribeTranscription({ words: [] });
    expect(empty.duration).toBeNull();
    expect(empty.words).toEqual([]);
    expect(empty.segments).toEqual([]);
    expect(empty.text).toBe("");
    expect(empty.language).toBeNull();
  });

  it("text falls back to the joined words when the provider text is blank", () => {
    const out = adaptScribeTranscription({
      text: "   ",
      words: [
        { text: "one", start: 0, end: 0.4, type: "word" },
        { text: "two", start: 0.5, end: 0.9, type: "word" },
      ],
    });
    expect(out.text).toBe("one two");
  });

  it("segments nest their words and join their text", () => {
    const out = adaptScribeTranscription({
      words: [
        { text: "first", start: 0, end: 0.4, type: "word" },
        { text: "line", start: 0.5, end: 0.9, type: "word" },
        // 2.1s pause — a new segment starts.
        { text: "second", start: 3, end: 3.4, type: "word" },
        { text: "line", start: 3.5, end: 3.9, type: "word" },
      ],
    });
    expect(out.segments).toHaveLength(2);
    expect(out.segments[0]).toMatchObject({ id: 0, start: 0, end: 0.9, text: "first line" });
    expect(out.segments[0]?.words).toEqual([w("first", 0, 0.4), w("line", 0.5, 0.9)]);
    expect(out.segments[1]).toMatchObject({ id: 1, start: 3, end: 3.9, text: "second line" });
  });
});

describe("buildSegmentsFromWords", () => {
  it("returns no segments for no words", () => {
    expect(buildSegmentsFromWords([])).toEqual([]);
  });

  it("splits after sentence-final punctuation once a segment has substance", () => {
    const segs = buildSegmentsFromWords([
      w("One", 0, 0.4),
      w("two", 0.5, 0.9),
      w("three.", 1, 1.7),
      w("Four", 1.8, 2.2),
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0]?.text).toBe("One two three.");
    expect(segs[1]?.text).toBe("Four");
  });

  it("does not split a two-word fragment on punctuation alone", () => {
    const segs = buildSegmentsFromWords([w("Hi.", 0, 0.3), w("there", 0.4, 0.8)]);
    expect(segs).toHaveLength(1);
  });

  it("caps a segment at ~30 seconds (split fires once the span reaches 30s)", () => {
    const words: TimedWord[] = [];
    for (let i = 0; i < 40; i++) words.push(w(`w${i}`, i, i + 0.5));
    const segs = buildSegmentsFromWords(words);
    expect(segs.length).toBeGreaterThanOrEqual(2);
    // The break is checked against the accumulated span before the next
    // word is added, so a segment can overshoot 30s by at most one word.
    expect((segs[0]?.end ?? 99) - (segs[0]?.start ?? 0)).toBeLessThanOrEqual(31);
    expect(segs.map((s) => s.words.length).reduce((a, b) => a + b, 0)).toBe(40);
  });
});

/* ── request seam (fetch stubbed — no live provider calls) ─────────── */

describe("transcribeAudioTimed", () => {
  const realEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...realEnv };
    delete process.env["ELEVENLABS_API_KEY"];
    delete process.env["ELEVENLABS_SCRIBE_MODEL"];
  });

  afterEach(() => {
    process.env = realEnv;
    vi.unstubAllGlobals();
  });

  it("fails loudly when the provider key is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      transcribeAudioTimed({ buffer: Buffer.from("x"), filename: "a.mp3" }),
    ).rejects.toThrow("ELEVENLABS_API_KEY is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the Scribe form and adapts the response", async () => {
    process.env["ELEVENLABS_API_KEY"] = "test-key";
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seenUrl = url;
        seenInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            text: "hi there",
            language_code: "en",
            audio_duration_secs: 2.5,
            words: [
              { text: "hi", start: 0, end: 0.4, type: "word" },
              { text: " ", start: 0.4, end: 0.5, type: "spacing" },
              { text: "there", start: 0.5, end: 1, type: "word" },
            ],
          }),
          text: async () => "",
        };
      }),
    );

    const out = await transcribeAudioTimed({
      buffer: Buffer.from("audio-bytes"),
      filename: "clip.mp3",
      language: "en",
    });

    expect(seenUrl).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    const headers = (seenInit?.headers ?? {}) as Record<string, string>;
    expect(headers["xi-api-key"]).toBe("test-key");
    const form = seenInit?.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("timestamps_granularity")).toBe("word");
    expect(form.get("language_code")).toBe("en");
    expect(out.text).toBe("hi there");
    expect(out.duration).toBe(2.5);
    expect(out.words).toEqual([w("hi", 0, 0.4), w("there", 0.5, 1)]);
  });

  it("the timed model is env-overridable via ELEVENLABS_SCRIBE_MODEL", async () => {
    process.env["ELEVENLABS_API_KEY"] = "test-key";
    process.env["ELEVENLABS_SCRIBE_MODEL"] = "scribe_v2_next";
    expect(getTimedTranscribeModel()).toBe("scribe_v2_next");
    let seenForm: FormData | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seenForm = init.body as FormData;
        return {
          ok: true,
          status: 200,
          json: async () => ({ text: "", words: [] }),
          text: async () => "",
        };
      }),
    );
    await transcribeAudioTimed({ buffer: Buffer.from("x"), filename: "a.mp3" });
    expect(seenForm?.get("model_id")).toBe("scribe_v2_next");
    // No language hint → no language_code field.
    expect(seenForm?.get("language_code")).toBeNull();
  });

  it("throws with the provider status and detail on a non-OK response", async () => {
    process.env["ELEVENLABS_API_KEY"] = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => "provider exploded",
      })),
    );
    await expect(
      transcribeAudioTimed({ buffer: Buffer.from("x"), filename: "a.mp3" }),
    ).rejects.toThrow("Timed transcription failed (500): provider exploded");
  });
});

/* ── repo-wide pin ───────────────────────────────────────────────────── */

describe("whisper-1 removal pin", () => {
  it("no non-test source file passes model: \"whisper-1\" anywhere under src", () => {
    const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry !== "__tests__") walk(full);
        } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
          if (/model:\s*["']whisper-1["']/.test(readFileSync(full, "utf8"))) {
            offenders.push(path.relative(srcRoot, full));
          }
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});
