import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Music2, Loader2, Sparkles, Upload, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── Finish My Song ───────────────────────────────────────────────────────
   Audio Studio tab. Upload an unfinished demo / voice memo — AI analyzes
   what's there, writes the missing parts (verse/chorus/bridge), and produces
   the completed song via the existing music pipeline. 4 VB on success
   (priced like song generation); analysis + upload are part of the flow. */

const COST = 4;

interface FinishResult {
  songUrl: string;
  lyrics: string;
  arrangement: string;
  influence: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none";

export function FinishMySong() {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [result, setResult] = useState<FinishResult | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  }

  async function finish() {
    if (!file || loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const form = new FormData();
      form.append("demo", file);
      form.append("notes", notes.trim());
      const res = await confirmedFetch("/api/finish-my-song/complete", {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        overrideCost: COST,
        overrideFeature: "Finish My Song",
        body: form,
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as FinishResult & {
        error?: string; message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.songUrl) throw new Error(data.message || "Could not finish song.");
      setResult(data);
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finish song.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
        <div className="flex items-center gap-2 mb-1">
          <Music2 className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-black text-white">{t("finishMySong.title", { defaultValue: "Finish My Song" })}</h3>
          <span className="ml-auto rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
            {t("finishMySong.cost", { defaultValue: "4 VB" })}
          </span>
        </div>
        <p className="text-sm text-white/50 mb-6">
          {t("finishMySong.desc", { defaultValue: "Upload your unfinished demo or voice memo — AI writes what's missing and produces the finished song around your idea." })}
        </p>

        <div className="mb-4">
          <label className={`flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed px-5 py-6 transition ${file ? "border-primary/60 bg-primary/[0.05]" : "border-white/15 hover:border-white/30"}`}>
            {file ? <Check className="h-5 w-5 text-primary" /> : <Upload className="h-5 w-5 text-white/40" />}
            <div>
              <p className="text-sm font-bold text-white">{file ? file.name : t("finishMySong.uploadCta", { defaultValue: "Drop your demo / voice memo" })}</p>
              <p className="text-xs text-white/40">{t("finishMySong.uploadHint", { defaultValue: "MP3, WAV, M4A — up to 25 MB" })}</p>
            </div>
            <input type="file" accept="audio/*" className="hidden" onChange={handleFile} />
          </label>
        </div>

        <div className="mb-2">
          <label className="text-[11px] font-bold uppercase tracking-widest text-white/40">
            {t("finishMySong.notesLabel", { defaultValue: "What's missing? (optional)" })}
          </label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder={t("finishMySong.notesPh", { defaultValue: "e.g. needs a second verse and a bigger chorus" })}
            className={`${inputClass} mt-1.5`} maxLength={500} />
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {outOfCredits && <div className="mt-4"><OutOfCredits /></div>}

        <button type="button" onClick={finish} disabled={loading || !file}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {t("finishMySong.go", { defaultValue: "Finish My Song" })}
        </button>
        {loading && (
          <p className="mt-3 text-xs text-white/40">{t("finishMySong.working", { defaultValue: "Analyzing your demo, writing the missing parts, producing…" })}</p>
        )}
      </div>

      {result && (
        <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8 space-y-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-2">
              {t("finishMySong.finished", { defaultValue: "Your finished song" })}
            </p>
            <audio src={result.songUrl} controls className="w-full" />
            <p className="mt-2 text-[11px] text-white/35">{result.influence}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-1">{t("finishMySong.lyrics", { defaultValue: "Full lyrics" })}</p>
            <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">{result.lyrics}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-1">{t("finishMySong.arrangement", { defaultValue: "Arrangement notes" })}</p>
            <p className="text-sm text-white/60 whitespace-pre-wrap">{result.arrangement}</p>
          </div>
        </div>
      )}
    </div>
  );
}
