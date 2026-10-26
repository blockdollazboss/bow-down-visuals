/**
 * LiveCaptions tests (#160) — per-viewer language delivery, honest
 * bar states, viewer pref persistence, streamer writes, and the
 * speech source (final lines only; interim is a local preview).
 * All transport is faked; the logic is the real shipped code.
 */
import { describe, it, expect, vi } from "vitest";
import {
  LiveCaptionsViewerClient,
  SpeechCaptionSource,
  captionBarState,
  captionsSocketUrl,
  loadCaptionPref,
  saveCaptionPref,
  postCaptionSegment,
  setCaptionTrack,
  type CaptionLine,
  type CaptionSocketLike,
  type FetchJson,
  type LiveCaptionsDeps,
} from "./live-captions-client";
import type {
  ChatVoiceRecognition,
  ChatVoiceResultEvent,
} from "./chat-voice";

const STREAM = "33333333-3333-4333-8333-333333333333";

function line(seq: number, language: string, text = `line ${seq}`): CaptionLine {
  return { seq, streamId: STREAM, text, language, sourceLanguage: "en", createdAt: seq * 1000 };
}

class FakeSocket implements CaptionSocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  close(): void {
    this.onclose?.({});
  }
  emit(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

function makeDeps(overrides: Partial<LiveCaptionsDeps> & { sockets?: FakeSocket[] } = {}) {
  const sockets = overrides.sockets ?? [];
  const fetchJson: FetchJson = async (path) => {
    if (path === "/api/live-captions/languages") {
      return {
        status: 200,
        json: {
          languages: [
            { code: "en", label: "English (original)" },
            { code: "es", label: "Spanish" },
          ],
          sourceLanguages: [],
          pricing: { charged: false, status: "house_feature_no_charge", note: "" },
        },
      };
    }
    if (path.endsWith("/captions/settings")) {
      return {
        status: 200,
        json: { captions: { enabled: true, sourceLanguage: "en" }, streamStatus: "live" },
      };
    }
    if (path.includes("/captions?")) {
      return { status: 200, json: { captionsEnabled: true, captions: [], latestSeq: 0 } };
    }
    return { status: 404, json: null };
  };
  const deps: LiveCaptionsDeps = {
    fetchJson,
    getAccessToken: async () => "tok",
    socketUrl: (id, lang, token) => captionsSocketUrl({ protocol: "https:", host: "x.tv" }, id, lang, token),
    openSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    ...overrides,
  };
  return { deps, sockets };
}

describe("captionBarState — honest states", () => {
  it("viewer off wins; ticket door beats track state; a line shows only when real", () => {
    expect(captionBarState({ viewerOn: false, trackEnabled: true, ticketLocked: false, hasLine: true })).toBe("off");
    expect(captionBarState({ viewerOn: true, trackEnabled: true, ticketLocked: true, hasLine: false })).toBe("ticket-locked");
    expect(captionBarState({ viewerOn: true, trackEnabled: false, ticketLocked: false, hasLine: false })).toBe("track-off");
    expect(captionBarState({ viewerOn: true, trackEnabled: true, ticketLocked: false, hasLine: false })).toBe("waiting");
    expect(captionBarState({ viewerOn: true, trackEnabled: true, ticketLocked: false, hasLine: true })).toBe("showing");
  });
});

describe("viewer pref", () => {
  it("round-trips and defaults sanely on junk", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(loadCaptionPref(storage)).toEqual({ on: false, language: "en" });
    saveCaptionPref(storage, { on: true, language: "es" });
    expect(loadCaptionPref(storage)).toEqual({ on: true, language: "es" });
    store.set("bdv.liveCaptions.pref.v1", "{junk");
    expect(loadCaptionPref(storage)).toEqual({ on: false, language: "en" });
  });
});

describe("captionsSocketUrl", () => {
  it("names exactly one language; token only when present", () => {
    expect(captionsSocketUrl({ protocol: "https:", host: "x.tv" }, STREAM, "es", null)).toBe(
      `wss://x.tv/api/live/${STREAM}/captions/ws?lang=es`,
    );
    expect(captionsSocketUrl({ protocol: "http:", host: "x.tv" }, STREAM, "es", "t k")).toBe(
      `ws://x.tv/api/live/${STREAM}/captions/ws?lang=es&token=t%20k`,
    );
  });
});

