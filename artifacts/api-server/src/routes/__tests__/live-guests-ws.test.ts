/**
 * WebSocket tests for the Go Live backstage (routes/live-guests
 * registration on the shared gateway). Real gateway, real ws clients,
 * fake db + injected token verifier (the production verifier calls
 * Supabase, like requireAuth). Covers: host door (owner only), guest
 * door (session + invite revocation checked at connect), presence,
 * media-mesh signaling rules, and the revoke/remove socket kill.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-0000000000bb";
const STREAM = "22222222-2222-4222-8222-222222222222";
const INVITE = "66666666-6666-4666-8666-666666666666";
const SESSION = "77777777-7777-4777-8777-777777777777";
const GUEST_TOKEN = "guest-session-token-for-tests-0123456789";

const h = vi.hoisted(() => ({
  streams: new Map<string, Record<string, unknown>>(),
  invites: [] as Array<Record<string, unknown>>,
  sessions: [] as Array<Record<string, unknown>>,
  profiles: [] as Array<Record<string, unknown>>,
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
  const tableOf = (table: unknown) =>
    table === actual.liveStreamsTable
      ? [...h.streams.values()]
      : table === actual.liveGuestInvitesTable
        ? h.invites
        : table === actual.liveGuestSessionsTable
          ? h.sessions
          : table === actual.creatorProfilesTable
            ? h.profiles
            : [];
  const db = {
    select: (fields?: Record<string, { name: string }>) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => ({
          limit: async (_n: number) => {
            const { sql, params } = dialect.sqlToQuery(cond as never);
            const eqs: Array<[string, unknown]> = [];
            for (const m of sql.matchAll(/"(\w+)" = \$(\d+)/g)) eqs.push([m[1], params[Number(m[2]) - 1]]);
            let rows = tableOf(table).filter((r) => eqs.every(([c, v]) => String(r[c] ?? "") === String(v ?? "")));
            if (fields) {
              rows = rows.map((r) => {
                const out: Record<string, unknown> = {};
                for (const [key, col] of Object.entries(fields)) out[key] = r[col.name] ?? null;
                return out;
              });
            }
            return rows.map((r) => ({ ...r }));
          },
        }),
      }),
    }),
  };
  return { ...actual, db };
});

import { LiveWsGateway } from "../../lib/live-ws";
import { registerLiveBackstageWs } from "../live-guests";
import { getBackstageRoom, guestTokenLookup } from "../../lib/live-backstage";

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
      /* non-JSON */
    }
  });
  const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
  return new Promise((resolve, reject) => {
    ws.on("open", () => resolve({ ws, messages, closed }));
    ws.on("error", reject);
    setTimeout(() => resolve({ ws, messages, closed }), 1500);
  });
}

