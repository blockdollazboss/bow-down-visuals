import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Timer, Loader2, Sparkles, Trophy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── 3-Second Lab ─────────────────────────────────────────────────────────
   Visual Vibes editor rail tab. Describe the video (prefilled from the
   timeline's opening when available); AI writes 5 alternate opening hooks
   — spoken/visual text + visual direction — and SCORES each 0-100 for
   scroll-stopping power with one-line reasoning. Text-model analysis only;
   no extra generation cost beyond the 2 VB analysis. */

const COST = 2;

interface Opening {
  text: string;
  visual: string;
  score: number;
  reasoning: string;
}

interface ThreeSecondLabSectionProps {
  openingHint: string;
  /** When true, skips the internal header (a shell provides it). */
  bare?: boolean;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none";

function scoreColor(score: number): string {
  if (score >= 80) return "text-green-400";
  if (score >= 60) return "text-primary";
  return "text-white/50";
}

export function ThreeSecondLabSection({ openingHint, bare }: ThreeSecondLabSectionProps) {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [description, setDescription] = useState(openingHint);
  const [niche, setNiche] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [openings, setOpenings] = useState<Opening[]>([]);

  async function generate() {
    if (!description.trim() || loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/three-second-lab/openings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        overrideCost: COST,
        overrideFeature: "3-Second Lab",
        body: JSON.stringify({ videoDescription: description.trim(), niche: niche.trim() }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as {
        openings?: Opening[]; error?: string; message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.openings?.length) throw new Error(data.message || "Lab failed.");
      setOpenings([...data.openings].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)));
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lab failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {!bare && (
      <div>
        <h3 className="text-sm font-black text-white flex items-center gap-2">
          <Timer className="h-4 w-4 text-primary" />
          {t("videoEditor.labTitle", { defaultValue: "3-Second Lab" })}
        </h3>
        <p className="text-[11px] text-white/50 mt-1 leading-relaxed">
          {t("videoEditor.labDesc", {
            defaultValue: "Win the first 3 seconds. AI writes 5 alternate openings for your video and scores each for scroll-stopping power. 2 VB.",
          })}
        </p>
      </div>
      )}

      <div>
        <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
          {t("videoEditor.labVideoLabel", { defaultValue: "What is the video about? *" })}
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("videoEditor.labVideoPh", { defaultValue: "e.g. A luxury lifestyle montage from my latest single…" })}
          className={`${inputClass} mt-1 min-h-[80px] resize-y`}
          maxLength={1000}
        />
      </div>
      <div>
        <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
          {t("videoEditor.labNiche", { defaultValue: "Niche (optional)" })}
        </label>
        <input value={niche} onChange={(e) => setNiche(e.target.value)} className={`${inputClass} mt-1`} maxLength={120} />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {outOfCredits && <OutOfCredits />}

      <button
        type="button"
        onClick={generate}
        disabled={loading || !description.trim()}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-4 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {t("videoEditor.labGenerate", { defaultValue: "Test 5 Openings" })}
      </button>

      {openings.length > 0 && (
        <div className="space-y-2.5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
            {t("videoEditor.labResults", { defaultValue: "Ranked by scroll-stopping score" })}
          </p>
          {openings.map((o, i) => (
            <div key={i} className={`rounded-xl border p-3.5 ${i === 0 ? "border-primary/60 bg-primary/[0.07]" : "border-white/10 bg-white/[0.02]"}`}>
              <div className="flex items-center gap-2 mb-1.5">
                {i === 0 && <Trophy className="h-3.5 w-3.5 text-primary" />}
                <span className={`text-lg font-black ${scoreColor(o.score)}`}>{o.score}</span>
                <span className="text-[10px] text-white/35 uppercase tracking-widest">/ 100</span>
              </div>
              <p className="text-sm font-bold text-white leading-snug">“{o.text}”</p>
              <p className="text-[11px] text-white/50 mt-1">{o.visual}</p>
              <p className="text-[11px] text-white/35 mt-1 italic">{o.reasoning}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
