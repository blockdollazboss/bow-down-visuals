import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Upload, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, AudioWaveform, Info, RefreshCw, Play, Pause,
  Volume2, VolumeX, SlidersHorizontal, Music4,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useHubProject } from "@/lib/hub-project";
import { ProjectFlowBar } from "@/components/hub/ProjectFlowBar";
import { useTranslation } from "react-i18next";

/* ─── AI Stem Splitter ────────────────────────────────────────────────────
   Real 4-stem Demucs separation: upload any song, get back isolated
   vocals, drums, bass, and melody/other as WAVs. Per-stem solo/mute
   playback, individual downloads, and a remix mode that rebalances the
   four stems into a custom mix. 4 credits per split (Demucs on CPU is
   our heaviest job); the remix itself is free — those stems are already
   paid for. Failed jobs refund automatically. Server-owned background
   job: safe to close the tab while it runs. */

const CREDIT_COST = 4;
const MAX_BYTES = 25 * 1024 * 1024;

type StemKey = "vocals" | "drums" | "bass" | "other";

/* Stem display strings are resolved via t() inside the component (below);
   keys stay stable because stem keys drive playback/download logic. */
const STEM_DEFS: Array<{ key: StemKey; labelKey: string; blurbKey: string; accent: string }> = [
  { key: "vocals", labelKey: "stemVocals", blurbKey: "stemVocalsBlurb", accent: "text-amber-300" },
  { key: "drums", labelKey: "stemDrums", blurbKey: "stemDrumsBlurb", accent: "text-red-300" },
  { key: "bass", labelKey: "stemBass", blurbKey: "stemBassBlurb", accent: "text-emerald-300" },
  { key: "other", labelKey: "stemOther", blurbKey: "stemOtherBlurb", accent: "text-sky-300" },
];

type JobStatus = "idle" | "uploading" | "queued" | "processing" | "done" | "failed";

