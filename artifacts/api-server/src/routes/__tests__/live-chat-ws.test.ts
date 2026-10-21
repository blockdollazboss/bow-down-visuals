/**
 * WebSocket tests for live chat delivery (lib/live-ws + the chat
 * registration in routes/live-chat). These run the REAL gateway on a
 * bare http server with REAL ws clients — the handshake auth, room
 * routing and broadcast path are exercised over the wire, not faked.
 * Only the db (stream lookup) is stubbed, and the token verifier is
 * injected (the production one calls Supabase, like requireAuth).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { PgDialect } from "drizzle-orm/pg-core";

const VIEWER = "00000000-0000-4000-8000-0000000000bb";
const STREAM = "22222222-2222-4222-8222-222222222222";
const STREAM2 = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({
  streams: new Map<string, Record<string, unknown>>(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const dialect = new PgDialect();
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => ({
          limit: async (_n: number) => {
            if (table !== actual.liveStreamsTable) return [];
            const { params } = dialect.sqlToQuery(cond as never);
            const row = h.streams.get(String(params[0]));
            return row ? [row] : [];
          },
        }),
      }),
    }),
  };
  return { ...actual, db };
});

import { LiveWsGateway, RoomHub } from "../../lib/live-ws";
import { registerLiveChatWs, liveChatHub } from "../live-chat";

let server: Server;
let gateway: LiveWsGateway;
let port = 0;
const clients: WebSocket[] = [];

function connect(path: string): Promise<{ ws: WebSocket; messages: any[]; closed: Promise<number> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  clients.push(ws);
  const messages: any[] = [];
  ws.on("message", (data) => {
    try {
      messages.push(JSON.parse(String(data)));
    } catch {
      /* not JSON */
    }
  });
  const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
  return Promise.resolve({ ws, messages, closed });
}

async function waitFor(fn: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 15));
  }
}

beforeAll(async () => {
  const now = new Date();
  for (const id of [STREAM, STREAM2]) {
    h.streams.set(id, {
      id,
      user_id: "00000000-0000-4000-8000-0000000000aa",
      profile_id: "11111111-1111-4111-8111-111111111111",
      title: "Live",
      status: "live",
      started_at: now,
      created_at: now,
      updated_at: now,
    });
  }
  server = createServer();
  gateway = new LiveWsGateway();
  registerLiveChatWs(gateway, {
    verifyToken: async (token: string) => (token === "good-token" ? { userId: VIEWER, email: null } : null),
  });
  gateway.attach(server);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const ws of clients) {
    try {
      ws.terminate();
    } catch {
      /* already closed */
    }
  }
  gateway.dispose();
  await new Promise((r) => server.close(r));
});

describe("chat websocket", () => {
  it("rejects a bad session token with 4401", async () => {
    const { closed } = await connect(`/api/live/${STREAM}/chat/ws?token=nope`);
    await expect(closed).resolves.toBe(4401);
  });

  it("rejects a missing stream with 4404 (after auth)", async () => {
    const { closed } = await connect(`/api/live/99999999-9999-4999-8999-999999999999/chat/ws?token=good-token`);
    await expect(closed).resolves.toBe(4404);
  });

  it("greets a signed-in viewer and delivers room broadcasts", async () => {
    const { ws, messages } = await connect(`/api/live/${STREAM}/chat/ws?token=good-token`);
    await waitFor(() => messages.length >= 1);
    expect(messages[0]).toMatchObject({ type: "hello", streamId: STREAM, streamStatus: "live" });
    // This is exactly what the POST handler does after storing a message.
    const delivered = liveChatHub.broadcast(STREAM, { type: "message", message: { id: "m1", body: "hi all" } });
    expect(delivered).toBeGreaterThanOrEqual(1);
    await waitFor(() => messages.length >= 2);
    expect(messages[1]).toMatchObject({ type: "message", message: { body: "hi all" } });
    ws.close();
  });

  it("rooms are isolated per stream", async () => {
    const a = await connect(`/api/live/${STREAM}/chat/ws?token=good-token`);
    const b = await connect(`/api/live/${STREAM2}/chat/ws?token=good-token`);
    await waitFor(() => a.messages.length >= 1 && b.messages.length >= 1);
    liveChatHub.broadcast(STREAM, { type: "message", message: { id: "only-a", body: "for A" } });
    await waitFor(() => a.messages.length >= 2);
    await new Promise((r) => setTimeout(r, 150));
    expect(b.messages.filter((m) => m.type === "message")).toHaveLength(0);
    a.ws.close();
    b.ws.close();
  });

  it("an unmatched upgrade path is refused, not parked", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live/${STREAM}/nope/ws?token=good-token`);
    clients.push(ws);
    const outcome = await new Promise<string>((resolve) => {
      ws.on("open", () => resolve("open"));
      ws.on("error", () => resolve("error"));
      setTimeout(() => resolve("timeout"), 2500);
    });
    expect(outcome).toBe("error");
  });
});

describe("RoomHub", () => {
  function fakeSocket(readyState = 1) {
    return {
      readyState,
      sent: [] as string[],
      send(data: string) {
        this.sent.push(data);
      },
      close() {},
      terminate() {},
      ping() {},
      on() {},
    };
  }

  it("broadcasts only to OPEN sockets and prunes the rest", () => {
    const hub = new RoomHub();
    const open = fakeSocket(1);
    const closed = fakeSocket(3);
    hub.join("r", open as never);
    hub.join("r", closed as never);
    expect(hub.roomSize("r")).toBe(2);
    const delivered = hub.broadcast("r", { type: "x" });
    expect(delivered).toBe(1);
    expect(open.sent).toHaveLength(1);
    expect(hub.roomSize("r")).toBe(1); // closed socket pruned
  });

  it("a socket whose send throws is pruned, not fatal", () => {
    const hub = new RoomHub();
    const bad = fakeSocket(1);
    bad.send = () => {
      throw new Error("gone");
    };
    const good = fakeSocket(1);
    hub.join("r", bad as never);
    hub.join("r", good as never);
    expect(hub.broadcast("r", { type: "x" })).toBe(1);
    expect(hub.roomSize("r")).toBe(1);
  });

  it("leave + leaveAll empty the rooms", () => {
    const hub = new RoomHub();
    const s = fakeSocket(1);
    hub.join("a", s as never);
    hub.join("b", s as never);
    hub.leaveAll(s as never);
    expect(hub.roomSize("a")).toBe(0);
    expect(hub.roomSize("b")).toBe(0);
    expect(hub.broadcast("a", { type: "x" })).toBe(0);
  });
});
