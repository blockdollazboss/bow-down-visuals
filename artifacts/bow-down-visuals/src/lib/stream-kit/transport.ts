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

export interface StreamTransport {
  readonly state: TransportState;
  /** Subscribe to state changes; returns an unsubscribe function. */
  onStateChange: (cb: (state: TransportState) => void) => () => void;
  /** Take the processed stream live. Resolves once media is flowing. */
  start: (stream: MediaStream, meta: { title: string }) => Promise<void>;
  /** End the broadcast and release the session. Never throws. */
  stop: () => Promise<void>;
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
  createSession?: (title: string) => Promise<{ streamId: string; whipUrl: string }>;
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

  private async _createSession(title: string): Promise<{ streamId: string; whipUrl: string }> {
    if (this._deps.createSession) return this._deps.createSession(title);
    const doFetch = this._deps.fetchImpl ?? fetch;
    const token = await WhipTransport.api.getAccessToken();
    const res = await doFetch(`${WhipTransport.api.base}/api/live-streams`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ title }),
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

  async start(stream: MediaStream, meta: { title: string }): Promise<void> {
    if (this.state === "connecting" || this.state === "live") {
      throw new TransportError("SESSION", "Already broadcasting.");
    }
    this._setState("connecting");
    try {
      const session = await this._createSession(meta.title);
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
    if (streamId) await this._endSession(streamId).catch(() => undefined);
    this._setState("idle");
  }
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
