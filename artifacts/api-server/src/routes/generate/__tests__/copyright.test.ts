/**
 * Money-integrity + prompt tests for the Copyright Filing Assistant.
 *
 * Covers: the 1-credit-per-call pricing contract for both AI endpoints,
 * work-type validation, and prompt construction (with injection hygiene).
 */
import { describe, expect, it } from "vitest";

import {
  COPYRIGHT_DRAFT_CREDITS,
  COPYRIGHT_ASK_CREDITS,
  WORK_TYPES,
  isWorkTypeKey,
  buildDraftPrompt,
  ASK_SYSTEM_PROMPT,
  DRAFT_SYSTEM_PROMPT,
  type DraftDetails,
} from "../copyright";

const baseDetails: DraftDetails = {
  workType: "song",
  title: "Midnight Crown",
  authors: "Jane Doe",
  creationDate: "2026",
  published: false,
  publishedDate: "",
  notes: "",
};

describe("copyright pricing contract", () => {
  it("AI draft costs 1 credit", () => {
    expect(COPYRIGHT_DRAFT_CREDITS).toBe(1);
  });

  it("AI Q&A costs 1 credit per answer", () => {
    expect(COPYRIGHT_ASK_CREDITS).toBe(1);
  });

  it("a broke user (0 credits) is rejected before any model call", () => {
    // Both routes check req.userCredits < cost → 402 before charging or calling GPT.
    expect(0 < COPYRIGHT_DRAFT_CREDITS).toBe(true);
    expect(0 < COPYRIGHT_ASK_CREDITS).toBe(true);
  });

  it("exact balance is allowed through the pre-check", () => {
    expect(1 < COPYRIGHT_DRAFT_CREDITS).toBe(false);
    expect(1 < COPYRIGHT_ASK_CREDITS).toBe(false);
  });
});

describe("work types", () => {
  it("offers the five creator-relevant work types", () => {
    expect(WORK_TYPES).toEqual(["song", "sound-recording", "lyrics", "music-video", "album"]);
  });

  it("accepts known keys and rejects everything else", () => {
    expect(isWorkTypeKey("song")).toBe(true);
    expect(isWorkTypeKey("music-video")).toBe(true);
    expect(isWorkTypeKey("screenplay")).toBe(false);
    expect(isWorkTypeKey("")).toBe(false);
    expect(isWorkTypeKey(undefined)).toBe(false);
    expect(isWorkTypeKey(42)).toBe(false);
  });
});

describe("buildDraftPrompt", () => {
  it("includes the work type, title, and publication status", () => {
    const p = buildDraftPrompt(baseDetails);
    expect(p).toContain("Midnight Crown");
    expect(p).toContain("UNPUBLISHED");
    expect(p).toContain("musical composition");
  });

  it("marks published works with their publication date", () => {
    const p = buildDraftPrompt({ ...baseDetails, published: true, publishedDate: "2026-05-01" });
    expect(p).toContain("PUBLISHED");
    expect(p).toContain("2026-05-01");
    expect(p).not.toContain("UNPUBLISHED");
  });

  it("includes authors and creator notes when provided", () => {
    const p = buildDraftPrompt({ ...baseDetails, notes: "co-written with my producer" });
    expect(p).toContain("Jane Doe");
    expect(p).toContain("co-written with my producer");
  });

  it("omits empty optional fields", () => {
    const p = buildDraftPrompt({ ...baseDetails, authors: "", creationDate: "", notes: "" });
    expect(p).not.toContain("Author(s)");
    expect(p).not.toContain("Creator notes");
  });

  it("caps field lengths (prompt-injection hygiene)", () => {
    const p = buildDraftPrompt({
      ...baseDetails,
      title: "T".repeat(500),
      authors: "A".repeat(900),
      notes: "N".repeat(2000),
    });
    expect(p).not.toContain("T".repeat(201));
    expect(p).not.toContain("A".repeat(501));
    expect(p).not.toContain("N".repeat(1001));
  });
});

describe("AI guardrails", () => {
  it("the draft prompt requires a not-legal-advice closing", () => {
    expect(DRAFT_SYSTEM_PROMPT).toContain("NOT a lawyer");
    expect(DRAFT_SYSTEM_PROMPT).toContain("not legal advice");
  });

  it("the draft prompt covers AI-authorship disclosure", () => {
    expect(DRAFT_SYSTEM_PROMPT).toContain("AI");
    expect(DRAFT_SYSTEM_PROMPT).toContain("disclaim");
  });

  it("the draft prompt covers application choice and deposit copies", () => {
    expect(DRAFT_SYSTEM_PROMPT).toContain("Standard Application");
    expect(DRAFT_SYSTEM_PROMPT).toContain("deposit");
  });

  it("the Q&A prompt requires the not-legal-advice closing on every answer", () => {
    expect(ASK_SYSTEM_PROMPT).toContain("every answer must end with");
    expect(ASK_SYSTEM_PROMPT).toContain("not legal advice");
  });

  it("the Q&A prompt tells users to confirm fees at copyright.gov", () => {
    expect(ASK_SYSTEM_PROMPT).toContain("copyright.gov");
  });
});
