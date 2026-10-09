import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  Upload, Loader2, Download, AlertTriangle, CheckCircle2, ArrowLeft,
  AudioWaveform, AudioLines, Info, RefreshCw, Mic, Music4, Sparkles,
  Play, Pause, Volume2, VolumeX, SlidersHorizontal, Mic2, MicOff,
  Music2, FileAudio, X, Gauge, Disc3,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useHubProject } from "@/lib/hub-project";
import { usePageTitle } from "@/hooks/use-page-title";
import { VocalPolishModal } from "@/components/song/VocalPolishModal";
import { ProjectFlowBar } from "@/components/hub/ProjectFlowBar";
import AiAudio from "@/pages/ai-audio";
import VoiceoverStudio from "@/pages/voiceover";
import PodcastStudio from "@/pages/podcast";
import ViralSoundFinder from "@/pages/sounds";
import { HumToSong } from "@/components/HumToSong";
import { FinishMySong } from "@/components/audio-studio/FinishMySong";
import { RateMyMix } from "@/components/audio-studio/RateMyMix";
/* ─── Audio Cleanup ───────────────────────────────────────────────────────
   Server-side background-noise removal for creator audio: podcasts,
   voiceovers, stream clips, live recordings. Real DSP denoising via
   ffmpeg (afftdn spectral denoiser + mode-specific chains) — 3 credits
   per cleanup, refunded automatically if the job fails. Server-owned
   background job: safe to close the tab while it runs. */

const CLEANUP_CREDIT_COST = 3;
const CLEANUP_MAX_BYTES = 50 * 1024 * 1024;

type CleanupModeKey = "voice" | "music" | "denoise";

const CLEANUP_MODES: Array<{ key: CleanupModeKey; labelKey: string; blurbKey: string; icon: typeof Mic }> = [
  { key: "voice", labelKey: "audioCleanup.modeVoiceLabel", blurbKey: "audioCleanup.modeVoiceBlurb", icon: Mic },
  { key: "music", labelKey: "audioCleanup.modeMusicLabel", blurbKey: "audioCleanup.modeMusicBlurb", icon: Music4 },
  { key: "denoise", labelKey: "audioCleanup.modeDenoiseLabel", blurbKey: "audioCleanup.modeDenoiseBlurb", icon: Sparkles },
];

type CleanupJobStatus = "idle" | "uploading" | "queued" | "processing" | "done" | "failed";

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

