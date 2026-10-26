/**
 * live-captions.ts — Live Captions, Every Language (Stack-200 #160,
 * TRULY NEW). Real-time captions on LIVE streams, translated PER
 * VIEWER on the existing translator rail.
 *
 * What this is / is not:
 * - This is the live path: the broadcaster's speech becomes caption
 *   segments WHILE the stream is on, and each viewer who turns
 *   captions on receives them in the language THEY picked.
 * - This is NOT file/VOD captioning (Caption Styler + the file-based
 *   Translate & Dub in routes/generate/video-translator.ts already
 *   exist and are untouched). Nothing here runs on a recording.
 *
 * Language list: taken from the translator rail itself
 * (TARGET_LANGUAGES in routes/generate/video-translator.ts) — the
 * one catalog the file translator charges on. This module never
 * invents a language the rail does not support. English ("en") is
 * the default SOURCE language (the rail translates FROM the spoken
 * original; viewers picking the source language get the original
 * text, untranslated).
 *
 * PRICING — OWNER CALL, GATED OFF. The translator rail's ruled price
 * (500 VB per minute per language) prices a FILE job with a known
 * duration. A live stream has no known duration and the translation
 * cost scales per VIEWER language, so whether live captions charge
 * the streamer, the viewer, or nobody is a pricing decision nobody
 * has ruled. Until the owner rules, live captions charge NOTHING:
 * LIVE_CAPTIONS_PRICING.charged stays false and no credit path in
 * this feature touches the ledger. The rail rate is carried here
 * only as the reference figure for that decision.
 *
 * State is in-memory (single API instance, same as live presence
 * and chat pacing): caption segments are ephemeral live data — they
 * die with the stream and are never persisted. Retention is capped
 * per stream so a long stream cannot grow the map without bound.
 */
import {
  TARGET_LANGUAGES,
  VIDEO_TRANSLATOR_CREDITS_PER_MINUTE,
  isSupportedLanguage,
  languageLabel,
} from "../routes/generate/video-translator";

export { TARGET_LANGUAGES, isSupportedLanguage, languageLabel };

/** The default spoken language of a stream (captions are translated
 *  FROM this). Also a valid viewer pick: it means "original". */
export const LIVE_CAPTION_SOURCE_DEFAULT = "en";

/** Source languages a broadcaster may declare: English plus every
 *  rail target (a Spanish-speaking streamer captions from Spanish). */
export function isSupportedSourceLanguage(code: string): boolean {
  return code === LIVE_CAPTION_SOURCE_DEFAULT || isSupportedLanguage(code);
}

/** Viewer languages: the source default (original) + the rail list. */
export function isSupportedViewerLanguage(code: string): boolean {
  return isSupportedSourceLanguage(code);
}

export function viewerLanguageLabel(code: string): string {
  return code === LIVE_CAPTION_SOURCE_DEFAULT ? "English (original)" : languageLabel(code);
}

/* ── Pricing (gated off — see the header) ────────────────────────────── */

export const LIVE_CAPTIONS_PRICING = {
  /** Hard gate: false until the owner rules a live-captions price. */
  charged: false,
  status: "pending_owner_decision",
  /** The translator rail's ruled rate, for reference only. */
  translatorRailCreditsPerMinutePerLanguage: VIDEO_TRANSLATOR_CREDITS_PER_MINUTE,
  note:
    "Live caption translation is not charged yet. The translator rail's ruled price " +
    `(${VIDEO_TRANSLATOR_CREDITS_PER_MINUTE} Visual Bucs per minute per language) prices file ` +
    "translation with a known duration; what live per-viewer caption translation costs, " +
    "and who pays it, is the owner's call.",
} as const;

/* ── Caption segments ────────────────────────────────────────────────── */

export const MAX_CAPTION_CHARS = 300;
/** Segments retained per stream (a 12h stream at ~1 segment / 3s is
 *  ~14k raw; captions only matter near-live, so the tail is kept). */
export const MAX_SEGMENTS_PER_STREAM = 600;
/** Segments older than this are pruned on read (matches MAX_LIVE_MS). */
export const CAPTION_STREAM_TTL_MS = 12 * 60 * 60 * 1000;

export interface LiveCaptionSegment {
  /** Per-stream sequence number, 1-based, gapless. */
  seq: number;
  streamId: string;
  /** The original spoken text, in sourceLanguage. */
  text: string;
  sourceLanguage: string;
  /** Offsets from stream start when the caption source provides
   *  them; null when it doesn't (never invented). */
  startMs: number | null;
  endMs: number | null;
  createdAt: number;
}

export interface TranslatedCaption {
  seq: number;
  streamId: string;
  /** The text this viewer sees: translated, or the original when
   *  language === sourceLanguage. */
  text: string;
  language: string;
  sourceLanguage: string;
  startMs: number | null;
  endMs: number | null;
  createdAt: number;
}

export interface LiveCaptionSettings {
  streamId: string;
  /** The broadcaster's switch: no caption track exists until the
   *  streamer turns captions on for the stream. */
  enabled: boolean;
  sourceLanguage: string;
}

/** The translator: one line of spoken text → one line in the target
 *  language. Injected so tests drive a fake; production wires the
 *  rail's model call (routes/live-captions.ts). */
export type CaptionTranslator = (
  text: string,
  targetCode: string,
) => Promise<string>;

