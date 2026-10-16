/**
 * transport.ts — publishing behind a thin transport interface.
 *
 * The stream studio ("our OBS") produces ONE processed feed (the camera
 * kit's picture + cleaned/effected voice) and that feed has exits. This
 * module is the seam between the studio and any exit:
 *
 *   exit 1 (this build): WhipTransport — WebRTC/WHIP to the site's
 *     streaming provider; viewers watch the broadcast on the creator's
 *     profile / watch page on the website.
 *   exit 1b (this build): OwnServerTransport — the site's own service
 *     carries the stream (the server's selected default): the browser
 *     sends the feed as short MediaRecorder chunks over HTTPS, the API
 *     remuxes them into live HLS, and the same chunk stream becomes the
 *     replay server-side (so this transport reports serverRecording —
 *     the studio must NOT also record locally). createStreamTransport
 *     picks the implementation from the server's /status selection.
 *   exit 2 (later): a native companion app carrying the same studio as a
 *     system virtual camera + virtual mic into other apps. That will be a
 *     second StreamTransport implementation — the studio UI and the kit
 *     modules will not change when it lands, because they only ever talk
 *     to this interface.
 *
 * A transport owns: start(stream, title) → live, stop() → ended, and a
 * subscribable state ('idle' | 'connecting' | 'live' | 'stopping' |
 * 'failed'). Site-session bookkeeping (creating/ending the live_streams
 * row) is the transport implementation's job too — for WHIP that means the
 * /api/live-streams calls happen here, not in the UI.
 */

export type TransportState = "idle" | "connecting" | "live" | "stopping" | "failed";

/* ── Multistream destinations ─────────────────────────────────────────────
   A broadcast names where it's headed. V1 implements exactly one
   destination — the site itself — and the transports say so honestly:
   start() takes the requested destinations into account, publishes to
   the ones it implements, and reports the split on the transport
   (activeDestinations vs skippedDestinations) so the UI can show
   "Broadcasting to: Your profile" and mark the rest as coming — never
   a fake toggle. Fan-out (RTMP relays to other platforms) slots in as
   additional destination handlers behind this same interface; the
   studio UI and the kit modules won't change when it lands. */
export interface StreamDestination {
  platform: string;
  label: string;
  status: "active" | "pending" | "off";
  /** Save a recording of the stream on this destination (default on for the site). */
  saveRecording: boolean;
  /** Where this destination's recording lives after the stream (null until known). */
  vodUrl: string | null;
  /** Recording outcome once actually known; null = not known — never guessed. */
  vodState: "saved" | "not_saved" | null;
}

export const SITE_DESTINATION: StreamDestination = {
  platform: "site",
  label: "Your profile",
  status: "active",
  saveRecording: true,
  vodUrl: null,
  vodState: null,
};

/**
 * The platforms multistreaming will fan out to, with their REAL
 * recording semantics — the studio's destinations surface renders these
 * notes verbatim, and the save preference means different things per
 * platform because the platforms genuinely differ:
 *  - YouTube saves finished streams as videos automatically.
 *  - Twitch saves only when the channel's own "store past broadcasts"
 *    setting is on — that switch lives on Twitch, outside our control.
 *  - Facebook keeps live videos on the page after the stream.
 *  - TikTok keeps no public archive; the replay in the creator's own
 *    library here is the record of the stream.
 */
export interface DestinationPlatformInfo {
  platform: string;
  label: string;
  recordingNote: string;
}

export const DESTINATION_PLATFORMS: DestinationPlatformInfo[] = [
  {
    platform: "site",
    label: "Your profile",
    recordingNote: "Streams save as a replay in your clips library here.",
  },
  {
    platform: "youtube",
    label: "YouTube",
    recordingNote: "YouTube saves finished streams as videos automatically.",
  },
  {
    platform: "twitch",
    label: "Twitch",
    recordingNote:
      "Twitch only saves a stream when “store past broadcasts” is on in your Twitch channel settings — that switch lives on Twitch.",
  },
  {
    platform: "facebook",
    label: "Facebook",
    recordingNote: "Facebook keeps live videos on your page after the stream ends.",
  },
  {
    platform: "tiktok",
    label: "TikTok",
    recordingNote: "TikTok keeps no public archive of live streams — the replay saved here is the record.",
  },
];

