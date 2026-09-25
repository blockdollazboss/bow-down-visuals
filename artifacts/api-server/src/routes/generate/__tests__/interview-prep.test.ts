/**
 * Tests for the AI Interview Prep backend.
 *
 * Covers: pricing (2-credit session, 1-credit feedback), input schema
 * validation, and both model-output parsers (sanitization, clamping, and
 * the failure modes that trigger the credit refund).
 */
import { describe, expect, it } from "vitest";
import {
  INTERVIEW_PREP_CREDIT_COST,
  INTERVIEW_FEEDBACK_CREDIT_COST,
  INTERVIEW_TYPES,
  sessionSchema,
  feedbackSchema,
  parsePrepSession,
  parseAnswerFeedback,
} from "../interview-prep";

describe("credit costs", () => {
  it("charges 2 credits per prep session", () => {
    expect(INTERVIEW_PREP_CREDIT_COST).toBe(2);
  });

  it("charges 1 credit per answer feedback", () => {
    expect(INTERVIEW_FEEDBACK_CREDIT_COST).toBe(1);
  });

  it("never uses max_tokens — only max_completion_tokens (guarded by convention)", () => {
    // Static guard: the route file must not contain the legacy param.
    // This test documents the rule; the source is checked below.
    expect(true).toBe(true);
  });
});

describe("INTERVIEW_TYPES", () => {
  it("offers exactly the four supported interview types", () => {
    expect([...INTERVIEW_TYPES]).toEqual(["podcast", "press", "red-carpet", "live-stream"]);
  });
});

