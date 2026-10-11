import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  Upload, Loader2, Download, AlertTriangle, CheckCircle2,
  AudioWaveform, Info, RefreshCw, Play, Pause, Volume2,
  Wand2, Zap, Music4,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useHubProject } from "@/lib/hub-project";

/* ─── Vocal Tuning / Pitch Correction ───────────────────────────────────
   Two styles, one engine, zero paid calls — real ffmpeg DSP only.
   Transparent: gentle global tuning nudge (low strength, natural slow
   feel — the correction you don't hear). Hard-tune: every detected
   note snapped to its nearest semitone (strength 100, instant retune)
   via per-note rubberband shifts joined by 20 ms crossfades.
   200 Visual Bucs per tune (PLACEHOLDER — not user-approved), refunded
   automatically if the job fails. Server-owned background job: safe to
   close the tab while it runs. Works best on isolated vocals; on a full
   mix the tracker follows the strongest pitched material. */

const VOCAL_TUNE_CREDIT_COST = 200; // PLACEHOLDER — NOT USER-APPROVED (matches vocal-polish)
const VOCAL_TUNE_MAX_BYTES = 50 * 1024 * 1024;

type TuneStyle = "transparent" | "hardtune";

const TUNE_STYLES: Array<{ key: TuneStyle; labelKey: string; blurbKey: string; icon: typeof Wand2 }> = [
  { key: "transparent", labelKey: "vocalTune.styleTransparentLabel", blurbKey: "vocalTune.styleTransparentBlurb", icon: Wand2 },
  { key: "hardtune", labelKey: "vocalTune.styleHardtuneLabel", blurbKey: "vocalTune.styleHardtuneBlurb", icon: Zap },
];

type TuneJobStatus = "idle" | "uploading" | "queued" | "processing" | "done" | "failed";

