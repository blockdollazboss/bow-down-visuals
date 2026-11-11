/**
 * CA-5 replay-guard suite — the 51 EXPOSED-REPLAY charge sites closed on
 * stack1600/ca-5 (generate r–s, audit batch B5).
 *
 * Contract proven per rail family (house pattern: server-derived
 * idempotency key + durable stored-result pre-check before funding +
 * replay = stored body verbatim + replayed:true + replayNote + every
 * refund path VOIDS its key):
 *   - fresh request charges exactly once (exact price) and stores once;
 *   - an identical re-ask is served from the stored result — no second
 *     charge, no second provider call, no second side-effect row;
 *   - a provider failure refunds AND voids, so a retry charges fresh;
 *   - storage failure fails open (the request still succeeds).
 *
 * The credits ledger and the stored-results table are in-memory fakes
 * with the same semantics as the real helpers (the real helpers' own
 * fail-open behavior is covered by generation-stored-results.test.ts).
 * Media rails run the REAL ffmpeg/ffprobe on tiny generated media.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const USER = "user-ca5";

const h = vi.hoisted(() => ({
  balance: 100_000,
  charges: [] as Array<{ userId: string; amount: number; action: string; key: string | null }>,
  refunds: [] as Array<{ userId: string; amount: number; action: string }>,
  voids: [] as string[],
  chargedKeys: new Set<string>(),
  stored: new Map<string, { rail: string; userId: string; result: Record<string, unknown> }>(),
  storeMode: "ok" as "ok" | "throw",
  selectMode: "ok" as "ok" | "throw",
  chatCalls: [] as unknown[],
  chatMode: "ok" as "ok" | "fail",
  chatResponder: null as null | ((sys: string, usr: string) => string),
  imageCalls: 0,
  imageMode: "ok" as "ok" | "fail",
  uploadMode: "ok" as "ok" | "fail",
  downloadMode: "ok" as "ok" | "fail",
  sponsorDeals: [] as Array<Record<string, unknown>>,
  activeDeal: null as null | Record<string, unknown>,
  pipelineDeals: [] as Array<Record<string, unknown>>,
  followupStamps: 0,
  oneSheets: [] as Array<Record<string, unknown>>,
  songRows: [] as Array<Record<string, unknown>>,
  royaltyEntries: [] as Array<Record<string, unknown>>,
  saveGenCount: 0,
  pngB64: "",
  wavBytes: new Uint8Array(0),
  mp4Bytes: new Uint8Array(0),
  stvScenesJson: "",
}));

/* ── auth ─────────────────────────────────────────────────────────────── */
vi.mock("../../middlewares/require-auth", () => {
  const log = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => log,
  };
  const requireAuth = (
    req: Record<string, unknown>,
    _res: unknown,
    next: () => void,
  ) => {
    req["userId"] = USER;
    req["userCredits"] = h.balance;
    req["userSupabase"] = null;
    req["log"] = log;
    next();
  };
  return { requireAuth, optionalAuth: requireAuth, requireAdmin: requireAuth, default: requireAuth };
});

/* ── credits ledger (faithful in-memory semantics) ────────────────────── */
vi.mock("../../lib/credits", async () => {
  class OutOfCreditsError extends Error {
    code = "OUT_OF_CREDITS";
    constructor(message = "Not enough credits") {
      super(message);
      this.name = "OutOfCreditsError";
    }
  }
  class LedgerWriteError extends Error {
    code = "LEDGER_WRITE_FAILED";
    constructor(message = "Ledger write failed") {
      super(message);
      this.name = "LedgerWriteError";
    }
  }
  class CreditsDisabledError extends Error {
    code = "CREDITS_DISABLED";
    constructor(message = "Credits disabled") {
      super(message);
      this.name = "CreditsDisabledError";
    }
  }
  function buildChargeIdempotencyKey(
    scope: string,
    userId: string,
    clientKey: string | null,
    intent: unknown,
  ): string {
    if (typeof clientKey === "string" && clientKey.trim().length >= 8) {
      return `${scope}:${userId}:client:${clientKey.trim()}`;
    }
    return `${scope}:${userId}:${JSON.stringify(intent ?? {})}`;
  }
  async function chargeCredits(
    userId: string,
    amount: number,
    record: { action?: string } | undefined,
    opts?: { idempotencyKey?: string },
  ): Promise<number> {
    const key = opts?.idempotencyKey ?? null;
    if (key && h.chargedKeys.has(key)) return h.balance; // durable-ledger replay suppression
    if (h.balance < amount) throw new OutOfCreditsError();
    h.balance -= amount;
    if (key) h.chargedKeys.add(key);
    h.charges.push({ userId, amount, action: record?.action ?? "", key });
    return h.balance;
  }
  async function refundCredits(
    userId: string,
    amount: number,
    record: { action?: string } | undefined,
  ): Promise<number> {
    h.balance += amount;
    h.refunds.push({ userId, amount, action: record?.action ?? "" });
    return h.balance;
  }
  async function voidChargeIdempotencyKey(key: string | null | undefined): Promise<boolean> {
    if (!key) return false;
    h.voids.push(key);
    return h.chargedKeys.delete(key);
  }
  /* Charge-on-failure lane: split-screen now refunds through the
     guaranteed helper — mirror its contract against this fake
     (refund via the fake above, void only on a landed refund,
     exactly one retry). */
  async function refundCreditsGuaranteed(
    userId: string,
    amount: number,
    record: { action?: string } | undefined,
    opts?: { idempotencyKey?: string | null },
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await refundCredits(userId, amount, record);
        if (opts?.idempotencyKey) await voidChargeIdempotencyKey(opts.idempotencyKey);
        return true;
      } catch { /* the real helper retries exactly once */ }
    }
    return false;
  }
  return {
    chargeCredits,
    refundCredits,
    refundCreditsGuaranteed,
    voidChargeIdempotencyKey,
    buildChargeIdempotencyKey,
    getCreditBalance: async () => h.balance,
    getBalance: async () => h.balance,
    OutOfCreditsError,
    LedgerWriteError,
    CreditsDisabledError,
  };
});

