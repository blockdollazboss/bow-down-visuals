import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Mic2, Loader2, Sparkles, Copy, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── AI Interview ─────────────────────────────────────────────────────────
   Content hub (/hooks) tab. Two steps:
   (1) AI asks 5 sharp, angle-driven interview questions (100 VB).
   (2) User answers (text); AI packages the answers into clip-worthy
       moments, quote cards, and a 60s promo cut outline (200 VB). */

const Q_COST = 1;
const PKG_COST = 2;

interface ClipMoment { quote: string; why: string; }

interface InterviewPackage {
  clips: ClipMoment[];
  quoteCards: string[];
  promoOutline: string[];
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none";

export default function AIInterviewSection() {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [topic, setTopic] = useState("");
  const [niche, setNiche] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [pkg, setPkg] = useState<InterviewPackage | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [copied, setCopied] = useState(false);

  async function post<T>(url: string, body: object, cost: number, feature: string): Promise<T | null> {
    const token = await getAccessToken();
    const res = await confirmedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      overrideCost: cost,
      overrideFeature: feature,
      body: JSON.stringify(body),
    });
    if (!res) return null;
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
    if (res.status === 402 || data.error === "out_of_credits") {
      setOutOfCredits(true);
      refreshProfile();
      return null;
    }
    if (!res.ok) throw new Error(data.message || "Request failed.");
    refreshProfile();
    return data;
  }

  async function getQuestions() {
    if (!topic.trim() || loading) return;
    setLoading(true); setError(null); setOutOfCredits(false);
    setPkg(null);
    try {
      const data = await post<{ questions: string[] }>("/api/ai-interview/questions",
        { topic: topic.trim(), niche: niche.trim() }, Q_COST, "AI Interview");
      if (data?.questions?.length) {
        setQuestions(data.questions.slice(0, 5));
        setAnswers(new Array(Math.min(5, data.questions.length)).fill(""));
        setCurrentQ(0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate questions.");
    } finally {
      setLoading(false);
    }
  }

  async function buildPackage() {
    const qa = questions.map((q, i) => ({ question: q, answer: (answers[i] ?? "").trim() }))
      .filter((x) => x.answer);
    if (qa.length === 0 || loading) return;
    setLoading(true); setError(null); setOutOfCredits(false);
    try {
      const data = await post<InterviewPackage>("/api/ai-interview/package",
        { topic: topic.trim(), qa }, PKG_COST, "AI Interview");
      if (data?.clips) setPkg(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build package.");
    } finally {
      setLoading(false);
    }
  }

  function copyPackage() {
    if (!pkg) return;
    const text = `CLIPS:\n${pkg.clips.map((c, i) => `${i + 1}. "${c.quote}" — ${c.why}`).join("\n")}\n\nQUOTE CARDS:\n${pkg.quoteCards.join("\n")}\n\nPROMO OUTLINE:\n${pkg.promoOutline.map((p, i) => `${i + 1}. ${p}`).join("\n")}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const answeredCount = answers.filter((a) => a.trim()).length;

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-3xl border border-primary/25 bg-black">
        {/* ── Header: mic + title + cost ── */}
        <div className="bg-gradient-to-b from-[#1a1408] to-[#0a0803] px-6 md:px-8 pt-6 pb-5 border-b border-primary/15">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] shadow-[0_0_24px_rgba(201,168,76,0.35)]">
              <Mic2 className="h-5 w-5 text-black" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-black text-white tracking-tight">{t("aiInterview.title", { defaultValue: "AI Interview" })}</h3>
              <p className="text-xs text-white/45">
                {t("aiInterview.desc", { defaultValue: "5 sharp questions → your answers → clips, quote cards, promo outline." })}
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-black text-primary">
              100 + 200 VB
            </span>
          </div>
          {/* Progress steps */}
          <div className="mt-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
            <span className={`rounded-full px-2.5 py-1 ${questions.length === 0 ? "bg-primary/20 text-primary" : "bg-white/5 text-white/35"}`}>
              1 · Topic
            </span>
            <span className="h-px flex-1 bg-white/10" />
            <span className={`rounded-full px-2.5 py-1 ${questions.length > 0 && !pkg ? "bg-primary/20 text-primary" : "bg-white/5 text-white/35"}`}>
              2 · Interview{questions.length > 0 && !pkg ? ` (${answeredCount}/${questions.length})` : ""}
            </span>
            <span className="h-px flex-1 bg-white/10" />
            <span className={`rounded-full px-2.5 py-1 ${pkg ? "bg-primary/20 text-primary" : "bg-white/5 text-white/35"}`}>
              3 · Package
            </span>
          </div>
        </div>

        <div className="p-6 md:p-8">
        {questions.length === 0 ? (
          /* ── Step 1: topic setup ── */
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
                  {t("aiInterview.topicLabel", { defaultValue: "Interview topic *" })}
                </label>
                <input value={topic} onChange={(e) => setTopic(e.target.value)}
                  placeholder={t("aiInterview.topicPh", { defaultValue: "e.g. my new single, touring life…" })}
                  className={`${inputClass} mt-1.5`} maxLength={300} />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
                  {t("aiInterview.nicheLabel", { defaultValue: "Niche (optional)" })}
                </label>
                <input value={niche} onChange={(e) => setNiche(e.target.value)}
                  placeholder={t("aiInterview.nichePh", { defaultValue: "e.g. hip-hop, fitness…" })}
                  className={`${inputClass} mt-1.5`} maxLength={120} />
              </div>
            </div>
            <button type="button" onClick={getQuestions} disabled={loading || !topic.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {t("aiInterview.getQuestions", { defaultValue: "Start the Interview (100 VB)" })}
            </button>
          </div>
        ) : (
          /* ── Step 2: conversational interview — one question at a time ── */
          <div className="space-y-5">
            {/* Question dots */}
            <div className="flex items-center gap-2">
              {questions.map((_, i) => (
                <button key={i} type="button" onClick={() => setCurrentQ(i)}
                  aria-label={`Go to question ${i + 1}`}
                  className={`h-2.5 rounded-full transition-all ${
                    i === currentQ ? "w-8 bg-primary" :
                    answers[i]?.trim() ? "w-2.5 bg-primary/50 hover:bg-primary/70" :
                    "w-2.5 bg-white/15 hover:bg-white/25"
                  }`} />
              ))}
              <span className="ml-2 text-[11px] font-bold text-white/40">
                Question {currentQ + 1} of {questions.length}
              </span>
            </div>

            {/* AI question bubble */}
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C]">
                <Mic2 className="h-4 w-4 text-black" />
              </div>
              <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-primary/20 bg-gradient-to-b from-[#14100a] to-black px-5 py-4">
                <p className="text-[15px] font-semibold leading-relaxed text-white">{questions[currentQ]}</p>
              </div>
            </div>

            {/* Answer input */}
            <div className="pl-12">
              <textarea value={answers[currentQ] ?? ""} onChange={(e) => {
                const next = [...answers];
                next[currentQ] = e.target.value;
                setAnswers(next);
              }} placeholder={t("aiInterview.answerPh", { defaultValue: "Speak your mind — the rawer the better…" })}
                className={`${inputClass} min-h-[110px] resize-y !rounded-2xl !border-white/15 !bg-white/[0.03]`} maxLength={2000} />
              <div className="mt-3 flex items-center gap-2">
                {currentQ > 0 && (
                  <button type="button" onClick={() => setCurrentQ(currentQ - 1)}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-white/70 hover:bg-white/10">
                    ← Back
                  </button>
                )}
                {currentQ < questions.length - 1 ? (
                  <button type="button" onClick={() => setCurrentQ(currentQ + 1)}
                    className="rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-5 py-2 text-xs font-black text-black hover:brightness-110">
                    Next Question →
                  </button>
                ) : (
                  <button type="button" onClick={buildPackage} disabled={loading || !answers.some((a) => a.trim())}
                    className="inline-flex items-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-5 py-2 text-xs font-black text-primary transition hover:bg-primary/20 disabled:opacity-40">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {t("aiInterview.buildPackage", { defaultValue: "Cut My Clips + Cards (200 VB)" })}
                  </button>
                )}
                <span className="ml-auto text-[11px] text-white/35">{answeredCount}/{questions.length} answered</span>
              </div>
            </div>

            <button type="button" onClick={() => { setQuestions([]); setPkg(null); }}
              className="text-[11px] font-bold text-white/30 hover:text-white/60 underline underline-offset-2">
              Start over with a new topic
            </button>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {outOfCredits && <div className="mt-4"><OutOfCredits /></div>}
        </div>
      </div>

      {pkg && (
        <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8 space-y-6">
          <div className="flex items-center justify-between">
            <h4 className="text-base font-black text-white">{t("aiInterview.package", { defaultValue: "Your interview package" })}</h4>
            <button type="button" onClick={copyPackage} className="text-white/50 hover:text-white" aria-label="Copy">
              {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-2">{t("aiInterview.clips", { defaultValue: "Clip moments" })}</p>
            <div className="space-y-2">
              {pkg.clips.map((c, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-black/40 p-4">
                  <p className="text-sm text-white font-semibold">“{c.quote}”</p>
                  <p className="text-xs text-white/45 mt-1">{c.why}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-2">{t("aiInterview.quoteCards", { defaultValue: "Quote cards" })}</p>
            <div className="grid gap-2 md:grid-cols-3">
              {pkg.quoteCards.map((q, i) => (
                <div key={i} className="rounded-xl border border-primary/30 bg-gradient-to-b from-[#14100a] to-black p-5 text-center">
                  <p className="text-sm font-black text-primary leading-snug">“{q}”</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-2">{t("aiInterview.promoOutline", { defaultValue: "60s promo cut outline" })}</p>
            <ol className="list-decimal list-inside space-y-1.5 text-sm text-white/75">
              {pkg.promoOutline.map((p, i) => <li key={i}>{p}</li>)}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
