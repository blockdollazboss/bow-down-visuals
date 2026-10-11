import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  Upload, Loader2, Download, AlertTriangle, CheckCircle2, Info,
  AudioWaveform, Play, Pause, RefreshCw, Mic, Music4, Sparkles,
  ArrowRight, Volume2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useHubProject } from "@/lib/hub-project";

/* ─── De-Reverb / Dialogue Isolate ───────────────────────────────────────
   TRUE de-reverb needs an AI provider — the server has no DSP-only path
   (ffmpeg's afftdn/anlmdn reduce noise, they don't remove room echo), and
   we refuse to ship a fake. The panel fetches GET /api/deverb/status on
   mount: while the provider gate is closed it renders an amber disabled
   banner naming what's missing instead of the processing UI. Once the
   gate opens (provider key set + pricing approved), this becomes a full
   CleanupPanel-style flow: drag-drop upload, server job polling,
   credits display, before/after A/B, and handoffs (cleaned dialogue →
   voiceover/podcast, cleaned vocal → song flow). */

// PLACEHOLDER — NOT USER-APPROVED. Mirrors the server's
// DEVERB_CREDIT_COST (1000 credits = 10 Visual Bucs) proposal.
// Do not edit: the final price needs the user's explicit approval.
const DEVERB_CREDIT_COST_VB = 10;
const DEVERB_MAX_BYTES = 50 * 1024 * 1024;

type DeverbModeKey = "dialogue" | "vocal";

const DEVERB_MODES: Array<{ key: DeverbModeKey; labelKey: string; blurbKey: string; icon: typeof Mic }> = [
  { key: "dialogue", labelKey: "deverb.modeDialogueLabel", blurbKey: "deverb.modeDialogueBlurb", icon: Mic },
  { key: "vocal", labelKey: "deverb.modeVocalLabel", blurbKey: "deverb.modeVocalBlurb", icon: Music4 },
];

type DeverbGateReason = "ok" | "provider_not_configured" | "pricing_pending";
interface DeverbGateStatus {
  enabled: boolean;
  reason: DeverbGateReason;
  pricingApproved: boolean;
  providerConfigured: boolean;
  creditCost: number;
  pricingVersion: string;
}

type DeverbJobStatus = "idle" | "uploading" | "queued" | "processing" | "done" | "failed";

interface DeverbJobResponse {
  jobId?: string;
  status?: string;
  outputUrl?: string | null;
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
      raw = await res.arrayBuffer();
    } else {
      raw = await source.arrayBuffer();
    }
    const buf = await ctx.decodeAudioData(raw);
    const ch = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / bars));
    const peaks: number[] = [];
    for (let i = 0; i < bars; i++) {
      let max = 0;
      const start = i * step;
      for (let j = start; j < Math.min(start + step, ch.length); j += 4) {
        const v = Math.abs(ch[j] ?? 0);
        if (v > max) max = v;
      }
      peaks.push(Math.min(1, max * 1.6));
    }
    void ctx.close();
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
        <Volume2 className="h-4 w-4" /> {t("deverb.waveformUnavailable")}
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