export interface StreamTransport {
  readonly state: TransportState;
  /** Subscribe to state changes; returns an unsubscribe function. */
  onStateChange: (cb: (state: TransportState) => void) => () => void;
  /** Take the processed stream live. Resolves once media is flowing. */
  start: (stream: MediaStream, meta: { title: string; destinations?: StreamDestination[] }) => Promise<void>;
  /** End the broadcast and release the session. Never throws. */
  stop: () => Promise<void>;
  /** Destinations the transport actually published to (v1: site only). */
  readonly activeDestinations: StreamDestination[];
  /** Requested destinations this transport does not implement (yet). */
  readonly skippedDestinations: StreamDestination[];
  /**
   * True when the transport's server side keeps the recording itself
   * (own-server: the published chunk stream IS the replay master). The
   * studio skips its local broadcast recorder for these — recording the
   * same feed twice would double the broadcaster's CPU for nothing.
   */
  readonly serverRecording?: boolean;
  /** Publisher stats when the transport has any (WebRTC); else null/absent. */
  getStats?: () => Promise<RTCStatsReport | null>;
  /** The site session id once live (the studio links the replay to it). */
  readonly streamId?: string | null;
}

export class TransportError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TransportError";
    this.code = code; // NOT_CONFIGURED | PROVIDER_ERROR | NETWORK | SDP | SESSION
  }
}

type FetchImpl = typeof fetch;
type PeerConnectionImpl = typeof RTCPeerConnection;

export interface WhipDeps {
  fetchImpl?: FetchImpl;
  peerConnectionImpl?: PeerConnectionImpl;
  /** How long to wait for ICE gathering before sending the offer (ms). */
  iceGatherTimeoutMs?: number;
  /** Creates the site-side broadcast session; returns its whip_url.
   *  Injected in tests; the default calls POST /api/live-streams. */
  createSession?: (
    title: string,
    destinations?: StreamDestination[],
  ) => Promise<{ streamId: string; whipUrl: string }>;
  /** Ends the site-side session. Injected in tests. */
  endSession?: (streamId: string) => Promise<void>;
}