/* ── durable stored results (the helper's contract, in-memory) ────────── */
vi.mock("../../lib/generation-stored-results", () => ({
  findStoredGenerationResult: async (
    _rail: string,
    key: string,
    userId: string,
  ): Promise<Record<string, unknown> | null> => {
    if (h.selectMode === "throw") return null; // helper fails open internally
    const row = h.stored.get(key);
    if (!row || row.userId !== userId) return null;
    return row.result;
  },
  storeGenerationResult: async (
    rail: string,
    key: string,
    userId: string,
    result: Record<string, unknown>,
  ): Promise<void> => {
    if (h.storeMode === "throw") return; // helper swallows storage errors
    if (!h.stored.has(key)) h.stored.set(key, { rail, userId, result });
  },
}));

/* ── provider (ai-clients) ────────────────────────────────────────────── */
vi.mock("../../lib/ai-clients", () => {
  const client = {
    chat: {
      completions: {
        create: async (args: {
          messages?: Array<{ role: string; content: unknown }>;
        }) => {
          h.chatCalls.push(args);
          if (h.chatMode === "fail") throw new Error("provider down");
          const msgs = args.messages ?? [];
          const sys = String(msgs.find((m) => m.role === "system")?.content ?? "");
          const usr = String(msgs.find((m) => m.role === "user")?.content ?? "");
          const content = h.chatResponder ? h.chatResponder(sys, usr) : "{}";
          return { choices: [{ message: { content } }] };
        },
      },
    },
    images: {
      generate: async () => {
        h.imageCalls++;
        if (h.imageMode === "fail") throw new Error("image provider down");
        return { data: [{ b64_json: h.pngB64 }] };
      },
    },
  };
  return {
    getOpenAI: () => client,
    getTextModel: () => "gpt-test",
    getImageModel: () => "img-test",
    getReasoningModel: () => "gpt-test",
    getVisionModel: () => "gpt-test",
    LOW_REASONING_PARAMS: {},
  };
});

vi.mock("openai", () => {
  class APIError extends Error {
    status?: number;
    code?: string;
    constructor(message?: string, status?: number) {
      super(message);
      this.status = status;
    }
  }
  class OpenAI {
    static APIError = APIError;
  }
  return { default: OpenAI, APIError };
});

/* ── small libs ───────────────────────────────────────────────────────── */
vi.mock("../../lib/rate-limit", () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { publicApiLimiter: pass, aiLimiter: pass, strictLimiter: pass, default: pass };
});
vi.mock("../../lib/logger", () => {
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  };
  return { logger, default: logger };
});
vi.mock("../../lib/payment-record", () => ({
  recordCreditUsage: async () => {},
  recordGenerationHistory: async () => "hist-1",
  markGenerationHistoryCharged: async () => {},
}));
vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async (name: string) => {
    if (h.uploadMode === "fail") throw new Error("storage upload failed");
    return `media/${name}`;
  },
  refreshSupabaseStorageUrl: async (ref: string) => `https://cdn.example/${ref}`,
  normalizeToStorageRef: (ref: string) => ref,
  uploadFileStreamToSupabaseStorage: async (_bucket: string, name: string) => `clips/${name}`,
  SUPABASE_CLIPS_BUCKET: "clips",
  SUPABASE_MEDIA_BUCKET: "media",
  parseSupabaseStorageRefBucketed: (ref: string) => ({
    bucket: "media",
    path: ref.replace(/^media\//, ""),
  }),
  downloadStorageObjectBuffer: async () => Buffer.from("stored-audio"),
}));
vi.mock("../../lib/r2-client", () => ({
  r2Upload: async (key: string) => `https://r2.example/${key}`,
  r2PublicUrl: (key: string) => `https://r2.example/${key}`,
  r2Download: async () => Buffer.from("r2-bytes"),
}));
vi.mock("../../lib/transcription", () => ({
  transcribeAudioTimed: async () => ({
    text: "hello world this is a test transcript",
    segments: [{ start: 0, end: 2, text: "hello world" }],
    durationSec: 6,
    words: [],
  }),
}));
vi.mock("../../lib/email", () => ({
  sendEmail: async () => ({}),
  emailShell: () => "",
  emailButton: () => "",
  emailDetailBox: () => "",
  escapeHtml: (s: string) => s,
  isEmailConfigured: () => false,
  baseUrlForEmail: () => "https://example.com",
  EMAIL_COLORS: {},
}));
vi.mock("../../lib/push-events", () => ({ notifyUserEvent: async () => {} }));
vi.mock("../../lib/stripe-client", () => ({
  buildCheckoutSessionIdempotencyKey: () => "idem-test",
  createGuardedStripeClient: () => {
    throw new Error("stripe not configured in tests");
  },
  fingerprintStripeRequestParams: () => "fp-test",
}));
vi.mock("../../lib/stripe-checkout", () => ({
  checkoutBaseUrl: () => "https://example.com",
}));
vi.mock("../../lib/embedded-checkout", () => ({
  isEmbeddedCheckoutEnabled: () => false,
}));
vi.mock("../../lib/escrow-held", () => ({ escrowHeldCents: async () => 0 }));
vi.mock("../../lib/admin", () => ({ isAdminRequest: () => false }));
vi.mock("../../lib/retention", () => ({ recordCreation: async () => {} }));
vi.mock("../../lib/co-stars", () => ({ buildCoStarContext: async () => "" }));
vi.mock("../../lib/save-generation", () => ({
  saveGeneration: async () => {
    h.saveGenCount++;
    return "gen-1";
  },
}));

