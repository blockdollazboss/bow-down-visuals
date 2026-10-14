/**
 * Behavioral tests for the free-AI rate limiters (lib/rate-limit.ts).
 *
 * POST /api/improve-prompt and POST /api/improve-style are FREE (no
 * credit charge) but call the paid text model on every request. They
 * are capped by freeAiLimiter: 30 requests/hour per user, keyed on
 * the authenticated userId. These tests mount the REAL routers with
 * the REAL limiter, a mocked requireAuth (controllable user) and a
 * mocked OpenAI client (no network, no provider spend):
 *
 *   - under the limit, requests pass (200)
 *   - the 31st request in the hour is a 429 with the { error } shape
 *   - the budget is per-user: a second user is unaffected
 *   - the budget is shared across both improve endpoints (one
 *     limiter instance = one free-AI budget per user)
 *
 * A final block guards the wiring of the other free endpoints that
 * were capped in the same pass (source-shape assertions, following
 * the gamers.test.ts precedent).
 *
 * EXTENDED (owner's 2026-10-14 ruling — "charge what's displayed"):
 * the endpoints whose UI displayed a price but whose server never
 * charged now charge exactly the displayed price server-side:
 * /analyze-sections 100, /generate/ai-edit-plan 100, /transcribe 100,
 * /transcribe-url 100, /lip-sync/preview 300, and the vault voice
 * clone at 200 (mirroring its from-song sibling). The blocks below
 * pin the charged behavior for the four light routers behaviorally
 * (real routers, fake credits lib): charge lands once per
 * idempotency key, insufficient balance returns the standard 402 and
 * makes NO provider call, and a provider failure refunds. The two
 * heavy routers (lip-sync, artist-voices) are pinned by source-shape
 * guards in the wiring block, per the existing precedent.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testState = vi.hoisted(() => ({
  userId: "user-a" as string | null,
  userCredits: 100_000 as number,
}));

/* Controllable provider behavior for the charged-endpoint blocks. */
const aiState = vi.hoisted(() => ({
  chatContent: "polished result",
  chatFails: false,
  chatCalls: 0,
  transcribeFails: false,
  transcribeCalls: 0,
  planFails: false,
  planCalls: 0,
  planContent: JSON.stringify({
    style: "viral-tiktok",
    transitionPlan: [],
    effectsPlan: ["Film Grain"],
    colorGrade: "Vibrant Pop",
    captionStylePreset: "viral-shorts",
    beatCutNotes: "cuts on beats",
    introPlan: "open strong",
    outroPlan: "fade out",
    sceneEditNotes: [],
    exportSettings: {},
  }),
  reset() {
    this.chatContent = "polished result";
    this.chatFails = false;
    this.chatCalls = 0;
    this.transcribeFails = false;
    this.transcribeCalls = 0;
    this.planFails = false;
    this.planCalls = 0;
  },
}));

/* Fake credits ledger: records every deduction/refund, suppresses a
   second deduction under an already-charged idempotency key (the
   real chargeCredits contract), and can be told to fail charges. */
const creditState = vi.hoisted(() => ({
  balance: 100_000,
  deductions: [] as Array<{ userId: string; cost: number; action: string; key: string | null }>,
  refunds: [] as Array<{ userId: string; amount: number; action: string }>,
  chargedKeys: new Set<string>(),
  failMode: null as null | "out_of_credits" | "ledger",
  reset() {
    this.balance = 100_000;
    this.deductions = [];
    this.refunds = [];
    this.chargedKeys = new Set<string>();
    this.failMode = null;
  },
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!testState.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = testState.userId;
    req.userCredits = testState.userCredits;
    next();
  },
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          aiState.chatCalls++;
          if (aiState.chatFails) throw new Error("chat provider boom");
          return { choices: [{ message: { content: aiState.chatContent } }] };
        },
      },
    },
    audio: {
      transcriptions: {
        create: async () => {
          aiState.transcribeCalls++;
          if (aiState.transcribeFails) throw new Error("transcribe provider boom");
          return { text: "hello transcript", segments: [], words: [], duration: 3, language: "en" };
        },
      },
    },
  }),
  getTextModel: () => "test-model",
  getPlainTranscribeModel: () => "gpt-transcribe",
}));

/* The "openai" package itself: ai-edit-plan constructs its own client
   from it, and transcribe.ts imports toFile from it. The fake plan
   client is driven by aiState; toFile just wraps the upload. */
