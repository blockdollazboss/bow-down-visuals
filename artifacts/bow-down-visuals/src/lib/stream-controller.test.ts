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
  micReadout,
  HANDSHAKE_TIMEOUT_MS,
  type ControllerClientDeps,
  type ControllerSocketLike,
  type ControllerState,
} from "./stream-controller";

/** Deterministic timers: clients under test never touch real clocks. */
class TimerWheel {
  private seq = 0;
  private timers = new Map<number, { fn: () => void; ms: number }>();
  set = (fn: () => void, ms: number): number => {
    const id = ++this.seq;
    this.timers.set(id, { fn, ms });
    return id;
  };
  clear = (id: unknown): void => {
    this.timers.delete(id as number);
  };
  /** Fire every pending timer armed with exactly this delay. */
  fireByMs(ms: number): void {
    const due = [...this.timers.entries()].filter(([, t]) => t.ms === ms);
    for (const [id, t] of due) {
      this.timers.delete(id);
      t.fn();
    }
  }
  delays(): number[] {
    return [...this.timers.values()].map((t) => t.ms);
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

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

describe("micReadout — the deck never defaults to Live", () => {
  it("no state yet reads off", () => {
    expect(micReadout(null)).toBe("off");
  });

  it("a state that never claims a mic reads off (older snapshots omit micPresent)", () => {
    expect(micReadout(baseState())).toBe("off");
    expect(micReadout(baseState({ micMuted: false }))).toBe("off");
  });

  it("mic absent reads off even when the mute flag is false", () => {
    expect(micReadout(baseState({ micPresent: false, micMuted: false }))).toBe("off");
  });

  it("only a real mic reads live or muted", () => {
    expect(micReadout(baseState({ micPresent: true, micMuted: false }))).toBe("live");
    expect(micReadout(baseState({ micPresent: true, micMuted: true }))).toBe("muted");
  });
});

describe("connect failures climb the ladder (no silent dead ends)", () => {
  function stageHarness(over: Partial<ControllerClientDeps> = {}) {
    const wheel = new TimerWheel();
    const sockets: FakeSocket[] = [];
    const deps: ControllerClientDeps = {
      getAccessToken: async () => "tok",
      socketUrl: () => "ws://test/controller?role=stage",
      openSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      setTimeoutFn: wheel.set,
      clearTimeoutFn: wheel.clear,
      ...over,
    };
    const client = new ControllerStageClient(deps, () => undefined, () => baseState(), () => undefined);
    return { wheel, sockets, client };
  }

  it("stage: a rejected token schedules a reconnect instead of exiting silently", async () => {
    const h = stageHarness({ getAccessToken: async () => null });
    await h.client.start();
    expect(h.sockets).toHaveLength(0);
    expect(h.wheel.delays()).toContain(1500);
    expect(h.client.linkUnavailable).toBe(false);
    // Second failure climbs to the next rung.
    h.wheel.fireByMs(1500);
    await flush();
    expect(h.wheel.delays()).toContain(4000);
    expect(h.client.linkUnavailable).toBe(false);
    // Third failure exhausts the ladder: the link admits unavailability.
    h.wheel.fireByMs(4000);
    await flush();
    expect(h.wheel.delays()).toContain(8000);
    expect(h.client.linkUnavailable).toBe(true);
  });

  it("stage: an openSocket throw schedules a reconnect", async () => {
    const h = stageHarness({
      openSocket: () => {
        throw new Error("no socket for you");
      },
    });
    await h.client.start();
    expect(h.wheel.delays()).toContain(1500);
    expect(h.client.linkUnavailable).toBe(false);
  });

  it("stage: a stalled handshake is retired at the deadline and retried", async () => {
    const h = stageHarness();
    await h.client.start();
    expect(h.sockets).toHaveLength(1);
    // The socket never opens; only the handshake deadline is pending.
    expect(h.wheel.delays()).toEqual([HANDSHAKE_TIMEOUT_MS]);
    h.wheel.fireByMs(HANDSHAKE_TIMEOUT_MS);
    // Retired by hand: its close handler is detached, and a retry is armed.
    expect(h.sockets[0].onclose).toBeNull();
    expect(h.wheel.delays()).toContain(1500);
    h.wheel.fireByMs(1500);
    await flush();
    expect(h.sockets).toHaveLength(2);
  });

  it("stage: repeated drops exhaust the ladder, and a later open recovers", async () => {
    const h = stageHarness();
    await h.client.start();
    h.sockets[0].onopen?.();
    expect(h.client.linkUnavailable).toBe(false);
    h.sockets[0].close(); // drop 1 → rung 1500
    h.wheel.fireByMs(1500);
    await flush();
    h.sockets[1].close(); // drop 2 → rung 4000
    h.wheel.fireByMs(4000);
    await flush();
    h.sockets[2].close(); // drop 3 → ladder exhausted
    expect(h.client.linkUnavailable).toBe(true);
    h.wheel.fireByMs(8000);
    await flush();
    h.sockets[3].onopen?.();
    expect(h.client.socketUp).toBe(true);
    expect(h.client.linkUnavailable).toBe(false);
  });

  it("remote: a rejected token climbs the ladder too", async () => {
    const wheel = new TimerWheel();
    const client = new ControllerRemoteClient(
      {
        getAccessToken: async () => null,
        socketUrl: () => "ws://test/controller?role=remote",
        openSocket: () => new FakeSocket(),
        setTimeoutFn: wheel.set,
        clearTimeoutFn: wheel.clear,
      },
      () => undefined,
    );
    await client.start();
    expect(wheel.delays()).toContain(1500);
    wheel.fireByMs(1500);
    await flush();
    wheel.fireByMs(4000);
    await flush();
    expect(client.linkUnavailable).toBe(true);
  });

  it("remote: an openSocket throw schedules a reconnect", async () => {
    const wheel = new TimerWheel();
    const client = new ControllerRemoteClient(
      {
        getAccessToken: async () => "tok",
        socketUrl: () => "ws://test/controller?role=remote",
        openSocket: () => {
          throw new Error("no socket for you");
        },
        setTimeoutFn: wheel.set,
        clearTimeoutFn: wheel.clear,
      },
      () => undefined,
    );
    await client.start();
    expect(wheel.delays()).toContain(1500);
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