/* ── @workspace/db — fake over the real table objects ─────────────────── */
vi.mock("@workspace/db", async () => {
  const orig = (await vi.importActual("@workspace/db")) as Record<string, unknown>;

  const sqlTextAndParams = (q: unknown): { text: string; params: unknown[] } => {
    const chunks = (q as { queryChunks?: unknown[] })?.queryChunks ?? [];
    let text = "";
    const params: unknown[] = [];
    for (const c of chunks) {
      // drizzle-orm's sql`` template inlines interpolated primitives AS
      // the raw values themselves: a StringChunk carries the literal SQL
      // text (value: string[]), and each bound parameter sits in the
      // chunk list as the bare string/number/Date value — there is no
      // Param wrapper object in this drizzle version.
      if (
        c !== null &&
        typeof c === "object" &&
        (c as { constructor?: { name?: string } })?.constructor?.name === "StringChunk"
      ) {
        const v = (c as { value?: unknown })?.value;
        if (Array.isArray(v)) text += v.join("");
        else if (typeof v === "string") text += v;
      } else if (
        typeof c === "string" ||
        typeof c === "number" ||
        typeof c === "boolean" ||
        c instanceof Date
      ) {
        params.push(c);
      }
      // Nested SQL fragments / column objects carry no parameter these
      // queries need.
    }
    return { text, params };
  };

  const rowsFor = (table: unknown): Array<Record<string, unknown>> => {
    if (table === orig["wave8SponsorDealsTable"]) return h.pipelineDeals;
    if (table === orig["royaltyEntriesTable"]) return h.royaltyEntries;
    return [];
  };

  const fakeDb = {
    execute: async (q: unknown) => {
      const { text, params } = sqlTextAndParams(q);
      if (/INSERT INTO sponsor_deals/i.test(text)) {
        const [id, brand_name, budget_min, budget_max, niche, deliverables, description, deadline, posted_by] =
          params as [string, string, number, number, string, string, string, string, string];
        const row = {
          id,
          brand_name,
          budget_min,
          budget_max,
          niche,
          deliverables,
          description,
          deadline,
          posted_by,
          status: "active",
          created_at: new Date().toISOString(),
        };
        h.sponsorDeals.push(row);
        return { rows: [row] };
      }
      if (/FROM sponsor_deals/i.test(text)) {
        if (/WHERE id =/i.test(text)) {
          const dealId = params[0];
          const found =
            h.sponsorDeals.find((d) => d["id"] === dealId) ??
            (h.activeDeal && h.activeDeal["id"] === dealId ? h.activeDeal : null);
          return { rows: found ? [found] : [] };
        }
        return { rows: h.activeDeal ? [h.activeDeal] : [] };
      }
      return { rows: [] };
    },
    select: (_fields?: unknown) => {
      const chain: Record<string, unknown> = {};
      chain["from"] = (table: unknown) => {
        chain["__table"] = table;
        return chain;
      };
      chain["where"] = () => chain;
      chain["orderBy"] = () => chain;
      chain["limit"] = () => chain;
      chain["then"] = (resolve: (v: unknown) => void) =>
        resolve(rowsFor(chain["__table"]));
      return chain;
    },
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: async () => undefined,
        returning: async () => {
          if (table === orig["syncOneSheetsTable"]) {
            const row = { ...v, id: "os-row-1", created_at: new Date(), updated_at: new Date() };
            h.oneSheets.push(row);
            return [row];
          }
          if (table === orig["songsTable"]) {
            const row = { ...v, id: "song-row-1", created_at: new Date() };
            h.songRows.push(row);
            return [row];
          }
          return [{ ...v }];
        },
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            h.followupStamps++;
            const base = h.pipelineDeals[0] ?? {};
            return [{ ...base, ...v }];
          },
        }),
      }),
    }),
  };

  return { ...orig, db: fakeDb };
});

/* ── routers under test ───────────────────────────────────────────────── */
import randomizerRouter from "../generate/randomizer";
import royaltiesRouter from "../generate/royalties";
import showFinderRouter from "../generate/show-finder";
import streamCopilotRouter from "../generate/stream-copilot";
import syncPitchRouter from "../generate/sync-pitch";
import sponsorsRouter from "../generate/sponsors";
import songRouter from "../generate/song";
import scriptToVideoRouter from "../generate/script-to-video";
import streamPackRouter from "../generate/stream-pack";
import repurposeRouter from "../generate/repurpose";
import splitScreenRouter from "../generate/split-screen";
import stemSplitterRouter from "../generate/stem-splitter";
import streamerClipsRouter from "../generate/streamer-clips";
import songHarmonyRouter from "../generate/song-harmony";

/* ── harness ──────────────────────────────────────────────────────────── */
let server: Server;
let base = "";
const realFetch = globalThis.fetch;

async function post(path: string, body?: unknown) {
  const res = await realFetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body: json, text };
}

async function postForm(path: string, form: FormData) {
  const res = await realFetch(`${base}${path}`, { method: "POST", body: form });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body: json, text };
}

async function getJson(path: string) {
  const res = await realFetch(`${base}${path}`);
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body: json };
}

async function waitFor(
  cond: () => boolean | Promise<boolean>,
  timeoutMs = 12_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 60));
  }
  return !!(await cond());
}

function chatJson(obj: unknown) {
  h.chatResponder = () => JSON.stringify(obj);
}

