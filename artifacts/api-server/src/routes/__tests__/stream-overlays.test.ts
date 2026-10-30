/**
 * Stream overlay tests (stack900 lane C2).
 *
 * Three layers, all on the real machinery:
 *   1. Token unit behavior (lib/overlay-events) against a fake db —
 *      minting, shape, resolution, and reset killing the old token.
 *   2. The REST surface (routes/stream-overlays) on a real express
 *      server: desk mint/reset, token-keyed state from seeded rows,
 *      the old token dying at the door, and a privacy pin (no user
 *      ids, no emails in anything an overlay can read).
 *   3. The alert socket over the REAL LiveWsGateway with REAL ws
 *      clients: a valid token gets the state hello and then the
 *      exact alert the emit hooks fire; a dead token is refused
 *      4401.
 * Only the db and the session/rate-limit middleware are stubbed.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { WebSocket } from "ws";
import { PgDialect } from "drizzle-orm/pg-core";

const CREATOR = "00000000-0000-4000-8000-0000000000c1";
const FAN = "00000000-0000-4000-8000-0000000000f1";
const GHOST = "00000000-0000-4000-8000-000000000099";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const STREAM_ID = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  tokens: new Map<string, Record<string, unknown>>(),
  profiles: new Map<string, Record<string, unknown>>(),
  streams: [] as Array<Record<string, unknown>>,
  follows: [] as Array<Record<string, unknown>>,
  tips: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "Sign in to do that." });
      return;
    }
    req.userId = user;
    next();
  },
}));
vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const dialect = new PgDialect();

  function rowsFor(table: unknown, params: unknown[]): Array<Record<string, unknown>> {
    if (table === actual.creatorOverlayTokensTable) {
      return [...h.tokens.values()].filter(
        (r) => params.includes(r["userId"]) || params.includes(r["token"]),
      );
    }
    if (table === actual.creatorProfilesTable) {
      return [...h.profiles.values()].filter(
        (r) => params.includes(r["userId"]) || params.includes(r["id"]),
      );
    }
    if (table === actual.liveStreamsTable) {
      return h.streams
        .filter((s) => s["user_id"] === params[0] && (params.length < 2 || s["status"] === params[1]))
        .sort((a, b) => String(b["created_at"]).localeCompare(String(a["created_at"])));
    }
    if (table === actual.followsTable) {
      return h.follows
        .filter((f) => f["profileId"] === params[0])
        .sort((a, b) => String(b["createdAt"]).localeCompare(String(a["createdAt"])));
    }
    if (table === actual.liveStreamTipsTable) {
      return h.tips
        .filter((t) => t["stream_id"] === params[0])
        .sort((a, b) => String(b["created_at"]).localeCompare(String(a["created_at"])));
    }
    return [];
  }

  const db = {
    select: () => {
      let table: unknown;
      let params: unknown[] = [];
      const chain: any = {
        from: (t: unknown) => {
          table = t;
          return chain;
        },
        where: (cond: unknown) => {
          try {
            params = dialect.sqlToQuery(cond as never).params;
          } catch {
            params = [];
          }
          return chain;
        },
        orderBy: () => chain,
        limit: async (n: number) => rowsFor(table, params).slice(0, n),
        // Drizzle queries are thenable: selects awaited without
        // .limit() (the tipper-name lookup, the goal full-set
        // recount) resolve to the full row list.
        then: (resolve: (rows: Array<Record<string, unknown>>) => unknown, reject: (err: unknown) => unknown) =>
          Promise.resolve(rowsFor(table, params)).then(resolve, reject),
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: async () => {
          if (table === actual.creatorOverlayTokensTable && !h.tokens.has(String(v["userId"]))) {
            h.tokens.set(String(v["userId"]), { ...v });
          }
        },
        onConflictDoUpdate: async (cfg: { set: Record<string, unknown> }) => {
          if (table === actual.creatorOverlayTokensTable) {
            const existing = h.tokens.get(String(v["userId"]));
            if (existing) Object.assign(existing, cfg.set);
            else h.tokens.set(String(v["userId"]), { ...v });
          }
        },
      }),
    }),
  };
  return { ...actual, db };
});

import {
  overlayHub,
  overlayRoom,
  emitOverlayAlert,
  isOverlayTokenShape,
  newOverlayToken,
  getOrCreateOverlayToken,
  resetOverlayToken,
  resolveOverlayToken,
} from "../../lib/overlay-events";
import router, { registerOverlayWs } from "../stream-overlays";
import { LiveWsGateway } from "../../lib/live-ws";

function seedWorld() {
  h.tokens.clear();
  h.profiles.clear();
  h.streams = [];
  h.follows = [];
  h.tips = [];
  h.profiles.set(CREATOR, { id: PROFILE_ID, userId: CREATOR, displayName: "Stage Star" });
  h.profiles.set(FAN, { id: "99999999-9999-4999-8999-999999999999", userId: FAN, displayName: "Fan One" });
  h.streams = [
    {
      id: STREAM_ID,
      user_id: CREATOR,
      profile_id: PROFILE_ID,
      title: "Friday Live",
      status: "live",
      tip_goal_vb: 1000,
      created_at: "2026-10-29T20:00:00.000Z",
      updated_at: "2026-10-29T20:00:00.000Z",
    },
  ];
  h.follows = [
    { profileId: PROFILE_ID, followerUserId: FAN, createdAt: new Date("2026-10-29T21:00:00.000Z") },
  ];
  h.tips = [
    { stream_id: STREAM_ID, tipper_user_id: FAN, amount_vb: 300, created_at: new Date("2026-10-29T21:05:00.000Z") },
    { stream_id: STREAM_ID, tipper_user_id: FAN, amount_vb: 200, created_at: new Date("2026-10-29T21:02:00.000Z") },
  ];
}

describe("overlay tokens (lib)", () => {
  beforeEach(() => seedWorld());

  it("mints 43-char base64url tokens, unique per mint", () => {
    const a = newOverlayToken();
    const b = newOverlayToken();
    expect(a).toHaveLength(43);
    expect(isOverlayTokenShape(a)).toBe(true);
    expect(isOverlayTokenShape(b)).toBe(true);
    expect(a).not.toBe(b);
    expect(isOverlayTokenShape("not-a-token")).toBe(false);
    expect(isOverlayTokenShape("")).toBe(false);
  });

  it("refuses junk-shaped tokens without a lookup, and unknown ones with", async () => {
    await expect(resolveOverlayToken("junk")).resolves.toBeNull();
    await expect(resolveOverlayToken(newOverlayToken())).resolves.toBeNull();
  });

  it("getOrCreate is stable; reset kills the old token immediately", async () => {
    const first = await getOrCreateOverlayToken(CREATOR);
    const again = await getOrCreateOverlayToken(CREATOR);
    expect(again).toBe(first);
    await expect(resolveOverlayToken(first)).resolves.toBe(CREATOR);

    const fresh = await resetOverlayToken(CREATOR);
    expect(fresh).not.toBe(first);
    await expect(resolveOverlayToken(first)).resolves.toBeNull();
    await expect(resolveOverlayToken(fresh)).resolves.toBe(CREATOR);
  });
});

describe("overlay emit (lib hub)", () => {
  beforeEach(() => seedWorld());

  function fakeSocket() {
    const sent: string[] = [];
    return {
      sent,
      readyState: 1,
      send: (d: string) => sent.push(d),
      close: () => {},
      terminate: () => {},
      ping: () => {},
      on: () => {},
    };
  }

  it("delivers a fully-shaped alert to the creator's room only", () => {
    const mine = fakeSocket();
    const other = fakeSocket();
    overlayHub.join(overlayRoom(CREATOR), mine as never);
    overlayHub.join(overlayRoom(GHOST), other as never);
    try {
      emitOverlayAlert(CREATOR, { kind: "tip", title: "Fan One tipped 300 Visual Bucs", body: "great set", amountVb: 300 });
      expect(mine.sent).toHaveLength(1);
      expect(other.sent).toHaveLength(0);
      const msg = JSON.parse(mine.sent[0]!);
      expect(msg.type).toBe("alert");
      expect(msg.alert.kind).toBe("tip");
      expect(msg.alert.title).toBe("Fan One tipped 300 Visual Bucs");
      expect(msg.alert.body).toBe("great set");
      expect(msg.alert.amountVb).toBe(300);
      expect(msg.alert.test).toBe(false);
      expect(typeof msg.alert.at).toBe("string");
    } finally {
      overlayHub.leaveAll(mine as never);
      overlayHub.leaveAll(other as never);
    }
  });
});

describe("overlay REST surface", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(router);
    server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });
  afterAll(() => server.close());
  beforeEach(() => seedWorld());

  it("desk requires auth, then mints the token + token-carrying paths", async () => {
    const anon = await fetch(`${base}/overlay/me`);
    expect(anon.status).toBe(401);

    const res = await fetch(`${base}/overlay/me`, { headers: { "x-test-user": CREATOR } });
    expect(res.status).toBe(200);
    const dto = (await res.json()) as { token: string; paths: { alerts: string; goal: string } };
    expect(isOverlayTokenShape(dto.token)).toBe(true);
    expect(dto.paths.alerts).toBe(`/overlay/alerts?token=${dto.token}`);
    expect(dto.paths.goal).toBe(`/overlay/goal?token=${dto.token}`);
    expect(dto.paths.alerts).not.toContain(CREATOR);
  });

  it("state answers from the real rows behind a valid token — and leaks no ids", async () => {
    const token = await getOrCreateOverlayToken(CREATOR);
    const res = await fetch(`${base}/overlay/state?token=${token}`);
    expect(res.status).toBe(200);
    const state = (await res.json()) as any;
    expect(state.creator.displayName).toBe("Stage Star");
    expect(state.stream).toMatchObject({ id: STREAM_ID, status: "live", title: "Friday Live" });
    expect(state.latestFollower.displayName).toBe("Fan One");
    expect(state.recentTips).toHaveLength(2);
    expect(state.recentTips[0]).toMatchObject({ tipperName: "Fan One", amountVb: 300 });
    expect(state.goal).toEqual({ goalVb: 1000, totalVb: 500, tipCount: 2 });

    const raw = JSON.stringify(state);
    expect(raw).not.toContain(CREATOR);
    expect(raw).not.toContain(FAN);
    expect(raw).not.toContain("@");
    expect(raw).not.toContain("userId");
    expect(raw).not.toContain("user_id");
  });

  it("a creator with nothing yet gets honest nulls, not a fake show", async () => {
    const token = await getOrCreateOverlayToken(GHOST);
    const res = await fetch(`${base}/overlay/state?token=${token}`);
    expect(res.status).toBe(200);
    const state = (await res.json()) as any;
    expect(state.stream).toBeNull();
    expect(state.latestFollower).toBeNull();
    expect(state.recentTips).toEqual([]);
    expect(state.goal).toEqual({ goalVb: null, totalVb: 0, tipCount: 0 });
  });

  it("after a reset, the old token 401s and the new one answers", async () => {
    const oldToken = await getOrCreateOverlayToken(CREATOR);
    const reset = await fetch(`${base}/overlay/token/reset`, {
      method: "POST",
      headers: { "x-test-user": CREATOR },
    });
    expect(reset.status).toBe(200);
    const { token: newToken } = (await reset.json()) as { token: string };
    expect(newToken).not.toBe(oldToken);

    const stale = await fetch(`${base}/overlay/state?token=${oldToken}`);
    expect(stale.status).toBe(401);
    const fresh = await fetch(`${base}/overlay/state?token=${newToken}`);
    expect(fresh.status).toBe(200);
  });

  it("a junk token never reaches state", async () => {
    const res = await fetch(`${base}/overlay/state?token=hello`);
    expect(res.status).toBe(401);
  });

  it("test-alert fires a labelled TEST alert into the creator's own room", async () => {
    const sent: string[] = [];
    const socket = {
      readyState: 1,
      send: (d: string) => sent.push(d),
      close: () => {},
      terminate: () => {},
      ping: () => {},
      on: () => {},
    };
    overlayHub.join(overlayRoom(CREATOR), socket as never);
    try {
      const res = await fetch(`${base}/overlay/test-alert`, {
        method: "POST",
        headers: { "x-test-user": CREATOR },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; delivered: number };
      expect(body.ok).toBe(true);
      expect(body.delivered).toBe(1);
      expect(sent).toHaveLength(1);
      const msg = JSON.parse(sent[0]!);
      expect(msg.alert.kind).toBe("test");
      expect(msg.alert.test).toBe(true);
      expect(msg.alert.title).toContain("TEST");
      expect(msg.alert.title).toContain("Stage Star");
    } finally {
      overlayHub.leaveAll(socket as never);
    }
  });
});

describe("overlay alert socket (real gateway, real clients)", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const gateway = new LiveWsGateway();
    registerOverlayWs(gateway);
    server = createServer();
    gateway.attach(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => server.close());
  beforeEach(() => seedWorld());

  function connect(token: string): Promise<{ ws: WebSocket; messages: any[]; closed: Promise<number> }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/overlay/ws?token=${token}`);
      const messages: any[] = [];
      let closeCode = -1;
      const closed = new Promise<number>((r) => {
        ws.on("close", (code) => {
          closeCode = code;
          r(code);
        });
      });
      ws.on("message", (data) => messages.push(JSON.parse(String(data))));
      ws.on("open", () => resolve({ ws, messages, closed }));
      ws.on("error", reject);
      // A refused handshake (4401) closes without "open" — resolve then too.
      ws.on("close", () => {
        if (closeCode === 4401) resolve({ ws, messages, closed });
      });
    });
  }

  async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
    const start = Date.now();
    while (!pred()) {
      if (Date.now() - start > ms) throw new Error("timed out waiting for overlay socket message");
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  it("greets with the state snapshot, then delivers a live tip alert", async () => {
    const token = await getOrCreateOverlayToken(CREATOR);
    const { ws, messages } = await connect(token);
    try {
      await waitFor(() => messages.length >= 1);
      expect(messages[0].type).toBe("state");
      expect(messages[0].state.creator.displayName).toBe("Stage Star");
      expect(messages[0].state.goal).toEqual({ goalVb: 1000, totalVb: 500, tipCount: 2 });

      emitOverlayAlert(CREATOR, {
        kind: "follow",
        title: "Fan One just followed",
        body: "A new fan just walked in — say hello.",
      });
      await waitFor(() => messages.length >= 2);
      expect(messages[1].type).toBe("alert");
      expect(messages[1].alert.kind).toBe("follow");
      expect(messages[1].alert.title).toBe("Fan One just followed");
    } finally {
      ws.close();
    }
  });

  it("refuses a dead token with 4401", async () => {
    const { closed, messages } = await connect(newOverlayToken());
    await expect(closed).resolves.toBe(4401);
    expect(messages).toHaveLength(0);
  });
});
