/**
 * Cloud Operator Phase 2, Lane E — Tier 3 through the REAL chat route:
 * POST /api/chat with the real registry/executor/chat glue; only the
 * model client, the session resolver, credits, the db, and the rails'
 * provider-edge cores are faked.
 *
 * Pins:
 *  - a marker WITH args → the reply is the server-composed proposal
 *    quoting the REGISTRY price (the model's words are discarded)
 *  - "yes" consumes it exactly once → the rail core runs as the caller
 *  - a marker MISSING its details → the validator's question, no
 *    proposal, no pending row, nothing charged
 *  - nested JSON args (a UGC script object) survive the marker parser
 *  - a song length from the wrong tier is never quoted at the wrong
 *    price — the reply names the true tier price instead
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const MEMBER = "00000000-0000-4000-8000-0000000000e1";

const state = vi.hoisted(() => {
  process.env.CHAT_CREDIT_COST = "0";
  return {
    reply: "All good, fin-friend. 🦈",
    balance: 100_000,
    brandKitCalls: [] as unknown[][],
    ugcGenerateCalls: [] as unknown[][],
  };
});

const h = vi.hoisted(() => ({ fake: null as any }));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: state.reply } }] }),
      },
    },
  }),
  getTextModel: () => "test-model",
}));

vi.mock("../../lib/optional-auth", () => ({
  resolveOptionalSession: async (req: any) => {
    const user = req.headers["x-test-user"];
    if (user) {
      req.userId = String(user);
      req.userEmail = req.headers["x-test-email"] ? String(req.headers["x-test-email"]) : undefined;
    }
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(user);
    req.userEmail = req.headers["x-test-email"] ? String(req.headers["x-test-email"]) : undefined;
    next();
  },
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error { readonly code = "OUT_OF_CREDITS"; }
  class LedgerWriteError extends Error { readonly code = "LEDGER_WRITE"; }
  return {
    OutOfCreditsError,
    LedgerWriteError,
    getCreditBalance: async (_userId: string) => state.balance,
    chargeCredits: async () => state.balance,
    refundCredits: async () => state.balance,
    buildChargeIdempotencyKey: () => "test-key",
    voidChargeIdempotencyKey: async () => true,
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    operatorActions: actual.operatorActionsTable,
    operatorPendingActions: actual.operatorPendingActionsTable,
    bioPages: actual.bioPagesTable,
    ugcAds: actual.ugcAdsTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

/* Rail provider-edge cores (same stubbing approach as the executor
   suite) — the chat/executor/validator layers under test are real. */
vi.mock("../generate/music-audio", () => ({
  creditCostForLength: (lengthMs: number) => (lengthMs <= 60_000 ? 400 : lengthMs <= 180_000 ? 800 : 1200),
  clampLengthMs: (raw: unknown) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 60_000;
    return Math.min(300_000, Math.max(10_000, Math.round(n * 1000)));
  },
  runGenerateMusicAudio: async () => ({ status: 200, body: { songId: "song-1" } }),
}));
vi.mock("../generate/runway-clip", () => ({
  runSubmitRunwayClip: async () => ({ status: 200, body: { taskId: "task-1", creditCost: 400 } }),
  runPollRunwayClip: async () => ({ status: 200, body: { status: "succeeded", storageRef: "supabase://generated-clips/clips/x.mp4" } }),
}));
vi.mock("../generated-clips", () => ({
  runSaveGeneratedClip: async () => ({ status: 201, body: { id: "clip-1" } }),
}));
vi.mock("../bio-pages", () => ({
  PUBLISH_COST: 100,
  runPublishBioPage: async () => ({ status: 200, body: { ok: true, url: "https://bowdownvisuals.com/bio/x", slug: "x" } }),
}));
vi.mock("../generate/brand-kit", () => ({
  BRAND_KIT_COST: 200,
  runGenerateBrandKit: async (...a: unknown[]) => {
    state.brandKitCalls.push(a);
    return { status: 200, body: { brandName: "Wave Kings", kit: {}, brandKit: {}, saved: true, creditsRemaining: 99_800 } };
  },
}));
vi.mock("../generate/headshot-studio", () => ({
  HEADSHOT_CREDITS: 100,
  HEADSHOT_STUDIO_CREDIT_COST: 100,
  runGenerateHeadshot: async () => ({ status: 200, body: { url: "https://cdn.example/h.png", path: "p", creditCost: 100 } }),
}));
vi.mock("../generate/stream-pack", () => ({
  STREAM_PACK_CREDIT_COST: 100,
  STREAM_PACK_ASSETS: [{ key: "screen-starting", label: "Starting Soon Screen" }],
  runGenerateStreamPack: async () => ({ status: 200, body: { asset: "screen-starting", label: "Starting Soon Screen", creditCost: 100 } }),
}));
vi.mock("../ugc-ads", () => ({
  UGC_VIDEO_CREDIT_COST: 400,
  UGC_PERSONA_CREDIT_COST: 100,
  UGC_STYLES: ["unboxing", "honest-review", "problem-fix", "grwm"],
  normalizeScript: (raw: unknown) => {
    if (!raw || typeof raw !== "object") return null;
    const s = raw as any;
    const hook = typeof s.hook === "string" ? s.hook.trim() : "";
    const cta = typeof s.cta === "string" ? s.cta.trim() : "";
    const lines = Array.isArray(s.lines)
      ? s.lines.filter((l: unknown) => typeof l === "string" && l.trim()).map((l: string) => l.trim())
      : [];
    if (!hook || !cta || lines.length === 0 || lines.length > 6) return null;
    return { hook, lines, cta };
  },
  runCreateUgcAd: async () => ({ status: 201, body: { ad: { id: "00000000-0000-4000-8000-0000000000c9" } } }),
  runGenerateUgcAd: async (...a: unknown[]) => {
    state.ugcGenerateCalls.push(a);
    return { status: 200, body: { ad: { id: "ad" }, creditsUsed: 400 } };
  },
  runGenerateUgcPersona: async () => ({ status: 200, body: { personaUrl: "https://cdn.example/p.png", creditsUsed: 100 } }),
}));

