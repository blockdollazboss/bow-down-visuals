/**
 * Route + WebSocket tests for Live Captions (routes/live-captions),
 * Stack-200 #160. Real router and real WS gateway over a fake db
 * (style mirrors live-chat.test.ts / live-chat-ws.test.ts);
 * requireAuth takes the user from an x-test-user header and the
 * translator is a fake — no provider is ever called.
 *
 * Covers: languages endpoint serves the rail list + gated pricing;
 * only the owner controls settings / sends segments; captions-off
 * and not-live gates; per-viewer reads translate only that viewer's
 * language; unsupported languages refused; the ticket door covers
 * caption reads; the WS greets in the viewer's language, backfills,
 * and delivers ONLY that language's room; segment fan-out translates
 * only into languages with a waiting viewer.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const VIEWER = "00000000-0000-4000-8000-0000000000bb";
const STREAM = "22222222-2222-4222-8222-222222222222";
const STREAM_ENDED = "33333333-3333-4333-8333-333333333333";
const STREAM_TICKETED = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => ({
  streams: new Map<string, Record<string, unknown>>(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = user;
    next();
  },
}));
vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(),
  getTextModel: () => "test-model",
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const dialect = new PgDialect();
  const chain = (table: unknown): any => {
    let cond: unknown = null;
    const self: any = {
      where: (c: unknown) => {
        cond = c;
        return self;
      },
      limit: async (_n: number) => {
        if (table !== actual.liveStreamsTable || !cond) return [];
        const { params } = dialect.sqlToQuery(cond as never);
        const row = h.streams.get(String(params[0]));
        return row ? [row] : [];
      },
      // Awaitable for count-style queries (ticket door facts) → none sold.
      then: (resolve: (v: unknown[]) => void) => resolve([]),
    };
    return self;
  };
  const db = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => chain(table),
    }),
  };
  return { ...actual, db };
});

import liveCaptionsRouter, {
  registerLiveCaptionsWs,
  __setCaptionTranslator,
  __resetCaptionPacing,
  __resetCaptionViewerTracking,
} from "../live-captions";
import { liveCaptionStore } from "../../lib/live-captions";
import { LiveWsGateway } from "../../lib/live-ws";

const translatorCalls: Array<{ text: string; lang: string }> = [];

let server: Server;
let port = 0;
let gateway: LiveWsGateway;
const clients: WebSocket[] = [];

function streamRow(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date();
  return {
    id,
    user_id: OWNER,
    profile_id: "11111111-1111-4111-8111-111111111111",
    title: "Live show",
    status: "live",
    started_at: now,
    created_at: now,
    updated_at: now,
    ticket_price_vb: null,
    ticket_capacity: null,
    ...over,
  };
}

beforeAll(async () => {
  h.streams.set(STREAM, streamRow(STREAM));
  h.streams.set(STREAM_ENDED, streamRow(STREAM_ENDED, { status: "ended" }));
  h.streams.set(STREAM_TICKETED, streamRow(STREAM_TICKETED, { ticket_price_vb: 500 }));

  const app = express();
  app.use(express.json());
  app.use("/api", liveCaptionsRouter);
  server = createServer(app);
  gateway = new LiveWsGateway();
  registerLiveCaptionsWs(gateway, {
    verifyToken: async (token: string) =>
      token === "viewer-token" ? { userId: VIEWER, email: null } : null,
    translator: () => async (text: string, lang: string) => {
      translatorCalls.push({ text, lang });
      return `[${lang}] ${text}`;
    },
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

beforeEach(() => {
  liveCaptionStore.__reset();
  __resetCaptionPacing();
  __resetCaptionViewerTracking();
  translatorCalls.length = 0;
  __setCaptionTranslator(async (text: string, lang: string) => {
    translatorCalls.push({ text, lang });
    return `[${lang}] ${text}`;
  });
});

async function api(
  method: string,
  path: string,
  opts: { user?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function enableCaptions(streamId = STREAM, sourceLanguage?: string) {
  const r = await api("POST", `/live/${streamId}/captions/settings`, {
    user: OWNER,
    body: { enabled: true, ...(sourceLanguage ? { source_language: sourceLanguage } : {}) },
  });
  expect(r.status).toBe(200);
  return r;
}

describe("GET /live-captions/languages", () => {
  it("serves the translator rail's list plus English (original), pricing gated off", async () => {
    const r = await api("GET", "/live-captions/languages");
    expect(r.status).toBe(200);
    const codes = r.json.languages.map((l: any) => l.code);
    expect(codes[0]).toBe("en");
    expect(codes).toContain("es");
    expect(codes).toContain("ja");
    expect(codes).not.toContain("sv"); // not on the rail — never invented
    expect(r.json.pricing.charged).toBe(false);
    expect(r.json.pricing.status).toBe("pending_owner_decision");
    expect(r.json.pricing.translatorRailCreditsPerMinutePerLanguage).toBe(500);
  });
});

describe("settings — owner only", () => {
  it("defaults to captions OFF and reports the stream state", async () => {
    const r = await api("GET", `/live/${STREAM}/captions/settings`);
    expect(r.status).toBe(200);
    expect(r.json.captions.enabled).toBe(false);
    expect(r.json.streamStatus).toBe("live");
  });

  it("a non-owner cannot open the caption track", async () => {
    const r = await api("POST", `/live/${STREAM}/captions/settings`, {
      user: VIEWER,
      body: { enabled: true },
    });
    expect(r.status).toBe(403);
    expect(liveCaptionStore.getSettings(STREAM).enabled).toBe(false);
  });

  it("an unsupported source language is refused, not stored", async () => {
    const r = await api("POST", `/live/${STREAM}/captions/settings`, {
      user: OWNER,
      body: { enabled: true, source_language: "xx" },
    });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("UNSUPPORTED_LANGUAGE");
  });

  it("404s for a stream that doesn't exist", async () => {
    const r = await api("GET", "/live/99999999-9999-4999-8999-999999999999/captions/settings");
    expect(r.status).toBe(404);
  });
});

describe("segments — the caption source", () => {
  it("refuses segments while captions are off", async () => {
    const r = await api("POST", `/live/${STREAM}/captions/segments`, {
      user: OWNER,
      body: { text: "hello everyone" },
    });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("CAPTIONS_OFF");
  });

  it("refuses segments from anyone but the streamer", async () => {
    await enableCaptions();
    const r = await api("POST", `/live/${STREAM}/captions/segments`, {
      user: VIEWER,
      body: { text: "not my stream" },
    });
    expect(r.status).toBe(403);
  });

  it("refuses segments on an ended stream", async () => {
    liveCaptionStore.setSettings(STREAM_ENDED, { enabled: true });
    const r = await api("POST", `/live/${STREAM_ENDED}/captions/segments`, {
      user: OWNER,
      body: { text: "too late" },
    });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("STREAM_NOT_LIVE");
  });

  it("stores a segment with a gapless seq once captions are on", async () => {
    await enableCaptions();
    const r = await api("POST", `/live/${STREAM}/captions/segments`, {
      user: OWNER,
      body: { text: "welcome to the show" },
    });
    expect(r.status).toBe(201);
    expect(r.json.segment).toMatchObject({ seq: 1, text: "welcome to the show", sourceLanguage: "en" });
  });
});

describe("per-viewer reads", () => {
  it("translates into the viewer's language only, honoring the cursor", async () => {
    await enableCaptions();
    await api("POST", `/live/${STREAM}/captions/segments`, { user: OWNER, body: { text: "first line" } });
    __resetCaptionPacing();
    await api("POST", `/live/${STREAM}/captions/segments`, { user: OWNER, body: { text: "second line" } });

    const es = await api("GET", `/live/${STREAM}/captions?lang=es&after=1`);
    expect(es.status).toBe(200);
    expect(es.json.captions).toHaveLength(1);
    expect(es.json.captions[0]).toMatchObject({ seq: 2, text: "[es] second line", language: "es" });
    expect(es.json.latestSeq).toBe(2);
    // Translation ran for Spanish only — no other language was touched.
    expect(translatorCalls.every((c) => c.lang === "es")).toBe(true);
  });

  it("the source language reads back untranslated, with no translator call", async () => {
    await enableCaptions();
    await api("POST", `/live/${STREAM}/captions/segments`, { user: OWNER, body: { text: "original words" } });
    const en = await api("GET", `/live/${STREAM}/captions?lang=en`);
    expect(en.json.captions[0].text).toBe("original words");
    expect(translatorCalls).toHaveLength(0);
  });

  it("an unsupported viewer language is refused with the supported list", async () => {
    const r = await api("GET", `/live/${STREAM}/captions?lang=sv`);
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("UNSUPPORTED_LANGUAGE");
    expect(r.json.languages.map((l: any) => l.code)).toContain("es");
  });

  it("the ticket door covers caption reads for guests", async () => {
    const r = await api("GET", `/live/${STREAM_TICKETED}/captions?lang=es`);
    expect(r.status).toBe(402);
    expect(r.json.code).toBe("TICKET_REQUIRED");
    expect(r.json.ticket.price_vb).toBe(500);
  });
});

/* ── WebSocket ─────────────────────────────────────────────────────── */

