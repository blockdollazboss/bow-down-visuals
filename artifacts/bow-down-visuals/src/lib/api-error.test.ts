import { describe, expect, it } from "vitest";
import {
  API_ERROR_CODE_MESSAGES,
  apiErrorMessage,
  isErrorCodeShape,
  messageForErrorCode,
  plainErrorText,
} from "./api-error";

const FALLBACK = "It didn't work — try again.";

describe("api-error — the Gate #3 law: a raw server code never renders", () => {
  it("prefers the server's plain message over the code beside it", () => {
    expect(
      apiErrorMessage(
        { error: "credits_disabled", message: "Credit spending is temporarily disabled. Please try again later." },
        FALLBACK,
      ),
    ).toBe("Credit spending is temporarily disabled. Please try again later.");
    expect(
      apiErrorMessage(
        { error: "out_of_credits", message: "Not enough Visual Bucs — the AI Coach costs 100 Visual Bucs." },
        FALLBACK,
      ),
    ).toContain("costs 100 Visual Bucs");
  });

  it("translates a bare code when no message rides along", () => {
    expect(apiErrorMessage({ error: "credits_disabled" }, FALLBACK)).toBe(
      API_ERROR_CODE_MESSAGES.credits_disabled,
    );
    expect(apiErrorMessage({ error: "out_of_credits" }, FALLBACK)).toBe(
      API_ERROR_CODE_MESSAGES.out_of_credits,
    );
    expect(apiErrorMessage({ code: "CREDITS_DISABLED" }, FALLBACK)).toBe(
      API_ERROR_CODE_MESSAGES.credits_disabled,
    );
    expect(apiErrorMessage({ error: "rate_limited" }, FALLBACK)).toContain("wait a moment");
  });

  it("an unknown code yields the caller's plain fallback — never the code", () => {
    const out = apiErrorMessage({ error: "some_new_internal_code" }, FALLBACK);
    expect(out).toBe(FALLBACK);
    expect(out).not.toContain("some_new_internal_code");
    expect(apiErrorMessage({ error: "PGRST116" }, FALLBACK)).toBe(FALLBACK);
    expect(apiErrorMessage({ error: "ECONNREFUSED" }, FALLBACK)).toBe(FALLBACK);
  });

  it("a plain sentence in the error field passes through untouched", () => {
    expect(apiErrorMessage({ error: "Invalid AI coach request." }, FALLBACK)).toBe(
      "Invalid AI coach request.",
    );
    /* The server's one-word "Unauthorized" IS the unauthorized code —
       the map's fuller words (what happened + what to do) win. */
    expect(apiErrorMessage({ error: "Unauthorized" }, FALLBACK)).toBe(
      "Please sign in to do that.",
    );
  });

  it("family rules cover the long tail without echoing the code", () => {
    expect(messageForErrorCode("widget_not_found")).toContain("couldn't find");
    expect(messageForErrorCode("sfx_gen_failed")).toContain("try again");
    expect(messageForErrorCode("already_decided")).toContain("already done");
    expect(messageForErrorCode("harmony_voices_not_configured")).toContain("isn't set up");
    expect(messageForErrorCode("totally_made_up_code")).toBeNull();
  });

  it("money words are only claimed where the code guarantees them", () => {
    expect(API_ERROR_CODE_MESSAGES.out_of_credits).toContain("You weren't charged.");
    expect(API_ERROR_CODE_MESSAGES.credits_disabled).toContain("nothing was charged");
    expect(API_ERROR_CODE_MESSAGES.interrupted).toContain("you were not charged");
    /* A plain generation failure must NOT invent a refund. */
    expect(API_ERROR_CODE_MESSAGES.generation_failed).not.toContain("refund");
    expect(API_ERROR_CODE_MESSAGES.generation_failed).not.toContain("charged");
  });

  it("plainErrorText sanitizes caught-error renders, keeps the signal idiom intact", () => {
    expect(plainErrorText(new Error("out_of_credits"), FALLBACK)).toBe(
      API_ERROR_CODE_MESSAGES.out_of_credits,
    );
    expect(plainErrorText("credits_disabled", FALLBACK)).toContain("paused");
    expect(plainErrorText("Some plain failure sentence.", FALLBACK)).toBe(
      "Some plain failure sentence.",
    );
    expect(plainErrorText("Failed", FALLBACK)).toBe("Failed");
    expect(plainErrorText("", FALLBACK)).toBe(FALLBACK);
    expect(plainErrorText(undefined, FALLBACK)).toBe(FALLBACK);
    expect(plainErrorText(new Error("weird_new_code"), FALLBACK)).toBe(FALLBACK);
  });

  it("isErrorCodeShape: underscores and known codes are codes; lone words are not", () => {
    expect(isErrorCodeShape("out_of_credits")).toBe(true);
    expect(isErrorCodeShape("credits_disabled")).toBe(true);
    expect(isErrorCodeShape("CREDITS_DISABLED")).toBe(true);
    expect(isErrorCodeShape("generation_failed")).toBe(true);
    expect(isErrorCodeShape("Unauthorized")).toBe(true); /* known code, case-insensitive */
    expect(isErrorCodeShape("Failed")).toBe(false); /* lone word, not a known code */
    expect(isErrorCodeShape("Something went wrong.")).toBe(false);
    expect(isErrorCodeShape("")).toBe(false);
  });

  it("non-object bodies degrade to the fallback", () => {
    expect(apiErrorMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(apiErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
    expect(apiErrorMessage(42, FALLBACK)).toBe(FALLBACK);
    expect(apiErrorMessage({}, FALLBACK)).toBe(FALLBACK);
  });
});
