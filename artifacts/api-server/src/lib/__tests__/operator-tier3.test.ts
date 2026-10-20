/**
 * Cloud Operator Phase 2, Lane E — Tier 3 charged tools, tested at the
 * executor level with the REAL registry, REAL catalog, REAL validators
 * and handlers; only the rails' cores (the network/provider edge) and
 * the db are faked. The cores are stubs with the rails' own result
 * shapes, so what is pinned here is the operator's law:
 *
 *  - prices in the registry ARE the rails' constants (tripwire)
 *  - a charged tool NEVER runs without a consumed confirmation
 *  - an incomplete request proposes NOTHING and asks (no pending row)
 *  - a song length from the wrong tier is refused before any quote
 *  - confirmed once = exactly one rail call, one charge, at the
 *    registry price; a replayed confirmation refuses, core untouched
 *  - the daily cap stops the (cap+1)th charged action
 *  - a rail failure audits `failed` with the rail's own message and
 *    reports no charge; charges land on the CALLER only
 *  - the confirmation's idempotency key reaches the rails that take one
 *  - the kill switch refuses proposals and executions, audited
 *  - the video tool starts the job, audits priceCharged 0 (the rail
 *    charges on success), and its driver finishes through the rail's
 *    own poll + save cores
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const MEMBER = "00000000-0000-4000-8000-0000000000e1";
const OTHER = "00000000-0000-4000-8000-0000000000e2";
const BIO_PAGE_ID = "00000000-0000-4000-8000-0000000000b1";
const UGC_AD_ID = "00000000-0000-4000-8000-0000000000c1";

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

/* Rail cores: stubs at the provider edge. The pure pricing helpers
   are the rail's real semantics, copied line-for-line (the rails' own
   route suites pin them against the real modules). */
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

import {
  executeAction,
  proposeAction,
  OPERATOR_DAILY_CHARGED_CAP,
} from "../operator-executor";
import { getTool, OPERATOR_TOOLS } from "../operator-tools";
import { OPERATOR_TOOL_DEFS } from "../operator-tool-catalog";
import { driveOperatorVideoTask } from "../operator-tools-tier3";
import { GEN45_CREDIT_COST } from "../../routes/generate/clip-pricing";

function auditRows() {
  return h.fake.store("operatorActions").rows;
}
function pendingRows() {
  return h.fake.store("operatorPendingActions").rows;
}