/** Resolve a WHIP session resource URL from the response Location header. */
export function resolveSessionUrl(location: string | null, whipUrl: string): string | null {
  if (!location) return null;
  try {
    return new URL(location, whipUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Wait until ICE gathering completes (or the timeout passes — host
 * candidates are usually enough for the provider's answerer, and waiting
 * forever helps nobody). Exported for tests.
 */
export function waitForIceGathering(
  pc: Pick<RTCPeerConnection, "iceGatheringState" | "addEventListener" | "removeEventListener">,
  timeoutMs: number,
): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    }
    function onChange() {
      if (pc.iceGatheringState === "complete") done();
    }
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

/**
 * WHIP publisher over the site's broadcast API:
 *   start: POST /api/live-streams {title} → { stream: { id, whip_url } }
 *          → RTCPeerConnection offer → POST SDP to the WHIP url → answer.
 *   stop:  DELETE the WHIP session resource (if the provider returned
 *          one), close the peer connection, POST /api/live-streams/:id/end.
 * Session-end runs even if the media teardown hiccups — the site row must
 * never sit 'live' over a dead broadcast.
 */
export class WhipTransport implements StreamTransport {
  state: TransportState = "idle";
  /** Destinations this broadcast actually went to (v1: the site only). */
  activeDestinations: StreamDestination[] = [];
  /** Requested destinations v1 doesn't implement — surfaced, never faked. */
  skippedDestinations: StreamDestination[] = [];
  private _listeners = new Set<(s: TransportState) => void>();
  private _pc: RTCPeerConnection | null = null;
  private _sessionUrl: string | null = null;
  private _streamId: string | null = null;
  private _whipUrl: string | null = null;
  private _deps: Required<Pick<WhipDeps, "iceGatherTimeoutMs">> & WhipDeps;

  /** API seam the studio uses (token provider + API origin). */
  static api: {
    getAccessToken: () => Promise<string | null>;
    base: string;
  } = { getAccessToken: async () => null, base: "" };

  constructor(deps: WhipDeps = {}) {
    this._deps = { iceGatherTimeoutMs: 2500, ...deps };
  }

  onStateChange = (cb: (state: TransportState) => void): (() => void) => {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  };

  private _setState(s: TransportState): void {
    this.state = s;
    this._listeners.forEach((cb) => cb(s));
  }

  /** The site session id once live (the studio links the VOD to it). */
  get streamId(): string | null {
    return this._streamId;
  }

  /** Raw RTC stats for the health readout (null when not broadcasting). */
  async getStats(): Promise<RTCStatsReport | null> {
    if (!this._pc) return null;
    try {
      return await this._pc.getStats();
    } catch {
      return null;
    }
  }

  private async _createSession(
    title: string,
    destinations?: StreamDestination[],
  ): Promise<{ streamId: string; whipUrl: string }> {
    if (this._deps.createSession) return this._deps.createSession(title, destinations);
    const doFetch = this._deps.fetchImpl ?? fetch;
    const token = await WhipTransport.api.getAccessToken();
    const res = await doFetch(`${WhipTransport.api.base}/api/live-streams`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ title, ...(destinations?.length ? { destinations } : {}) }),
    });
    const data = (await res.json().catch(() => null)) as {
      stream?: { id?: string; whip_url?: string };
      error?: string;
      code?: string;
    } | null;
    if (!res.ok || !data?.stream?.id || !data.stream.whip_url) {
      throw new TransportError(
        data?.code ?? (res.status === 503 ? "NOT_CONFIGURED" : "SESSION"),
        data?.error ?? "Could not start your stream.",
      );
    }
    return { streamId: data.stream.id, whipUrl: data.stream.whip_url };
  }

  private async _endSession(streamId: string): Promise<void> {
    if (this._deps.endSession) return this._deps.endSession(streamId);
    const doFetch = this._deps.fetchImpl ?? fetch;
    const token = await WhipTransport.api.getAccessToken();
    await doFetch(`${WhipTransport.api.base}/api/live-streams/${streamId}/end`, {
      method: "POST",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  }

  async start(
    stream: MediaStream,
    meta: { title: string; destinations?: StreamDestination[] },
  ): Promise<void> {
    if (this.state === "connecting" || this.state === "live") {
      throw new TransportError("SESSION", "Already broadcasting.");
    }
    this._setState("connecting");
    /* Destinations: v1 publishes to the site destination and only the
       site destination. Anything else requested is recorded as skipped
       so the studio can say plainly where the broadcast did NOT go. */
    const requested = meta.destinations?.length ? meta.destinations : [{ ...SITE_DESTINATION }];
    const siteRequested = requested.filter((d) => d.platform === "site");
    this.activeDestinations = siteRequested.length ? siteRequested : [{ ...SITE_DESTINATION }];
    this.skippedDestinations = requested.filter((d) => d.platform !== "site");
    try {
      const session = await this._createSession(meta.title, requested);
      this._streamId = session.streamId;
      this._whipUrl = session.whipUrl;

      const PC = this._deps.peerConnectionImpl ?? RTCPeerConnection;
      const doFetch = this._deps.fetchImpl ?? fetch;
      const pc = new PC();
      this._pc = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc, this._deps.iceGatherTimeoutMs ?? 2500);
      const sdp = pc.localDescription?.sdp ?? offer.sdp ?? "";
      if (!sdp) throw new TransportError("SDP", "Your browser couldn't prepare the broadcast signal.");

      const res = await doFetch(session.whipUrl, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: sdp,
      });
      if (res.status !== 201 && !res.ok) {
        throw new TransportError("PROVIDER_ERROR", `The streaming provider refused the broadcast (HTTP ${res.status}).`);
      }
      this._sessionUrl = resolveSessionUrl(res.headers.get("Location"), session.whipUrl);
      const answerSdp = await res.text();
      if (answerSdp) {
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      }
      this._setState("live");
    } catch (err) {
      // Roll the site session back if media never flowed.
      const streamId = this._streamId;
      this._streamId = null;
      this._pc?.close();
      this._pc = null;
      this.activeDestinations = [];
      this.skippedDestinations = [];
      if (streamId) await this._endSession(streamId).catch(() => undefined);
      this._setState("failed");
      throw err instanceof TransportError
        ? err
        : new TransportError("NETWORK", err instanceof Error ? err.message : "Could not start the broadcast.");
    }
  }

  async stop(): Promise<void> {
    if (this.state === "idle") return;
    this._setState("stopping");
    const doFetch = this._deps.fetchImpl ?? fetch;
    if (this._sessionUrl) {
      await doFetch(this._sessionUrl, { method: "DELETE" }).catch(() => undefined);
      this._sessionUrl = null;
    }
    this._pc?.close();
    this._pc = null;
    const streamId = this._streamId;
    this._streamId = null;
    this.activeDestinations = [];
    this.skippedDestinations = [];
    if (streamId) await this._endSession(streamId).catch(() => undefined);
    this._setState("idle");
  }
}

