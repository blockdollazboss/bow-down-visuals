/* ─── LUFS Loudness Meter + Normalize ─────────────────────────────────
   Audio-studio loudness tooling: FREE server-side analysis (integrated
   LUFS, LRA, true peak from loudnorm's JSON summary, plus momentary /
   short-term stats from the ebur128 filter), a live in-browser
   K-weighted meter (WebAudio-decoded PCM — real DSP, zero backend
   cost), and a two-pass loudnorm normalize to selectable streaming
   targets. Server-owned background job: safe to close the tab while
   it runs. */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  Upload, Loader2, Download, AlertTriangle, CheckCircle2, AudioWaveform,
  Play, Pause, Volume2, Gauge, RefreshCw, Rocket, SlidersHorizontal, Info,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useHubProject } from "@/lib/hub-project";

export const LUFS_NORMALIZE_CREDIT_COST = 100; // PLACEHOLDER — not user-approved
const LUFS_MAX_BYTES = 50 * 1024 * 1024;
const TARGET_OPTIONS = [-16, -14, -11, -8] as const;
type TargetLufs = (typeof TARGET_OPTIONS)[number];
const DEFAULT_TARGET: TargetLufs = -14;

const TARGET_BLURBS: Record<TargetLufs, string> = {
  "-16": "Podcast / broadcast",
  "-14": "Spotify / YouTube / social",
  "-11": "Loud master",
  "-8": "Club / max loudness",
};

type LufsJobStatus = "idle" | "analyzing" | "uploading" | "queued" | "processing" | "done" | "failed";

interface LoudnessSummary {
  integratedLufs: number | null;
  loudnessRangeLu: number | null;
  truePeakDb: number | null;
  threshold: number | null;
}

interface Ebur128Stats {
  momentaryMax: number | null;
  momentaryMean: number | null;
  shortTermMax: number | null;
  shortTermMean: number | null;
}

interface AnalyzeResponse {
  fileName?: string;
  integratedLufs?: number | null;
  loudnessRangeLu?: number | null;
  truePeakDb?: number | null;
  threshold?: number | null;
  durationSec?: number | null;
  targetLufs?: number;
  ebur128?: Ebur128Stats | null;
  error?: string;
  message?: string;
}

