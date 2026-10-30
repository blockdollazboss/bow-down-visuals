/**
 * Lane D1 (stack900) — operator song parity: B5's named residual,
 * closed. B5 made the DIRECT song rail admin-correct past 10 minutes
 * (never refused, never clamped, top-tier price) while the operator's
 * Tier-3 song tools still stopped at the 5-minute tier — a longer ask
 * dead-ended, for everyone including the owner. This suite pins the
 * operator side of the same rule, at the executor level with the REAL
 * registry, catalog, validators and handlers:
 *
 *  - a fourth song tool, generate.song.max, carries the rail's top
 *    tier (2,400) — its registry price IS the rail's own
 *    creditCostForLength at the tier ceiling, never hand-typed
 *  - member × operator, >10 min: refused at PROPOSAL time, in the
 *    rail's own plain words, before any pending row, quote, rail
 *    call, or charge (lane01's direct-path behaviour)
 *  - admin × operator, >10 min: proposed at 2,400, confirmed once →
 *    exactly one rail call carrying the UNTRIMMED length; the rail
 *    is asked for the full 700,000 ms and charges 2,400 — the same
 *    numbers B5's route suite pins for the direct path, so operator
 *    charge === direct charge for the same request
 *  - the 5–10 minute band works through the operator for members and
 *    admins alike, at the direct path's price (admin status moves
 *    limits, never prices)
 *  - ADMIN_EMAILS unset → the owner's own address is refused like
 *    any member (the predicate stays fail-closed)
 *  - a member who somehow reaches the handler with a confirmed
 *    over-length song is refused there too, before the rail
 *
 * Only the rails' provider-edge cores and the db are faked. The
 * music-audio mock re-exports the rail's REAL pricing helpers
 * (importOriginal) and stubs only runGenerateMusicAudio — with the
 * handler's own length gate mirrored from music-audio.ts (admin →
 * full length at the top tier; member → song_too_long), the same
 * semantics B5's route tests pin against the real handler.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const MEMBER = "00000000-0000-4000-8000-0000000000e1";
const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const MEMBER_EMAIL = "member@example.test";
const ADMIN_EMAIL = "owner@example.test";

const state = vi.hoisted(() => ({
  balance: 100_000,
  songCalls: [] as Array<{ deps: any; body: any }>,
  provider: [] as Array<{ musicLengthMs: number; charged: number }>,
  emails: new Map<string, string>(),
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

/* The profiles lookup lib/admin.ts resolves userIds through — the
   predicate itself is REAL; only its database edge is faked. */
vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, val: string) => ({
          single: async () => {
            const email = state.emails.get(val);
            return email
              ? { data: { email }, error: null }
              : { data: null, error: { code: "PGRST116", message: "not found" } };
          },
        }),
      }),
    }),
  }),
}));

vi.mock("../../routes/generate/music-audio", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { isAdminEmail } = await import("../admin");
  return {
    ...actual,
    runGenerateMusicAudio: async (deps: any, body: any) => {
      state.songCalls.push({ deps, body });
      const rawMs = Math.round(Number(body?.lengthSeconds ?? 0) * 1000);
      if (rawMs > actual.MAX_LENGTH_MS) {
        /* The real handler's gate (B5): a member is refused before
           any charge; an admin is asked for at the full length,
           priced at the top tier. */
        if (!isAdminEmail(deps?.userEmail)) {
          return {
            status: 400,
            body: {
              error:
                "Songs can be up to 10 minutes long — pick a length of 10 minutes or less and try again. Nothing was charged.",
              code: "song_too_long",
            },
          };
        }
        const charged = actual.SONG_PRICE_TIERS[actual.SONG_PRICE_TIERS.length - 1].cost;
        state.provider.push({ musicLengthMs: rawMs, charged });
        return { status: 200, body: { songId: "song-max", creditsRemaining: 97_600 } };
      }
      const ms = actual.clampLengthMs(body?.lengthSeconds);
      const charged = actual.creditCostForLength(ms);
      state.provider.push({ musicLengthMs: ms, charged });
      return { status: 200, body: { songId: "song-1", creditsRemaining: 97_600 } };
    },
  };
});
vi.mock("../../routes/generate/runway-clip", () => ({
  runSubmitRunwayClip: async () => ({ status: 200, body: { taskId: "task-1" } }),
  runPollRunwayClip: async () => ({ status: 200, body: { status: "succeeded" } }),
}));
vi.mock("../../routes/generated-clips", () => ({
  runSaveGeneratedClip: async () => ({ status: 201, body: { id: "clip-1" } }),
}));
vi.mock("../../routes/bio-pages", () => ({
  PUBLISH_COST: 100,
  runPublishBioPage: async () => ({ status: 200, body: { ok: true } }),
}));
vi.mock("../../routes/generate/brand-kit", () => ({
  BRAND_KIT_COST: 200,
  runGenerateBrandKit: async () => ({ status: 200, body: { ok: true } }),
}));
vi.mock("../../routes/generate/headshot-studio", () => ({
  HEADSHOT_CREDITS: 100,
  runGenerateHeadshot: async () => ({ status: 200, body: { ok: true } }),
}));
vi.mock("../../routes/generate/stream-pack", () => ({
  STREAM_PACK_CREDIT_COST: 100,
  STREAM_PACK_ASSETS: [{ key: "screen-starting", label: "Starting Soon Screen" }],
  runGenerateStreamPack: async () => ({ status: 200, body: { ok: true } }),
}));
vi.mock("../../routes/ugc-ads", () => ({
  UGC_VIDEO_CREDIT_COST: 400,
  UGC_PERSONA_CREDIT_COST: 100,
  UGC_STYLES: ["unboxing", "honest-review", "problem-fix", "grwm"],
  normalizeScript: () => null,
  runCreateUgcAd: async () => ({ status: 201, body: { ad: { id: "ad" } } }),
  runGenerateUgcAd: async () => ({ status: 200, body: { ok: true } }),
  runGenerateUgcPersona: async () => ({ status: 200, body: { ok: true } }),
}));

