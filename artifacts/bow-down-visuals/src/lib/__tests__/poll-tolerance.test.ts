import { describe, it, expect } from "vitest";
import {
  MAX_CONSECUTIVE_POLL_FAILURES,
  PollFailureBudget,
  isTransientPollHttpStatus,
} from "../poll-tolerance";

/**
 * Stack-200 item 187 pins: every durable-job poller in the editor shares
 * one transient-failure contract — 5xx/429 and network throws are
 * tolerated up to a consecutive budget inside the caller's deadline;
 * other 4xx answers surface immediately.
 */
describe("isTransientPollHttpStatus", () => {
  it("treats 5xx and 429 as transient", () => {
    expect(isTransientPollHttpStatus(500)).toBe(true);
    expect(isTransientPollHttpStatus(502)).toBe(true);
    expect(isTransientPollHttpStatus(503)).toBe(true);
    expect(isTransientPollHttpStatus(429)).toBe(true);
  });

  it("treats client errors as real answers that surface at once", () => {
    expect(isTransientPollHttpStatus(400)).toBe(false);
    expect(isTransientPollHttpStatus(401)).toBe(false);
    expect(isTransientPollHttpStatus(403)).toBe(false);
    expect(isTransientPollHttpStatus(404)).toBe(false);
    expect(isTransientPollHttpStatus(402)).toBe(false);
  });
});

describe("PollFailureBudget", () => {
  it("tolerates exactly MAX_CONSECUTIVE_POLL_FAILURES consecutive failures", () => {
    const budget = new PollFailureBudget();
    for (let i = 0; i < MAX_CONSECUTIVE_POLL_FAILURES; i++) {
      expect(budget.noteTransientFailure()).toBe(true);
    }
    expect(budget.failures).toBe(MAX_CONSECUTIVE_POLL_FAILURES);
    expect(budget.noteTransientFailure()).toBe(false);
  });

  it("a successful poll resets the consecutive count", () => {
    const budget = new PollFailureBudget();
    budget.noteTransientFailure();
    budget.noteTransientFailure();
    budget.noteSuccess();
    expect(budget.failures).toBe(0);
    // Full budget is available again after the reset.
    for (let i = 0; i < MAX_CONSECUTIVE_POLL_FAILURES; i++) {
      expect(budget.noteTransientFailure()).toBe(true);
    }
    expect(budget.noteTransientFailure()).toBe(false);
  });
});
