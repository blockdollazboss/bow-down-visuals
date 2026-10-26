/**
 * Live Captions core (lib/live-captions) — Stack-200 #160.
 *
 * Covers: the language list comes from the translator rail (never
 * invented), pricing is gated OFF with the rail rate carried as the
 * reference for the owner's call, the streamer switch gates the
 * caption track, per-viewer translation with cache + source
 * passthrough + honest fallback, retention bounds.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../routes/generate/video-translator", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return actual;
});

import {
  LiveCaptionStore,
  LIVE_CAPTIONS_PRICING,
  TARGET_LANGUAGES,
  isSupportedViewerLanguage,
  isSupportedSourceLanguage,
  viewerLanguageLabel,
  MAX_SEGMENTS_PER_STREAM,
} from "../live-captions";
import { VIDEO_TRANSLATOR_CREDITS_PER_MINUTE } from "../../routes/generate/video-translator";

const STREAM = "stream-1";

function fakeTranslator() {
  const calls: Array<{ text: string; lang: string }> = [];
  const fn = async (text: string, lang: string) => {
    calls.push({ text, lang });
    return `[${lang}] ${text}`;
  };
  return { fn, calls };
}

describe("languages — from the translator rail, never invented", () => {
  it("offers exactly the rail's target languages plus English (original)", () => {
    expect(TARGET_LANGUAGES.length).toBeGreaterThanOrEqual(10);
    for (const lang of TARGET_LANGUAGES) {
      expect(isSupportedViewerLanguage(lang.code)).toBe(true);
    }
    expect(isSupportedViewerLanguage("en")).toBe(true);
    expect(viewerLanguageLabel("en")).toMatch(/original/i);
  });

  it("rejects languages the rail does not support", () => {
    expect(isSupportedViewerLanguage("xx")).toBe(false);
    expect(isSupportedViewerLanguage("sv")).toBe(false); // not on the rail today
    expect(isSupportedSourceLanguage("xx")).toBe(false);
    expect(isSupportedSourceLanguage("es")).toBe(true);
  });
});

describe("pricing — gated off pending the owner's call", () => {
  it("charges nothing and carries the rail rate as reference only", () => {
    expect(LIVE_CAPTIONS_PRICING.charged).toBe(false);
    expect(LIVE_CAPTIONS_PRICING.status).toBe("pending_owner_decision");
    expect(LIVE_CAPTIONS_PRICING.translatorRailCreditsPerMinutePerLanguage).toBe(
      VIDEO_TRANSLATOR_CREDITS_PER_MINUTE,
    );
    expect(VIDEO_TRANSLATOR_CREDITS_PER_MINUTE).toBe(500); // the ruled A-04 rail rate
    expect(LIVE_CAPTIONS_PRICING.note).toMatch(/owner's call/i);
  });
});

describe("caption track gating (smart law)", () => {
  it("is OFF until the streamer turns it on — segments are refused while off", () => {
    const store = new LiveCaptionStore();
    expect(store.getSettings(STREAM).enabled).toBe(false);
    expect(store.addSegment(STREAM, { text: "hello" })).toBeNull();
    store.setSettings(STREAM, { enabled: true });
    const seg = store.addSegment(STREAM, { text: "hello" });
    expect(seg).toMatchObject({ seq: 1, text: "hello", sourceLanguage: "en" });
  });

  it("a declared source language sticks and rides every segment", () => {
    const store = new LiveCaptionStore();
    store.setSettings(STREAM, { enabled: true, sourceLanguage: "es" });
    const seg = store.addSegment(STREAM, { text: "hola" });
    expect(seg?.sourceLanguage).toBe("es");
    // An unsupported source language is ignored, never stored.
    store.setSettings(STREAM, { sourceLanguage: "xx" });
    expect(store.getSettings(STREAM).sourceLanguage).toBe("es");
  });

  it("empty / whitespace lines never become segments", () => {
    const store = new LiveCaptionStore();
    store.setSettings(STREAM, { enabled: true });
    expect(store.addSegment(STREAM, { text: "   " })).toBeNull();
    expect(store.latestSeq(STREAM)).toBe(0);
  });
});

describe("per-viewer translation", () => {
  it("source-language viewers get the original with NO translator call", async () => {
    const store = new LiveCaptionStore();
    store.setSettings(STREAM, { enabled: true });
    const seg = store.addSegment(STREAM, { text: "welcome in" })!;
    const { fn, calls } = fakeTranslator();
    const out = await store.translateSegment(seg, "en", fn);
    expect(out.text).toBe("welcome in");
    expect(calls).toHaveLength(0);
  });

  it("translates once per (segment, language) and caches for every other viewer", async () => {
    const store = new LiveCaptionStore();
    store.setSettings(STREAM, { enabled: true });
    const seg = store.addSegment(STREAM, { text: "welcome in" })!;
    const { fn, calls } = fakeTranslator();
    const a = await store.translateSegment(seg, "es", fn);
    const b = await store.translateSegment(seg, "es", fn);
    const c = await store.translateSegment(seg, "fr", fn);
    expect(a.text).toBe("[es] welcome in");
    expect(b.text).toBe("[es] welcome in");
    expect(c.text).toBe("[fr] welcome in");
    expect(calls).toHaveLength(2); // es once + fr once — not per viewer
  });

  it("a translator failure falls back to the original and is NOT cached", async () => {
    const store = new LiveCaptionStore();
    store.setSettings(STREAM, { enabled: true });
    const seg = store.addSegment(STREAM, { text: "welcome in" })!;
    let attempts = 0;
    const flaky = async () => {
      attempts++;
      if (attempts === 1) throw new Error("provider down");
      return "bienvenidos";
    };
    const first = await store.translateSegment(seg, "es", flaky);
    expect(first.text).toBe("welcome in"); // the original beats silence
    const second = await store.translateSegment(seg, "es", flaky);
    expect(second.text).toBe("bienvenidos"); // retry happened — failure wasn't cached
    expect(attempts).toBe(2);
  });

  it("captionsFor returns segments after the cursor, in order, per language", async () => {
    const store = new LiveCaptionStore();
    store.setSettings(STREAM, { enabled: true });
    store.addSegment(STREAM, { text: "one" });
    store.addSegment(STREAM, { text: "two" });
    store.addSegment(STREAM, { text: "three" });
    const { fn } = fakeTranslator();
    const page = await store.captionsFor(STREAM, "de", 1, fn);
    expect(page.map((c) => c.seq)).toEqual([2, 3]);
    expect(page.map((c) => c.text)).toEqual(["[de] two", "[de] three"]);
  });
});

describe("retention", () => {
  it("keeps only the newest MAX_SEGMENTS_PER_STREAM segments", () => {
    const store = new LiveCaptionStore();
    store.setSettings(STREAM, { enabled: true });
    for (let i = 0; i < MAX_SEGMENTS_PER_STREAM + 25; i++) {
      store.addSegment(STREAM, { text: `line ${i}` });
    }
    const kept = store.segmentsAfter(STREAM, 0);
    expect(kept.length).toBe(MAX_SEGMENTS_PER_STREAM);
    expect(kept[0]!.seq).toBe(26);
    expect(store.latestSeq(STREAM)).toBe(MAX_SEGMENTS_PER_STREAM + 25);
  });

  it("clearStream drops the track with the stream", async () => {
    const store = new LiveCaptionStore();
    store.setSettings(STREAM, { enabled: true });
    store.addSegment(STREAM, { text: "bye" });
    store.clearStream(STREAM);
    expect(store.segmentsAfter(STREAM, 0)).toEqual([]);
    expect(store.getSettings(STREAM).enabled).toBe(false);
  });
});
