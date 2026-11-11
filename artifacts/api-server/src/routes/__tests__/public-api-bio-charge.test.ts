/**
 * Public Creator API — the ONE charged action (Bio Generator).
 *
 * Proves the charging invariants against the website rail's own core
 * (generateBiosForUser in routes/generate/bio-generator):
 * - price is the rail's BIO_COST constant (100 Visual Bucs by default —
 *   the published price, owner ruling 2026-10-24; env-overridable exactly
 *   like the rail) — never client-supplied;
 * - exactly ONE chargeCredits call per completed generation, labelled
 *   with the caller's action ("API: Bio Generator" from the API);
 * - a failed generation refunds in full and never double-charges;
 * - out-of-credits aborts BEFORE the provider is ever called.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { chargeCredits, refundCredits, refundCreditsGuaranteed, buildChargeIdempotencyKey, voidChargeIdempotencyKey, OutOfCreditsError, CreditsDisabledError } = vi.hoisted(() => {
  class OutOfCreditsError extends Error {
    readonly status = 402;
    constructor() { super("out_of_credits"); this.name = "OutOfCreditsError"; }
  }
  class CreditsDisabledError extends Error {
    readonly status = 403;
    constructor() { super("credits_disabled"); this.name = "CreditsDisabledError"; }
  }
  const refundSpy = vi.fn(async () => {});
  const voidSpy = vi.fn(async () => true);
  return {
    chargeCredits: vi.fn(),
    refundCredits: refundSpy,
    /* Charge-on-failure lane: the bio rail now refunds through the
       guaranteed helper — the hoisted fake delegates through the same
       refund/void spies (voiding only on a landed refund, one retry),
       so the call assertions below keep their exact meaning. */
    refundCreditsGuaranteed: vi.fn(async (userId: string, amount: number, rec: unknown, opts?: { idempotencyKey?: string | null }) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await (refundSpy as any)(userId, amount, rec);
          if (opts?.idempotencyKey) await (voidSpy as any)(opts.idempotencyKey);
          return true;
        } catch { /* the real helper retries exactly once */ }
      }
      return false;
    }),
    buildChargeIdempotencyKey: vi.fn(
      (scope: string, userId: string, _clientKey: unknown, intent: unknown) =>
        `${scope}:${userId}:${JSON.stringify(intent)}`,
    ),
    voidChargeIdempotencyKey: voidSpy,
    OutOfCreditsError,
    CreditsDisabledError,
  };
});

vi.mock("../../lib/credits", () => ({
  chargeCredits: (...args: unknown[]) => chargeCredits(...args),
  refundCredits: (...args: unknown[]) => refundCredits(...args),
  refundCreditsGuaranteed: (...args: unknown[]) => refundCreditsGuaranteed(...args),
  buildChargeIdempotencyKey: (...args: unknown[]) => buildChargeIdempotencyKey(...args),
  voidChargeIdempotencyKey: (...args: unknown[]) => voidChargeIdempotencyKey(...args),
  OutOfCreditsError,
  CreditsDisabledError,
}));
vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
}));

import { BIO_COST, generateBiosForUser, __resetBioReplayCache } from "../generate/bio-generator";

const input = {
  niche: "fitness coaching",
  personality: ["bold", "funny"],
  achievements: [],
};

function mockFetchOk() {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            instagram: "ig bio",
            tiktok: "tt bio",
            twitter: "tw bio",
            youtube: "yt bio",
          }),
        },
      }],
    }),
  })));
}

describe("BIO_COST — the rail's own constant", () => {
  it("is 100 Visual Bucs (the published Bio Generator price)", () => {
    expect(BIO_COST).toBe(100);
  });

  it("the bio-generator header comment names BIO_COST at 100, not the stale 50", () => {
    const src = readFileSync(
      new URL("../generate/bio-generator.ts", import.meta.url),
      "utf8",
    );
    const header = src.slice(0, src.indexOf("PLATFORM_LIMITS"));
    expect(header).not.toContain("50 Visual Bucs");
    expect(header).toContain("100 Visual Bucs");
    expect(header).toContain("BIO_COST");
  });
});

