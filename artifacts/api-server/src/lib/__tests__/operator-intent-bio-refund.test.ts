/**
 * Payfix lane 7 (operator hands) — auto-refund on the operator path,
 * proven against the REAL Bio Generator core (generateBiosForUser —
 * the exact function the Bio Generator page and the public API call),
 * driven through the REAL registry + executor.
 *
 * The live PASS-4 evidence (Oct 26) showed the charge-with-refund rail
 * working from the page: a failed SFX generation charged 100 VB and
 * auto-refunded +100 ("Text-to-SFX — Refund (generation failed)").
 * This suite pins the same discipline for a CONFIRMED CHAT ORDER:
 *
 *  - success: chargeCredits exactly once at BIO_COST (100), carrying
 *    the confirmation's idempotency key (operator:<pendingId>) so a
 *    replayed charge cannot double-charge at the rail either; no refund
 *  - provider failure: the core refunds in full (same 100, "— Refund"
 *    ledger label), the executor audits `failed` and claims NO charge —
 *    the member's net spend for the failed action is zero
 *  - the two tools this lane added are registered Tier 3 at the rails'
 *    own constants (bio.generate = BIO_COST 100, sfx.generate =
 *    SFX_CREDIT_COST 100), each with a handler and a validator
 *
 * Only the db, credits ledger functions, the text-model name, the
 * provider fetch, and the OTHER rails' provider-edge cores are faked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const MEMBER = "00000000-0000-4000-8000-0000000000d8";

const state = vi.hoisted(() => ({
  balance: 100_000,
  chargeCredits: vi.fn(async (..._a: unknown[]) => 99_900),
  refundCredits: vi.fn(async (..._a: unknown[]) => 100_000),
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

vi.mock("../credits", () => {
  class OutOfCreditsError extends Error { readonly code = "OUT_OF_CREDITS"; }
  class LedgerWriteError extends Error { readonly code = "LEDGER_WRITE"; }
  return {
    OutOfCreditsError,
    LedgerWriteError,
    getCreditBalance: async (_userId: string) => state.balance,
    chargeCredits: (...a: unknown[]) => state.chargeCredits(...a),
    refundCredits: (...a: unknown[]) => state.refundCredits(...a),
    buildChargeIdempotencyKey: () => "test-key",
    voidChargeIdempotencyKey: async () => true,
  };
});

vi.mock("../ai-clients", () => ({
  getTextModel: () => "test-model",
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: "{}" } }] }),
      },
    },
  }),
}));

/* The other rails' provider-edge cores — stubbed exactly as in
   operator-tier3.test.ts so the registry loads; the BIO core is
   deliberately NOT mocked: it is the rail under test. */
vi.mock("../../routes/generate/music-audio", () => ({
  creditCostForLength: (lengthMs: number) => {
    if (lengthMs <= 60_000) return 400;
    if (lengthMs <= 180_000) return 800;
    return 1200;
  },
  clampLengthMs: (raw: unknown) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 60_000;
    return Math.min(300_000, Math.max(10_000, Math.round(n * 1000)));
  },
  runGenerateMusicAudio: vi.fn(async () => ({ status: 200, body: { songId: "song-1" } })),
}));
vi.mock("../../routes/generate/runway-clip", () => ({
  runSubmitRunwayClip: vi.fn(async () => ({ status: 200, body: { taskId: "task-1", creditCost: 400 } })),
  runPollRunwayClip: vi.fn(async () => ({ status: 200, body: { status: "succeeded", storageRef: "supabase://x" } })),
}));
vi.mock("../../routes/generated-clips", () => ({
  runSaveGeneratedClip: vi.fn(async () => ({ status: 201, body: { id: "clip-1" } })),
}));
vi.mock("../../routes/bio-pages", () => ({
  PUBLISH_COST: 100,
  runPublishBioPage: vi.fn(async () => ({ status: 200, body: { ok: true, url: "https://bowdownvisuals.com/bio/x", slug: "x" } })),
}));
vi.mock("../../routes/generate/brand-kit", () => ({
  BRAND_KIT_COST: 200,
  runGenerateBrandKit: vi.fn(async () => ({ status: 200, body: { brandName: "Wave Kings", kit: {}, saved: true } })),
}));
vi.mock("../../routes/generate/headshot-studio", () => ({
  HEADSHOT_CREDITS: 100,
  HEADSHOT_STUDIO_CREDIT_COST: 100,
  runGenerateHeadshot: vi.fn(async () => ({ status: 200, body: { url: "https://cdn.example/h.png", path: "p", creditCost: 100 } })),
}));
vi.mock("../../routes/generate/stream-pack", () => ({
  STREAM_PACK_CREDIT_COST: 100,
  STREAM_PACK_ASSETS: [{ key: "screen-starting", label: "Starting Soon Screen" }],
  runGenerateStreamPack: vi.fn(async () => ({ status: 200, body: { asset: "screen-starting", label: "Starting Soon Screen", creditCost: 100 } })),
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
  runCreateUgcAd: vi.fn(async () => ({ status: 201, body: { ad: { id: "00000000-0000-4000-8000-0000000000c9" } } })),
  runGenerateUgcAd: vi.fn(async () => ({ status: 200, body: { ad: { id: "ad" }, creditsUsed: 400 } })),
  runGenerateUgcPersona: vi.fn(async () => ({ status: 200, body: { personaUrl: "https://cdn.example/p.png", creditsUsed: 100 } })),
}));

import { executeAction, proposeAction } from "../operator-executor";
import { getTool } from "../operator-tools";
import { OPERATOR_TOOL_DEFS } from "../operator-tool-catalog";
import { BIO_COST } from "../../routes/generate/bio-pricing";
import { SFX_CREDIT_COST } from "../../routes/generate/sfx-pricing";

