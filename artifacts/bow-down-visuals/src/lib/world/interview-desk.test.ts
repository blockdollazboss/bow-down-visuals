/**
 * interview-desk — stack1500 world parity wave #3 item 13 pins.
 *
 * The Interview Prep desk is the media coach's native form. These
 * pins hold: both prices are the registry rows AND the route's
 * constants (one number, three sources); the payloads are the
 * schemas' exact bodies; the guards mirror the route parsers'
 * acceptance bars — a session under 4 questions or 2 talking
 * points is a failure here exactly as the route refunds it there;
 * feedback needs its score, a strength, an improvement and a
 * model answer.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  INTERVIEW_ANSWER_MAX,
  INTERVIEW_ANSWER_MIN,
  INTERVIEW_FEATURE,
  INTERVIEW_FEEDBACK_COST,
  INTERVIEW_FEEDBACK_PATH,
  INTERVIEW_SESSION_COST,
  INTERVIEW_SESSION_PATH,
  INTERVIEW_TYPES,
  INTERVIEW_TYPE_LABELS,
  QUESTION_CATEGORIES,
  answerReady,
  buildFeedbackPayload,
  buildSessionPayload,
  feedbackOfResponse,
  interviewFormReady,
  sessionOfResponse,
  type InterviewForm,
} from "./interview-desk";
import { getCreditCost } from "../credit-costs";

const routeSrc = readFileSync(
  new URL("../../../../api-server/src/routes/generate/interview-prep.ts", import.meta.url),
  "utf8",
);

function deriveConst(src: string, name: string): number {
  const m = src.match(new RegExp(`const ${name}[^=]*=\\s*(?:Number\\([^)]*\\)\\s*\\|\\|\\s*)?(\\d+)`));
  if (!m) throw new Error(`could not derive ${name}`);
  return Number(m[1]);
}

const FORM: InterviewForm = {
  interviewType: "podcast",
  artistName: "  Thy Cheat Code  ",
  genre: " trap soul ",
  latestProject: "",
  currentStory: " First headline show ",
  audienceSize: "",
};

describe("prices — registry == route, one ledger action", () => {
  it("session 200 and feedback 100 in both sources", () => {
    expect(getCreditCost(INTERVIEW_SESSION_PATH)?.cost).toBe(200);
    expect(getCreditCost(INTERVIEW_FEEDBACK_PATH)?.cost).toBe(100);
    expect(INTERVIEW_SESSION_COST).toBe(200);
    expect(INTERVIEW_FEEDBACK_COST).toBe(100);
    expect(deriveConst(routeSrc, "INTERVIEW_PREP_CREDIT_COST")).toBe(200);
    expect(deriveConst(routeSrc, "INTERVIEW_FEEDBACK_CREDIT_COST")).toBe(100);
  });

  it("the feature name is the route's charge-ledger action", () => {
    expect(INTERVIEW_FEATURE).toBe("AI Interview Prep");
    expect(routeSrc).toContain('action: "AI Interview Prep"');
  });
});

describe("the kinds + categories (the route's enums)", () => {
  it("four interview types with the route's labels", () => {
    expect(INTERVIEW_TYPES).toEqual(["podcast", "press", "red-carpet", "live-stream"]);
    expect(INTERVIEW_TYPE_LABELS).toEqual({
      podcast: "Podcast",
      press: "Press / Media",
      "red-carpet": "Red Carpet",
      "live-stream": "Live Stream",
    });
    expect(routeSrc).toContain('"red-carpet"');
  });

  it("five question categories", () => {
    expect(QUESTION_CATEGORIES).toEqual(["warmup", "craft", "story", "tough", "rapid-fire"]);
  });
});

describe("payloads — the schemas' exact bodies", () => {
  it("the artist name is the one required field", () => {
    expect(interviewFormReady(FORM)).toBe(true);
    expect(interviewFormReady({ ...FORM, artistName: "   " })).toBe(false);
  });

  it("the session payload trims every field and caps the name at the schema's 100", () => {
    expect(buildSessionPayload(FORM)).toEqual({
      interviewType: "podcast",
      artistName: "Thy Cheat Code",
      genre: "trap soul",
      latestProject: "",
      currentStory: "First headline show",
      audienceSize: "",
    });
    const long = buildSessionPayload({ ...FORM, artistName: "x".repeat(140) });
    expect(long.artistName).toHaveLength(100);
  });

  it("answers ride between the schema's floor and ceiling", () => {
    expect(INTERVIEW_ANSWER_MIN).toBe(10);
    expect(INTERVIEW_ANSWER_MAX).toBe(3000);
    expect(answerReady("short")).toBe(false);
    expect(answerReady("a real sentence here")).toBe(true);
    expect(buildFeedbackPayload(FORM, "press", "Q?", "  my answer  ")).toEqual({
      interviewType: "press",
      artistName: "Thy Cheat Code",
      question: "Q?",
      answer: "my answer",
    });
  });
});

function question(i: number) {
  return { question: `Question ${i}?`, category: "craft", tip: "Tip." };
}

describe("session guard — the route parser's bar", () => {
  const good = {
    session: {
      interviewType: "podcast",
      questions: [question(1), question(2), question(3), question(4), question(5)],
      talkingPoints: ["Point one.", "Point two."],
      disclaimer: "Practice, not prophecy.",
    },
    creditsUsed: 200,
  };

  it("accepts a full session and keeps the disclaimer", () => {
    const s = sessionOfResponse(good);
    expect(s).not.toBeNull();
    expect(s!.questions).toHaveLength(5);
    expect(s!.disclaimer).toBe("Practice, not prophecy.");
  });

  it("under 4 questions or 2 talking points reads as failure (the route refunds those)", () => {
    expect(
      sessionOfResponse({ session: { ...good.session, questions: [question(1), question(2), question(3)] } }),
    ).toBeNull();
    expect(sessionOfResponse({ session: { ...good.session, talkingPoints: ["Only one."] } })).toBeNull();
  });

  it("an unknown category drops its question; an unknown type sinks the session", () => {
    const mixed = {
      session: {
        ...good.session,
        questions: [...good.session.questions, { question: "Wild?", category: "gotcha", tip: "" }],
      },
    };
    expect(sessionOfResponse(mixed)!.questions).toHaveLength(5);
    expect(sessionOfResponse({ session: { ...good.session, interviewType: "tv" } })).toBeNull();
    expect(sessionOfResponse({})).toBeNull();
    expect(sessionOfResponse(null)).toBeNull();
  });
});

describe("feedback guard", () => {
  const good = {
    feedback: {
      score: 82,
      strengths: ["Clear story."],
      improvements: ["Shorter open."],
      modelAnswer: "It started in my grandmother's kitchen…",
      disclaimer: "One coach's ear.",
    },
  };

  it("accepts complete feedback; clamps the score to the route's 0–100", () => {
    expect(feedbackOfResponse(good)!.score).toBe(82);
    expect(feedbackOfResponse({ feedback: { ...good.feedback, score: 140 } })!.score).toBe(100);
  });

  it("no strength, no improvement, no model answer, or a non-numeric score is failure", () => {
    expect(feedbackOfResponse({ feedback: { ...good.feedback, strengths: [] } })).toBeNull();
    expect(feedbackOfResponse({ feedback: { ...good.feedback, improvements: [] } })).toBeNull();
    expect(feedbackOfResponse({ feedback: { ...good.feedback, modelAnswer: "" } })).toBeNull();
    expect(feedbackOfResponse({ feedback: { ...good.feedback, score: "82" } })).toBeNull();
    expect(feedbackOfResponse({})).toBeNull();
  });
});
