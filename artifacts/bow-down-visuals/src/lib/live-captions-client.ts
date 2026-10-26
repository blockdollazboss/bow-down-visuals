/**
 * live-captions-client.ts — Live Captions, Every Language (Stack-200
 * #160, TRULY NEW): the browser brain for real-time captions on LIVE
 * streams, translated PER VIEWER on the translator rail.
 *
 * Two halves, one file, framework-free (React panels are thin shells,
 * the whole behaviour is unit-tested in node — same pattern as
 * lib/live-chat-client.ts):
 *
 * - VIEWER (LiveCaptionsViewerClient): the watch-page overlay. The
 *   viewer turns captions on/off and picks THEIR language; lines
 *   arrive over a per-language socket (the socket names exactly one
 *   language) with a poll fallback. Nothing renders until the
 *   streamer has opened the caption track AND the viewer turned
 *   captions on — both switches are real, server-honest states.
 *
 * - STREAMER (settings/segment helpers + SpeechCaptionSource): the
 *   studio panel. The streamer opens the track and picks the spoken
 *   (source) language. The caption SOURCE is the streamer's own
 *   speech, transcribed in their browser by the Web Speech API and
 *   posted line by line — captions are the stream's real speech,
 *   never invented text. A browser without speech recognition gets
 *   an honest "not supported here" state plus a typed-line box (the
 *   streamer typing what they say is a real caption source, the
 *   stenographer path) — never a fake auto-caption claim.
 *
 * Pricing: owner ruled (Oct 25) — captions are a house feature of
 * going live; the creator pays nothing extra and viewers pay
 * nothing. No credit path exists in this file.
 */

import {
  getChatVoiceRecognitionCtor,
  type ChatVoiceRecognition,
  type ChatVoiceRecognitionCtor,
} from "./chat-voice";

export interface CaptionLanguageOption {
  code: string;
  label: string;
}

export interface CaptionLine {
  seq: number;
  streamId: string;
  text: string;
  /** The language THIS viewer is reading. */
  language: string;
  sourceLanguage: string;
  createdAt: number;
}

export interface CaptionTrackSettings {
  streamId: string;
  enabled: boolean;
  sourceLanguage: string;
}

export interface CaptionLanguagesPayload {
  languages: CaptionLanguageOption[];
  sourceLanguages: CaptionLanguageOption[];
  pricing: { charged: boolean; status: string; note: string };
}

export interface CaptionSocketLike {
  readyState: number;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
  onerror: (() => void) | null;
}

export type TimerHandle = ReturnType<typeof setTimeout> | number;

export interface FetchJsonResult {
  status: number;
  json: any;
}

export type FetchJson = (path: string, init?: RequestInit) => Promise<FetchJsonResult>;

export interface LiveCaptionsDeps {
  fetchJson: FetchJson;
  /** Session access token for ticketed streams (null = guest). */
  getAccessToken: () => Promise<string | null>;
  socketUrl: (streamId: string, language: string, token: string | null) => string;
  openSocket: (url: string) => CaptionSocketLike;
  setIntervalFn?: (fn: () => void, ms: number) => TimerHandle;
  clearIntervalFn?: (id: TimerHandle) => void;
  setTimeoutFn?: (fn: () => void, ms: number) => TimerHandle;
  clearTimeoutFn?: (id: TimerHandle) => void;
}

/* ── Viewer preference (their controls, their machine) ──────────────── */

export interface CaptionPref {
  on: boolean;
  language: string;
}

const PREF_KEY = "bdv.liveCaptions.pref.v1";
export const CAPTION_SOURCE_DEFAULT = "en";

export function loadCaptionPref(storage: { getItem(k: string): string | null } | null): CaptionPref {
  try {
    const raw = storage?.getItem(PREF_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CaptionPref>;
      return {
        on: parsed.on === true,
        language: typeof parsed.language === "string" && parsed.language ? parsed.language : CAPTION_SOURCE_DEFAULT,
      };
    }
  } catch {
    /* a corrupt pref is just the default pref */
  }
  return { on: false, language: CAPTION_SOURCE_DEFAULT };
}