function auditRows() {
  return h.fake.store("operatorActions").rows;
}
function pendingRow(id: string) {
  return h.fake.store("operatorPendingActions").rows.find((r: any) => r.id === id);
}

function stubProviderOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                instagram: "ig bio",
                tiktok: "tt bio",
                twitter: "tw bio",
                youtube: "yt bio",
              }),
            },
          },
        ],
      }),
    })),
  );
}

async function proposeBio() {
  const proposal = await proposeAction({
    userId: MEMBER,
    toolId: "bio.generate",
    args: { niche: "fitness coach", personality: ["bold", "funny"] },
    channel: "chat_text",
  });
  expect(proposal.status).toBe("proposed");
  if (proposal.status !== "proposed") throw new Error("unreachable");
  return proposal;
}

beforeEach(() => {
  h.fake.clear();
  state.balance = 100_000;
  state.chargeCredits.mockClear();
  state.refundCredits.mockClear();
  delete process.env["OPERATOR_HANDS_ENABLED"];
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["OPERATOR_HANDS_ENABLED"];
});

describe("the lane's two new tools — registered at the rails' own constants", () => {
  it("bio.generate and sfx.generate are Tier 3, priced 100 VB from BIO_COST / SFX_CREDIT_COST, with handler + validator", () => {
    expect(BIO_COST).toBe(100);
    expect(SFX_CREDIT_COST).toBe(100);
    for (const id of ["bio.generate", "sfx.generate"]) {
      const tool = getTool(id)!;
      expect(tool, id).toBeTruthy();
      expect(tool.tier).toBe(3);
      expect(tool.priceVb).toBe(100);
      expect(typeof tool.handler).toBe("function");
      expect(typeof tool.validateArgs).toBe("function");
      expect(OPERATOR_TOOL_DEFS.find((t) => t.id === id)!.priceVb).toBe(100);
    }
  });

  it("bio.generate without a niche or personality proposes nothing and asks — no pending row, no charge", async () => {
    const noNiche = await proposeAction({
      userId: MEMBER,
      toolId: "bio.generate",
      args: { personality: ["bold"] },
      channel: "chat_text",
    });
    expect(noNiche).toMatchObject({ status: "refused", reason: "missing_args" });
    const noTraits = await proposeAction({
      userId: MEMBER,
      toolId: "bio.generate",
      args: { niche: "fitness coach" },
      channel: "chat_text",
    });
    expect(noTraits).toMatchObject({ status: "refused", reason: "missing_args" });
    expect(h.fake.store("operatorPendingActions").rows).toHaveLength(0);
    expect(state.chargeCredits).not.toHaveBeenCalled();
  });

  it("sfx.generate without a described sound proposes nothing and asks", async () => {
    const proposal = await proposeAction({
      userId: MEMBER,
      toolId: "sfx.generate",
      args: {},
      channel: "chat_text",
    });
    expect(proposal).toMatchObject({ status: "refused", reason: "missing_args" });
    expect(h.fake.store("operatorPendingActions").rows).toHaveLength(0);
  });
});

describe("a confirmed bio.generate order against the REAL rail core", () => {
  it("success: charges exactly once at 100 VB with the confirmation's idempotency key; no refund", async () => {
    stubProviderOk();
    const proposal = await proposeBio();
    expect(proposal.priceQuoted).toBe(100);

    const outcome = await executeAction({
      userId: MEMBER,
      toolId: "bio.generate",
      args: (pendingRow(proposal.pendingId).args as Record<string, unknown>) ?? {},
      channel: "chat_text",
      pendingId: proposal.pendingId,
    });
    expect(outcome.status).toBe("done");
    expect(outcome.priceCharged).toBe(100);
    expect(outcome.replyText).toContain("your bios are made");
    expect(outcome.replyText).toContain("Instagram: ig bio");

    expect(state.chargeCredits).toHaveBeenCalledTimes(1);
    expect(state.chargeCredits).toHaveBeenCalledWith(
      MEMBER,
      BIO_COST,
      { action: "Bio Generator" },
      { idempotencyKey: `operator:${proposal.pendingId}` },
    );
    expect(state.refundCredits).not.toHaveBeenCalled();
    const done = auditRows().find((r: any) => r.result === "done");
    expect(done).toMatchObject({ toolId: "bio.generate", priceQuoted: 100, priceCharged: 100 });
    expect(done.idempotencyKey).toBe(`operator:${proposal.pendingId}`);
  });

  it("AUTO-REFUND: provider failure refunds the full 100 VB and the executor claims no charge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    const proposal = await proposeBio();

    const outcome = await executeAction({
      userId: MEMBER,
      toolId: "bio.generate",
      args: (pendingRow(proposal.pendingId).args as Record<string, unknown>) ?? {},
      channel: "chat_text",
      pendingId: proposal.pendingId,
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.priceCharged ?? null).toBeNull();

    /* One charge, one FULL refund with the rail's refund label —
       net spend for the failed generation is zero, exactly the
       discipline PASS 4 observed live on the SFX page rail. */
    expect(state.chargeCredits).toHaveBeenCalledTimes(1);
    expect(state.refundCredits).toHaveBeenCalledTimes(1);
    expect(state.refundCredits).toHaveBeenCalledWith(MEMBER, BIO_COST, {
      action: "Bio Generator — Refund",
    });

    const failed = auditRows().find((r: any) => r.result === "failed");
    expect(failed).toBeTruthy();
    expect(failed.priceCharged ?? null).toBeNull();
    expect(auditRows().some((r: any) => r.result === "done")).toBe(false);
  });
});