interface NormalizeStartResponse {
  jobId?: string;
  status?: string;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

interface NormalizeJobResponse {
  jobId?: string;
  status?: string;
  outputUrl?: string | null;
  before?: LoudnessSummary | null;
  after?: LoudnessSummary | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

/* ── Browser DSP: decode + waveform peaks ─────────────────────────── */

async function decodeAudioFile(file: File): Promise<AudioBuffer | null> {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const raw = await file.arrayBuffer();
    const audio = await ctx.decodeAudioData(raw);
    await ctx.close().catch(() => {});
    return audio;
  } catch {
    return null;
  }
}

function peaksFromBuffer(audio: AudioBuffer, bars = 140): number[] {
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
  return peaks;
}

function WaveformBars({ peaks, active, color }: { peaks: number[] | null; active: boolean; color: string }) {
  const { t } = useTranslation();
  if (!peaks) {
    return (
      <div className="flex h-16 items-center justify-center gap-1.5 text-xs text-white/30">
        <Volume2 className="h-4 w-4" /> {t("lufs.waveformUnavailable", { defaultValue: "Waveform unavailable" })}
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

/* ── Browser DSP: K-weighting (ITU-R BS.1770) for the live meter ─────
   Stage 1: high shelf +4 dB @ 1680 Hz. Stage 2: 4th-order high-pass
   @ 60 Hz (two cascaded 2nd-order sections). Applied to a mono mix
   of the decoded PCM. LUFS ≈ -0.691 + 10·log10(mean square). This is
   an ungated estimate — the server's integrated number is the
   authoritative measurement. */

interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function designHighShelf(fs: number, f0: number, gainDb: number, S: number): BiquadCoeffs {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / fs;
  const cosW0 = Math.cos(w0);
  const alpha = (Math.sin(w0) / 2) * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
  const sqrtA = Math.sqrt(A);
  const a0 = A + 1 - (A - 1) * cosW0 + 2 * sqrtA * alpha;
  return {
    b0: (A * (A + 1 + (A - 1) * cosW0 + 2 * sqrtA * alpha)) / a0,
    b1: (-2 * A * (A - 1 + (A + 1) * cosW0)) / a0,
    b2: (A * (A + 1 + (A - 1) * cosW0 - 2 * sqrtA * alpha)) / a0,
    a1: (2 * (A - 1 - (A + 1) * cosW0)) / a0,
    a2: (A + 1 - (A - 1) * cosW0 - 2 * sqrtA * alpha) / a0,
  };
}

function designHighPass(fs: number, f0: number, Q: number): BiquadCoeffs {
  const w0 = (2 * Math.PI * f0) / fs;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  const a0 = 1 + alpha;
  const b = (1 + cosW0) / 2;
  return {
    b0: b / a0,
    b1: (-(1 + cosW0)) / a0,
    b2: b / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  };
}

function applyBiquadInPlace(data: Float32Array, c: BiquadCoeffs): void {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let n = 0; n < data.length; n++) {
    const x = data[n];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    data[n] = y;
  }
}

function kWeightedMono(buffer: AudioBuffer): Float32Array {
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const out = new Float32Array(len);
  const nCh = buffer.numberOfChannels;
  for (let ch = 0; ch < nCh; ch++) {
    const d = buffer.getChannelData(ch);
    const g = 1 / nCh;
    for (let i = 0; i < len; i++) out[i] += d[i] * g;
  }
  applyBiquadInPlace(out, designHighShelf(sr, 1680, 4, 0.9));
  applyBiquadInPlace(out, designHighPass(sr, 60, 0.7071));
  applyBiquadInPlace(out, designHighPass(sr, 60, 0.7071));
  return out;
}

function windowedLufs(data: Float32Array, sr: number, centerIdx: number, windowSec: number): number | null {
  const half = Math.floor((windowSec * sr) / 2);
  const start = Math.max(0, centerIdx - half);
  const end = Math.min(data.length, centerIdx + half);
  if (end <= start) return null;
  let sum = 0;
  for (let i = start; i < end; i++) {
    const v = data[i];
    sum += v * v;
  }
  const ms = sum / (end - start);
  if (!(ms > 0)) return null;
  return -0.691 + 10 * Math.log10(ms);
}

function MeterBar({ label, value }: { label: string; value: number | null }) {
  const FLOOR = -60;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, ((value - FLOOR) / -FLOOR) * 100));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-bold uppercase tracking-wider text-white/45">{label}</span>
        <span className="tabular-nums font-bold text-white/85">{value == null ? "—" : `${value.toFixed(1)} LUFS`}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-300 to-red-400 transition-[width] duration-100"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StatCard({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-4 text-center">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/40">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums text-white">
        {value}
        {unit && <span className="ml-1 text-sm font-bold text-white/40">{unit}</span>}
      </p>
    </div>
  );
}

function fmtNum(v: number | null | undefined, digits = 1): string {
  return v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits);
}