beforeAll(async () => {
  /* Tiny REAL media for the ffmpeg rails. */
  const dir = mkdtempSync(join(tmpdir(), "ca5-media-"));
  execFileSync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
    "-ar", "44100", join(dir, "tone.wav"),
  ], { stdio: "pipe" });
  execFileSync("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", "testsrc=duration=6:size=160x90:rate=10",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    join(dir, "tiny.mp4"),
  ], { stdio: "pipe" });
  execFileSync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "color=c=0x336699:size=64x64:duration=0.1",
    "-frames:v", "1", join(dir, "still.png"),
  ], { stdio: "pipe" });
  h.wavBytes = readFileSync(join(dir, "tone.wav"));
  h.mp4Bytes = readFileSync(join(dir, "tiny.mp4"));
  h.pngB64 = readFileSync(join(dir, "still.png")).toString("base64");
  h.stvScenesJson = JSON.stringify({
    scenes: [{ narration: "Hello world, this is a test scene for the video.", visualPrompt: "a sunny field" }],
  });

  /* Server-side fetch stub: provider endpoints + media downloads.
     The tests themselves use realFetch (captured above). */
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
    if (url.includes("api.openai.com/v1/chat/completions")) {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: h.stvScenesJson } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("api.openai.com/v1/audio/speech")) {
      return new Response(h.wavBytes, { status: 200, headers: { "content-type": "audio/wav" } });
    }
    if (h.downloadMode === "fail") return new Response("nope", { status: 404 });
    if (url.endsWith(".wav")) return new Response(h.wavBytes, { status: 200 });
    return new Response(h.mp4Bytes, { status: 200 });
  }) as typeof fetch;

  const app = express();
  app.use(express.json({ limit: "30mb" }));
  app.use(randomizerRouter);
  app.use(royaltiesRouter);
  app.use(showFinderRouter);
  app.use(streamCopilotRouter);
  app.use(syncPitchRouter);
  app.use(sponsorsRouter);
  app.use(songRouter);
  app.use(scriptToVideoRouter);
  app.use(streamPackRouter);
  app.use(repurposeRouter);
  app.use(splitScreenRouter);
  app.use(stemSplitterRouter);
  app.use(streamerClipsRouter);
  app.use(songHarmonyRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.balance = 100_000;
  h.charges = [];
  h.refunds = [];
  h.voids = [];
  h.chargedKeys.clear();
  h.stored.clear();
  h.storeMode = "ok";
  h.selectMode = "ok";
  h.chatCalls = [];
  h.chatMode = "ok";
  h.chatResponder = null;
  h.imageCalls = 0;
  h.imageMode = "ok";
  h.uploadMode = "ok";
  h.downloadMode = "ok";
  h.sponsorDeals = [];
  h.activeDeal = null;
  h.pipelineDeals = [];
  h.followupStamps = 0;
  h.oneSheets = [];
  h.songRows = [];
  h.royaltyEntries = [];
  h.saveGenCount = 0;
});

