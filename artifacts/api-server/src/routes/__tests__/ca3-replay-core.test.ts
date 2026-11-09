/**
 * CA-3 (charge-audit batch B3) — EXPOSED-REPLAY fixes, core rails.
 *
 * Pins the house pattern for the generate i–l sync rails: a
 * server-derived idempotency key on every charge, a stored-result
 * pre-check BEFORE funding (durable table via
 * lib/generation-stored-results + the in-process cache), replays
 * served verbatim + replayed:true + the rail's replayNote with ZERO
 * additional charges and ZERO additional provider calls, fresh
 * responses byte-identical, and every refund path VOIDING its key
 * so a genuine retry charges fresh.
 *
 * Invoice is Pattern C: the stored result carries the created
 * invoice row — a replay must return it WITHOUT inserting a second
 * invoice (asserted against the fake invoice table).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = "user-1";

const h = vi.hoisted(() => ({
  balance: 100_000,
  charges: [] as Array<{ amount: number; key: string }>,
  refunds: [] as number[],
  voids: [] as string[],
  chargedKeys: new Set<string>(),
  stored: new Map<string, { userId: string; rail: string; result: any }>(),
  chatCalls: 0,
  chatMode: "ok" as "ok" | "throw",
  chatContent: "{}",
  imageCalls: 0,
  invoices: [] as Array<Record<string, unknown>>,
  invoiceInsertMode: "ok" as "ok" | "throw",
  transcribeCalls: 0,
  transcribeMode: "ok" as "ok" | "throw",
  coverCalls: 0,
  coverFailCalls: new Set<number>(),
}));

function keyFromCondition(cond: unknown): string | null {
  const walk = (node: unknown, depth: number): string | null => {
    if (node === null || typeof node !== "object" || depth > 6) return null;
    if ((node as { constructor?: { name?: string } }).constructor?.name === "Param") {
      const v = (node as { value?: unknown }).value;
      return typeof v === "string" ? v : null;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = walk(child, depth + 1);
        if (hit !== null) return hit;
      }
      return null;
    }
    const chunks = (node as { queryChunks?: unknown }).queryChunks;
    return Array.isArray(chunks) ? walk(chunks, depth + 1) : null;
  };
  return walk(cond, 0);
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER;
    req.userCredits = h.balance;
    req.log = { info() {}, error() {}, warn() {} };
    next();
  },
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error { readonly code = "OUT_OF_CREDITS"; }
  class LedgerWriteError extends Error { readonly code = "LEDGER_WRITE"; }
  return {
    OutOfCreditsError,
    LedgerWriteError,
    buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) =>
      typeof clientKey === "string" && clientKey.trim().length >= 8
        ? `${scope}:${userId}:client:${clientKey.trim()}`
        : `${scope}:${userId}:${JSON.stringify(intent)}`,
    chargeCredits: async (_userId: string, amount: number, _meta: unknown, opts?: { idempotencyKey?: string | null }) => {
      const key = opts?.idempotencyKey ?? "";
      if (key && h.chargedKeys.has(key)) return h.balance; // ledger replay suppression
      if (h.balance < amount) throw new OutOfCreditsError("out");
      h.balance -= amount;
      if (key) h.chargedKeys.add(key);
      h.charges.push({ amount, key });
      return h.balance;
    },
    refundCredits: async (_userId: string, amount: number) => {
      h.balance += amount;
      h.refunds.push(amount);
      return h.balance;
    },
    voidChargeIdempotencyKey: async (key: string) => {
      h.voids.push(key);
      return h.chargedKeys.delete(key);
    },
  };
});

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          h.chatCalls++;
          if (h.chatMode === "throw") throw new Error("provider down");
          return { choices: [{ message: { content: h.chatContent } }] };
        },
      },
    },
    images: {
      generate: async () => {
        h.imageCalls++;
        return { data: [{ b64_json: "aW1hZ2UtYnl0ZXM=" }] };
      },
      edit: async () => {
        h.imageCalls++;
        return { data: [{ b64_json: "aW1hZ2UtYnl0ZXM=" }] };
      },
    },
  }),
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async (objectName: string) => `storage-ref:${objectName}`,
  refreshSupabaseStorageUrl: async (ref: string) => `https://signed.example/${ref}`,
  normalizeToStorageRef: (u: string) => u,
  uploadPublicMediaToR2: async (_bucket: string, key: string) => `https://cdn.example/${key}`,
  parseSupabaseStorageRefBucketed: () => null,
  downloadStorageObjectBuffer: async () => null,
}));

vi.mock("../../lib/transcription", () => ({
  transcribeAudioTimed: async () => {
    h.transcribeCalls++;
    if (h.transcribeMode === "throw") throw new Error("whisper down");
    return {
      words: [
        { word: "hello", start: 0, end: 0.5 },
        { word: "world", start: 0.5, end: 1 },
        { word: "foo", start: 1, end: 1.5 },
        { word: "bar", start: 1.5, end: 2 },
        { word: "baz", start: 2, end: 2.5 },
      ],
      duration: 3,
    };
  },
}));

vi.mock("../generate/cover-art", () => ({
  generateCoverImageBuffer: async () => {
    const call = h.coverCalls++;
    if (h.coverFailCalls.has(call)) throw new Error("image provider down");
    return Buffer.from("card-image-bytes");
  },
  storeGeneratedArtwork: async (_userId: string, _buf: Buffer, kind: string) => ({
    url: `https://cdn.example/${kind}/card.png`,
  }),
}));

/* @workspace/db fake: the stored-results table (by-key Map) plus the
   invoices table (array) — the only two db surfaces these rails use. */
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => ({
          limit: async () => {
            const key = keyFromCondition(cond);
            const row = key !== null ? h.stored.get(key) : undefined;
            return row ? [row] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: async () => {
          if (typeof v["idempotencyKey"] === "string") {
            if (!h.stored.has(v["idempotencyKey"])) {
              h.stored.set(v["idempotencyKey"], {
                userId: v["userId"] as string,
                rail: v["rail"] as string,
                result: v["result"],
              });
            }
          }
          return [];
        },
        returning: async () => {
          if (h.invoiceInsertMode === "throw") throw new Error("invoice insert failed");
          const row = {
            ...v,
            id: `inv-${h.invoices.length + 1}`,
            createdAt: new Date(),
            paidAt: null,
          };
          h.invoices.push(row);
          return [row];
        },
      }),
    }),
    execute: async () => ({ rows: [{ c: h.invoices.length }] }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    delete: () => ({ where: async () => [] }),
  };
  return { ...actual, db: fakeDb };
});

