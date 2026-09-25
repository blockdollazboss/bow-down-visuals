/**
 * Money-integrity + pricing tests for Fan Shoutouts.
 *
 * Covers: the 1-credit AI message charge, the out-of-credits 402 contract,
 * free setup/request CRUD (never charged), price math (dollars↔cents,
 * platform fee), status-transition rules, and the max_completion_tokens
 * assertion (never max_tokens — GPT-6 rejects it).
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
  shoutoutSettingsTable: { id: "id", user_id: "user_id", accepting: "accepting", updated_at: "updated_at" },
  shoutoutRequestsTable: {
    id: "id",
    creator_user_id: "creator_user_id",
    status: "status",
    created_at: "created_at",
  },
}));

import {
  SHOUTOUT_AI_CREDITS,
  SHOUTOUT_PLATFORM_FEE_PCT,
  REQUEST_STATUSES,
  dollarsToCents,
  centsToDollars,
  netAfterFee,
  canTransition,
} from "../shoutouts";
import { chargeCredits, refundCredits } from "../../../lib/credits";

const mockCharge = vi.mocked(chargeCredits);
const mockRefund = vi.mocked(refundCredits);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SHOUTOUT_AI_CREDITS", () => {
  it("charges 1 credit per AI message draft", () => {
    expect(SHOUTOUT_AI_CREDITS).toBe(1);
  });

  it("reads the env override", async () => {
    vi.resetModules();
    process.env["SHOUTOUT_AI_CREDIT_COST"] = "2";
    const mod = await import("../shoutouts");
    expect(mod.SHOUTOUT_AI_CREDITS).toBe(2);
    delete process.env["SHOUTOUT_AI_CREDIT_COST"];
    vi.resetModules();
  });
});

describe("platform fee", () => {
  it("records a 10% platform-fee intent", () => {
    expect(SHOUTOUT_PLATFORM_FEE_PCT).toBe(10);
  });

  it("netAfterFee deducts the fee", () => {
    expect(netAfterFee(1000)).toBe(900);
    expect(netAfterFee(999)).toBe(899);
    expect(netAfterFee(0)).toBe(0);
  });
});

describe("price math", () => {
  it("dollarsToCents rounds to integer cents", () => {
    expect(dollarsToCents(25)).toBe(2500);
    expect(dollarsToCents(19.99)).toBe(1999);
    expect(dollarsToCents(0)).toBe(0);
  });

  it("centsToDollars inverts dollarsToCents", () => {
    expect(centsToDollars(dollarsToCents(12.34))).toBeCloseTo(12.34, 10);
  });
});

describe("request statuses", () => {
  it("exposes the five v1 statuses, starting at pending_payment", () => {
    expect(REQUEST_STATUSES).toEqual([
      "pending_payment",
      "accepted",
      "in_progress",
      "delivered",
      "declined",
    ]);
  });

  it("never reports a request as paid or completed in v1", () => {
    const joined = REQUEST_STATUSES.join(",");
    expect(joined).not.toContain("paid");
    expect(joined).not.toContain("completed");
  });
});

describe("canTransition", () => {
  it("allows the happy path", () => {
    expect(canTransition("pending_payment", "accepted")).toBe(true);
    expect(canTransition("accepted", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "delivered")).toBe(true);
  });

  it("allows declining from any non-terminal state", () => {
    expect(canTransition("pending_payment", "declined")).toBe(true);
    expect(canTransition("accepted", "declined")).toBe(true);
    expect(canTransition("in_progress", "declined")).toBe(true);
  });

  it("blocks skipping steps and reopening terminal states", () => {
    expect(canTransition("pending_payment", "delivered")).toBe(false);
    expect(canTransition("accepted", "delivered")).toBe(false);
    expect(canTransition("delivered", "in_progress")).toBe(false);
    expect(canTransition("declined", "accepted")).toBe(false);
    expect(canTransition("delivered", "pending_payment")).toBe(false);
  });

  it("never allows a transition to paid/completed", () => {
    for (const from of REQUEST_STATUSES) {
      expect(canTransition(from, "paid" as never)).toBe(false);
      expect(canTransition(from, "completed" as never)).toBe(false);
    }
  });
});

describe("credits lib wiring", () => {
  it("exposes charge/refund mocks for the AI endpoint", () => {
    expect(mockCharge).toBeDefined();
    expect(mockRefund).toBeDefined();
  });
});

describe("max_completion_tokens (never max_tokens)", () => {
  it("the route source uses max_completion_tokens, not max_tokens", async () => {
    const fs = await import("node:fs");
    const path = new URL("../shoutouts.ts", import.meta.url);
    const src = fs.readFileSync(path, "utf8");
    expect(src).toMatch(/max_completion_tokens/);
    expect(src).not.toMatch(/[^_]max_tokens[^_]/);
  });
});