import { executeAction, proposeAction } from "../operator-executor";
import { getTool } from "../operator-tools";
import { getToolDef } from "../operator-tool-catalog";
import {
  creditCostForLength,
  SONG_PRICE_TIERS,
} from "../../routes/generate/music-audio";

function pendingRows() {
  return h.fake.store("operatorPendingActions").rows;
}

async function proposeAndConfirm(
  args: Record<string, unknown>,
  userId: string,
  userEmail: string,
) {
  const proposal = await proposeAction({
    userId,
    toolId: "generate.song.max",
    args,
    channel: "chat",
  });
  expect(proposal.status).toBe("proposed");
  if (proposal.status !== "proposed") throw new Error("unreachable");
  const pending = pendingRows().find((r: any) => r.id === proposal.pendingId);
  const outcome = await executeAction({
    userId,
    userEmail,
    toolId: "generate.song.max",
    args: (pending?.args as Record<string, unknown>) ?? {},
    channel: "chat",
    pendingId: proposal.pendingId,
  });
  return { proposal, outcome, pending };
}

beforeEach(() => {
  h.fake.clear();
  state.balance = 100_000;
  state.songCalls.length = 0;
  state.provider.length = 0;
  state.emails.clear();
  state.emails.set(MEMBER, MEMBER_EMAIL);
  state.emails.set(ADMIN, ADMIN_EMAIL);
  process.env["ADMIN_EMAILS"] = ADMIN_EMAIL;
  delete process.env["OPERATOR_HANDS_ENABLED"];
});

afterEach(() => {
  delete process.env["ADMIN_EMAILS"];
  delete process.env["OPERATOR_HANDS_ENABLED"];
});

describe("the registry — the top tier has a tool now", () => {
  it("generate.song.max is a Tier 3 tool priced by the rail's own function at the top tier", () => {
    const tool = getTool("generate.song.max")!;
    expect(tool).toBeDefined();
    expect(tool.tier).toBe(3);
    expect(typeof tool.handler).toBe("function");
    expect(typeof tool.validateArgs).toBe("function");
    const topTier = SONG_PRICE_TIERS[SONG_PRICE_TIERS.length - 1]!;
    expect(getToolDef("generate.song.max")!.priceVb).toBe(2_400);
    expect(getToolDef("generate.song.max")!.priceVb).toBe(creditCostForLength(600_000));
    expect(getToolDef("generate.song.max")!.priceVb).toBe(topTier.cost);
  });
});