import lyricsRouter, { __resetLyricsGeneratorReplayCache } from "../generate/lyrics-generator";
import ideaRouter, { __resetIdeaValidatorReplayCache } from "../generate/idea-validator";
import llcRouter, { __resetLlcGuideReplayCache } from "../generate/llc-guide";
import interviewRouter, { __resetInterviewPrepReplayCache } from "../generate/interview-prep";
import labelPitchRouter, { __resetLabelPitchReplayCache } from "../generate/label-pitch";
import linkToHitRouter, { __resetLinkToHitReplayCache } from "../generate/link-to-hit";
import jewelryRouter, { __resetJewelryReplayCache } from "../generate/jewelry";
import invoiceRouter, { __resetInvoiceReplayCache } from "../generate/invoice";
import lyricStoriesRouter, { __resetLyricStoriesReplayCache } from "../generate/lyric-stories";
import lyricVideoRouter, {
  __resetLyricVideoReplayCache,
  __clearLyricRenderJobs,
} from "../generate/lyric-video";

let base = "";
let server: ReturnType<express.Express["listen"]>;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  process.env["OPENAI_API_KEY"] = "test-key-not-real";
  const app = express();
  app.use(express.json());
  app.use(lyricsRouter);
  app.use(ideaRouter);
  app.use(llcRouter);
  app.use(interviewRouter);
  app.use(labelPitchRouter);
  app.use(linkToHitRouter);
  app.use(jewelryRouter);
  app.use(invoiceRouter);
  app.use(lyricStoriesRouter);
  app.use(lyricVideoRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  delete process.env["OPENAI_API_KEY"];
  vi.unstubAllGlobals();
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  __resetLyricsGeneratorReplayCache();
  __resetIdeaValidatorReplayCache();
  __resetLlcGuideReplayCache();
  __resetInterviewPrepReplayCache();
  __resetLabelPitchReplayCache();
  __resetLinkToHitReplayCache();
  __resetJewelryReplayCache();
  __resetInvoiceReplayCache();
  __resetLyricStoriesReplayCache();
  __resetLyricVideoReplayCache();
  __clearLyricRenderJobs();
  h.balance = 100_000;
  h.charges = []; h.refunds = []; h.voids = [];
  h.chargedKeys = new Set();
  h.stored = new Map();
  h.chatCalls = 0; h.chatMode = "ok"; h.chatContent = "{}";
  h.imageCalls = 0;
  h.invoices = []; h.invoiceInsertMode = "ok";
  h.transcribeCalls = 0; h.transcribeMode = "ok";
  h.coverCalls = 0; h.coverFailCalls = new Set();
  /* Global fetch: idea-validator calls OpenAI directly; everything
     else (oEmbed etc.) fails soft. */
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes("api.openai.com")) {
      if (h.chatMode === "throw") {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: h.chatContent } }] }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }));
});