function CleanupPanel() {
  const { t } = useTranslation();
  const { addAsset } = useHubProject();
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<CleanupModeKey>("voice");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<CleanupJobStatus>("idle");
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
          setStatus(data.status as CleanupJobStatus);
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
    if (f.size > CLEANUP_MAX_BYTES) {
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
  const modeEntry = CLEANUP_MODES.find((m) => m.key === mode);
  const modeLabel = modeEntry ? t(modeEntry.labelKey) : mode;

  return (
    <>
        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <AudioWaveform className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-2xl font-black">{t("audioCleanup.title")}</h2>
            <p className="text-sm text-white/45">{t("audioCleanup.subtitle", { cost: CLEANUP_CREDIT_COST })}</p>
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
                {CLEANUP_MODES.map((m) => {
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
              {t("audioCleanup.cleanupButton", { cost: CLEANUP_CREDIT_COST })}
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
    </>
  );
}

/* ─── AI Stem Splitter ────────────────────────────────────────────────────
   Real 4-stem Demucs separation: upload any song, get back isolated
   vocals, drums, bass, and melody/other as WAVs. Per-stem solo/mute
   playback, individual downloads, and a remix mode that rebalances the
   four stems into a custom mix. 4 credits per split (Demucs on CPU is
   our heaviest job); the remix itself is free — those stems are already
   paid for. Failed jobs refund automatically. Server-owned background
   job: safe to close the tab while it runs. */

const STEMS_CREDIT_COST = 4;
const STEMS_MAX_BYTES = 25 * 1024 * 1024;

type StemKey = "vocals" | "drums" | "bass" | "other";

/* Stem display strings are resolved via t() inside the component (below);
   keys stay stable because stem keys drive playback/download logic. */
const STEM_DEFS: Array<{ key: StemKey; labelKey: string; blurbKey: string; accent: string }> = [
  { key: "vocals", labelKey: "stemVocals", blurbKey: "stemVocalsBlurb", accent: "text-amber-300" },
  { key: "drums", labelKey: "stemDrums", blurbKey: "stemDrumsBlurb", accent: "text-red-300" },
  { key: "bass", labelKey: "stemBass", blurbKey: "stemBassBlurb", accent: "text-emerald-300" },
  { key: "other", labelKey: "stemOther", blurbKey: "stemOtherBlurb", accent: "text-sky-300" },
];

type StemsJobStatus = "idle" | "uploading" | "queued" | "processing" | "done" | "failed";

interface StemJobResponse {
  jobId?: string;
  status?: string;
  stems?: Record<StemKey, string> | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

/* ─── Vocals-only preset (merged from the AI Vocal Remover page) ───────
   Upload any song → true Demucs stem separation → instrumental MP3 +
   acapella MP3. Key and tempo are preserved (separation reassigns
   time-frequency bins; nothing is time-stretched or pitch-shifted).
   Optional karaoke mode adds Whisper word-timing lyrics synced to the
   instrumental. 3 credits per song (POST /api/vocal-removal; registry
   key "/api/vocal-removal"), refunded automatically if the job fails.
   Server-owned background job: safe to close the tab while it runs.
   All identifiers are Vocal-prefixed to avoid collisions with the
   full-split flow's StemsJobStatus. */

const VOCAL_CREDIT_COST = 3;
const VOCAL_MAX_MB = 25;

type VocalJobStatus = "idle" | "uploading" | "queued" | "processing" | "done" | "failed";

interface VocalKaraokeWord {
  word: string;
  start: number;
  end: number;
}

interface VocalJobResponse {
  jobId?: string;
  status?: string;
  instrumentalUrl?: string | null;
  acapellaUrl?: string | null;
  karaokeUrl?: string | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

function VocalOnlyPreset() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { addAsset } = useHubProject();
  const { confirmedFetch } = useConfirmedApi();
  const [file, setFile] = useState<File | null>(null);
  const [karaoke, setKaraoke] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<VocalJobStatus>("idle");
  const [instrumentalUrl, setInstrumentalUrl] = useState<string | null>(null);
  const [acapellaUrl, setAcapellaUrl] = useState<string | null>(null);
  const [words, setWords] = useState<VocalKaraokeWord[] | null>(null);
  const [karaokeMissing, setKaraokeMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [karaokePlaying, setKaraokePlaying] = useState(false);
  const [karaokeTime, setKaraokeTime] = useState(0);
  const pollRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const karaokeAudioRef = useRef<HTMLAudioElement | null>(null);

  /* Poll the server-owned job until it completes. Tab-safe: the job
     lives on the server, so closing this page loses nothing. */
  useEffect(() => {
    if (!jobId || (status !== "queued" && status !== "processing")) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/vocal-removal/${jobId}`);
        const data: VocalJobResponse = await res.json();
        if (!res.ok) {
          setStatus("failed");
          setError(data.error || t("vocalRemoval.jobNotFound"));
          return;
        }
        if (data.status === "done") {
          setStatus("done");
          setInstrumentalUrl(data.instrumentalUrl ?? null);
          setAcapellaUrl(data.acapellaUrl ?? null);
          /* The instrumental flows into the project — mastering, mix and the hub rail can pick it up. */
          if (data.instrumentalUrl) {
            addAsset({ kind: "song", url: data.instrumentalUrl, label: "Instrumental", detail: "Vocal removal" });
          }
          if (data.karaokeUrl) {
            try {
              const kr = await fetch(data.karaokeUrl);
              const kj = (await kr.json()) as { words?: VocalKaraokeWord[] };
              if (Array.isArray(kj.words) && kj.words.length > 0) {
                setWords(kj.words);
              } else {
                setKaraokeMissing(true);
              }
            } catch {
              setKaraokeMissing(true);
            }
          } else if (karaoke) {
            setKaraokeMissing(true);
          }
        } else if (data.status === "failed") {
          setStatus("failed");
          setError(data.error || t("vocalRemoval.removalFailedRefunded", { bucs: VOCAL_CREDIT_COST * 100 }));
        } else {
          setStatus(data.status as VocalJobStatus);
        }
      } catch {
        /* keep polling on transient network errors */
      }
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [jobId, status, karaoke]);

  /* Karaoke clock: highlight the word under the playhead. */
  useEffect(() => {
    const audio = karaokeAudioRef.current;
    if (!audio || !karaokePlaying) return;
    const onTime = () => setKaraokeTime(audio.currentTime);
    const onEnd = () => setKaraokePlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
    };
  }, [karaokePlaying, instrumentalUrl]);

  function pickFile(f: File | undefined) {
    if (!f) return;
    const isAudio = f.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(f.name);
    if (!isAudio) {
      setError(t("vocalRemoval.audioFileError"));
      return;
    }
    if (f.size > VOCAL_MAX_MB * 1024 * 1024) {
      setError(t("vocalRemoval.audioSizeError", { max: VOCAL_MAX_MB }));
      return;
    }
    setFile(f);
    setError(null);
    resetResults();
  }

  function resetResults() {
    setJobId(null);
    setStatus("idle");
    setInstrumentalUrl(null);
    setAcapellaUrl(null);
    setWords(null);
    setKaraokeMissing(false);
    setKaraokePlaying(false);
    setKaraokeTime(0);
  }

  async function startRemoval() {
    if (!file || !user) return;
    setStatus("uploading");
    setError(null);
    setOutOfCredits(false);
    try {
      const form = new FormData();
      form.append("audio", file);
      form.append("karaoke", String(karaoke));
      const res = await confirmedFetch("/api/vocal-removal", { method: "POST", body: form });
      if (!res) { setStatus("idle"); return; } // user cancelled the credit confirmation
      const data: VocalJobResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || t("vocalRemoval.startFailedError"));
        return;
      }
      setJobId(data.jobId);
      setStatus("queued");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError(t("vocalRemoval.networkError"));
    }
  }

  function reset() {
    setFile(null);
    resetResults();
    setError(null);
    setOutOfCredits(false);
  }

  function toggleKaraokePlay() {
    const audio = karaokeAudioRef.current;
    if (!audio || !instrumentalUrl) return;
    if (karaokePlaying) {
      audio.pause();
      setKaraokePlaying(false);
    } else {
      void audio.play();
      setKaraokePlaying(true);
    }
  }

  const busy = status === "uploading" || status === "queued" || status === "processing";
  const activeWordIndex = words
    ? words.findIndex((w, i) => {
        const next = words[i + 1];
        return karaokeTime >= w.start && (next ? karaokeTime < next.start : karaokeTime <= w.end + 0.5);
      })
    : -1;

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Mic2 className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-black">{t("vocalRemoval.pageTitle")}</h1>
          <p className="text-sm text-white/45">{t("vocalRemoval.pageSub", { cost: VOCAL_CREDIT_COST })}</p>
        </div>
      </div>

      {/* Honest framing — true separation, limits stated up front */}
      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
        <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
        <p className="text-xs text-white/55 leading-relaxed">
          {t("vocalRemoval.honestFraming1")}{" "}
          <span className="text-white/80 font-semibold">{t("vocalRemoval.honestFramingStrong")}</span>{" "}
          {t("vocalRemoval.honestFraming2")}
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
                <p className="text-xs text-white/40 mt-1">{t("vocalRemoval.fileChosen", { size: (file.size / 1024 / 1024).toFixed(1) })}</p>
              </div>
            ) : (
              <div>
                <p className="font-semibold text-white/70">{t("vocalRemoval.dropPrompt")}</p>
                <p className="text-xs text-white/35 mt-1">{t("vocalRemoval.dropHint", { max: VOCAL_MAX_MB })}</p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </div>

          {/* Karaoke toggle */}
          <label data-min-stars="3" className="flex items-start gap-3 cursor-pointer rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3.5">
            <input
              type="checkbox"
              checked={karaoke}
              onChange={(e) => setKaraoke(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[#C9A84C]"
            />
            <span>
              <span className="block font-bold text-white text-sm">{t("vocalRemoval.karaokeMode")}</span>
              <span className="block text-xs text-white/40 mt-0.5">
                {t("vocalRemoval.karaokeModeDesc")}
              </span>
            </span>
          </label>

          <button
            onClick={startRemoval}
            disabled={!file || !user}
            className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("vocalRemoval.removeButton", { cost: VOCAL_CREDIT_COST })}
          </button>
          {creditsRemaining != null && (
            <p className="text-center text-xs text-white/35">{t("vocalRemoval.creditsRemaining", { count: creditsRemaining })}</p>
          )}
        </div>
      ) : null}

      {/* Progress */}
      {busy && (
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
          <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
          <p className="font-bold text-white">
            {status === "uploading" ? t("vocalRemoval.statusUploading") : status === "queued" ? t("vocalRemoval.statusQueued") : t("vocalRemoval.statusProcessing")}
          </p>
          <p className="text-sm text-white/40 mt-1">
            {t("vocalRemoval.progressNote")}
          </p>
        </div>
      )}

      {/* Result */}
      {status === "done" && instrumentalUrl && acapellaUrl && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
            <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
            <p className="text-sm font-semibold text-white/80">{t("vocalRemoval.resultReady")}</p>
          </div>

          {/* Instrumental */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-4">
            <div className="flex items-center gap-2.5 mb-3">
              <Music2 className="h-4 w-4 text-primary" />
              <p className="font-bold text-white text-sm">{t("vocalRemoval.instrumental")}</p>
              <span className="text-[10px] uppercase tracking-wider text-white/30">{t("vocalRemoval.karaokeReady")}</span>
            </div>
            <audio src={instrumentalUrl} controls className="w-full" />
            <a
              href={instrumentalUrl}
              download="instrumental.mp3"
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
            >
              <Download className="h-4 w-4" /> {t("vocalRemoval.downloadInstrumental")}
            </a>
          </div>

          {/* Acapella */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-4">
            <div className="flex items-center gap-2.5 mb-3">
              <AudioLines className="h-4 w-4 text-primary" />
              <p className="font-bold text-white text-sm">{t("vocalRemoval.acapella")}</p>
              <span className="text-[10px] uppercase tracking-wider text-white/30">{t("vocalRemoval.isolatedVocals")}</span>
            </div>
            <audio src={acapellaUrl} controls className="w-full" />
            <a
              href={acapellaUrl}
              download="acapella.mp3"
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-white/[0.12] px-5 py-2.5 text-sm font-semibold text-white/70 hover:border-white/25 transition"
            >
              <Download className="h-4 w-4" /> {t("vocalRemoval.downloadAcapella")}
            </a>
          </div>

          {/* Karaoke player */}
          {words && words.length > 0 && (
            <div className="rounded-2xl border border-primary/25 bg-primary/[0.04] px-5 py-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <MicOff className="h-4 w-4 text-primary" />
                  <p className="font-bold text-white text-sm">{t("vocalRemoval.karaokeMode")}</p>
                </div>
                <button
                  onClick={toggleKaraokePlay}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
                >
                  {karaokePlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {karaokePlaying ? t("vocalRemoval.pause") : t("vocalRemoval.singAlong")}
                </button>
              </div>
              <audio ref={karaokeAudioRef} src={instrumentalUrl} className="hidden" />
              <div className="max-h-64 overflow-y-auto rounded-xl bg-black/40 px-4 py-4 leading-loose">
                <p className="text-lg">
                  {words.map((w, i) => (
                    <span
                      key={i}
                      className={`transition-colors duration-150 ${
                        i === activeWordIndex
                          ? "text-primary font-black"
                          : i < activeWordIndex
                            ? "text-white/35"
                            : "text-white/75"
                      }`}
                    >
                      {w.word}{" "}
                    </span>
                  ))}
                </p>
              </div>
              <p className="mt-2 text-xs text-white/35">
                {t("vocalRemoval.lyricsNote")}
              </p>
            </div>
          )}
          {karaokeMissing && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200/70">
                {t("vocalRemoval.karaokeMissing")}
              </p>
            </div>
          )}

          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
          >
            <RefreshCw className="h-4 w-4" /> {t("vocalRemoval.newSong")}
          </button>
        </div>
      )}
    </div>
  );
}

function StemsPanel() {
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
  const [status, setStatus] = useState<StemsJobStatus>("idle");
  const [stems, setStems] = useState<Record<StemKey, string> | null>(null);
  /* Mode: full 4-stem split vs the merged vocals-only preset. */
  const [stemMode, setStemMode] = useState<"full" | "vocals">("full");

  /* Deep-link: /stems?mode=vocals opens the vocals-only preset. */
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("mode") === "vocals") {
        setStemMode("vocals");
      }
    } catch {
      /* non-browser or malformed URL — ignore */
    }
  }, []);
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
  const [polishOpen, setPolishOpen] = useState(false);

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
          setError(data.error || t("stems.jobFailedRefund", { credits: STEMS_CREDIT_COST * 100 }));
        } else {
          setStatus(data.status as StemsJobStatus);
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
    if (f.size > STEMS_MAX_BYTES) {
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

  /* Deep-link protocol: /stems?audioUrl=… pre-loads audio (e.g. a beat from
     beat-maker) via the same fetch→File path as the project flow bar. */
  useEffect(() => {
    try {
      const audioUrl = new URLSearchParams(window.location.search).get("audioUrl");
      if (!audioUrl || file) return;
      (async () => {
        try {
          const res = await fetch(audioUrl);
          const blob = await res.blob();
          const ext = blob.type.includes("wav") ? "wav" : blob.type.includes("mpeg") ? "mp3" : "wav";
          pickFile(new File([blob], `audio.${ext}`, { type: blob.type || "audio/wav" }));
          window.history.replaceState(null, "", window.location.pathname);
        } catch {
          setError(t("stems.errorProjectAudio"));
        }
      })();
    } catch {
      /* non-browser or malformed URL — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <>
        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <AudioWaveform className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-2xl font-black">{t("stems.pageTitle")}</h2>
            <p className="text-sm text-white/45">{t("stems.pageSubtitle", { cost: STEMS_CREDIT_COST })}</p>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
          <p className="text-xs text-white/55 leading-relaxed">
            {t("stems.infoBox", { credits: STEMS_CREDIT_COST * 100 })}
          </p>
        </div>

        {/* Mode toggle: full 4-stem split vs vocals-only preset */}
        <div className="mt-6 flex justify-center">
          <div className="inline-flex rounded-2xl border border-white/10 bg-white/[0.03] p-1.5" role="tablist" aria-label={t("stems.modeLabel", { defaultValue: "Separation mode" })}>
            <button
              role="tab"
              aria-selected={stemMode === "full"}
              onClick={() => setStemMode("full")}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                stemMode === "full" ? "bg-primary text-black" : "text-white/55 hover:text-white"
              }`}
            >
              <AudioWaveform className="h-4 w-4" />
              {t("stems.modeFull", { defaultValue: "Full split · 4cr" })}
            </button>
            <button
              role="tab"
              aria-selected={stemMode === "vocals"}
              onClick={() => setStemMode("vocals")}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                stemMode === "vocals" ? "bg-primary text-black" : "text-white/55 hover:text-white"
              }`}
            >
              <Mic2 className="h-4 w-4" />
              {t("stems.modeVocalsOnly", { defaultValue: "Vocals only · 3cr" })}
            </button>
          </div>
        </div>

        {stemMode === "vocals" ? (
          <VocalOnlyPreset />
        ) : (
        <>
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
              {t("stems.splitButton", { cost: STEMS_CREDIT_COST })}
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

            {/* Post-chain step: polish the isolated vocal stem. */}
            {stems.vocals && (
              <>
                <button
                  type="button"
                  onClick={() => setPolishOpen(true)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/[0.06] px-4 py-3 text-sm font-bold text-primary hover:bg-primary/10 transition-all"
                >
                  <AudioWaveform className="h-4 w-4" />
                  {t("vocalPolish.buttonLabel")} ({t("vocalPolish.buttonCost")})
                </button>
                <VocalPolishModal
                  open={polishOpen}
                  onClose={() => setPolishOpen(false)}
                  source={{
                    audioUrl: stems.vocals,
                    title: `${sourceName || t("stems.hubAssetDefaultName")} — vocals`,
                  }}
                />
              </>
            )}

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
        </>
        )}
    </>
  );
}

/* ─── AI Mix & Master ───────────────────────────────────────────────────
   The flagship audio service: upload a finished mix and get back a
   radio-ready master (AI Master), or upload up to 12 stems and get a
   full genre-aware mixdown + master (AI Mix).

   Real DSP on the server (ffmpeg): per-stem gain staging / EQ /
   compression / panning → amix bus → subsonic cleanup → glue
   compression → genre sweetening EQ → stereo widening → two-pass
   EBU R128 loudness normalization with true-peak limiting.
   8 credits per master, 15 per stem mix — refunded if the job fails.
   Server-owned background jobs: safe to close the tab while it runs.
   Honest copy: this polishes and assembles — it can't fix a bad
   recording, out-of-tune vocals, or clipping stems. */

const MASTER_CREDIT_COST = 8;
const MIX_CREDIT_COST = 15;
const MASTER_MAX_FILE_BYTES = 100 * 1024 * 1024;
const MASTER_MAX_STEMS = 12;
const MASTER_AUDIO_ACCEPT = "audio/*,.wav,.mp3,.aiff,.aif,.flac,.m4a,.ogg";

type MasterGenreKey = "hip-hop" | "pop" | "rnb" | "edm" | "rock" | "lofi" | "afrobeat" | "gospel";
type MasterIntensityKey = "subtle" | "balanced" | "aggressive";
type MasterLoudnessKey = "streaming" | "club" | "radio";
type MasterStemType = "vocals" | "drums" | "bass" | "keys" | "guitar" | "strings" | "fx" | "beat" | "other";
type MasterJobStatus = "idle" | "uploading" | "queued" | "processing" | "done" | "failed";

const MASTER_GENRES: Array<{ key: MasterGenreKey }> = [
  { key: "hip-hop" }, { key: "pop" }, { key: "rnb" }, { key: "edm" },
  { key: "rock" }, { key: "lofi" }, { key: "afrobeat" }, { key: "gospel" },
];

const MASTER_INTENSITIES: Array<{ key: MasterIntensityKey }> = [
  { key: "subtle" }, { key: "balanced" }, { key: "aggressive" },
];

const MASTER_LOUDNESS: Array<{ key: MasterLoudnessKey; spec: string }> = [
  { key: "streaming", spec: "-14 LUFS · -1.0 dBTP" },
  { key: "club", spec: "-9 LUFS · -1.0 dBTP" },
  { key: "radio", spec: "-11 LUFS · -1.0 dBTP" },
];

const MASTER_STEM_TYPE_META: Record<MasterStemType, { label: string; chip: string }> = {
  vocals: { label: "Vocals", chip: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30" },
  drums: { label: "Drums", chip: "bg-red-500/15 text-red-300 border-red-500/30" },
  bass: { label: "Bass", chip: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  keys: { label: "Keys", chip: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  guitar: { label: "Guitar", chip: "bg-orange-500/15 text-orange-300 border-orange-500/30" },
  strings: { label: "Strings", chip: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
  fx: { label: "FX", chip: "bg-teal-500/15 text-teal-300 border-teal-500/30" },
  beat: { label: "Beat", chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  other: { label: "Stem", chip: "bg-white/10 text-white/60 border-white/20" },
};

/** Client-side mirror of the server's filename → stem-type detection (instant UI feedback). */
function detectStemTypeClient(filename: string): MasterStemType {
  const name = (filename || "").toLowerCase();
  const patterns: Array<[MasterStemType, RegExp]> = [
    ["vocals", /(voc|vox|vocal|acapella|a cappella|lead|hook|chorus|verse|adlib|ad-lib|bgv|choir)/],
    ["drums", /(drum|perc|kick|snare|hat|clap|tom|cymbal|shaker|conga|bongo|djembe)/],
    ["bass", /(bass|808|sub|lowend|low[ -]?end)/],
    ["keys", /(key|piano|synth|pad|arp|organ|rhodes|epiano|midi|pluck|bell)/],
    ["guitar", /(guit|gtr|strum|acoustic|electric)/],
    ["strings", /(string|violin|viola|cello|orchestra|ensemble)/],
    ["fx", /(fx|sfx|riser|sweep|impact|transition|earcandy|ear candy|texture|ambien)/],
    ["beat", /(beat|instrumental|backing|track|music|playback|karaoke)/],
  ];
  for (const [type, re] of patterns) if (re.test(name)) return type;
  return "other";
}

interface MasterReport {
  inputLufs: number | null;
  inputTruePeak: number | null;
  inputLra: number | null;
  targetLufs: number | null;
  targetTruePeak: number | null;
  referenceLufs: number | null;
  outputLufs: number | null;
  outputTruePeak: number | null;
}

interface MasterJobResponse {
  jobId?: string;
  status?: string;
  kind?: string;
  genre?: string;
  stemTypes?: MasterStemType[];
  stats?: MasterReport;
  wavUrl?: string | null;
  mp3Url?: string | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
  creditsCharged?: number;
}

function fmtLufs(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)} LUFS` : "—";
}
function fmtDb(v: number | null | undefined, suffix = "dBTP"): string {
  return typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)} ${suffix}` : "—";
}
function isAudioFile(f: File): boolean {
  return f.type.startsWith("audio/") || /\.(wav|mp3|aiff|aif|flac|m4a|ogg)$/i.test(f.name);
}

/* ── Shared pickers ─────────────────────────────────────────────────── */

function GenreGrid({ value, onChange }: { value: MasterGenreKey; onChange: (g: MasterGenreKey) => void }) {
  const { t } = useTranslation();
  return (
    <div data-min-stars="2">
      <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">{t("mixMaster.genreLabel")}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {MASTER_GENRES.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => onChange(g.key)}
            className={`rounded-xl border px-3 py-2.5 text-left transition ${
              value === g.key
                ? "border-[#C9A84C]/60 bg-[#C9A84C]/10"
                : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
            }`}
          >
            <p className={`font-bold text-sm ${value === g.key ? "text-[#f7dd7f]" : "text-white/80"}`}>{t(`mixMaster.genres.${g.key}.label`)}</p>
            <p className="text-[11px] text-white/40 mt-0.5 leading-snug">{t(`mixMaster.genres.${g.key}.blurb`)}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function IntensityPicker({ value, onChange }: { value: MasterIntensityKey; onChange: (v: MasterIntensityKey) => void }) {
  const { t } = useTranslation();
  return (
    <div data-min-stars="3">
      <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">{t("mixMaster.intensityLabel")}</p>
      <div className="grid grid-cols-3 gap-2.5">
        {MASTER_INTENSITIES.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`rounded-xl border px-3 py-2.5 text-left transition ${
              value === opt.key
                ? "border-[#C9A84C]/60 bg-[#C9A84C]/10"
                : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
            }`}
          >
            <p className={`font-bold text-sm ${value === opt.key ? "text-[#f7dd7f]" : "text-white/80"}`}>{t(`mixMaster.intensities.${opt.key}.label`)}</p>
            <p className="text-[11px] text-white/40 mt-0.5 leading-snug">{t(`mixMaster.intensities.${opt.key}.blurb`)}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function LoudnessPicker({ value, onChange }: { value: MasterLoudnessKey; onChange: (v: MasterLoudnessKey) => void }) {
  const { t } = useTranslation();
  return (
    <div data-min-stars="5">
      <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">{t("mixMaster.loudnessLabel")}</p>
      <div className="grid grid-cols-3 gap-2.5">
        {MASTER_LOUDNESS.map((loud) => (
          <button
            key={loud.key}
            type="button"
            onClick={() => onChange(loud.key)}
            className={`rounded-xl border px-3 py-2.5 text-left transition ${
              value === loud.key
                ? "border-[#C9A84C]/60 bg-[#C9A84C]/10"
                : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
            }`}
          >
            <p className={`font-bold text-sm ${value === loud.key ? "text-[#f7dd7f]" : "text-white/80"}`}>{t(`mixMaster.loudness.${loud.key}.label`)}</p>
            <p className="text-[11px] text-white/40 mt-0.5 leading-snug">{t(`mixMaster.loudness.${loud.key}.blurb`)}</p>
            <p className="text-[10px] text-white/30 mt-1 font-mono">{loud.spec}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function ReferenceUpload({
  file, onPick, onClear,
}: { file: File | null; onPick: (f: File) => void; onClear: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div data-min-stars="5">
      <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">
        {t("mixMaster.referenceTrack")} <span className="text-white/25 normal-case font-medium">(optional — match its loudness)</span>
      </p>
      {file ? (
        <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-2.5">
          <span className="text-sm text-white/70 truncate">{file.name}</span>
          <button type="button" onClick={onClear} className="text-white/40 hover:text-white/80 transition shrink-0 ml-3">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className="w-full rounded-xl border border-dashed border-white/[0.12] px-4 py-3 text-sm text-white/40 hover:text-white/70 hover:border-white/25 transition"
        >
          <Disc3 className="h-4 w-4 inline mr-2 -mt-0.5" />
          {t("mixMaster.referenceHint")}
        </button>
      )}
      <input
        ref={ref}
        type="file"
        accept={MASTER_AUDIO_ACCEPT}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f && isAudioFile(f)) onPick(f); e.target.value = ""; }}
      />
    </div>
  );
}

/* ── Shared result: loudness-matched A/B player + Master Report ────── */

function JobResult({
  data, beforeUrl, kindLabel, onReset,
}: {
  data: MasterJobResponse;
  beforeUrl: string | null;
  kindLabel: string;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const { addAsset } = useHubProject();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [abSide, setAbSide] = useState<"before" | "after">("after");
  const [playing, setPlaying] = useState(false);
  const [loudnessMatch, setLoudnessMatch] = useState(true);
  const stats = data.stats ?? null;
  const mp3Url = data.mp3Url ?? null;
  const wavUrl = data.wavUrl ?? null;

  /* The finished master/mix flows into the project — distribute, video and the hub rail can pick it up. */
  const reportedRef = useRef<string | null>(null);
  useEffect(() => {
    const url = mp3Url || wavUrl;
    if (url && reportedRef.current !== url) {
      reportedRef.current = url;
      addAsset({ kind: "song", url, label: `${kindLabel} — master`, detail: "MixMaster output" });
    }
  }, [mp3Url, wavUrl, kindLabel, addAsset]);

  /* Loudness-matched A/B: attenuate the louder side via the volume
     property so the comparison is about tone, not level. Real, no Web Audio. */
  const inputLufs = stats?.inputLufs;
  const outputLufs = stats?.outputLufs;
  const gainBefore = typeof inputLufs === "number" && typeof outputLufs === "number"
    ? Math.min(1, Math.pow(10, (outputLufs - inputLufs) / 20)) : 1;
  const gainAfter = typeof inputLufs === "number" && typeof outputLufs === "number"
    ? Math.min(1, Math.pow(10, (inputLufs - outputLufs) / 20)) : 1;

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = !loudnessMatch ? 1 : abSide === "before" ? gainBefore : gainAfter;
  }, [abSide, loudnessMatch, gainBefore, gainAfter]);

  function flipSide(side: "before" | "after") {
    const el = audioRef.current;
    const t = el ? el.currentTime : 0;
    const wasPlaying = playing;
    setAbSide(side);
    requestAnimationFrame(() => {
      const next = audioRef.current;
      if (!next) return;
      next.currentTime = t;
      if (wasPlaying) void next.play().catch(() => {});
    });
  }

  const activeSrc = abSide === "before" ? beforeUrl : mp3Url;

  return (
    <div className="mt-6 space-y-5">
      <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
        <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
        <p className="text-sm text-emerald-200/80">{kindLabel} complete — compare it against the original below.</p>
      </div>

      {/* A/B player */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <p className="text-xs font-bold text-white/40 uppercase tracking-wider">{t("mixMaster.beforeAfter")}</p>
          <div className="flex items-center gap-3">
            <label data-min-stars="3" className="flex items-center gap-1.5 text-[11px] text-white/45 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={loudnessMatch}
                onChange={(e) => setLoudnessMatch(e.target.checked)}
                className="accent-[#C9A84C] h-3.5 w-3.5"
              />
              Loudness-matched
            </label>
            <div className="flex rounded-lg border border-white/[0.1] overflow-hidden">
              <button
                type="button"
                onClick={() => flipSide("before")}
                disabled={!beforeUrl}
                className={`px-4 py-1.5 text-xs font-bold transition disabled:opacity-30 ${
                  abSide === "before" ? "bg-white/[0.12] text-white" : "text-white/40 hover:text-white/70"
                }`}
              >
                {t("mixMaster.before")}
              </button>
              <button
                type="button"
                onClick={() => flipSide("after")}
                disabled={!mp3Url}
                className={`px-4 py-1.5 text-xs font-bold transition disabled:opacity-30 ${
                  abSide === "after" ? "bg-[#C9A84C]/25 text-[#f7dd7f]" : "text-white/40 hover:text-white/70"
                }`}
              >
                {t("mixMaster.after")}
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              const el = audioRef.current;
              if (!el) return;
              if (playing) el.pause();
              else void el.play().catch(() => {});
            }}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] text-black hover:brightness-110 transition"
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
          </button>
          <audio
            ref={audioRef}
            src={activeSrc ?? undefined}
            className="w-full accent-[#C9A84C]"
            controls
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        </div>
        <p className="text-[11px] text-white/30 mt-2">
          {t("mixMaster.listeningTo")} <span className="text-white/60 font-semibold">{abSide === "before" ? "your original" : "the processed version"}</span>
          {loudnessMatch && inputLufs != null && outputLufs != null && (
            <> — level-matched ({abSide === "before" ? `before at ${(20 * Math.log10(gainBefore)).toFixed(1)} dB` : `after at ${(20 * Math.log10(gainAfter)).toFixed(1)} dB`}) so you're judging tone, not volume</>
          )}
          {!loudnessMatch && <> — raw levels (the master is supposed to be louder)</>}.
          Position is preserved when you flip.
        </p>
      </div>

      {/* Master Report */}
      {stats && (
        <div data-min-stars="4" className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <div className="flex items-center gap-2 mb-3">
            <Gauge className="h-3.5 w-3.5 text-[#C9A84C]" />
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider">{t("mixMaster.masterReport")}</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Input loudness", value: fmtLufs(stats.inputLufs) },
              { label: "Output loudness", value: fmtLufs(stats.outputLufs ?? stats.targetLufs) },
              { label: "True peak in", value: fmtDb(stats.inputTruePeak) },
              { label: "True peak out", value: fmtDb(stats.outputTruePeak ?? stats.targetTruePeak) },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-black/40 border border-white/[0.06] px-3 py-2.5">
                <p className="text-[10px] text-white/35 uppercase tracking-wider">{s.label}</p>
                <p className="text-sm font-black text-[#f7dd7f] mt-1 font-mono">{s.value}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3">
            {typeof stats.inputLra === "number" && (
              <p className="text-[11px] text-white/30">
                {t("mixMaster.dynamicRange")}: <span className="text-white/55 font-mono">{stats.inputLra.toFixed(1)} LU</span>
              </p>
            )}
            {typeof stats.referenceLufs === "number" && (
              <p className="text-[11px] text-white/30">
                {t("mixMaster.referenceLoudness")}: <span className="text-white/55 font-mono">{fmtLufs(stats.referenceLufs)}</span> <span className="text-white/25">(used as target)</span>
              </p>
            )}
            {data.genre && (
              <p className="text-[11px] text-white/30">
                Chain: <span className="text-white/55 capitalize">{data.genre.replace("-", " ")}</span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Stem readout for mixes */}
      {data.stemTypes && data.stemTypes.length > 0 && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3">
            Stems detected — {data.stemTypes.length}
          </p>
          <div className="flex flex-wrap gap-2">
            {data.stemTypes.map((st, i) => (
              <span
                key={i}
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold ${MASTER_STEM_TYPE_META[st]?.chip ?? MASTER_STEM_TYPE_META.other.chip}`}
              >
                {t(`mixMaster.stemTypes.${st}`) ?? st}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Downloads */}
      <div className="grid grid-cols-2 gap-3">
        <a
          href={wavUrl ?? undefined}
          download
          className={`flex items-center justify-center gap-2 rounded-xl border border-[#C9A84C]/40 bg-[#C9A84C]/10 py-3 font-bold text-sm text-[#f7dd7f] hover:bg-[#C9A84C]/20 transition ${!wavUrl ? "pointer-events-none opacity-30" : ""}`}
        >
          <Download className="h-4 w-4" /> WAV (24-bit)
        </a>
        <a
          href={mp3Url ?? undefined}
          download
          className={`flex items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] py-3 font-bold text-sm text-white/80 hover:bg-white/[0.08] transition ${!mp3Url ? "pointer-events-none opacity-30" : ""}`}
        >
          <Download className="h-4 w-4" /> MP3 (320k)
        </a>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.1] py-3 text-sm font-bold text-white/50 hover:text-white/80 hover:bg-white/[0.04] transition"
      >
        <RefreshCw className="h-4 w-4" /> Start another
      </button>
    </div>
  );
}