describe("member × operator", () => {
  it("a >10-minute ask is refused at proposal, in plain words, before anything is quoted or charged", async () => {
    const proposal = await proposeAction({
      userId: MEMBER,
      toolId: "generate.song.max",
      args: { prompt: "an epic about the tide", lengthSeconds: 700 },
      channel: "chat",
    });
    expect(proposal.status).toBe("refused");
    if (proposal.status !== "refused") throw new Error("unreachable");
    expect(proposal.reason).toBe("missing_args");
    expect(proposal.askText).toContain("up to 10 minutes (600 seconds)");
    expect(proposal.askText).toContain("Nothing was charged.");
    /* No pending row exists to confirm, and the rail never moved. */
    expect(pendingRows()).toHaveLength(0);
    expect(state.songCalls).toHaveLength(0);
    expect(state.provider).toHaveLength(0);
  });

  it("a 7-minute song runs at the direct path's price for the same request (2,400)", async () => {
    const { outcome } = await proposeAndConfirm(
      { prompt: "a slow ballad about the tide", lengthSeconds: 420 },
      MEMBER,
      MEMBER_EMAIL,
    );
    expect(outcome.status).toBe("done");
    expect(outcome.priceCharged).toBe(2_400);
    expect(state.songCalls).toHaveLength(1);
    expect(state.songCalls[0]!.body["lengthSeconds"]).toBe(420);
    expect(state.provider[0]).toEqual({ musicLengthMs: 420_000, charged: 2_400 });
    expect(state.provider[0]!.charged).toBe(creditCostForLength(420_000));
  });

  it("the handler itself refuses a member's over-length song before the rail (defence in depth)", async () => {
    const tool = getTool("generate.song.max")!;
    await expect(
      tool.handler({
        userId: MEMBER,
        userEmail: MEMBER_EMAIL,
        args: { prompt: "an epic about the tide", lengthSeconds: 700 },
      }),
    ).rejects.toThrow(/Nothing was charged/);
    expect(state.songCalls).toHaveLength(0);
  });
});

describe("admin × operator", () => {
  it("a >10-minute ask is proposed at 2,400 and runs UNTRIMMED — one rail call, full length, the direct path's charge", async () => {
    const { proposal, outcome } = await proposeAndConfirm(
      { prompt: "an epic about the tide", lengthSeconds: 700 },
      ADMIN,
      ADMIN_EMAIL,
    );
    expect(proposal.priceQuoted).toBe(2_400);
    expect(outcome.status).toBe("done");
    expect(outcome.priceCharged).toBe(2_400);
    /* Exactly one rail call, carrying the length he asked for —
       700 seconds in the body, 700,000 ms to the provider, never
       the clamped 600. */
    expect(state.songCalls).toHaveLength(1);
    expect(state.songCalls[0]!.deps.userEmail).toBe(ADMIN_EMAIL);
    expect(state.songCalls[0]!.body["lengthSeconds"]).toBe(700);
    expect(state.provider[0]).toEqual({ musicLengthMs: 700_000, charged: 2_400 });
    /* Charge equality with the direct path: the rail charged the
       same 2,400 B5's route suite pins for a direct 700s admin
       request, and the operator reports exactly that charge. */
    expect(state.provider[0]!.charged).toBe(outcome.priceCharged);
  });

  it("exactly-once still holds past the top tier: a replayed confirmation refuses, the rail is untouched", async () => {
    const { proposal, pending } = await proposeAndConfirm(
      { prompt: "an epic about the tide", lengthSeconds: 700 },
      ADMIN,
      ADMIN_EMAIL,
    );
    expect(state.songCalls).toHaveLength(1);
    const replay = await executeAction({
      userId: ADMIN,
      userEmail: ADMIN_EMAIL,
      toolId: "generate.song.max",
      args: (pending?.args as Record<string, unknown>) ?? {},
      channel: "chat",
      pendingId: proposal.pendingId,
    });
    expect(replay.status).toBe("refused");
    expect(replay.reason).toBe("confirmation_replayed");
    expect(state.songCalls).toHaveLength(1);
  });

  it("a 7-minute song costs the admin the same 2,400 as a member — admin status moves limits, never prices", async () => {
    const { outcome } = await proposeAndConfirm(
      { prompt: "a slow ballad about the tide", lengthSeconds: 420 },
      ADMIN,
      ADMIN_EMAIL,
    );
    expect(outcome.status).toBe("done");
    expect(outcome.priceCharged).toBe(2_400);
    expect(state.provider[0]).toEqual({ musicLengthMs: 420_000, charged: 2_400 });
  });
});

describe("fail-closed", () => {
  it("ADMIN_EMAILS unset: the owner's own address is refused past 10 minutes like any member", async () => {
    delete process.env["ADMIN_EMAILS"];
    const proposal = await proposeAction({
      userId: ADMIN,
      toolId: "generate.song.max",
      args: { prompt: "an epic about the tide", lengthSeconds: 700 },
      channel: "chat",
    });
    expect(proposal.status).toBe("refused");
    if (proposal.status !== "refused") throw new Error("unreachable");
    expect(proposal.reason).toBe("missing_args");
    expect(proposal.askText).toContain("Nothing was charged.");
    expect(pendingRows()).toHaveLength(0);
    expect(state.songCalls).toHaveLength(0);
  });
});