async function proposeAndConfirm(
  toolId: string,
  args: Record<string, unknown>,
  userId = MEMBER,
) {
  const proposal = await proposeAction({ userId, toolId, args, channel: "chat" });
  expect(proposal.status).toBe("proposed");
  if (proposal.status !== "proposed") throw new Error("unreachable");
  const outcome = await executeAction({
    userId,
    toolId,
    args: proposal ? ((pendingRows().find((r: any) => r.id === proposal.pendingId)?.args as Record<string, unknown>) ?? {}) : {},
    channel: "chat",
    pendingId: proposal.pendingId,
  });
  return { proposal, outcome };
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

describe("registry + price tripwire", () => {
  it("registers all ten Tier 3 tools beside the balance proof, each with a handler and validator", () => {
    const ids = OPERATOR_TOOLS.map((t) => t.id);
    for (const id of [
      "generate.song.short",
      "generate.song.standard",
      "generate.song.long",
      "generate.video",
      "bio.publish",
      "brandkit.generate",
      "headshot.generate",
      "streampack.asset",
      "ugc.video",
      "ugc.persona",
    ]) {
      expect(ids).toContain(id);
      const tool = getTool(id)!;
      expect(tool.tier).toBe(3);
      expect(typeof tool.handler).toBe("function");
      expect(typeof tool.validateArgs).toBe("function");
    }
  });

  it("every Tier 3 price IS the rail's constant — nothing hand-typed", () => {
    const price = (id: string) => OPERATOR_TOOL_DEFS.find((t) => t.id === id)!.priceVb;
    expect(price("generate.song.short")).toBe(400);
    expect(price("generate.song.standard")).toBe(800);
    expect(price("generate.song.long")).toBe(1200);
    expect(price("generate.video")).toBe(GEN45_CREDIT_COST);
    expect(price("bio.publish")).toBe(100);
    expect(price("brandkit.generate")).toBe(200);
    expect(price("headshot.generate")).toBe(100);
    expect(price("streampack.asset")).toBe(100);
    expect(price("ugc.video")).toBe(400);
    expect(price("ugc.persona")).toBe(100);
    /* Excluded on purpose: no publish-track tool exists at all. */
    expect(OPERATOR_TOOL_DEFS.some((t) => t.id.includes("publish.track"))).toBe(false);
    expect(getTool("generate.track")).toBeUndefined();
  });
});

describe("the confirmation law", () => {
  it("no confirmation → no execution, no rail call, audited refusal", async () => {
    const outcome = await executeAction({
      userId: MEMBER,
      toolId: "brandkit.generate",
      args: { brandName: "Wave Kings", vibe: "regal gold" },
      channel: "chat",
    });
    expect(outcome.status).toBe("refused");
    expect(outcome.reason).toBe("no_confirmation");
    expect(state.cores.brandKit).not.toHaveBeenCalled();
    expect(auditRows()).toHaveLength(1);
    expect(auditRows()[0]).toMatchObject({ result: "refused", resultReason: "no_confirmation" });
  });

  it("confirmed once → exactly one rail call as the caller, one charge at the registry price; replay refuses", async () => {
    const { proposal, outcome } = await proposeAndConfirm("brandkit.generate", {
      brandName: "Wave Kings",
      vibe: "regal gold",
    });
    expect(proposal.priceQuoted).toBe(200);
    expect(outcome.status).toBe("done");
    expect(outcome.priceCharged).toBe(200);
    expect(state.cores.brandKit).toHaveBeenCalledTimes(1);
    const [deps, body] = (state.cores.brandKit as any).mock.calls[0];
    expect(deps.userId).toBe(MEMBER);
    expect(body).toMatchObject({ brandName: "Wave Kings", vibe: "regal gold" });
    const done = auditRows().find((r: any) => r.result === "done");
    expect(done).toMatchObject({ toolId: "brandkit.generate", priceQuoted: 200, priceCharged: 200 });

    const replay = await executeAction({
      userId: MEMBER,
      toolId: "brandkit.generate",
      args: {},
      channel: "chat",
      pendingId: proposal.pendingId,
    });
    expect(replay.status).toBe("refused");
    expect(replay.reason).toBe("confirmation_replayed");
    expect(state.cores.brandKit).toHaveBeenCalledTimes(1);
  });

  it("another member cannot spend the caller's confirmation", async () => {
    const proposal = await proposeAction({
      userId: MEMBER,
      toolId: "brandkit.generate",
      args: { brandName: "Wave Kings", vibe: "regal gold" },
      channel: "chat",
    });
    if (proposal.status !== "proposed") throw new Error("expected proposed");
    const outcome = await executeAction({
      userId: OTHER,
      toolId: "brandkit.generate",
      args: {},
      channel: "chat",
      pendingId: proposal.pendingId,
    });
    expect(outcome.status).toBe("refused");
    expect(state.cores.brandKit).not.toHaveBeenCalled();
  });

  it("the daily cap stops the (cap+1)th charged action before the rail", async () => {
    const now = new Date();
    for (let i = 0; i < OPERATOR_DAILY_CHARGED_CAP; i++) {
      h.fake.seed("operatorActions", [
        {
          userId: MEMBER,
          tier: 3,
          toolId: "brandkit.generate",
          summary: "earlier",
          channel: "chat",
          priceQuoted: 200,
          priceCharged: 200,
          result: "done",
          createdAt: now,
        },
      ]);
    }
    const { outcome } = await proposeAndConfirm("brandkit.generate", {
      brandName: "Wave Kings",
      vibe: "regal gold",
    }).catch((e) => ({ outcome: null as any, err: e }));
    /* proposeAndConfirm asserts the proposal succeeded; the EXECUTION
       is what the cap must refuse. */
    expect(outcome).not.toBeNull();
    expect(outcome.status).toBe("refused");
    expect(outcome.reason).toBe("daily_cap");
    expect(state.cores.brandKit).not.toHaveBeenCalled();
  });

  it("kill switch refuses proposals outright and executions with an audit row", async () => {
    process.env["OPERATOR_HANDS_ENABLED"] = "off";
    const proposal = await proposeAction({
      userId: MEMBER,
      toolId: "brandkit.generate",
      args: { brandName: "Wave Kings", vibe: "regal gold" },
      channel: "chat",
    });
    expect(proposal).toMatchObject({ status: "refused", reason: "hands_disabled" });
    expect(pendingRows()).toHaveLength(0);

    const outcome = await executeAction({
      userId: MEMBER,
      toolId: "brandkit.generate",
      args: {},
      channel: "chat",
      pendingId: "00000000-0000-4000-8000-0000000000ff",
    });
    expect(outcome.reason).toBe("hands_disabled");
    expect(state.cores.brandKit).not.toHaveBeenCalled();
    expect(auditRows().some((r: any) => r.resultReason === "hands_disabled")).toBe(true);
  });
});

describe("proposal-time argument gate (never invent)", () => {
  it("brand kit without a brand name proposes nothing and asks — no pending row", async () => {
    const proposal = await proposeAction({
      userId: MEMBER,
      toolId: "brandkit.generate",
      args: { vibe: "regal gold" },
      channel: "chat",
    });
    expect(proposal.status).toBe("refused");
    if (proposal.status === "refused") {
      expect(proposal.reason).toBe("missing_args");
      expect(proposal.askText).toContain("brand or artist name");
    }
    expect(pendingRows()).toHaveLength(0);
    expect(state.cores.brandKit).not.toHaveBeenCalled();
  });

  it("song without a subject or a length asks; a length from the wrong tier is refused with the true price", async () => {
    const noSubject = await proposeAction({
      userId: MEMBER,
      toolId: "generate.song.short",
      args: { lengthSeconds: 30 },
      channel: "chat",
    });
    expect(noSubject).toMatchObject({ status: "refused", reason: "missing_args" });

    const noLength = await proposeAction({
      userId: MEMBER,
      toolId: "generate.song.short",
      args: { prompt: "a summer anthem" },
      channel: "chat",
    });
    expect(noLength.status).toBe("refused");
    if (noLength.status === "refused") expect(noLength.askText).toContain("400");

    const wrongTier = await proposeAction({
      userId: MEMBER,
      toolId: "generate.song.short",
      args: { prompt: "a summer anthem", lengthSeconds: 120 },
      channel: "chat",
    });
    expect(wrongTier.status).toBe("refused");
    if (wrongTier.status === "refused") {
      expect(wrongTier.reason).toBe("missing_args");
      expect(wrongTier.askText).toContain("800");
    }
    expect(pendingRows()).toHaveLength(0);
    expect(state.cores.song).not.toHaveBeenCalled();
  });

  it("a good song proposal bakes the NORMALIZED args into the pending row and charges the tier price once", async () => {
    const { proposal, outcome } = await proposeAndConfirm("generate.song.standard", {
      prompt: "a summer anthem",
      lengthSeconds: 120,
    });
    expect(proposal.priceQuoted).toBe(800);
    expect(outcome.status).toBe("done");
    expect(outcome.priceCharged).toBe(800);
    expect(state.cores.song).toHaveBeenCalledTimes(1);
    const [, body] = (state.cores.song as any).mock.calls[0];
    expect(body).toMatchObject({ prompt: "a summer anthem", lengthSeconds: 120 });
    /* Operator runs never double the price with A/B variants. */
    expect(body.variants).toBeUndefined();
  });
});

describe("per-tool execution", () => {
  it("bio.publish resolves the member's one draft at proposal time and publishes THAT page", async () => {
    h.fake.seed("bioPages", [
      { id: BIO_PAGE_ID, userId: MEMBER, slug: "wave-king", displayName: "Wave King", isPublished: false, links: [] },
    ]);
    const { outcome } = await proposeAndConfirm("bio.publish", {});
    expect(outcome.status).toBe("done");
    expect(outcome.priceCharged).toBe(100);
    expect(state.cores.bioPublish).toHaveBeenCalledTimes(1);
    const [, pageId] = (state.cores.bioPublish as any).mock.calls[0];
    expect(pageId).toBe(BIO_PAGE_ID);
    expect(outcome.replyText).toContain("wave-king");
  });

  it("bio.publish with no page of their own asks instead of proposing", async () => {
    h.fake.seed("bioPages", [
      { id: BIO_PAGE_ID, userId: OTHER, slug: "someone-else", displayName: "Not Mine", isPublished: false, links: [] },
    ]);
    const proposal = await proposeAction({ userId: MEMBER, toolId: "bio.publish", args: {}, channel: "chat" });
    expect(proposal.status).toBe("refused");
    if (proposal.status === "refused") expect(proposal.askText).toContain("don't have a bio page yet");
    expect(state.cores.bioPublish).not.toHaveBeenCalled();
  });

  it("generate.video starts the job, audits priceCharged 0 (the rail charges on success)", async () => {
    const { outcome } = await proposeAndConfirm("generate.video", { prompt: "a shark surfing at sunset" });
    expect(outcome.status).toBe("done");
    expect(outcome.priceCharged).toBe(0);
    expect(state.cores.videoSubmit).toHaveBeenCalledTimes(1);
    const [, body] = (state.cores.videoSubmit as any).mock.calls[0];
    expect(body).toMatchObject({ promptText: "a shark surfing at sunset", model: "gen4.5" });
    const done = auditRows().find((r: any) => r.result === "done");
    expect(done).toMatchObject({ toolId: "generate.video", priceQuoted: 400, priceCharged: 0 });
    /* The handler starts the completion driver fire-and-forget; flush
       it here so its background polls can't leak into the next test —
       and prove it really does drive the rail's poll + save cores. */
    await new Promise((r) => setTimeout(r, 25));
    expect(state.cores.videoPoll).toHaveBeenCalledTimes(1);
    expect(state.cores.clipSave).toHaveBeenCalledTimes(1);
  });

  it("the video driver finishes through the rail's own poll + save cores", async () => {
    (state.cores.videoPoll as any)
      .mockResolvedValueOnce({ status: 200, body: { status: "processing", progress: 0.4 } })
      .mockResolvedValueOnce({
        status: 200,
        body: { status: "succeeded", storageRef: "supabase://generated-clips/clips/x.mp4", url: "https://signed.example/x" },
      });
    const res = await driveOperatorVideoTask({
      userId: MEMBER,
      taskId: "task-9",
      prompt: "a shark surfing",
      intervalMs: 0,
      maxAttempts: 5,
    });
    expect(res).toBe("saved");
    expect(state.cores.videoPoll).toHaveBeenCalledTimes(2);
    expect(state.cores.clipSave).toHaveBeenCalledTimes(1);
    const [, saveBody] = (state.cores.clipSave as any).mock.calls[0];
    expect(saveBody).toMatchObject({ runwayJobId: "task-9", videoUrl: "supabase://generated-clips/clips/x.mp4" });
  });

  it("the video driver reports failure honestly when the task fails (no save, no charge path)", async () => {
    (state.cores.videoPoll as any).mockResolvedValue({
      status: 200,
      body: { status: "failed", error: "Runway generation failed" },
    });
    const res = await driveOperatorVideoTask({
      userId: MEMBER,
      taskId: "task-bad",
      prompt: "x",
      intervalMs: 0,
      maxAttempts: 3,
    });
    expect(res).toBe("failed");
    expect(state.cores.clipSave).not.toHaveBeenCalled();
  });

  it("ugc.persona receives the confirmation's idempotency key at the rail", async () => {
    const { proposal, outcome } = await proposeAndConfirm("ugc.persona", {
      description: "a warm twenty-something sneaker reviewer",
    });
    expect(outcome.status).toBe("done");
    expect(outcome.priceCharged).toBe(100);
    const [, body] = (state.cores.ugcPersona as any).mock.calls[0];
    expect(body.idempotencyKey).toBe(`operator:${proposal.pendingId}`);
    const done = auditRows().find((r: any) => r.result === "done");
    expect(done.idempotencyKey).toBe(`operator:${proposal.pendingId}`);
  });

  it("ugc.video resolves the member's ready ad at proposal time and generates it with the key", async () => {
    h.fake.seed("ugcAds", [
      {
        id: UGC_AD_ID,
        userId: MEMBER,
        productName: "Glow Serum",
        style: "unboxing",
        status: "draft",
        script: { hook: "Watch this", lines: ["It works"], cta: "Tap the link" },
      },
    ]);
    const { proposal, outcome } = await proposeAndConfirm("ugc.video", {});
    expect(outcome.status).toBe("done");
    expect(outcome.priceCharged).toBe(400);
    expect(state.cores.ugcCreate).not.toHaveBeenCalled();
    const [, adId, body] = (state.cores.ugcGenerate as any).mock.calls[0];
    expect(adId).toBe(UGC_AD_ID);
    expect(body.idempotencyKey).toBe(`operator:${proposal.pendingId}`);
  });

  it("ugc.video with full details creates the ad free, then renders it — one charge", async () => {
    const script = { hook: "Watch this", lines: ["It works"], cta: "Tap the link" };
    const { outcome } = await proposeAndConfirm("ugc.video", {
      productName: "Glow Serum",
      style: "unboxing",
      script,
    });
    expect(outcome.status).toBe("done");
    expect(outcome.priceCharged).toBe(400);
    expect(state.cores.ugcCreate).toHaveBeenCalledTimes(1);
    expect(state.cores.ugcGenerate).toHaveBeenCalledTimes(1);
    const [, adId] = (state.cores.ugcGenerate as any).mock.calls[0];
    expect(adId).toBe("00000000-0000-4000-8000-0000000000c9");
  });

  it("ugc.video refuses to invent a script: product + style without one asks", async () => {
    const proposal = await proposeAction({
      userId: MEMBER,
      toolId: "ugc.video",
      args: { productName: "Glow Serum", style: "unboxing" },
      channel: "chat",
    });
    expect(proposal.status).toBe("refused");
    if (proposal.status === "refused") expect(proposal.askText).toContain("script");
    expect(state.cores.ugcCreate).not.toHaveBeenCalled();
    expect(state.cores.ugcGenerate).not.toHaveBeenCalled();
  });

  it("streampack.asset validates the asset against the rail's real catalog", async () => {
    const bad = await proposeAction({
      userId: MEMBER,
      toolId: "streampack.asset",
      args: { asset: "hologram-dance", channelName: "WaveKingTV" },
      channel: "chat",
    });
    expect(bad.status).toBe("refused");
    const { outcome } = await proposeAndConfirm("streampack.asset", {
      asset: "screen-starting",
      channelName: "WaveKingTV",
    });
    expect(outcome.status).toBe("done");
    expect(outcome.priceCharged).toBe(100);
    const [, body] = (state.cores.streamPack as any).mock.calls[0];
    expect(body).toMatchObject({ asset: "screen-starting", channelName: "WaveKingTV" });
  });

  it("headshot.generate runs the autopilot shape with no details at all", async () => {
    const { outcome } = await proposeAndConfirm("headshot.generate", {});
    expect(outcome.status).toBe("done");
    expect(outcome.priceCharged).toBe(100);
    const [, body] = (state.cores.headshot as any).mock.calls[0];
    expect(body).toMatchObject({ mode: "autopilot" });
  });
});

describe("rail failure honesty", () => {
  it("a rail 500 audits `failed` with the rail's message and claims no charge", async () => {
    (state.cores.brandKit as any).mockResolvedValue({
      status: 500,
      body: { error: "Brand kit came back malformed. Please try again." },
    });
    const { outcome } = await proposeAndConfirm("brandkit.generate", {
      brandName: "Wave Kings",
      vibe: "regal gold",
    });
    expect(outcome.status).toBe("failed");
    const failed = auditRows().find((r: any) => r.result === "failed");
    expect(failed).toBeTruthy();
    expect(failed.resultReason).toContain("malformed");
    expect(failed.priceCharged ?? null).toBeNull();
    expect(auditRows().some((r: any) => r.result === "done")).toBe(false);
  });

  it("an out-of-credits rail answer (402) fails the action — the member is never told it worked", async () => {
    (state.cores.song as any).mockResolvedValue({
      status: 402,
      body: { error: "out_of_credits", message: "You are out of Visual Bucs." },
    });
    const { outcome } = await proposeAndConfirm("generate.song.short", {
      prompt: "a summer anthem",
      lengthSeconds: 30,
    });
    expect(outcome.status).toBe("failed");
    expect(auditRows().some((r: any) => r.result === "done")).toBe(false);
  });
});