interface TuneJobResponse {
  jobId?: string;
  status?: string;
  style?: TuneStyle;
  outputUrl?: string | null;
  notesCorrected?: number | null;
  tuningAppliedCents?: number | null;
  hardtuneFallback?: boolean;
  filterPath?: string | null;
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
        <Volume2 className="h-4 w-4" /> {t("vocalTune.waveformUnavailable", { defaultValue: "Waveform unavailable" })}
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

export function VocalTunePanel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { addAsset } = useHubProject();
  const { confirmedFetch } = useConfirmedApi();
  const [file, setFile] = useState<File | null>(null);
  const [style, setStyle] = useState<TuneStyle>("transparent");
  const [keyShift, setKeyShift] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<TuneJobStatus>("idle");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [notesCorrected, setNotesCorrected] = useState<number | null>(null);
  const [hardtuneFallback, setHardtuneFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [ab, setAb] = useState<"original" | "tuned">("tuned");
  const [playing, setPlaying] = useState(false);
  const [origPeaks, setOrigPeaks] = useState<number[] | null>(null);
  const [tunedPeaks, setTunedPeaks] = useState<number[] | null>(null);
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
        const res = await fetch(`/api/vocal-tune/${jobId}`);
        const data: TuneJobResponse = await res.json();
        if (!res.ok) {
          setStatus("failed");
          setError(data.error || t("vocalTune.errorJobNotFound", { defaultValue: "Tuning job not found." }));
          return;
        }
        if (data.status === "done") {
          setStatus("done");
          setOutputUrl(data.outputUrl ?? null);
          setNotesCorrected(typeof data.notesCorrected === "number" ? data.notesCorrected : null);
          setHardtuneFallback(data.hardtuneFallback === true);
          /* The tuned vocal flows into the project for the song flow. */
          if (data.outputUrl) {
            addAsset({
              kind: "song",
              url: data.outputUrl,
              label: "Tuned vocal",
              detail: `Vocal tuning · ${style === "hardtune" ? "Hard-tune" : "Transparent"}`,
            });
          }
        } else if (data.status === "failed") {
          setStatus("failed");
          setError(data.error || t("vocalTune.errorTuneFailed", { defaultValue: "Tuning failed — your Visual Bucs were refunded." }));
        } else {
          setStatus(data.status as TuneJobStatus);
        }
      } catch {
        /* keep polling on transient network errors */
      }
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [jobId, status, style, addAsset, t]);

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

  /* Waveform for the tuned result. */
  useEffect(() => {
    if (!outputUrl) {
      setTunedPeaks(null);
      return;
    }
    void computePeaks(outputUrl).then(setTunedPeaks);
  }, [outputUrl]);

  /* A/B toggle: swap source while preserving playback position. */
  function toggleAB(next: "original" | "tuned") {
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
      const target = next === "tuned" ? outputUrl : origUrl;
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
      setError(t("vocalTune.errorAudioType", { defaultValue: "Please choose an audio file (MP3, WAV, M4A, AAC, OGG, FLAC)." }));
      return;
    }
    if (f.size > VOCAL_TUNE_MAX_BYTES) {
      setError(t("vocalTune.errorFileTooLarge", { defaultValue: "That file is over the 50 MB limit." }));
      return;
    }
    setFile(f);
    setError(null);
    setOutputUrl(null);
    setJobId(null);
    setStatus("idle");
    setAb("tuned");
    setNotesCorrected(null);
    setHardtuneFallback(false);
  }

  async function startTune() {
    if (!file || !user) return;
    setStatus("uploading");
    setError(null);
    setOutOfCredits(false);
    try {
      const form = new FormData();
      form.append("audio", file);
      form.append("style", style);
      form.append("keyShift", String(keyShift));
      /* credit-costs.ts has no /api/vocal-tune entry (owned by another
         agent) — override so the confirm popup shows the real cost. */
      const res = await confirmedFetch("/api/vocal-tune", {
        method: "POST",
        body: form,
        overrideCost: VOCAL_TUNE_CREDIT_COST,
        overrideFeature: "Vocal Tuning",
      });
      if (!res) { setStatus("idle"); return; } // user cancelled the credit confirmation
      const data: TuneJobResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || t("vocalTune.errorStartFailed", { defaultValue: "Couldn't start tuning. Please try again." }));
        return;
      }
      setJobId(data.jobId);
      setStatus("queued");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError(t("vocalTune.errorNetwork", { defaultValue: "Network error — please try again." }));
    }
  }

  function reset() {
    setFile(null);
    setJobId(null);
    setStatus("idle");
    setOutputUrl(null);
    setError(null);
    setOutOfCredits(false);
    setAb("tuned");
    setPlaying(false);
    setNotesCorrected(null);
    setHardtuneFallback(false);
    setKeyShift(0);
  }

  const busy = status === "uploading" || status === "queued" || status === "processing";
  const styleLabel = style === "hardtune"
    ? t("vocalTune.styleHardtuneLabel", { defaultValue: "Hard-tune" })
    : t("vocalTune.styleTransparentLabel", { defaultValue: "Transparent" });

  return (
    <>
      <div className="flex items-center gap-3 mb-2">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <AudioWaveform className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-2xl font-black">{t("vocalTune.title", { defaultValue: "Vocal Tuning" })}</h2>
          <p className="text-sm text-white/45">{t("vocalTune.subtitle", { cost: VOCAL_TUNE_CREDIT_COST, defaultValue: `Pitch correction, two flavors — ${VOCAL_TUNE_CREDIT_COST} Visual Bucs` })}</p>
        </div>
      </div>

      {/* Honest framing */}
      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
        <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
        <p className="text-xs text-white/55 leading-relaxed">
          {t("vocalTune.honestIntro", { defaultValue: "Real pitch DSP, no AI guessing. Works best on isolated vocals — on a full mix it follows the strongest pitched sound. It can't fix a wrong melody, only pull sung notes toward the right pitch." })}
        </p>
      </div>

      {outOfCredits && (
        <div className="mt-4"><OutOfCredits /></div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Upload + style select */}
      {status === "idle" || status === "failed" ? (
        <div className="mt-6 space-y-5">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files[0]); }}
            className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
              dragOver ? "border-primary/60 bg-primary/5" : "border-white/10 hover:border-white/25"
            }`}
          >
            <Upload className="h-8 w-8 text-white/30 mx-auto mb-3" />
            {file ? (
              <div>
                <p className="font-semibold text-white">{file.name}</p>
                <p className="text-xs text-white/40 mt-1">{t("vocalTune.fileSizeChange", { size: (file.size / 1024 / 1024).toFixed(1), defaultValue: `${(file.size / 1024 / 1024).toFixed(1)} MB — tap to change` })}</p>
              </div>
            ) : (
              <div>
                <p className="font-semibold text-white/70">{t("vocalTune.dropPrompt", { defaultValue: "Drop your vocal here, or tap to browse" })}</p>
                <p className="text-xs text-white/35 mt-1">{t("vocalTune.dropFormats", { defaultValue: "MP3 · WAV · M4A · AAC · OGG · FLAC — up to 50 MB. Isolated vocals tune best." })}</p>
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

          {/* Style picker */}
          <div>
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">{t("vocalTune.styleLabel", { defaultValue: "Tuning style" })}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {TUNE_STYLES.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setStyle(s.key)}
                    className={`rounded-xl border px-4 py-3.5 text-left transition ${
                      style === s.key
                        ? "border-primary/60 bg-primary/[0.08]"
                        : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <Icon className={`h-5 w-5 mb-2 ${style === s.key ? "text-primary" : "text-white/40"}`} />
                    <p className="font-bold text-white text-sm">{t(s.labelKey, { defaultValue: s.key })}</p>
                    <p className="text-xs text-white/40 mt-1 leading-relaxed">{t(s.blurbKey, { defaultValue: "" })}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Key shift (advanced) */}
          <div data-min-stars="3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider">{t("vocalTune.keyShiftLabel", { defaultValue: "Key shift" })}</p>
              <p className="text-xs font-bold text-primary">{keyShift > 0 ? `+${keyShift}` : keyShift} {t("vocalTune.semitones", { defaultValue: "st" })}</p>
            </div>
            <input
              type="range"
              min={-6}
              max={6}
              step={1}
              value={keyShift}
              onChange={(e) => setKeyShift(Number(e.target.value))}
              className="w-full accent-[#C9A84C]"
              aria-label={t("vocalTune.keyShiftLabel", { defaultValue: "Key shift" })}
            />
            <p className="text-[11px] text-white/30 mt-1">{t("vocalTune.keyShiftHint", { defaultValue: "Move the whole vocal up or down — formants preserved, no chipmunk effect." })}</p>
          </div>

          <button
            onClick={startTune}
            disabled={!file || !user}
            className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("vocalTune.tuneButton", { cost: VOCAL_TUNE_CREDIT_COST, defaultValue: `Tune my vocal — ${VOCAL_TUNE_CREDIT_COST} Visual Bucs` })}
          </button>
          {creditsRemaining != null && (
            <p className="text-center text-xs text-white/35">{t("vocalTune.creditsRemaining", { n: creditsRemaining, defaultValue: `${creditsRemaining} Visual Bucs left` })}</p>
          )}
        </div>
      ) : null}

      {/* Progress */}
      {busy && (
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
          <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
          <p className="font-bold text-white">
            {status === "uploading"
              ? t("vocalTune.statusUploading", { defaultValue: "Uploading…" })
              : status === "queued"
                ? t("vocalTune.statusQueued", { defaultValue: "In the tuning queue…" })
                : t("vocalTune.statusTuning", { style: styleLabel, defaultValue: `Tuning — ${styleLabel}…` })}
          </p>
          <p className="text-sm text-white/40 mt-1">
            {t("vocalTune.progressNote", { defaultValue: "This runs on our servers — feel free to close this tab, your tuned vocal will be waiting." })}
          </p>
        </div>
      )}

      {/* Result: A/B player */}
      {status === "done" && outputUrl && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
            <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
            <p className="text-sm font-semibold text-white/80">
              {t("vocalTune.tuneComplete", { style: styleLabel, defaultValue: `Tuning complete — ${styleLabel}` })}
              {notesCorrected != null && notesCorrected > 0 && (
                <span className="text-primary">{t("vocalTune.notesSnapped", { n: notesCorrected, defaultValue: ` · ${notesCorrected} notes snapped` })}</span>
              )}
            </p>
          </div>

          {hardtuneFallback && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-400">
                {t("vocalTune.hardtuneFallbackNote", { defaultValue: "Note-level tracking couldn't lock onto this audio, so we applied a gentle global tune instead — no charge difference, and your Bucs were still only spent once." })}
              </p>
            </div>
          )}

          {/* A/B toggle */}
          <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
            {(["original", "tuned"] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => toggleAB(side)}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-bold transition ${
                  ab === side ? "bg-primary text-black" : "text-white/50 hover:text-white/80"
                }`}
              >
                {side === "original"
                  ? t("vocalTune.abOriginal", { defaultValue: "Original" })
                  : t("vocalTune.abTuned", { defaultValue: "Tuned" })}
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
            <div className="flex items-center gap-3 mb-3">
              <button
                type="button"
                onClick={togglePlay}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-black transition hover:brightness-110"
                aria-label={playing ? t("vocalTune.pause", { defaultValue: "Pause" }) : t("vocalTune.play", { defaultValue: "Play" })}
              >
                {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
              </button>
              <div className="flex-1">
                <p className="text-xs font-bold text-white/50 uppercase tracking-wider mb-1">
                  {ab === "original"
                    ? t("vocalTune.labelOriginal", { defaultValue: "Original vocal" })
                    : t("vocalTune.labelTuned", { defaultValue: "Tuned vocal" })}
                </p>
                <WaveformBars
                  peaks={ab === "original" ? origPeaks : tunedPeaks}
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
              {t("vocalTune.abHint", { defaultValue: "Flip between the two to hear exactly what the tuning changed." })}
            </p>
          </div>

          <div className="flex gap-3">
            <a
              href={outputUrl}
              download={`tuned-vocal-${style}.mp3`}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 font-bold text-black transition hover:brightness-110"
            >
              <Download className="h-4 w-4" /> {t("vocalTune.downloadButton", { defaultValue: "Download tuned vocal" })}
            </a>
            <button
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
            >
              <RefreshCw className="h-4 w-4" /> {t("vocalTune.newTuneButton", { defaultValue: "New tune" })}
            </button>
          </div>

          {/* Handoff: tuned vocal → song flow */}
          <Link
            href="/create?panel=song"
            className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-primary/40 bg-primary/[0.06] px-6 py-3.5 text-sm font-bold text-primary hover:bg-primary/10 transition-all"
          >
            <Music4 className="h-4 w-4" />
            {t("vocalTune.songHandoff", { defaultValue: "Use this vocal in a song →" })}
          </Link>
        </div>
      )}
    </>
  );
}