/* ── Own-server transport ─────────────────────────────────────────────────
   The site's own service is the stage: the host gives the API exactly
   one public HTTP port (no UDP), so the feed travels as media the port
   can carry — a MediaRecorder emits a chunk every ~2s and each chunk is
   POSTed over HTTPS to /api/live-streams/:id/ingest/segment. The server
   remuxes the chunk stream into live HLS for the watch page, and the
   same stream is the recording: on stop, the server uploads + registers
   the replay itself (serverRecording = true).

   Chunks upload strictly in order (a promise chain), each with its
   sequence number; the server treats a re-sent sequence as a duplicate,
   so a retry after a flaky moment is safe. A chunk that can't land
   after retries fails the transport honestly rather than letting the
   studio believe it's live over a dead pipe. */

export const INGEST_MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.640028,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

export function pickIngestMimeType(
  isTypeSupported: (mime: string) => boolean = (m) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m),
): string {
  for (const c of INGEST_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return "";
}

export interface OwnServerDeps {
  fetchImpl?: FetchImpl;
  mediaRecorderImpl?: typeof MediaRecorder;
  isTypeSupported?: (mime: string) => boolean;
  /** Recorder chunk cadence (ms). ~2s balances latency vs request rate. */
  timesliceMs?: number;
  /** Creates the site-side broadcast session; returns its stream id. */
  createSession?: (
    title: string,
    destinations?: StreamDestination[],
  ) => Promise<{ streamId: string }>;
  /** Ends the site-side session. Injected in tests. */
  endSession?: (streamId: string) => Promise<void>;
  /** Uploads one chunk. Injected in tests. */
  postChunk?: (streamId: string, seq: number, body: ArrayBuffer, mimeType: string) => Promise<void>;
}

export class OwnServerTransport implements StreamTransport {
  state: TransportState = "idle";
  readonly serverRecording = true;
  activeDestinations: StreamDestination[] = [];
  skippedDestinations: StreamDestination[] = [];
  private _listeners = new Set<(s: TransportState) => void>();
  private _deps: OwnServerDeps;
  private _streamId: string | null = null;
  private _recorder: MediaRecorder | null = null;
  private _mimeType = "";
  private _seq = 0;
  private _chain: Promise<void> = Promise.resolve();
  private _failed = false;
  private _resolveStopped: (() => void) | null = null;

  /** API seam the studio uses (token provider + API origin). */
  static api: {
    getAccessToken: () => Promise<string | null>;
    base: string;
  } = { getAccessToken: async () => null, base: "" };

  constructor(deps: OwnServerDeps = {}) {
    this._deps = deps;
  }

  onStateChange = (cb: (state: TransportState) => void): (() => void) => {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  };

  private _setState(s: TransportState): void {
    this.state = s;
    this._listeners.forEach((cb) => cb(s));
  }

  get streamId(): string | null {
    return this._streamId;
  }

  /** No RTC on this pipe — the health readout says "unavailable". */
  async getStats(): Promise<RTCStatsReport | null> {
    return null;
  }

  private async _createSession(
    title: string,
    destinations?: StreamDestination[],
  ): Promise<{ streamId: string }> {
    if (this._deps.createSession) return this._deps.createSession(title, destinations);
    const doFetch = this._deps.fetchImpl ?? fetch;
    const token = await OwnServerTransport.api.getAccessToken();
    const res = await doFetch(`${OwnServerTransport.api.base}/api/live-streams`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ title, ...(destinations?.length ? { destinations } : {}) }),
    });
    const data = (await res.json().catch(() => null)) as {
      stream?: { id?: string };
      error?: string;
      code?: string;
    } | null;
    if (!res.ok || !data?.stream?.id) {
      throw new TransportError(
        data?.code ?? (res.status === 503 ? "NOT_CONFIGURED" : "SESSION"),
        data?.error ?? "Could not start your stream.",
      );
    }
    return { streamId: data.stream.id };
  }

  private async _endSession(streamId: string): Promise<void> {
    if (this._deps.endSession) return this._deps.endSession(streamId);
    const doFetch = this._deps.fetchImpl ?? fetch;
    const token = await OwnServerTransport.api.getAccessToken();
    await doFetch(`${OwnServerTransport.api.base}/api/live-streams/${streamId}/end`, {
      method: "POST",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  }

  private async _postChunk(seq: number, body: ArrayBuffer): Promise<void> {
    if (this._deps.postChunk) {
      return this._deps.postChunk(this._streamId!, seq, body, this._mimeType);
    }
    const doFetch = this._deps.fetchImpl ?? fetch;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const token = await OwnServerTransport.api.getAccessToken();
        const res = await doFetch(
          `${OwnServerTransport.api.base}/api/live-streams/${this._streamId}/ingest/segment`,
          {
            method: "POST",
            headers: {
              "Content-Type": this._mimeType || "video/webm",
              "X-Segment-Seq": String(seq),
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body,
          },
        );
        if (res.ok) return;
        const data = (await res.json().catch(() => null)) as { code?: string; error?: string } | null;
        // The server says the show is over (ended / capped / session
        // gone) — retrying would just shout at a closed door.
        if (res.status === 400 || res.status === 409 || res.status === 410 || res.status === 413) {
          throw new TransportError(data?.code ?? "SESSION", data?.error ?? "The stream ended on the server.");
        }
        lastErr = new TransportError("NETWORK", data?.error ?? `Chunk upload failed (HTTP ${res.status}).`);
      } catch (err) {
        if (err instanceof TransportError && err.code !== "NETWORK") throw err;
        lastErr = err;
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
    throw lastErr instanceof Error
      ? lastErr
      : new TransportError("NETWORK", "Chunk uploads stopped landing.");
  }

  private _enqueue(blob: Blob): void {
    const seq = this._seq++;
    const job = this._chain.then(async () => {
      if (this._failed) return;
      const buf = await blob.arrayBuffer();
      await this._postChunk(seq, buf);
    });
    this._chain = job.catch((err) => {
      void this._failIngest(err);
    });
  }

  private async _failIngest(err: unknown): Promise<void> {
    if (this._failed || this.state === "idle" || this.state === "stopping") return;
    this._failed = true;
    try {
      if (this._recorder && this._recorder.state !== "inactive") this._recorder.stop();
    } catch {
      /* ignore */
    }
    this._recorder = null;
    const streamId = this._streamId;
    this._streamId = null;
    this.activeDestinations = [];
    this.skippedDestinations = [];
    if (streamId) await this._endSession(streamId).catch(() => undefined);
    this._setState("failed");
    void err;
  }

  async start(
    stream: MediaStream,
    meta: { title: string; destinations?: StreamDestination[] },
  ): Promise<void> {
    if (this.state === "connecting" || this.state === "live") {
      throw new TransportError("SESSION", "Already broadcasting.");
    }
    this._setState("connecting");
    const requested = meta.destinations?.length ? meta.destinations : [{ ...SITE_DESTINATION }];
    const siteRequested = requested.filter((d) => d.platform === "site");
    this.activeDestinations = siteRequested.length ? siteRequested : [{ ...SITE_DESTINATION }];
    this.skippedDestinations = requested.filter((d) => d.platform !== "site");
    this._failed = false;
    this._seq = 0;
    this._chain = Promise.resolve();
    try {
      const session = await this._createSession(meta.title, requested);
      this._streamId = session.streamId;

      const MR =
        this._deps.mediaRecorderImpl ??
        (typeof MediaRecorder !== "undefined" ? MediaRecorder : undefined);
      if (!MR) {
        throw new TransportError(
          "UNSUPPORTED",
          "This browser can't record the feed the site's stage needs — try Chrome, Edge, or Safari.",
        );
      }
      const mimeType = pickIngestMimeType(
        this._deps.isTypeSupported ??
          ((m) => {
            try {
              return MR.isTypeSupported(m);
            } catch {
              return false;
            }
          }),
      );
      const recorder = mimeType
        ? new MR(stream, { mimeType, videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 })
        : new MR(stream, { videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 });
      this._mimeType = recorder.mimeType || mimeType || "video/webm";
      recorder.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) this._enqueue(ev.data);
      };
      recorder.onstop = () => {
        this._resolveStopped?.();
        this._resolveStopped = null;
      };
      recorder.onerror = () => {
        void this._failIngest(new TransportError("NETWORK", "The recorder hit a problem mid-stream."));
      };
      this._recorder = recorder;
      recorder.start(this._deps.timesliceMs ?? 2000);
      this._setState("live");
    } catch (err) {
      const streamId = this._streamId;
      this._streamId = null;
      this._recorder = null;
      this.activeDestinations = [];
      this.skippedDestinations = [];
      if (streamId) await this._endSession(streamId).catch(() => undefined);
      this._setState("failed");
      throw err instanceof TransportError
        ? err
        : new TransportError("NETWORK", err instanceof Error ? err.message : "Could not start the broadcast.");
    }
  }

  async stop(): Promise<void> {
    if (this.state === "idle") return;
    this._setState("stopping");
    const recorder = this._recorder;
    this._recorder = null;
    if (recorder && recorder.state !== "inactive") {
      const stopped = new Promise<void>((resolve) => {
        this._resolveStopped = resolve;
      });
      try {
        recorder.stop();
      } catch {
        this._resolveStopped = null;
        void stopped;
      }
      // The final dataavailable lands in the chain before onstop fires.
      if (this._resolveStopped) await stopped;
    }
    await this._chain.catch(() => undefined);
    const streamId = this._streamId;
    this._streamId = null;
    this.activeDestinations = [];
    this.skippedDestinations = [];
    if (streamId) await this._endSession(streamId).catch(() => undefined);
    this._setState("idle");
  }
}