async function post(path: string, body?: unknown) {
  const res = await realFetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null };
}

async function postForm(path: string, form: FormData) {
  const res = await realFetch(`${base}${path}`, { method: "POST", body: form });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null };
}

describe("lyrics-generator — CA-3 replay", () => {
  const body = { theme: "midnight drive through the city", genre: "pop", mood: "bold" };

  it("fresh charges once; the replay is served stored — no second charge, no second provider call", async () => {
    h.chatContent = "[Verse 1]\nRiding through the city lights\n[Chorus]\nWe shine tonight";
    const a = await post("/generate-lyrics", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.chatCalls).toBe(1);
    expect(h.stored.size).toBe(1);

    const b = await post("/generate-lyrics", body);
    expect(b.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toBe(1);
    expect(b.json).toEqual({
      ...a.json,
      replayed: true,
      replayNote: "These are the lyrics you already made for this request — tweak the theme, genre or mood for a fresh set.",
    });
  });

  it("concurrent duplicates land ONE charge and ONE provider call", async () => {
    h.chatContent = "[Verse 1]\nConcurrent words\n[Chorus]\nOne charge only";
    const [a, b] = await Promise.all([
      post("/generate-lyrics", body),
      post("/generate-lyrics", body),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toBe(1);
    const replayed = [a.json, b.json].filter((j) => j?.["replayed"] === true);
    expect(replayed).toHaveLength(1);
  });

  it("a provider failure refunds and VOIDS the key; the retry charges fresh", async () => {
    h.chatMode = "throw";
    const failed = await post("/generate-lyrics", body);
    expect(failed.status).not.toBe(200);
    expect(h.refunds).toEqual([100]);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.chatMode = "ok";
    h.chatContent = "[Verse 1]\nSecond try\n[Chorus]\nFresh charge";
    const retry = await post("/generate-lyrics", body);
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });
});

describe("idea-validator — CA-3 replay", () => {
  const body = { idea: "ranking my beats from worst to best", niche: "music production", platform: "youtube" };
  const verdict = JSON.stringify({
    verdict: "go",
    overallScore: 82,
    virality: { label: "High", score: 85, reasoning: "r" },
    competition: { label: "Low", score: 70, reasoning: "r" },
    audienceFit: { label: "Strong", score: 80, reasoning: "r" },
    strengths: ["s1"],
    risks: ["r1"],
    pivots: [{ angle: "a", whyItWorks: "w" }],
    summary: "Solid.",
  });

  it("fresh charges once; the replay is served stored — no second charge, no second provider call", async () => {
    h.chatContent = verdict;
    const a = await post("/validate-idea", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(75);

    const b = await post("/validate-idea", body);
    expect(b.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(b.json).toEqual({ ...a.json, replayed: true, replayNote: b.json?.["replayNote"] });
    expect(typeof b.json?.["replayNote"]).toBe("string");
  });

  it("a provider failure refunds and VOIDS the key; the retry charges fresh", async () => {
    h.chatMode = "throw";
    const failed = await post("/validate-idea", body);
    expect(failed.status).not.toBe(200);
    expect(h.refunds).toEqual([75]);
    expect(h.voids).toHaveLength(1);

    h.chatMode = "ok";
    h.chatContent = verdict;
    const retry = await post("/validate-idea", body);
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });
});

describe("llc-guide — CA-3 replay (shared charge helper, two products)", () => {
  it("ask: fresh charges once; replay served stored; plan does NOT collide with ask", async () => {
    h.chatContent = "Form an LLC in your state first.";
    const askBody = { question: "Do I need an LLC for my music money?", state: "CA" };
    const a = await post("/llc-guide/ask", askBody);
    expect(a.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.chatCalls).toBe(1);

    const b = await post("/llc-guide/ask", askBody);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toBe(1);

    /* Same scope, different product: the plan rail must charge its own. */
    h.chatContent = JSON.stringify({
      title: "Plan",
      steps: [{ title: "File articles", detail: "File with the state", estCost: "$50", timeline: "1 week" }],
      totalEstimate: "$50",
      notes: [],
    });
    const p = await post("/llc-guide/plan", { state: "CA", creatorType: "musician" });
    expect(p.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });

  it("ask failure refunds and VOIDS; retry charges fresh", async () => {
    h.chatMode = "throw";
    const failed = await post("/llc-guide/ask", { question: "What is an EIN number?" });
    expect(failed.status).not.toBe(200);
    expect(h.refunds).toEqual([100]);
    expect(h.voids).toHaveLength(1);

    h.chatMode = "ok";
    h.chatContent = "An EIN is a tax ID.";
    const retry = await post("/llc-guide/ask", { question: "What is an EIN number?" });
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });
});

describe("interview-prep — CA-3 replay (shared charge helper)", () => {
  const body = { interviewType: "podcast", artistName: "Thy Cheat Code", genre: "hip-hop" };
  const session = JSON.stringify({
    questions: [1, 2, 3, 4].map((i) => ({
      question: `Question ${i}?`,
      category: "warmup",
      tip: "Keep it short.",
    })),
    talkingPoints: ["Point one", "Point two"],
  });

  it("session: fresh charges 200 once; replay served stored", async () => {
    h.chatContent = session;
    const a = await post("/interview-prep/session", body);
    expect(a.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(200);
    expect(h.chatCalls).toBe(1);

    const b = await post("/interview-prep/session", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toBe(1);
  });

  it("unusable output refunds and VOIDS; retry charges fresh", async () => {
    h.chatContent = "{}"; // parses to no questions → unusable → refund path
    const failed = await post("/interview-prep/session", body);
    expect(failed.status).toBe(502);
    expect(h.refunds).toEqual([200]);
    expect(h.voids).toHaveLength(1);

    h.chatContent = session;
    const retry = await post("/interview-prep/session", body);
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });
});

describe("label-pitch — CA-3 replay", () => {
  const body = { songTitle: "Midnight Run", songDescription: "A late-night anthem" };
  const kit = JSON.stringify({
    analysis: {
      genre: "pop",
      mood: "upbeat",
      energy: 80,
      tempoFeel: "driving",
      comparableArtists: ["A"],
      labelFit: ["L"],
      oneLiner: "A late-night anthem",
    },
    submissionEmail: { subject: "Demo: Midnight Run", body: "Hello label team" },
    oneSheet: "One sheet text",
    followUp: "Following up text",
  });

  it("fresh charges 300 once; replay served stored", async () => {
    h.chatContent = kit;
    const a = await post("/label-pitch/kit", body);
    expect(a.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(300);
    expect(h.chatCalls).toBe(1);

    const b = await post("/label-pitch/kit", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toBe(1);
  });
});

describe("link-to-hit — CA-3 replay", () => {
  const body = { description: "A comedian reacts to his own old videos", genre: "comedy" };
  const pack = JSON.stringify({
    comedyConcept: "React and remake",
    segments: [{ type: "generated", description: "Recreate the intro", prompt: "studio intro" }],
    songTitle: "Hit Song",
    hook: "the hook",
    songLyrics: "la la la",
    musicPrompt: "upbeat pop",
  });

  it("fresh charges 300 once; replay served stored", async () => {
    h.chatContent = pack;
    const a = await post("/link-to-hit/analyze", body);
    expect(a.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(300);
    expect(h.chatCalls).toBe(1);

    const b = await post("/link-to-hit/analyze", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toBe(1);
  });

  it("provider failure refunds and VOIDS; retry charges fresh", async () => {
    h.chatMode = "throw";
    const failed = await post("/link-to-hit/analyze", body);
    expect(failed.status).not.toBe(200);
    expect(h.refunds).toEqual([300]);
    expect(h.voids).toHaveLength(1);

    h.chatMode = "ok";
    h.chatContent = pack;
    const retry = await post("/link-to-hit/analyze", body);
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });
});

describe("jewelry — CA-3 replay (consult + design)", () => {
  it("consult: fresh charges 100 once; replay served stored; failure refunds+voids", async () => {
    h.chatContent = "Gold suits you.";
    const body = { message: "What metal fits a daily-wear pendant?", history: [] };
    const a = await post("/jewelry/consult", body);
    expect(a.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.chatCalls).toBe(1);

    const b = await post("/jewelry/consult", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.chatCalls).toBe(1);

    h.chatMode = "throw";
    const failed = await post("/jewelry/consult", { message: "And for a ring?", history: [] });
    expect(failed.status).not.toBe(200);
    expect(h.refunds).toEqual([100]);
    expect(h.voids).toHaveLength(1);
  });

  it("design (multipart, file-hash intent): fresh charges 200 once; replay served stored", async () => {
    const form = () => {
      const f = new FormData();
      f.append("category", "jewelry");
      f.append("piece", "watch");
      f.append("metal", "white-18k");
      f.append("stone", "moissanite");
      f.append("style", "minimal");
      f.append("logo", new Blob([Buffer.from("logo-bytes")], { type: "image/png" }), "logo.png");
      return f;
    };
    const a = await postForm("/jewelry/design", form());
    expect(a.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(200);
    expect(h.imageCalls).toBe(1);

    const b = await postForm("/jewelry/design", form());
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.imageCalls).toBe(1);
  });
});

describe("invoice — CA-3 Pattern C (replay never inserts a second invoice)", () => {
  const body = {
    brandName: "Acme Corp",
    creatorName: "Thy Cheat Code",
    lineItems: [{ description: "Brand gig", quantity: 1, rateCents: 5000 }],
    dueDate: "2027-01-01",
    currency: "USD",
  };

  it("fresh charges 50 and inserts ONE invoice; the replay returns the SAME invoice — still one row, one charge", async () => {
    const a = await post("/generate-invoice", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(50);
    expect(h.invoices).toHaveLength(1);
    const invoiceId = a.json?.["invoice"]?.["id"];
    const invoiceNumber = a.json?.["invoice"]?.["invoiceNumber"];
    expect(invoiceId).toBeTruthy();

    const b = await post("/generate-invoice", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(b.json?.["invoice"]?.["id"]).toBe(invoiceId);
    expect(b.json?.["invoice"]?.["invoiceNumber"]).toBe(invoiceNumber);
    expect(h.invoices).toHaveLength(1); // NO second invoice row
    expect(h.charges).toHaveLength(1); // NO second charge
  });

  it("an insert failure refunds and VOIDS; the retry charges fresh and inserts exactly one invoice", async () => {
    h.invoiceInsertMode = "throw";
    const failed = await post("/generate-invoice", body);
    expect(failed.status).toBe(502);
    expect(h.refunds).toEqual([50]);
    expect(h.voids).toHaveLength(1);
    expect(h.invoices).toHaveLength(0);

    h.invoiceInsertMode = "ok";
    const retry = await post("/generate-invoice", body);
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
    expect(h.invoices).toHaveLength(1);
  });
});

describe("lyric-stories — CA-3 replay (incl. partial-success storage)", () => {
  const body = { lyrics: "line one\nline two\nline three", count: 3, style: "" };
  const moments = JSON.stringify({
    moments: [1, 2, 3].map((i) => ({
      lyricExcerpt: `line ${i}`,
      visualDescription: `scene ${i}`,
    })),
  });

  it("fresh charges 600 once (3 cards); replay served stored — planner + image pipeline not re-run", async () => {
    h.chatContent = moments;
    const a = await post("/lyric-stories/generate", body);
    expect(a.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(600);
    expect(h.coverCalls).toBe(3);

    const b = await post("/lyric-stories/generate", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.coverCalls).toBe(3);
  });

  it("partial success refunds the failed card's share, is STORED, and does NOT void", async () => {
    h.chatContent = moments;
    h.coverFailCalls = new Set([1]); // second card's image fails
    const a = await post("/lyric-stories/generate", body);
    expect(a.status).toBe(200);
    expect(a.json?.["partial"]).toBe(true);
    expect(h.refunds).toEqual([200]); // one card's share back
    expect(h.voids).toHaveLength(0); // partial success keeps the key

    const b = await post("/lyric-stories/generate", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);
  });

  it("total failure refunds everything and VOIDS; retry charges fresh", async () => {
    h.chatContent = moments;
    h.coverFailCalls = new Set([0, 1, 2]);
    const failed = await post("/lyric-stories/generate", body);
    expect(failed.status).toBe(502);
    expect(h.refunds).toEqual([600]);
    expect(h.voids).toHaveLength(1);

    h.coverFailCalls = new Set();
    const retry = await post("/lyric-stories/generate", body);
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });
});

describe("lyric-video align — CA-3 replay", () => {
  const form = () => {
    const f = new FormData();
    f.append("lyrics", "hello world\nfoo bar baz");
    f.append("audio", new Blob([Buffer.from("fake-audio")], { type: "audio/mpeg" }), "song.mp3");
    return f;
  };

  it("fresh charges 200 once; replay served stored — transcription not re-run", async () => {
    const a = await postForm("/lyric-video/align", form());
    expect(a.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(200);
    expect(h.transcribeCalls).toBe(1);

    const b = await postForm("/lyric-video/align", form());
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.transcribeCalls).toBe(1);
  });

  it("transcription failure refunds and VOIDS; retry charges fresh", async () => {
    h.transcribeMode = "throw";
    const failed = await postForm("/lyric-video/align", form());
    expect(failed.status).not.toBe(200);
    expect(h.refunds).toEqual([200]);
    expect(h.voids).toHaveLength(1);

    h.transcribeMode = "ok";
    const retry = await postForm("/lyric-video/align", form());
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2);
  });
});
