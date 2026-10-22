/**
 * Wire tests for The World (routes/world + lib/world-room + lib/live-ws).
 * The REAL gateway runs on a bare http server with REAL ws clients —
 * handshake, guest/member admission, move fan-out, voice signaling and
 * despawn are exercised over the wire. Only token verification and
 * identity resolution are injected (production verifies via Supabase,
 * like requireAuth; identity reads the caller's creator profile).
 *
 * Also pins pickScreenContent: the hall's big screen is "live" ONLY
 * with a real live stream carrying a playable HLS URL — otherwise the
 * featured reel, never a black screen wearing a LIVE label.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { LiveWsGateway } from "../../lib/live-ws";
import { WORLD_PEER_STALE_MS } from "../../lib/world-room";
import type { WorldPalace } from "../../lib/world-palace";
import { registerWorldWs, pickScreenContent, WORLD_FEATURED_VIDEO_URL } from "../world";

const MEMBER = "00000000-0000-4000-8000-0000000000aa";
const MEMBER2 = "00000000-0000-4000-8000-0000000000bb";

let server: Server;
let gateway: LiveWsGateway;
let palace: WorldPalace;
let port = 0;
const clients: WebSocket[] = [];

interface Client {
  ws: WebSocket;
  messages: any[];
  closed: Promise<number>;
}

function connect(path: string): Client {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  clients.push(ws);
  const messages: any[] = [];
  ws.on("message", (data) => {
    try {
      messages.push(JSON.parse(data.toString()));
    } catch {
      /* non-JSON frames aren't part of this protocol */
    }
  });
  const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
  return { ws, messages, closed };
}

async function waitFor(client: Client, pred: (m: any) => boolean, ms = 3000): Promise<any> {
  const start = Date.now();
  for (;;) {
    const hit = client.messages.find(pred);
    if (hit) return hit;
    if (Date.now() - start > ms) throw new Error("timed out waiting for frame");
    await new Promise((r) => setTimeout(r, 15));
  }
}

