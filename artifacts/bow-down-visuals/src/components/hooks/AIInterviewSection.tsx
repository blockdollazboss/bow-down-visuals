import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Mic2, Loader2, Sparkles, Copy, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── AI Interview ─────────────────────────────────────────────────────────
   Content hub (/hooks) tab. Two steps:
   (1) AI asks 5 sharp, angle-driven interview questions (1 VB).
   (2) User answers (text); AI packages the answers into clip-worthy
       moments, quote cards, and a 60s promo cut outline (2 VB). */

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

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
        <div className="flex items-center gap-2 mb-1">
          <Mic2 className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-black text-white">{t("aiInterview.title", { defaultValue: "AI Interview" })}</h3>
          <span className="ml-auto rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
            {t("aiInterview.cost", { defaultValue: "100 + 200 VB" })}
          </span>
        </div>
        <p className="text-sm text-white/50 mb-6">
          {t("aiInterview.desc", { defaultValue: "Get interviewed by AI: 5 sharp questions, you answer, and it cuts your answers into clips, quote cards, and a promo outline." })}
        </p>

        <div className="grid gap-4 md:grid-cols-2 mb-4">
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
            <input value={niche} onChange={(e) => setNiche(e.target.value)} className={`${inputClass} mt-1.5`} maxLength={120} />
          </div>
        </div>

        <button type="button" onClick={getQuestions} disabled={loading || !topic.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40">
          {loading && questions.length === 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {t("aiInterview.getQuestions", { defaultValue: "Ask Me 5 Questions (100 VB)" })}
        </button>

        {questions.length > 0 && (
          <div className="mt-6 space-y-4">
            {questions.map((q, i) => (
              <div key={i}>
                <p className="text-sm font-bold text-primary mb-1.5">Q{i + 1}: {q}</p>
                <textarea value={answers[i] ?? ""} onChange={(e) => {
                  const next = [...answers];
                  next[i] = e.target.value;
                  setAnswers(next);
                }} placeholder={t("aiInterview.answerPh", { defaultValue: "Your answer…" })}
                  className={`${inputClass} min-h-[70px] resize-y`} maxLength={2000} />
              </div>
            ))}
            <button type="button" onClick={buildPackage} disabled={loading || !answers.some((a) => a.trim())}
              className="inline-flex items-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-6 py-3 text-sm font-black text-primary transition hover:bg-primary/20 disabled:opacity-40">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {t("aiInterview.buildPackage", { defaultValue: "Cut My Clips + Cards (200 VB)" })}
            </button>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {outOfCredits && <div className="mt-4"><OutOfCredits /></div>}
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