export function saveCaptionPref(
  storage: { setItem(k: string, v: string): void } | null,
  pref: CaptionPref,
): void {
  try {
    storage?.setItem(PREF_KEY, JSON.stringify(pref));
  } catch {
    /* private mode etc. — the pref is a nicety, never a blocker */
  }
}

/* ── Honest overlay state ─────────────────────────────────────────────
   Pure: what the caption bar should say for a given situation. The
   bar never shows a line the speaker didn't say, and never pretends
   captions exist when the track is off or the door is closed. */
export type CaptionBarState =
  | "off" // viewer hasn't turned captions on
  | "track-off" // viewer on, streamer hasn't opened the track
  | "ticket-locked" // ticketed stream, this viewer has no entry
  | "waiting" // track on, viewer on, no line yet
  | "showing"; // a line is on screen

export function captionBarState(args: {
  viewerOn: boolean;
  trackEnabled: boolean | null;
  ticketLocked: boolean;
  hasLine: boolean;
}): CaptionBarState {
  if (!args.viewerOn) return "off";
  if (args.ticketLocked) return "ticket-locked";
  if (args.trackEnabled === false) return "track-off";
  return args.hasLine ? "showing" : "waiting";
}

/* ── Viewer client ──────────────────────────────────────────────────── */

const POLL_MS = 2500;
const RECONNECT_MS = [2000, 5000, 10000];
/** Lines kept for the overlay's short scrollback. */
export const MAX_KEPT_LINES = 30;

export class LiveCaptionsViewerClient {
  /** The streamer's switch, from the server (null = not loaded yet). */
  trackEnabled: boolean | null = null;
  sourceLanguage: string = CAPTION_SOURCE_DEFAULT;
  streamStatus: string | null = null;
  languages: CaptionLanguageOption[] = [];
  lines: CaptionLine[] = [];
  ticketLocked = false;
  loadState: "loading" | "ready" | "error" = "loading";
  delivery: "ws" | "polling" = "polling";
  /** The latest line's age drives the overlay fade — the component
   *  reads currentLine only while it is fresh. */
  get currentLine(): CaptionLine | null {
    return this.lines.length ? this.lines[this.lines.length - 1] : null;
  }

  private _socket: CaptionSocketLike | null = null;
  private _pollTimer: TimerHandle | null = null;
  private _reconnectTimer: TimerHandle | null = null;
  private _reconnectStep = 0;
  private _stopped = false;
  private _started = false;
  private _lastSeq = 0;

  constructor(
    readonly streamId: string,
    /** The viewer's own language pick — the whole point of #160. */
    public language: string,
    private deps: LiveCaptionsDeps,
    private onChange: () => void,
  ) {}

  async start(): Promise<void> {
    if (this._started) return;
    this._started = true;
    await Promise.all([this.loadLanguages(), this.loadSettings()]);
    if (this._stopped) return;
    if (this.trackEnabled) {
      await this.connectSocket();
      this.syncPolling();
      void this.catchUp();
    }
    this.onChange();
  }

