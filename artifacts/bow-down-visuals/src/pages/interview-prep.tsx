import { useState } from "react";
import {
  Mic2, Newspaper, Star, Radio, Loader2, Sparkles, Copy, Check,
  MessageSquareQuote, ListChecks, Target, ChevronRight, Trophy, AlertTriangle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── AI Interview Prep ───────────────────────────────────────────────────
   Media training with AI. Pick an interview type, describe the artist, and
   get a prep session: likely questions (with handling tips) + talking
   points. Practice mode scores your answers with AI feedback.
   POST /api/interview-prep/session → 2 credits.
   POST /api/interview-prep/feedback → 1 credit per answer. */

const SESSION_COST = 2;
const FEEDBACK_COST = 1;

type InterviewType = "podcast" | "press" | "red-carpet" | "live-stream";
type QuestionCategory = "warmup" | "craft" | "story" | "tough" | "rapid-fire";

const TYPE_OPTIONS: { value: InterviewType; label: string; blurb: string; icon: LucideIcon }[] = [
  { value: "podcast", label: "Podcast", blurb: "Long-form, conversational. Go deep on craft and stories.", icon: Mic2 },
  { value: "press", label: "Press / Media", blurb: "Print and online. Quotable angles and career arc.", icon: Newspaper },
  { value: "red-carpet", label: "Red Carpet", blurb: "2-minute press lines. Short, high-energy, headline-ready.", icon: Star },
  { value: "live-stream", label: "Live Stream", blurb: "Fan Q&A chaos. Rapid-fire fun + tricky deflections.", icon: Radio },
];

const CATEGORY_META: Record<QuestionCategory, { label: string; className: string }> = {
  warmup: { label: "Warm-up", className: "border-sky-400/30 bg-sky-400/10 text-sky-300" },
  craft: { label: "Craft", className: "border-violet-400/30 bg-violet-400/10 text-violet-300" },
  story: { label: "Story", className: "border-amber-400/30 bg-amber-400/10 text-amber-300" },
  tough: { label: "Tough", className: "border-red-400/30 bg-red-400/10 text-red-300" },
  "rapid-fire": { label: "Rapid-fire", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" },
};

interface InterviewQuestion {
  question: string;
  category: QuestionCategory;
  tip: string;
}

interface PrepSession {
  interviewType: InterviewType;
  questions: InterviewQuestion[];
  talkingPoints: string[];
  disclaimer: string;
}

interface AnswerFeedback {
  score: number;
  strengths: string[];
  improvements: string[];
  modelAnswer: string;
  disclaimer: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-white/50";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/60 transition hover:border-primary/40 hover:text-white"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  return "text-red-400";
}

function scoreBarColor(score: number): string {
  if (score >= 80) return "bg-emerald-400";
  if (score >= 60) return "bg-amber-400";
  return "bg-red-400";
}

export default function InterviewPrep() {
  const { user, getAccessToken, refreshProfile } = useAuth();

  /* setup */
  const [interviewType, setInterviewType] = useState<InterviewType>("podcast");
  const [artistName, setArtistName] = useState("");
  const [genre, setGenre] = useState("");
  const [latestProject, setLatestProject] = useState("");
  const [currentStory, setCurrentStory] = useState("");
  const [audienceSize, setAudienceSize] = useState("");

  /* session */
  const [session, setSession] = useState<PrepSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* practice mode */
  const [practiceIdx, setPracticeIdx] = useState<number | null>(null);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  async function authedPost(path: string, body: unknown) {
    const token = await getAccessToken();
    return fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  async function generateSession() {
    if (loading || !user) return;
    if (!artistName.trim()) {
      setError("Tell us the artist name first — the questions are written for them.");
      return;
    }
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setFeedback(null);
    setPracticeIdx(null);
    try {
      const res = await authedPost("/api/interview-prep/session", {
        interviewType,
        artistName: artistName.trim(),
        genre: genre.trim(),
        latestProject: latestProject.trim(),
        currentStory: currentStory.trim(),
        audienceSize: audienceSize.trim(),
      });
      const data = (await res.json().catch(() => ({}))) as {
        session?: PrepSession; error?: string; message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.session) {
        throw new Error(data.message || data.error || "Prep session generation failed — try again.");
      }
      setSession(data.session);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("interview-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prep session generation failed — try again.");
    } finally {
      setLoading(false);
    }
  }

  function startPractice(idx: number) {
    setPracticeIdx(idx);
    setAnswer("");
    setFeedback(null);
    setFeedbackError(null);
    setTimeout(() => {
      document.getElementById("practice-mode")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  async function submitAnswer() {
    if (feedbackLoading || !user || practiceIdx === null || !session) return;
    const q = session.questions[practiceIdx];
    if (!q) return;
    if (answer.trim().length < 10) {
      setFeedbackError("Give it a real shot — at least a sentence or two. That's what the coach needs to work with.");
      return;
    }
    setFeedbackLoading(true);
    setFeedbackError(null);
    try {
      const res = await authedPost("/api/interview-prep/feedback", {
        interviewType: session.interviewType,
        artistName: artistName.trim(),
        question: q.question,
        answer: answer.trim(),
      });
      const data = (await res.json().catch(() => ({}))) as {
        feedback?: AnswerFeedback; error?: string; message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.feedback) {
        throw new Error(data.message || data.error || "Feedback failed — try again.");
      }
      setFeedback(data.feedback);
      refreshProfile();
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : "Feedback failed — try again.");
    } finally {
      setFeedbackLoading(false);
    }
  }

  const activeQuestion = practiceIdx !== null && session ? session.questions[practiceIdx] ?? null : null;

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      <main className="relative mx-auto max-w-4xl px-5 pb-24 pt-14 md:pt-20">
        {/* glow */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero */}
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <Mic2 className="h-3 w-3" aria-hidden="true" /> Thy Cheat Code's training room
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            AI Interview <span className="text-primary">Prep</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            Walk into any interview ready. AI predicts the questions you'll
            actually get — including the uncomfortable ones — then coaches
            your answers until they're quotable.
          </p>
        </div>

        {/* interview type picker */}
        <div className="relative mt-10">
          <h2 className={labelClass + " text-center"}>1 · Pick your interview</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {TYPE_OPTIONS.map((t) => {
              const Icon = t.icon;
              const active = interviewType === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setInterviewType(t.value)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    active
                      ? "border-primary/60 bg-primary/[0.08] shadow-[0_0_20px_rgba(212,175,55,0.15)]"
                      : "border-white/10 bg-white/[0.03] hover:border-primary/30"
                  }`}
                >
                  <Icon className={`h-5 w-5 ${active ? "text-primary" : "text-white/50"}`} />
                  <p className="mt-2 text-sm font-bold text-white">{t.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-white/45">{t.blurb}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* artist profile */}
        <div className="relative mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
            <Sparkles className="h-4 w-4" /> 2 · The artist profile
          </h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="ip-name">Artist name</label>
              <input id="ip-name" className={inputClass} value={artistName} onChange={(e) => setArtistName(e.target.value)} placeholder="King Shark" maxLength={100} />
            </div>
            <div>
              <label className={labelClass} htmlFor="ip-genre">Genre</label>
              <input id="ip-genre" className={inputClass} value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Hip-Hop" maxLength={100} />
            </div>
            <div>
              <label className={labelClass} htmlFor="ip-project">Latest project</label>
              <input id="ip-project" className={inputClass} value={latestProject} onChange={(e) => setLatestProject(e.target.value)} placeholder="Deep Water EP — out now" maxLength={300} />
            </div>
            <div>
              <label className={labelClass} htmlFor="ip-audience">Audience size</label>
              <input id="ip-audience" className={inputClass} value={audienceSize} onChange={(e) => setAudienceSize(e.target.value)} placeholder="250K" maxLength={50} />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass} htmlFor="ip-story">What's happening right now? <span className="text-white/30 normal-case">(the story interviewers will chase)</span></label>
              <textarea id="ip-story" className={inputClass} rows={2} value={currentStory} onChange={(e) => setCurrentStory(e.target.value)} placeholder="Just announced a 20-city tour, single going viral on TikTok…" maxLength={500} />
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="relative mt-8 text-center">
          <button
            onClick={generateSession}
            disabled={loading || !user}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3.5 text-sm font-bold text-black shadow-[0_0_24px_rgba(212,175,55,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? "Building your session…" : `Generate prep session · ${SESSION_COST} credits`}
          </button>
          {!user && <p className="mt-3 text-xs text-white/40">Sign in to start training.</p>}
          {error && <p className="mx-auto mt-4 max-w-md text-sm text-red-400">{error}</p>}
          {outOfCredits && (
            <div className="mx-auto mt-4 max-w-md">
              <OutOfCredits />
            </div>
          )}
        </div>

        {/* results */}
        {session && (
          <div id="interview-results" className="relative mt-12 space-y-8">
            {/* talking points */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
                  <Target className="h-4 w-4" /> Talking points
                </h2>
                <CopyButton text={session.talkingPoints.map((t, i) => `${i + 1}. ${t}`).join("\n")} />
              </div>
              <p className="mt-2 text-xs text-white/40">Land these no matter what you're asked.</p>
              <ul className="mt-4 space-y-2.5">
                {session.talkingPoints.map((t, i) => (
                  <li key={i} className="flex gap-3 text-sm leading-relaxed text-white/75">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                      {i + 1}
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </section>

            {/* questions */}
            <section>
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
                <ListChecks className="h-4 w-4" /> Likely questions
              </h2>
              <p className="mt-2 text-xs text-white/40">Hit <span className="text-white/70 font-semibold">Practice</span> on any question to rehearse it — AI scores your answer ({FEEDBACK_COST} credit each).</p>
              <div className="mt-4 space-y-3">
                {session.questions.map((q, i) => {
                  const meta = CATEGORY_META[q.category];
                  return (
                    <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${meta.className}`}>
                          {meta.label}
                        </span>
                        <button
                          onClick={() => startPractice(i)}
                          className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/20"
                        >
                          <MessageSquareQuote className="h-3.5 w-3.5" /> Practice
                        </button>
                      </div>
                      <p className="mt-3 text-[15px] font-semibold leading-relaxed text-white">"{q.question}"</p>
                      <p className="mt-2 flex gap-1.5 text-xs leading-relaxed text-white/45">
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                        <span><span className="font-semibold text-white/60">Coach tip: </span>{q.tip}</span>
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* practice mode */}
            {activeQuestion && (
              <section id="practice-mode" className="rounded-2xl border border-primary/30 bg-primary/[0.04] p-6">
                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
                  <Mic2 className="h-4 w-4" /> Practice mode
                </h2>
                <p className="mt-3 text-[15px] font-semibold leading-relaxed text-white">"{activeQuestion.question}"</p>
                <label className={labelClass + " mt-4"} htmlFor="ip-answer">Your answer — say it like you're on mic</label>
                <textarea
                  id="ip-answer"
                  className={inputClass}
                  rows={4}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Type your answer the way you'd say it out loud…"
                  maxLength={3000}
                />
                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={submitAnswer}
                    disabled={feedbackLoading || !user}
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {feedbackLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />}
                    {feedbackLoading ? "Scoring…" : `Get coached · ${FEEDBACK_COST} credit`}
                  </button>
                  <button
                    onClick={() => { setPracticeIdx(null); setFeedback(null); setAnswer(""); setFeedbackError(null); }}
                    className="text-xs font-semibold text-white/50 transition hover:text-white"
                  >
                    Back to questions
                  </button>
                </div>
                {feedbackError && <p className="mt-3 text-sm text-red-400">{feedbackError}</p>}

                {feedback && (
                  <div className="mt-6 space-y-4">
                    {/* score */}
                    <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold uppercase tracking-wider text-white/50">Coach score</p>
                        <p className={`text-2xl font-black ${scoreColor(feedback.score)}`}>{feedback.score}<span className="text-sm text-white/40">/100</span></p>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                        <div className={`h-full rounded-full ${scoreBarColor(feedback.score)}`} style={{ width: `${feedback.score}%` }} />
                      </div>
                    </div>
                    {/* strengths */}
                    <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">What landed</p>
                      <ul className="mt-2 space-y-1.5">
                        {feedback.strengths.map((s, i) => (
                          <li key={i} className="text-sm leading-relaxed text-white/75">✓ {s}</li>
                        ))}
                      </ul>
                    </div>
                    {/* improvements */}
                    <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-4">
                      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5" /> Tighten up
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {feedback.improvements.map((s, i) => (
                          <li key={i} className="text-sm leading-relaxed text-white/75">→ {s}</li>
                        ))}
                      </ul>
                    </div>
                    {/* model answer */}
                    <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold uppercase tracking-wider text-white/50">Sharper version — in your voice</p>
                        <CopyButton text={feedback.modelAnswer} />
                      </div>
                      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-white/75">"{feedback.modelAnswer}"</p>
                    </div>
                  </div>
                )}
              </section>
            )}

            <p className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-xs leading-relaxed text-amber-200/80">
              {session.disclaimer}
            </p>
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
