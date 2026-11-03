/**
 * chat-credit-cost.test.ts — /api/chat price, DECIDED.
 *
 * Owner ruling (Oct 27): /api/chat carries NO separate charge.
 * Stack1400 price-fix (price-accuracy audit #4, 2026-11-02): the rail
 * previously defaulted CHAT_CREDIT_COST to "1", so any deployment
 * with the env unset silently charged 1 VB per message. The code
 * default is now 0 (unset env = free). An explicit env setting > 0
 * still wins — the owner's override is preserved.
 */
import { afterEach, describe, expect, it } from "vitest";
import { getChatCreditCost } from "../ai-chat-assistant";

const ORIGINAL = process.env["CHAT_CREDIT_COST"];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env["CHAT_CREDIT_COST"];
  else process.env["CHAT_CREDIT_COST"] = ORIGINAL;
});

describe("getChatCreditCost — /api/chat carries no separate charge by default", () => {
  it("unset env = no charge (0)", () => {
    delete process.env["CHAT_CREDIT_COST"];
    expect(getChatCreditCost()).toBe(0);
  });

  it("explicit env 0 = no charge (0)", () => {
    process.env["CHAT_CREDIT_COST"] = "0";
    expect(getChatCreditCost()).toBe(0);
  });

  it("explicit env > 0 still charges (owner override preserved)", () => {
    process.env["CHAT_CREDIT_COST"] = "3";
    expect(getChatCreditCost()).toBe(3);
    process.env["CHAT_CREDIT_COST"] = "1";
    expect(getChatCreditCost()).toBe(1);
  });

  it("non-positive / invalid env values fall back to no charge", () => {
    process.env["CHAT_CREDIT_COST"] = "-5";
    expect(getChatCreditCost()).toBe(0);
    process.env["CHAT_CREDIT_COST"] = "not-a-number";
    expect(getChatCreditCost()).toBe(0);
  });
});
