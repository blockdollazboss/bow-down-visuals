/**
 * Public Creator API — the ONE charged action (Bio Generator).
 *
 * Proves the charging invariants against the website rail's own core
 * (generateBiosForUser in routes/generate/bio-generator):
 * - price is the rail's BIO_COST constant (50 Visual Bucs by default,
 *   env-overridable exactly like the rail) — never client-supplied;
 * - exactly ONE chargeCredits call per completed generation, labelled
 *   with the caller's action ("API: Bio Generator" from the API);
 * - a failed generation refunds in full and never double-charges;
 * - out-of-credits aborts BEFORE the provider is ever called.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { chargeCredits, refundCredits, OutOfCreditsError, CreditsDisabledError } = vi.hoisted(() => {
  class OutOfCreditsError extends Error {
    readonly status = 402;
    constructor() { super("out_of_credits"); this.name = "OutOfCreditsError"; }
  }
  class CreditsDisabledError extends Error {
    readonly status = 403;
    constructor() { super("credits_disabled"); this.name = "CreditsDisabledError"; }
  }
  return {
    chargeCredits: vi.fn(),
    refundCredits: vi.fn(async () => {}),
    OutOfCreditsError,
    CreditsDisabledError,
  };
});

vi.mock("../../lib/credits", () => ({
  chargeCredits: (...args: unknown[]) => chargeCredits(...args),
  refundCredits: (...args: unknown[]) => refundCredits(...args),
  OutOfCreditsError,
  CreditsDisabledError,
}));
vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
}));

import { BIO_COST, generateBiosForUser } from "../generate/bio-generator";

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
  it("is 50 Visual Bucs (the website Bio Generator price)", () => {
    expect(BIO_COST).toBe(50);
  });
});

describe("generateBiosForUser charging discipline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refundCredits.mockResolvedValue(undefined);
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
});
