/**
 * Stream Controller relay tests.
 *
 * Unit: ControlRelay with fake sockets — routing, presence, role
 * enforcement, target filtering, and the ownership rule (a remote in
 * one account's room can NEVER reach another account's stage).
 * Integration: the real gateway + endpoint with real ws clients —
 * same proofs over the wire, plus the auth/role handshake codes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { WebSocket } from "ws";
import { ControlRelay, controlRoomId } from "../../lib/control-relay";
import { LiveWsGateway, RoomHub, type WsClientSocket } from "../../lib/live-ws";
import { registerLiveControlWs } from "../live-control";

/* ------------------------------------------------------------ fakes */

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  terminate(): void {
    this.readyState = 3;
  }
  frames(): any[] {
    return this.sent.map((s) => JSON.parse(s));
  }
  clear(): void {
    this.sent = [];
  }
}

const asSock = (s: FakeSocket) => s as unknown as WsClientSocket;
const state = (stageId: string, live = false) => ({
  stageId,
  label: "Your studio",
  live,
  title: "Show",
  scenes: [{ id: "s1", name: "Main" }],
  activeSceneId: "s1",
  previewSceneId: "s1",
  micMuted: false,
  cameraOn: true,
  recording: false,
  liveSince: null,
});

/* ------------------------------------------------------------ unit */

describe("ControlRelay", () => {
  it("presence follows stage join/leave", () => {
    const relay = new ControlRelay(new RoomHub());
    const room = controlRoomId("u1");
    const remote = new FakeSocket();
    relay.join(room, asSock(remote), "remote");
    expect(remote.frames().at(-1)).toMatchObject({ type: "presence", stageConnected: false, stageCount: 0 });

    const stage = new FakeSocket();
    relay.join(room, asSock(stage), "stage");
    expect(remote.frames().at(-1)).toMatchObject({ type: "presence", stageConnected: true, stageCount: 1 });

    relay.leave(room, asSock(stage));
    expect(remote.frames().at(-1)).toMatchObject({ type: "presence", stageConnected: false, stageCount: 0 });
  });

  it("routes remote commands to the room's stage and stage state back as state.sync", () => {
    const relay = new ControlRelay(new RoomHub());
    const room = controlRoomId("u1");
    const remote = new FakeSocket();
    const stage = new FakeSocket();
    relay.join(room, asSock(remote), "remote");
    relay.join(room, asSock(stage), "stage");
    remote.clear();
    stage.clear();

    const ok = relay.handleFrame(room, asSock(remote), JSON.stringify({ type: "command", id: "c1", command: "scene.select", args: { sceneId: "s1" } }));
    expect(ok).toBe(true);
    expect(stage.frames()).toEqual([{ type: "command", id: "c1", command: "scene.select", args: { sceneId: "s1" } }]);

    const okState = relay.handleFrame(room, asSock(stage), JSON.stringify({ type: "state", state: state("stage-1", true) }));
    expect(okState).toBe(true);
    expect(remote.frames()).toEqual([{ type: "state.sync", state: state("stage-1", true) }]);
  });

  it("OWNERSHIP: a remote in another account's room reaches NOTHING", () => {
    const relay = new ControlRelay(new RoomHub());
    const roomA = controlRoomId("user-a");
    const roomB = controlRoomId("user-b");
    const stageA = new FakeSocket();
    const remoteB = new FakeSocket();
    relay.join(roomA, asSock(stageA), "stage");
    relay.join(roomB, asSock(remoteB), "remote");
    stageA.clear();

    const ok = relay.handleFrame(roomB, asSock(remoteB), JSON.stringify({ type: "command", id: "x", command: "stream.end", args: {} }));
    expect(ok).toBe(false);
    expect(stageA.sent).toEqual([]);
  });

  it("targets a specific stage once its id is known; untargeted commands reach all of the user's stages", () => {
    const relay = new ControlRelay(new RoomHub());
    const room = controlRoomId("u1");
    const remote = new FakeSocket();
    const stage1 = new FakeSocket();
    const stage2 = new FakeSocket();
    relay.join(room, asSock(remote), "remote");
    relay.join(room, asSock(stage1), "stage");
    relay.join(room, asSock(stage2), "stage");
    relay.handleFrame(room, asSock(stage1), JSON.stringify({ type: "state", state: state("stage-1") }));
    relay.handleFrame(room, asSock(stage2), JSON.stringify({ type: "state", state: state("stage-2") }));
    stage1.clear();
    stage2.clear();

    relay.handleFrame(room, asSock(remote), JSON.stringify({ type: "command", id: "t1", command: "mic.toggle", args: {}, targetStageId: "stage-2" }));
    expect(stage1.sent).toEqual([]);
    expect(stage2.frames()).toHaveLength(1);

    stage1.clear();
    stage2.clear();
    relay.handleFrame(room, asSock(remote), JSON.stringify({ type: "command", id: "t2", command: "mic.toggle", args: {} }));
    expect(stage1.frames()).toHaveLength(1);
    expect(stage2.frames()).toHaveLength(1);
  });

  it("enforces roles and the command whitelist; malformed frames dropped", () => {
    const relay = new ControlRelay(new RoomHub());
    const room = controlRoomId("u1");
    const remote = new FakeSocket();
    const stage = new FakeSocket();
    relay.join(room, asSock(remote), "remote");
    relay.join(room, asSock(stage), "stage");

    // Stage issuing commands, remote publishing state: both off-role.
    expect(relay.handleFrame(room, asSock(stage), JSON.stringify({ type: "command", command: "stream.end" }))).toBe(false);
    expect(relay.handleFrame(room, asSock(remote), JSON.stringify({ type: "state", state: state("s") }))).toBe(false);
    // Unknown command + garbage.
    expect(relay.handleFrame(room, asSock(remote), JSON.stringify({ type: "command", command: "studio.explode" }))).toBe(false);
    expect(relay.handleFrame(room, asSock(remote), "not json")).toBe(false);
    expect(relay.handleFrame(room, asSock(remote), JSON.stringify({ type: "state", state: {} }))).toBe(false);
  });
});

