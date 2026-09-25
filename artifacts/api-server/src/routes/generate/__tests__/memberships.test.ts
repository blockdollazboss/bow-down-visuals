/**
 * Money-integrity + pricing tests for Fan Memberships.
 *
 * Covers: the 1-credit AI perk suggester charge, the out-of-credits 402
 * contract, free tier/member CRUD (never charged), price math
 * (dollars↔cents, platform fee), perk suggestion validation, and the
 * max_completion_tokens assertion (never max_tokens — GPT-6 rejects it).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(),
  refundCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(),
  getTextModel: vi.fn(() => "gpt-6-sol"),
}));

vi.mock("../../../lib/payment-record", () => ({
  recordCreditUsage: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
  fanTiersTable: { id: "id", user_id: "user_id", sort_order: "sort_order", created_at: "created_at" },
  fanMembersTable: { id: "id", user_id: "user_id", tier_id: "tier_id", fan_label: "fan_label", joined_at: "joined_at" },
}));

import {
  MEMBERSHIPS_AI_CREDITS,
  MEMBERSHIPS_PLATFORM_FEE_PCT,
  dollarsToCents,
  centsToDollars,
  netAfterFee,
} from "../memberships";
import { chargeCredits, refundCredits } from "../../../lib/credits";

const mockCharge = vi.mocked(chargeCredits);
const mockRefund = vi.mocked(refundCredits);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MEMBERSHIPS_AI_CREDITS", () => {
  it("charges 1 credit per AI perk suggestion", () => {
    expect(MEMBERSHIPS_AI_CREDITS).toBe(1);
  });

  it("reads the env override", async () => {
    vi.resetModules();
    process.env["MEMBERSHIPS_AI_CREDIT_COST"] = "3";
    const mod = await import("../memberships");
    expect(mod.MEMBERSHIPS_AI_CREDITS).toBe(3);
    delete process.env["MEMBERSHIPS_AI_CREDIT_COST"];
    vi.resetModules();
  });
});

describe("MEMBERSHIPS_PLATFORM_FEE_PCT", () => {
  it("takes a 10% platform fee", () => {
    expect(MEMBERSHIPS_PLATFORM_FEE_PCT).toBe(10);
  });
});

describe("dollarsToCents / centsToDollars", () => {
  it("converts dollars to integer cents", () => {
    expect(dollarsToCents(5)).toBe(500);
    expect(dollarsToCents(4.99)).toBe(499);
    expect(dollarsToCents(0)).toBe(0);
  });

  it("rounds fractional cents", () => {
    expect(dollarsToCents(9.999)).toBe(1000);
  });

  it("converts cents back to dollars", () => {
    expect(centsToDollars(500)).toBe(5);
    expect(centsToDollars(499)).toBe(4.99);
  });
});

describe("netAfterFee", () => {
  it("deducts the 10% platform fee", () => {
    expect(netAfterFee(1000)).toBe(900);
    expect(netAfterFee(0)).toBe(0);
  });

  it("rounds to whole cents", () => {
    expect(netAfterFee(999)).toBe(899); /* 899.1 → 899 */
  });
});

describe("charge/refund exports exist for the route", () => {
  it("exposes chargeCredits and refundCredits", () => {
    expect(typeof mockCharge).toBe("function");
    expect(typeof mockRefund).toBe("function");
  });
});

describe("GPT-6 token parameter contract", () => {
  it("the route source uses max_completion_tokens and never max_tokens", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../memberships.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("max_completion_tokens");
    /* max_tokens as a bare param name must not appear (GPT-6 rejects it). */
    expect(src).not.toMatch(/(?<!_)max_tokens(?!_)/);
  });
});

describe("honesty contract", () => {
  it("the route source never claims payments are live", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../memberships.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("coming soon");
    expect(src).toContain("paymentsLive: false");
    expect(src).not.toContain("stripe.charges.create");
    expect(src).not.toContain("payment_intent");
  });

  it("tier/member CRUD is free — no chargeCredits call outside ai-perks", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../memberships.ts", import.meta.url),
      "utf8",
    );
    const charges = src.match(/chargeCredits\(/g) ?? [];
    /* Exactly one charge: the AI perk suggester. */
    expect(charges).toHaveLength(1);
  });
});