async function waitFor(fn: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

const verifyToken = async (token: string) =>
  token === "host-token"
    ? { userId: OWNER, email: null }
    : token === "other-token"
      ? { userId: OTHER, email: null }
      : null;

beforeAll(async () => {
  server = createServer();
  gateway = new LiveWsGateway();
  registerLiveBackstageWs(gateway, { verifyToken });
  gateway.attach(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const ws of clients) {
    try {
      ws.terminate();
    } catch {
      /* gone */
    }
  }
  gateway.dispose();
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  h.streams.clear();
  h.invites = [
    { id: INVITE, stream_id: STREAM, host_user_id: OWNER, revoked_at: null, expires_at: null, created_at: new Date() },
  ];
  h.sessions = [
    {
      id: SESSION,
      invite_id: INVITE,
      stream_id: STREAM,
      display_name: "Casey",
      session_lookup: guestTokenLookup(GUEST_TOKEN),
      state: "backstage",
      joined_at: new Date(),
    },
  ];
  h.profiles = [{ user_id: OWNER, display_name: "Nova Reign", slug: "nova-reign", avatar_url: null }];
  h.streams.set(STREAM, {
    id: STREAM,
    user_id: OWNER,
    profile_id: "11111111-1111-4111-8111-111111111111",
    title: "Friday Night Live",
    status: "live",
    started_at: new Date(),
    ended_at: null,
  });
});

describe("backstage WS doors", () => {
  it("lets the host in as host, and a guest in as an honest guest", async () => {
    const host = await connect(`/api/live/${STREAM}/backstage/ws?token=host-token`);
    await waitFor(() => host.messages.some((m) => m.type === "welcome"));
    const hostWelcome = host.messages.find((m) => m.type === "welcome");
    expect(hostWelcome.you.kind).toBe("host");
    expect(hostWelcome.you.guest).toBe(false);

    const guest = await connect(`/api/live/${STREAM}/backstage/ws?guest=${GUEST_TOKEN}`);
    await waitFor(() => guest.messages.some((m) => m.type === "welcome"));
    const guestWelcome = guest.messages.find((m) => m.type === "welcome");
    expect(guestWelcome.you.kind).toBe("guest");
    expect(guestWelcome.you.guest).toBe(true);
    expect(guestWelcome.you.guestState).toBe("backstage");
    /* the host sees the guest arrive, labeled a guest */
    await waitFor(() => host.messages.some((m) => m.type === "peer.join" && m.peer.guest === true));
    host.ws.close();
    guest.ws.close();
  });

  it("refuses a signed-in non-owner (4403) and the tokenless (4401)", async () => {
    const other = await connect(`/api/live/${STREAM}/backstage/ws?token=other-token`);
    expect(await other.closed).toBe(4403);
    const anon = await connect(`/api/live/${STREAM}/backstage/ws`);
    expect(await anon.closed).toBe(4401);
  });

  it("refuses a guest whose invite was revoked, and a removed guest", async () => {
    h.invites[0].revoked_at = new Date();
    const revoked = await connect(`/api/live/${STREAM}/backstage/ws?guest=${GUEST_TOKEN}`);
    expect(await revoked.closed).toBe(4401);
    h.invites[0].revoked_at = null;
    h.sessions[0].state = "removed";
    const removed = await connect(`/api/live/${STREAM}/backstage/ws?guest=${GUEST_TOKEN}`);
    expect(await removed.closed).toBe(4401);
  });
});

describe("backstage media mesh", () => {
  it("relays signals only between media-joined peers", async () => {
    const host = await connect(`/api/live/${STREAM}/backstage/ws?token=host-token`);
    const guest = await connect(`/api/live/${STREAM}/backstage/ws?guest=${GUEST_TOKEN}`);
    await waitFor(() => guest.messages.some((m) => m.type === "welcome"));
    const guestPeerId = guest.messages.find((m) => m.type === "welcome").peerId;
    const hostPeerId = host.messages.find((m) => m.type === "welcome")?.peerId;

    /* guest signals before joining media: dropped */
    guest.ws.send(JSON.stringify({ type: "media.signal", to: hostPeerId, data: { kind: "offer", sdp: "early" } }));
    await new Promise((r) => setTimeout(r, 200));
    expect(host.messages.some((m) => m.type === "media.signal")).toBe(false);

    host.ws.send(JSON.stringify({ type: "media.join" }));
    guest.ws.send(JSON.stringify({ type: "media.join" }));
    await waitFor(() => guest.messages.some((m) => m.type === "media.state"));
    const state = guest.messages.find((m) => m.type === "media.state");
    expect(state.mediaPeerIds).toContain(hostPeerId);

    guest.ws.send(JSON.stringify({ type: "media.signal", to: hostPeerId, data: { kind: "offer", sdp: "sdp-1" } }));
    await waitFor(() => host.messages.some((m) => m.type === "media.signal"));
    const relayed = host.messages.find((m) => m.type === "media.signal");
    expect(relayed.from).toBe(guestPeerId);
    expect(relayed.data).toEqual({ kind: "offer", sdp: "sdp-1" });
    host.ws.close();
    guest.ws.close();
  });

  it("host state changes reach the guest (peer.state), and removal kills the socket", async () => {
    const guest = await connect(`/api/live/${STREAM}/backstage/ws?guest=${GUEST_TOKEN}`);
    await waitFor(() => guest.messages.some((m) => m.type === "welcome"));
    const room = getBackstageRoom(STREAM);
    expect(room).not.toBeNull();
    room!.applyGuestState(SESSION, "on_stage");
    await waitFor(() => guest.messages.some((m) => m.type === "peer.state" && m.guestState === "on_stage"));
    room!.endGuestSession(SESSION, "The host removed you from backstage.");
    await waitFor(() => guest.messages.some((m) => m.type === "session.ended"));
    expect(await guest.closed).toBe(4403);
  });
});