/* ------------------------------------------------------ integration */

const verify = async (token: string) => {
  if (token === "tok-a") return { userId: "user-a", email: "a@x.test" };
  if (token === "tok-b") return { userId: "user-b", email: "b@x.test" };
  return null;
};

let server: http.Server;
let base = "";

function connect(path: string): Promise<{ ws: WebSocket; frames: any[]; first: Promise<any> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}${path}`);
    const frames: any[] = [];
    let resolveFirst: (v: any) => void = () => undefined;
    const first = new Promise<any>((r) => {
      resolveFirst = r;
    });
    ws.on("message", (data) => {
      const parsed = JSON.parse(data.toString());
      frames.push(parsed);
      resolveFirst(parsed);
    });
    ws.on("open", () => resolve({ ws, frames, first }));
    ws.on("error", reject);
  });
}

function closeCode(path: string): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}${path}`);
    ws.on("close", (code) => resolve(code));
    ws.on("error", () => undefined);
  });
}

async function waitFor(frames: any[], pred: (f: any) => boolean, ms = 1500): Promise<any> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = frames.find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("frame not received in time");
}

describe("live controller endpoint (real sockets)", () => {
  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    const gateway = new LiveWsGateway();
    registerLiveControlWs(gateway, { verifyToken: verify });
    gateway.attach(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
    void base;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("rejects a bad token with 4401 and a missing role with 4400", async () => {
    await expect(closeCode(`/api/live/controller/ws?role=remote&token=nope`)).resolves.toBe(4401);
    await expect(closeCode(`/api/live/controller/ws?token=tok-a`)).resolves.toBe(4400);
  });

  it("relays command remote→stage and state stage→remote for the same account", async () => {
    const stage = await connect(`/api/live/controller/ws?role=stage&token=tok-a`);
    const remote = await connect(`/api/live/controller/ws?role=remote&token=tok-a`);
    try {
      const presence = await waitFor(remote.frames, (f) => f.type === "presence" && f.stageConnected === true);
      expect(presence.stageCount).toBe(1);

      remote.ws.send(JSON.stringify({ type: "command", id: "c9", command: "stream.start", args: {} }));
      const cmd = await waitFor(stage.frames, (f) => f.type === "command");
      expect(cmd).toMatchObject({ id: "c9", command: "stream.start" });

      stage.ws.send(JSON.stringify({ type: "state", state: state("stage-a", true) }));
      const sync = await waitFor(remote.frames, (f) => f.type === "state.sync");
      expect(sync.state).toMatchObject({ stageId: "stage-a", live: true });
    } finally {
      stage.ws.close();
      remote.ws.close();
    }
  });

  it("OWNERSHIP over the wire: user B's remote cannot drive user A's stage", async () => {
    const stageA = await connect(`/api/live/controller/ws?role=stage&token=tok-a`);
    const remoteB = await connect(`/api/live/controller/ws?role=remote&token=tok-b`);
    try {
      // B's remote is told — truthfully — that no studio of B's is open.
      const presenceB = await waitFor(remoteB.frames, (f) => f.type === "presence");
      expect(presenceB.stageConnected).toBe(false);

      remoteB.ws.send(JSON.stringify({ type: "command", id: "evil", command: "stream.end", args: {} }));
      await new Promise((r) => setTimeout(r, 200));
      expect(stageA.frames.filter((f) => f.type === "command")).toEqual([]);
    } finally {
      stageA.ws.close();
      remoteB.ws.close();
    }
  });
});
