/**
 * Stack-24 Lane 7 — price integrity pins against the REAL registry.
 *
 * Invariant 4 of the operator-hands safety audit: the charged price
 * comes from the rails' own code, never from anything the model (or
 * a caller) proposes. The model's marker can carry args only — and
 * args are data. This suite proves that price-shaped fields smuggled
 * into a proposal's args:
 *
 *  - do not move the quoted price (the proposal quotes the registry),
 *  - do not survive into the pending row's stored args (the real
 *    validators normalize — only the tool's real fields are kept),
 *  - do not reach the rail's request body,
 *  - and do not change the charged / audited figures.
 *
 * Same harness as operator-tier3.test.ts: real registry, catalog,
 * validators and handlers; only the rails' provider-edge cores and
 * the db are faked. (The tripwire pinning every registry price to
 * the rail's own constant lives in operator-tier3.test.ts.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const MEMBER = "00000000-0000-4000-8000-0000000000e7";

const state = vi.hoisted(() => ({
  balance: 100_000,
  cores: {
    song: vi.fn(async (..._a: unknown[]) => ({
      status: 200,
      body: { songId: "song-1", creditsRemaining: 99_600 },
    })),
    videoSubmit: vi.fn(async (..._a: unknown[]) => ({
      status: 200,
      body: { taskId: "task-1", creditCost: 400, model: "gen4.5" },
    })),
    videoPoll: vi.fn(async (..._a: unknown[]) => ({
      status: 200,
      body: { status: "succeeded", storageRef: "supabase://generated-clips/clips/x.mp4", url: "https://signed.example/x" },
    })),
    clipSave: vi.fn(async (..._a: unknown[]) => ({ status: 201, body: { id: "clip-1" } })),
    bioPublish: vi.fn(async (..._a: unknown[]) => ({
      status: 200,
      body: { ok: true, url: "https://bowdownvisuals.com/bio/wave-king", slug: "wave-king", creditsRemaining: 99_900 },
    })),
    brandKit: vi.fn(async (..._a: unknown[]) => ({
      status: 200,
      body: { brandName: "Wave Kings", kit: {}, brandKit: {}, saved: true, creditsRemaining: 99_800 },
    })),
    headshot: vi.fn(async (..._a: unknown[]) => ({
      status: 200,
      body: { taskId: "headshot-1", status: "succeeded", url: "https://cdn.example/headshot.png", path: "u/generated/headshot-1.png", creditCost: 100 },
    })),
    streamPack: vi.fn(async (..._a: unknown[]) => ({
      status: 200,
      body: { asset: "screen-starting", label: "Starting Soon Screen", url: "https://signed.example/pack.png", creditCost: 100 },
    })),
    ugcCreate: vi.fn(async (..._a: unknown[]) => ({
      status: 201,
      body: { ad: { id: "00000000-0000-4000-8000-0000000000c9" } },
    })),
    ugcGenerate: vi.fn(async (..._a: unknown[]) => ({
      status: 200,
      body: { ad: { id: "ad" }, creditsUsed: 400, creditsRemaining: 99_600 },
    })),
    ugcPersona: vi.fn(async (..._a: unknown[]) => ({
      status: 200,
      body: { personaUrl: "https://cdn.example/persona.png", creditsUsed: 100, creditsRemaining: 99_900 },
    })),
  },
}));

const h = vi.hoisted(() => ({ fake: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("../../routes/__tests__/_reach-fake-db");
  const fake = createFakeDb({
    operatorActions: actual.operatorActionsTable,
    operatorPendingActions: actual.operatorPendingActionsTable,
    bioPages: actual.bioPagesTable,
    ugcAds: actual.ugcAdsTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

vi.mock("../credits", () => ({
  getCreditBalance: async (_userId: string) => state.balance,
}));

vi.mock("../../routes/generate/music-audio", () => ({
  creditCostForLength: (lengthMs: number) => {
    if (lengthMs <= 60_000) return 400;
    if (lengthMs <= 180_000) return 800;
    return 1200;
  },
  clampLengthMs: (raw: unknown) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 60_000;
    const ms = Math.round(n * 1000);
    return Math.min(300_000, Math.max(10_000, ms));
  },
  runGenerateMusicAudio: (...a: unknown[]) => state.cores.song(...a),
}));
vi.mock("../../routes/generate/runway-clip", () => ({
  runSubmitRunwayClip: (...a: unknown[]) => state.cores.videoSubmit(...a),
  runPollRunwayClip: (...a: unknown[]) => state.cores.videoPoll(...a),
}));
vi.mock("../../routes/generated-clips", () => ({
  runSaveGeneratedClip: (...a: unknown[]) => state.cores.clipSave(...a),
}));
vi.mock("../../routes/bio-pages", () => ({
  PUBLISH_COST: 100,
  runPublishBioPage: (...a: unknown[]) => state.cores.bioPublish(...a),
}));
vi.mock("../../routes/generate/brand-kit", () => ({
  BRAND_KIT_COST: 200,
  runGenerateBrandKit: (...a: unknown[]) => state.cores.brandKit(...a),
}));
vi.mock("../../routes/generate/headshot-studio", () => ({
  HEADSHOT_CREDITS: 100,
  HEADSHOT_STUDIO_CREDIT_COST: 100,
  runGenerateHeadshot: (...a: unknown[]) => state.cores.headshot(...a),
}));
vi.mock("../../routes/generate/stream-pack", () => ({
  STREAM_PACK_CREDIT_COST: 100,
  STREAM_PACK_ASSETS: [
    { key: "screen-starting", label: "Starting Soon Screen" },
    { key: "webcam-frame", label: "Webcam Frame" },
  ],
  runGenerateStreamPack: (...a: unknown[]) => state.cores.streamPack(...a),
}));
vi.mock("../../routes/ugc-ads", () => ({
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
  runCreateUgcAd: (...a: unknown[]) => state.cores.ugcCreate(...a),
  runGenerateUgcAd: (...a: unknown[]) => state.cores.ugcGenerate(...a),
  runGenerateUgcPersona: (...a: unknown[]) => state.cores.ugcPersona(...a),
}));

import { executeAction, proposeAction } from "../operator-executor";

function auditRows() {
  return h.fake.store("operatorActions").rows;
}
function pendingRow(id: string) {
  return h.fake.store("operatorPendingActions").rows.find((r: any) => r.id === id);
}

beforeEach(() => {
  h.fake.clear();
  state.balance = 100_000;
  for (const fn of Object.values(state.cores)) (fn as any).mockClear();
  delete process.env["OPERATOR_HANDS_ENABLED"];
});

afterEach(() => {
  delete process.env["OPERATOR_HANDS_ENABLED"];
});

const SMUGGLED = { priceVb: 1, price: 1, cost: 1, creditCost: 1, amount: 1 };

describe("a proposal naming a wrong price cannot change what is charged", () => {
  it("song: smuggled price fields move neither the quote, the stored args, the rail body, nor the charge", async () => {
    const proposal = await proposeAction({
      userId: MEMBER,
      toolId: "generate.song.short",
      args: { prompt: "a summer anthem", lengthSeconds: 30, ...SMUGGLED },
      channel: "chat",
    });
    expect(proposal.status).toBe("proposed");
    if (proposal.status !== "proposed") throw new Error("unreachable");
    /* Quote = the rail's tier price, not the smuggled 1. */
    expect(proposal.priceQuoted).toBe(400);
    const row = pendingRow(proposal.pendingId);
    expect(row.priceQuoted).toBe(400);
    /* The validator's normalized args are what the row carries —
       the price-shaped keys never made it in. */
    expect(row.args).toEqual({ prompt: "a summer anthem", lengthSeconds: 30 });

    const outcome = await executeAction({
      userId: MEMBER,
      toolId: "generate.song.short",
      args: row.args as Record<string, unknown>,
      channel: "chat",
      pendingId: proposal.pendingId,
    });
    expect(outcome.status).toBe("done");
    expect(outcome.priceCharged).toBe(400);
    /* The rail body carries the song's real fields and no price. */
    const [, body] = (state.cores.song as any).mock.calls[0];
    expect(body).toEqual({ prompt: "a summer anthem", lengthSeconds: 30 });
    const done = auditRows().find((r: any) => r.result === "done");
    expect(done).toMatchObject({ toolId: "generate.song.short", priceQuoted: 400, priceCharged: 400 });
  });

  it("video: a smuggled price cannot move the quote, and submission still charges 0 (the rail charges on success)", async () => {
    const proposal = await proposeAction({
      userId: MEMBER,
      toolId: "generate.video",
      args: { prompt: "a shark surfing at sunset", ...SMUGGLED },
      channel: "chat",
    });
    expect(proposal.status).toBe("proposed");
    if (proposal.status !== "proposed") throw new Error("unreachable");
    expect(proposal.priceQuoted).toBe(400);
    expect(pendingRow(proposal.pendingId).priceQuoted).toBe(400);

    const outcome = await executeAction({
      userId: MEMBER,
      toolId: "generate.video",
      args: { prompt: "a shark surfing at sunset" },
      channel: "chat",
      pendingId: proposal.pendingId,
    });
    expect(outcome.status).toBe("done");
    expect(outcome.priceCharged).toBe(0);
    const [, body] = (state.cores.videoSubmit as any).mock.calls[0];
    expect(body).toEqual({ promptText: "a shark surfing at sunset", model: "gen4.5" });
    const done = auditRows().find((r: any) => r.result === "done");
    expect(done).toMatchObject({ toolId: "generate.video", priceQuoted: 400, priceCharged: 0 });
    /* Flush the fire-and-forget completion driver so its polls
       can't leak into another test (same discipline as tier3). */
    await new Promise((r) => setTimeout(r, 25));
  });

  it("execution-time price fields (never confirmed) refuse as a mismatch — the confirmed args are the only args", async () => {
    const proposal = await proposeAction({
      userId: MEMBER,
      toolId: "generate.song.short",
      args: { prompt: "a summer anthem", lengthSeconds: 30 },
      channel: "chat",
    });
    if (proposal.status !== "proposed") throw new Error("unreachable");
    const outcome = await executeAction({
      userId: MEMBER,
      toolId: "generate.song.short",
      /* Same song, plus price fields the member never confirmed. */
      args: { prompt: "a summer anthem", lengthSeconds: 30, ...SMUGGLED },
      channel: "chat",
      pendingId: proposal.pendingId,
    });
    expect(outcome.status).toBe("refused");
    expect(outcome.reason).toBe("confirmation_mismatch");
    expect(state.cores.song).not.toHaveBeenCalled();
  });
});
