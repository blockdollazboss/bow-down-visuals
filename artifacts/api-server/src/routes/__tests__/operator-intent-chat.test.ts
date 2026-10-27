/**
 * Payfix lane 7 (operator hands) — the DETERMINISTIC INTENT path, end to
 * end over HTTP on BOTH chat surfaces (POST /api/chat and the live
 * widget's POST /api/free-chat), with NO model marker anywhere: the
 * model stub never emits one and free-chat runs with no provider key,
 * so its brain is the knowledge-base fallback that structurally cannot
 * emit a marker. That is exactly the live PASS-4 failure shape (Oct 26:
 * bio/SFX/direct orders returned page guides + OPEN buttons, the chat
 * operator never performed a charged action). These pins prove the fix:
 *
 *  - a clear charged order in plain words → a server-composed proposal
 *    at the registry price (ASK-FIRST: nothing runs, nothing charges)
 *  - "yes" → the SAME executor/rails path executes it, exactly once,
 *    at the quoted price, with the confirmation's idempotency key
 *  - a second "yes" / a direct executor replay of the consumed
 *    confirmation → refused, the rail is never touched twice
 *  - "no" → cancelled: no charge, and the declined confirmation can
 *    never fire later
 *  - the 20/day cap counts only today's UTC `done` rows with
 *    priceCharged > 0; a cap refusal does not burn the confirmation
 *  - a rail failure audits `failed` and claims no charge (the rails'
 *    own refund-on-failure is pinned against the real bio core in
 *    lib/__tests__/operator-intent-bio-refund.test.ts)
 *  - the capability question is answered by code from the live
 *    registry — the list PASS 4 asked for and never got
 *  - informational questions are NOT orders and keep the old path
 *
 * Only the model client, the session resolver, credits, the db, and
 * the rails' provider-edge cores are faked; the registry, validators,
 * executor, intent layer and both route handlers are real.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const MEMBER = "00000000-0000-4000-8000-0000000000d7";

const state = vi.hoisted(() => {
  process.env.CHAT_CREDIT_COST = "0";
  return {
    reply: "All good, fin-friend. 🦈",
    balance: 100_000,
    cores: {
      sfx: vi.fn(async (..._a: unknown[]) => ({
        status: 200,
        body: { url: "https://cdn.example/sfx/thunder.mp3", storagePath: "u/sfx/thunder.mp3" },
      })),
      bioGenerate: vi.fn(async (..._a: unknown[]) => ({
        bios: [
          { platform: "Instagram", bio: "ig bio", charCount: 6, limit: 150 },
          { platform: "TikTok", bio: "tt bio", charCount: 6, limit: 80 },
          { platform: "Twitter", bio: "tw bio", charCount: 6, limit: 160 },
          { platform: "YouTube", bio: "yt bio", charCount: 6, limit: 1000 },
        ],
        creditsRemaining: 99_900,
      })),
      song: vi.fn(async (..._a: unknown[]) => ({
        status: 200,
        body: { songId: "song-1", creditsRemaining: 99_600 },
      })),
      brandKit: vi.fn(async (..._a: unknown[]) => ({
        status: 200,
        body: { brandName: "Wave Kings", kit: {}, brandKit: {}, saved: true, creditsRemaining: 99_800 },
      })),
    },
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

/* Rail provider-edge cores, stubbed like the Tier-3 suites. The two
   NEW rails (bio generate, SFX) are stubbed at their exported cores —
   the exact functions the page routes call. */