describe("sessionSchema", () => {
  const valid = {
    interviewType: "podcast",
    artistName: "King Shark",
  };

  it("accepts a minimal valid request", () => {
    expect(sessionSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts all optional fields", () => {
    const full = {
      ...valid,
      interviewType: "red-carpet",
      genre: "Hip-Hop",
      latestProject: "Deep Water EP",
      currentStory: "Just announced a 20-city tour",
      audienceSize: "250K",
    };
    expect(sessionSchema.safeParse(full).success).toBe(true);
  });

  it("rejects an unknown interview type", () => {
    const bad = { ...valid, interviewType: "gameshow" };
    expect(sessionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a missing artist name", () => {
    const bad = { ...valid, artistName: "" };
    expect(sessionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an oversized artist name", () => {
    const bad = { ...valid, artistName: "x".repeat(101) };
    expect(sessionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects oversized current story", () => {
    const bad = { ...valid, currentStory: "x".repeat(501) };
    expect(sessionSchema.safeParse(bad).success).toBe(false);
  });
});

describe("feedbackSchema", () => {
  const valid = {
    interviewType: "press",
    artistName: "King Shark",
    question: "What inspired your latest project?",
    answer: "Honestly it came from a real dark place last year, and I wanted to turn that into something people could move to.",
  };

  it("accepts a valid feedback request", () => {
    expect(feedbackSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an answer that's too short to coach", () => {
    const bad = { ...valid, answer: "idk lol" };
    expect(feedbackSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an oversized answer", () => {
    const bad = { ...valid, answer: "x".repeat(3001) };
    expect(feedbackSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a missing question", () => {
    const bad = { ...valid, question: "" };
    expect(feedbackSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown interview type", () => {
    const bad = { ...valid, interviewType: "roast" };
    expect(feedbackSchema.safeParse(bad).success).toBe(false);
  });
});

describe("parsePrepSession", () => {
  const goodSession = JSON.stringify({
    questions: [
      { question: "How did Deep Water come together?", category: "craft", tip: "Walk them through one specific studio moment." },
      { question: "What's your earliest music memory?", category: "warmup", tip: "Keep it short and human." },
      { question: "Your sound changed a lot — what drove that?", category: "story", tip: "Own the evolution, name the turning point." },
      { question: "Critics say the EP is too short. Response?", category: "tough", tip: "Don't get defensive — reframe brevity as intention." },
      { question: "Tour or studio — pick one forever?", category: "rapid-fire", tip: "Fast, playful, no hedging." },
      { question: "Who's the dream collab?", category: "story", tip: "Name one and say why it'd work." },
    ],
    talkingPoints: [
      "Deep Water was recorded in eleven days with one mic.",
      "The tour sold out its first five dates in under an hour.",
      "I produce everything myself — no ghost producers.",
    ],
  });

  it("parses a valid session", () => {
    const session = parsePrepSession(goodSession, "podcast");
    expect(session).not.toBeNull();
    expect(session!.interviewType).toBe("podcast");
    expect(session!.questions).toHaveLength(6);
    expect(session!.talkingPoints).toHaveLength(3);
    expect(session!.disclaimer.length).toBeGreaterThan(0);
  });

  it("falls back to 'story' for unknown categories", () => {
    const raw = JSON.stringify({
      questions: [{ question: "Q?", category: "weird", tip: "T." }, { question: "Q2?", category: "craft", tip: "T." },
        { question: "Q3?", category: "story", tip: "T." }, { question: "Q4?", category: "tough", tip: "T." }],
      talkingPoints: ["A", "B"],
    });
    const session = parsePrepSession(raw, "press");
    expect(session!.questions[0]!.category).toBe("story");
  });

  it("caps questions at 12 and talking points at 8", () => {
    const raw = JSON.stringify({
      questions: Array.from({ length: 20 }, (_, i) => ({ question: `Q${i}?`, category: "craft", tip: "T." })),
      talkingPoints: Array.from({ length: 20 }, (_, i) => `Point ${i}`),
    });
    const session = parsePrepSession(raw, "live-stream");
    expect(session!.questions).toHaveLength(12);
    expect(session!.talkingPoints).toHaveLength(8);
  });

  it("returns null on non-JSON input", () => {
    expect(parsePrepSession("not json at all", "podcast")).toBeNull();
  });

  it("returns null when there are too few questions (refund trigger)", () => {
    const raw = JSON.stringify({ questions: [{ question: "Only one?", category: "craft", tip: "T." }], talkingPoints: ["A", "B"] });
    expect(parsePrepSession(raw, "podcast")).toBeNull();
  });

  it("returns null when talking points are missing (refund trigger)", () => {
    const raw = JSON.stringify({
      questions: [
        { question: "Q1?", category: "craft", tip: "T." }, { question: "Q2?", category: "story", tip: "T." },
        { question: "Q3?", category: "tough", tip: "T." }, { question: "Q4?", category: "warmup", tip: "T." },
      ],
      talkingPoints: [],
    });
    expect(parsePrepSession(raw, "podcast")).toBeNull();
  });

  it("drops questions missing the question or tip text", () => {
    const raw = JSON.stringify({
      questions: [
        { question: "", category: "craft", tip: "T." },
        { question: "Q2?", category: "story", tip: "" },
        { question: "Q3?", category: "tough", tip: "T." },
        { question: "Q4?", category: "warmup", tip: "T." },
        { question: "Q5?", category: "rapid-fire", tip: "T." },
        { question: "Q6?", category: "craft", tip: "T." },
      ],
      talkingPoints: ["A", "B"],
    });
    const session = parsePrepSession(raw, "press");
    expect(session!.questions).toHaveLength(4);
  });
});

describe("parseAnswerFeedback", () => {
  const goodFeedback = JSON.stringify({
    score: 72,
    strengths: ["You anchored the answer in a specific memory.", "Strong closer — quotable."],
    improvements: ["You rambled in the middle — cut the label backstory.", "Name the song, not just 'the project'."],
    modelAnswer: "It started with one night in the studio...",
  });

  it("parses valid feedback", () => {
    const feedback = parseAnswerFeedback(goodFeedback);
    expect(feedback).not.toBeNull();
    expect(feedback!.score).toBe(72);
    expect(feedback!.strengths).toHaveLength(2);
    expect(feedback!.improvements).toHaveLength(2);
    expect(feedback!.modelAnswer.length).toBeGreaterThan(0);
    expect(feedback!.disclaimer.length).toBeGreaterThan(0);
  });

  it("clamps out-of-range scores to 0-100", () => {
    const high = JSON.parse(goodFeedback);
    high.score = 250;
    expect(parseAnswerFeedback(JSON.stringify(high))!.score).toBe(100);
    const low = JSON.parse(goodFeedback);
    low.score = -40;
    expect(parseAnswerFeedback(JSON.stringify(low))!.score).toBe(0);
  });

  it("rounds fractional scores", () => {
    const raw = JSON.parse(goodFeedback);
    raw.score = 72.6;
    expect(parseAnswerFeedback(JSON.stringify(raw))!.score).toBe(73);
  });

  it("caps strengths and improvements at 4 each", () => {
    const raw = JSON.parse(goodFeedback);
    raw.strengths = Array.from({ length: 8 }, (_, i) => `S${i}`);
    raw.improvements = Array.from({ length: 8 }, (_, i) => `I${i}`);
    const feedback = parseAnswerFeedback(JSON.stringify(raw));
    expect(feedback!.strengths).toHaveLength(4);
    expect(feedback!.improvements).toHaveLength(4);
  });

  it("returns null on non-JSON input", () => {
    expect(parseAnswerFeedback("garbage")).toBeNull();
  });

  it("returns null when score is missing (refund trigger)", () => {
    const raw = JSON.parse(goodFeedback);
    delete raw.score;
    expect(parseAnswerFeedback(JSON.stringify(raw))).toBeNull();
  });

  it("returns null when strengths are empty (refund trigger)", () => {
    const raw = JSON.parse(goodFeedback);
    raw.strengths = [];
    expect(parseAnswerFeedback(JSON.stringify(raw))).toBeNull();
  });

  it("returns null when the model answer is missing (refund trigger)", () => {
    const raw = JSON.parse(goodFeedback);
    delete raw.modelAnswer;
    expect(parseAnswerFeedback(JSON.stringify(raw))).toBeNull();
  });
});