/* ── AI Master panel ──────────────────────────────────────────────── */

/* ── AI Master panel ──────────────────────────────────────────────────── */

interface AdLibHandoff {
  take?: string;
  takeStyle?: string;
  takeNotes?: string;
  adlibs?: Array<{ line?: string; placement?: string; delivery?: string }>;
  stacks?: Array<{ description?: string; voices?: string }>;
  energy?: string;
  songTitle?: string;
  artistName?: string;
}

function MasterPanel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [file, setFile] = useState<File | null>(null);
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [reference, setReference] = useState<File | null>(null);
  const [genre, setGenre] = useState<MasterGenreKey>("hip-hop");
  const [intensity, setIntensity] = useState<MasterIntensityKey>("balanced");
  const [loudness, setLoudness] = useState<MasterLoudnessKey>("streaming");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<MasterJobStatus>("idle");
  const [result, setResult] = useState<MasterJobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /* Wave 8 Ad-Lib Generator handoff: the vocal ad-lib plan arrives here as
     direction notes for the mix/master session. One-shot: key removed on
     pickup; the card is dismissible. */
  const [adlibHandoff, setAdlibHandoff] = useState<AdLibHandoff | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("wave8_adlibs");
      if (!raw) return;
      localStorage.removeItem("wave8_adlibs");
      const h = JSON.parse(raw) as AdLibHandoff;
      if (!h || (typeof h.takeStyle !== "string" && !(h.adlibs ?? []).length)) return;
      setAdlibHandoff(h);
    } catch {
      /* malformed handoff — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Deep-link protocol: /mix-master?audioUrl=… pre-loads the master slot
     (e.g. a polished vocal handed off from AI Vocal Polish). */
  useEffect(() => {
    const audioUrl = new URLSearchParams(window.location.search).get("audioUrl");
    if (!audioUrl || file) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(audioUrl);
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        const name = decodeURIComponent(audioUrl.split("/").pop()?.split("?")[0] || "audio.mp3");
        pickFile(new File([blob], name, { type: blob.type || "audio/mpeg" }));
      } catch {
        /* leave the slot empty; the user can upload manually */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!jobId || (status !== "queued" && status !== "processing")) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/mix-master/job/${jobId}`);
        const data: MasterJobResponse = await res.json();
        if (!res.ok) return;
        if (data.status === "done") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setResult(data);
          setStatus("done");
        } else if (data.status === "failed") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setStatus("failed");
          setError(data.error || "Mastering failed — your Visual Bucs were refunded.");
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [jobId, status]);

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!isAudioFile(f)) { setError(t("mixMaster.errorAudioFile")); return; }
    if (f.size > MASTER_MAX_FILE_BYTES) { setError(t("mixMaster.errorFileTooLarge")); return; }
    if (beforeUrl) URL.revokeObjectURL(beforeUrl);
    setBeforeUrl(URL.createObjectURL(f));
    setFile(f);
    setError(null);
    setResult(null);
    setJobId(null);
    setStatus("idle");
  }

  async function start() {
    if (!file || !user) return;
    setStatus("uploading");
    setError(null);
    setOutOfCredits(false);
    try {
      const form = new FormData();
      form.append("audio", file);
      form.append("genre", genre);
      form.append("intensity", intensity);
      form.append("loudness", loudness);
      if (reference) form.append("reference", reference);
      const res = await confirmedFetch("/api/mix-master/master", { method: "POST", body: form });
      if (!res) { setStatus("idle"); return; }
      const data: MasterJobResponse = await res.json();
      if (res.status === 402) { setOutOfCredits(true); setStatus("idle"); return; }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || "Could not start mastering.");
        return;
      }
      setJobId(data.jobId);
      setStatus("queued");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError(t("mixMaster.errorNetwork"));
    }
  }

  function reset() {
    if (beforeUrl) URL.revokeObjectURL(beforeUrl);
    setFile(null); setBeforeUrl(null); setReference(null);
    setJobId(null); setStatus("idle"); setResult(null);
    setError(null); setOutOfCredits(false);
  }

  const busy = status === "uploading" || status === "queued" || status === "processing";

  return (
    <div>
      {adlibHandoff && (
        <div className="mt-4 rounded-2xl border border-[#C9A84C]/30 bg-[#C9A84C]/[0.06] p-5" data-testid="adlib-handoff-card">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-xl bg-[#C9A84C]/15 border border-[#C9A84C]/30 flex items-center justify-center shrink-0">
              <Mic2 className="h-4 w-4 text-[#C9A84C]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-white">
                {t("mixMaster.adlibPlanTitle", { defaultValue: "Ad-lib plan received" })}
                {adlibHandoff.take ? (
                  <span className="ml-2 rounded-md bg-[#C9A84C]/15 border border-[#C9A84C]/30 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-[#C9A84C]">
                    {t("mixMaster.adlibTakeLabel", { defaultValue: "Take {{take}}", take: adlibHandoff.take })}
                  </span>
                ) : null}
              </p>
              {(adlibHandoff.songTitle || adlibHandoff.artistName) && (
                <p className="text-xs text-white/40 mt-0.5">
                  {[adlibHandoff.songTitle, adlibHandoff.artistName].filter(Boolean).join(" — ")}
                </p>
              )}
              {adlibHandoff.takeStyle && (
                <p className="text-sm font-bold text-white/80 mt-2">{adlibHandoff.takeStyle}</p>
              )}
              {adlibHandoff.takeNotes && (
                <p className="text-[13px] text-white/50 mt-1 leading-relaxed">{adlibHandoff.takeNotes}</p>
              )}
              {(adlibHandoff.adlibs ?? []).length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {(adlibHandoff.adlibs ?? []).map((a, i) => (
                    <div key={i} className="text-[13px]">
                      <span className="font-black text-[#C9A84C]">“{a.line}”</span>
                      {a.placement && <span className="text-white/35 text-xs ml-2 uppercase tracking-wide">{a.placement}</span>}
                      {a.delivery && <span className="text-white/50 text-xs block mt-0.5">{a.delivery}</span>}
                    </div>
                  ))}
                </div>
              )}
              {(adlibHandoff.stacks ?? []).length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35 mb-1.5">
                    {t("mixMaster.adlibStacksLabel", { defaultValue: "Vocal stacks" })}
                  </p>
                  {(adlibHandoff.stacks ?? []).map((s, i) => (
                    <p key={i} className="text-[13px] text-white/60">
                      <span className="font-bold text-white/80">{s.voices}</span>
                      {s.description ? ` — ${s.description}` : ""}
                    </p>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setAdlibHandoff(null)}
              aria-label={t("mixMaster.adlibDismiss", { defaultValue: "Dismiss ad-lib plan" })}
              className="rounded-lg p-1.5 text-white/35 hover:text-white hover:bg-white/10 transition shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {outOfCredits && <div className="mt-4"><OutOfCredits /></div>}
      {error && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-200/80">{error}</p>
        </div>
      )}

      {(status === "idle" || status === "failed") && !busy && !result && (
        <div className="mt-6 space-y-5">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
            className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
              dragOver ? "border-[#C9A84C]/60 bg-[#C9A84C]/5" : "border-white/[0.12] hover:border-white/25"
            }`}
          >
            <Upload className="h-8 w-8 text-white/30 mx-auto mb-3" />
            {file ? (
              <div>
                <p className="font-semibold text-white">{file.name}</p>
                <p className="text-xs text-white/40 mt-1">{(file.size / 1024 / 1024).toFixed(1)} MB — click to change</p>
              </div>
            ) : (
              <div>
                <p className="font-semibold text-white/70">{t("mixMaster.dropMixHint")}</p>
                <p className="text-xs text-white/35 mt-1">{t("mixMaster.fileTypes")}</p>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept={MASTER_AUDIO_ACCEPT} className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])} />
          </div>

          <GenreGrid value={genre} onChange={setGenre} />
          <IntensityPicker value={intensity} onChange={setIntensity} />
          <LoudnessPicker value={loudness} onChange={setLoudness} />
          <ReferenceUpload file={reference} onPick={setReference} onClear={() => setReference(null)} />

          <button
            type="button"
            onClick={start}
            disabled={!file || !user}
            className="w-full rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] py-3.5 font-black text-black hover:brightness-110 active:scale-[0.99] transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {!user ? "Sign in to master" : `Master my track — ${MASTER_CREDIT_COST} Visual Bucs`}
          </button>
          {typeof creditsRemaining === "number" && (
            <p className="text-center text-xs text-white/35">{creditsRemaining} Visual Bucs remaining</p>
          )}
        </div>
      )}

      {busy && (
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
          <Loader2 className="h-8 w-8 text-[#C9A84C] mx-auto mb-4 animate-spin" />
          <p className="font-bold text-white">
            {status === "uploading" ? "Uploading your mix…" : status === "queued" ? "Queued — warming up the chain…" : "Mastering in progress…"}
          </p>
          <p className="text-xs text-white/40 mt-2">
            Analyzing loudness → genre chain → two-pass normalization → WAV + MP3. Safe to close this tab — the job runs on the server.
          </p>
        </div>
      )}

      {status === "done" && result && (
        <JobResult data={result} beforeUrl={beforeUrl} kindLabel="Master" onReset={reset} />
      )}
    </div>
  );
}

