/**
 * interview-desk — the Interview Prep desk's pure logic seam
 * (stack1500 world parity wave #3, census item 13).
 *
 * THE FEATURE (website): Interview Prep (pages/interview-prep.tsx)
 * is a media coach: pick the interview kind (podcast / press /
 * red carpet / live stream), say who you are, and it builds a
 * practice session — the ten questions you will actually get,
 * each with a category and a handling tip, plus the talking
 * points to land no matter what. Then you practice: answer a
 * question in your own words and get scored feedback with a
 * model answer.
 *
 * THE RAILS (routes/generate/interview-prep.ts, both requireAuth,
 * both refunded server-side when generation comes back unusable):
 *   POST /api/interview-prep/session { interviewType, artistName,
 *     genre?, latestProject?, currentStory?, audienceSize? } →
 *     { session: { interviewType, questions: [{ question,
 *       category, tip }], talkingPoints, disclaimer },
 *       creditsUsed, creditsRemaining }
 *   POST /api/interview-prep/feedback { interviewType, artistName,
 *     question, answer (10–3000 chars) } →
 *     { feedback: { score, strengths, improvements, modelAnswer,
 *       disclaimer }, creditsUsed, creditsRemaining }
 *
 * PRICES — READ from the credit-cost registry (rows added by this
 * wave's registry commit after verifying page badge == route
 * constant; the seam adds no number of its own):
 *   session ... 200 (route INTERVIEW_PREP_CREDIT_COST)
 *   feedback .. 100 (route INTERVIEW_FEEDBACK_CREDIT_COST)
 * Both charge under the one ledger action "AI Interview Prep",
 * which is also the confirmation's feature name.
 *
 * CONFIRMATION DISCIPLINE: the 2D page posts WITHOUT a spend
 * confirmation (authedPost); the desk upgrades both runs to
 * confirmedFetch with the registry cost as the explicit override —
 * the member sees and approves the price before anything is
 * charged, like every other World desk. A decline runs nothing.
 *
 * NO PERSISTENCE GAP, NAMED: the rails keep no history — a session
 * lives in the page (and here, in the panel) for the sitting. The
 * desk says so; it never dresses session state up as a saved
 * library.
 *
 * DRIFT DISCIPLINE: the guards mirror the route's own parsers —
 * a session needs ≥4 questions and ≥2 talking points with real
 * text or it reads as failure (the route refunds exactly those);
 * feedback needs a score, at least one strength and improvement,
 * and a model answer.
 */
import { getCreditCost } from "../credit-costs";

function registryCost(path: string): number {
  const cost = getCreditCost(path)?.cost;
  if (typeof cost !== "number") {
    throw new Error(`interview-desk: no credit-cost registry entry for ${path}`);
  }
  return cost;
}

export const INTERVIEW_SESSION_PATH = "/api/interview-prep/session";
export const INTERVIEW_FEEDBACK_PATH = "/api/interview-prep/feedback";

export const INTERVIEW_SESSION_COST = registryCost(INTERVIEW_SESSION_PATH);
export const INTERVIEW_FEEDBACK_COST = registryCost(INTERVIEW_FEEDBACK_PATH);

/** The routes' charge-ledger action — the confirmation's name. */
export const INTERVIEW_FEATURE = "AI Interview Prep";

/* ── The session kinds (the route's enum + labels, verbatim) ──────── */

export const INTERVIEW_TYPES = ["podcast", "press", "red-carpet", "live-stream"] as const;
export type InterviewType = (typeof INTERVIEW_TYPES)[number];

export const INTERVIEW_TYPE_LABELS: Record<InterviewType, string> = {
  podcast: "Podcast",
  press: "Press / Media",
  "red-carpet": "Red Carpet",
  "live-stream": "Live Stream",
};

export const QUESTION_CATEGORIES = ["warmup", "craft", "story", "tough", "rapid-fire"] as const;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

export const QUESTION_CATEGORY_LABELS: Record<QuestionCategory, string> = {
  warmup: "Warm-up",
  craft: "The Craft",
  story: "Your Story",
  tough: "Tough One",
  "rapid-fire": "Rapid Fire",
};

