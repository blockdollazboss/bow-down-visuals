import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Ear, Loader2, Sparkles, Plus, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── Fan Decoder ──────────────────────────────────────────────────────────
   Analytics hub tab. Paste comments/DMs — AI decodes what the audience
   wants next: ranked wants with supporting quotes, concrete content
   directions, tone notes. 1 VB. */

const COST = 1;

interface Want {
  want: string;
  quotes: string[];
  priority: number;
}

interface DecodeResult {
  wants: Want[];
  contentDirections: string[];
  toneNotes: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none";

export default function FanDecoderSection() {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [input, setInput] = useState("");
  const [comments, setComments] = useState<string[]>([]);
  const [niche, setNiche] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [result, setResult] = useState<DecodeResult | null>(null);

  function add() {
    const c = input.trim();
    if (!c || comments.length >= 30) return;
    setComments((prev) => [...prev, c]);
    setInput("");
  }

  async function decode() {
    if (comments.length === 0 || loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/fan-decoder/decode", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        overrideCost: COST,
        overrideFeature: "Fan Decoder",
        body: JSON.stringify({ comments, niche: niche.trim() }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as DecodeResult & {
        error?: string; message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.wants) throw new Error(data.message || "Decode failed.");
      setResult(data);
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decode failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
        <div className="flex items-center gap-2 mb-1">
          <Ear className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-black text-white">{t("fanDecoder.title", { defaultValue: "Fan Decoder" })}</h3>
          <span className="ml-auto rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
            {t("fanDecoder.cost", { defaultValue: "1 VB" })}
          </span>
        </div>
        <p className="text-sm text-white/50 mb-6">
          {t("fanDecoder.desc", { defaultValue: "Paste comments and DMs — AI tells you exactly what your audience wants next, with the quotes to prove it." })}
        </p>

        <div className="flex gap-2 mb-3">
          <input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder={t("fanDecoder.pastePh", { defaultValue: "Paste a comment or DM, hit Enter…" })}
            className={inputClass} maxLength={500} />
          <button type="button" onClick={add} disabled={!input.trim() || comments.length >= 30}
            className="shrink-0 rounded-xl bg-white/10 px-4 text-white hover:bg-white/15 disabled:opacity-40" aria-label="Add">
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {comments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-5">
            {comments.map((c, i) => (
              <span key={i} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/75">
                <span className="truncate max-w-[280px]">“{c}”</span>
                <button type="button" onClick={() => setComments((prev) => prev.filter((_, idx) => idx !== i))} className="text-white/40 hover:text-white" aria-label="Remove">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="mb-2">
          <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
            {t("fanDecoder.nicheLabel", { defaultValue: "Your niche (optional)" })}
          </label>
          <input value={niche} onChange={(e) => setNiche(e.target.value)} className={`${inputClass} mt-1.5`} maxLength={120} />
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {outOfCredits && <div className="mt-4"><OutOfCredits /></div>}

        <button type="button" onClick={decode} disabled={loading || comments.length === 0}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {t("fanDecoder.decode", { defaultValue: "Decode My Fans" })}
        </button>
      </div>

      {result && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:col-span-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-3">
              {t("fanDecoder.wants", { defaultValue: "What they want next" })}
            </p>
            <div className="space-y-3">
              {[...result.wants].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)).map((w, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-black/40 p-4">
                  <p className="text-sm font-black text-white">{w.want}</p>
                  {w.quotes?.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {w.quotes.slice(0, 3).map((q, qi) => (
                        <p key={qi} className="text-xs text-white/45 italic">“{q}”</p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-3">
              {t("fanDecoder.directions", { defaultValue: "Content directions" })}
            </p>
            <ul className="space-y-2">
              {result.contentDirections.map((d, i) => (
                <li key={i} className="flex gap-2 text-sm text-white/75"><span className="text-primary">•</span>{d}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-3">
              {t("fanDecoder.tone", { defaultValue: "Tone notes" })}
            </p>
            <p className="text-sm text-white/75 leading-relaxed">{result.toneNotes}</p>
          </div>
        </div>
      )}
    </div>
  );
}