describe("generateBiosForUser charging discipline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refundCredits.mockResolvedValue(undefined);
    __resetBioReplayCache();
  });

  it("charges exactly once at BIO_COST with the API ledger label on success", async () => {
    chargeCredits.mockResolvedValue(450);
    mockFetchOk();
    const out = await generateBiosForUser("user-1", input, { action: "API: Bio Generator" });
    expect(chargeCredits).toHaveBeenCalledTimes(1);
    expect(chargeCredits).toHaveBeenCalledWith(
      "user-1",
      BIO_COST,
      { action: "API: Bio Generator" },
      expect.objectContaining({}),
    );
    expect(refundCredits).not.toHaveBeenCalled();
    expect(out.bios).toHaveLength(4);
    expect(out.creditsRemaining).toBe(450);
  });

  it("refunds in full when the provider fails — no kept charge", async () => {
    chargeCredits.mockResolvedValue(450);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    await expect(
      generateBiosForUser("user-1", input, { action: "API: Bio Generator" }),
    ).rejects.toThrow("Bio generation failed.");
    expect(chargeCredits).toHaveBeenCalledTimes(1);
    expect(refundCredits).toHaveBeenCalledTimes(1);
    expect(refundCredits).toHaveBeenCalledWith("user-1", BIO_COST, {
      action: "API: Bio Generator — Refund",
    });
  });

  it("never calls the provider when the charge refuses (out of credits)", async () => {
    chargeCredits.mockRejectedValue(new OutOfCreditsError());
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      generateBiosForUser("user-1", input, { action: "API: Bio Generator" }),
    ).rejects.toBeInstanceOf(OutOfCreditsError);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(refundCredits).not.toHaveBeenCalled();
  });

  it("threads an idempotency key into the charge so API retries charge once", async () => {
    chargeCredits.mockResolvedValue(450);
    mockFetchOk();
    await generateBiosForUser("user-1", input, {
      action: "API: Bio Generator",
      idempotencyKey: "api:key-1:abc",
    });
    expect(chargeCredits).toHaveBeenCalledWith(
      "user-1",
      BIO_COST,
      { action: "API: Bio Generator" },
      { idempotencyKey: "api:key-1:abc" },
    );
  });

  it("CA-KEY: a caller with NO key still gets a real server-derived key — never null", async () => {
    chargeCredits.mockResolvedValue(450);
    mockFetchOk();
    await generateBiosForUser("user-1", input, { action: "API: Bio Generator" });
    expect(buildChargeIdempotencyKey).toHaveBeenCalledWith(
      "bio-generator",
      "user-1",
      null,
      expect.objectContaining({ niche: "fitness coaching" }),
    );
    const chargeOpts = chargeCredits.mock.calls[0]![3] as { idempotencyKey?: unknown };
    expect(typeof chargeOpts.idempotencyKey).toBe("string");
    expect((chargeOpts.idempotencyKey as string).length).toBeGreaterThan(0);
  });

  it("CA-KEY: a no-key replay charges exactly once and serves the stored bios, flagged replayed", async () => {
    chargeCredits.mockResolvedValue(450);
    mockFetchOk();
    const first = await generateBiosForUser("user-1", input, { action: "Bio Generator" });
    const second = await generateBiosForUser("user-1", input, { action: "Bio Generator" });
    expect(chargeCredits).toHaveBeenCalledTimes(1);
    expect(first.replayed).toBeUndefined();
    expect(second.replayed).toBe(true);
    expect(second.bios).toEqual(first.bios);
  });

  it("CA-KEY: a refunded failure VOIDS the key, so the retry charges fresh", async () => {
    chargeCredits.mockResolvedValue(450);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    await expect(
      generateBiosForUser("user-1", input, { action: "API: Bio Generator", idempotencyKey: "api:key-1:xyz" }),
    ).rejects.toThrow("Bio generation failed.");
    expect(refundCredits).toHaveBeenCalledTimes(1);
    expect(voidChargeIdempotencyKey).toHaveBeenCalledWith("api:key-1:xyz");
  });
});
