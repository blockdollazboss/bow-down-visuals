import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Zap, Loader2, Copy, Check, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useToast } from "@/hooks/use-toast";

/* ── Trend Jacker ─────────────────────────────────────────────────────────
   Lives in the Plan hub (/scheduler) as a tab. Picks up a trend — from the
   Trend Predictor watchlist (localStorage) or typed in — and generates a
   complete draft video package in the user's style: hook, script, shot-by-
   shot visual plan, caption, hashtags. 2 credits per draft. */

const DRAFT_CREDITS = 2;
const WATCHLIST_KEY = "bdv-trend-watchlist";

interface TrendDraft {
  hook: string;
  script: string;
  visualPlan: string[];
  caption: string;
  hashtags: string[];
}

interface DraftResponse {
  hook?: string;
  script?: string;
  visualPlan?: string[];
  caption?: string;
  hashtags?: string[];
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

interface TrackedTrend {
  trend: string;
  reasoning?: string;
}

function readWatchlist(): TrackedTrend[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((t) => t && typeof t.trend === "string") : [];
  } catch {
    return [];
  }
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none";

export default function TrendJackerSection() {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();

  const [watchlist] = useState<TrackedTrend[]>(readWatchlist);
  const [trend, setTrend] = useState("");
  const [trendWhy, setTrendWhy] = useState("");
  const [niche, setNiche] = useState("Music");
  const [styleNotes, setStyleNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [draft, setDraft] = useState<TrendDraft | null>(null);
  const [copied, setCopied] = useState(false);

  function pickTracked(tr: TrackedTrend) {
    setTrend(tr.trend);
    setTrendWhy(tr.reasoning ?? "");
  }

  async function generate() {
    const finalTrend = trend.trim();
    if (!finalTrend || loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/trend-jacker/draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        overrideCost: DRAFT_CREDITS,
        overrideFeature: "Trend Jacker",
        body: JSON.stringify({
          trend: finalTrend,
          trendWhy: trendWhy.trim(),
          niche: niche.trim() || "Music",
          styleNotes: styleNotes.trim(),
        }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as DraftResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.hook || !data.script) throw new Error(data.message || "Draft failed.");
      setDraft({
        hook: data.hook,
        script: data.script,
        visualPlan: data.visualPlan ?? [],
        caption: data.caption ?? "",
        hashtags: data.hashtags ?? [],
      });
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Draft failed.");
    } finally {
      setLoading(false);
    }
  }

  function copyAll() {
    if (!draft) return;
    const text = `${draft.hook}\n\n${draft.script}\n\n${draft.visualPlan.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n${draft.caption}\n${draft.hashtags.join(" ")}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
        <div className="flex items-center gap-2 mb-1">
          <Zap className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-black text-white">
            {t("trendJacker.title", { defaultValue: "Trend Jacker" })}
          </h3>
          <span className="ml-auto rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
            {t("trendJacker.cost", { defaultValue: "2 VB / draft" })}
          </span>
        </div>
        <p className="text-sm text-white/50 mb-6">
          {t("trendJacker.desc", { defaultValue: "Pick a trend — from your watchlist or anywhere — and get a complete video draft in your style: hook, script, visual plan, caption, hashtags." })}
        </p>

        {watchlist.length > 0 && (
          <div className="mb-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/40 mb-2">
              {t("trendJacker.fromWatchlist", { defaultValue: "From your trend watchlist" })}
            </p>
            <div className="flex flex-wrap gap-2">
              {watchlist.slice(0, 6).map((tr, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => pickTracked(tr)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${trend === tr.trend ? "border-primary bg-primary/15 text-primary" : "border-white/10 text-white/60 hover:border-primary/40 hover:text-white"}`}
                >
                  {tr.trend}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("trendJacker.trendLabel", { defaultValue: "The trend / sound / format" })}
            </label>
            <input value={trend} onChange={(e) => setTrend(e.target.value)} placeholder={t("trendJacker.trendPh", { defaultValue: "e.g. Sped-up phonk edits, GRWM voiceovers…" })} className={`${inputClass} mt-1.5`} maxLength={200} />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("trendJacker.nicheLabel", { defaultValue: "Your niche" })}
            </label>
            <input value={niche} onChange={(e) => setNiche(e.target.value)} className={`${inputClass} mt-1.5`} maxLength={120} />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("trendJacker.styleLabel", { defaultValue: "Your style (optional)" })}
            </label>
            <input value={styleNotes} onChange={(e) => setStyleNotes(e.target.value)} placeholder={t("trendJacker.stylePh", { defaultValue: "e.g. high-energy, luxury aesthetic…" })} className={`${inputClass} mt-1.5`} maxLength={500} />
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {outOfCredits && <div className="mt-4"><OutOfCredits /></div>}

        <button
          type="button"
          onClick={generate}
          disabled={loading || !trend.trim()}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {t("trendJacker.generate", { defaultValue: "Jack This Trend" })}
        </button>
      </div>

      {draft && (
        <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8 space-y-6">
          <div className="flex items-center justify-between">
            <h4 className="text-base font-black text-white">{t("trendJacker.yourDraft", { defaultValue: "Your draft" })}</h4>
            <button type="button" onClick={copyAll} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/70 hover:text-white">
              {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
              {t("trendJacker.copy", { defaultValue: "Copy all" })}
            </button>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-1.5">{t("trendJacker.hook", { defaultValue: "Hook" })}</p>
            <p className="text-white font-semibold leading-relaxed">{draft.hook}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-1.5">{t("trendJacker.script", { defaultValue: "Script" })}</p>
            <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">{draft.script}</p>
          </div>
          {draft.visualPlan.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-1.5">{t("trendJacker.visualPlan", { defaultValue: "Visual plan" })}</p>
              <ol className="list-decimal list-inside space-y-1.5 text-sm text-white/75">
                {draft.visualPlan.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </div>
          )}
          {(draft.caption || draft.hashtags.length > 0) && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-1.5">{t("trendJacker.caption", { defaultValue: "Caption + hashtags" })}</p>
              <p className="text-sm text-white/75">{draft.caption}</p>
              <p className="text-sm text-primary/90 mt-1">{draft.hashtags.join(" ")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
