/**
 * The World — voice mesh tests (lib/world/voice).
 *
 * Fake RTCPeerConnections + fake sinks drive the real VoiceMesh:
 * - the proximity curve: full volume close, smooth fade, silence at range
 * - the newcomer-offers rule: voice.state (everyone already in) makes
 *   ME offer to each of them; a member who was inside never offers to
 *   the newcomer — their offer is answered instead
 * - ICE candidates ride voice.signal both ways, and early candidates
 *   (before the remote description) are held, then flushed in order
 * - mute silences the mic track without tearing the mesh down
 * - proximity updates set per-peer gains from live avatar positions;
 *   a peer with no known position is silent, never loud
 * - dropPeer / leave tear down connections and sinks completely
 */
import { describe, it, expect } from "vitest";
import {
  VoiceMesh,
  gainForDistance,
  VOICE_MAX_DISTANCE,
  type RtcPeerConnectionLike,
  type RtcDescriptionLike,
  type VoiceSink,
} from "./voice";

class FakePc implements RtcPeerConnectionLike {
  tracks: Array<{ track: unknown; stream: unknown }> = [];
  local: RtcDescriptionLike | null = null;
  remote: RtcDescriptionLike | null = null;
  iceAdded: unknown[] = [];
  closed = false;
  ontrack: ((ev: { streams: unknown[] }) => void) | null = null;
  onicecandidate: ((ev: { candidate: unknown }) => void) | null = null;

  addTrack(track: unknown, stream: unknown): void {
    this.tracks.push({ track, stream });
  }
  async createOffer(): Promise<RtcDescriptionLike> {
    return { type: "offer", sdp: "fake-offer-sdp" };
  }
  async createAnswer(): Promise<RtcDescriptionLike> {
    return { type: "answer", sdp: "fake-answer-sdp" };
  }
  async setLocalDescription(desc: RtcDescriptionLike): Promise<void> {
    this.local = desc;
  }
  async setRemoteDescription(desc: RtcDescriptionLike): Promise<void> {
    this.remote = desc;
  }
  async addIceCandidate(candidate: unknown): Promise<void> {
    this.iceAdded.push(candidate);
  }
  close(): void {
    this.closed = true;
  }
  emitTrack(stream: unknown): void {
    this.ontrack?.({ streams: [stream] });
  }
  emitIce(candidate: unknown): void {
    this.onicecandidate?.({ candidate });
  }
}

class FakeSink implements VoiceSink {
  gains: number[] = [];
  disposed = false;
  getLevel?: () => number;
  setGain(v: number): void {
    this.gains.push(v);
  }
  dispose(): void {
    this.disposed = true;
  }
  get last(): number | undefined {
    return this.gains[this.gains.length - 1];
  }
}

function makeMesh() {
  const signals: Array<{ to: string; data: any }> = [];
  const pcs = new Map<string, FakePc>();
  const sinks = new Map<string, FakeSink>();
  const mesh = new VoiceMesh({
    sendSignal: (to, data) => signals.push({ to, data }),
    createPeerConnection: () => {
      const pc = new FakePc();
      // VoiceMesh keys PCs internally; the latest created is retrievable
      // by creation order through this list.
      pcs.set(`pc-${pcs.size}`, pc);
      return pc;
    },
    createSink: (peerId) => {
      const sink = new FakeSink();
      sinks.set(peerId, sink);
      return sink;
    },
  });
  const micTrack = { enabled: true };
  const localStream = { getAudioTracks: () => [micTrack] };
  return { mesh, signals, pcs, sinks, micTrack, localStream };
}

function onlyPc(pcs: Map<string, FakePc>): FakePc {
  return [...pcs.values()][0]!;
}

describe("gainForDistance — proximity curve", () => {
  it("is full volume up close and silent at max range", () => {
    expect(gainForDistance(0)).toBe(1);
    expect(gainForDistance(2)).toBe(1);
    expect(gainForDistance(VOICE_MAX_DISTANCE)).toBe(0);
    expect(gainForDistance(VOICE_MAX_DISTANCE + 5)).toBe(0);
  });

  it("fades smoothly and monotonically between", () => {
    const samples = [3, 6, 9, 12, 15].map(gainForDistance);
    for (const g of samples) expect(g).toBeGreaterThan(0);
    for (const g of samples) expect(g).toBeLessThan(1);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeLessThan(samples[i - 1]!);
    }
    expect(gainForDistance(9)).toBeCloseTo(0.5, 1);
  });

  it("garbage distances read as up-close-safe (never negative or NaN)", () => {
    expect(gainForDistance(Number.NaN)).toBe(1);
    expect(gainForDistance(-3)).toBe(1);
  });
});

