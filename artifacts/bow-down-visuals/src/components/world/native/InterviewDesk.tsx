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
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
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
  const { t } = useTranslation();
  return (
    <div
      className={`rounded-2xl border p-4 ${isLight ? "border-[#C9A84C]/40 bg-white/60" : "border-white/10 bg-white/5"}`}
      data-testid="world-interview-desk-guest"
    >
      <p className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
        {t("worldSponsorPress.ivGuestTitle")}
      </p>
      <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        {t("worldSponsorPress.ivGuestLead")}{" "}
        <Link href="/login" className="font-bold text-[#d4af37] underline underline-offset-2">
          {t("worldSponsorPress.ivGuestSignIn")}
        </Link>{" "}
        {t("worldSponsorPress.ivGuestTrail")}
      </p>
    </div>
  );
}

/* Type / category chip labels (stack100 locale unit 47): the
   seam's label records stay the pinned English mirrors; the desk
   renders the names from the catalog — the four interview kinds
   ride the 2D page's own interviewPrep keys, the question
   categories are the desk's own (its names differ from the
   page's set). */
const TYPE_KEYS: Record<string, string> = {
  podcast: "interviewPrep.typePodcast",
  press: "interviewPrep.typePress",
  red_carpet: "interviewPrep.typeRedCarpet",
  livestream: "interviewPrep.typeLiveStream",
};
const CATEGORY_KEYS: Record<string, string> = {
  warmup: "worldSponsorPress.ivCatWarmup",
  craft: "worldSponsorPress.ivCatCraft",
  story: "worldSponsorPress.ivCatStory",
  tough: "worldSponsorPress.ivCatTough",
  rapid_fire: "worldSponsorPress.ivCatRapidFire",
};

