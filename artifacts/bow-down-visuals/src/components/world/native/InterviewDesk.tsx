/**
 * InterviewDesk — the Promote Room's native Interview Prep desk
 * (stack1500 world parity wave #3, census item 13).
 *
 * The media coach without leaving the World: pick the interview
 * kind, say who you are, and build a practice session — the ten
 * questions you will actually get, each with a category and a
 * handling tip, plus your talking points. Then practice right
 * here: answer a question and get scored feedback with a model
 * answer.
 *
 * Spend discipline: the 2D page posts without a confirmation;
 * this desk upgrades both runs to confirmedFetch with the
 * registry cost as the explicit quote (200 the session, 100 the
 * feedback — the routes' own constants, refunded server-side
 * when a generation comes back unusable). A decline runs
 * nothing; a 402 names the Treasury's packs desk. Sessions live
 * for the sitting, exactly like the page — the desk says so and
 * never dresses them up as saved.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { apiErrorMessage } from "../../../lib/api-error";
import {
  INTERVIEW_ANSWER_MIN,
  INTERVIEW_FEATURE,
  INTERVIEW_FEEDBACK_COST,
  INTERVIEW_FEEDBACK_PATH,
  INTERVIEW_SESSION_COST,
  INTERVIEW_SESSION_PATH,
  INTERVIEW_TYPES,
  INTERVIEW_TYPE_LABELS,
  QUESTION_CATEGORY_LABELS,
  answerReady,
  buildFeedbackPayload,
  buildSessionPayload,
  feedbackOfResponse,
  interviewFormReady,
  sessionOfResponse,
  type InterviewFeedback,
  type InterviewForm,
  type InterviewSession,
  type InterviewType,
} from "@/lib/world/interview-desk";

function GuestGate({ isLight }: { isLight: boolean }) {
  return (
    <div
      className={`rounded-2xl border p-4 ${isLight ? "border-[#C9A84C]/40 bg-white/60" : "border-white/10 bg-white/5"}`}
      data-testid="world-interview-desk-guest"
    >
      <p className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
        Interview Prep — rehearse before they ask
      </p>
      <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        The coach builds sessions around your name, your project and your story — guests can look
        around the palace, but this desk only opens for members.{" "}
        <Link href="/login" className="font-bold text-[#d4af37] underline underline-offset-2">
          Sign in
        </Link>{" "}
        and the desk is yours, right here in the room.
      </p>
    </div>
  );
}

export function InterviewDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { confirmedFetch } = useConfirmedApi();
  const { refreshProfile } = useAuth();

  const [form, setForm] = useState<InterviewForm>({
    interviewType: "podcast",
    artistName: "",
    genre: "",
    latestProject: "",
    currentStory: "",
    audienceSize: "",
  });
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [session, setSession] = useState<InterviewSession | null>(null);

  const [practiceIdx, setPracticeIdx] = useState<number | null>(null);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<InterviewFeedback | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  if (isGuest) return <GuestGate isLight={isLight} />;

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/70 text-[#3D2E0A] placeholder:text-[#6B5B36]/60"
      : "border-white/15 bg-black/30 text-white placeholder:text-white/35"
  }`;
  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;
  const goldBtn =
    "bdv-touch-target rounded-lg bg-[#d4af37] px-4 py-2 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-50";
  const errCls = `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;

  const set = (patch: Partial<InterviewForm>) => setForm((f) => ({ ...f, ...patch }));

  async function buildSession() {
    if (building || !interviewFormReady(form)) return;
    setBuilding(true);
    setBuildError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(INTERVIEW_SESSION_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSessionPayload(form)),
        overrideCost: INTERVIEW_SESSION_COST,
        overrideFeature: INTERVIEW_FEATURE,
      });
      if (!res) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, "The prep session could not be built — any charge was refunded. Try again in a moment."));
      }
      const built = sessionOfResponse(data);
      if (!built) {
        throw new Error("The prep session came back unusable — your Visual Bucs were refunded. Try again.");
      }
      setSession(built);
      setPracticeIdx(null);
      setFeedback(null);
      refreshProfile();
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : "The prep session could not be built. Try again in a moment.");
    } finally {
      setBuilding(false);
    }
  }

  async function submitAnswer() {
    if (feedbackBusy || !session || practiceIdx === null) return;
    const q = session.questions[practiceIdx];
    if (!q || !answerReady(answer)) return;
    setFeedbackBusy(true);
    setFeedbackError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(INTERVIEW_FEEDBACK_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildFeedbackPayload(form, session.interviewType, q.question, answer)),
        overrideCost: INTERVIEW_FEEDBACK_COST,
        overrideFeature: INTERVIEW_FEATURE,
      });
      if (!res) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, "The feedback could not be scored — any charge was refunded. Try again in a moment."));
      }
      const scored = feedbackOfResponse(data);
      if (!scored) throw new Error("The feedback came back unusable — your Visual Bucs were refunded. Try again.");
      setFeedback(scored);
      refreshProfile();
    } catch (e) {
      setFeedbackError(e instanceof Error ? e.message : "The feedback could not be scored. Try again in a moment.");
    } finally {
      setFeedbackBusy(false);
    }
  }

  const activeQuestion = session && practiceIdx !== null ? session.questions[practiceIdx] : undefined;

  return (
    <div className="space-y-3" data-testid="world-interview-desk">
      <div>
        <p className={`text-base font-black ${strong}`}>Interview Prep</p>
        <p className={`text-xs ${muted}`}>
          Rehearse the questions before they ask them — a session is{" "}
          {INTERVIEW_SESSION_COST.toLocaleString()} Visual Bucs, scored practice{" "}
          {INTERVIEW_FEEDBACK_COST.toLocaleString()} a round. Sessions live for this sitting,
          like the website's.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Interview kind">
        {INTERVIEW_TYPES.map((type: InterviewType) => (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={form.interviewType === type}
            data-testid={`world-interview-desk-type-${type}`}
            className={chipCls(form.interviewType === type)}
            onClick={() => set({ interviewType: type })}
          >
            {INTERVIEW_TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className={`block text-xs ${muted}`}>
          Your artist name (required)
          <input
            data-testid="world-interview-desk-name"
            className={`${inputCls} mt-1`}
            value={form.artistName}
            maxLength={100}
            onChange={(e) => set({ artistName: e.target.value })}
            placeholder="The name they will call you"
          />
        </label>
        <label className={`block text-xs ${muted}`}>
          Genre
          <input
            data-testid="world-interview-desk-genre"
            className={`${inputCls} mt-1`}
            value={form.genre}
            maxLength={100}
            onChange={(e) => set({ genre: e.target.value })}
            placeholder="Trap soul, drill, R&B…"
          />
        </label>
        <label className={`block text-xs ${muted}`}>
          Latest project
          <input
            data-testid="world-interview-desk-project"
            className={`${inputCls} mt-1`}
            value={form.latestProject}
            maxLength={300}
            onChange={(e) => set({ latestProject: e.target.value })}
            placeholder="The tape, the single, the tour…"
          />
        </label>
        <label className={`block text-xs ${muted}`}>
          Audience size
          <input
            data-testid="world-interview-desk-audience"
            className={`${inputCls} mt-1`}
            value={form.audienceSize}
            maxLength={50}
            onChange={(e) => set({ audienceSize: e.target.value })}
            placeholder="12k followers, first TV spot…"
          />
        </label>
      </div>
      <label className={`block text-xs ${muted}`}>
        Your story right now
        <textarea
          data-testid="world-interview-desk-story"
          className={`${inputCls} mt-1`}
          rows={2}
          maxLength={500}
          value={form.currentStory}
          onChange={(e) => set({ currentStory: e.target.value })}
          placeholder="What is happening in your career that they will ask about?"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <span className={`text-xs font-semibold ${muted}`} data-testid="world-interview-desk-cost">
          Session — {INTERVIEW_SESSION_COST.toLocaleString()} Visual Bucs, confirmed before anything runs.
        </span>
        <button
          type="button"
          data-testid="world-interview-desk-build"
          className={`ml-auto ${goldBtn}`}
          disabled={building || !interviewFormReady(form)}
          onClick={() => void buildSession()}
        >
          {building ? "Building…" : session ? "Build a fresh session" : "Build my session"}
        </button>
      </div>
      {outOfCredits ? (
        <p className={errCls}>
          You&rsquo;re out of Visual Bucs — top up at the Visual Buc Packs desk in the Treasury and
          the coach is ready again.
        </p>
      ) : null}
      {buildError ? (
        <p className={errCls} data-testid="world-interview-desk-build-error">{buildError}</p>
      ) : null}

      {session ? (
        <div className="space-y-3" data-testid="world-interview-desk-session">
          <div className={`rounded-xl border px-3 py-2 ${cardCls}`}>
            <p className={`text-sm font-bold ${strong}`}>Your talking points — land these no matter what</p>
            <ul className={`mt-1 list-disc space-y-1 pl-5 text-sm ${muted}`}>
              {session.talkingPoints.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            {session.questions.map((q, i) => (
              <div key={i} className={`rounded-xl border px-3 py-2 ${cardCls}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={chipCls(false)}>{QUESTION_CATEGORY_LABELS[q.category]}</span>
                  <p className={`text-sm font-bold ${strong}`}>{q.question}</p>
                </div>
                {q.tip ? <p className={`mt-1 text-xs ${muted}`}>Coach&rsquo;s tip: {q.tip}</p> : null}
                <button
                  type="button"
                  data-testid={`world-interview-desk-practice-${i}`}
                  className={`mt-2 ${chipCls(practiceIdx === i)}`}
                  aria-pressed={practiceIdx === i}
                  onClick={() => {
                    setPracticeIdx(i);
                    setAnswer("");
                    setFeedback(null);
                    setFeedbackError(null);
                  }}
                >
                  Practice this one — {INTERVIEW_FEEDBACK_COST.toLocaleString()} Bucs a round
                </button>
              </div>
            ))}
          </div>
          {session.disclaimer ? <p className={`text-xs italic ${muted}`}>{session.disclaimer}</p> : null}
        </div>
      ) : null}

      {activeQuestion ? (
        <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-interview-desk-practice">
          <p className={`text-sm font-bold ${strong}`}>Your answer to: {activeQuestion.question}</p>
          <textarea
            data-testid="world-interview-desk-answer"
            aria-label="Your answer"
            className={`${inputCls} mt-2`}
            rows={4}
            maxLength={3000}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Answer it like the mic is live…"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className={`text-xs ${muted}`}>
              {answer.trim().length < INTERVIEW_ANSWER_MIN
                ? `Give it a real shot — at least ${INTERVIEW_ANSWER_MIN} characters.`
                : "Ready when you are."}
            </span>
            <button
              type="button"
              data-testid="world-interview-desk-score"
              className={`ml-auto ${goldBtn}`}
              disabled={feedbackBusy || !answerReady(answer)}
              onClick={() => void submitAnswer()}
            >
              {feedbackBusy ? "Scoring…" : `Score my answer — ${INTERVIEW_FEEDBACK_COST.toLocaleString()} Bucs`}
            </button>
          </div>
          {feedbackError ? (
            <p className={`mt-2 ${errCls}`} data-testid="world-interview-desk-feedback-error">{feedbackError}</p>
          ) : null}
          {feedback ? (
            <div className="mt-3 space-y-2" data-testid="world-interview-desk-feedback">
              <p className={`text-lg font-black ${strong}`}>
                {feedback.score} <span className={`text-sm font-bold ${muted}`}>/ 100</span>
              </p>
              <div>
                <p className={`text-xs font-bold ${strong}`}>What landed</p>
                <ul className={`list-disc pl-5 text-sm ${muted}`}>
                  {feedback.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className={`text-xs font-bold ${strong}`}>Tighten this</p>
                <ul className={`list-disc pl-5 text-sm ${muted}`}>
                  {feedback.improvements.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className={`text-xs font-bold ${strong}`}>A model answer</p>
                <p className={`text-sm ${muted}`}>{feedback.modelAnswer}</p>
              </div>
              {feedback.disclaimer ? <p className={`text-xs italic ${muted}`}>{feedback.disclaimer}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