vi.mock("../generate/bio-generator", () => ({
  BIO_COST: 100,
  generateBiosForUser: (...a: unknown[]) => state.cores.bioGenerate(...a),
}));
vi.mock("../generate/sfx", () => ({
  runGenerateSfx: (...a: unknown[]) => state.cores.sfx(...a),
  generateSfxHandler: async () => {},
}));
vi.mock("../generate/music-audio", () => ({
  creditCostForLength: (lengthMs: number) => (lengthMs <= 60_000 ? 400 : lengthMs <= 180_000 ? 800 : 1200),
  clampLengthMs: (raw: unknown) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 60_000;
    return Math.min(300_000, Math.max(10_000, Math.round(n * 1000)));
  },
  runGenerateMusicAudio: (...a: unknown[]) => state.cores.song(...a),
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
  runGenerateBrandKit: (...a: unknown[]) => state.cores.brandKit(...a),
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
  runGenerateUgcAd: async () => ({ status: 200, body: { ad: { id: "ad" }, creditsUsed: 400 } }),
  runGenerateUgcPersona: async () => ({ status: 200, body: { personaUrl: "https://cdn.example/p.png", creditsUsed: 100 } }),
}));

import chatRouter from "../chat";
import freeChatRouter from "../free-chat";
import {
  detectOperatorIntent,
  isCapabilityQuestion,
  composeCapabilityReply,
} from "../../lib/operator-chat";
import { executeAction } from "../../lib/operator-executor";
import { OPERATOR_TOOL_DEFS } from "../../lib/operator-tool-catalog";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", chatRouter);
  app.use("/api", freeChatRouter);
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
  for (const fn of Object.values(state.cores)) (fn as any).mockClear();
  delete process.env["OPERATOR_HANDS_ENABLED"];
  /* The live widget's brain on the failing path: NO provider key, so
     free-chat answers from the knowledge base — which cannot emit a
     marker. The deterministic layer must carry the hands alone. */
  delete process.env["GROQ_API_KEY"];
});

afterEach(() => {
  delete process.env["OPERATOR_HANDS_ENABLED"];
  delete process.env["GROQ_API_KEY"];
});

async function post(path: string, message: string, who?: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(who ? { "x-test-user": who } : {}),
    },
    body: JSON.stringify({ message }),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
const postChat = (m: string, who?: string) => post("/api/chat", m, who);
const postFreeChat = (m: string, who?: string) => post("/api/free-chat", m, who);

function auditRows() {
  return h.fake.store("operatorActions").rows;
}
function pendingRows() {
  return h.fake.store("operatorPendingActions").rows;
}

/* ── The intent recognizer itself (pure) ────────────────────────────── */

describe("detectOperatorIntent — plain words in, only stated args out", () => {
  it("extracts the SFX prompt the member actually described", () => {
    expect(detectOperatorIntent("Make me a sound effect of thunder crashing")).toEqual({
      toolId: "sfx.generate",
      args: { prompt: "thunder crashing" },
    });
    expect(detectOperatorIntent("SFX: a huge cinematic boom")).toMatchObject({
      toolId: "sfx.generate",
      args: { prompt: "a huge cinematic boom", category: "impacts" },
    });
  });

  it("extracts bio niche + personality, and nothing the member didn't say", () => {
    const intent = detectOperatorIntent(
      "Generate bios for a fitness coach with personality bold, funny",
    );
    expect(intent?.toolId).toBe("bio.generate");
    expect(intent?.args).toMatchObject({
      niche: "fitness coach",
      personality: ["bold", "funny"],
    });
    expect(intent?.args).not.toHaveProperty("achievements");
    expect(intent?.args).not.toHaveProperty("handle");
  });

  it("picks the song tier from the STATED duration (400 / 800 / 1,200 by length)", () => {
    expect(detectOperatorIntent("Make me a song about summer nights for 30 seconds")).toEqual({
      toolId: "generate.song.short",
      args: { prompt: "summer nights", lengthSeconds: 30 },
    });
    expect(
      detectOperatorIntent("Make me a song about summer nights for 2 minutes")?.toolId,
    ).toBe("generate.song.standard");
    expect(
      detectOperatorIntent("Make me a song about summer nights for 4 minutes")?.toolId,
    ).toBe("generate.song.long");
  });

  it("extracts brand kit, headshot, stream pack, UGC persona and video asks", () => {
    expect(detectOperatorIntent("Make a brand kit for Wave Kings, regal gold vibe")).toEqual({
      toolId: "brandkit.generate",
      args: { brandName: "Wave Kings", vibe: "regal gold" },
    });
    expect(detectOperatorIntent("Make me a headshot, luxury look")).toEqual({
      toolId: "headshot.generate",
      args: { preset: "luxury" },
    });
    expect(detectOperatorIntent("Make a starting soon stream graphic for WaveKingTV")).toEqual({
      toolId: "streampack.asset",
      args: { asset: "screen-starting", channelName: "WaveKingTV" },
    });
    expect(
      detectOperatorIntent("Create a UGC persona: a warm sneaker reviewer in her twenties"),
    ).toEqual({
      toolId: "ugc.persona",
      args: { description: "a warm sneaker reviewer in her twenties" },
    });
    expect(detectOperatorIntent("Make a video of a shark surfing at sunset")).toEqual({
      toolId: "generate.video",
      args: { prompt: "a shark surfing at sunset" },
    });
  });

  it("informational questions and unrelated asks are NOT orders", () => {
    expect(detectOperatorIntent("How do I make a bio?")).toBeNull();
    expect(detectOperatorIntent("What does a song cost?")).toBeNull();
    expect(detectOperatorIntent("Where is the SFX page?")).toBeNull();
    expect(detectOperatorIntent("Make me a sandwich")).toBeNull();
    expect(detectOperatorIntent("What is this site?")).toBeNull();
  });

  it("missing details still route to the tool — its validator asks, nothing is invented", () => {
    expect(detectOperatorIntent("Make me a sound effect")?.toolId).toBe("sfx.generate");
    expect(detectOperatorIntent("Generate my bios")?.toolId).toBe("bio.generate");
    expect(detectOperatorIntent("Make me a song about summer")?.args).not.toHaveProperty("lengthSeconds");
  });
});