import chatRouter from "../chat";
import { extractActionMarker } from "../../lib/operator-chat";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", chatRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.fake.clear();
  state.reply = "All good, fin-friend. 🦈";
  state.balance = 100_000;
  state.brandKitCalls = [];
  state.ugcGenerateCalls = [];
  delete process.env["OPERATOR_HANDS_ENABLED"];
});

async function postChat(message: string, who?: string) {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(who ? { "x-test-user": who } : {}),
    },
    body: JSON.stringify({ message }),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

describe("Tier 3 through the chat box", () => {
  it("marker with args → server-composed proposal at the registry price; 'yes' runs the rail exactly once", async () => {
    state.reply =
      'Say less, I got you — one brand kit coming up for the low price of 5 Visual Bucs!!\n[[DO:brandkit.generate {"brandName":"Wave Kings","vibe":"regal gold"}]]';
    const proposal = await postChat("Make my brand kit — Wave Kings, regal gold vibe", MEMBER);
    expect(proposal.status).toBe(200);
    /* The model's invented "5 Visual Bucs" never reaches the member:
       the proposal is composed by the server from the registry. */
    expect(proposal.json.reply).toContain("200 Visual Bucs");
    expect(proposal.json.reply).not.toContain("5 Visual Bucs");
    expect(proposal.json.action).toMatchObject({
      toolId: "brandkit.generate",
      status: "proposed",
      priceQuoted: 200,
    });
    expect(state.brandKitCalls).toHaveLength(0);
    expect(h.fake.store("operatorPendingActions").rows).toHaveLength(1);

    const yes = await postChat("yes", MEMBER);
    expect(yes.json.action).toMatchObject({ toolId: "brandkit.generate", status: "done", priceCharged: 200 });
    expect(yes.json.reply).toContain("brand kit for Wave Kings is made and saved");
    expect(state.brandKitCalls).toHaveLength(1);
    const rows = h.fake.store("operatorActions").rows;
    expect(rows.some((r: any) => r.toolId === "brandkit.generate" && r.result === "done" && r.priceCharged === 200)).toBe(true);
  });

  it("marker missing its details → the validator's question; no proposal, no charge", async () => {
    state.reply = "On it!\n[[DO:brandkit.generate]]";
    const { json } = await postChat("Make my brand kit", MEMBER);
    expect(json.reply).toContain("brand or artist name");
    expect(json.action).toMatchObject({ status: "refused", reason: "missing_args" });
    expect(h.fake.store("operatorPendingActions").rows).toHaveLength(0);
    expect(state.brandKitCalls).toHaveLength(0);
  });

  it("a song length from the wrong tier is never quoted at the wrong price", async () => {
    state.reply = 'Setting it up!\n[[DO:generate.song.short {"prompt":"a summer anthem","lengthSeconds":120}]]';
    const { json } = await postChat("Make me a 2-minute song about summer", MEMBER);
    expect(json.reply).toContain("800 Visual Bucs");
    expect(json.reply).not.toContain("400 Visual Bucs");
    expect(json.action).toMatchObject({ status: "refused", reason: "missing_args" });
    expect(h.fake.store("operatorPendingActions").rows).toHaveLength(0);
  });

  it("nested JSON args (a UGC script object) survive the marker and reach the rail", async () => {
    state.reply =
      'Let\'s run it.\n[[DO:ugc.video {"productName":"Glow Serum","style":"unboxing","script":{"hook":"Watch this glow","lines":["Day one versus day seven","Look at that shine"],"cta":"Tap the link"}}]]';
    const proposal = await postChat("Make my product ad for Glow Serum", MEMBER);
    expect(proposal.json.action).toMatchObject({ toolId: "ugc.video", status: "proposed", priceQuoted: 400 });

    const yes = await postChat("yes", MEMBER);
    expect(yes.json.action).toMatchObject({ toolId: "ugc.video", status: "done", priceCharged: 400 });
    expect(state.ugcGenerateCalls).toHaveLength(1);
  });
});

describe("the marker parser", () => {
  it("parses a bare marker, a flat-args marker, and a nested-args marker", () => {
    expect(extractActionMarker("ok\n[[DO:credits.balance]]")).toMatchObject({ toolId: "credits.balance", args: {} });
    expect(
      extractActionMarker('go\n[[DO:generate.song.short {"prompt":"summer","lengthSeconds":45}]]'),
    ).toMatchObject({ toolId: "generate.song.short", args: { prompt: "summer", lengthSeconds: 45 } });
    const nested = extractActionMarker(
      'go\n[[DO:ugc.video {"script":{"hook":"a } brace in a string","lines":["x"],"cta":"go"}}]]',
    );
    expect(nested?.toolId).toBe("ugc.video");
    expect((nested?.args["script"] as any).hook).toBe("a } brace in a string");
  });

  it("malformed args JSON degrades to no-args (validators then ask) instead of crashing", () => {
    const m = extractActionMarker("go\n[[DO:brandkit.generate {not json}]]");
    expect(m).toMatchObject({ toolId: "brandkit.generate", args: {} });
  });
});