export function InterviewDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t, i18n } = useTranslation();
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
        throw new Error(apiErrorMessage(data, t("worldSponsorPress.ivBuildErrorRefunded")));
      }
      const built = sessionOfResponse(data);
      if (!built) {
        throw new Error(t("worldSponsorPress.ivBuildErrorUnusable"));
      }
      setSession(built);
      setPracticeIdx(null);
      setFeedback(null);
      refreshProfile();
    } catch (e) {
      setBuildError(plainErrorText(e, t("worldSponsorPress.ivBuildErrorPlain")));
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
        throw new Error(apiErrorMessage(data, t("worldSponsorPress.ivFeedbackErrorRefunded")));
      }
      const scored = feedbackOfResponse(data);
      if (!scored) throw new Error(t("worldSponsorPress.ivFeedbackErrorUnusable"));
      setFeedback(scored);
      refreshProfile();
    } catch (e) {
      setFeedbackError(plainErrorText(e, t("worldSponsorPress.ivFeedbackErrorPlain")));
    } finally {
      setFeedbackBusy(false);
    }
  }

  const activeQuestion = session && practiceIdx !== null ? session.questions[practiceIdx] : undefined;

  return (
    <div className="space-y-3" data-testid="world-interview-desk">
      <div>
        <p className={`text-base font-black ${strong}`}>{t("worldSponsorPress.ivTitle")}</p>
        <p className={`text-xs ${muted}`}>
          {t("worldSponsorPress.ivIntro", {
            sessionCost: INTERVIEW_SESSION_COST.toLocaleString(i18n.language),
            feedbackCost: INTERVIEW_FEEDBACK_COST.toLocaleString(i18n.language),
          })}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("worldSponsorPress.ivKindAria")}>
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
            {TYPE_KEYS[type] ? t(TYPE_KEYS[type]) : INTERVIEW_TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className={`block text-xs ${muted}`}>
          {t("worldSponsorPress.ivNameLabel")}
          <input
            data-testid="world-interview-desk-name"
            className={`${inputCls} mt-1`}
            value={form.artistName}
            maxLength={100}
            onChange={(e) => set({ artistName: e.target.value })}
            placeholder={t("worldSponsorPress.ivNamePlaceholder")}
          />
        </label>
        <label className={`block text-xs ${muted}`}>
          {t("interviewPrep.genre")}
          <input
            data-testid="world-interview-desk-genre"
            className={`${inputCls} mt-1`}
            value={form.genre}
            maxLength={100}
            onChange={(e) => set({ genre: e.target.value })}
            placeholder={t("worldSponsorPress.ivGenrePlaceholder")}
          />
        </label>
        <label className={`block text-xs ${muted}`}>
          {t("interviewPrep.latestProject")}
          <input
            data-testid="world-interview-desk-project"
            className={`${inputCls} mt-1`}
            value={form.latestProject}
            maxLength={300}
            onChange={(e) => set({ latestProject: e.target.value })}
            placeholder={t("worldSponsorPress.ivProjectPlaceholder")}
          />
        </label>
        <label className={`block text-xs ${muted}`}>
          {t("interviewPrep.audienceSize")}
          <input
            data-testid="world-interview-desk-audience"
            className={`${inputCls} mt-1`}
            value={form.audienceSize}
            maxLength={50}
            onChange={(e) => set({ audienceSize: e.target.value })}
            placeholder={t("worldSponsorPress.ivAudiencePlaceholder")}
          />
        </label>
      </div>
      <label className={`block text-xs ${muted}`}>
        {t("worldSponsorPress.ivStoryLabel")}
        <textarea
          data-testid="world-interview-desk-story"
          className={`${inputCls} mt-1`}
          rows={2}
          maxLength={500}
          value={form.currentStory}
          onChange={(e) => set({ currentStory: e.target.value })}
          placeholder={t("worldSponsorPress.ivStoryPlaceholder")}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <span className={`text-xs font-semibold ${muted}`} data-testid="world-interview-desk-cost">
          {t("worldSponsorPress.ivSessionCostLine", { cost: INTERVIEW_SESSION_COST.toLocaleString(i18n.language) })}
        </span>
        <button
          type="button"
          data-testid="world-interview-desk-build"
          className={`ml-auto ${goldBtn}`}
          disabled={building || !interviewFormReady(form)}
          onClick={() => void buildSession()}
        >
          {building ? t("worldSponsorPress.ivBuilding") : session ? t("worldSponsorPress.ivBuildFresh") : t("worldSponsorPress.ivBuild")}
        </button>
      </div>
      {outOfCredits ? (
        <p className={errCls}>
          {t("worldSponsorPress.ivOutOfCredits")}
        </p>
      ) : null}
      {buildError ? (
        <p className={errCls} data-testid="world-interview-desk-build-error">{buildError}</p>
      ) : null}

      {session ? (
        <div className="space-y-3" data-testid="world-interview-desk-session">
          <div className={`rounded-xl border px-3 py-2 ${cardCls}`}>
            <p className={`text-sm font-bold ${strong}`}>{t("worldSponsorPress.ivTalkingPointsTitle")}</p>
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
                  <span className={chipCls(false)}>{CATEGORY_KEYS[q.category] ? t(CATEGORY_KEYS[q.category]) : QUESTION_CATEGORY_LABELS[q.category]}</span>
                  <p className={`text-sm font-bold ${strong}`}>{q.question}</p>
                </div>
                {q.tip ? <p className={`mt-1 text-xs ${muted}`}>{t("worldSponsorPress.ivCoachTip", { tip: q.tip })}</p> : null}
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
                  {t("worldSponsorPress.ivPracticeButton", { cost: INTERVIEW_FEEDBACK_COST.toLocaleString(i18n.language) })}
                </button>
              </div>
            ))}
          </div>
          {session.disclaimer ? <p className={`text-xs italic ${muted}`}>{session.disclaimer}</p> : null}
        </div>
      ) : null}

      {activeQuestion ? (
        <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-interview-desk-practice">
          <p className={`text-sm font-bold ${strong}`}>{t("worldSponsorPress.ivYourAnswerTo", { question: activeQuestion.question })}</p>
          <textarea
            data-testid="world-interview-desk-answer"
            aria-label={t("worldSponsorPress.ivAnswerAria")}
            className={`${inputCls} mt-2`}
            rows={4}
            maxLength={3000}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={t("worldSponsorPress.ivAnswerPlaceholder")}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className={`text-xs ${muted}`}>
              {answer.trim().length < INTERVIEW_ANSWER_MIN
                ? t("worldSponsorPress.ivAnswerTooShort", { min: INTERVIEW_ANSWER_MIN })
                : t("worldSponsorPress.ivAnswerReady")}
            </span>
            <button
              type="button"
              data-testid="world-interview-desk-score"
              className={`ml-auto ${goldBtn}`}
              disabled={feedbackBusy || !answerReady(answer)}
              onClick={() => void submitAnswer()}
            >
              {feedbackBusy ? t("interviewPrep.scoring") : t("worldSponsorPress.ivScoreButton", { cost: INTERVIEW_FEEDBACK_COST.toLocaleString(i18n.language) })}
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
                <p className={`text-xs font-bold ${strong}`}>{t("interviewPrep.whatLanded")}</p>
                <ul className={`list-disc pl-5 text-sm ${muted}`}>
                  {feedback.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className={`text-xs font-bold ${strong}`}>{t("worldSponsorPress.ivTightenThis")}</p>
                <ul className={`list-disc pl-5 text-sm ${muted}`}>
                  {feedback.improvements.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className={`text-xs font-bold ${strong}`}>{t("worldSponsorPress.ivModelAnswer")}</p>
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