vi.mock("openai", () => {
  class FakeOpenAI {
    static APIError = class APIError extends Error {};
    chat = {
      completions: {
        create: async () => {
          aiState.planCalls++;
          if (aiState.planFails) throw new Error("plan provider boom");
          return { choices: [{ message: { content: aiState.planContent } }] };
        },
      },
    };
    constructor(_opts?: unknown) {}
  }
  return {
    default: FakeOpenAI,
    toFile: async (buffer: unknown, name?: string) => ({ name: name ?? "audio.mp3", buffer }),
  };
});

vi.mock("../../../lib/credits", () => {
  class OutOfCreditsError extends Error {
    readonly status = 402;
    constructor() {
      super("out_of_credits");
      this.name = "OutOfCreditsError";
    }
  }
  class LedgerWriteError extends Error {
    readonly status = 500;
    constructor() {
      super("ledger_write_failed");
      this.name = "LedgerWriteError";
    }
  }
  class CreditsDisabledError extends Error {
    readonly status = 403;
    constructor() {
      super("credits_disabled");
      this.name = "CreditsDisabledError";
    }
  }
  return {
    OutOfCreditsError,
    LedgerWriteError,
    CreditsDisabledError,
    /* Mirrors the real helper's contract: client key wins (scoped),
       otherwise a deterministic function of (scope, user, intent) —
       identical intents yield identical keys. */
    buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) => {
      if (typeof clientKey === "string" && clientKey.trim().length >= 8) {
        return `${scope}:${userId}:client:${clientKey.trim()}`;
      }
      const s = typeof intent === "string" ? intent : (JSON.stringify(intent) ?? "");
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
      return `${scope}:${userId}:h${h}`;
    },
    chargeCredits: async (
      userId: string,
      cost: number,
      record: { action: string },
      opts?: { idempotencyKey?: string | null },
    ) => {
      if (creditState.failMode === "out_of_credits") throw new OutOfCreditsError();
      if (creditState.failMode === "ledger") throw new LedgerWriteError();
      const key = opts?.idempotencyKey ?? null;
      if (key && creditState.chargedKeys.has(key)) return creditState.balance;
      if (creditState.balance < cost) throw new OutOfCreditsError();
      creditState.balance -= cost;
      if (key) creditState.chargedKeys.add(key);
      creditState.deductions.push({ userId, cost, action: record.action, key });
      return creditState.balance;
    },
    refundCredits: async (userId: string, amount: number, record: { action: string }) => {
      creditState.balance += amount;
      creditState.refunds.push({ userId, amount, action: record.action });
    },
  };
});

import improvePromptRouter from "../improve-prompt";
import improveStyleRouter from "../improve-style";
import aiEditPlanRouter from "../ai-edit-plan";
import analyzeSectionsRouter from "../../analyze-sections";
import transcribeRouter from "../../transcribe";

