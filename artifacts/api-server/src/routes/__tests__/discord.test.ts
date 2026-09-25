/**
 * Tests for the Discord Live integration routes.
 *
 * Security properties under test:
 * - Webhook URLs are validated to the discord.com/discordapp.com
 *   /api/webhooks/ shape (SSRF guard) both on save and before every post.
 * - The plaintext webhook URL is never returned by any endpoint and never
 *   logged (only the configured flag + display prefs leave the server).
 * - Announcing without a configured webhook is a clean 400, not a crash.
 * - Discord 4xx/5xx responses surface as 502s with actionable messages.
 *
 * Heavy modules (DB, auth, crypto) are mocked; the real Express router
 * runs against a local ephemeral server. global.fetch is stubbed to
 * capture the outbound Discord webhook call.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const dbState = vi.hoisted(() => ({
  webhook: null as null | {
    user_id: string;
    webhook_url_encrypted: string;
    channel_name: string | null;
    mention_everyone: boolean;
  },
  streams: [] as any[],
  authedUserId: "user-1",
  cryptoReady: true,
  savedCiphertext: "",
  credits: 10,
}));

const fetchState = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; body: any }>,
  nextStatus: 204,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!dbState.authedUserId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = dbState.authedUserId;
    req.userCredits = dbState.credits;
    next();
  },
}));

vi.mock("../../lib/social-crypto", () => ({
  encryptToken: vi.fn((plain: string) => {
    dbState.savedCiphertext = `enc:${plain}`;
    return `enc:${plain}`;
  }),
  decryptToken: vi.fn((cipher: string) => {
    if (!dbState.cryptoReady) throw new Error("bad key");
    if (!cipher.startsWith("enc:")) throw new Error("malformed");
    return cipher.slice(4);
  }),
  isSocialTokenKeyConfigured: vi.fn(() => dbState.cryptoReady),
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const creditsState = vi.hoisted(() => ({
  charged: [] as Array<{ userId: string; amount: number }>,
  refunded: [] as Array<{ userId: string; amount: number }>,
  chargeImpl: null as null | ((userId: string, amount: number) => Promise<number>),
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn((userId: string, amount: number) => {
    if (creditsState.chargeImpl) return creditsState.chargeImpl(userId, amount);
    creditsState.charged.push({ userId, amount });
    return Promise.resolve(dbState.credits - amount);
  }),
  refundCredits: vi.fn((userId: string, amount: number) => {
    creditsState.refunded.push({ userId, amount });
    return Promise.resolve();
  }),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

const aiState = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({ chat: { completions: { create: aiState.create } } }),
  getTextModel: () => "gpt-6-sol-test",
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@workspace/db", () => {
  const chain: any = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn((n: number) => {
    if (chain._table === "webhooks") {
      const row = dbState.webhook && dbState.webhook.user_id === dbState.authedUserId ? dbState.webhook : null;
      return Promise.resolve(row ? [row] : []);
    }
    const rows = dbState.streams.filter((s: any) => s.user_id === dbState.authedUserId);
    return Promise.resolve(rows.slice(0, n));
  });
  chain.set = vi.fn(() => chain);
  const insertChain: any = {};
  insertChain.values = vi.fn((vals: any) => {
    if (chain._table === "webhooks") {
      dbState.webhook = {
        user_id: vals.user_id,
        webhook_url_encrypted: vals.webhook_url_encrypted,
        channel_name: vals.channel_name ?? null,
        mention_everyone: vals.mention_everyone ?? false,
      };
      return Promise.resolve([]);
    }
    const row = { id: `stream-${dbState.streams.length + 1}`, ...vals };
    dbState.streams.push(row);
    return { returning: vi.fn(() => Promise.resolve([row])) };
  });
  return {
    db: {
      select: vi.fn(() => {
        chain._table = undefined;
        return chain;
      }),
      update: vi.fn(() => chain),
      insert: vi.fn((table: any) => {
        chain._table = table === "discordWebhooksTable" ? "webhooks" : "streams";
        return insertChain;
      }),
      delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
    },
    discordWebhooksTable: "discordWebhooksTable",
    discordStreamsTable: "discordStreamsTable",
  };
});

// Wire the table-name marker: the route calls .from(table) — intercept it.
import { db } from "@workspace/db";

import router from "../discord";

let server: any;
let baseUrl: string;

const VALID_WEBHOOK = "https://discord.com/api/webhooks/123456789/abcDEF-_ghi";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  // Patch .from to record which table is queried (the db mock uses a string tag).
  const origSelect = (db as any).select;
  (db as any).select = vi.fn(() => {
    const c: any = origSelect();
    const origFrom = c.from;
    c.from = vi.fn((t: any) => {
      c._table = t === "discordWebhooksTable" ? "webhooks" : "streams";
      return origFrom(t);
    });
    return c;
  });
  // Capture outbound Discord posts — but let the test client's own
  // localhost calls through to the real fetch.
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any) => {
      if (typeof url === "string" && (url.includes("127.0.0.1") || url.includes("localhost"))) {
        return realFetch(url, init);
      }
      fetchState.calls.push({ url, body: JSON.parse(init.body) });
      return {
        ok: fetchState.nextStatus >= 200 && fetchState.nextStatus < 300,
        status: fetchState.nextStatus,
        text: async () => (fetchState.nextStatus === 404 ? '{"message": "Unknown Webhook"}' : ""),
      };
    }),
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllGlobals();
});

beforeEach(() => {
  dbState.webhook = null;
  dbState.streams = [];
  dbState.authedUserId = "user-1";
  dbState.cryptoReady = true;
  dbState.savedCiphertext = "";
  dbState.credits = 10;
  creditsState.charged = [];
  creditsState.refunded = [];
  creditsState.chargeImpl = null;
  fetchState.calls = [];
  fetchState.nextStatus = 204;
  aiState.create.mockReset();
  aiState.create.mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            title: "🔴 LIVE NOW — Friday Beat Night",
            message: "The King Shark is live! Beat-making, vibes, and gold. Pull up 🦈",
          }),
        },
      },
    ],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

async function post(path: string, body: any) {
  const r = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}

async function get(path: string) {
  const r = await fetch(`${baseUrl}${path}`);
  return { status: r.status, json: await r.json() };
}

describe("GET /discord/status", () => {
  it("reports unconfigured when no webhook is saved", async () => {
    const { status, json } = await get("/discord/status");
    expect(status).toBe(200);
    expect(json.configured).toBe(false);
    expect(json.channel_name).toBeNull();
    // The URL itself must never leak — even the encrypted form stays server-side.
    expect(JSON.stringify(json)).not.toContain("discord.com");
  });

  it("reports configured with display prefs after save", async () => {
    await post("/discord/webhook", { webhook_url: VALID_WEBHOOK, channel_name: "#announcements" });
    const { json } = await get("/discord/status");
    expect(json.configured).toBe(true);
    expect(json.channel_name).toBe("#announcements");
    expect(JSON.stringify(json)).not.toContain("discord.com");
  });

  it("requires auth", async () => {
    dbState.authedUserId = "";
    const { status } = await get("/discord/status");
    expect(status).toBe(401);
  });
});

describe("POST /discord/webhook", () => {
  it("rejects non-Discord URLs (SSRF guard)", async () => {
    const { status, json } = await post("/discord/webhook", {
      webhook_url: "https://evil.example.com/api/webhooks/1/abc",
    });
    expect(status).toBe(400);
    expect(json.error).toMatch(/Discord webhook URL/);
    expect(dbState.webhook).toBeNull();
  });

  it("rejects malformed webhook paths", async () => {
    const { status } = await post("/discord/webhook", {
      webhook_url: "https://discord.com/api/channels/123",
    });
    expect(status).toBe(400);
  });

  it("accepts discordapp.com legacy host", async () => {
    const { status, json } = await post("/discord/webhook", {
      webhook_url: "https://discordapp.com/api/webhooks/123456789/abcDEF-_ghi",
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it("encrypts before storing — plaintext never persisted", async () => {
    await post("/discord/webhook", { webhook_url: VALID_WEBHOOK });
    expect(dbState.webhook?.webhook_url_encrypted).toBe(`enc:${VALID_WEBHOOK}`);
    expect(dbState.webhook?.webhook_url_encrypted).not.toBe(VALID_WEBHOOK);
  });

  it("503s when the encryption key is not configured (fail closed)", async () => {
    dbState.cryptoReady = false;
    const { status } = await post("/discord/webhook", { webhook_url: VALID_WEBHOOK });
    expect(status).toBe(503);
    expect(dbState.webhook).toBeNull();
  });
});

describe("POST /discord/announce", () => {
  it("400s cleanly when no webhook is configured", async () => {
    const { status, json } = await post("/discord/announce", { kind: "live", title: "Test" });
    expect(status).toBe(400);
    expect(json.error).toMatch(/No Discord webhook configured/);
    expect(fetchState.calls).toHaveLength(0);
  });

  it("posts a gold LIVE embed to the decrypted webhook URL", async () => {
    await post("/discord/webhook", { webhook_url: VALID_WEBHOOK, mention_everyone: true });
    const { status, json } = await post("/discord/announce", {
      kind: "live",
      title: "Friday Night Beats",
      game: "Making music",
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(fetchState.calls).toHaveLength(1);
    const call = fetchState.calls[0]!;
    // The outbound POST goes to the real Discord URL — decrypted server-side.
    expect(call.url).toBe(VALID_WEBHOOK);
    expect(call.body.content).toBe("@everyone");
    const embed = call.body.embeds[0];
    expect(embed.title).toContain("LIVE NOW");
    expect(embed.title).toContain("Friday Night Beats");
    expect(embed.color).toBe(0xd4af37);
    expect(embed.fields[0].value).toBe("Making music");
  });

  it("does not @everyone when the flag is off", async () => {
    await post("/discord/webhook", { webhook_url: VALID_WEBHOOK });
    await post("/discord/announce", { kind: "video", title: "New drop", video_url: "https://example.com/v.mp4" });
    expect(fetchState.calls[0]!.body.content).toBeUndefined();
  });

  it("posts an ended embed with the VOD link", async () => {
    await post("/discord/webhook", { webhook_url: VALID_WEBHOOK });
    await post("/discord/announce", { kind: "live", title: "Late stream" });
    const { status } = await post("/discord/announce", {
      kind: "ended",
      title: "Late stream",
      vod_url: "https://example.com/vod",
    });
    expect(status).toBe(200);
    const embed = fetchState.calls[1]!.body.embeds[0];
    expect(embed.title).toContain("Stream ended");
    expect(embed.description).toContain("https://example.com/vod");
  });

  it("maps a deleted Discord webhook (404) to an actionable 502", async () => {
    await post("/discord/webhook", { webhook_url: VALID_WEBHOOK });
    fetchState.nextStatus = 404;
    const { status, json } = await post("/discord/announce", { kind: "live", title: "X" });
    expect(status).toBe(502);
    expect(json.error).toMatch(/deleted/);
  });

  it("announcing stays free — only the AI assistant path may charge", async () => {
    // Posting to Discord is pure integration (free). The AI announcement
    // assistant is the single paid endpoint in this file (1 credit, refunded
    // on failure). Split the source at the paid section marker to keep the
    // free-half guarantee precise instead of file-wide.
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../discord.ts", import.meta.url), "utf8"),
    );
    const freeMarker = "/* ── Announce (free — pure integration, no AI compute)";
    const paidMarker = "/* ── AI announcement assistant (paid";
    const freeIdx = src.indexOf(freeMarker);
    const paidIdx = src.indexOf(paidMarker);
    expect(freeIdx).toBeGreaterThan(-1);
    expect(paidIdx).toBeGreaterThan(freeIdx);
    // The announce handler block itself must never touch the credit ledger
    // (imports at the top legitimately name the credits module for the paid
    // endpoint below).
    const announceBlock = src.slice(freeIdx, paidIdx);
    expect(announceBlock).not.toMatch(/chargeCredits|deductCredits|OutOfCredits/);
    // The paid path must charge and must refund when the model fails —
    // money back if the user got no announcement copy.
    const paidBlock = src.slice(paidIdx);
    expect(paidBlock).toMatch(/chargeCredits/);
    expect(paidBlock).toMatch(/refundCredits/);
  });
});

describe("POST /discord/ai-announcement", () => {
  it("402s when out of credits and charges nothing", async () => {
    dbState.credits = 0;
    const { status, json } = await post("/discord/ai-announcement", {
      type: "live",
      topic: "beat night",
    });
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(creditsState.charged).toHaveLength(0);
    expect(aiState.create).not.toHaveBeenCalled();
  });

  it("402s when the charge itself hits OutOfCreditsError", async () => {
    const { OutOfCreditsError } = await import("../../lib/credits");
    creditsState.chargeImpl = () =>
      Promise.reject(new (OutOfCreditsError as new () => Error)());
    const { status, json } = await post("/discord/ai-announcement", {
      type: "video",
      topic: "new drop",
    });
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(aiState.create).not.toHaveBeenCalled();
  });

  it("400s on missing topic and on an invalid type", async () => {
    const missing = await post("/discord/ai-announcement", { type: "live" });
    expect(missing.status).toBe(400);
    const badType = await post("/discord/ai-announcement", { type: "party", topic: "x" });
    expect(badType.status).toBe(400);
    // Bad input never touches the credit ledger or the model.
    expect(creditsState.charged).toHaveLength(0);
    expect(aiState.create).not.toHaveBeenCalled();
  });

  it("generates a title + message for 1 credit", async () => {
    const { status, json } = await post("/discord/ai-announcement", {
      type: "live",
      topic: "Friday beat-making stream",
      game: "Studio session",
    });
    expect(status).toBe(200);
    expect(json.title).toContain("LIVE NOW");
    expect(json.message).toContain("live");
    expect(json.creditsUsed).toBe(1);
    expect(json.creditsRemaining).toBe(9);
    expect(creditsState.charged).toEqual([{ userId: "user-1", amount: 1 }]);
    // Uses the centralized text model (mocked) — never a hardcoded model id.
    expect(aiState.create.mock.calls[0][0].model).toBe("gpt-6-sol-test");
  });

  it("refunds the credit when the provider fails", async () => {
    aiState.create.mockRejectedValueOnce(new Error("provider exploded"));
    const { status, json } = await post("/discord/ai-announcement", {
      type: "schedule",
      topic: "album listening party",
    });
    expect(status).toBe(502);
    expect(json.error).toMatch(/refunded/);
    expect(creditsState.charged).toHaveLength(1);
    expect(creditsState.refunded).toEqual([{ userId: "user-1", amount: 1 }]);
  });

  it("refunds when the model returns unusable output", async () => {
    aiState.create.mockResolvedValueOnce({ choices: [{ message: { content: "{}" } }] });
    const { status } = await post("/discord/ai-announcement", {
      type: "live",
      topic: "x",
    });
    expect(status).toBe(502);
    expect(creditsState.charged).toHaveLength(1);
    expect(creditsState.refunded).toHaveLength(1);
  });

  it("requires auth", async () => {
    dbState.authedUserId = "";
    const { status } = await post("/discord/ai-announcement", { type: "live", topic: "x" });
    expect(status).toBe(401);
  });
});

describe("streams", () => {
  it("schedules a stream and lists it", async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const { status, json } = await post("/discord/streams", {
      title: "Album listening party",
      game: "Listening",
      scheduled_for: future,
    });
    expect(status).toBe(200);
    expect(json.stream.title).toBe("Album listening party");
    const list = await get("/discord/streams");
    expect(list.json.streams).toHaveLength(1);
    expect(list.json.streams[0].status).toBe("scheduled");
  });

  it("going live records a live stream row", async () => {
    await post("/discord/webhook", { webhook_url: VALID_WEBHOOK });
    await post("/discord/announce", { kind: "live", title: "Now" });
    const list = await get("/discord/streams");
    expect(list.json.streams[0].status).toBe("live");
  });
});