/* ── The form (the session schema's fields + bounds) ──────────────── */

export interface InterviewForm {
  interviewType: InterviewType;
  artistName: string;
  genre: string;
  latestProject: string;
  currentStory: string;
  audienceSize: string;
}

export const INTERVIEW_NAME_MAX = 100;
/** The feedback schema's answer floor — below it the rail refuses,
    so the desk refuses first with the same words' meaning. */
export const INTERVIEW_ANSWER_MIN = 10;
export const INTERVIEW_ANSWER_MAX = 3000;

/** The artist name is the one required field (the schema's min 1). */
export function interviewFormReady(form: InterviewForm): boolean {
  return form.artistName.trim().length >= 1;
}

export function buildSessionPayload(form: InterviewForm) {
  return {
    interviewType: form.interviewType,
    artistName: form.artistName.trim().slice(0, INTERVIEW_NAME_MAX),
    genre: form.genre.trim(),
    latestProject: form.latestProject.trim(),
    currentStory: form.currentStory.trim(),
    audienceSize: form.audienceSize.trim(),
  };
}

export function answerReady(answer: string): boolean {
  const len = answer.trim().length;
  return len >= INTERVIEW_ANSWER_MIN && len <= INTERVIEW_ANSWER_MAX;
}

export function buildFeedbackPayload(
  form: InterviewForm,
  sessionType: InterviewType,
  question: string,
  answer: string,
) {
  return {
    interviewType: sessionType,
    artistName: form.artistName.trim().slice(0, INTERVIEW_NAME_MAX),
    question,
    answer: answer.trim(),
  };
}

/* ── Response guards (the route parsers' acceptance bars) ─────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function stringList(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((s) => str(s as unknown)).filter((s) => s.length > 0).slice(0, cap);
}

export interface InterviewQuestion {
  question: string;
  category: QuestionCategory;
  tip: string;
}

export interface InterviewSession {
  interviewType: InterviewType;
  questions: InterviewQuestion[];
  talkingPoints: string[];
  disclaimer: string;
}

export function sessionOfResponse(data: unknown): InterviewSession | null {
  if (!isRecord(data) || !isRecord(data["session"])) return null;
  const s = data["session"];
  const type = str(s["interviewType"]);
  if (!(INTERVIEW_TYPES as readonly string[]).includes(type)) return null;
  const questions: InterviewQuestion[] = [];
  if (Array.isArray(s["questions"])) {
    for (const q of s["questions"]) {
      if (!isRecord(q)) continue;
      const question = str(q["question"]);
      const category = str(q["category"]);
      if (!question || !(QUESTION_CATEGORIES as readonly string[]).includes(category)) continue;
      questions.push({ question, category: category as QuestionCategory, tip: str(q["tip"]) });
    }
  }
  const talkingPoints = stringList(s["talkingPoints"], 12);
  /* The route's own bar: fewer than 4 questions or 2 talking
     points is an unusable session (refunded there; failure here). */
  if (questions.length < 4 || talkingPoints.length < 2) return null;
  return {
    interviewType: type as InterviewType,
    questions,
    talkingPoints,
    disclaimer: str(s["disclaimer"]),
  };
}

export interface InterviewFeedback {
  score: number;
  strengths: string[];
  improvements: string[];
  modelAnswer: string;
  disclaimer: string;
}

export function feedbackOfResponse(data: unknown): InterviewFeedback | null {
  if (!isRecord(data) || !isRecord(data["feedback"])) return null;
  const f = data["feedback"];
  const rawScore = f["score"];
  if (typeof rawScore !== "number" || !Number.isFinite(rawScore)) return null;
  const strengths = stringList(f["strengths"], 4);
  const improvements = stringList(f["improvements"], 4);
  const modelAnswer = str(f["modelAnswer"]);
  if (strengths.length === 0 || improvements.length === 0 || !modelAnswer) return null;
  return {
    score: Math.min(100, Math.max(0, Math.round(rawScore))),
    strengths,
    improvements,
    modelAnswer,
    disclaimer: str(f["disclaimer"]),
  };
}