describe("the capability listing — composed by code from the live registry", () => {
  it("recognizes the PASS-4 question and lists every charged tool at its pinned price", () => {
    expect(isCapabilityQuestion("What charged actions can you perform in chat?")).toBe(true);
    const reply = composeCapabilityReply();
    for (const line of [
      "Make a Song — up to 1 minute — 400 Visual Bucs",
      "Make a Song — up to 3 minutes — 800 Visual Bucs",
      "Make a Song — up to 5 minutes — 1,200 Visual Bucs",
      "Make a Video (Gen 4.5) — 400 Visual Bucs",
      "Generate my Bios — 100 Visual Bucs",
      "Make a Sound Effect — 100 Visual Bucs",
      "Publish my bio page — 100 Visual Bucs",
      "Make my Brand Kit — 200 Visual Bucs",
      "Make a Headshot — 100 Visual Bucs",
      "Make a Stream Graphic — 100 Visual Bucs",
      "Make my UGC Product Ad — 400 Visual Bucs",
      "Make a UGC Persona — 100 Visual Bucs",
    ]) {
      expect(reply).toContain(line);
    }
    expect(reply).toContain("20 charged actions a day");
  });

  it("the registry's charged prices are exactly the pinned ten-tool price list", () => {
    const price = (id: string) => OPERATOR_TOOL_DEFS.find((t) => t.id === id)!.priceVb;
    expect(price("generate.song.short")).toBe(400);
    expect(price("generate.song.standard")).toBe(800);
    expect(price("generate.song.long")).toBe(1200);
    expect(price("generate.video")).toBe(400);
    expect(price("bio.publish")).toBe(100);
    expect(price("brandkit.generate")).toBe(200);
    expect(price("headshot.generate")).toBe(100);
    expect(price("streampack.asset")).toBe(100);
    expect(price("ugc.video")).toBe(400);
    expect(price("ugc.persona")).toBe(100);
    /* The two tools this lane added ride the same pinned prices. */
    expect(price("bio.generate")).toBe(100);
    expect(price("sfx.generate")).toBe(100);
  });
});

/* ── Free-chat: the live widget surface, KB-fallback brain ──────────── */

