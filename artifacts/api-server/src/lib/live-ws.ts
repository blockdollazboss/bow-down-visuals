/**
 * live-ws.ts — the API server's WebSocket plumbing for live features
 * (stream chat today; the stream controller relays over the same
 * gateway). The server is a plain Express app on one http.Server, and
 * Render's load balancer speaks WebSocket/HTTP only — so realtime
 * rides `ws` on the same origin/port as the REST API. No third-party
 * realtime service, no extra bill.
 *
 * Auth: the site's session is a Supabase access token (the same one
 * REST calls carry as `Authorization: Bearer …`). Browsers cannot set
 * headers on a WebSocket handshake, so the token arrives as the
 * `?token=` query parameter and is verified with the exact call
 * requireAuth uses (Supabase `auth.getUser`). Nothing new is trusted:
 * a token that would fail REST fails here too.
 */
import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { logger } from "./logger";

const SUPABASE_URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "";
const SUPABASE_ANON_KEY = process.env["SUPABASE_ANON_KEY"] ?? process.env["VITE_SUPABASE_ANON_KEY"] ?? "";

/** Verify a session access token the same way requireAuth does. */
export async function verifyAccessToken(token: string): Promise<{ userId: string; email: string | null } | null> {
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const {
      data: { user },
      error,
    } = await anonClient.auth.getUser(token);
    if (error || !user) return null;
    return { userId: user.id, email: user.email ?? null };
  } catch {
    return null;
  }
}

/** The minimal socket surface the hubs use — the real `ws` WebSocket
 *  satisfies it, and tests drive fakes with the same shape. */
export interface WsClientSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
  on(event: string, listener: (...args: never[]) => void): unknown;
}

export const WS_OPEN = 1; // WebSocket.OPEN

/**
 * Named rooms of sockets with JSON broadcast. Dead sockets (send
 * throws, or no longer OPEN) are pruned as they're met — a room never
 * accumulates corpses between broadcasts.
 */
export class RoomHub {
  private rooms = new Map<string, Set<WsClientSocket>>();

  join(room: string, socket: WsClientSocket): void {
    let set = this.rooms.get(room);
    if (!set) {
      set = new Set();
      this.rooms.set(room, set);
    }
    set.add(socket);
  }

  leave(room: string, socket: WsClientSocket): void {
    const set = this.rooms.get(room);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.rooms.delete(room);
  }

  leaveAll(socket: WsClientSocket): void {
    for (const room of [...this.rooms.keys()]) this.leave(room, socket);
  }

  /** Broadcast a JSON payload to every OPEN socket in the room.
   *  Returns the number of sockets the payload was handed to. */
  broadcast(room: string, payload: unknown): number {
    const set = this.rooms.get(room);
    if (!set || set.size === 0) return 0;
    const data = JSON.stringify(payload);
    let delivered = 0;
    for (const socket of [...set]) {
      if (socket.readyState !== WS_OPEN) {
        this.leave(room, socket);
        continue;
      }
      try {
        socket.send(data);
        delivered++;
      } catch {
        this.leave(room, socket);
      }
    }
    return delivered;
  }

  roomSize(room: string): number {
    return this.rooms.get(room)?.size ?? 0;
  }

  /** Live sockets in a room (a copy — safe to iterate while mutating). */
  sockets(room: string): WsClientSocket[] {
    return [...(this.rooms.get(room) ?? [])];
  }
}

export interface WsUpgradeContext {
  req: IncomingMessage;
  socket: WebSocket;
  /** Path params from the registered pattern (e.g. { id }). */
  params: Record<string, string>;
  query: URLSearchParams;
}

type WsUpgradeHandler = (ctx: WsUpgradeContext) => void | Promise<void>;

interface WsRoute {
  regex: RegExp;
  keys: string[];
  handler: WsUpgradeHandler;
}

/**
 * Routes HTTP upgrade requests to registered WS handlers by path
 * pattern ("/api/live/:id/chat/ws"). Unmatched upgrade paths are
 * destroyed — this server offers no other socket endpoints, and a
 * dangling half-open socket is worse than a refused one.
 *
 * A 30s heartbeat (ping / pong tracking) reaps connections the
 * network dropped without a close frame.
 */
export class LiveWsGateway {
  private wss = new WebSocketServer({ noServer: true });
  private routes: WsRoute[] = [];
  private liveness = new Map<WebSocket, boolean>();
  private heartbeat: NodeJS.Timeout | null = null;

  register(pattern: string, handler: WsUpgradeHandler): void {
    const keys: string[] = [];
    const regex = new RegExp(
      "^" +
        pattern
          .split("/")
          .map((seg) => {
            if (seg.startsWith(":")) {
              keys.push(seg.slice(1));
              return "([^/]+)";
            }
            return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          })
          .join("/") +
        "$",
    );
    this.routes.push({ regex, keys, handler });
  }

  attach(server: HttpServer): void {
    server.on("upgrade", (req: IncomingMessage, rawSocket: Socket, head: Buffer) => {
      const url = new URL(req.url ?? "", "http://localhost");
      for (const route of this.routes) {
        const match = route.regex.exec(url.pathname);
        if (!match) continue;
        const params: Record<string, string> = {};
        route.keys.forEach((key, i) => {
          params[key] = decodeURIComponent(match[i + 1] ?? "");
        });
        this.wss.handleUpgrade(req, rawSocket, head, (ws) => {
          this.track(ws);
          Promise.resolve(route.handler({ req, socket: ws, params, query: url.searchParams })).catch((err) => {
            logger.error({ err }, "live-ws handler failed");
            try {
              ws.close(4500, "Something went wrong");
            } catch {
              /* already gone */
            }
          });
        });
        return;
      }
      rawSocket.destroy();
    });

    this.heartbeat = setInterval(() => {
      for (const [ws, alive] of [...this.liveness]) {
        if (!alive) {
          this.liveness.delete(ws);
          try {
            ws.terminate();
          } catch {
            /* already gone */
          }
          continue;
        }
        this.liveness.set(ws, false);
        try {
          ws.ping();
        } catch {
          /* the close handler cleans up */
        }
      }
    }, 30_000);
    this.heartbeat.unref?.();
  }

  private track(ws: WebSocket): void {
    this.liveness.set(ws, true);
    ws.on("pong", () => this.liveness.set(ws, true));
    ws.on("close", () => this.liveness.delete(ws));
  }

  /** Stop the heartbeat (tests / shutdown). */
  dispose(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.liveness.clear();
  }
}
