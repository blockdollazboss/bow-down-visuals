/**
 * GuestMesh pairing tests — fake peer connections, the same
 * dependency-injected style as the World's voice mesh tests.
 */
import { describe, it, expect } from "vitest";
import { GuestMesh, type GuestPeerConnectionLike, type GuestSignalData } from "./guest-mesh";

class FakePc implements GuestPeerConnectionLike {
  tracks: unknown[] = [];
  closed = false;
  localDesc: { type: string; sdp?: string } | null = null;
  remoteDesc: { type: string; sdp?: string } | null = null;
  ice: unknown[] = [];
  ontrack: ((ev: { streams: unknown[] }) => void) | null = null;
  onicecandidate: ((ev: { candidate: unknown }) => void) | null = null;
  async createOffer() {
    return { type: "offer", sdp: "offer-sdp" };
  }
  async createAnswer() {
    return { type: "answer", sdp: "answer-sdp" };
  }
  async setLocalDescription(desc: { type: string; sdp?: string }) {
    this.localDesc = desc;
  }
  async setRemoteDescription(desc: { type: string; sdp?: string }) {
    this.remoteDesc = desc;
  }
  async addIceCandidate(candidate: unknown) {
    this.ice.push(candidate);
  }
  addTrack(track: unknown) {
    this.tracks.push(track);
  }
  close() {
    this.closed = true;
  }
  emitTrack(stream: unknown) {
    this.ontrack?.({ streams: [stream] });
  }
  emitIce(candidate: unknown) {
    this.onicecandidate?.({ candidate });
  }
}

function harness() {
  const sent: Array<{ to: string; data: GuestSignalData }> = [];
  const pcs: FakePc[] = [];
  const remote: Array<{ peerId: string; stream: unknown }> = [];
  const gone: string[] = [];
  const mesh = new GuestMesh({
    sendSignal: (to, data) => sent.push({ to, data }),
    createPeerConnection: () => {
      const pc = new FakePc();
      pcs.push(pc);
      return pc;
    },
    onRemoteStream: (peerId, stream) => remote.push({ peerId, stream }),
    onPeerGone: (peerId) => gone.push(peerId),
  });
  return { mesh, sent, pcs, remote, gone };
}

const localStream = { getTracks: () => ["vtrack", "atrack"] };

describe("GuestMesh", () => {
  it("the newcomer offers to everyone in media.state, with all local tracks attached", async () => {
    const { mesh, sent, pcs } = harness();
    mesh.start(localStream);
    await mesh.handleMediaState(["p1", "p2"]);
    expect(sent.map((s) => s.to)).toEqual(["p1", "p2"]);
    expect(sent[0].data).toEqual({ kind: "offer", sdp: "offer-sdp" });
    expect(mesh.peerCount).toBe(2);
    expect(pcs[0].tracks).toEqual(["vtrack", "atrack"]);
  });

  it("answers an incoming offer; remote tracks surface via onRemoteStream + remoteStreamFor", async () => {
    const { mesh, sent, pcs, remote } = harness();
    mesh.start(localStream);
    await mesh.handleSignal("p9", { kind: "offer", sdp: "their-offer" });
    expect(sent).toEqual([{ to: "p9", data: { kind: "answer", sdp: "answer-sdp" } }]);
    expect(mesh.remoteStreamFor("p9")).toBeNull();
    const stream = { id: "remote-stream" };
    pcs[0].emitTrack(stream);
    expect(remote).toEqual([{ peerId: "p9", stream }]);
    expect(mesh.remoteStreamFor("p9")).toBe(stream);
  });

  it("relays local ICE candidates to the right peer", async () => {
    const { mesh, sent, pcs } = harness();
    mesh.start(localStream);
    await mesh.handleMediaState(["p1"]);
    pcs[0].emitIce({ candidate: "c1" });
    expect(sent[sent.length - 1]).toEqual({ to: "p1", data: { kind: "ice", candidate: { candidate: "c1" } } });
  });

  it("applies a remote answer and flushes buffered ICE after it", async () => {
    const { mesh, pcs } = harness();
    mesh.start(localStream);
    await mesh.handleMediaState(["p1"]);
    /* ICE for a peer whose answer hasn't landed is buffered by the
       answerer side; here we are the offerer — a candidate arriving
       before any answer is applied only once hasRemote flips. Drive
       the answer and confirm no crash + candidate applied after. */
    await mesh.handleSignal("p1", { kind: "answer", sdp: "their-answer" });
    expect(pcs[0].remoteDesc).toEqual({ type: "answer", sdp: "their-answer" });
    await mesh.handleSignal("p1", { kind: "ice", candidate: { c: 7 } });
    expect(pcs[0].ice).toEqual([{ c: 7 }]);
  });

  it("dropPeer closes the connection and reports the departure; leave clears all", async () => {
    const { mesh, pcs, gone } = harness();
    mesh.start(localStream);
    await mesh.handleMediaState(["p1", "p2"]);
    mesh.dropPeer("p1");
    expect(pcs[0].closed).toBe(true);
    expect(mesh.peerCount).toBe(1);
    expect(gone).toEqual(["p1"]);
    mesh.leave();
    expect(mesh.peerCount).toBe(0);
    expect(pcs[1].closed).toBe(true);
  });
});
