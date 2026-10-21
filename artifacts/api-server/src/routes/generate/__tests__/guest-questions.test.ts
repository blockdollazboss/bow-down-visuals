/**
 * Prompt + contract tests for the Podcast Guest Question Generator.
 *
 * Covers: the 75-Visual-Buc credit cost, the honesty contract (works ONLY
 * from user-supplied research — the model must not invent biographical
 * facts), prompt construction (guest/topic/bio woven in), and the required
 * JSON section structure.
 */
import { describe, expect, it } from "vitest";

import {
  GUEST_QUESTIONS_CREDIT_COST,
  buildGuestQuestionsPrompt,
} from "../guest-questions";

describe("guest-questions", () => {
  it("costs 75 Visual Bucs (env-overridable constant)", () => {
    expect(GUEST_QUESTIONS_CREDIT_COST).toBe(75);
  });

  it("weaves guest name and topic into the prompt", () => {
    const prompt = buildGuestQuestionsPrompt({
      guestName: "Ada Rivers",
      topic: "building an audience from zero",
      bio: "",
    });
    expect(prompt).toContain("Ada Rivers");
    expect(prompt).toContain("building an audience from zero");
  });

  it("uses supplied bio as the only fact source", () => {
    const prompt = buildGuestQuestionsPrompt({
      guestName: "Ada Rivers",
      topic: "touring",
      bio: "Won the 2025 Indie Songwriter Award.",
    });
    expect(prompt).toContain("2025 Indie Songwriter Award");
    expect(prompt).toMatch(/ONLY source of facts/i);
    expect(prompt).toMatch(/never invent/i);
  });

  it("forbids inventing facts when no research was pasted", () => {
    const prompt = buildGuestQuestionsPrompt({
      guestName: "Ada Rivers",
      topic: "touring",
      bio: "",
    });
    expect(prompt).toMatch(/DO NOT invent/i);
    expect(prompt).toMatch(/no show names/i);
  });

  it("requires all four question sections in the JSON contract", () => {
    const prompt = buildGuestQuestionsPrompt({
      guestName: "Ada Rivers",
      topic: "touring",
      bio: "",
    });
    for (const section of ["warmup", "deepDive", "rapidFire", "closer"]) {
      expect(prompt).toContain(`"${section}"`);
    }
    expect(prompt).toContain('"why"');
  });

  it("specifies the 12-15 question count", () => {
    const prompt = buildGuestQuestionsPrompt({
      guestName: "Ada Rivers",
      topic: "touring",
      bio: "",
    });
    expect(prompt).toContain("12-15");
  });
});