describe("LiveCaptionsViewerClient", () => {
  it("loads settings + languages, joins the socket room for the viewer's language", async () => {
    const { deps, sockets } = makeDeps();
    const client = new LiveCaptionsViewerClient(STREAM, "es", deps, () => {});
    await client.start();
    expect(client.trackEnabled).toBe(true);
    expect(client.languages.map((l) => l.code)).toEqual(["en", "es"]);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toContain("lang=es");
    client.stop();
  });

  it("merges socket lines in the viewer's language only, deduped by seq", async () => {
    const { deps, sockets } = makeDeps();
    const client = new LiveCaptionsViewerClient(STREAM, "es", deps, () => {});
    await client.start();
    sockets[0].emit({ type: "caption", caption: line(1, "es", "hola") });
    sockets[0].emit({ type: "caption", caption: line(1, "es", "hola") });
    sockets[0].emit({ type: "caption", caption: line(2, "fr", "bonjour") }); // wrong room — dropped
    sockets[0].emit({ type: "backfill", captions: [line(2, "es", "qué tal")] });
    expect(client.lines.map((l) => l.text)).toEqual(["hola", "qué tal"]);
    expect(client.currentLine?.text).toBe("qué tal");
    client.stop();
  });

  it("a language switch drops old lines and rejoins in the new language", async () => {
    const { deps, sockets } = makeDeps();
    const client = new LiveCaptionsViewerClient(STREAM, "es", deps, () => {});
    await client.start();
    sockets[0].emit({ type: "caption", caption: line(1, "es", "hola") });
    await client.setLanguage("en");
    expect(client.lines).toEqual([]);
    expect(sockets).toHaveLength(2);
    expect(sockets[1].url).toContain("lang=en");
    client.stop();
  });

  it("a 402 poll read flips the ticket lock honestly", async () => {
    const { deps } = makeDeps({
      fetchJson: async (path) => {
        if (path.includes("/captions?")) return { status: 402, json: { code: "TICKET_REQUIRED" } };
        if (path.endsWith("/captions/settings")) {
          return { status: 200, json: { captions: { enabled: true, sourceLanguage: "en" }, streamStatus: "live" } };
        }
        return { status: 200, json: { languages: [] } };
      },
    });
    const client = new LiveCaptionsViewerClient(STREAM, "es", deps, () => {});
    await client.start();
    await client.catchUp();
    expect(client.ticketLocked).toBe(true);
    client.stop();
  });
});

describe("streamer writes", () => {
  it("setCaptionTrack posts snake_case and reads back the settings", async () => {
    const seen: Array<{ path: string; body: any }> = [];
    const fetchJson: FetchJson = async (path, init) => {
      seen.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      return { status: 200, json: { captions: { enabled: true, sourceLanguage: "es" } } };
    };
    const r = await setCaptionTrack(fetchJson, STREAM, { enabled: true, sourceLanguage: "es" });
    expect(r.ok).toBe(true);
    expect(r.settings).toEqual({ streamId: STREAM, enabled: true, sourceLanguage: "es" });
    expect(seen[0].body).toEqual({ enabled: true, source_language: "es" });
  });

  it("postCaptionSegment trims, refuses silence, and surfaces pacing", async () => {
    const fetchJson: FetchJson = async () => ({ status: 201, json: { segment: { seq: 1 } } });
    expect((await postCaptionSegment(fetchJson, STREAM, "  hello  ")).ok).toBe(true);
    expect((await postCaptionSegment(fetchJson, STREAM, "   ")).ok).toBe(false);
    const slow: FetchJson = async () => ({
      status: 429,
      json: { error: "too fast", retryAfterMs: 120 },
    });
    const r = await postCaptionSegment(slow, STREAM, "hi");
    expect(r.ok).toBe(false);
    expect(r.retryAfterMs).toBe(120);
  });
});

/* ── Speech source ──────────────────────────────────────────────────── */

class FakeRecognition implements ChatVoiceRecognition {
  lang = "";
  interimResults = false;
  continuous = false;
  onresult: ((event: ChatVoiceResultEvent) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  started = false;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.onend?.();
  }
  say(results: Array<{ isFinal: boolean; transcript: string }>, resultIndex = 0): void {
    const shaped = results.map((r) => {
      const res: any = { isFinal: r.isFinal, length: 1 };
      res[0] = { transcript: r.transcript };
      return res;
    });
    const all: any = { length: shaped.length };
    shaped.forEach((s, i) => (all[i] = s));
    this.onresult?.({ resultIndex, results: all });
  }
}

describe("SpeechCaptionSource", () => {
  it("posts FINAL lines only — interim stays a local preview", () => {
    const finals: string[] = [];
    let rec: FakeRecognition | null = null;
    const Ctor = function () {
      rec = new FakeRecognition();
      return rec;
    } as any;
    const source = new SpeechCaptionSource({
      lang: "en",
      onFinalLine: (t) => finals.push(t),
      onChange: () => {},
      recognitionCtor: Ctor,
    });
    source.start();
    expect(source.state).toBe("listening");
    rec!.say([{ isFinal: false, transcript: "hel" }]);
    expect(finals).toEqual([]);
    expect(source.interim).toBe("hel");
    rec!.say([{ isFinal: true, transcript: "hello everyone" }]);
    expect(finals).toEqual(["hello everyone"]);
    source.stop();
    expect(source.state).toBe("idle");
  });

  it("no recognizer = honest unsupported, never a fake listening state", () => {
    const source = new SpeechCaptionSource({
      lang: "en",
      onFinalLine: () => {},
      onChange: () => {},
      recognitionCtor: null,
    });
    // recognitionCtor: null falls back to the window lookup (absent in node)
    source.start();
    expect(source.state).toBe("unsupported");
  });

  it("mic refusal reads as blocked", () => {
    let rec: FakeRecognition | null = null;
    const Ctor = function () {
      rec = new FakeRecognition();
      return rec;
    } as any;
    const source = new SpeechCaptionSource({
      lang: "en",
      onFinalLine: () => {},
      onChange: () => {},
      recognitionCtor: Ctor,
    });
    source.start();
    rec!.onerror?.({ error: "not-allowed" });
    expect(source.state).toBe("blocked");
  });
});