  stop(): void {
    this._stopped = true;
    this.closeSocket();
    this.stopPolling();
    if (this._reconnectTimer) {
      (this.deps.clearTimeoutFn ?? clearTimeout)(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  async loadLanguages(): Promise<void> {
    try {
      const { status, json } = await this.deps.fetchJson(`/api/live-captions/languages`);
      if (status === 200 && Array.isArray(json?.languages)) {
        this.languages = json.languages as CaptionLanguageOption[];
      }
    } catch {
      /* the overlay keeps the default pick; the settings read decides states */
    }
  }

  async loadSettings(): Promise<void> {
    try {
      const { status, json } = await this.deps.fetchJson(`/api/live/${this.streamId}/captions/settings`);
      if (status !== 200 || !json) throw new Error("settings failed");
      this.trackEnabled = json.captions?.enabled === true;
      this.sourceLanguage = typeof json.captions?.sourceLanguage === "string" ? json.captions.sourceLanguage : CAPTION_SOURCE_DEFAULT;
      this.streamStatus = typeof json.streamStatus === "string" ? json.streamStatus : null;
      this.loadState = "ready";
    } catch {
      this.loadState = "error";
    }
    this.onChange();
  }

  /** The viewer picked a different language: drop the old room, keep
   *  nothing from it (lines in the wrong language are worse than a
   *  brief blank), and rejoin in the new one. */
  async setLanguage(language: string): Promise<void> {
    if (language === this.language) return;
    this.language = language;
    this.lines = [];
    this._lastSeq = 0;
    this.closeSocket();
    this._reconnectStep = 0;
    this.onChange();
    if (!this._stopped && this.trackEnabled) {
      await this.connectSocket();
      this.syncPolling();
      void this.catchUp();
    }
  }

  mergeLines(incoming: CaptionLine[]): void {
    if (!incoming.length) return;
    const bySeq = new Map(this.lines.map((l) => [l.seq, l]));
    let changed = false;
    for (const line of incoming) {
      // A line translated for another language never enters this room,
      // but a stale socket can race a language switch — guard anyway.
      if (line.language !== this.language) continue;
      if (!bySeq.has(line.seq)) {
        bySeq.set(line.seq, line);
        changed = true;
      }
      if (line.seq > this._lastSeq) this._lastSeq = line.seq;
    }
    if (changed) {
      this.lines = [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-MAX_KEPT_LINES);
      this.onChange();
    }
  }

  /* ---------------------------------------------------------- delivery */

  private async connectSocket(): Promise<void> {
    if (this._stopped || this._socket) return;
    const token = await this.deps.getAccessToken().catch(() => null);
    if (this._stopped) return;
    let socket: CaptionSocketLike;
    try {
      socket = this.deps.openSocket(this.deps.socketUrl(this.streamId, this.language, token));
    } catch {
      return;
    }
    this._socket = socket;
    socket.onopen = () => {
      this.delivery = "ws";
      this._reconnectStep = 0;
      this.syncPolling();
      this.onChange();
    };
    socket.onmessage = (ev) => this.handleSocketEvent(ev.data);
    socket.onclose = (ev) => {
      if (this._socket === socket) this._socket = null;
      // 4403 = the ticket door: no reconnect storm against a door
      // that only a ticket opens; the poll read states it honestly.
      if (ev?.code === 4403 || ev?.code === 4401) {
        this.ticketLocked = true;
        this.delivery = "polling";
        this.stopPolling();
        this.onChange();
        return;
      }
      this.delivery = "polling";
      this.syncPolling();
      this.onChange();
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        /* the close handler runs the fallback */
      }
    };
  }

  private closeSocket(): void {
    const socket = this._socket;
    this._socket = null;
    if (socket) {
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    }
  }

  private scheduleReconnect(): void {
    if (this._stopped || !this.trackEnabled || this.ticketLocked) return;
    const delay = RECONNECT_MS[Math.min(this._reconnectStep, RECONNECT_MS.length - 1)];
    this._reconnectStep++;
    const setTimeoutFn = this.deps.setTimeoutFn ?? setTimeout;
    this._reconnectTimer = setTimeoutFn(() => {
      this._reconnectTimer = null;
      void this.connectSocket();
    }, delay);
  }

  private syncPolling(): void {
    const shouldPoll =
      !this._stopped && !this.ticketLocked && this.trackEnabled === true && this.delivery === "polling" && this.loadState === "ready";
    if (shouldPoll && !this._pollTimer) {
      const setIntervalFn = this.deps.setIntervalFn ?? setInterval;
      this._pollTimer = setIntervalFn(() => void this.catchUp(), POLL_MS);
    } else if (!shouldPoll) {
      this.stopPolling();
    }
  }

  private stopPolling(): void {
    if (this._pollTimer) {
      (this.deps.clearIntervalFn ?? clearInterval)(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /** One catch-up fetch in THIS viewer's language. */
  async catchUp(): Promise<void> {
    if (this._stopped || this.ticketLocked) return;
    try {
      const path = `/api/live/${this.streamId}/captions?lang=${encodeURIComponent(this.language)}&after=${this._lastSeq}`;
      const { status, json } = await this.deps.fetchJson(path);
      if (status === 402 && json?.code === "TICKET_REQUIRED") {
        this.ticketLocked = true;
        this.stopPolling();
        this.onChange();
        return;
      }
      if (status !== 200 || !json) return;
      this.trackEnabled = json.captionsEnabled === true;
      if (Array.isArray(json.captions)) this.mergeLines(json.captions as CaptionLine[]);
    } catch {
      /* the next tick retries */
    }
  }

  private handleSocketEvent(data: unknown): void {
    let ev: any;
    try {
      ev = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!ev || typeof ev !== "object") return;
    if (ev.type === "hello") {
      this.trackEnabled = ev.captionsEnabled === true;
      if (typeof ev.streamStatus === "string") this.streamStatus = ev.streamStatus;
      this.onChange();
    } else if (ev.type === "backfill" && Array.isArray(ev.captions)) {
      this.mergeLines(ev.captions as CaptionLine[]);
    } else if (ev.type === "caption" && ev.caption) {
      this.mergeLines([ev.caption as CaptionLine]);
    }
  }
}

/** Socket URL for one viewer's caption room: the language rides the
 *  query (one socket = one language); the token rides only when the
 *  viewer has one (guests read free streams' captions). */
export function captionsSocketUrl(
  locationLike: { protocol: string; host: string },
  streamId: string,
  language: string,
  token: string | null,
): string {
  const scheme = locationLike.protocol === "https:" ? "wss:" : "ws:";
  const base = `${scheme}//${locationLike.host}/api/live/${streamId}/captions/ws?lang=${encodeURIComponent(language)}`;
  return token ? `${base}&token=${encodeURIComponent(token)}` : base;
}

/* ── Streamer side ──────────────────────────────────────────────────── */

export async function getCaptionTrack(
  fetchJson: FetchJson,
  streamId: string,
): Promise<{ settings: CaptionTrackSettings; languages: CaptionLanguageOption[]; sourceLanguages: CaptionLanguageOption[] } | null> {
  const { status, json } = await fetchJson(`/api/live/${streamId}/captions/settings`);
  if (status !== 200 || !json?.captions) return null;
  return {
    settings: {
      streamId,
      enabled: json.captions.enabled === true,
      sourceLanguage: typeof json.captions.sourceLanguage === "string" ? json.captions.sourceLanguage : CAPTION_SOURCE_DEFAULT,
    },
    languages: Array.isArray(json.languages) ? json.languages : [],
    sourceLanguages: [],
  };
}

export async function setCaptionTrack(
  fetchJson: FetchJson,
  streamId: string,
  patch: { enabled?: boolean; sourceLanguage?: string },
): Promise<{ ok: boolean; settings: CaptionTrackSettings | null; error: string | null }> {
  try {
    const { status, json } = await fetchJson(`/api/live/${streamId}/captions/settings`, {
      method: "POST",
      body: JSON.stringify({
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.sourceLanguage !== undefined ? { source_language: patch.sourceLanguage } : {}),
      }),
    });
    if (status === 200 && json?.captions) {
      return {
        ok: true,
        settings: {
          streamId,
          enabled: json.captions.enabled === true,
          sourceLanguage: typeof json.captions.sourceLanguage === "string" ? json.captions.sourceLanguage : CAPTION_SOURCE_DEFAULT,
        },
        error: null,
      };
    }
    return { ok: false, settings: null, error: (json?.error as string) ?? "Caption settings couldn't save." };
  } catch {
    return { ok: false, settings: null, error: "Caption settings couldn't save." };
  }
}

export async function postCaptionSegment(
  fetchJson: FetchJson,
  streamId: string,
  text: string,
): Promise<{ ok: boolean; error: string | null; retryAfterMs?: number }> {
  const line = text.trim();
  if (!line) return { ok: false, error: null }; // silence is not a caption
  try {
    const { status, json } = await fetchJson(`/api/live/${streamId}/captions/segments`, {
      method: "POST",
      body: JSON.stringify({ text: line }),
    });
    if (status === 201) return { ok: true, error: null };
    return {
      ok: false,
      error: (json?.error as string) ?? "That caption line didn't go through.",
      retryAfterMs: typeof json?.retryAfterMs === "number" ? json.retryAfterMs : undefined,
    };
  } catch {
    return { ok: false, error: "That caption line didn't go through." };
  }
}

/* ── The caption source: the streamer's real speech ───────────────────
   The browser's speech recognizer transcribes the streamer's mic;
   FINAL results become caption lines, posted one by one. Interim
   results are shown locally as a preview only — never posted, so a
   caption a viewer reads is a line the speaker actually said. */

export type SpeechSourceState = "idle" | "listening" | "unsupported" | "blocked" | "error";

export class SpeechCaptionSource {
  state: SpeechSourceState = "idle";
  /** The recognizer's live interim guess — local preview only. */
  interim = "";
  private recognizer: ChatVoiceRecognition | null = null;
  private wantListening = false;

  constructor(
    private opts: {
      /** BCP-47-ish tag for the recognizer (the stream's spoken language). */
      lang: string;
      onFinalLine: (text: string) => void;
      onChange: () => void;
      recognitionCtor?: ChatVoiceRecognitionCtor | null;
    },
  ) {}

  get supported(): boolean {
    return (this.opts.recognitionCtor ?? getChatVoiceRecognitionCtor()) !== null;
  }

  start(): void {
    const Ctor = this.opts.recognitionCtor ?? getChatVoiceRecognitionCtor();
    if (!Ctor) {
      this.state = "unsupported";
      this.opts.onChange();
      return;
    }
    this.wantListening = true;
    this.launch(Ctor);
  }

  private launch(Ctor: ChatVoiceRecognitionCtor): void {
    try {
      const rec = new Ctor();
      this.recognizer = rec;
      rec.lang = this.opts.lang;
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const alt = result?.[0];
          if (!result || !alt) continue;
          if (result.isFinal) {
            const text = alt.transcript.trim();
            if (text) this.opts.onFinalLine(text);
          } else {
            interim += alt.transcript;
          }
        }
        this.interim = interim;
        this.opts.onChange();
      };
      rec.onerror = (event) => {
        // "not-allowed" / "service-not-allowed" = the mic permission
        // answer; anything else is a recognizer failure. Both are
        // stated honestly in the panel, never papered over.
        this.state = event.error === "not-allowed" || event.error === "service-not-allowed" ? "blocked" : "error";
        this.wantListening = false;
        this.opts.onChange();
      };
      rec.onend = () => {
        // Continuous recognizers end on their own (silence, network);
        // while the streamer wants captions, relaunch — that is how
        // a whole stream stays captioned, not just the first minute.
        if (this.wantListening) {
          this.launch(Ctor);
        } else if (this.state === "listening") {
          this.state = "idle";
          this.opts.onChange();
        }
      };
      rec.start();
      this.state = "listening";
      this.opts.onChange();
    } catch {
      this.state = "error";
      this.wantListening = false;
      this.opts.onChange();
    }
  }

  stop(): void {
    this.wantListening = false;
    this.interim = "";
    try {
      this.recognizer?.stop();
    } catch {
      /* already stopped */
    }
    this.recognizer = null;
    if (this.state === "listening") this.state = "idle";
    this.opts.onChange();
  }
}