function connect(path: string): { ws: WebSocket; messages: any[]; closed: Promise<number> } {
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
  return { ws, messages, closed };
}

async function waitFor(fn: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe("captions websocket — per-viewer rooms", () => {
  it("refuses an unsupported language with 4400", async () => {
    const { closed } = connect(`/api/live/${STREAM}/captions/ws?lang=sv`);
    await expect(closed).resolves.toBe(4400);
  });

  it("refuses a missing stream with 4404", async () => {
    const { closed } = connect(`/api/live/99999999-9999-4999-8999-999999999999/captions/ws?lang=es`);
    await expect(closed).resolves.toBe(4404);
  });

  it("a ticketed stream refuses a guest socket with 4401", async () => {
    const { closed } = connect(`/api/live/${STREAM_TICKETED}/captions/ws?lang=es`);
    await expect(closed).resolves.toBe(4401);
  });

  it("greets, backfills in the viewer's language, then delivers live lines in that language only", async () => {
    await enableCaptions();
    await api("POST", `/live/${STREAM}/captions/segments`, { user: OWNER, body: { text: "before you arrived" } });

    const es = connect(`/api/live/${STREAM}/captions/ws?lang=es`);
    const fr = connect(`/api/live/${STREAM}/captions/ws?lang=fr`);
    await waitFor(() => es.messages.some((m) => m.type === "hello") && fr.messages.some((m) => m.type === "hello"));
    expect(es.messages[0]).toMatchObject({ type: "hello", language: "es", captionsEnabled: true });

    // Backfill arrives translated, per viewer.
    await waitFor(() => es.messages.some((m) => m.type === "backfill"));
    const esBackfill = es.messages.find((m) => m.type === "backfill");
    expect(esBackfill.captions[0].text).toBe("[es] before you arrived");
    await waitFor(() => fr.messages.some((m) => m.type === "backfill"));
    const frBackfill = fr.messages.find((m) => m.type === "backfill");
    expect(frBackfill.captions[0].text).toBe("[fr] before you arrived");

    // A new spoken line fans out per language room.
    __resetCaptionPacing();
    translatorCalls.length = 0;
    await api("POST", `/live/${STREAM}/captions/segments`, { user: OWNER, body: { text: "live line now" } });
    await waitFor(() => es.messages.some((m) => m.type === "caption"));
    await waitFor(() => fr.messages.some((m) => m.type === "caption"));
    const esCap = es.messages.find((m) => m.type === "caption");
    const frCap = fr.messages.find((m) => m.type === "caption");
    expect(esCap.caption.text).toBe("[es] live line now");
    expect(frCap.caption.text).toBe("[fr] live line now");
    // Each room got exactly its own language, nothing else.
    expect(es.messages.filter((m) => m.type === "caption")).toHaveLength(1);
    expect(fr.messages.filter((m) => m.type === "caption")).toHaveLength(1);
    es.ws.close();
    fr.ws.close();
  });

  it("no waiting viewer language = no translation spend on fan-out", async () => {
    await enableCaptions();
    const es = connect(`/api/live/${STREAM}/captions/ws?lang=es`);
    await waitFor(() => es.messages.some((m) => m.type === "hello"));
    translatorCalls.length = 0;
    await api("POST", `/live/${STREAM}/captions/segments`, { user: OWNER, body: { text: "only spanish waits" } });
    await waitFor(() => es.messages.some((m) => m.type === "caption"));
    expect(translatorCalls.map((c) => c.lang)).toEqual(["es"]);
    es.ws.close();
  });
});