interface StemJobResponse {
  jobId?: string;
  status?: string;
  stems?: Record<StemKey, string> | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

export default function StemSplitter() {
  const { t } = useTranslation();
  /* Translated stem labels/blurbs for display; keys stay stable. */
  const stemsList = STEM_DEFS.map((s) => ({
    ...s,
    label: t(`stems.${s.labelKey}`),
    blurb: t(`stems.${s.blurbKey}`),
  }));
  const { user } = useAuth();
  const { addAsset } = useHubProject();
  const { confirmedFetch } = useConfirmedApi();
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [stems, setStems] = useState<Record<StemKey, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [sourceName, setSourceName] = useState<string>("");

  // Per-stem playback: one <audio> per stem, driven together.
  const audioRefs = useRef<Record<StemKey, HTMLAudioElement | null>>({
    vocals: null, drums: null, bass: null, other: null,
  });
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState<Record<StemKey, boolean>>({
    vocals: false, drums: false, bass: false, other: false,
  });
  const [solo, setSolo] = useState<StemKey | null>(null);
  const [progress, setProgress] = useState(0);

  // Remix mode.
  const [remixOpen, setRemixOpen] = useState(false);
  const [levels, setLevels] = useState<Record<StemKey, number>>({
    vocals: 1, drums: 1, bass: 1, other: 1,
  });
  const [remixing, setRemixing] = useState(false);
  const [remixUrl, setRemixUrl] = useState<string | null>(null);
  const [remixError, setRemixError] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Poll the server-owned job until it completes. */
  useEffect(() => {
    if (!jobId || (status !== "queued" && status !== "processing")) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/stems/${jobId}`);
        const data: StemJobResponse = await res.json();
        if (!res.ok) {
          setStatus("failed");
          setError(data.error || t("stems.errorJobNotFound"));
          return;
        }
        if (data.status === "done") {
          setStatus("done");
          setStems(data.stems ?? null);
          const stemUrls = data.stems;
          if (stemUrls) {
            addAsset({
              kind: "stems",
              url: stemUrls.vocals || stemUrls.drums || stemUrls.bass || stemUrls.other || "",
              label: t("stems.hubAssetLabel", { name: file?.name || t("stems.hubAssetDefaultName") }),
              detail: t("stems.hubAssetDetail"),
            });
          }
        } else if (data.status === "failed") {
          setStatus("failed");
          setError(data.error || t("stems.jobFailedRefund", { credits: CREDIT_COST * 100 }));
        } else {
          setStatus(data.status as JobStatus);
        }
      } catch {
        /* keep polling on transient network errors */
      }
    }, 4000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [jobId, status]);

  /* Keep the four stem players in sync while playing. */
  useEffect(() => {
    const tick = window.setInterval(() => {
      const a = audioRefs.current.vocals;
      if (a && a.duration > 0) setProgress(a.currentTime / a.duration);
    }, 250);
    return () => window.clearInterval(tick);
  }, [status]);

  function effectiveMuted(key: StemKey): boolean {
    if (solo) return key !== solo;
    return muted[key];
  }

  function syncPlayback(next: boolean) {
    const els = stemsList.map((s) => audioRefs.current[s.key]).filter(Boolean) as HTMLAudioElement[];
    if (next) {
      // Align all stems to the furthest-played position before starting.
      const latest = Math.max(...els.map((e) => e.currentTime));
      els.forEach((e) => {
        e.currentTime = latest;
        e.muted = effectiveMuted((e.dataset.stem as StemKey) ?? "vocals");
        void e.play().catch(() => {});
      });
    } else {
      els.forEach((e) => e.pause());
    }
    setPlaying(next);
  }

  function seekAll(ratio: number) {
    const els = stemsList.map((s) => audioRefs.current[s.key]).filter(Boolean) as HTMLAudioElement[];
    const dur = els[0]?.duration;
    if (!dur || !Number.isFinite(dur)) return;
    els.forEach((e) => { e.currentTime = ratio * dur; });
    setProgress(ratio);
  }

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("audio/")) {
      setError(t("stems.errorAudioFile"));
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(t("stems.errorFileTooLarge"));
      return;
    }
    setFile(f);
    setError(null);
    setStems(null);
    setJobId(null);
    setStatus("idle");
    setRemixUrl(null);
    setPlaying(false);
  }

  async function startSplit() {
    if (!file || !user) return;
    setStatus("uploading");
    setError(null);
    setOutOfCredits(false);
    try {
      const form = new FormData();
      form.append("audio", file);
      const res = await confirmedFetch("/api/stems", { method: "POST", body: form });
      if (!res) { setStatus("idle"); return; } // user cancelled the credit confirmation
      const data: StemJobResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || t("stems.errorStartSplit"));
        return;
      }
      setJobId(data.jobId);
      setStatus("queued");
      setSourceName(file.name);
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError(t("stems.errorNetwork"));
    }
  }

  async function exportRemix() {
    if (!jobId) return;
    setRemixing(true);
    setRemixError(null);
    setRemixUrl(null);
    try {
      const res = await fetch(`/api/stems/${jobId}/remix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ levels }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setRemixError(data.error || t("stems.errorRemix"));
        return;
      }
      setRemixUrl(data.url);
    } catch {
      setRemixError(t("stems.errorNetwork"));
    } finally {
      setRemixing(false);
    }
  }

  function reset() {
    syncPlayback(false);
    setFile(null);
    setJobId(null);
    setStatus("idle");
    setStems(null);
    setError(null);
    setOutOfCredits(false);
    setRemixUrl(null);
    setRemixOpen(false);
    setProgress(0);
    setSolo(null);
    setMuted({ vocals: false, drums: false, bass: false, other: false });
    setLevels({ vocals: 1, drums: 1, bass: 1, other: 1 });
  }

  const busy = status === "uploading" || status === "queued" || status === "processing";
  const levelPct = (v: number) => `${Math.round((v / 2) * 100)}%`;

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> {t("stems.back")}
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <AudioWaveform className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">{t("stems.pageTitle")}</h1>
            <p className="text-sm text-white/45">{t("stems.pageSubtitle", { cost: CREDIT_COST })}</p>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
          <p className="text-xs text-white/55 leading-relaxed">
            {t("stems.infoBox", { credits: CREDIT_COST * 100 })}
          </p>
        </div>

        {outOfCredits && (
          <div className="mt-4"><OutOfCredits /></div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-200/80">{error}</p>
          </div>
        )}

        <ProjectFlowBar
          kinds={["beat", "song"]}
          actionLabel={t("stems.flowBarAction")}
          onPick={async (asset) => {
            try {
              const res = await fetch(asset.url);
              const blob = await res.blob();
              const safeName = (asset.label || "audio").replace(/[^a-z0-9-_ ]/gi, "").slice(0, 40) || "audio";
              const ext = blob.type.includes("wav") ? "wav" : blob.type.includes("mpeg") ? "mp3" : "wav";
              pickFile(new File([blob], `${safeName}.${ext}`, { type: blob.type || "audio/wav" }));
            } catch {
              setError(t("stems.errorProjectAudio"));
            }
          }}
        />

        {/* Upload zone */}
        {(status === "idle" || status === "failed") && (
          <div className="mt-6 space-y-5">
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files[0]); }}
              className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
                dragOver ? "border-primary/60 bg-primary/5" : "border-white/[0.12] hover:border-white/25"
              }`}
            >
              <Upload className="h-8 w-8 text-white/30 mx-auto mb-3" />
              {file ? (
                <div>
                  <p className="font-semibold text-white">{file.name}</p>
                  <p className="text-xs text-white/40 mt-1">{t("stems.fileSelected", { mb: (file.size / 1024 / 1024).toFixed(1) })}</p>
                </div>
              ) : (
                <div>
                  <p className="font-semibold text-white/70">{t("stems.dropHint")}</p>
                  <p className="text-xs text-white/35 mt-1">{t("stems.dropFormats")}</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </div>

            <button
              onClick={startSplit}
              disabled={!file || !user}
              className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("stems.splitButton", { cost: CREDIT_COST })}
            </button>
            {creditsRemaining != null && (
              <p className="text-center text-xs text-white/35">{t("stems.creditsRemaining", { count: creditsRemaining })}</p>
            )}
          </div>
        )}

        {/* Progress */}
        {busy && (
          <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
            <p className="font-bold text-white">
              {status === "uploading" ? t("stems.statusUploading") : status === "queued" ? t("stems.statusQueued") : t("stems.statusProcessing")}
            </p>
            <p className="text-sm text-white/40 mt-1">
              {t("stems.progressHint")}
            </p>
            {sourceName && <p className="text-xs text-white/30 mt-2">{sourceName}</p>}
          </div>
        )}

        {/* Result — per-stem player */}
        {status === "done" && stems && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
              <p className="text-sm font-semibold text-white/80">{t("stems.splitComplete")}</p>
            </div>

            {/* Master transport */}
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-4">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => syncPlayback(!playing)}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-black transition hover:brightness-110"
                  title={playing ? t("stems.pauseAll") : t("stems.playAll")}
                >
                  {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
                </button>
                <div className="flex-1">
                  <div
                    className="relative h-2.5 cursor-pointer rounded-full bg-white/[0.08]"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      seekAll((e.clientX - r.left) / r.width);
                    }}
                  >
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary/70 to-primary"
                      style={{ width: `${Math.min(100, progress * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-white/35">
                    {solo ? t("stems.soloing", { label: stemsList.find((s) => s.key === solo)?.label }) : t("stems.allStems")} ·{" "}
                    {t("stems.seekHint")}
                  </p>
                </div>
              </div>
            </div>

            {/* Stem cards */}
            <div className="grid gap-3 sm:grid-cols-2">
              {stemsList.map((s) => (
                <div key={s.key} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className={`font-bold ${s.accent}`}>{s.label}</p>
                      <p className="text-[11px] text-white/35">{s.blurb}</p>
                    </div>
                    <a
                      href={stems[s.key]}
                      download={`${s.key}.wav`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] px-2.5 py-1.5 text-xs font-semibold text-white/60 hover:border-white/25 hover:text-white transition"
                      title={t("stems.downloadWav", { label: s.label })}
                    >
                      <Download className="h-3.5 w-3.5" /> {t("stems.wav")}
                    </a>
                  </div>
                  <audio
                    ref={(el) => { audioRefs.current[s.key] = el; }}
                    data-stem={s.key}
                    src={stems[s.key]}
                    preload="auto"
                    onEnded={() => setPlaying(false)}
                  />
                  <div data-min-stars="3" className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...muted, [s.key]: !muted[s.key] };
                        setMuted(next);
                        const el = audioRefs.current[s.key];
                        if (el) el.muted = solo ? s.key !== solo : next[s.key];
                      }}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-semibold transition ${
                        muted[s.key] && !solo
                          ? "border-red-500/40 bg-red-500/10 text-red-300"
                          : "border-white/[0.08] text-white/50 hover:border-white/20 hover:text-white/80"
                      }`}
                      title={muted[s.key] ? t("stems.unmute", { label: s.label }) : t("stems.mute", { label: s.label })}
                    >
                      {muted[s.key] && !solo ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                      {muted[s.key] && !solo ? t("stems.muted") : t("stems.muteButton")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const nextSolo = solo === s.key ? null : s.key;
                        setSolo(nextSolo);
                        stemsList.forEach((st) => {
                          const el = audioRefs.current[st.key];
                          if (el) el.muted = nextSolo ? st.key !== nextSolo : muted[st.key];
                        });
                      }}
                      className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-black tracking-wider transition ${
                        solo === s.key
                          ? "border-primary/60 bg-primary/15 text-primary"
                          : "border-white/[0.08] text-white/50 hover:border-white/20 hover:text-white/80"
                      }`}
                      title={solo === s.key ? t("stems.stopSoloing", { label: s.label }) : t("stems.solo", { label: s.label })}
                    >
                      {t("stems.soloButton")}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Remix mode */}
            <div data-min-stars="4" className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-4">
              <button
                type="button"
                onClick={() => setRemixOpen((v) => !v)}
                className="flex w-full items-center justify-between"
              >
                <span className="flex items-center gap-2 font-bold text-white">
                  <SlidersHorizontal className="h-4 w-4 text-primary" />
                  {t("stems.remixMode")}
                  <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-bold text-green-300">{t("stems.free")}</span>
                </span>
                <span className="text-xs text-white/40">{remixOpen ? t("stems.hide") : t("stems.show")}</span>
              </button>
              {remixOpen && (
                <div className="mt-4 space-y-3">
                  <p className="text-xs text-white/40">
                    {t("stems.remixHint")}
                  </p>
                  {stemsList.map((s) => (
                    <div key={s.key} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-xs font-semibold text-white/60">{s.label}</span>
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.05}
                        value={levels[s.key]}
                        onChange={(e) => setLevels({ ...levels, [s.key]: Number(e.target.value) })}
                        className="flex-1 accent-[#C9A84C]"
                      />
                      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-white/50">
                        {levelPct(levels[s.key])}
                      </span>
                    </div>
                  ))}
                  {remixError && (
                    <p className="text-xs text-red-300/80">{remixError}</p>
                  )}
                  <div className="flex gap-3 pt-1">
                    <button
                      type="button"
                      onClick={exportRemix}
                      disabled={remixing}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
                    >
                      {remixing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Music4 className="h-4 w-4" />}
                      {remixing ? t("stems.mixing") : t("stems.exportMix")}
                    </button>
                    {remixUrl && (
                      <a
                        href={remixUrl}
                        download="remix.wav"
                        className="inline-flex items-center gap-2 rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm font-bold text-green-300 transition hover:bg-green-500/20"
                      >
                        <Download className="h-4 w-4" /> {t("stems.downloadMix")}
                      </a>
                    )}
                  </div>
                  {remixUrl && (
                    <audio src={remixUrl} controls className="w-full" />
                  )}
                </div>
              )}
            </div>

            <button
              onClick={reset}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
            >
              <RefreshCw className="h-4 w-4" /> {t("stems.splitAnother")}
            </button>
          </div>
        )}
      </main>

    </div>
  );
}
