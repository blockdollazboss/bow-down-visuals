/**
 * feedback-prompt.test.ts — UPGRADES 180 trigger law, client half.
 *
 * Pins every gate of decideFeedbackPrompt, in order: a prompt needs a
 * QUALIFYING moment (never a bare page load — a null/unknown moment
 * can never show), the Settings toggle ON, the 7-day cap clear of the
 * last SHOWING, no suppression context (creation flows, calls, live
 * streams, checkout — by flag or by route), and only then a chance
 * roll under FEEDBACK_PROMPT_CHANCE.
 */
import { describe, expect, it } from "vitest";
import {
  FEEDBACK_PROMPT_CAP_MS,
  FEEDBACK_PROMPT_CHANCE,
  decideFeedbackPrompt,
  isSuppressedContext,
  type FeedbackDecisionInput,
} from "./feedback-prompt";

const NOW = Date.UTC(2026, 9, 25, 16, 0, 0);

function input(over: Partial<FeedbackDecisionInput> = {}): FeedbackDecisionInput {
  return {
    moment: "export_finished",
    enabled: true,
    lastPromptedAt: null,
    now: NOW,
    context: { pathname: "/dashboard" },
    roll: 0, // a winning roll — gates, not luck, decide the failures below
    ...over,
  };
}

describe("feedback prompt trigger law", () => {
  it("shows only when every gate passes", () => {
    expect(decideFeedbackPrompt(input())).toEqual({ show: true, reason: "show" });
    for (const moment of ["export_finished", "creation_succeeded", "session_milestone"]) {
      expect(decideFeedbackPrompt(input({ moment })).show).toBe(true);
    }
  });

  it("NEVER fires on a bare page load: no moment (or an unknown one) is not qualifying", () => {
    expect(decideFeedbackPrompt(input({ moment: null })).reason).toBe("not_qualifying");
    expect(decideFeedbackPrompt(input({ moment: undefined })).reason).toBe("not_qualifying");
    expect(decideFeedbackPrompt(input({ moment: "page_load" })).reason).toBe("not_qualifying");
  });

  it("the Settings toggle OFF is absolute", () => {
    expect(decideFeedbackPrompt(input({ enabled: false }))).toEqual({ show: false, reason: "disabled" });
  });

  it("the hard cap is 7 days from the last SHOWING", () => {
    const sixDaysAgo = new Date(NOW - 6 * 24 * 3600 * 1000).toISOString();
    expect(decideFeedbackPrompt(input({ lastPromptedAt: sixDaysAgo })).reason).toBe("capped");
    const exactlyCap = new Date(NOW - FEEDBACK_PROMPT_CAP_MS).toISOString();
    expect(decideFeedbackPrompt(input({ lastPromptedAt: exactlyCap })).show).toBe(true);
  });

  it("suppression: creation flows, calls, live streams, checkout — by flag", () => {
    for (const context of [{ inCreationFlow: true }, { inCall: true }, { inLiveStream: true }, { inCheckout: true }]) {
      expect(decideFeedbackPrompt(input({ context })).reason).toBe("suppressed");
    }
  });

  it("suppression: the same surfaces by route", () => {
    for (const pathname of ["/create", "/video-editor", "/audio-studio", "/go-live", "/live/abc", "/live-shopping", "/checkout", "/messages", "/world", "/cart"]) {
      expect(isSuppressedContext({ pathname })).toBe(true);
      expect(decideFeedbackPrompt(input({ context: { pathname } })).reason).toBe("suppressed");
    }
    for (const pathname of ["/dashboard", "/pitch-fix", "/home", "/earnings", "/library"]) {
      expect(isSuppressedContext({ pathname })).toBe(false);
    }
  });

  it("the chance roll is the LAST gate: a losing roll drops a fully-eligible moment", () => {
    expect(decideFeedbackPrompt(input({ roll: FEEDBACK_PROMPT_CHANCE })).reason).toBe("roll_missed");
    expect(decideFeedbackPrompt(input({ roll: 0.99 })).reason).toBe("roll_missed");
    expect(decideFeedbackPrompt(input({ roll: FEEDBACK_PROMPT_CHANCE - 0.001 })).show).toBe(true);
    // …and a winning roll cannot rescue a gated moment:
    expect(decideFeedbackPrompt(input({ roll: 0, enabled: false })).reason).toBe("disabled");
    expect(decideFeedbackPrompt(input({ roll: 0, context: { inLiveStream: true } })).reason).toBe("suppressed");
  });
});
