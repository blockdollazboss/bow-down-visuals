import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  Upload, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, AudioWaveform, Info, RefreshCw, Mic, Music4, Sparkles,
  Play, Pause, Volume2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useHubProject } from "@/lib/hub-project";
import { usePageTitle } from "@/hooks/use-page-title";
import { VocalPolishModal } from "@/components/song/VocalPolishModal";

/* ─── Audio Cleanup ───────────────────────────────────────────────────────
   Server-side background-noise removal for creator audio: podcasts,
   voiceovers, stream clips, live recordings. Real DSP denoising via
   ffmpeg (afftdn spectral denoiser + mode-specific chains) — 3 credits
   per cleanup, refunded automatically if the job fails. Server-owned
   background job: safe to close the tab while it runs. */

const CREDIT_COST = 3;
const MAX_BYTES = 50 * 1024 * 1024;

type ModeKey = "voice" | "music" | "denoise";

const MODES: Array<{ key: ModeKey; labelKey: string; blurbKey: string; icon: typeof Mic }> = [
  { key: "voice", labelKey: "audioCleanup.modeVoiceLabel", blurbKey: "audioCleanup.modeVoiceBlurb", icon: Mic },
  { key: "music", labelKey: "audioCleanup.modeMusicLabel", blurbKey: "audioCleanup.modeMusicBlurb", icon: Music4 },
  { key: "denoise", labelKey: "audioCleanup.modeDenoiseLabel", blurbKey: "audioCleanup.modeDenoiseBlurb", icon: Sparkles },
];

type JobStatus = "idle" | "uploading" | "queued" | "processing" | "done" | "failed";

interface CleanupJobResponse {
  jobId?: string;
  status?: string;
  outputUrl?: string | null;
  noiseReductionDb?: number | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

/** Decode audio and return per-bar peak amplitudes for a waveform. */
async function computePeaks(source: File | string, bars = 140): Promise<number[] | null> {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    let raw: ArrayBuffer;
    if (typeof source === "string") {
      const res = await fetch(source);
      if (!res.ok) throw new Error("fetch failed");
      raw = await res.arrayBuffer();
    } else {
      raw = await source.arrayBuffer();
    }
    const audio = await ctx.decodeAudioData(raw);
    const ch = audio.getChannelData(0);
    const block = Math.max(1, Math.floor(ch.length / bars));
    const peaks: number[] = [];
    for (let i = 0; i < bars; i++) {
      let max = 0;
      const start = i * block;
      for (let j = start; j < start + block && j < ch.length; j += 8) {
        const v = Math.abs(ch[j]);
        if (v > max) max = v;
      }
      peaks.push(Math.min(1, max));
    }
    await ctx.close().catch(() => {});
    return peaks;
  } catch {
    return null;
  }
}

function WaveformBars({ peaks, active, color }: { peaks: number[] | null; active: boolean; color: string }) {
  const { t } = useTranslation();
  if (!peaks) {
    return (
      <div className="flex h-16 items-center justify-center gap-1.5 text-xs text-white/30">
        <Volume2 className="h-4 w-4" /> {t("audioCleanup.waveformUnavailable")}
      </div>
    );
  }
  return (
    <div className="flex h-16 items-end gap-[2px]" aria-hidden>
      {peaks.map((p, i) => (
        <div
          key={i}
          className="flex-1 rounded-full transition-opacity"
          style={{
            height: `${Math.max(6, p * 100)}%`,
            background: color,
            opacity: active ? 0.95 : 0.35,
          }}
        />
      ))}
    </div>
  );
}

