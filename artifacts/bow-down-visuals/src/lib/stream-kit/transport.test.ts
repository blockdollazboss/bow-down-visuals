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
  TransportError,
  resolveSessionUrl,
  waitForIceGathering,
  summarizeRtcStats,
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
        { platform: "site", label: "Your profile", status: "active" },
        { platform: "youtube", label: "YouTube", status: "pending" },
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
    expect(transport.activeDestinations).toEqual([
      { platform: "site", label: "Your profile", status: "active" },
    ]);
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