export function DeverbPanel() {
  const { t } = useTranslation();
  const { addAsset } = useHubProject();
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [gate, setGate] = useState<DeverbGateStatus | null>(null);
  const [gateLoading, setGateLoading] = useState(true);

  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<DeverbModeKey>("dialogue");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<DeverbJobStatus>("idle");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [ab, setAb] = useState<"original" | "cleaned">("cleaned");
  const [playing, setPlaying] = useState(false);
  const [origPeaks, setOrigPeaks] = useState<number[] | null>(null);
  const [cleanPeaks, setCleanPeaks] = useState<number[] | null>(null);
  const [origUrl, setOrigUrl] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /* Provider gate: the panel can't process anything until the server's
     AI de-reverb provider is connected and the price is approved. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/deverb/status");
        if (!res.ok) throw new Error("status failed");
        const data: DeverbGateStatus = await res.json();
        if (!cancelled) setGate(data);
      } catch {
        if (!cancelled) setGate(null);
      } finally {
        if (!cancelled) setGateLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Poll the server-owned job until it completes. Tab-safe: the job
     lives on the server, so closing this page loses nothing. */
  useEffect(() => {
    if (!jobId || (status !== "queued" && status !== "processing")) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/deverb/${jobId}`);
        const data: DeverbJobResponse = await res.json();
        if (!res.ok) {
          setStatus("failed");
          setError(data.error || t("deverb.errorJobNotFound"));
          return;
        }
        if (data.status === "done") {
          setStatus("done");
          setOutputUrl(data.outputUrl ?? null);
          /* The de-reverbed audio flows into the project for the next step. */
          if (data.outputUrl) {
            addAsset({ kind: "song", url: data.outputUrl, label: "De-reverbed audio", detail: `De-reverb · ${mode}` });
          }
        } else if (data.status === "failed") {
          setStatus("failed");
          setError(data.error || t("deverb.errorDeverbFailed"));
        } else {
          setStatus(data.status as DeverbJobStatus);
        }
      } catch {
        /* keep polling on transient network errors */
      }
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [jobId, status, mode, addAsset, t]);

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

  /* Waveform for the de-reverbed result. */
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
      setError(t("deverb.errorAudioType"));
      return;
    }
    if (f.size > DEVERB_MAX_BYTES) {
      setError(t("deverb.errorFileTooLarge"));
      return;
    }
    setFile(f);
    setError(null);
    setOutputUrl(null);
    setJobId(null);
    setStatus("idle");
    setAb("cleaned");
  }

  async function startDeverb() {
    if (!file || !user) return;
    setStatus("uploading");
    setError(null);
    setOutOfCredits(false);
    try {
      const form = new FormData();
      form.append("audio", file);
      form.append("mode", mode);
      const res = await confirmedFetch("/api/deverb", {
        method: "POST",
        body: form,
        // credit-costs.ts registry is owned by another agent — override
        // the spend dialog here instead of editing that shared file.
        overrideCost: DEVERB_CREDIT_COST_VB,
        overrideFeature: t("deverb.featureName"),
      });
      if (!res) { setStatus("idle"); return; } // user cancelled the credit confirmation
      const data: DeverbJobResponse = await res.json();
      if (res.status === 503) {
        // Provider gate still closed on the server side.
        setStatus("failed");
        setError(data.message || data.error || t("deverb.errorProviderNotConfigured"));
        return;
      }
      if (res.status === 402) {
        const isPricingPending = data.error === "pricing_pending";
        setOutOfCredits(!isPricingPending);
        setStatus(isPricingPending ? "failed" : "idle");
        setError(isPricingPending ? data.message || t("deverb.errorPricingPending") : null);
        return;
      }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || t("deverb.errorStartFailed"));
        return;
      }
      setJobId(data.jobId);
      setStatus("queued");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError(t("deverb.errorNetwork"));
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
  }

  const busy = status === "uploading" || status === "queued" || status === "processing";
  const gated = gateLoading ? true : !gate?.enabled;

  return (
    <>
      <div className="flex items-center gap-3 mb-2">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <AudioWaveform className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-2xl font-black">{t("deverb.title")}</h2>
          <p className="text-sm text-white/45">{t("deverb.subtitle", { cost: DEVERB_CREDIT_COST_VB })}</p>
        </div>
      </div>

      {gateLoading ? (
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
          <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
          <p className="text-sm text-white/40">{t("deverb.checkingAvailability")}</p>
        </div>
      ) : gated ? (
        /* ── Provider gate banner: honest disabled state, names the
             missing piece (provider key vs. price approval) ── */
        <div className="mt-6 space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] px-5 py-4">
            <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-amber-200">{t("deverb.gatedTitle")}</p>
              <p className="text-sm text-amber-200/70 mt-1 leading-relaxed">
                {gate?.reason === "provider_not_configured"
                  ? t("deverb.gatedProviderMissing")
                  : gate?.reason === "pricing_pending"
                    ? t("deverb.gatedPricingPending")
                    : t("deverb.gatedUnknown")}
              </p>
            </div>
          </div>

          {/* Honest framing: why there is no cheap DSP version */}
          <div className="flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
            <p className="text-xs text-white/55 leading-relaxed">
              {t("deverb.whyNoDsp")}
            </p>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-6 text-center">
            <Sparkles className="h-7 w-7 text-white/25 mx-auto mb-3" />
            <p className="text-sm text-white/50 max-w-md mx-auto leading-relaxed">
              {t("deverb.gatedTeaser")}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Honest framing */}
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
            <p className="text-xs text-white/55 leading-relaxed">
              {t("deverb.honestIntro")}{" "}
              <span className="text-white/80 font-semibold">{t("deverb.honestStrong")}</span>
              {t("deverb.honestRest")}
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
                    <p className="text-xs text-white/40 mt-1">{t("deverb.fileSizeChange", { size: (file.size / 1024 / 1024).toFixed(1) })}</p>
                  </div>
                ) : (
                  <div>
                    <p className="font-semibold text-white/70">{t("deverb.dropPrompt")}</p>
                    <p className="text-xs text-white/35 mt-1">{t("deverb.dropFormats")}</p>
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

              {/* Mode picker: dialogue isolate vs vocal de-reverb */}
              <div data-min-stars="2">
                <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">{t("deverb.modeLabel")}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {DEVERB_MODES.map((m) => {
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
                onClick={startDeverb}
                disabled={!file || !user}
                className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("deverb.deverbButton", { cost: DEVERB_CREDIT_COST_VB })}
              </button>
              {creditsRemaining != null && (
                <p className="text-center text-xs text-white/35">{t("deverb.creditsRemaining", { n: creditsRemaining })}</p>
              )}
            </div>
          ) : null}

          {/* Progress */}
          {busy && (
            <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
              <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
              <p className="font-bold text-white">
                {status === "uploading" ? t("deverb.statusUploading") : status === "queued" ? t("deverb.statusQueued") : t("deverb.statusProcessing")}
              </p>
              <p className="text-sm text-white/40 mt-1">
                {t("deverb.progressNote")}
              </p>
            </div>
          )}

          {/* Result: A/B player */}
          {status === "done" && outputUrl && (
            <div className="mt-6 space-y-4">
              <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
                <p className="text-sm font-semibold text-white/80">
                  {t("deverb.deverbComplete")}
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
                    {side === "original" ? t("deverb.abOriginal") : t("deverb.abCleaned")}
                  </button>
                ))}
              </div>

              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                <div className="flex items-center gap-3 mb-3">
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-black transition hover:brightness-110"
                    aria-label={playing ? t("deverb.pause") : t("deverb.play")}
                  >
                    {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
                  </button>
                  <div className="flex-1">
                    <p className="text-xs font-bold text-white/50 uppercase tracking-wider mb-1">
                      {ab === "original" ? t("deverb.labelOriginal") : t("deverb.labelCleaned")}
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
                  {t("deverb.abHint")}
                </p>
              </div>

              <div className="flex gap-3">
                <a
                  href={outputUrl}
                  download={`deverbed-${mode}.mp3`}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 font-bold text-black transition hover:brightness-110"
                >
                  <Download className="h-4 w-4" /> {t("deverb.downloadButton")}
                </a>
                <button
                  onClick={reset}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
                >
                  <RefreshCw className="h-4 w-4" /> {t("deverb.newDeverbButton")}
                </button>
              </div>

              {/* Next-step handoffs: cleaned dialogue → voiceover / podcast,
                  cleaned vocal → song flow. */}
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3">{t("deverb.handoffLabel")}</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <Link
                    href="/audio-studio?tab=voiceover"
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.10] px-4 py-3 text-sm font-bold text-white/75 hover:border-white/25 hover:text-white transition"
                  >
                    {t("deverb.handoffVoiceover")} <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/audio-studio?tab=podcast"
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.10] px-4 py-3 text-sm font-bold text-white/75 hover:border-white/25 hover:text-white transition"
                  >
                    {t("deverb.handoffPodcast")} <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/make-song"
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/[0.06] px-4 py-3 text-sm font-bold text-primary hover:bg-primary/10 transition"
                  >
                    {t("deverb.handoffSong")} <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