describe("POST /api/free-chat — hands on the knowledge-base fallback path (the PASS-4 surface)", () => {
  it("ASK-FIRST: a direct bio order proposes at 100 VB and charges NOTHING until yes", async () => {
    const proposal = await postFreeChat(
      "Generate bios for a fitness coach with personality bold, funny",
      MEMBER,
    );
    expect(proposal.status).toBe(200);
    expect(proposal.json.action).toMatchObject({
      toolId: "bio.generate",
      status: "proposed",
      priceQuoted: 100,
    });
    expect(proposal.json.reply).toContain("100 Visual Bucs");
    expect(proposal.json.reply).toContain("Nothing is charged until you say yes");
    /* No page guide, no OPEN door as the answer — a real proposal. */
    expect(state.cores.bioGenerate).not.toHaveBeenCalled();
    expect(auditRows().filter((r: any) => r.result === "done")).toHaveLength(0);
    expect(pendingRows()).toHaveLength(1);
    expect(pendingRows()[0]).toMatchObject({ toolId: "bio.generate", priceQuoted: 100, status: "pending" });
  });

  it("yes EXECUTES the confirmed bio order exactly once, through the page's own core, keyed by the confirmation", async () => {
    await postFreeChat("Generate bios for a fitness coach with personality bold, funny", MEMBER);
    const pendingId = pendingRows()[0].id;

    const yes = await postFreeChat("yes", MEMBER);
    expect(yes.json.action).toMatchObject({ toolId: "bio.generate", status: "done", priceCharged: 100 });
    expect(yes.json.reply).toContain("your bios are made");
    expect(yes.json.reply).toContain("Instagram: ig bio");
    expect(state.cores.bioGenerate).toHaveBeenCalledTimes(1);
    const [userId, data, opts] = (state.cores.bioGenerate as any).mock.calls[0];
    expect(userId).toBe(MEMBER);
    expect(data).toMatchObject({ niche: "fitness coach", personality: ["bold", "funny"] });
    expect(opts).toMatchObject({ action: "Bio Generator", idempotencyKey: `operator:${pendingId}` });
    const done = auditRows().filter((r: any) => r.result === "done");
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ toolId: "bio.generate", priceQuoted: 100, priceCharged: 100 });

    /* A second yes has nothing live to consume — no second execution. */
    const yesAgain = await postFreeChat("yes", MEMBER);
    expect(yesAgain.json.action?.status).not.toBe("done");
    expect(state.cores.bioGenerate).toHaveBeenCalledTimes(1);
    expect(auditRows().filter((r: any) => r.result === "done")).toHaveLength(1);
  });

  it("NO-CHARGE-ON-CANCEL: 'no' drops the SFX order — nothing runs, and a later 'yes' cannot revive it", async () => {
    const proposal = await postFreeChat("Make me a sound effect of thunder crashing", MEMBER);
    expect(proposal.json.action).toMatchObject({ toolId: "sfx.generate", status: "proposed", priceQuoted: 100 });

    const no = await postFreeChat("no", MEMBER);
    expect(no.json.action).toMatchObject({ toolId: "sfx.generate", status: "cancelled" });
    expect(no.json.reply).toContain("nothing was charged");
    expect(state.cores.sfx).not.toHaveBeenCalled();
    expect(pendingRows()[0].status).toBe("cancelled");
    expect(auditRows().filter((r: any) => r.result === "done")).toHaveLength(0);

    const lateYes = await postFreeChat("yes", MEMBER);
    expect(lateYes.json.action?.status).not.toBe("done");
    expect(state.cores.sfx).not.toHaveBeenCalled();
  });

  it("the capability question is answered in chat — not with a page guide", async () => {
    const { json } = await postFreeChat("What charged actions can you perform in chat?", MEMBER);
    expect(json.action).toMatchObject({ toolId: "operator.capabilities", status: "done" });
    expect(json.reply).toContain("Generate my Bios — 100 Visual Bucs");
    expect(json.reply).toContain("Make a Sound Effect — 100 Visual Bucs");
    expect(pendingRows()).toHaveLength(0);
    expect(state.cores.sfx).not.toHaveBeenCalled();
    expect(state.cores.bioGenerate).not.toHaveBeenCalled();
  });

  it("an informational bio question is NOT an order — no proposal, no pending row", async () => {
    const { json } = await postFreeChat("How do I make a bio?", MEMBER);
    expect(json.action).toBeUndefined();
    expect(pendingRows()).toHaveLength(0);
    expect(state.cores.bioGenerate).not.toHaveBeenCalled();
  });

  it("a guest's direct order never executes — it keeps the ordinary answer path and creates nothing", async () => {
    const { json } = await postFreeChat("Make me a sound effect of thunder crashing");
    expect(json.action).toBeUndefined();
    expect(state.cores.sfx).not.toHaveBeenCalled();
    expect(pendingRows()).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
  });
});

