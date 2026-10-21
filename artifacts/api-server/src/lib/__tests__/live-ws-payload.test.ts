/**
 * Flag S-1 (Lane F perf audit): the shared WS gateway must cap message
 * payloads at the gateway (WS_MAX_PAYLOAD_BYTES), not the ws library's
 * 100 MiB default. Real gateway, real sockets: an oversized frame is
 * rejected by the library (close 1009) BEFORE any handler sees it, the
 * process survives, and honest-sized frames flow normally.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { LiveWsGateway, WS_MAX_PAYLOAD_BYTES } from "../live-ws";

let server: Server;
let gateway: LiveWsGateway;
let port = 0;
const received: string[] = [];
const clients: WebSocket[] = [];

function connect(): { ws: WebSocket; closed: Promise<number> } {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/echo`);
  clients.push(ws);
  const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
  return { ws, closed };
}
const open = (ws: WebSocket) => new Promise<void>((resolve) => ws.on("open", () => resolve()));

beforeAll(async () => {
  server = createServer();
  gateway = new LiveWsGateway();
  gateway.register("/echo", ({ socket }) => {
    socket.on("message", (data) => {
      received.push(String(data));
      socket.send("ok");
    });
  });
  gateway.attach(server);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const ws of clients) {
    try { ws.terminate(); } catch { /* already closed */ }
  }
  gateway.dispose();
  await new Promise((r) => server.close(r));
});

describe("LiveWsGateway payload cap (S-1)", () => {
  it("the cap is a sane KB-range ceiling, not the 100 MiB library default", () => {
    expect(WS_MAX_PAYLOAD_BYTES).toBe(64 * 1024);
    expect(WS_MAX_PAYLOAD_BYTES).toBeLessThan(1024 * 1024);
  });

  it("an honest-sized frame reaches the handler and gets its reply", async () => {
    const { ws } = connect();
    await open(ws);
    const reply = new Promise<string>((resolve) => ws.on("message", (d) => resolve(String(d))));
    ws.send(JSON.stringify({ type: "say", body: "hello" }));
    await expect(reply).resolves.toBe("ok");
    expect(received.some((m) => m.includes("hello"))).toBe(true);
    ws.close();
  });

  it("an oversized frame is rejected at the gateway — handler never sees it, socket closes 1009", async () => {
    const { ws, closed } = connect();
    await open(ws);
    const before = received.length;
    ws.send("x".repeat(WS_MAX_PAYLOAD_BYTES * 4));
    await expect(closed).resolves.toBe(1009);
    expect(received.length).toBe(before);
  });
});
