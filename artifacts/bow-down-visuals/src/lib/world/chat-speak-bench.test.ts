/**
 * chat-speak-bench — Stack 400 world parity (census B-08)
 * seam pins. The bench is a World face over the 2D drawer's
 * seam: same rail, same paths, the registry's 100 as the
 * rail's identity pin (the price the member confirms is the
 * status read's server figure — never this constant), the
 * drawer's confirmation feature name, and the
 * charged-only-when-it-plays contract: a 200 without a
 * playable URL is never a success the bench may present.
 */
import { describe, expect, it } from "vitest";
import { getCreditCost } from "@/lib/credit-costs";
import { CHAT_SPEAK_PATH, CHAT_SPEAK_STATUS_PATH } from "@/lib/chat-speak";
import {
  WORLD_SPEAK_FEATURE,
  WORLD_SPEAK_PATH,
  WORLD_SPEAK_REGISTRY_COST,
  WORLD_SPEAK_STATUS_PATH,
  WORLD_SPEAK_TEXT_MAX,
  speakFailureMessage,
  speakOutcomeOf,
  speakTextReady,
} from "./chat-speak-bench";

describe("the rail + the identity pin", () => {
  it("rides the drawer's exact rail", () => {
    expect(WORLD_SPEAK_PATH).toBe("/api/chat/speak");
    expect(WORLD_SPEAK_PATH).toBe(CHAT_SPEAK_PATH);
    expect(WORLD_SPEAK_STATUS_PATH).toBe(CHAT_SPEAK_STATUS_PATH);
  });

  it("the registry row for the rail is 100 — and the seam reads it, never retypes it", () => {
    expect(WORLD_SPEAK_REGISTRY_COST).toBe(100);
    expect(getCreditCost("/api/chat/speak")?.cost).toBe(100);
    expect(WORLD_SPEAK_REGISTRY_COST).toBe(getCreditCost(WORLD_SPEAK_PATH)?.cost);
  });

  it("the confirmation carries the drawer's own feature words", () => {
    expect(WORLD_SPEAK_FEATURE).toBe("Hear Thy Cheat Code speak");
  });

  it("carries the rail's 2,000-char cap", () => {
    expect(WORLD_SPEAK_TEXT_MAX).toBe(2000);
  });
});

describe("charged only when it plays (the B-08 pin)", () => {
  it("a speak answer counts only with a playable URL", () => {
    expect(
      speakOutcomeOf({ audioPlayUrl: "https://cdn/reply.mp3", creditsUsed: 100, creditsRemaining: 42 }),
    ).toEqual({ audioPlayUrl: "https://cdn/reply.mp3", creditsUsed: 100, creditsRemaining: 42 });
  });

  it("a 200 with no audio URL is NOT a played speak", () => {
    expect(speakOutcomeOf({})).toBeNull();
    expect(speakOutcomeOf({ audioPlayUrl: "" })).toBeNull();
    expect(speakOutcomeOf({ creditsUsed: 100 })).toBeNull();
    expect(speakOutcomeOf(null)).toBeNull();
  });

  it("missing figures read as 0, never invented", () => {
    expect(speakOutcomeOf({ audioPlayUrl: "https://cdn/r.mp3" })).toEqual({
      audioPlayUrl: "https://cdn/r.mp3",
      creditsUsed: 0,
      creditsRemaining: 0,
    });
  });
});

describe("the text gate + the failure words", () => {
  it("only trimmed, in-cap text can be sent", () => {
    expect(speakTextReady("Say it.")).toBe(true);
    expect(speakTextReady("   ")).toBe(false);
    expect(speakTextReady("")).toBe(false);
    expect(speakTextReady("x".repeat(2000))).toBe(true);
    expect(speakTextReady("x".repeat(2001))).toBe(false);
  });

  it("failures carry the server's own words, message before code", () => {
    expect(speakFailureMessage({ message: "His voice isn't ready.", error: "voice_not_ready" })).toBe(
      "His voice isn't ready.",
    );
    expect(speakFailureMessage({ error: "voice_not_ready" })).toBe("voice_not_ready");
    expect(speakFailureMessage({})).toBe(
      "Thy Cheat Code couldn't speak that reply — please try again.",
    );
    expect(speakFailureMessage(null)).toBe(
      "Thy Cheat Code couldn't speak that reply — please try again.",
    );
  });
});
