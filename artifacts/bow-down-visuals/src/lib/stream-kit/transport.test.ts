/**
 * Unit tests for the stream-kit publish seam (transport.ts).
 *
 * The transport interface is the point: the studio talks to
 * StreamTransport, WHIP is implementation #1. These tests pin the WHIP
 * implementation's contract with fakes — no real peer connections, no
 * real network:
 *  - start() creates the site session FIRST, then offers SDP to the
 *    returned WHIP url, applies the answer, and reports state.
 *  - a provider refusal rolls the site session back (no zombie 'live').
 *  - stop() DELETEs the WHIP session resource, closes the peer, and ends
 *    the site session — even the pieces that fail are best-effort.
 *  - WHEP play() wires recvonly transceivers and the remote stream.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  WhipTransport,
  WhepPlayer,
  OwnServerTransport,
  createStreamTransport,
  pickIngestMimeType,
  INGEST_MIME_CANDIDATES,
  TransportError,
  resolveSessionUrl,
  waitForIceGathering,
  summarizeRtcStats,
  SITE_DESTINATION,
} from "./transport";

// Node test env has no MediaStream constructor (WhepPlayer builds one).
(globalThis as Record<string, unknown>)["MediaStream"] ??= class {
  tracks: unknown[] = [];
  addTrack(t: unknown) {
    this.tracks.push(t);
  }
  getTracks() {
    return this.tracks;
  }
};

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  iceGatheringState: string = "complete";
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: unknown = null;
  addedTracks: Array<{ track: unknown; stream: unknown }> = [];
  transceivers: Array<{ kind: string; init: unknown }> = [];
  ontrack: ((ev: unknown) => void) | null = null;
  closed = false;
  private _listeners = new Map<string, Array<() => void>>();

  constructor() {
    FakePeerConnection.instances.push(this);
  }
  addTrack(track: unknown, stream: unknown) {
    this.addedTracks.push({ track, stream });
    return {};
  }
  addTransceiver(kind: string, init: unknown) {
    this.transceivers.push({ kind, init });
    return {};
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0 fake-offer" };
  }
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = { type: d.type, sdp: "v=0 local-offer" };
  }
  async setRemoteDescription(d: unknown) {
    this.remoteDescription = d;
  }
  addEventListener(name: string, cb: () => void) {
    const arr = this._listeners.get(name) ?? [];
    arr.push(cb);
    this._listeners.set(name, arr);
  }
  removeEventListener(name: string, cb: () => void) {
    this._listeners.set(name, (this._listeners.get(name) ?? []).filter((c) => c !== cb));
  }
  emit(name: string) {
    (this._listeners.get(name) ?? []).forEach((cb) => cb());
  }
  close() {
    this.closed = true;
  }
}

const WHIP_URL = "https://customer-x.cloudflarestream.com/in1/webRTC/publish";
const fakeStream = () =>
  ({ getTracks: () => [{ kind: "video" }, { kind: "audio" }] }) as unknown as MediaStream;

function sdpResponse(status: number, answer = "v=0 fake-answer", location: string | null = null) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (n: string) => (n.toLowerCase() === "location" ? location : null) },
    text: async () => answer,
    json: async () => ({}),
  } as unknown as Response;
}

beforeEach(() => {
  FakePeerConnection.instances = [];
});

describe("resolveSessionUrl", () => {
  it("resolves relative and absolute Location headers against the whip url", () => {
    expect(resolveSessionUrl("/session/abc", WHIP_URL)).toBe(
      "https://customer-x.cloudflarestream.com/session/abc",
    );
    expect(resolveSessionUrl("https://customer-x.cloudflarestream.com/s/1", WHIP_URL)).toBe(
      "https://customer-x.cloudflarestream.com/s/1",
    );
    expect(resolveSessionUrl(null, WHIP_URL)).toBeNull();
  });
});

describe("waitForIceGathering", () => {
  it("resolves immediately when already complete", async () => {
    const pc = new FakePeerConnection();
    await expect(waitForIceGathering(pc as never, 50)).resolves.toBeUndefined();
  });

  it("resolves when gathering completes via the event", async () => {
    const pc = new FakePeerConnection();
    pc.iceGatheringState = "gathering";
    const p = waitForIceGathering(pc as never, 5000);
    pc.iceGatheringState = "complete";
    pc.emit("icegatheringstatechange");
    await expect(p).resolves.toBeUndefined();
  });

  it("resolves on timeout instead of hanging", async () => {
    const pc = new FakePeerConnection();
    pc.iceGatheringState = "gathering";
    await expect(waitForIceGathering(pc as never, 20)).resolves.toBeUndefined();
  });
});

describe("WhipTransport", () => {
  function makeTransport(fetchImpl: ReturnType<typeof vi.fn>, extra: object = {}) {
    const ended: string[] = [];
    const transport = new WhipTransport({
      fetchImpl: fetchImpl as never,
      peerConnectionImpl: FakePeerConnection as never,
      createSession: async () => ({ streamId: "stream-1", whipUrl: WHIP_URL }),
      endSession: async (id: string) => {
        ended.push(id);
      },
      iceGatherTimeoutMs: 10,
      ...extra,
    });
    return { transport, ended };
  }

  it("start(): session first, SDP offer to the whip url, answer applied, state live", async () => {
    const fetchImpl = vi.fn(async () => sdpResponse(201, "v=0 answer-sdp", "/session/abc"));
    const { transport } = makeTransport(fetchImpl);
    const states: string[] = [];
    transport.onStateChange((s) => states.push(s));

    await transport.start(fakeStream(), { title: "Friday Night Live" });

    expect(transport.state).toBe("live");
    expect(transport.streamId).toBe("stream-1");
    expect(states).toEqual(["connecting", "live"]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(WHIP_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/sdp");
    expect(init.body).toBe("v=0 local-offer");

    const pc = FakePeerConnection.instances[0]!;
    expect(pc.addedTracks).toHaveLength(2);
    expect(pc.remoteDescription).toEqual({ type: "answer", sdp: "v=0 answer-sdp" });
  });

  it("stop(): DELETEs the session resource, closes the peer, ends the site session", async () => {
    const fetchImpl = vi.fn(async () => sdpResponse(201, "v=0 a", "/session/abc"));
    const { transport, ended } = makeTransport(fetchImpl);
    await transport.start(fakeStream(), { title: "T" });
    fetchImpl.mockClear();
    fetchImpl.mockImplementation(async () => sdpResponse(200, ""));

    await transport.stop();

    expect(transport.state).toBe("idle");
    expect(ended).toEqual(["stream-1"]);
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://customer-x.cloudflarestream.com/session/abc");
    expect(init.method).toBe("DELETE");
    expect(FakePeerConnection.instances[0]!.closed).toBe(true);
  });

  it("start(): a provider refusal rolls the site session back (no zombie live)", async () => {
    const fetchImpl = vi.fn(async () => sdpResponse(500, "nope"));
    const { transport, ended } = makeTransport(fetchImpl);
    await expect(transport.start(fakeStream(), { title: "T" })).rejects.toMatchObject({
      name: "TransportError",
      code: "PROVIDER_ERROR",
    });
    expect(transport.state).toBe("failed");
    expect(ended).toEqual(["stream-1"]);
  });

  it("start(): a NOT_CONFIGURED session error propagates untouched and rolls nothing back", async () => {
    const fetchImpl = vi.fn();
    const transport = new WhipTransport({
      fetchImpl: fetchImpl as never,
      peerConnectionImpl: FakePeerConnection as never,
      createSession: async () => {
        throw new TransportError("NOT_CONFIGURED", "Live streaming isn't switched on yet.");
      },
      endSession: async () => {
        throw new Error("must not be called");
      },
    });
    await expect(transport.start(fakeStream(), { title: "T" })).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
    expect(transport.state).toBe("failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("start() while live is refused", async () => {
    const fetchImpl = vi.fn(async () => sdpResponse(201));
    const { transport } = makeTransport(fetchImpl);
    await transport.start(fakeStream(), { title: "T" });
    await expect(transport.start(fakeStream(), { title: "T2" })).rejects.toBeInstanceOf(TransportError);
  });
});

describe("WhipTransport destinations (multistream seam)", () => {
  function makeTransport(fetchImpl: ReturnType<typeof vi.fn>, extra: object = {}) {
    return new WhipTransport({
      fetchImpl: fetchImpl as never,
      peerConnectionImpl: FakePeerConnection as never,
      createSession: async () => ({ streamId: "stream-1", whipUrl: WHIP_URL }),
      endSession: async () => undefined,
      iceGatherTimeoutMs: 10,
      ...extra,
    });
  }

  it("passes destinations to the session and splits active (site) vs skipped", async () => {
    const fetchImpl = vi.fn(async () => sdpResponse(201, "v=0 answer-sdp", "/session/abc"));
    let seen: unknown = null;
    const transport = makeTransport(fetchImpl, {
      createSession: async (_title: string, destinations?: unknown) => {
        seen = destinations;
        return { streamId: "stream-1", whipUrl: WHIP_URL };
      },
    });
    await transport.start(fakeStream(), {
      title: "T",
      destinations: [
        { platform: "site", label: "Your profile", status: "active", saveRecording: true, vodUrl: null, vodState: null },
        { platform: "youtube", label: "YouTube", status: "pending", saveRecording: true, vodUrl: null, vodState: null },
      ],
    });
    expect(seen).toHaveLength(2);
    expect(transport.activeDestinations.map((d) => d.platform)).toEqual(["site"]);
    expect(transport.skippedDestinations.map((d) => d.platform)).toEqual(["youtube"]);
    await transport.stop();
    expect(transport.activeDestinations).toEqual([]);
    expect(transport.skippedDestinations).toEqual([]);
  });

  it("no destinations requested → the site destination is the active one", async () => {
    const fetchImpl = vi.fn(async () => sdpResponse(201, "v=0 answer-sdp", "/session/abc"));
    const transport = makeTransport(fetchImpl);
    await transport.start(fakeStream(), { title: "T" });
    expect(transport.activeDestinations).toEqual([SITE_DESTINATION]);
    expect(transport.skippedDestinations).toEqual([]);
  });
});

describe("WhepPlayer", () => {
  it("play(): recvonly transceivers, offer posted, remote stream lands on the video element", async () => {
    const fetchImpl = vi.fn(async () => sdpResponse(201, "v=0 whep-answer"));
    const player = new WhepPlayer({
      fetchImpl: fetchImpl as never,
      peerConnectionImpl: FakePeerConnection as never,
      iceGatherTimeoutMs: 10,
    });
    const video = { srcObject: null as unknown } as HTMLVideoElement;
    await player.play("https://customer-x.cloudflarestream.com/in1/webRTC/play", video);

    const pc = FakePeerConnection.instances[0]!;
    expect(pc.transceivers).toEqual([
      { kind: "video", init: { direction: "recvonly" } },
      { kind: "audio", init: { direction: "recvonly" } },
    ]);
    expect(pc.remoteDescription).toEqual({ type: "answer", sdp: "v=0 whep-answer" });

    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain("/webRTC/play");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/sdp");

    const remoteStream = { getTracks: () => [{ kind: "video" }] };
    pc.ontrack?.({ streams: [remoteStream], track: { kind: "video" } });
    expect(video.srcObject).toBeTruthy();
    player.stop();
    expect(pc.closed).toBe(true);
  });

  it("play(): a provider refusal throws and closes the peer", async () => {
    const fetchImpl = vi.fn(async () => sdpResponse(404, ""));
    const player = new WhepPlayer({
      fetchImpl: fetchImpl as never,
      peerConnectionImpl: FakePeerConnection as never,
      iceGatherTimeoutMs: 10,
    });
    const video = { srcObject: null as unknown } as HTMLVideoElement;
    await expect(player.play("https://customer-x.cloudflarestream.com/in1/webRTC/play", video)).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
    expect(FakePeerConnection.instances[0]!.closed).toBe(true);
  });
});

describe("summarizeRtcStats (stream health)", () => {
  const videoOut = (over: Record<string, unknown>) => ({
    type: "outbound-rtp",
    kind: "video",
    bytesSent: 0,
    timestamp: 0,
    ...over,
  });

  it("first sample: bitrate unknown, fps/dropped/sent pass through", () => {
    const { summary, sample } = summarizeRtcStats(
      [videoOut({ bytesSent: 5000, timestamp: 1000, framesPerSecond: 30, framesDropped: 2, framesSent: 60 })],
      null,
    );
    expect(summary.bitrateKbps).toBeNull();
    expect(summary.fps).toBe(30);
    expect(summary.droppedFrames).toBe(2);
    expect(summary.framesSent).toBe(60);
    expect(sample).toEqual({ bytesSent: 5000, timestamp: 1000 });
  });

  it("derives bitrate from the previous sample and ignores audio entries", () => {
    const stats = [
      videoOut({ bytesSent: 3000, timestamp: 3000, framesPerSecond: 29 }),
      { type: "outbound-rtp", kind: "audio", bytesSent: 999999, timestamp: 3000 },
      { type: "inbound-rtp", kind: "video", bytesSent: 123, timestamp: 3000 },
    ];
    const { summary } = summarizeRtcStats(stats, { bytesSent: 1000, timestamp: 1000 });
    // (3000-1000) bytes over 2s = 8000 bps = 8 kbps
    expect(summary.bitrateKbps).toBe(8);
    expect(summary.droppedFrames).toBeNull(); // absent field stays honestly null
  });

  it("no video stats at all → everything null except the sample", () => {
    const { summary } = summarizeRtcStats([{ type: "candidate-pair", timestamp: 5 }], null);
    expect(summary).toEqual({ bitrateKbps: null, fps: null, droppedFrames: null, framesSent: null });
  });
});

/* ── OwnServerTransport (implementation #2 — the site's own stage) ─────
   Chunked HTTPS ingest: MediaRecorder emits ~2s chunks, each POSTed in
   order with its sequence number; the server IS the recorder
   (serverRecording), so the studio must not run a second one. */

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  mimeType: string;
  state = "inactive";
  startedWith: number | null = null;
  ondataavailable: ((ev: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? "video/webm";
    FakeRecorder.instances.push(this);
  }
  start(timeslice?: number): void {
    this.state = "recording";
    this.startedWith = timeslice ?? null;
  }
  emit(text: string): void {
    this.ondataavailable?.({ data: new Blob([text]) });
  }
  stop(): void {
    this.state = "inactive";
    this.onstop?.();
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const ownFakeStream = () => ({}) as unknown as MediaStream;

describe("OwnServerTransport", () => {
  beforeEach(() => {
    FakeRecorder.instances = [];
  });

  function harness(over: Partial<Parameters<typeof makeDeps>[0]> = {}) {
    return makeDeps(over);
  }
  function makeDeps(over: {
    createSession?: (title: string) => Promise<{ streamId: string }>;
    postChunk?: (id: string, seq: number, body: ArrayBuffer, mime: string) => Promise<void>;
    supported?: (m: string) => boolean;
  } = {}) {
    const calls = {
      created: [] as string[],
      ended: [] as string[],
      posted: [] as Array<{ id: string; seq: number; text: string; mime: string }>,
    };
    const deps = {
      mediaRecorderImpl: FakeRecorder as never,
      isTypeSupported: over.supported ?? ((m: string) => m.includes("webm")),
      createSession: over.createSession ?? (async (title: string) => {
        calls.created.push(title);
        return { streamId: "stream-own-1" };
      }),
      endSession: async (id: string) => {
        calls.ended.push(id);
      },
      postChunk: over.postChunk ?? (async (id: string, seq: number, body: ArrayBuffer, mime: string) => {
        calls.posted.push({ id, seq, text: new TextDecoder().decode(body), mime });
      }),
    };
    return { deps, calls };
  }

  it("is a server-recording transport with no RTC stats", async () => {
    const { deps } = harness();
    const t = new OwnServerTransport(deps);
    expect(t.serverRecording).toBe(true);
    expect(await t.getStats()).toBeNull();
  });

  it("creates the session, picks the first supported mime, and starts the recorder on the 2s cadence", async () => {
    const { deps, calls } = harness();
    const t = new OwnServerTransport(deps);
    await t.start(ownFakeStream(), { title: "Friday Night Live" });
    expect(calls.created).toEqual(["Friday Night Live"]);
    expect(t.state).toBe("live");
    expect(t.streamId).toBe("stream-own-1");
    const rec = FakeRecorder.instances[0];
    expect(rec.mimeType).toBe("video/webm;codecs=vp9,opus");
    expect(rec.startedWith).toBe(2000);
    await t.stop();
  });

  it("posts chunks in order with sequence numbers; stop flushes before ending the session", async () => {
    const { deps, calls } = harness();
    const t = new OwnServerTransport(deps);
    await t.start(ownFakeStream(), { title: "Show" });
    const rec = FakeRecorder.instances[0];
    rec.emit("chunk-zero");
    rec.emit("chunk-one");
    await flush();
    rec.emit("chunk-two-final");
    await t.stop();
    expect(calls.posted.map((p) => p.seq)).toEqual([0, 1, 2]);
    expect(calls.posted.map((p) => p.text)).toEqual(["chunk-zero", "chunk-one", "chunk-two-final"]);
    expect(calls.posted.every((p) => p.id === "stream-own-1" && p.mime.includes("webm"))).toBe(true);
    expect(calls.ended).toEqual(["stream-own-1"]);
    expect(t.state).toBe("idle");
    expect(t.streamId).toBeNull();
  });

  it("surfaces a session refusal with its server code and lands in failed state", async () => {
    const { deps } = harness({
      createSession: async () => {
        throw new TransportError("LIVE_CAPACITY", "The live stage is full right now.");
      },
    });
    const t = new OwnServerTransport(deps);
    await expect(t.start(ownFakeStream(), { title: "Show" })).rejects.toMatchObject({ code: "LIVE_CAPACITY" });
    expect(t.state).toBe("failed");
  });

  it("a mid-stream ingest failure fails the transport and ends the session", async () => {
    const { deps, calls } = harness({
      postChunk: async () => {
        throw new TransportError("STREAM_ENDED", "That stream has ended.");
      },
    });
    const t = new OwnServerTransport(deps);
    await t.start(ownFakeStream(), { title: "Show" });
    FakeRecorder.instances[0].emit("doomed");
    await flush();
    await flush();
    expect(t.state).toBe("failed");
    expect(calls.ended).toEqual(["stream-own-1"]);
  });

  it("default chunk upload targets the ingest endpoint with the seq header; a 410 is fatal (no retry)", async () => {
    const seen: Array<{ url: string; seq: string | null; ct: string | null }> = [];
    const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
      seen.push({
        url,
        seq: init?.headers?.["X-Segment-Seq"] ?? null,
        ct: init?.headers?.["Content-Type"] ?? null,
      });
      return {
        ok: false,
        status: 410,
        json: async () => ({ code: "STREAM_ENDED", error: "That stream has ended." }),
      };
    };
    const prevToken = OwnServerTransport.api.getAccessToken;
    OwnServerTransport.api.getAccessToken = async () => "tok-1";
    try {
      const t = new OwnServerTransport({
        mediaRecorderImpl: FakeRecorder as never,
        isTypeSupported: (m: string) => m.includes("webm"),
        createSession: async () => ({ streamId: "stream-own-9" }),
        endSession: async () => undefined,
        fetchImpl: fetchImpl as never,
      });
      await t.start(ownFakeStream(), { title: "Show" });
      FakeRecorder.instances[0].emit("only-chunk");
      await flush();
      await flush();
      expect(seen).toHaveLength(1); // fatal statuses are never retried
      expect(seen[0].url).toBe("/api/live-streams/stream-own-9/ingest/segment");
      expect(seen[0].seq).toBe("0");
      expect(seen[0].ct).toContain("video/webm");
      expect(t.state).toBe("failed");
    } finally {
      OwnServerTransport.api.getAccessToken = prevToken;
    }
  });
});

describe("pickIngestMimeType + factory", () => {
  it("prefers MP4 when the browser offers it, falls down the candidate list, else empty", () => {
    expect(pickIngestMimeType(() => true)).toBe(INGEST_MIME_CANDIDATES[0]);
    expect(pickIngestMimeType((m) => m === "video/webm")).toBe("video/webm");
    expect(pickIngestMimeType(() => false)).toBe("");
  });

  it("createStreamTransport returns the implementation the server selected", () => {
    expect(createStreamTransport("own")).toBeInstanceOf(OwnServerTransport);
    expect(createStreamTransport("cloudflare")).toBeInstanceOf(WhipTransport);
  });
});