describe("pairing — the newcomer offers", () => {
  it("voice.state makes me offer to every existing voice peer", async () => {
    const { mesh, signals, pcs, localStream } = makeMesh();
    mesh.start(localStream as never);
    await mesh.handleVoiceState(["peer-a", "peer-b"]);

    expect(mesh.peerCount).toBe(2);
    expect(signals.filter((s) => s.data.kind === "offer").map((s) => s.to)).toEqual(["peer-a", "peer-b"]);
    // My mic rides every connection from the start.
    for (const pc of pcs.values()) expect(pc.tracks).toHaveLength(1);
  });

  it("an incoming offer is answered, never counter-offered", async () => {
    const { mesh, signals, pcs, localStream } = makeMesh();
    mesh.start(localStream as never);
    await mesh.handleSignal("peer-a", { kind: "offer", sdp: "their-offer" });

    const pc = onlyPc(pcs);
    expect(pc.remote).toEqual({ type: "offer", sdp: "their-offer" });
    expect(pc.local?.type).toBe("answer");
    expect(signals).toEqual([{ to: "peer-a", data: { kind: "answer", sdp: "fake-answer-sdp" } }]);
  });

  it("an answer completes my outstanding offer", async () => {
    const { mesh, pcs, localStream } = makeMesh();
    mesh.start(localStream as never);
    await mesh.handleVoiceState(["peer-a"]);
    await mesh.handleSignal("peer-a", { kind: "answer", sdp: "their-answer" });
    expect(onlyPc(pcs).remote).toEqual({ type: "answer", sdp: "their-answer" });
  });

  it("my ICE candidates are signaled out; theirs are added — early ones held until the description lands", async () => {
    const { mesh, signals, pcs, localStream } = makeMesh();
    mesh.start(localStream as never);

    // Their candidate arrives BEFORE any offer — no peer exists yet, dropped safely.
    await mesh.handleSignal("peer-a", { kind: "ice", candidate: { c: 0 } });

    await mesh.handleVoiceState(["peer-a"]);
    const pc = onlyPc(pcs);
    // Candidate for the pair arrives before their answer: held, not added.
    await mesh.handleSignal("peer-a", { kind: "ice", candidate: { c: 1 } });
    expect(pc.iceAdded).toEqual([]);
    await mesh.handleSignal("peer-a", { kind: "answer", sdp: "ans" });
    expect(pc.iceAdded).toEqual([{ c: 1 }]);
    // After the description, candidates flow straight through.
    await mesh.handleSignal("peer-a", { kind: "ice", candidate: { c: 2 } });
    expect(pc.iceAdded).toEqual([{ c: 1 }, { c: 2 }]);

    pc.emitIce({ c: 99 });
    expect(signals).toContainEqual({ to: "peer-a", data: { kind: "ice", candidate: { c: 99 } } });
  });
});

describe("mute, proximity, teardown", () => {
  it("mute disables the mic track; the mesh stays connected", async () => {
    const { mesh, micTrack, localStream } = makeMesh();
    mesh.start(localStream as never);
    await mesh.handleVoiceState(["peer-a"]);
    mesh.setMuted(true);
    expect(micTrack.enabled).toBe(false);
    expect(mesh.peerCount).toBe(1);
    mesh.setMuted(false);
    expect(micTrack.enabled).toBe(true);
  });

  it("proximity updates drive each sink's gain from live positions", async () => {
    const { mesh, pcs, sinks, localStream } = makeMesh();
    mesh.start(localStream as never);
    await mesh.handleVoiceState(["peer-a", "peer-b"]);
    const [pcA, pcB] = [...pcs.values()] as [FakePc, FakePc];
    pcA.emitTrack({ id: "stream-a" });
    pcB.emitTrack({ id: "stream-b" });

    mesh.updateVolumes(
      { x: 0, z: 0 },
      new Map([
        ["peer-a", { x: 1, z: 0 }], // right next to me
        ["peer-b", { x: 15, z: 0 }], // nearly across the hall
      ]),
    );
    expect(sinks.get("peer-a")!.last).toBe(1);
    expect(sinks.get("peer-b")!.last).toBeLessThan(0.05);

    // A peer whose position is unknown goes silent — never loud.
    mesh.updateVolumes({ x: 0, z: 0 }, new Map());
    expect(sinks.get("peer-a")!.last).toBe(0);
  });

  it("dropPeer closes the connection and disposes the sink; leave clears all", async () => {
    const { mesh, pcs, sinks, localStream } = makeMesh();
    mesh.start(localStream as never);
    await mesh.handleVoiceState(["peer-a", "peer-b"]);
    const [pcA, pcB] = [...pcs.values()] as [FakePc, FakePc];
    pcA.emitTrack({ id: "stream-a" });

    mesh.dropPeer("peer-a");
    expect(pcA.closed).toBe(true);
    expect(sinks.get("peer-a")!.disposed).toBe(true);
    expect(mesh.peerCount).toBe(1);

    mesh.leave();
    expect(pcB.closed).toBe(true);
    expect(mesh.peerCount).toBe(0);
  });

  it("levelFor reads the sink's live voice level and defaults to silence", async () => {
    const { mesh, pcs, sinks, localStream } = makeMesh();
    mesh.start(localStream as never);
    await mesh.handleVoiceState(["peer-a"]);
    expect(mesh.levelFor("peer-a")).toBe(0); // no stream yet
    expect(mesh.levelFor("nobody")).toBe(0);

    const [pcA] = [...pcs.values()] as [FakePc];
    pcA.emitTrack({ id: "stream-a" });
    const sink = sinks.get("peer-a")!;
    // Sinks that can't measure read as silent — lips stay shut honestly.
    expect(mesh.levelFor("peer-a")).toBe(0);
    sink.getLevel = () => 0.42;
    expect(mesh.levelFor("peer-a")).toBeCloseTo(0.42);
    mesh.dropPeer("peer-a");
    expect(mesh.levelFor("peer-a")).toBe(0);
  });
});