/** Pick the publish transport from the server's /status selection. */
export function createStreamTransport(
  kind: "own" | "cloudflare",
  deps: { whip?: WhipDeps; own?: OwnServerDeps } = {},
): StreamTransport {
  return kind === "cloudflare" ? new WhipTransport(deps.whip) : new OwnServerTransport(deps.own);
}

/* ── Stream health (RTC stats) ────────────────────────────────────────────
   The studio's health readout reads the publisher's outbound-rtp stats.
   Browsers expose different subsets — every field here is nullable and
   the UI says "unavailable" for what a browser doesn't give up, rather
   than inventing numbers. */

export interface RtcStatSample {
  bytesSent: number;
  timestamp: number;
}

export interface RtcSummary {
  bitrateKbps: number | null;
  fps: number | null;
  droppedFrames: number | null;
  framesSent: number | null;
}

/**
 * Summarize one getStats() snapshot (an iterable of stat records) for the
 * video outbound-rtp entries, deriving bitrate from the previous sample.
 * Pure — unit-tested with synthetic stat records.
 */
export function summarizeRtcStats(
  stats: Iterable<Record<string, unknown>>,
  prev: RtcStatSample | null,
): { summary: RtcSummary; sample: RtcStatSample } {
  let bytesSent = 0;
  let timestamp = 0;
  let fps: number | null = null;
  let dropped: number | null = null;
  let sent: number | null = null;
  let seen = false;
  for (const s of stats) {
    if (!s || s["type"] !== "outbound-rtp") continue;
    const kind = (s["kind"] ?? s["mediaType"]) as string | undefined;
    if (kind && kind !== "video") continue;
    seen = true;
    bytesSent += typeof s["bytesSent"] === "number" ? (s["bytesSent"] as number) : 0;
    timestamp = Math.max(timestamp, typeof s["timestamp"] === "number" ? (s["timestamp"] as number) : 0);
    if (typeof s["framesPerSecond"] === "number") fps = s["framesPerSecond"] as number;
    if (typeof s["framesDropped"] === "number") dropped = (dropped ?? 0) + (s["framesDropped"] as number);
    if (typeof s["framesSent"] === "number") sent = (sent ?? 0) + (s["framesSent"] as number);
  }
  const sample: RtcStatSample = { bytesSent, timestamp: timestamp || Date.now() };
  let bitrateKbps: number | null = null;
  if (seen && prev && sample.timestamp > prev.timestamp && sample.bytesSent >= prev.bytesSent) {
    const seconds = (sample.timestamp - prev.timestamp) / 1000;
    if (seconds > 0) bitrateKbps = Math.round(((sample.bytesSent - prev.bytesSent) * 8) / seconds / 1000);
  }
  return { summary: { bitrateKbps, fps, droppedFrames: dropped, framesSent: sent }, sample };
}