/* ── AI Mix (stems) panel ─────────────────────────────────────────── */

function MixPanel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [stems, setStems] = useState<File[]>([]);
  const [reference, setReference] = useState<File | null>(null);
  const [genre, setGenre] = useState<MasterGenreKey>("hip-hop");
  const [intensity, setIntensity] = useState<MasterIntensityKey>("balanced");
  const [loudness, setLoudness] = useState<MasterLoudnessKey>("streaming");
  const [vocalDb, setVocalDb] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<MasterJobStatus>("idle");
  const [result, setResult] = useState<MasterJobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!jobId || (status !== "queued" && status !== "processing")) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/mix-master/job/${jobId}`);
        const data: MasterJobResponse = await res.json();
        if (!res.ok) return;
        if (data.status === "done") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setResult(data);
          setStatus("done");
        } else if (data.status === "failed") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setStatus("failed");
          setError(data.error || "Mixing failed — your Visual Bucs were refunded.");
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [jobId, status]);

  function addFiles(list: FileList | File[] | undefined) {
    if (!list) return;
    const incoming = Array.from(list).filter(isAudioFile);
    if (incoming.length === 0) { setError(t("mixMaster.errorNotAudio")); return; }
    setStems((prev) => {
      const merged = [...prev, ...incoming].slice(0, MASTER_MAX_STEMS);
      return merged;
    });
    setError(null);
    setResult(null);
    setJobId(null);
    setStatus("idle");
  }

  function removeStem(idx: number) {
    setStems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function start() {
    if (stems.length === 0 || !user) return;
    setStatus("uploading");
    setError(null);
    setOutOfCredits(false);
    try {
      const form = new FormData();
      for (const s of stems) form.append("stems", s);
      form.append("genre", genre);
      form.append("intensity", intensity);
      form.append("loudness", loudness);
      form.append("vocalLevelDb", String(vocalDb));
      if (reference) form.append("reference", reference);
      const res = await confirmedFetch("/api/mix-master/mix", { method: "POST", body: form });
      if (!res) { setStatus("idle"); return; }
      const data: MasterJobResponse = await res.json();
      if (res.status === 402) { setOutOfCredits(true); setStatus("idle"); return; }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || "Could not start the mix.");
        return;
      }
      setJobId(data.jobId);
      setStatus("queued");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError(t("mixMaster.errorNetwork"));
    }
  }

  function reset() {
    setStems([]); setReference(null);
    setJobId(null); setStatus("idle"); setResult(null);
    setError(null); setOutOfCredits(false);
  }

  const busy = status === "uploading" || status === "queued" || status === "processing";

  return (
    <div>
      {outOfCredits && <div className="mt-4"><OutOfCredits /></div>}
      {error && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-200/80">{error}</p>
        </div>
      )}

      {(status === "idle" || status === "failed") && !busy && !result && (
        <div className="mt-6 space-y-5">
          <div>
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">
              Stems <span className="text-white/25 normal-case font-medium">({stems.length}/{MASTER_MAX_STEMS})</span>
            </p>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
              className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
                dragOver ? "border-[#C9A84C]/60 bg-[#C9A84C]/5" : "border-white/[0.12] hover:border-white/25"
              }`}
            >
              <Upload className="h-7 w-7 text-white/30 mx-auto mb-2" />
              <p className="font-semibold text-white/70 text-sm">{t("mixMaster.dropStemsHint")}</p>
              <p className="text-xs text-white/35 mt-1">Vocals, drums, bass, keys… up to {MASTER_MAX_STEMS} files, 100 MB each</p>
              <input
                ref={fileInputRef}
                type="file"
                accept={MASTER_AUDIO_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => { addFiles(e.target.files ?? undefined); e.target.value = ""; }}
              />
            </div>

            {stems.length > 0 && (
              <div className="mt-3 space-y-2">
                {stems.map((s, i) => {
                  const stemType = detectStemTypeClient(s.name);
                  const meta = MASTER_STEM_TYPE_META[stemType];
                  return (
                    <div key={`${s.name}-${i}`} className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5">
                      <FileAudio className="h-4 w-4 text-white/35 shrink-0" />
                      <span className="text-sm text-white/75 truncate flex-1">{s.name}</span>
                      <span className="text-[11px] text-white/30 font-mono shrink-0 hidden sm:block">
                        {(s.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold shrink-0 ${meta.chip}`}>
                        {t(`mixMaster.stemTypes.${stemType}`)}
                      </span>
                      <button type="button" onClick={() => removeStem(i)} className="text-white/35 hover:text-white/80 transition shrink-0">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
                <p className="text-[11px] text-white/30">
                  Stem types are auto-detected from filenames — the engine applies the right chain to each one.
                </p>
              </div>
            )}
          </div>

          <GenreGrid value={genre} onChange={setGenre} />
          <IntensityPicker value={intensity} onChange={setIntensity} />

          {/* Vocal level */}
          <div data-min-stars="3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider">{t("mixMaster.vocalLevel")}</p>
              <span className="text-xs font-mono text-[#f7dd7f]">
                {vocalDb > 0 ? `+${vocalDb.toFixed(1)}` : vocalDb.toFixed(1)} dB
              </span>
            </div>
            <input
              type="range"
              min={-6}
              max={4}
              step={0.5}
              value={vocalDb}
              onChange={(e) => setVocalDb(Number(e.target.value))}
              className="w-full accent-[#C9A84C]"
            />
            <div className="flex justify-between text-[10px] text-white/30 mt-1">
              <span>{t("mixMaster.vocalBuried")}</span>
              <span>{t("mixMaster.vocalUpfront")}</span>
            </div>
          </div>

          <LoudnessPicker value={loudness} onChange={setLoudness} />
          <ReferenceUpload file={reference} onPick={setReference} onClear={() => setReference(null)} />

          <button
            type="button"
            onClick={start}
            disabled={stems.length === 0 || !user}
            className="w-full rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] py-3.5 font-black text-black hover:brightness-110 active:scale-[0.99] transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {!user ? "Sign in to mix" : `Mix & master ${stems.length} stem${stems.length === 1 ? "" : "s"} — ${MIX_CREDIT_COST} credits`}
          </button>
          {typeof creditsRemaining === "number" && (
            <p className="text-center text-xs text-white/35">{creditsRemaining} Visual Bucs remaining</p>
          )}
        </div>
      )}

      {busy && (
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
          <Loader2 className="h-8 w-8 text-[#C9A84C] mx-auto mb-4 animate-spin" />
          <p className="font-bold text-white">
            {status === "uploading" ? `Uploading ${stems.length} stems…` : status === "queued" ? "Queued — staging your stems…" : "Mixing in progress…"}
          </p>
          <p className="text-xs text-white/40 mt-2">
            Detecting stems → gain staging → EQ → compression → panning → mixdown → master chain → WAV + MP3. Safe to close this tab.
          </p>
        </div>
      )}

      {status === "done" && result && (
        <JobResult data={result} beforeUrl={null} kindLabel="Mix & master" onReset={reset} />
      )}
    </div>
  );
}

/* ── Express Master panel (merged from /mastering) ───────────────────
   The one-tap master: POST /api/mastering (registry:
   "/api/mastering" = 400 Visual Bucs). Real DSP mastering chain
   (ffmpeg): subsonic cleanup → glue compression → sweetening EQ → stereo
   widening → two-pass EBU R128 loudness normalization with true-peak
   limiting. Outputs 24-bit WAV + 320kbps MP3. Server-owned background job:
   safe to close the tab while it runs.
   Honest copy: mastering polishes a mix — it can't fix a bad one. */

const QUICK_MASTER_CREDIT_COST = 4;

type QuickPresetKey = "streaming" | "club" | "radio" | "lofi";

const QUICK_PRESETS: Array<{ key: QuickPresetKey; spec: string }> = [
  { key: "streaming", spec: "-14 LUFS · -1.0 dBTP" },
  { key: "club", spec: "-9 LUFS · -1.0 dBTP" },
  { key: "radio", spec: "-12 LUFS · -1.0 dBTP" },
  { key: "lofi", spec: "-14 LUFS · -1.5 dBTP" },
];

interface QuickMasterStats {
  inputLufs: number | null;
  inputTruePeak: number | null;
  inputLra: number | null;
  targetLufs: number | null;
  targetTruePeak: number | null;
  outputLufs: number | null;
}

interface QuickMasterJobResponse {
  jobId?: string;
  status?: string;
  preset?: QuickPresetKey;
  stats?: QuickMasterStats;
  wavUrl?: string | null;
  mp3Url?: string | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

function QuickMasterPanel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { addAsset } = useHubProject();
  const { confirmedFetch } = useConfirmedApi();
  const [file, setFile] = useState<File | null>(null);
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [preset, setPreset] = useState<QuickPresetKey>("streaming");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<MasterJobStatus>("idle");
  const [stats, setStats] = useState<QuickMasterStats | null>(null);
  const [wavUrl, setWavUrl] = useState<string | null>(null);
  const [mp3Url, setMp3Url] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [abSide, setAbSide] = useState<"before" | "after">("after");
  const [playing, setPlaying] = useState(false);
  const pollRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /* Poll the server-owned job until it completes. Tab-safe: the job
     lives on the server, so closing this page loses nothing. */
  useEffect(() => {
    if (!jobId || (status !== "queued" && status !== "processing")) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/mastering/${jobId}`);
        const data: QuickMasterJobResponse = await res.json();
        if (!res.ok) return; // keep polling on transient errors
        if (data.status === "done") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setStatus("done");
          setStats(data.stats ?? null);
          setWavUrl(data.wavUrl ?? null);
          setMp3Url(data.mp3Url ?? null);
          /* The mastered track flows into the project — distribute, video and the hub rail can pick it up. */
          if (data.mp3Url || data.wavUrl) {
            addAsset({ kind: "song", url: data.mp3Url || data.wavUrl || "", label: "Mastered track", detail: `Express mastering · ${preset}` });
          }
        } else if (data.status === "failed") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setStatus("failed");
          setError(data.error || t("mastering.errorFailed"));
        }
      } catch {
        /* keep polling on transient network errors */
      }
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [jobId, status]);

  /* A/B switching: keep playback position when flipping before/after. */
  function flipSide(side: "before" | "after") {
    const el = audioRef.current;
    const t = el ? el.currentTime : 0;
    const wasPlaying = playing;
    setAbSide(side);
    requestAnimationFrame(() => {
      const next = audioRef.current;
      if (!next) return;
      next.currentTime = t;
      if (wasPlaying) void next.play().catch(() => {});
    });
  }

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!isAudioFile(f)) {
      setError(t("mastering.errorAudioFile"));
      return;
    }
    if (f.size > MASTER_MAX_FILE_BYTES) {
      setError(t("mastering.errorFileTooLarge"));
      return;
    }
    if (beforeUrl) URL.revokeObjectURL(beforeUrl);
    setBeforeUrl(URL.createObjectURL(f));
    setFile(f);
    setError(null);
    setWavUrl(null);
    setMp3Url(null);
    setStats(null);
    setJobId(null);
    setStatus("idle");
    setAbSide("after");
  }

  async function startMastering() {
    if (!file || !user) return;
    setStatus("uploading");
    setError(null);
    setOutOfCredits(false);
    try {
      const form = new FormData();
      form.append("audio", file);
      form.append("preset", preset);
      const res = await confirmedFetch("/api/mastering", { method: "POST", body: form });
      if (!res) { setStatus("idle"); return; } // user cancelled the credit confirmation
      const data: QuickMasterJobResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || t("mastering.errorStartFailed"));
        return;
      }
      setJobId(data.jobId);
      setStatus("queued");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError(t("mastering.errorNetwork"));
    }
  }

  function reset() {
    if (beforeUrl) URL.revokeObjectURL(beforeUrl);
    setFile(null);
    setBeforeUrl(null);
    setJobId(null);
    setStatus("idle");
    setStats(null);
    setWavUrl(null);
    setMp3Url(null);
    setError(null);
    setOutOfCredits(false);
    setPlaying(false);
  }

  const busy = status === "uploading" || status === "queued" || status === "processing";
  const activeSrc = abSide === "before" ? beforeUrl : mp3Url;

  return (
    <div>
      {outOfCredits && (
        <div className="mt-4"><OutOfCredits /></div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-200/80">{error}</p>
        </div>
      )}

      {/* Upload + preset picker */}
      {(status === "idle" || status === "failed") && !busy && (
        <div className="mt-6 space-y-5">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files[0]); }}
            className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
              dragOver ? "border-[#C9A84C]/60 bg-[#C9A84C]/5" : "border-white/[0.12] hover:border-white/25"
            }`}
          >
            <Upload className="h-8 w-8 text-white/30 mx-auto mb-3" />
            {file ? (
              <div>
                <p className="font-semibold text-white">{file.name}</p>
                <p className="text-xs text-white/40 mt-1">{t("mastering.fileSize", { size: (file.size / 1024 / 1024).toFixed(1) })}</p>
              </div>
            ) : (
              <div>
                <p className="font-semibold text-white/70">{t("mastering.dropHint")}</p>
                <p className="text-xs text-white/35 mt-1">{t("mastering.fileTypes")}</p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={MASTER_AUDIO_ACCEPT}
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </div>

          {/* Preset picker */}
          <div data-min-stars="2">
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">{t("mastering.presetLabel")}</p>
            <div className="grid grid-cols-2 gap-3">
              {QUICK_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPreset(p.key)}
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    preset === p.key
                      ? "border-[#C9A84C]/60 bg-[#C9A84C]/10"
                      : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                  }`}
                >
                  <p className={`font-bold text-sm ${preset === p.key ? "text-[#f7dd7f]" : "text-white/80"}`}>{t(`mastering.presets.${p.key}.label`)}</p>
                  <p className="text-xs text-white/45 mt-1 leading-relaxed">{t(`mastering.presets.${p.key}.blurb`)}</p>
                  <p className="text-[11px] text-white/30 mt-1.5 font-mono">{p.spec}</p>
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={startMastering}
            disabled={!file || !user}
            className="w-full rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] py-3.5 font-black text-black hover:brightness-110 active:scale-[0.99] transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {!user ? t("mastering.signInToMaster") : t("mastering.masterButton", { cost: QUICK_MASTER_CREDIT_COST })}
          </button>
          {typeof creditsRemaining === "number" && (
            <p className="text-center text-xs text-white/35">{t("mastering.creditsRemaining", { count: creditsRemaining })}</p>
          )}
        </div>
      )}

      {/* Processing */}
      {busy && (
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
          <Loader2 className="h-8 w-8 text-[#C9A84C] mx-auto mb-4 animate-spin" />
          <p className="font-bold text-white">
            {status === "uploading" ? t("mastering.statusUploading") : status === "queued" ? t("mastering.statusQueued") : t("mastering.statusProcessing")}
          </p>
          <p className="text-xs text-white/40 mt-2">
            {t("mastering.processingDetail")}
          </p>
        </div>
      )}

      {/* Result: A/B player + loudness stats + downloads */}
      {status === "done" && (
        <div className="mt-6 space-y-5">
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <p className="text-sm text-emerald-200/80">{t("mastering.masterComplete")}</p>
          </div>

          {/* A/B player */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider">{t("mastering.beforeAfter")}</p>
              <div className="flex rounded-lg border border-white/[0.1] overflow-hidden">
                <button
                  type="button"
                  onClick={() => flipSide("before")}
                  disabled={!beforeUrl}
                  className={`px-4 py-1.5 text-xs font-bold transition disabled:opacity-30 ${
                    abSide === "before" ? "bg-white/[0.12] text-white" : "text-white/40 hover:text-white/70"
                  }`}
                >
                  {t("mastering.before")}
                </button>
                <button
                  type="button"
                  onClick={() => flipSide("after")}
                  disabled={!mp3Url}
                  className={`px-4 py-1.5 text-xs font-bold transition disabled:opacity-30 ${
                    abSide === "after" ? "bg-[#C9A84C]/25 text-[#f7dd7f]" : "text-white/40 hover:text-white/70"
                  }`}
                >
                  {t("mastering.after")}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  const el = audioRef.current;
                  if (!el) return;
                  if (playing) { el.pause(); } else { void el.play().catch(() => {}); }
                }}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] text-black hover:brightness-110 transition"
              >
                {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
              </button>
              <audio
                ref={audioRef}
                src={activeSrc ?? undefined}
                className="w-full accent-[#C9A84C]"
                controls
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
              />
            </div>
            <p className="text-[11px] text-white/30 mt-2">
              {t("mastering.listeningTo")}{" "}
              <span className="text-white/60 font-semibold">{abSide === "before" ? t("mastering.originalMix") : t("mastering.masteredVersion")}</span>
              {" "}{t("mastering.positionPreserved")}
            </p>
          </div>

          {/* Loudness stats */}
          {stats && (
            <div data-min-stars="4" className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3">{t("mastering.loudnessReport")}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: t("mastering.mixLoudness"), value: fmtLufs(stats.inputLufs) },
                  { label: t("mastering.masterLoudness"), value: fmtLufs(stats.outputLufs ?? stats.targetLufs) },
                  { label: t("mastering.truePeakMix"), value: typeof stats.inputTruePeak === "number" ? `${stats.inputTruePeak.toFixed(1)} dBTP` : "—" },
                  { label: t("mastering.targetCeiling"), value: typeof stats.targetTruePeak === "number" ? `${stats.targetTruePeak.toFixed(1)} dBTP` : "—" },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl bg-black/40 border border-white/[0.06] px-3 py-2.5">
                    <p className="text-[10px] text-white/35 uppercase tracking-wider">{s.label}</p>
                    <p className="text-sm font-black text-[#f7dd7f] mt-1 font-mono">{s.value}</p>
                  </div>
                ))}
              </div>
              {typeof stats.inputLra === "number" && (
                <p className="text-[11px] text-white/30 mt-3">
                  {t("mastering.dynamicRange", { value: stats.inputLra.toFixed(1) })}
                </p>
              )}
            </div>
          )}

          {/* Downloads */}
          <div className="grid grid-cols-2 gap-3">
            <a
              href={wavUrl ?? undefined}
              download
              className={`flex items-center justify-center gap-2 rounded-xl border border-[#C9A84C]/40 bg-[#C9A84C]/10 py-3 font-bold text-sm text-[#f7dd7f] hover:bg-[#C9A84C]/20 transition ${!wavUrl ? "pointer-events-none opacity-30" : ""}`}
            >
              <Download className="h-4 w-4" /> {t("mastering.downloadWav")}
            </a>
            <a
              href={mp3Url ?? undefined}
              download
              className={`flex items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] py-3 font-bold text-sm text-white/80 hover:bg-white/[0.08] transition ${!mp3Url ? "pointer-events-none opacity-30" : ""}`}
            >
              <Download className="h-4 w-4" /> {t("mastering.downloadMp3")}
            </a>
          </div>

          <button
            type="button"
            onClick={reset}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.1] py-3 text-sm font-bold text-white/50 hover:text-white/80 hover:bg-white/[0.04] transition"
          >
            <RefreshCw className="h-4 w-4" /> {t("mastering.masterAnother")}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────── */