/* ── /api/chat: same hands, pre-model, marker-free ──────────────────── */

describe("POST /api/chat — deterministic orders with no model marker", () => {
  it("an SFX order proposes pre-model (the model stub never marks), and yes runs it exactly once at 100 VB", async () => {
    const proposal = await postChat("Run a sound effect of rain on a tent for me", MEMBER);
    expect(proposal.json.action).toMatchObject({ toolId: "sfx.generate", status: "proposed", priceQuoted: 100 });
    expect(state.cores.sfx).not.toHaveBeenCalled();

    const yes = await postChat("yes", MEMBER);
    expect(yes.json.action).toMatchObject({ toolId: "sfx.generate", status: "done", priceCharged: 100 });
    expect(yes.json.reply).toContain("sound effect is made");
    expect(state.cores.sfx).toHaveBeenCalledTimes(1);
    const [, body] = (state.cores.sfx as any).mock.calls[0];
    expect(body).toMatchObject({ prompt: "rain on a tent for me" });
  });

  it("EXACTLY-ONCE: replaying the consumed confirmation at the executor refuses — one rail call, one charge", async () => {
    await postChat("Make me a sound effect of thunder crashing", MEMBER);
    const pendingId = pendingRows()[0].id;
    await postChat("yes", MEMBER);
    expect(state.cores.sfx).toHaveBeenCalledTimes(1);

    const replay = await executeAction({
      userId: MEMBER,
      toolId: "sfx.generate",
      args: { prompt: "thunder crashing" },
      channel: "chat_text",
      pendingId,
    });
    expect(replay.status).toBe("refused");
    expect(replay.reason).toBe("confirmation_replayed");
    expect(state.cores.sfx).toHaveBeenCalledTimes(1);
    expect(auditRows().filter((r: any) => r.result === "done")).toHaveLength(1);
  });

  it("a declined confirmation can never fire at the executor either (cancelled stays cancelled)", async () => {
    await postChat("Make me a sound effect of thunder crashing", MEMBER);
    const pendingId = pendingRows()[0].id;
    await postChat("no", MEMBER);

    const late = await executeAction({
      userId: MEMBER,
      toolId: "sfx.generate",
      args: { prompt: "thunder crashing" },
      channel: "chat_text",
      pendingId,
    });
    expect(late.status).toBe("refused");
    expect(late.reason).toBe("confirmation_cancelled");
    expect(state.cores.sfx).not.toHaveBeenCalled();
  });

  it("an INCOMPLETE order falls through to the model path — the deterministic layer never half-proposes", async () => {
    /* "Make me a sound effect" names no sound: elicitation belongs to
       the model/marker path, which sees the whole conversation (the
       validator's ask for this exact case stays pinned at the
       executor level and in the marker-path suite). Here the model
       stub answers plainly, so the turn ships untouched: no proposal,
       no pending row, no rail call, no charge. */
    const { json } = await postChat("Make me a sound effect", MEMBER);
    expect(json.reply).toBe("All good, fin-friend. 🦈");
    expect(json.action).toBeUndefined();
    expect(pendingRows()).toHaveLength(0);
    expect(state.cores.sfx).not.toHaveBeenCalled();

    const free = await postFreeChat("Generate my bios", MEMBER);
    expect(free.json.action).toBeUndefined();
    expect(pendingRows()).toHaveLength(0);
    expect(state.cores.bioGenerate).not.toHaveBeenCalled();
  });

  it("a song order lands on the tier its stated duration belongs to (2 minutes → 800 VB standard)", async () => {
    const proposal = await postChat("Make me a song about summer nights for 2 minutes", MEMBER);
    expect(proposal.json.action).toMatchObject({
      toolId: "generate.song.standard",
      status: "proposed",
      priceQuoted: 800,
    });
    expect(proposal.json.reply).toContain("800 Visual Bucs");
    expect(state.cores.song).not.toHaveBeenCalled();
  });
});