/* ── WHEP playback (the watch side) ───────────────────────────────────────
   Not a StreamTransport (that's the publish seam) — a small player with
   the same shape of lifecycle: play(url, video) → stop(). Retries are the
   caller's business; this throws a TransportError on failure so the watch
   page can fall back to the HLS URL honestly. */

export interface WhepDeps {
  fetchImpl?: FetchImpl;
  peerConnectionImpl?: PeerConnectionImpl;
  iceGatherTimeoutMs?: number;
}

export class WhepPlayer {
  private _pc: RTCPeerConnection | null = null;
  private _deps: WhepDeps;

  constructor(deps: WhepDeps = {}) {
    this._deps = deps;
  }

  async play(whepUrl: string, video: HTMLVideoElement): Promise<void> {
    const PC = this._deps.peerConnectionImpl ?? RTCPeerConnection;
    const doFetch = this._deps.fetchImpl ?? fetch;
    const pc = new PC();
    this._pc = pc;
    const remote = new MediaStream();
    pc.ontrack = (ev) => {
      ev.streams[0]?.getTracks().forEach((t) => remote.addTrack(t));
      if (!ev.streams[0]) remote.addTrack(ev.track);
      video.srcObject = remote;
    };
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc, this._deps.iceGatherTimeoutMs ?? 2500);
    const sdp = pc.localDescription?.sdp ?? offer.sdp ?? "";
    const res = await doFetch(whepUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: sdp,
    });
    if (res.status !== 201 && !res.ok) {
      pc.close();
      this._pc = null;
      throw new TransportError("PROVIDER_ERROR", `The stream couldn't be reached (HTTP ${res.status}).`);
    }
    const answerSdp = await res.text();
    if (answerSdp) await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  }

  stop(): void {
    this._pc?.close();
    this._pc = null;
  }
}
