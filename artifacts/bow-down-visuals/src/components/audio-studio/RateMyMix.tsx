import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Gauge, Loader2, Sparkles, Upload, Check, Wrench } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── Rate My Mix ──────────────────────────────────────────────────────────
   Audio Studio tab. Upload a mix — the server measures REAL audio stats
   (loudness, true peak, clipping, stereo correlation via ffmpeg) and AI
   turns those measurements into specific fix-it coaching notes.
   Coaching only — your audio is never modified. 1 VB. */

const COST = 1;

interface Measurements {
  integratedLufs?: number;
  truePeakDb?: number;
  clipCount?: number;
  stereoCorrelation?: number;
  durationSec?: number;
}

interface RateResult {
  measurements: Measurements;
  notes: string[];
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none";

export function RateMyMix() {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [file, setFile] = useState<File | null>(null);
  const [genre, setGenre] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [result, setResult] = useState<RateResult | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  }

  async function rate() {
    if (!file || loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const form = new FormData();
      form.append("mix", file);
      form.append("genre", genre.trim());
      const res = await confirmedFetch("/api/rate-my-mix/analyze", {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        overrideCost: COST,
        overrideFeature: "Rate My Mix",
        body: form,
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as RateResult & {
        error?: string; message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.notes) throw new Error(data.message || "Analysis failed.");
      setResult(data);
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  const m = result?.measurements;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
        <div className="flex items-center gap-2 mb-1">
          <Gauge className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-black text-white">{t("rateMyMix.title", { defaultValue: "Rate My Mix" })}</h3>
          <span className="ml-auto rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
            {t("rateMyMix.cost", { defaultValue: "1 VB" })}
          </span>
        </div>
        <p className="text-sm text-white/50 mb-6">
          {t("rateMyMix.desc", { defaultValue: "Upload your mix — we measure the real stats (loudness, peaks, clipping, stereo) and AI coaches you on exactly what to fix. Coaching only; your audio stays untouched." })}
        </p>

        <div className="mb-4">
          <label className={`flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed px-5 py-6 transition ${file ? "border-primary/60 bg-primary/[0.05]" : "border-white/15 hover:border-white/30"}`}>
            {file ? <Check className="h-5 w-5 text-primary" /> : <Upload className="h-5 w-5 text-white/40" />}
            <div>
              <p className="text-sm font-bold text-white">{file ? file.name : t("rateMyMix.uploadCta", { defaultValue: "Drop your mix" })}</p>
              <p className="text-xs text-white/40">{t("rateMyMix.uploadHint", { defaultValue: "MP3, WAV — up to 25 MB" })}</p>
            </div>
            <input type="file" accept="audio/*" className="hidden" onChange={handleFile} />
          </label>
        </div>

        <div className="mb-2">
          <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
            {t("rateMyMix.genreLabel", { defaultValue: "Genre (optional)" })}
          </label>
          <input value={genre} onChange={(e) => setGenre(e.target.value)} className={`${inputClass} mt-1.5`} maxLength={60} />
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {outOfCredits && <div className="mt-4"><OutOfCredits /></div>}

        <button type="button" onClick={rate} disabled={loading || !file}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {t("rateMyMix.go", { defaultValue: "Rate My Mix" })}
        </button>
      </div>

      {result && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-3">
              {t("rateMyMix.measured", { defaultValue: "Measured stats" })}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {([
                [t("rateMyMix.lufs", { defaultValue: "Loudness" }), m?.integratedLufs != null ? `${m.integratedLufs.toFixed(1)} LUFS` : "—"],
                [t("rateMyMix.peak", { defaultValue: "True peak" }), m?.truePeakDb != null ? `${m.truePeakDb.toFixed(1)} dB` : "—"],
                [t("rateMyMix.clips", { defaultValue: "Clips" }), m?.clipCount != null ? String(m.clipCount) : "—"],
                [t("rateMyMix.stereo", { defaultValue: "Stereo Ø" }), m?.stereoCorrelation != null ? m.stereoCorrelation.toFixed(2) : "—"],
              ] as [string, string][]).map(([label, val], i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-black/40 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-white/35">{label}</p>
                  <p className="text-base font-black text-white mt-0.5">{val}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-3 flex items-center gap-1.5">
              <Wrench className="h-3.5 w-3.5" /> {t("rateMyMix.fixes", { defaultValue: "Fix-it notes" })}
            </p>
            <ul className="space-y-2.5">
              {result.notes.map((n, i) => (
                <li key={i} className="flex gap-2 text-sm text-white/80"><span className="text-primary shrink-0">▸</span>{n}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