function MixMasterPanel() {
  const { t } = useTranslation();
  /* master = 8 VB full-chain master · quick = 4 VB express master (merged
     from /mastering, POST /api/mastering) · mix = 15 VB stem mixdown */
  const [tab, setTab] = useState<"master" | "quick" | "mix">(() => {
    try { return new URLSearchParams(window.location.search).get("mode") === "quick" ? "quick" : "master"; } catch { return "master"; }
  });

  const TAB_BUTTONS: Array<{
    id: "master" | "quick" | "mix";
    icon: React.ElementType;
    label: string;
    sublabel?: string;
    cost: number;
  }> = [
    { id: "master", icon: SlidersHorizontal, label: t("mixMaster.tabMaster"), cost: MASTER_CREDIT_COST },
    { id: "quick", icon: Gauge, label: t("mixMaster.tabQuick", { defaultValue: "Express Master" }), cost: QUICK_MASTER_CREDIT_COST },
    { id: "mix", icon: AudioWaveform, label: t("mixMaster.tabMix"), sublabel: t("mixMaster.tabMixStems"), cost: MIX_CREDIT_COST },
  ];

  return (
    <>
        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#C9A84C]/15 text-[#f7dd7f]">
            <AudioLines className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-2xl font-black">{t("mixMaster.title")}</h2>
            <p className="text-sm text-white/45">{t("mixMaster.subtitle")}</p>
          </div>
        </div>

        {/* Honest framing */}
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <Info className="h-4 w-4 text-[#C9A84C]/70 shrink-0 mt-0.5" />
          <p className="text-xs text-white/55 leading-relaxed">
            {t("mixMaster.honestFraming")}{" "}
            <span className="text-white/80 font-semibold">{t("mixMaster.honestFramingBold")}</span>{" "}
            {t("mixMaster.honestFramingEnd")}
          </p>
        </div>

        {/* Tabs */}
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-1.5">
          {TAB_BUTTONS.map((b) => {
            const Icon = b.icon;
            const active = tab === b.id;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setTab(b.id)}
                className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold transition ${
                  active
                    ? "bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] text-black"
                    : "text-white/50 hover:text-white/80"
                }`}
              >
                <Icon className="h-4 w-4" />
                {b.label} {b.sublabel && <span className="hidden sm:inline">{b.sublabel}</span>}
                <span className={`text-[11px] font-black px-1.5 py-0.5 rounded ${active ? "bg-black/20" : "bg-white/[0.08] text-white/50"}`}>
                  {b.cost} VB
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-xs text-white/35 mt-3 leading-relaxed">
          {tab === "master"
            ? "Upload one finished stereo mix — choose a genre sound, intensity and loudness target, get back a release-ready master."
            : tab === "quick"
              ? t("mixMaster.tabQuickDesc", { defaultValue: "Upload one finished stereo mix — pick a preset, get a radio-ready master for 400 Visual Bucs. Fast, no knobs." })
              : "Upload up to 12 stems — the engine detects each one, balances levels, EQs, compresses, pans and masters the full mixdown."}
        </p>

        {tab === "master" ? <MasterPanel /> : tab === "quick" ? <QuickMasterPanel /> : <MixPanel />}
    </>
  );
}

/* ─── Audio Studio shell ──────────────────────────────────────────────────
   One page, three tools. Each tab keeps its own paid endpoint, credit cost,
   and charge-then-refund discipline — only the page chrome is shared. */

type StudioTab = "cleanup" | "stems" | "master" | "aiaudio" | "voiceover" | "podcast" | "sounds" | "hum" | "finish" | "ratemix";

const STUDIO_TABS: Array<{ id: StudioTab; labelKey: string; descKey: string }> = [
  { id: "cleanup", labelKey: "audioStudio.tabs.cleanup", descKey: "audioStudio.desc.cleanup" },
  { id: "stems", labelKey: "audioStudio.tabs.stems", descKey: "audioStudio.desc.stems" },
  { id: "master", labelKey: "audioStudio.tabs.master", descKey: "audioStudio.desc.master" },
  { id: "aiaudio", labelKey: "audioStudio.tabs.aiaudio", descKey: "audioStudio.desc.aiaudio" },
  { id: "voiceover", labelKey: "audioStudio.tabs.voiceover", descKey: "audioStudio.desc.voiceover" },
  { id: "podcast", labelKey: "audioStudio.tabs.podcast", descKey: "audioStudio.desc.podcast" },
  { id: "sounds", labelKey: "audioStudio.tabs.sounds", descKey: "audioStudio.desc.sounds" },
  { id: "hum", labelKey: "audioStudio.tabs.hum", descKey: "audioStudio.desc.hum" },
  { id: "finish", labelKey: "audioStudio.tabs.finish", descKey: "audioStudio.desc.finish" },
  { id: "ratemix", labelKey: "audioStudio.tabs.ratemix", descKey: "audioStudio.desc.ratemix" },
];

export default function AudioStudio() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<StudioTab>(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("tab");
      if (q === "stems" || q === "master" || q === "aiaudio" || q === "voiceover" || q === "podcast" || q === "sounds" || q === "hum" || q === "finish" || q === "ratemix") return q;
      return "cleanup";
    } catch {
      return "cleanup";
    }
  });
  usePageTitle(t("audioStudio.title", { defaultValue: "Audio Studio" }),
               t("audioStudio.subtitle", { defaultValue: "Clean up, split, and master your audio — every tool in one place." }));

  function switchTab(next: StudioTab) {
    setTab(next);
    /* Keep the tab shareable; preserve sibling params (mode, audioUrl). */
    try {
      const params = new URLSearchParams(window.location.search);
      params.set("tab", next);
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    } catch {
      /* non-browser — ignore */
    }
  }

  const activeDesc = STUDIO_TABS.find((tb) => tb.id === tab)?.descKey ?? "";

  return (
    <div className="min-h-screen bg-black text-white lux-page">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[700px] h-[360px] bg-[#d4a017]/[0.07] rounded-full blur-[120px]" />
      </div>
      <main className="relative z-10 mx-auto max-w-3xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-[#fbbf24] transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" /> {t("audioStudio.back", { defaultValue: "Back" })}
        </Link>

        {/* Hero */}
        <div className="mb-8">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-[#d4a017]/40 bg-[#d4a017]/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#fbbf24]">
            <AudioWaveform className="h-3 w-3" />
            {t("audioStudio.kicker", { defaultValue: "Thy Booth" })}
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#d4a017]/15 border border-[#d4a017]/30 text-[#fbbf24] shadow-[0_0_24px_rgba(212,160,23,0.25)]">
              <AudioWaveform className="h-6 w-6" />
            </span>
            <div>
              <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white">{t("audioStudio.title", { defaultValue: "Audio Studio" })}</h1>
            </div>
          </div>
          <p className="mt-3 text-sm md:text-base text-white/50 max-w-2xl leading-relaxed">{t("audioStudio.subtitle", { defaultValue: "Clean up, split, and master your audio — every tool in one place." })}</p>
        </div>

        {/* Tabs */}
        <div className="mt-6 grid grid-cols-3 gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-1.5">
          {STUDIO_TABS.map((tb) => {
            const active = tab === tb.id;
            return (
              <button
                key={tb.id}
                type="button"
                onClick={() => switchTab(tb.id)}
                className={`rounded-xl px-3 py-3 text-sm transition ${
                  active
                    ? "bg-gradient-to-r from-[#fbbf24] to-[#d4a017] text-black font-black shadow-[0_0_18px_rgba(212,160,23,0.35)]"
                    : "text-white/50 hover:text-white hover:bg-white/[0.04] font-bold"
                }`}
              >
                {t(tb.labelKey, { defaultValue: tb.id })}
              </button>
            );
          })}
        </div>

        <p className="text-xs text-white/35 mt-3 leading-relaxed">
          {t(activeDesc, { defaultValue: "" })}
        </p>

        <div className="mt-2">
          {tab === "cleanup" ? <CleanupPanel /> : tab === "stems" ? <StemsPanel /> : tab === "master" ? <MixMasterPanel /> : tab === "aiaudio" ? <AiAudio /> : tab === "voiceover" ? <VoiceoverStudio /> : tab === "podcast" ? <PodcastStudio /> : tab === "hum" ? <HumToSong /> : tab === "finish" ? <FinishMySong /> : tab === "ratemix" ? <RateMyMix /> : <ViralSoundFinder />}
        </div>
      </main>
    </div>
  );
}