export function LufsPanel() {
  const { t } = useTranslation();
  const { addAsset } = useHubProject();
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [targetLufs, setTargetLufs] = useState<TargetLufs>(DEFAULT_TARGET);
  const [format, setFormat] = useState<"wav" | "mp3">("wav");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<LufsJobStatus>("idle");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [before, setBefore] = useState<LoudnessSummary | null>(null);
  const [after, setAfter] = useState<LoudnessSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [ab, setAb] = useState<"original" | "normalized">("normalized");
  const [playing, setPlaying] = useState(false);
  const [origUrl, setOrigUrl] = useState<string | null>(null);
  const [origPeaks, setOrigPeaks] = useState<number[] | null>(null);
  const [normPeaks, setNormPeaks] = useState<number[] | null>(null);

  /* Live meter state */
  const [meterOn, setMeterOn] = useState(false);
  const [meterLevels, setMeterLevels] = useState<{ m: number | null; s: number | null }>({ m: null, s: null });
  const [meterError, setMeterError] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const changeFileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const meterAudioRef = useRef<HTMLAudioElement | null>(null);
  const decodedRef = useRef<AudioBuffer | null>(null);
  const kWeightedRef = useRef<{ data: Float32Array; sr: number } | null>(null);
  const meterUrlRef = useRef<string | null>(null);

  /* Poll the server-owned normalize job until it completes. */
  useEffect(() => {
    if (!jobId || (status !== "queued" && status !== "processing")) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/lufs/normalize/${jobId}`);
        const data: NormalizeJobResponse = await res.json();
        if (!res.ok) {
          setStatus("failed");
          setError(data.error || t("lufs.errorJobNotFound", { defaultValue: "Job not found — it may have expired." }));
          return;
        }
        if (data.status === "done") {
          setStatus("done");
          setOutputUrl(data.outputUrl ?? null);
          setBefore(data.before ?? null);
          setAfter(data.after ?? null);
          if (data.outputUrl) {
            addAsset({ kind: "song", url: data.outputUrl, label: "Loudness-normalized audio", detail: `LUFS · ${targetLufs}` });
          }
        } else if (data.status === "failed") {
          setStatus("failed");
          setError(data.error || t("lufs.errorNormalizeFailed", { defaultValue: "Normalization failed — you were refunded." }));
        } else {
          setStatus(data.status as LufsJobStatus);
        }
      } catch {
        /* keep polling on transient network errors */
      }
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [jobId, status, addAsset, t, targetLufs]);

  /* Live meter loop: read playback position, compute K-weighted
     momentary (400 ms) + short-term (3 s) loudness from decoded PCM. */
  useEffect(() => {
    if (!meterOn) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 100) return;
      last = now;
      const el = meterAudioRef.current;
      const kw = kWeightedRef.current;
      if (!el || !kw || el.paused) return;
      const idx = Math.floor(el.currentTime * kw.sr);
      setMeterLevels({
        m: windowedLufs(kw.data, kw.sr, idx, 0.4),
        s: windowedLufs(kw.data, kw.sr, idx, 3.0),
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [meterOn]);

  /* Stop the meter when the component unmounts. */
  useEffect(() => {
    return () => {
      if (meterUrlRef.current) URL.revokeObjectURL(meterUrlRef.current);
    };
  }, []);

  /* Waveform for the normalized result. */
  useEffect(() => {
    if (!outputUrl) {
      setNormPeaks(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(outputUrl);
        const raw = await res.arrayBuffer();
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const audio = await ctx.decodeAudioData(raw);
        await ctx.close().catch(() => {});
        if (!cancelled) setNormPeaks(peaksFromBuffer(audio));
      } catch {
        if (!cancelled) setNormPeaks(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [outputUrl]);

  async function analyzeFile(f: File) {
    setStatus("analyzing");
    setError(null);
    setAnalysis(null);
    try {
      const form = new FormData();
      form.append("audio", f);
      const res = await confirmedFetch("/api/lufs/analyze", {
        method: "POST",
        body: form,
        skipConfirm: true, // analysis is free
      });
      if (!res) {
        setStatus("idle");
        return;
      }
      const data: AnalyzeResponse = await res.json();
      if (!res.ok) {
        setStatus("failed");
        setError(data.message || data.error || t("lufs.analyzeError", { defaultValue: "Could not analyze this file. Try another audio file." }));
        return;
      }
      setAnalysis(data);
      setStatus("idle");
    } catch {
      setStatus("failed");
      setError(t("lufs.errorNetwork", { defaultValue: "Network hiccup — try again." }));
    }
  }

  async function pickFile(f: File | undefined) {
    if (!f) return;
    const isAudio = f.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name);
    if (!isAudio) {
      setError(t("lufs.errorAudioType", { defaultValue: "Please choose an audio file (MP3, WAV, M4A, AAC, OGG, FLAC)." }));
      return;
    }
    if (f.size > LUFS_MAX_BYTES) {
      setError(t("lufs.errorFileTooLarge", { defaultValue: "That file is over 50 MB. Trim it or pick a smaller file." }));
      return;
    }
    stopMeter();
    setFile(f);
    setError(null);
    setOutputUrl(null);
    setJobId(null);
    setBefore(null);
    setAfter(null);
    setAb("normalized");
    decodedRef.current = null;
    kWeightedRef.current = null;
    setMeterLevels({ m: null, s: null });
    setMeterError(null);
    /* Decode once for the waveform; reuse the buffer for the live meter. */
    const audio = await decodeAudioFile(f);
    if (audio) {
      decodedRef.current = audio;
      setOrigPeaks(peaksFromBuffer(audio));
    } else {
      setOrigPeaks(null);
    }
    const url = URL.createObjectURL(f);
    if (origUrl) URL.revokeObjectURL(origUrl);
    setOrigUrl(url);
    void analyzeFile(f);
  }

  async function startNormalize() {
    if (!file || !user) return;
    stopMeter();
    setStatus("uploading");
    setError(null);
    setOutOfCredits(false);
    try {
      const form = new FormData();
      form.append("audio", file);
      form.append("targetLufs", String(targetLufs));
      form.append("format", format);
      const res = await confirmedFetch("/api/lufs/normalize", {
        method: "POST",
        body: form,
        overrideCost: LUFS_NORMALIZE_CREDIT_COST,
        overrideFeature: "LUFS Loudness Normalize",
      });
      if (!res) {
        setStatus("idle");
        return;
      } // user cancelled the credit confirmation
      const data: NormalizeStartResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || t("lufs.errorStartFailed", { defaultValue: "Could not start normalization. Try again." }));
        return;
      }
      setJobId(data.jobId);
      setStatus("queued");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError(t("lufs.errorNetwork", { defaultValue: "Network hiccup — try again." }));
    }
  }

  /* A/B toggle: swap source while preserving playback position. */
  function toggleAB(next: "original" | "normalized") {
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
      const target = next === "normalized" ? outputUrl : origUrl;
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

  async function startMeter() {
    if (!file || meterOn) return;
    setMeterError(null);
    try {
      const audio = decodedRef.current ?? (await decodeAudioFile(file));
      if (!audio) throw new Error("decode failed");
      decodedRef.current = audio;
      if (!kWeightedRef.current) {
        kWeightedRef.current = { data: kWeightedMono(audio), sr: audio.sampleRate };
      }
      const url = URL.createObjectURL(file);
      if (meterUrlRef.current) URL.revokeObjectURL(meterUrlRef.current);
      meterUrlRef.current = url;
      const el = meterAudioRef.current;
      if (!el) return;
      el.src = url;
      el.currentTime = 0;
      await el.play();
      setMeterOn(true);
    } catch {
      setMeterError(t("lufs.meterDecodeError", { defaultValue: "Could not decode this file for live metering." }));
    }
  }

  function stopMeter() {
    const el = meterAudioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
    }
    if (meterUrlRef.current) {
      URL.revokeObjectURL(meterUrlRef.current);
      meterUrlRef.current = null;
    }
    setMeterOn(false);
  }

  function reset() {
    stopMeter();
    if (origUrl) URL.revokeObjectURL(origUrl);
    setFile(null);
    setOrigUrl(null);
    setOrigPeaks(null);
    setAnalysis(null);
    setJobId(null);
    setStatus("idle");
    setOutputUrl(null);
    setBefore(null);
    setAfter(null);
    setError(null);
    setOutOfCredits(false);
    setAb("normalized");
    setPlaying(false);
    setNormPeaks(null);
    setMeterLevels({ m: null, s: null });
    setMeterError(null);
    decodedRef.current = null;
    kWeightedRef.current = null;
  }

  const busy = status === "analyzing" || status === "uploading" || status === "queued" || status === "processing";
  const delta =
    before?.integratedLufs != null && after?.integratedLufs != null
      ? after.integratedLufs - before.integratedLufs
      : null;

  return (
    <>
      <div className="flex items-center gap-3 mb-2">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Gauge className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-2xl font-black">{t("lufs.title", { defaultValue: "LUFS Loudness Meter" })}</h2>
          <p className="text-sm text-white/45">
            {t("lufs.subtitle", { defaultValue: "Measure true loudness, then normalize to streaming targets — {cost} VB per normalize. Analysis is free.", cost: LUFS_NORMALIZE_CREDIT_COST })}
          </p>
        </div>
      </div>

      {/* Honest framing */}
      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
        <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
        <p className="text-xs text-white/55 leading-relaxed">
          {t("lufs.honestIntro", { defaultValue: "Loudness is measured in LUFS — how loud your track actually feels, not just its peak level." })}{" "}
          <span className="text-white/80 font-semibold">
            {t("lufs.honestStrong", { defaultValue: "Analysis is free; normalization re-measures the output so the numbers are real." })}
          </span>
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

      {/* Upload */}
      {(status === "idle" || status === "failed") && !analysis ? (
        <div className="mt-6">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); void pickFile(e.dataTransfer.files[0]); }}
            className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
              dragOver ? "border-primary/60 bg-primary/5" : "border-white/[0.12] hover:border-white/25"
            }`}
          >
            <Upload className="h-8 w-8 text-white/30 mx-auto mb-3" />
            <div>
              <p className="font-semibold text-white/70">{t("lufs.dropPrompt", { defaultValue: "Drop your audio here or tap to upload" })}</p>
              <p className="text-xs text-white/35 mt-1">{t("lufs.dropFormats", { defaultValue: "MP3 · WAV · M4A · AAC · OGG · FLAC — up to 50 MB" })}</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
              className="hidden"
              onChange={(e) => { void pickFile(e.target.files?.[0]); }}
            />
          </div>
        </div>
      ) : null}

      {/* Analysis results */}
      {analysis && (status === "idle" || status === "failed" || status === "uploading" || status === "queued" || status === "processing") && (
        <div className="mt-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-bold text-white/70">{file?.name}</p>
            <button
              type="button"
              onClick={() => changeFileInputRef.current?.click()}
              className="shrink-0 text-xs font-bold text-white/40 hover:text-white transition"
            >
              {t("lufs.changeFile", { defaultValue: "Change file" })}
            </button>
            <input
              ref={changeFileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
              className="hidden"
              onChange={(e) => { void pickFile(e.target.files?.[0]); }}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <StatCard
              label={t("lufs.statIntegrated", { defaultValue: "Integrated" })}
              value={fmtNum(analysis.integratedLufs)}
              unit="LUFS"
            />
            <StatCard
              label={t("lufs.statLra", { defaultValue: "Loudness range" })}
              value={fmtNum(analysis.loudnessRangeLu)}
              unit="LU"
            />
            <StatCard
              label={t("lufs.statTruePeak", { defaultValue: "True peak" })}
              value={fmtNum(analysis.truePeakDb)}
              unit="dBTP"
            />
          </div>

          {analysis.ebur128 && (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/40 mb-2.5">
                {t("lufs.eburLabel", { defaultValue: "Momentary / short-term (server-measured)" })}
              </p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                <p className="text-white/55">
                  {t("lufs.momentary", { defaultValue: "Momentary" })}{" "}
                  <span className="tabular-nums font-bold text-white/85">
                    {fmtNum(analysis.ebur128.momentaryMax)} / {fmtNum(analysis.ebur128.momentaryMean)} LUFS
                  </span>
                </p>
                <p className="text-white/55">
                  {t("lufs.shortTerm", { defaultValue: "Short-term" })}{" "}
                  <span className="tabular-nums font-bold text-white/85">
                    {fmtNum(analysis.ebur128.shortTermMax)} / {fmtNum(analysis.ebur128.shortTermMean)} LUFS
                  </span>
                </p>
              </div>
              <p className="mt-1.5 text-[11px] text-white/30">
                {t("lufs.eburHint", { defaultValue: "max / average across the whole track." })}
              </p>
            </div>
          )}

          {/* Live in-browser meter */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-white/80 flex items-center gap-2">
                  <AudioWaveform className="h-4 w-4 text-primary" />
                  {t("lufs.liveMeterTitle", { defaultValue: "Live meter (browser)" })}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/35">
                  {t("lufs.liveMeterNote", { defaultValue: "Real-time K-weighted estimate as the file plays — ungated, for feel. The server's integrated number above is the authoritative one." })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => (meterOn ? stopMeter() : void startMeter())}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-black transition hover:brightness-110"
                aria-label={meterOn ? t("lufs.liveMeterStop", { defaultValue: "Stop" }) : t("lufs.liveMeterPlay", { defaultValue: "Play live meter" })}
              >
                {meterOn ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
              </button>
            </div>
            <div className="space-y-3">
              <MeterBar label={t("lufs.momentary", { defaultValue: "Momentary" })} value={meterLevels.m} />
              <MeterBar label={t("lufs.shortTerm", { defaultValue: "Short-term" })} value={meterLevels.s} />
            </div>
            {meterError && <p className="mt-2 text-xs text-red-300/70">{meterError}</p>}
            <audio ref={meterAudioRef} onEnded={stopMeter} className="hidden" />
          </div>

          {/* Normalize controls */}
          {(
            <div className="space-y-5">
              <div data-min-stars="2">
                <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">
                  {t("lufs.targetLabel", { defaultValue: "Normalize target" })}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {TARGET_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setTargetLufs(opt)}
                      className={`rounded-xl border px-3 py-3 text-left transition ${
                        targetLufs === opt
                          ? "border-primary/60 bg-primary/[0.08]"
                          : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                      }`}
                    >
                      <p className={`font-black tabular-nums ${targetLufs === opt ? "text-primary" : "text-white"}`}>
                        {opt} LUFS
                      </p>
                      <p className="text-[11px] text-white/40 mt-0.5 leading-snug">{TARGET_BLURBS[opt]}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">
                  {t("lufs.formatLabel", { defaultValue: "Output format" })}
                </p>
                <div className="flex gap-3">
                  {(["wav", "mp3"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFormat(f)}
                      className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-bold transition ${
                        format === f
                          ? "border-primary/60 bg-primary/[0.08] text-primary"
                          : "border-white/[0.08] bg-white/[0.02] text-white/50 hover:border-white/20"
                      }`}
                    >
                      {f === "wav"
                        ? t("lufs.formatWav", { defaultValue: "WAV (16-bit)" })
                        : t("lufs.formatMp3", { defaultValue: "MP3 (320k)" })}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => void startNormalize()}
                disabled={!file || !user || busy}
                className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("lufs.normalizeButton", { defaultValue: "Normalize to {target} LUFS · {cost} VB", target: targetLufs, cost: LUFS_NORMALIZE_CREDIT_COST })}
              </button>
              {creditsRemaining != null && (
                <p className="text-center text-xs text-white/35">
                  {t("lufs.creditsRemaining", { n: creditsRemaining, defaultValue: "{n} Visual Bucs left" })}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Progress */}
      {busy && status !== "analyzing" && (
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
          <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
          <p className="font-bold text-white">
            {status === "uploading"
              ? t("lufs.statusUploading", { defaultValue: "Uploading…" })
              : status === "queued"
                ? t("lufs.statusQueued", { defaultValue: "Queued — the job runs on the server, safe to leave this tab." })
                : t("lufs.statusProcessing", { defaultValue: "Normalizing to {target} LUFS…", target: targetLufs })}
          </p>
          <p className="text-sm text-white/40 mt-1">
            {t("lufs.progressNote", { defaultValue: "Two-pass loudnorm: measure, correct, then re-measure the output." })}
          </p>
        </div>
      )}
      {status === "analyzing" && (
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
          <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
          <p className="font-bold text-white">{t("lufs.analyzing", { defaultValue: "Measuring loudness…" })}</p>
        </div>
      )}

      {/* Result: before/after + A/B player */}
      {status === "done" && outputUrl && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
            <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
            <p className="text-sm font-semibold text-white/80">
              {t("lufs.normalizeComplete", { defaultValue: "Normalized to {target} LUFS", target: targetLufs })}
              {delta != null && (
                <span className="text-primary"> · {delta >= 0 ? "+" : ""}{delta.toFixed(1)} LU</span>
              )}
            </p>
          </div>

          {/* Before / after measured numbers */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/40 mb-2">
                {t("lufs.before", { defaultValue: "Before" })}
              </p>
              <p className="text-sm tabular-nums text-white/70">
                {fmtNum(before?.integratedLufs)} LUFS · {fmtNum(before?.loudnessRangeLu)} LU · {fmtNum(before?.truePeakDb)} dBTP
              </p>
            </div>
            <div className="rounded-2xl border border-primary/30 bg-primary/[0.04] px-4 py-3.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary/80 mb-2">
                {t("lufs.after", { defaultValue: "After" })}
              </p>
              <p className="text-sm tabular-nums font-bold text-white">
                {fmtNum(after?.integratedLufs)} LUFS · {fmtNum(after?.loudnessRangeLu)} LU · {fmtNum(after?.truePeakDb)} dBTP
              </p>
            </div>
          </div>

          {/* A/B toggle */}
          <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
            {(["original", "normalized"] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => toggleAB(side)}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-bold transition ${
                  ab === side ? "bg-primary text-black" : "text-white/50 hover:text-white/80"
                }`}
              >
                {side === "original"
                  ? t("lufs.abOriginal", { defaultValue: "Original" })
                  : t("lufs.abNormalized", { defaultValue: "Normalized" })}
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
            <div className="flex items-center gap-3 mb-3">
              <button
                type="button"
                onClick={togglePlay}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-black transition hover:brightness-110"
                aria-label={playing ? t("lufs.pause", { defaultValue: "Pause" }) : t("lufs.play", { defaultValue: "Play" })}
              >
                {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
              </button>
              <div className="flex-1">
                <p className="text-xs font-bold text-white/50 uppercase tracking-wider mb-1">
                  {ab === "original"
                    ? t("lufs.labelOriginal", { defaultValue: "Original" })
                    : t("lufs.labelNormalized", { defaultValue: "Normalized" })}
                </p>
                <WaveformBars
                  peaks={ab === "original" ? origPeaks : normPeaks}
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
              {t("lufs.abHint", { defaultValue: "Flip between the two — playback position is kept." })}
            </p>
          </div>

          <div className="flex gap-3">
            <a
              href={outputUrl}
              download={`normalized-${targetLufs}lufs.${format}`}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 font-bold text-black transition hover:brightness-110"
            >
              <Download className="h-4 w-4" /> {t("lufs.downloadButton", { defaultValue: "Download" })}
            </a>
            <button
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
            >
              <RefreshCw className="h-4 w-4" /> {t("lufs.newButton", { defaultValue: "New file" })}
            </button>
          </div>

          {/* Handoff: normalized audio → master tab, then distribute. */}
          <div>
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">
              {t("lufs.handoffTitle", { defaultValue: "Next step" })}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Link
                href="/audio-studio?tab=master"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-primary/40 bg-primary/[0.06] px-5 py-3.5 text-sm font-bold text-primary hover:bg-primary/10 transition-all"
              >
                <SlidersHorizontal className="h-4 w-4" />
                {t("lufs.handoffMaster", { defaultValue: "Send to Master tab →" })}
              </Link>
              <Link
                href="/distribute"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/[0.12] px-5 py-3.5 text-sm font-bold text-white/70 hover:border-white/25 transition-all"
              >
                <Rocket className="h-4 w-4" />
                {t("lufs.handoffDistribute", { defaultValue: "Distribute it →" })}
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