interface StreamCaptionState {
  settings: LiveCaptionSettings;
  segments: LiveCaptionSegment[];
  nextSeq: number;
  /** `${seq}:${lang}` → translated text (the original text is never
   *  cached — it IS the segment). Failures are not cached, so a
   *  later read can retry. */
  translations: Map<string, string>;
}

export class LiveCaptionStore {
  private streams = new Map<string, StreamCaptionState>();

  private state(streamId: string): StreamCaptionState {
    let s = this.streams.get(streamId);
    if (!s) {
      s = {
        settings: {
          streamId,
          enabled: false,
          sourceLanguage: LIVE_CAPTION_SOURCE_DEFAULT,
        },
        segments: [],
        nextSeq: 1,
        translations: new Map(),
      };
      this.streams.set(streamId, s);
    }
    return s;
  }

  getSettings(streamId: string): LiveCaptionSettings {
    return { ...this.state(streamId).settings };
  }

  setSettings(
    streamId: string,
    patch: Partial<Pick<LiveCaptionSettings, "enabled" | "sourceLanguage">>,
  ): LiveCaptionSettings {
    const s = this.state(streamId);
    if (typeof patch.enabled === "boolean") s.settings.enabled = patch.enabled;
    if (patch.sourceLanguage && isSupportedSourceLanguage(patch.sourceLanguage)) {
      s.settings.sourceLanguage = patch.sourceLanguage;
    }
    return { ...s.settings };
  }

  /** Append one spoken segment. Returns null when captions are off
   *  for the stream — a caption source must never write into a
   *  stream whose streamer didn't open the caption track. */
  addSegment(
    streamId: string,
    input: { text: string; startMs?: number | null; endMs?: number | null },
    now: number = Date.now(),
  ): LiveCaptionSegment | null {
    const s = this.state(streamId);
    if (!s.settings.enabled) return null;
    const text = input.text.trim().slice(0, MAX_CAPTION_CHARS);
    if (!text) return null;
    const seg: LiveCaptionSegment = {
      seq: s.nextSeq++,
      streamId,
      text,
      sourceLanguage: s.settings.sourceLanguage,
      startMs: typeof input.startMs === "number" && input.startMs >= 0 ? input.startMs : null,
      endMs: typeof input.endMs === "number" && input.endMs >= 0 ? input.endMs : null,
      createdAt: now,
    };
    s.segments.push(seg);
    if (s.segments.length > MAX_SEGMENTS_PER_STREAM) {
      const dropped = s.segments.splice(0, s.segments.length - MAX_SEGMENTS_PER_STREAM);
      for (const d of dropped) {
        for (const key of [...s.translations.keys()]) {
          if (key.startsWith(`${d.seq}:`)) s.translations.delete(key);
        }
      }
    }
    return seg;
  }

  /** Segments after `afterSeq` (0 = the retained tail), oldest first. */
  segmentsAfter(streamId: string, afterSeq = 0, now: number = Date.now()): LiveCaptionSegment[] {
    const s = this.streams.get(streamId);
    if (!s) return [];
    // Lazy TTL prune: a stream nobody ended cleanly still ages out.
    if (s.segments.length > 0 && now - s.segments[s.segments.length - 1]!.createdAt > CAPTION_STREAM_TTL_MS) {
      s.segments = [];
      s.translations.clear();
      return [];
    }
    return s.segments.filter((seg) => seg.seq > afterSeq);
  }

  latestSeq(streamId: string): number {
    const s = this.streams.get(streamId);
    if (!s || s.segments.length === 0) return 0;
    return s.segments[s.segments.length - 1]!.seq;
  }

  /** One segment in one viewer's language. Source-language viewers
   *  get the original with no translator call. Translations are
   *  cached per (seq, language) — ten thousand Spanish viewers cost
   *  one translation per segment, not ten thousand. A translator
   *  failure falls back to the original text (a caption in the
   *  stream's language beats no caption) and is NOT cached. */
  async translateSegment(
    seg: LiveCaptionSegment,
    language: string,
    translator: CaptionTranslator,
  ): Promise<TranslatedCaption> {
    const base: TranslatedCaption = {
      seq: seg.seq,
      streamId: seg.streamId,
      text: seg.text,
      language,
      sourceLanguage: seg.sourceLanguage,
      startMs: seg.startMs,
      endMs: seg.endMs,
      createdAt: seg.createdAt,
    };
    if (language === seg.sourceLanguage) return base;
    const s = this.streams.get(seg.streamId);
    const key = `${seg.seq}:${language}`;
    const cached = s?.translations.get(key);
    if (cached !== undefined) return { ...base, text: cached };
    try {
      const translated = (await translator(seg.text, language)).trim();
      if (!translated) return base;
      s?.translations.set(key, translated);
      return { ...base, text: translated };
    } catch {
      return base;
    }
  }

  /** A page of segments after `afterSeq`, in a viewer's language. */
  async captionsFor(
    streamId: string,
    language: string,
    afterSeq: number,
    translator: CaptionTranslator,
    limit = 50,
  ): Promise<TranslatedCaption[]> {
    const segs = this.segmentsAfter(streamId, afterSeq).slice(0, limit);
    return Promise.all(segs.map((seg) => this.translateSegment(seg, language, translator)));
  }

  /** Stream over: the caption track dies with it. */
  clearStream(streamId: string): void {
    this.streams.delete(streamId);
  }

  __reset(): void {
    this.streams.clear();
  }
}

/** The one store the routes serve from. */
export const liveCaptionStore = new LiveCaptionStore();