let baseUrl = "";
let server: ReturnType<typeof express.application.listen>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Minimal stand-in for pino-http's req.log, used on error paths.
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use(improvePromptRouter);
  app.use(improveStyleRouter);
  app.use(aiEditPlanRouter);
  app.use(analyzeSectionsRouter);
  app.use(transcribeRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(pathname: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function postForm(pathname: string, form: FormData): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${pathname}`, { method: "POST", body: form });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function audioForm(bytes: string): FormData {
  const form = new FormData();
  form.append("audio", new Blob([Buffer.from(bytes)], { type: "audio/mpeg" }), "song.mp3");
  return form;
}

describe("freeAiLimiter on the improve endpoints", () => {
  it("lets a user under the hourly limit through on /improve-style (200)", async () => {
    testState.userId = "user-style";
    const res = await post("/improve-style", { style: "dark rb slow vibes" });
    expect(res.status).toBe(200);
    expect(res.json?.improvedStyle).toBe("polished result");
  });

  it("429s the same user once 30 free calls are used in the hour", async () => {
    testState.userId = "user-style";
    // 1 call already made above; 29 more reach the cap of 30.
    for (let i = 0; i < 29; i++) {
      const res = await post("/improve-style", { style: "dark rb slow vibes" });
      expect(res.status).toBe(200);
    }
    const over = await post("/improve-style", { style: "dark rb slow vibes" });
    expect(over.status).toBe(429);
    expect(over.json?.error).toMatch(/hourly limit/i);
  });

  it("shares one budget across both improve endpoints", async () => {
    testState.userId = "user-style"; // already at the cap from the test above
    const res = await post("/improve-prompt", { prompt: "a singer on stage" });
    expect(res.status).toBe(429);
  });

  it("does not limit a different user (per-user isolation)", async () => {
    testState.userId = "user-other";
    const style = await post("/improve-style", { style: "lofi chill beats" });
    expect(style.status).toBe(200);
    const prompt = await post("/improve-prompt", { prompt: "a singer on stage" });
    expect(prompt.status).toBe(200);
    expect(prompt.json?.improvedPrompt).toBe("polished result");
  });
});

/* ── Charged behavior: the displayed prices are now charged ──────────
   Each block: fresh fake ledger + a distinct user (the shared
   freeAiLimiter budget is per-user, so this also keeps the limiter
   out of the way). testState.userCredits drives the routes' balance
   fast-fail; creditState drives chargeCredits itself. */

describe("POST /analyze-sections charges the displayed 100 VB", () => {
  beforeEach(() => {
    creditState.reset();
    aiState.reset();
    aiState.chatContent = JSON.stringify({ hasTimestamps: false, sections: [] });
    testState.userCredits = 100_000;
  });

  it("charges 100 once and returns the analysis", async () => {
    testState.userId = "user-analyze-ok";
    const res = await post("/analyze-sections", { lyrics: "verse one lyrics here" });
    expect(res.status).toBe(200);
    expect(res.json?.sections).toEqual([]);
    expect(creditState.deductions).toHaveLength(1);
    expect(creditState.deductions[0]).toMatchObject({ userId: "user-analyze-ok", cost: 100, action: "Analyze Song Sections" });
    expect(creditState.deductions[0]!.key).toMatch(/^analyze-sections:user-analyze-ok:/);
    expect(aiState.chatCalls).toBe(1);
  });

  it("a retry of the same request is NOT charged twice (same idempotency key)", async () => {
    testState.userId = "user-analyze-retry";
    const body = { lyrics: "same lyrics retried twice" };
    const first = await post("/analyze-sections", body);
    const second = await post("/analyze-sections", body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(creditState.deductions).toHaveLength(1);
    expect(creditState.balance).toBe(100_000 - 100);
  });

  it("insufficient balance → standard 402, no charge, NO provider call", async () => {
    testState.userId = "user-analyze-broke";
    testState.userCredits = 50;
    const res = await post("/analyze-sections", { lyrics: "lyrics from a broke user" });
    expect(res.status).toBe(402);
    expect(res.json?.error).toBe("out_of_credits");
    expect(res.json?.required).toBe(100);
    expect(creditState.deductions).toHaveLength(0);
    expect(aiState.chatCalls).toBe(0);
  });

  it("provider failure refunds the charge and keeps the existing 500 shape", async () => {
    testState.userId = "user-analyze-fail";
    aiState.chatFails = true;
    const res = await post("/analyze-sections", { lyrics: "lyrics that make ai fail" });
    expect(res.status).toBe(500);
    expect(res.json?.error).toBe("Analysis failed");
    expect(creditState.deductions).toHaveLength(1);
    expect(creditState.refunds).toHaveLength(1);
    expect(creditState.refunds[0]).toMatchObject({ userId: "user-analyze-fail", amount: 100 });
    expect(creditState.balance).toBe(100_000);
  });
});

describe("POST /generate/ai-edit-plan charges the displayed 100 VB (AI plan only)", () => {
  const planBody = {
    style: "viral-tiktok",
    styleName: "Viral TikTok",
    sceneCount: 3,
    sceneDescriptions: ["intro", "hook", "outro"],
    audioFound: true,
    captionsFound: false,
  };

  beforeEach(() => {
    creditState.reset();
    aiState.reset();
    testState.userCredits = 100_000;
    process.env["OPENAI_API_KEY"] = "test-key";
  });

  it("charges 100 once for the AI plan and reports creditsRemaining", async () => {
    testState.userId = "user-plan-ok";
    const res = await post("/generate/ai-edit-plan", planBody);
    expect(res.status).toBe(200);
    expect(res.json?.source).toBe("ai");
    expect(res.json?.creditsRemaining).toBe(100_000 - 100);
    expect(creditState.deductions).toHaveLength(1);
    expect(creditState.deductions[0]).toMatchObject({ cost: 100, action: "AI Edit Plan" });
    expect(creditState.deductions[0]!.key).toMatch(/^ai-edit-plan:user-plan-ok:/);
    expect(aiState.planCalls).toBe(1);
  });

  it("provider failure serves the free fallback and refunds the charge", async () => {
    testState.userId = "user-plan-fail";
    aiState.planFails = true;
    const res = await post("/generate/ai-edit-plan", planBody);
    expect(res.status).toBe(200);
    expect(res.json?.source).toBe("fallback");
    expect(creditState.deductions).toHaveLength(1);
    expect(creditState.refunds).toHaveLength(1);
    expect(creditState.refunds[0]).toMatchObject({ amount: 100 });
    expect(creditState.balance).toBe(100_000);
  });

  it("no OpenAI key configured → fallback is served free, no charge at all", async () => {
    testState.userId = "user-plan-nokey";
    delete process.env["OPENAI_API_KEY"];
    const res = await post("/generate/ai-edit-plan", planBody);
    expect(res.status).toBe(200);
    expect(res.json?.source).toBe("fallback");
    expect(creditState.deductions).toHaveLength(0);
    expect(aiState.planCalls).toBe(0);
    process.env["OPENAI_API_KEY"] = "test-key";
  });

  it("insufficient balance → standard 402 and NO provider call", async () => {
    testState.userId = "user-plan-broke";
    testState.userCredits = 10;
    const res = await post("/generate/ai-edit-plan", planBody);
    expect(res.status).toBe(402);
    expect(res.json?.error).toBe("out_of_credits");
    expect(res.json?.required).toBe(100);
    expect(creditState.deductions).toHaveLength(0);
    expect(aiState.planCalls).toBe(0);
  });
});

describe("POST /transcribe charges the displayed 100 VB", () => {
  beforeEach(() => {
    creditState.reset();
    aiState.reset();
    testState.userCredits = 100_000;
  });

  it("charges 100 once and returns the transcript", async () => {
    testState.userId = "user-transcribe-ok";
    const res = await postForm("/transcribe", audioForm("fake-audio-bytes"));
    expect(res.status).toBe(200);
    expect(res.json?.transcript).toBe("hello transcript");
    expect(res.json?.creditsRemaining).toBe(100_000 - 100);
    expect(creditState.deductions).toHaveLength(1);
    expect(creditState.deductions[0]).toMatchObject({ cost: 100, action: "Transcribe Audio" });
    expect(creditState.deductions[0]!.key).toMatch(/^transcribe:user-transcribe-ok:/);
    expect(aiState.transcribeCalls).toBe(1);
  });

  it("re-uploading the identical file is NOT charged twice", async () => {
    testState.userId = "user-transcribe-retry";
    const first = await postForm("/transcribe", audioForm("same-file-bytes"));
    const second = await postForm("/transcribe", audioForm("same-file-bytes"));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(creditState.deductions).toHaveLength(1);
    expect(creditState.balance).toBe(100_000 - 100);
  });

  it("insufficient balance → standard 402 and NO provider call", async () => {
    testState.userId = "user-transcribe-broke";
    testState.userCredits = 0;
    const res = await postForm("/transcribe", audioForm("broke-file-bytes"));
    expect(res.status).toBe(402);
    expect(res.json?.error).toBe("out_of_credits");
    expect(res.json?.required).toBe(100);
    expect(creditState.deductions).toHaveLength(0);
    expect(aiState.transcribeCalls).toBe(0);
  });

  it("provider failure refunds the charge and keeps the existing 500 shape", async () => {
    testState.userId = "user-transcribe-fail";
    aiState.transcribeFails = true;
    const res = await postForm("/transcribe", audioForm("failing-file-bytes"));
    expect(res.status).toBe(500);
    expect(res.json?.error).toBe("Transcription failed");
    expect(creditState.deductions).toHaveLength(1);
    expect(creditState.refunds).toHaveLength(1);
    expect(creditState.refunds[0]).toMatchObject({ amount: 100 });
    expect(creditState.balance).toBe(100_000);
  });
});

describe("POST /transcribe-url charges the displayed 100 VB", () => {
  const realFetch = globalThis.fetch;
  const storageBase = process.env["SUPABASE_URL"] ?? "https://storage.example.test";
  const audioUrl = `${storageBase}/storage/v1/object/public/audio/song.mp3`;

  beforeAll(() => {
    /* The route downloads the audio itself via global fetch — serve
       canned storage responses for non-local URLs and delegate the
       test harness's own calls (127.0.0.1) to the real fetch. */
    vi.stubGlobal("fetch", async (url: any, init?: any) => {
      const u = String(url);
      if (u.startsWith(baseUrl)) return realFetch(url, init);
      if (init?.method === "HEAD") {
        return { ok: true, headers: new Headers({ "content-length": "1024" }) } as unknown as Response;
      }
      return {
        ok: true,
        headers: new Headers({ "content-type": "audio/mpeg", "content-length": "1024" }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      } as unknown as Response;
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    creditState.reset();
    aiState.reset();
    testState.userCredits = 100_000;
  });

  it("charges 100 once and returns the timed transcript", async () => {
    testState.userId = "user-transcribe-url-ok";
    const res = await post("/transcribe-url", { audioUrl });
    expect(res.status).toBe(200);
    expect(res.json?.transcript).toBe("hello transcript");
    expect(res.json?.creditsRemaining).toBe(100_000 - 100);
    expect(creditState.deductions).toHaveLength(1);
    expect(creditState.deductions[0]).toMatchObject({ cost: 100, action: "Transcribe" });
    expect(creditState.deductions[0]!.key).toMatch(/^transcribe-url:user-transcribe-url-ok:/);
    expect(aiState.transcribeCalls).toBe(1);
  });

  it("a retry for the same URL is NOT charged twice", async () => {
    testState.userId = "user-transcribe-url-retry";
    const first = await post("/transcribe-url", { audioUrl });
    const second = await post("/transcribe-url", { audioUrl });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(creditState.deductions).toHaveLength(1);
  });

  it("insufficient balance → standard 402 and NO provider call", async () => {
    testState.userId = "user-transcribe-url-broke";
    creditState.failMode = "out_of_credits";
    const res = await post("/transcribe-url", { audioUrl });
    expect(res.status).toBe(402);
    expect(res.json?.error).toBe("out_of_credits");
    expect(res.json?.required).toBe(100);
    expect(creditState.deductions).toHaveLength(0);
    expect(aiState.transcribeCalls).toBe(0);
  });

  it("provider failure refunds the charge", async () => {
    testState.userId = "user-transcribe-url-fail";
    aiState.transcribeFails = true;
    const res = await post("/transcribe-url", { audioUrl });
    expect(res.status).toBe(500);
    expect(creditState.deductions).toHaveLength(1);
    expect(creditState.refunds).toHaveLength(1);
    expect(creditState.refunds[0]).toMatchObject({ amount: 100 });
    expect(creditState.balance).toBe(100_000);
  });
});

describe("the other capped free endpoints stay wired", () => {
  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const cases: Array<[string, string]> = [
    ["routes/analyze-sections.ts", "freeAiLimiter"],
    ["routes/generate/ai-edit-plan.ts", "freeAiLimiter"],
    ["routes/generate/auto-edit.ts", "freeAiLimiter"],
    ["routes/transcribe.ts", "freeAiLimiter"],
    ["routes/lip-sync.ts", "freeExpensiveAiLimiter"],
    ["routes/artist-voices.ts", "freeExpensiveAiLimiter"],
  ];
  for (const [rel, limiter] of cases) {
    it(`${rel} applies ${limiter}`, () => {
      const src = readFileSync(path.join(srcRoot, rel), "utf8");
      expect(src).toContain(`import { ${limiter} } from`);
      expect(src).toContain(limiter);
      // Applied in a route chain, not merely imported.
      expect(src).toMatch(new RegExp(`requireAuth,[^)]*${limiter}`));
    });
  }

  it("routes/generate/demo-clip.ts stays deleted (orphaned endpoint, owner-ruled)", () => {
    // POST /api/generate-demo-clip was a live, FREE Runway video endpoint
    // with no frontend caller anywhere; the owner ruled it deleted. It
    // used to appear in the cases above as a freeExpensiveAiLimiter
    // wiring guard — this asserts its absence instead, so the endpoint
    // can't quietly come back. (freeExpensiveAiLimiter itself stays:
    // lip-sync/preview and the vault clone still use it.)
    expect(existsSync(path.join(srcRoot, "routes/generate/demo-clip.ts"))).toBe(false);
    const index = readFileSync(path.join(srcRoot, "routes/index.ts"), "utf8");
    expect(index).not.toContain("demo-clip");
  });
});

describe("the heavy routers charge their displayed prices (source-shape)", () => {
  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

  it("lip-sync.ts: preview charges 300 BEFORE createLipSyncJob, refunds on enqueue failure", () => {
    const src = readFileSync(path.join(srcRoot, "routes/lip-sync.ts"), "utf8");
    expect(src).toContain("const LIP_SYNC_PREVIEW_CREDIT_COST = 300;");
    const previewStart = src.indexOf('router.post("/lip-sync/preview"');
    expect(previewStart).toBeGreaterThan(-1);
    const previewBlock = src.slice(previewStart, previewStart + 12000);
    // Charge (with an idempotency key) precedes the enqueue; the refund
    // is wired to the enqueue's failure path.
    const chargeIdx = previewBlock.indexOf("chargeCredits(userId, LIP_SYNC_PREVIEW_CREDIT_COST");
    const enqueueIdx = previewBlock.indexOf("createLipSyncJob({");
    const refundIdx = previewBlock.indexOf("refundCredits(userId, LIP_SYNC_PREVIEW_CREDIT_COST");
    expect(chargeIdx).toBeGreaterThan(-1);
    expect(enqueueIdx).toBeGreaterThan(chargeIdx);
    expect(refundIdx).toBeGreaterThan(enqueueIdx);
    expect(previewBlock).toContain("buildChargeIdempotencyKey(");
    expect(previewBlock).toContain('"lip-sync-preview"');
    expect(previewBlock).toContain('error: "out_of_credits"');
  });

  it("artist-voices.ts: vault clone charges 200 like its from-song sibling, refund armed after the charge", () => {
    const src = readFileSync(path.join(srcRoot, "routes/artist-voices.ts"), "utf8");
    expect(src).toContain("const CLONE_CREDIT_COST = 200;");
    expect(src).toContain("const FROM_SONG_CREDIT_COST = 200;");
    const cloneStart = src.indexOf('"/artist-vaults/:id/voice/clone"');
    expect(cloneStart).toBeGreaterThan(-1);
    const cloneBlock = src.slice(cloneStart, src.indexOf("const SetVoiceSchema"));
    // Same shape as from-song: charge inside the try, refund closure
    // armed only after it, IVC gate before any credits move.
    expect(cloneBlock).toContain("chargeCredits(req.userId!, CLONE_CREDIT_COST, { action: \"Vault Voice Clone\" }, { idempotencyKey })");
    expect(cloneBlock).toContain("refundCredits(req.userId!, CLONE_CREDIT_COST");
    expect(cloneBlock).toContain("buildChargeIdempotencyKey(");
    expect(cloneBlock).toContain('"vault-voice-clone"');
    expect(cloneBlock).toContain("canUseInstantVoiceCloning");
    expect(cloneBlock.indexOf("canUseInstantVoiceCloning")).toBeLessThan(
      cloneBlock.indexOf("chargeCredits(req.userId!, CLONE_CREDIT_COST"),
    );
    expect(cloneBlock).toContain('error: "out_of_credits"');
    expect(cloneBlock).toContain("required: CLONE_CREDIT_COST");
    // Provider failure exit refunds before responding.
    expect(cloneBlock).toContain("await refund();");
  });

  it("the four behaviorally-tested routers charge their displayed prices (source-shape)", () => {
    const analyze = readFileSync(path.join(srcRoot, "routes/analyze-sections.ts"), "utf8");
    expect(analyze).toContain("const ANALYZE_SECTIONS_CREDIT_COST = 100;");
    expect(analyze).toContain("buildChargeIdempotencyKey(");
    const plan = readFileSync(path.join(srcRoot, "routes/generate/ai-edit-plan.ts"), "utf8");
    expect(plan).toContain("const AI_EDIT_PLAN_CREDIT_COST = 100;");
    expect(plan).toContain("buildChargeIdempotencyKey(");
    const transcribe = readFileSync(path.join(srcRoot, "routes/transcribe.ts"), "utf8");
    expect(transcribe).toContain("const TRANSCRIBE_CREDIT_COST = 100;");
    expect(transcribe).toContain("buildChargeIdempotencyKey(");
  });
});