/* ══ Plain JSON rail — randomizer ══════════════════════════════════════ */
describe("randomizer (plain JSON rail)", () => {
  const reqBody = { category: "hooks" };
  const NOTE =
    "These are the ideas you already rolled for this request — pick a different category for a fresh roll.";

  it("fresh charges 100 once and stores; replay is free and verbatim", async () => {
    chatJson({ ideas: ["i1", "i2", "i3", "i4", "i5"] });
    const fresh = await post("/randomizer", reqBody);
    expect(fresh.status).toBe(200);
    expect(fresh.body["ideas"]).toEqual(["i1", "i2", "i3", "i4", "i5"]);
    expect(fresh.body["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.stored.size).toBe(1);
    expect(h.chatCalls).toHaveLength(1);

    const replay = await post("/randomizer", reqBody);
    expect(replay.status).toBe(200);
    expect(replay.body["replayed"]).toBe(true);
    expect(replay.body["replayNote"]).toBe(NOTE);
    expect(replay.body["ideas"]).toEqual(["i1", "i2", "i3", "i4", "i5"]);
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toHaveLength(1);
  });

  it("provider failure refunds + voids; retry charges fresh", async () => {
    h.chatMode = "fail";
    const failed = await post("/randomizer", reqBody);
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(h.refunds).toHaveLength(1);
    expect(h.refunds[0]!.amount).toBe(100);
    expect(h.voids).toHaveLength(1);

    h.chatMode = "ok";
    chatJson({ ideas: ["a", "b", "c", "d", "e"] });
    const retry = await post("/randomizer", reqBody);
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });

  it("storage failure fails open — request still succeeds, ledger still protects", async () => {
    h.selectMode = "throw";
    h.storeMode = "throw";
    chatJson({ ideas: ["i1", "i2", "i3", "i4", "i5"] });
    const first = await post("/randomizer", reqBody);
    expect(first.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    const second = await post("/randomizer", reqBody);
    expect(second.status).toBe(200);
    expect(h.charges).toHaveLength(1); // ledger key suppresses the re-charge
    expect(h.chatCalls).toHaveLength(2); // nothing stored, so work re-runs — but never re-charges
  });
});

/* ══ Data-fingerprint key — royalties insights (chargeOr402 helper) ════ */
describe("royalties insights (data-fingerprint key)", () => {
  it("no data answers 400 before any charge", async () => {
    const res = await post("/royalties/insights", {});
    expect(res.status).toBe(400);
    expect(h.charges).toHaveLength(0);
  });

  it("fresh charges 100 once; replay serves the stored insights free", async () => {
    h.royaltyEntries = [
      { song_title: "Song A", platform: "spotify", period_start: "2026-10-01", gross_amount: "250.00", streams: "5000" },
      { song_title: "Song B", platform: "apple", period_start: "2026-10-02", gross_amount: "90.00", streams: "1200" },
    ];
    chatJson({ insights: [{ title: "Push Song A", detail: "It earns the most per stream." }] });
    const fresh = await post("/royalties/insights", {});
    expect(fresh.status).toBe(200);
    expect(Array.isArray(fresh.body["insights"])).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);

    const replay = await post("/royalties/insights", {});
    expect(replay.status).toBe(200);
    expect(replay.body["replayed"]).toBe(true);
    expect(typeof replay.body["replayNote"]).toBe("string");
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toHaveLength(1);
  });
});

/* ══ Helper rail — show-finder (preCharge) ═════════════════════════════ */
describe("show-finder (preCharge helper — finder + pitch)", () => {
  it("finder: fresh charges 200 once; replay is free", async () => {
    chatJson({
      opportunities: [
        {
          title: "Open Mic Night",
          type: "open-mic",
          organizer: "The Venue",
          location: "Austin",
          dateWindow: "next-90-days",
          whyFit: "Great fit for your sound.",
          howToApply: "Email the venue.",
          verifyNote: "Confirm the date first.",
        },
      ],
    });
    const reqBody = {
      location: "Austin, TX",
      genre: "country",
      opportunityTypes: ["open-mic"],
      dateWindow: "next-90-days",
      artistBio: "Indie country singer.",
    };
    const fresh = await post("/show-finder", reqBody);
    expect(fresh.status).toBe(200);
    expect(Array.isArray(fresh.body["opportunities"])).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(200);

    const replay = await post("/show-finder", reqBody);
    expect(replay.body["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toHaveLength(1);
  });

  it("pitch: fresh charges 100 once; replay is free", async () => {
    chatJson({ subject: "Booking pitch", body: "Hello, I would love to play your stage.", tips: ["Be brief."] });
    const reqBody = {
      opportunityTitle: "Open Mic Night",
      opportunityType: "open-mic",
      creatorName: "Casey",
      genre: "country",
    };
    const fresh = await post("/show-finder/pitch", reqBody);
    expect(fresh.status).toBe(200);
    expect(fresh.body["pitch"]).toBeTruthy();
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);

    const replay = await post("/show-finder/pitch", reqBody);
    expect(replay.body["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toHaveLength(1);
  });
});

/* ══ Helper rail — stream-copilot (guardCredits, 2 rails) ══════════════ */
describe("stream-copilot (guardCredits helper)", () => {
  it("prep: fresh charges 100 once; replay is free", async () => {
    chatJson({ checklist: ["Check mic"], talkingPoints: ["Intro"], clipWatchFors: ["Hot takes"] });
    const reqBody = { streamTitle: "Launch Night", topic: "New album" };
    const fresh = await post("/stream-copilot/prep", reqBody);
    expect(fresh.status).toBe(200);
    expect(fresh.body["checklist"]).toEqual(["Check mic"]);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);

    const replay = await post("/stream-copilot/prep", reqBody);
    expect(replay.body["replayed"]).toBe(true);
    expect(replay.body["replayNote"]).toBe(
      "This is the prep pack you already made for this stream — change the title or topic for a fresh one.",
    );
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toHaveLength(1);
  });

  it("clip-plan: fresh charges 100 once; replay is free; failure refunds + voids", async () => {
    chatJson({
      moments: [
        { timestampHint: "12:30", title: "Big reveal", description: "The reveal lands.", whyItWorks: "Surprise." },
      ],
    });
    const reqBody = { recap: "Stream recap: at 12:30 we revealed the new song and chat went wild." };
    const fresh = await post("/stream-copilot/clip-plan", reqBody);
    expect(fresh.status).toBe(200);
    expect(Array.isArray(fresh.body["moments"])).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);

    const replay = await post("/stream-copilot/clip-plan", reqBody);
    expect(replay.body["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);

    const failBody = { recap: "A totally different recap about a cooking stream disaster." };
    h.chatMode = "fail";
    const failed = await post("/stream-copilot/clip-plan", failBody);
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
  });
});

/* ══ Pattern C — sync-pitch one-sheet (row identity) ═══════════════════ */
describe("sync-pitch one-sheet (Pattern C)", () => {
  it("fresh charges 150 once and inserts exactly one row; replay returns the same row free", async () => {
    chatJson({
      logline: "A soaring anthem for open roads.",
      moodTags: ["uplifting"],
      soundsLike: "Coldplay",
      comparableArtists: ["Coldplay"],
      syncUses: ["car ads"],
      pitchEmail: { subject: "Sync: Open Road", body: "Hello, please consider this track." },
      licensingNotes: "One-stop.",
    });
    const reqBody = { songTitle: "Open Road", artistName: "Casey" };
    const fresh = await post("/sync-pitch/one-sheet", reqBody);
    expect(fresh.status).toBe(200);
    const oneSheet = fresh.body["oneSheet"] as Record<string, unknown>;
    expect(oneSheet["id"]).toBe("os-row-1");
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(150);
    expect(h.oneSheets).toHaveLength(1);

    const replay = await post("/sync-pitch/one-sheet", reqBody);
    expect(replay.body["replayed"]).toBe(true);
    expect((replay.body["oneSheet"] as Record<string, unknown>)["id"]).toBe("os-row-1");
    expect(h.oneSheets).toHaveLength(1);
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toHaveLength(1);
  });
});

/* ══ Sponsors ×4 — Pattern C deal post + pitch + matcher + follow-up ═══ */
describe("sponsors (Pattern C deal post + AI rails)", () => {
  const dealBody = {
    brandName: "Acme Audio",
    budgetMin: 1000,
    budgetMax: 5000,
    niche: "music",
    deliverables: "2 posts",
    description: "Promote our headphones.",
    deadline: "2027-01-01T00:00:00.000Z",
  };

  it("deal post: one charge AND exactly one deal row; replay returns the same deal", async () => {
    const fresh = await post("/sponsors/deals", dealBody);
    expect(fresh.status).toBe(200);
    const deal = fresh.body["deal"] as Record<string, unknown>;
    expect(typeof deal["id"]).toBe("string");
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(500);
    expect(h.sponsorDeals).toHaveLength(1);

    const replay = await post("/sponsors/deals", dealBody);
    expect(replay.status).toBe(200);
    expect(replay.body["replayed"]).toBe(true);
    expect((replay.body["deal"] as Record<string, unknown>)["id"]).toBe(deal["id"]);
    expect(h.sponsorDeals).toHaveLength(1); // no duplicate deal row
    expect(h.charges).toHaveLength(1); // no second 500 charge
  });

  it("pitch writer: fresh charges 100 once against a live deal; replay is free", async () => {
    h.activeDeal = {
      id: "22222222-2222-4222-8222-222222222222",
      brand_name: "Acme Audio",
      budget_min: 1000,
      budget_max: 5000,
      niche: "music",
      deliverables: "2 posts",
      description: "Promote our headphones.",
      deadline: "2027-01-01",
      posted_by: "another-user",
      status: "active",
      created_at: "2026-01-01T00:00:00.000Z",
    };
    chatJson({ pitch: "Dear Acme team, I would love to partner.", subject: "Partnership pitch" });
    const reqBody = {
      dealId: "22222222-2222-4222-8222-222222222222",
      creatorName: "Casey",
      niche: "music",
      followers: 12000,
      platforms: ["youtube"],
      tone: "professional",
    };
    const fresh = await post("/sponsors/pitch", reqBody);
    expect(fresh.status).toBe(200);
    expect(fresh.body["pitch"]).toBeTruthy();
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);

    const replay = await post("/sponsors/pitch", reqBody);
    expect(replay.body["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toHaveLength(1);
  });

  it("deal matcher: fresh charges 100 once; replay is free", async () => {
    h.activeDeal = {
      id: "33333333-3333-4333-8333-333333333333",
      brand_name: "Acme Audio",
      budget_min: 1000,
      budget_max: 5000,
      niche: "music",
      deliverables: "2 posts",
      description: "Promote our headphones.",
      deadline: "2027-01-01",
      posted_by: "another-user",
      status: "active",
      created_at: "2026-01-01T00:00:00.000Z",
    };
    chatJson({
      matches: [{ dealIndex: 0, score: 88, why: "Strong niche fit." }],
      note: "One strong match.",
    });
    const reqBody = { niche: "music", followers: 12000, platforms: ["youtube"] };
    const fresh = await post("/sponsors/match", reqBody);
    expect(fresh.status).toBe(200);
    expect(Array.isArray(fresh.body["matches"])).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);

    const replay = await post("/sponsors/match", reqBody);
    expect(replay.body["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);
  });

  it("follow-up draft: fresh charges 50 and stamps once; replay does not re-stamp", async () => {
    h.pipelineDeals = [
      {
        id: "pd-1",
        user_id: USER,
        sponsor_name: "Acme Audio",
        stage: "pitched",
        deal_value_cents: 250000,
        contact: "deals@acme.example",
        notes: "",
        last_followup_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];
    chatJson({ subject: "Checking in", body: "Hi Acme team, just checking in on our deal." });
    const reqBody = { dealId: "pd-1" };
    const fresh = await post("/sponsors/pipeline/followup", reqBody);
    expect(fresh.status).toBe(200);
    expect(fresh.body["subject"]).toBe("Checking in");
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(50);
    expect(h.followupStamps).toBe(1);

    const replay = await post("/sponsors/pipeline/followup", reqBody);
    expect(replay.body["replayed"]).toBe(true);
    expect(replay.body["lastFollowupAt"]).toBe(fresh.body["lastFollowupAt"]);
    expect(h.followupStamps).toBe(1); // the stored timestamp stands — no re-stamp
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toHaveLength(1);
  });
});

/* ══ Tiered price — song ═══════════════════════════════════════════════ */
describe("song (tiered price, default tier 400)", () => {
  it("fresh charges 400 once; replay returns the same package + history id free", async () => {
    h.chatResponder = () => "Full song package: lyrics, structure, production notes.";
    const reqBody = { songTitle: "Open Road", genre: "country" };
    const fresh = await post("/generate-song", reqBody);
    expect(fresh.status).toBe(200);
    expect(typeof fresh.body["result"]).toBe("string");
    expect(fresh.body["genHistoryId"]).toBe("hist-1");
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(400);

    const replay = await post("/generate-song", reqBody);
    expect(replay.body["replayed"]).toBe(true);
    expect(replay.body["result"]).toBe(fresh.body["result"]);
    expect(replay.body["genHistoryId"]).toBe("hist-1");
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toHaveLength(1);
  });
});

/* ══ ffmpeg/fetch rail — script-to-video ═══════════════════════════════ */
describe("script-to-video (fetch + ffmpeg rail)", () => {
  it(
    "fresh charges 2000 once and renders; replay is free",
    async () => {
      const reqBody = {
        script: "Welcome to the channel, today we test the script to video pipeline end to end.",
        visualStyle: "cinematic",
        aspectRatio: "16:9",
        voice: "alloy",
      };
      const fresh = await post("/script-to-video", reqBody);
      expect(fresh.status).toBe(200);
      expect(typeof fresh.body["url"]).toBe("string");
      expect(fresh.body["sceneCount"]).toBe(1);
      expect(h.charges).toHaveLength(1);
      expect(h.charges[0]!.amount).toBe(2000);

      const replay = await post("/script-to-video", reqBody);
      expect(replay.body["replayed"]).toBe(true);
      expect(replay.body["url"]).toBe(fresh.body["url"]);
      expect(h.charges).toHaveLength(1);
    },
    90_000,
  );
});

/* ══ Image rail — stream-pack ══════════════════════════════════════════ */
describe("stream-pack (per-asset image rail)", () => {
  const reqBody = { channelName: "CaseyLive", asset: "webcam-frame" };

  it("fresh charges the plan price once; replay is free", async () => {
    const fresh = await post("/stream-pack/generate", reqBody);
    expect(fresh.status).toBe(200);
    expect(typeof fresh.body["url"]).toBe("string");
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(fresh.body["creditCost"]);

    const replay = await post("/stream-pack/generate", reqBody);
    expect(replay.body["replayed"]).toBe(true);
    expect(replay.body["url"]).toBe(fresh.body["url"]);
    expect(h.charges).toHaveLength(1);
    expect(h.imageCalls).toBe(1);
  });

  it("delivery failure refunds + voids; retry charges fresh", async () => {
    h.uploadMode = "fail";
    const failed = await post("/stream-pack/generate", reqBody);
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);

    h.uploadMode = "ok";
    const retry = await post("/stream-pack/generate", reqBody);
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });
});

/* ══ Repurpose ×4 ══════════════════════════════════════════════════════ */
describe("repurpose (pack / text / re-roll / re-roll thumbnail)", () => {
  it(
    "analyze: fresh charges 500 once; replay rejoins the same jobs free",
    async () => {
      chatJson({
        videoTitle: "My Video",
        summary: "A summary.",
        moments: [{ startSec: 0, endSec: 2, title: "Hook" }],
        captions: [{ caption: "cap one", hashtags: ["#a"] }],
        descriptions: { tiktok: "t", reels: "r", shorts: "s", x: "x" },
        thumbnailPrompts: ["a bold thumbnail"],
      });
      const form = new FormData();
      form.append("video", new Blob([h.mp4Bytes], { type: "video/mp4" }), "clip.mp4");
      const fresh = await postForm("/repurpose/analyze", form);
      expect(fresh.status).toBe(200);
      expect(typeof fresh.body["clipJobId"]).toBe("string");
      expect(h.charges).toHaveLength(1);
      expect(h.charges[0]!.amount).toBe(500);

      const form2 = new FormData();
      form2.append("video", new Blob([h.mp4Bytes], { type: "video/mp4" }), "clip.mp4");
      const replay = await postForm("/repurpose/analyze", form2);
      expect(replay.body["replayed"]).toBe(true);
      expect(replay.body["clipJobId"]).toBe(fresh.body["clipJobId"]);
      expect(replay.body["thumbnailJobId"]).toBe(fresh.body["thumbnailJobId"]);
      expect(h.charges).toHaveLength(1);
      // let the detached clip/thumbnail jobs settle before the suite moves on
      await new Promise((r) => setTimeout(r, 400));
    },
    90_000,
  );

  it("text pack: fresh charges 200 once; replay is free", async () => {
    chatJson({
      twitterThread: ["t1", "t2", "t3", "t4", "t5"],
      linkedinPost: "A LinkedIn post.",
      instagramCaption: "An Instagram caption.",
      tiktokScript: "A TikTok script.",
      blogOutline: ["o1", "o2", "o3", "o4", "o5"],
    });
    const reqBody = {
      transcript: "This is a long enough transcript for the text pack test.",
      tone: "bold",
    };
    const fresh = await post("/repurpose", reqBody);
    expect(fresh.status).toBe(200);
    expect(Array.isArray(fresh.body["twitterThread"])).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(200);

    const replay = await post("/repurpose", reqBody);
    expect(replay.body["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toHaveLength(1);
  });

  it("re-roll: fresh charges 100 once; replay shows the same roll free", async () => {
    chatJson({ captions: [{ caption: "fresh caption", hashtags: ["#x"] }] });
    const reqBody = { transcript: "some transcript here", kind: "captions", durationSec: 60 };
    const fresh = await post("/repurpose/reroll", reqBody);
    expect(fresh.status).toBe(200);
    expect(fresh.body["kind"]).toBe("captions");
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);

    const replay = await post("/repurpose/reroll", reqBody);
    expect(replay.body["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toHaveLength(1);
  });

  it("re-roll thumbnail: fresh charges 100 once; replay returns the same image free", async () => {
    const reqBody = { prompt: "a shocked creator face, bold text" };
    const fresh = await post("/repurpose/reroll-thumbnail", reqBody);
    expect(fresh.status).toBe(200);
    expect(typeof fresh.body["imageUrl"]).toBe("string");
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);

    const replay = await post("/repurpose/reroll-thumbnail", reqBody);
    expect(replay.body["replayed"]).toBe(true);
    expect(replay.body["imageUrl"]).toBe(fresh.body["imageUrl"]);
    expect(h.charges).toHaveLength(1);
    expect(h.imageCalls).toBe(1);
  });
});

/* ══ Pattern B — split-screen (async job) ══════════════════════════════ */
describe("split-screen (Pattern B async job)", () => {
  const reqBody = {
    clips: [{ url: "https://media.example/a.mp4" }, { url: "https://media.example/b.mp4" }],
    layout: "side-by-side",
  };

  it(
    "fresh 202 charges 200 once and the job completes; replay returns the same job",
    async () => {
      const fresh = await post("/split-screen/apply", reqBody);
      expect(fresh.status).toBe(202);
      const jobId = fresh.body["jobId"] as string;
      expect(typeof jobId).toBe("string");
      expect(h.charges).toHaveLength(1);
      expect(h.charges[0]!.amount).toBe(200);

      const replay = await post("/split-screen/apply", reqBody);
      // The fresh job answer is 202; a replay is answered with the stored
      // body via a plain res.json (200) — same job id, no second charge.
      expect(replay.status).toBe(200);
      expect(replay.body["replayed"]).toBe(true);
      expect(replay.body["jobId"]).toBe(jobId);
      expect(h.charges).toHaveLength(1);

      const done = await waitFor(async () => {
        const j = await getJson(`/split-screen/job/${jobId}`);
        return j.body["state"] === "done";
      }, 30_000);
      expect(done).toBe(true);
    },
    90_000,
  );

  it(
    "detached render failure refunds + voids; retry charges fresh",
    async () => {
      h.downloadMode = "fail";
      // Distinct clips from the first test: the intent key differs, so
      // this test's ledger/storage state is independent of test 1's
      // completed job (each test's charge counts start from its own
      // beforeEach reset, but the route's job map is module-level).
      const fresh = await post("/split-screen/apply", {
        clips: [{ url: "https://media.example/c.mp4" }, { url: "https://media.example/d.mp4" }],
        layout: "side-by-side",
      });
      expect(fresh.status).toBe(202);
      expect(h.charges).toHaveLength(1);
      const refunded = await waitFor(() => h.refunds.length === 1 && h.voids.length === 1, 60_000);
      expect(refunded).toBe(true);
      expect(h.refunds[0]!.amount).toBe(200);

      h.downloadMode = "ok";
      const retry = await post("/split-screen/apply", {
        clips: [{ url: "https://media.example/c.mp4" }, { url: "https://media.example/d.mp4" }],
        layout: "side-by-side",
      });
      expect(retry.status).toBe(202);
      expect(retry.body["jobId"]).not.toBe(fresh.body["jobId"]);
      expect(h.charges).toHaveLength(2);
    },
    90_000,
  );
});

/* ══ Pattern B — stem-splitter (multipart job, demucs absent here) ═════ */
describe("stem-splitter (Pattern B multipart job)", () => {
  function audioForm() {
    const form = new FormData();
    form.append("audio", new Blob([h.wavBytes], { type: "audio/wav" }), "take.wav");
    return form;
  }

  it(
    "fresh 202 charges 400 once; replay returns the same job; job failure refunds + voids; retry charges fresh",
    async () => {
      const fresh = await postForm("/stems", audioForm());
      expect(fresh.status).toBe(202);
      const jobId = fresh.body["jobId"] as string;
      expect(typeof jobId).toBe("string");
      expect(h.charges).toHaveLength(1);
      expect(h.charges[0]!.amount).toBe(400);

      const replay = await postForm("/stems", audioForm());
      expect(replay.status).toBe(202);
      expect(replay.body["replayed"]).toBe(true);
      expect(replay.body["jobId"]).toBe(jobId);
      expect(h.charges).toHaveLength(1);

      // demucs is not installed in this environment, so the detached job
      // fails fast — its refund must void the charge key.
      const refunded = await waitFor(() => h.refunds.length === 1 && h.voids.length === 1, 25_000);
      expect(refunded).toBe(true);
      expect(h.refunds[0]!.amount).toBe(400);

      const retry = await postForm("/stems", audioForm());
      expect(retry.status).toBe(202);
      expect(retry.body["jobId"]).not.toBe(jobId);
      expect(h.charges).toHaveLength(2);
    },
    90_000,
  );
});

/* ══ Pattern B — streamer-clips cut (helper dedupe) ════════════════════ */
describe("streamer-clips cut (Pattern B, helper-level dedupe)", () => {
  it(
    "fresh 202 charges 200 once; replay returns the same job free",
    async () => {
      const reqBody = {
        videoRef: "media/vod1.mp4",
        clips: [{ startSec: 0, endSec: 5, title: "Opener" }],
      };
      const fresh = await post("/streamer-clips/cut", reqBody);
      expect(fresh.status).toBe(202);
      const jobId = fresh.body["jobId"] as string;
      expect(typeof jobId).toBe("string");
      expect(h.charges).toHaveLength(1);
      expect(h.charges[0]!.amount).toBe(200);

      // The durable row is written when the cut LANDS — poll the job to
      // done first, then the replay is served from the stored body.
      const cutDone = await waitFor(async () => {
        const j = await getJson(`/streamer-clips/cut/${jobId}`);
        return j.body["status"] === "done" || j.body["state"] === "done";
      }, 30_000);
      expect(cutDone).toBe(true);

      const replay = await post("/streamer-clips/cut", reqBody);
      expect(replay.status).toBe(202);
      expect(replay.body["replayed"]).toBe(true);
      expect(replay.body["jobId"]).toBe(jobId);
      expect(h.charges).toHaveLength(1);

      const done = await waitFor(async () => {
        const j = await getJson(`/streamer-clips/cut/${jobId}`);
        return j.body["status"] === "done" || j.body["state"] === "done";
      }, 30_000);
      expect(done).toBe(true);
    },
    90_000,
  );
});

/* ══ Pattern D — song-harmony (pre-check at the charge point) ══════════ */
describe("song-harmony (Pattern D — pre-check at the charge point)", () => {
  it(
    "fresh renders + charges once + one library row; replay charges nothing and inserts nothing",
    async () => {
      const reqBody = {
        audioUrl: "https://media.example/song.wav",
        mode: "classic",
        style: "thirds",
        mixLevel: 35,
      };
      const fresh = await post("/generate-harmony", reqBody);
      expect(fresh.status).toBe(200);
      const songObj = fresh.body["song"] as Record<string, unknown>;
      expect(songObj["id"]).toBe("song-row-1");
      expect(h.charges).toHaveLength(1);
      expect(h.charges[0]!.amount).toBeGreaterThan(0);
      expect(h.songRows).toHaveLength(1);

      const replay = await post("/generate-harmony", reqBody);
      expect(replay.status).toBe(200);
      expect(replay.body["replayed"]).toBe(true);
      expect((replay.body["song"] as Record<string, unknown>)["id"]).toBe("song-row-1");
      expect(h.charges).toHaveLength(1); // Pattern D: the charge point is what the guard protects
      expect(h.songRows).toHaveLength(1); // and no second library row
    },
    120_000,
  );
});