/* ── The daily cap, counted exactly as the law states ───────────────── */

describe("the 20/day cap — only today's UTC done rows with priceCharged > 0 count", () => {
  function seedActions(rows: Record<string, unknown>[]) {
    for (const row of rows) h.fake.seed("operatorActions", [row]);
  }
  const baseRow = {
    userId: MEMBER,
    tier: 3,
    toolId: "sfx.generate",
    summary: "earlier",
    channel: "chat_text",
    priceQuoted: 100,
    priceCharged: 100,
    result: "done",
    createdAt: new Date(),
  };

  it("the 21st charged action in a UTC day is refused BEFORE the rail — and the refusal does not burn the confirmation", async () => {
    seedActions(Array.from({ length: 20 }, () => ({ ...baseRow })));
    await postChat("Make me a sound effect of thunder crashing", MEMBER);
    const yes = await postChat("yes", MEMBER);
    expect(yes.json.action).toMatchObject({ toolId: "sfx.generate", status: "refused", reason: "daily_cap" });
    expect(yes.json.reply).toContain("cap of 20");
    expect(state.cores.sfx).not.toHaveBeenCalled();
    /* Cap refusals happen before the guarded consume: the member's
       confirmation is still live, not spent by a refusal. */
    expect(pendingRows()[0].status).toBe("pending");
    expect(auditRows().some((r: any) => r.result === "refused" && r.resultReason === "daily_cap")).toBe(true);
  });

  it("failed, free, and yesterday's rows do NOT count toward the cap", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    seedActions([
      ...Array.from({ length: 8 }, () => ({ ...baseRow, result: "failed", priceCharged: null })),
      ...Array.from({ length: 7 }, () => ({ ...baseRow, priceCharged: 0 })),
      ...Array.from({ length: 5 }, () => ({ ...baseRow, createdAt: yesterday })),
    ]);
    await postChat("Make me a sound effect of thunder crashing", MEMBER);
    const yes = await postChat("yes", MEMBER);
    expect(yes.json.action).toMatchObject({ toolId: "sfx.generate", status: "done", priceCharged: 100 });
    expect(state.cores.sfx).toHaveBeenCalledTimes(1);
  });
});

/* ── Rail failure honesty at the operator layer ─────────────────────── */

describe("rail failure — the operator claims no charge", () => {
  it("an SFX rail 502 audits `failed`, reports no charge, and answers honestly", async () => {
    (state.cores.sfx as any).mockResolvedValueOnce({
      status: 502,
      body: { error: "Sound generation failed. Try a different description or try again shortly." },
    });
    await postChat("Make me a sound effect of thunder crashing", MEMBER);
    const yes = await postChat("yes", MEMBER);
    expect(yes.json.action).toMatchObject({ toolId: "sfx.generate", status: "failed" });
    expect(yes.json.action.priceCharged ?? null).toBeNull();
    const failed = auditRows().find((r: any) => r.result === "failed");
    expect(failed).toBeTruthy();
    expect(failed.priceCharged ?? null).toBeNull();
    expect(auditRows().some((r: any) => r.result === "done")).toBe(false);
  });
});