beforeAll(async () => {
  gateway = new LiveWsGateway();
  palace = registerWorldWs(gateway, {
    verifyToken: async (token) =>
      token === "good-token"
        ? { userId: MEMBER, email: "member@example.io" }
        : token === "member-two"
          ? { userId: MEMBER2, email: "two@example.io" }
          : null,
    resolveIdentity: async (userId) => ({
      userId,
      displayName: "Hall Member",
      avatarUrl: null,
      profileSlug: "hall-member",
    }),
  });
  server = createServer();
  gateway.attach(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const ws of clients) {
    try {
      ws.terminate();
    } catch {
      /* already gone */
    }
  }
  gateway.dispose();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("WS /api/world/ws", () => {
  it("admits a guest with no token — labeled guest, look-only identity", async () => {
    const g = connect("/api/world/ws");
    const welcome = await waitFor(g, (m) => m.type === "welcome");
    expect(welcome.you.guest).toBe(true);
    expect(welcome.you.displayName).toBe("Guest");
    g.ws.close();
    await g.closed;
  });

  it("admits a member by token with their creator identity, and fans moves out", async () => {
    const a = connect("/api/world/ws?token=good-token");
    const welcomeA = await waitFor(a, (m) => m.type === "welcome");
    expect(welcomeA.you.guest).toBe(false);
    expect(welcomeA.you.displayName).toBe("Hall Member");
    expect(welcomeA.you.profileSlug).toBe("hall-member");

    const b = connect("/api/world/ws");
    const welcomeB = await waitFor(b, (m) => m.type === "welcome");
    expect(welcomeB.peers.map((p: any) => p.peerId)).toContain(welcomeA.peerId);
    await waitFor(a, (m) => m.type === "peer.join" && m.peer.peerId === welcomeB.peerId);

    /* Both members stand on the King's Plaza (the front door
     * since Open World Phase 1) — the move fans out plaza-side. */
    a.ws.send(JSON.stringify({ type: "move", x: 2.5, z: 20, rotY: 0.5 }));
    const move = await waitFor(b, (m) => m.type === "peer.move" && m.peerId === welcomeA.peerId);
    expect(move.x).toBe(2.5);
    expect(move.z).toBe(20);

    // Despawn over the wire: A's close lands as B's peer.leave.
    a.ws.close();
    await a.closed;
    await waitFor(b, (m) => m.type === "peer.leave" && m.peerId === welcomeA.peerId);
    b.ws.close();
    await b.closed;
  });

  it("relays voice signaling between two members who joined voice", async () => {
    const a = connect("/api/world/ws?token=good-token");
    const b = connect("/api/world/ws?token=member-two");
    const welcomeA = await waitFor(a, (m) => m.type === "welcome");
    const welcomeB = await waitFor(b, (m) => m.type === "welcome");

    a.ws.send(JSON.stringify({ type: "voice.join" }));
    await waitFor(a, (m) => m.type === "voice.state");
    b.ws.send(JSON.stringify({ type: "voice.join" }));
    const stateB = await waitFor(b, (m) => m.type === "voice.state");
    expect(stateB.voicePeerIds).toContain(welcomeA.peerId);

    a.ws.send(JSON.stringify({ type: "voice.signal", to: welcomeB.peerId, data: { kind: "offer", sdp: "v=0" } }));
    const signal = await waitFor(b, (m) => m.type === "voice.signal");
    expect(signal.from).toBe(welcomeA.peerId);
    expect(signal.data).toEqual({ kind: "offer", sdp: "v=0" });

    a.ws.close();
    b.ws.close();
    await Promise.all([a.closed, b.closed]);
  });

  it("a guest asking for voice is denied over the wire", async () => {
    const g = connect("/api/world/ws");
    await waitFor(g, (m) => m.type === "welcome");
    g.ws.send(JSON.stringify({ type: "voice.join" }));
    const denied = await waitFor(g, (m) => m.type === "voice.denied");
    expect(denied.reason).toBe("guests");
    g.ws.close();
    await g.closed;
  });
});

describe("pickScreenContent — the big screen never fakes live", () => {
  it("no live stream → the featured reel", () => {
    const s = pickScreenContent(null);
    expect(s.mode).toBe("featured");
    expect(s.videoUrl).toBe(WORLD_FEATURED_VIDEO_URL);
    expect(s.hlsUrl).toBeNull();
    expect(s.streamId).toBeNull();
  });

  it("a live stream with a playable HLS URL carries the screen", () => {
    const s = pickScreenContent({
      id: "stream-1",
      title: "Friday Night Live",
      creatorName: "Hall Member",
      hlsUrl: "/api/live-streams/stream-1/hls/playlist.m3u8",
    });
    expect(s.mode).toBe("live");
    expect(s.title).toBe("Friday Night Live");
    expect(s.creatorName).toBe("Hall Member");
    expect(s.hlsUrl).toContain("playlist.m3u8");
    expect(s.videoUrl).toBeNull();
  });

  it("a live stream WITHOUT playable HLS falls back to the reel — no black LIVE screen", () => {
    const s = pickScreenContent({ id: "stream-2", title: "Warming Up", creatorName: null, hlsUrl: null });
    expect(s.mode).toBe("featured");
    expect(s.videoUrl).toBe(WORLD_FEATURED_VIDEO_URL);
  });
});

describe("presence truth over the wire", () => {
  it("a guest tab's rejoin replaces its own ghost — replaced frame, 4414 close, no stacked peer", async () => {
    const first = connect("/api/world/ws?guest=wire-tab-1");
    const w1 = await waitFor(first, (m) => m.type === "welcome");
    const second = connect("/api/world/ws?guest=wire-tab-1");
    const w2 = await waitFor(second, (m) => m.type === "welcome");

    expect(w2.peerId).not.toBe(w1.peerId);
    // The ghost is NOT in the replacement's snapshot — eviction
    // ran before the second attach, so the count never stacked.
    expect(w2.peers.map((p: any) => p.peerId)).not.toContain(w1.peerId);
    await waitFor(first, (m) => m.type === "replaced");
    await expect(first.closed).resolves.toBe(4414);
    second.ws.close();
    await second.closed;
  });

  it("a member's second connection replaces the first", async () => {
    const first = connect("/api/world/ws?token=good-token");
    await waitFor(first, (m) => m.type === "welcome");
    const second = connect("/api/world/ws?token=good-token");
    await waitFor(second, (m) => m.type === "welcome");
    await waitFor(first, (m) => m.type === "replaced");
    await expect(first.closed).resolves.toBe(4414);
    second.ws.close();
    await second.closed;
  });

  it("a malformed guest param is ignored — the guest enters anonymously and replaces nobody", async () => {
    const junk = encodeURIComponent("bad id!$%");
    const g1 = connect(`/api/world/ws?guest=${junk}`);
    await waitFor(g1, (m) => m.type === "welcome");
    const g2 = connect(`/api/world/ws?guest=${junk}`);
    await waitFor(g2, (m) => m.type === "welcome");
    // If the junk had been honored as a key, g2's arrival would
    // have evicted g1 synchronously. Give it a beat to prove not.
    await new Promise((r) => setTimeout(r, 250));
    expect(g1.messages.some((m) => m.type === "replaced")).toBe(false);
    g1.ws.close();
    await g1.closed;
    g2.ws.close();
    await g2.closed;
  });

  it("a frame-silent client is reaped by the sweep even though its socket stays open", async () => {
    const frozen = connect("/api/world/ws?guest=wire-frozen-1");
    const wf = await waitFor(frozen, (m) => m.type === "welcome");
    const watcher = connect("/api/world/ws");
    const ww = await waitFor(watcher, (m) => m.type === "welcome");
    expect(ww.peers.map((p: any) => p.peerId)).toContain(wf.peerId);

    // The frozen client now sends NOTHING ever again. Its socket
    // stays open — the ws library even answers protocol pings for
    // it, the same trick the hosting router plays for a dead
    // browser. Only frame silence can tell the truth, so drive
    // the palace sweep with the clock advanced past the window
    // (the registered 15 s tick runs this same method live).
    const reaped = palace.sweepStalePeers(Date.now() + WORLD_PEER_STALE_MS + 1_000);
    expect(reaped).toBeGreaterThanOrEqual(1);
    await waitFor(watcher, (m) => m.type === "peer.leave" && m.peerId === wf.peerId);
    await expect(frozen.closed).resolves.toBe(1006); // terminated — abnormal closure
    try {
      watcher.ws.close();
    } catch {
      /* the same sweep may have reaped the watcher too — it was
       * equally silent under the advanced clock */
    }
    await watcher.closed;
  });
});