export default function AudioCleanup() {
  const { t } = useTranslation();
  const { addAsset } = useHubProject();
  usePageTitle(t("audioCleanup.pageTitle"), t("audioCleanup.pageSubtitle"));
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ModeKey>("voice");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [noiseReductionDb, setNoiseReductionDb] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [ab, setAb] = useState<"original" | "cleaned">("cleaned");
  const [playing, setPlaying] = useState(false);
  const [origPeaks, setOrigPeaks] = useState<number[] | null>(null);
  const [cleanPeaks, setCleanPeaks] = useState<number[] | null>(null);
  const [polishOpen, setPolishOpen] = useState(false);
  const [origUrl, setOrigUrl] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /* Poll the server-owned job until it completes. Tab-safe: the job
     lives on the server, so closing this page loses nothing. */
  useEffect(() => {
    if (!jobId || (status !== "queued" && status !== "processing")) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/audio-cleanup/${jobId}`);
        const data: CleanupJobResponse = await res.json();
        if (!res.ok) {
          setStatus("failed");
          setError(data.error || t("audioCleanup.errorJobNotFound"));
          return;
        }
        if (data.status === "done") {
          setStatus("done");
          setOutputUrl(data.outputUrl ?? null);
          /* The cleaned audio flows into the project for the next step. */
          if (data.outputUrl) {
            addAsset({ kind: "song", url: data.outputUrl, label: "Cleaned audio", detail: `Audio cleanup · ${mode}` });
          }
          setNoiseReductionDb(typeof data.noiseReductionDb === "number" ? data.noiseReductionDb : null);
        } else if (data.status === "failed") {
          setStatus("failed");
          setError(data.error || t("audioCleanup.errorCleanupFailed"));
        } else {
          setStatus(data.status as JobStatus);
        }
      } catch {
        /* keep polling on transient network errors */
      }
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [jobId, status]);

  /* Local preview URL for the original file (for A/B). */
  useEffect(() => {
    if (!file) {
      setOrigUrl(null);
      setOrigPeaks(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setOrigUrl(url);
    void computePeaks(file).then(setOrigPeaks);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /* Waveform for the cleaned result. */
  useEffect(() => {
    if (!outputUrl) {
      setCleanPeaks(null);
      return;
    }
    void computePeaks(outputUrl).then(setCleanPeaks);
  }, [outputUrl]);

  /* A/B toggle: swap source while preserving playback position. */
  function toggleAB(next: "original" | "cleaned") {
    const el = audioRef.current;
    if (!el) {
      setAb(next);
      return;
    }
    const t = el.currentTime;
    const wasPlaying = !el.paused;
    el.pause();
    setAb(next);
    // Let state flush before swapping src.
    window.setTimeout(() => {
      const target = next === "cleaned" ? outputUrl : origUrl;
      if (!target || !audioRef.current) return;
      audioRef.current.src = target;
      audioRef.current.currentTime = Math.min(t, audioRef.current.duration || t);
      if (wasPlaying) void audioRef.current.play().catch(() => {});
    }, 0);
  }

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  }

  function pickFile(f: File | undefined) {
    if (!f) return;
    const isAudio = f.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name);
    if (!isAudio) {
      setError(t("audioCleanup.errorAudioType"));
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(t("audioCleanup.errorFileTooLarge"));
      return;
    }
    setFile(f);
    setError(null);
    setOutputUrl(null);
    setJobId(null);
    setStatus("idle");
    setAb("cleaned");
    setNoiseReductionDb(null);
  }

  async function startCleanup() {
    if (!file || !user) return;
    setStatus("uploading");
    setError(null);
    setOutOfCredits(false);
    try {
      const form = new FormData();
      form.append("audio", file);
      form.append("mode", mode);
      const res = await confirmedFetch("/api/audio-cleanup", { method: "POST", body: form });
      if (!res) { setStatus("idle"); return; } // user cancelled the credit confirmation
      const data: CleanupJobResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || t("audioCleanup.errorStartFailed"));
        return;
      }
      setJobId(data.jobId);
      setStatus("queued");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError(t("audioCleanup.errorNetwork"));
    }
  }

  function reset() {
    setFile(null);
    setJobId(null);
    setStatus("idle");
    setOutputUrl(null);
    setError(null);
    setOutOfCredits(false);
    setAb("cleaned");
    setPlaying(false);
    setNoiseReductionDb(null);
    setPolishOpen(false);
  }

  const busy = status === "uploading" || status === "queued" || status === "processing";
  const modeEntry = MODES.find((m) => m.key === mode);
  const modeLabel = modeEntry ? t(modeEntry.labelKey) : mode;

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> {t("audioCleanup.back")}
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <AudioWaveform className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">{t("audioCleanup.title")}</h1>
            <p className="text-sm text-white/45">{t("audioCleanup.subtitle", { cost: CREDIT_COST })}</p>
          </div>
        </div>

        {/* Honest framing */}
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
          <p className="text-xs text-white/55 leading-relaxed">
            {t("audioCleanup.honestIntro")}{" "}
            <span className="text-white/80 font-semibold">{t("audioCleanup.honestStrong")}</span>
            {t("audioCleanup.honestRest")}
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

        {/* Upload + mode select */}
        {status === "idle" || status === "failed" ? (
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
                  <p className="text-xs text-white/40 mt-1">{t("audioCleanup.fileSizeChange", { size: (file.size / 1024 / 1024).toFixed(1) })}</p>
                </div>
              ) : (
                <div>
                  <p className="font-semibold text-white/70">{t("audioCleanup.dropPrompt")}</p>
                  <p className="text-xs text-white/35 mt-1">{t("audioCleanup.dropFormats")}</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </div>

            {/* Mode picker */}
            <div data-min-stars="2">
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">{t("audioCleanup.cleanupModeLabel")}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {MODES.map((m) => {
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setMode(m.key)}
                      className={`rounded-xl border px-4 py-3.5 text-left transition ${
                        mode === m.key
                          ? "border-primary/60 bg-primary/[0.08]"
                          : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                      }`}
                    >
                      <Icon className={`h-5 w-5 mb-2 ${mode === m.key ? "text-primary" : "text-white/40"}`} />
                      <p className="font-bold text-white text-sm">{t(m.labelKey)}</p>
                      <p className="text-xs text-white/40 mt-1 leading-relaxed">{t(m.blurbKey)}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={startCleanup}
              disabled={!file || !user}
              className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("audioCleanup.cleanupButton", { cost: CREDIT_COST })}
            </button>
            {creditsRemaining != null && (
              <p className="text-center text-xs text-white/35">{t("audioCleanup.creditsRemaining", { n: creditsRemaining })}</p>
            )}
          </div>
        ) : null}

        {/* Progress */}
        {busy && (
          <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
            <p className="font-bold text-white">
              {status === "uploading" ? t("audioCleanup.statusUploading") : status === "queued" ? t("audioCleanup.statusQueued") : t("audioCleanup.statusCleaning", { mode: modeLabel })}
            </p>
            <p className="text-sm text-white/40 mt-1">
              {t("audioCleanup.progressNote")}
            </p>
          </div>
        )}

        {/* Result: A/B player */}
        {status === "done" && outputUrl && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
              <p className="text-sm font-semibold text-white/80">
                {t("audioCleanup.cleanupComplete", { mode: modeLabel })}
                {noiseReductionDb != null && (
                  <span className="text-primary">{t("audioCleanup.noiseReduced", { db: noiseReductionDb })}</span>
                )}
              </p>
            </div>

            {/* A/B toggle */}
            <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
              {(["original", "cleaned"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  onClick={() => toggleAB(side)}
                  className={`flex-1 rounded-lg px-4 py-2 text-sm font-bold transition ${
                    ab === side ? "bg-primary text-black" : "text-white/50 hover:text-white/80"
                  }`}
                >
                  {side === "original" ? t("audioCleanup.abOriginal") : t("audioCleanup.abCleaned")}
                </button>
              ))}
            </div>

            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
              <div className="flex items-center gap-3 mb-3">
                <button
                  type="button"
                  onClick={togglePlay}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-black transition hover:brightness-110"
                  aria-label={playing ? t("audioCleanup.pause") : t("audioCleanup.play")}
                >
                  {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
                </button>
                <div className="flex-1">
                  <p className="text-xs font-bold text-white/50 uppercase tracking-wider mb-1">
                    {ab === "original" ? t("audioCleanup.labelOriginal") : t("audioCleanup.labelCleaned")}
                  </p>
                  <WaveformBars
                    peaks={ab === "original" ? origPeaks : cleanPeaks}
                    active={playing}
                    color={ab === "original" ? "#71717a" : "#d4af37"}
                  />
                </div>
              </div>
              <audio
                ref={audioRef}
                src={outputUrl}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                className="hidden"
              />
              <p className="text-xs text-white/35 text-center">
                {t("audioCleanup.abHint")}
              </p>
            </div>

            <div className="flex gap-3">
              <a
                href={outputUrl}
                download={`cleaned-${mode}.mp3`}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 font-bold text-black transition hover:brightness-110"
              >
                <Download className="h-4 w-4" /> {t("audioCleanup.downloadButton")}
              </a>
              <button
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
              >
                <RefreshCw className="h-4 w-4" /> {t("audioCleanup.newCleanupButton")}
              </button>
            </div>

            {/* Post-chain step: polish the cleaned vocal (tuning nudge + key/tempo). */}
            <button
              type="button"
              onClick={() => setPolishOpen(true)}
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-primary/40 bg-primary/[0.06] px-6 py-3.5 text-sm font-bold text-primary hover:bg-primary/10 transition-all"
            >
              <AudioWaveform className="h-4 w-4" />
              {t("vocalPolish.buttonLabel")} ({t("vocalPolish.buttonCost")})
            </button>
            <VocalPolishModal
              open={polishOpen}
              onClose={() => setPolishOpen(false)}
              source={{
                audioUrl: outputUrl,
                title: `${file?.name?.replace(/\.[^.]+$/, "") || "Audio"} — cleaned`,
              }}
            />
            {noiseReductionDb != null && (
              <p className="text-center text-[11px] text-white/30">
                {t("audioCleanup.noiseEstimateNote")}
              </p>
            )}
          </div>
        )}
      </main>

    </div>
  );
}
