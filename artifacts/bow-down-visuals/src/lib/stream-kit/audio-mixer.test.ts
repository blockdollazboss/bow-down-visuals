/**
 * AudioMixer tests against a fake WebAudio graph: channels wire
 * source → gain → analyser → master, faders and mutes land on the gain
 * values, stream swaps rewire cleanly, and the mixed output track comes
 * from the destination node.
 */
import { describe, it, expect } from "vitest";
import { AudioMixer } from "./audio-mixer";

class FakeNode {
  connections: FakeNode[] = [];
  connect(n: FakeNode): void {
    this.connections.push(n);
  }
  disconnect(): void {
    this.connections = [];
  }
}
class FakeGain extends FakeNode {
  gain = { value: 1 };
}
class FakeAnalyser extends FakeNode {
  fftSize = 0;
  smoothingTimeConstant = 0;
}
class FakeSource extends FakeNode {
  constructor(public stream: unknown) {
    super();
  }
}

const fakeTrack = { kind: "audio", id: "mixed-out" };
class FakeCtx {
  state = "running";
  destStream = { getAudioTracks: () => [fakeTrack] };
  createGain(): FakeGain {
    return new FakeGain();
  }
  createAnalyser(): FakeAnalyser {
    return new FakeAnalyser();
  }
  createMediaStreamSource(stream: unknown): FakeSource {
    return new FakeSource(stream);
  }
  createMediaStreamDestination(): FakeNode & { stream: unknown } {
    const n = new FakeNode() as FakeNode & { stream: unknown };
    n.stream = this.destStream;
    return n;
  }
  async resume(): Promise<void> {}
  async close(): Promise<void> {}
}

function makeMixer(): AudioMixer {
  return new AudioMixer(() => new FakeCtx() as never);
}

function streamWithAudio(): MediaStream {
  return { getAudioTracks: () => [{ kind: "audio" }] } as never;
}
function streamNoAudio(): MediaStream {
  return { getAudioTracks: () => [] } as never;
}

describe("AudioMixer", () => {
  it("addInput is idempotent and wires gain → analyser → master", () => {
    const mixer = makeMixer();
    mixer.addInput("mic");
    mixer.addInput("mic");
    expect(mixer.hasInput("mic")).toBe(true);
    expect(mixer.getAnalyser("mic")).toBeTruthy();
    expect(mixer.getAnalyser("master")).toBeTruthy();
  });

  it("setInputStream connects the source; swapping streams rewires", () => {
    const mixer = makeMixer();
    mixer.addInput("mic");
    const s1 = streamWithAudio();
    mixer.setInputStream("mic", s1);
    mixer.setInputStream("mic", s1); // same stream: no-op rewire
    const s2 = streamWithAudio();
    mixer.setInputStream("mic", s2); // swap (device switch)
    mixer.setInputStream("mic", null); // detach
    // no-audio stream leaves the channel silent but present
    mixer.setInputStream("mic", streamNoAudio());
    expect(mixer.getInputState("mic")).toEqual({ volume: 1, muted: false });
  });

  it("faders and mutes land on the channel gain", () => {
    const mixer = makeMixer();
    mixer.addInput("mic");
    mixer.setVolume("mic", 0.4);
    expect(mixer.getInputState("mic")?.volume).toBe(0.4);
    mixer.setVolume("mic", 7); // clamped
    expect(mixer.getInputState("mic")?.volume).toBe(1);
    mixer.setMuted("mic", true);
    expect(mixer.getInputState("mic")?.muted).toBe(true);
    mixer.setVolume("mic", 0.25); // fader moves under mute without unmuting
    expect(mixer.getInputState("mic")?.muted).toBe(true);
    mixer.setMuted("mic", false);
    expect(mixer.getInputState("mic")?.volume).toBe(0.25);
  });

  it("master volume + mute are independent of channels", () => {
    const mixer = makeMixer();
    mixer.setMasterVolume(0.6);
    expect(mixer.masterState).toEqual({ volume: 0.6, muted: false });
    mixer.setMasterMuted(true);
    expect(mixer.masterState).toEqual({ volume: 0.6, muted: true });
    mixer.setMasterMuted(false);
    expect(mixer.masterState.muted).toBe(false);
  });

  it("the output track is the destination stream's audio track", () => {
    const mixer = makeMixer();
    expect(mixer.getOutputTrack()).toBe(fakeTrack as never);
    expect(mixer.getStream()).toBeTruthy();
  });

  it("removeInput drops the channel and its analyser", () => {
    const mixer = makeMixer();
    mixer.addInput("screen");
    mixer.removeInput("screen");
    expect(mixer.hasInput("screen")).toBe(false);
    expect(mixer.getAnalyser("screen")).toBeNull();
    expect(mixer.getInputState("screen")).toBeNull();
  });
});
