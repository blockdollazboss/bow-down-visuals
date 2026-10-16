/**
 * Stream Controller client tests — the ack law above all: buttons
 * reflect CONFIRMED state only. A press pends; a state.sync that
 * reflects the intent confirms it; silence past ~3s falls back with
 * an honest notice. Plus presence/targeting and role plumbing.
 */
import { describe, it, expect } from "vitest";
import {
  ControllerRemoteClient,
  ControllerStageClient,
  expectFor,
  type ControllerSocketLike,
  type ControllerState,
} from "./stream-controller";

class FakeSocket implements ControllerSocketLike {
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  emit(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const baseState = (over: Partial<ControllerState> = {}): ControllerState => ({
  stageId: "stage-1",
  label: "Your studio",
  live: false,
  title: "Show",
  scenes: [
    { id: "s1", name: "Main" },
    { id: "s2", name: "Close-up" },
  ],
  activeSceneId: "s1",
  previewSceneId: "s1",
  micMuted: false,
  cameraOn: true,
  recording: false,
  liveSince: null,
  ...over,
});

function remoteHarness() {
  const socket = new FakeSocket();
  let now = 1_000_000;
  const client = new ControllerRemoteClient(
    {
      getAccessToken: async () => "tok",
      socketUrl: () => "ws://test/controller?role=remote",
      openSocket: () => socket,
      now: () => now,
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => undefined,
    },
    () => undefined,
  );
  return { socket, client, advance: (ms: number) => (now += ms) };
}

async function connected(h: ReturnType<typeof remoteHarness>) {
  await h.client.start();
  h.socket.onopen?.();
  h.socket.emit({ type: "presence", stageConnected: true, stageCount: 1 });
  h.socket.emit({ type: "state.sync", state: baseState() });
}

describe("ControllerRemoteClient", () => {
  it("sends a framed command with the target stage once a studio is present", async () => {
    const h = remoteHarness();
    await connected(h);
    const id = h.client.send("scene.select", { sceneId: "s2" });
    expect(id).toBeTruthy();
    const frame = JSON.parse(h.socket.sent.at(-1)!);
    expect(frame).toMatchObject({ type: "command", command: "scene.select", args: { sceneId: "s2" }, targetStageId: "stage-1" });
  });

  it("refuses to send when no studio is connected (button has nowhere to go)", async () => {
    const h = remoteHarness();
    await h.client.start();
    h.socket.onopen?.();
    h.socket.emit({ type: "presence", stageConnected: false, stageCount: 0 });
    expect(h.client.send("mic.toggle")).toBeNull();
  });

  it("ACK: pending until a state.sync reflects the intent, then confirmed", async () => {
    const h = remoteHarness();
    await connected(h);
    h.client.send("scene.select", { sceneId: "s2" });
    expect(h.client.isPending("scene.select", "s2")).toBe(true);
    // A sync that does NOT reflect the intent does not confirm it.
    h.socket.emit({ type: "state.sync", state: baseState() });
    expect(h.client.isPending("scene.select", "s2")).toBe(true);
    // The confirming sync does.
    h.socket.emit({ type: "state.sync", state: baseState({ activeSceneId: "s2", previewSceneId: "s2" }) });
    expect(h.client.isPending("scene.select", "s2")).toBe(false);
    expect(h.client.notice).toBeNull();
  });

  it("ACK TIMEOUT: silence past ~3s drops the pending beat with an honest notice", async () => {
    const h = remoteHarness();
    await connected(h);
    h.client.send("mic.toggle");
    expect(h.client.isPending("mic.toggle")).toBe(true);
    h.advance(3100);
    // The next sync (still not reflecting the toggle) sweeps the expiry.
    h.socket.emit({ type: "state.sync", state: baseState() });
    expect(h.client.isPending("mic.toggle")).toBe(false);
    expect(h.client.notice).toMatch(/didn't go through/);
  });

  it("targets the LIVE stage when two stages report in", async () => {
    const h = remoteHarness();
    await h.client.start();
    h.socket.onopen?.();
    h.socket.emit({ type: "presence", stageConnected: true, stageCount: 2 });
    h.socket.emit({ type: "state.sync", state: baseState({ stageId: "old-tab", live: false }) });
    expect(h.client.targetStageId).toBe("old-tab");
    h.socket.emit({ type: "state.sync", state: baseState({ stageId: "live-tab", live: true }) });
    expect(h.client.targetStageId).toBe("live-tab");
    // A later non-live report does not steal the target from the live stage.
    h.socket.emit({ type: "state.sync", state: baseState({ stageId: "old-tab", live: false }) });
    expect(h.client.targetStageId).toBe("live-tab");
  });

  it("presence loss clears the mirrored state — no stale deck", async () => {
    const h = remoteHarness();
    await connected(h);
    expect(h.client.state).not.toBeNull();
    h.socket.emit({ type: "presence", stageConnected: false, stageCount: 0 });
    expect(h.client.state).toBeNull();
  });
});

describe("expectFor", () => {
  it("builds intent predicates from the press-time state", () => {
    const cur = baseState();
    expect(expectFor("mic.toggle", undefined, cur)(baseState({ micMuted: true }))).toBe(true);
    expect(expectFor("mic.toggle", undefined, cur)(baseState())).toBe(false);
    expect(expectFor("stream.start", undefined, cur)(baseState({ live: true }))).toBe(true);
    expect(expectFor("stream.end", undefined, baseState({ live: true }))(baseState())).toBe(true);
    expect(expectFor("scene.select", { sceneId: "s2" }, cur)(baseState({ activeSceneId: "s2" }))).toBe(true);
    expect(expectFor("transition.cut", undefined, cur)(baseState())).toBe(true);
  });
});

describe("ControllerStageClient", () => {
  it("executes relayed commands against the injected executor and publishes fresh state after", async () => {
    const socket = new FakeSocket();
    const executed: string[] = [];
    const stage = new ControllerStageClient(
      {
        getAccessToken: async () => "tok",
        socketUrl: () => "ws://test/controller?role=stage",
        openSocket: () => socket,
        setTimeoutFn: () => 0,
        clearTimeoutFn: () => undefined,
      },
      (command) => {
        executed.push(command);
      },
      () => baseState({ live: true }),
      () => undefined,
    );
    await stage.start();
    socket.onopen?.();
    // Connect publishes the current state once.
    expect(socket.sent.some((s) => JSON.parse(s).type === "state")).toBe(true);
    socket.sent = [];

    socket.emit({ type: "command", id: "c1", command: "stream.end", args: {} });
    await new Promise((r) => setTimeout(r, 0));
    expect(executed).toEqual(["stream.end"]);
    const published = socket.sent.map((s) => JSON.parse(s));
    expect(published).toEqual([{ type: "state", state: baseState({ live: true }) }]);
  });

  it("ignores unknown commands from the relay", async () => {
    const socket = new FakeSocket();
    const executed: string[] = [];
    const stage = new ControllerStageClient(
      {
        getAccessToken: async () => "tok",
        socketUrl: () => "ws://test/controller?role=stage",
        openSocket: () => socket,
        setTimeoutFn: () => 0,
        clearTimeoutFn: () => undefined,
      },
      (command) => {
        executed.push(command);
      },
      () => baseState(),
      () => undefined,
    );
    await stage.start();
    socket.onopen?.();
    socket.emit({ type: "command", id: "c2", command: "studio.explode", args: {} });
    await new Promise((r) => setTimeout(r, 0));
    expect(executed).toEqual([]);
  });
});
