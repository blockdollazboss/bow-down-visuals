import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Upload, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, AudioWaveform, Info, RefreshCw, Play, Pause,
  Volume2, VolumeX, SlidersHorizontal, Music4,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

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

const STEMS: Array<{ key: StemKey; label: string; blurb: string; accent: string }> = [
  { key: "vocals", label: "Vocals", blurb: "Lead & backing voices", accent: "text-amber-300" },
  { key: "drums", label: "Drums", blurb: "Kick, snare, hats, cymbals", accent: "text-red-300" },
  { key: "bass", label: "Bass", blurb: "Bass guitar & sub", accent: "text-emerald-300" },
  { key: "other", label: "Melody / Other", blurb: "Keys, guitars, synths, FX", accent: "text-sky-300" },
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
  const { user } = useAuth();
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
          setError(data.error || "Job not found");
          return;
        }
        if (data.status === "done") {
          setStatus("done");
          setStems(data.stems ?? null);
        } else if (data.status === "failed") {
          setStatus("failed");
          setError(data.error || "Stem splitting failed — your 4 credits were refunded.");
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
    const els = STEMS.map((s) => audioRefs.current[s.key]).filter(Boolean) as HTMLAudioElement[];
    if (next) {
      // Align all stems to the furthest-played position before starting.
      const t = Math.max(...els.map((e) => e.currentTime));
      els.forEach((e) => {
        e.currentTime = t;
        e.muted = effectiveMuted((e.dataset.stem as StemKey) ?? "vocals");
        void e.play().catch(() => {});
      });
    } else {
      els.forEach((e) => e.pause());
    }
    setPlaying(next);
  }

  function seekAll(ratio: number) {
    const els = STEMS.map((s) => audioRefs.current[s.key]).filter(Boolean) as HTMLAudioElement[];
    const dur = els[0]?.duration;
    if (!dur || !Number.isFinite(dur)) return;
    els.forEach((e) => { e.currentTime = ratio * dur; });
    setProgress(ratio);
  }

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("audio/")) {
      setError("Please choose an audio file (MP3, WAV, FLAC, M4A, OGG).");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("This file exceeds the 25 MB upload limit.");
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
      const res = await fetch("/api/stems", { method: "POST", body: form });
      const data: StemJobResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || "Could not start stem splitting.");
        return;
      }
      setJobId(data.jobId);
      setStatus("queued");
      setSourceName(file.name);
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError("Network error — please try again.");
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
        setRemixError(data.error || "Remix failed — please try again.");
        return;
      }
      setRemixUrl(data.url);
    } catch {
      setRemixError("Network error — please try again.");
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
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <AudioWaveform className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">AI Stem Splitter</h1>
            <p className="text-sm text-white/45">Vocals · Drums · Bass · Melody — {CREDIT_COST} credits per song</p>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
          <p className="text-xs text-white/55 leading-relaxed">
            Real Demucs 4-stem separation running on our servers — the same engine
            producers use to pull acapellas and instrumentals. Splits take a few
            minutes depending on song length (capped at 10 minutes). Your 4 credits
            are refunded automatically if the split fails.
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
                  <p className="text-xs text-white/40 mt-1">{(file.size / 1024 / 1024).toFixed(1)} MB — click to change</p>
                </div>
              ) : (
                <div>
                  <p className="font-semibold text-white/70">Drop a song here, or click to browse</p>
                  <p className="text-xs text-white/35 mt-1">MP3, WAV, FLAC, M4A, OGG — up to 25 MB · 10 min max</p>
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
              Split into 4 stems · {CREDIT_COST} credits
            </button>
            {creditsRemaining != null && (
              <p className="text-center text-xs text-white/35">{creditsRemaining} credits remaining</p>
            )}
          </div>
        )}

        {/* Progress */}
        {busy && (
          <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
            <p className="font-bold text-white">
              {status === "uploading" ? "Uploading…" : status === "queued" ? "In the split queue…" : "Separating stems…"}
            </p>
            <p className="text-sm text-white/40 mt-1">
              Demucs is pulling your song apart on our servers — this takes a few minutes.
              Safe to close this tab; your stems will be waiting here.
            </p>
            {sourceName && <p className="text-xs text-white/30 mt-2">{sourceName}</p>}
          </div>
        )}

        {/* Result — per-stem player */}
        {status === "done" && stems && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
              <p className="text-sm font-semibold text-white/80">Split complete — 4 stems ready</p>
            </div>

            {/* Master transport */}
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-4">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => syncPlayback(!playing)}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-black transition hover:brightness-110"
                  title={playing ? "Pause all stems" : "Play all stems"}
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
                    {solo ? `Soloing ${STEMS.find((s) => s.key === solo)?.label}` : "All stems"} ·
                    click the bar to seek — every stem stays in sync
                  </p>
                </div>
              </div>
            </div>

            {/* Stem cards */}
            <div className="grid gap-3 sm:grid-cols-2">
              {STEMS.map((s) => (
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
                      title={`Download ${s.label} (WAV)`}
                    >
                      <Download className="h-3.5 w-3.5" /> WAV
                    </a>
                  </div>
                  <audio
                    ref={(el) => { audioRefs.current[s.key] = el; }}
                    data-stem={s.key}
                    src={stems[s.key]}
                    preload="auto"
                    onEnded={() => setPlaying(false)}
                  />
                  <div className="mt-2.5 flex gap-2">
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
                      title={muted[s.key] ? `Unmute ${s.label}` : `Mute ${s.label}`}
                    >
                      {muted[s.key] && !solo ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                      {muted[s.key] && !solo ? "Muted" : "Mute"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const nextSolo = solo === s.key ? null : s.key;
                        setSolo(nextSolo);
                        STEMS.forEach((st) => {
                          const el = audioRefs.current[st.key];
                          if (el) el.muted = nextSolo ? st.key !== nextSolo : muted[st.key];
                        });
                      }}
                      className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-black tracking-wider transition ${
                        solo === s.key
                          ? "border-primary/60 bg-primary/15 text-primary"
                          : "border-white/[0.08] text-white/50 hover:border-white/20 hover:text-white/80"
                      }`}
                      title={solo === s.key ? `Stop soloing ${s.label}` : `Solo ${s.label}`}
                    >
                      SOLO
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Remix mode */}
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-4">
              <button
                type="button"
                onClick={() => setRemixOpen((v) => !v)}
                className="flex w-full items-center justify-between"
              >
                <span className="flex items-center gap-2 font-bold text-white">
                  <SlidersHorizontal className="h-4 w-4 text-primary" />
                  Remix mode
                  <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-bold text-green-300">FREE</span>
                </span>
                <span className="text-xs text-white/40">{remixOpen ? "Hide" : "Show"}</span>
              </button>
              {remixOpen && (
                <div className="mt-4 space-y-3">
                  <p className="text-xs text-white/40">
                    Rebalance the four stems into your own custom mix. 0% mutes a stem,
                    100% is its original level, up to 200% boosts it.
                  </p>
                  {STEMS.map((s) => (
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
                      {remixing ? "Mixing…" : "Export custom mix"}
                    </button>
                    {remixUrl && (
                      <a
                        href={remixUrl}
                        download="remix.wav"
                        className="inline-flex items-center gap-2 rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm font-bold text-green-300 transition hover:bg-green-500/20"
                      >
                        <Download className="h-4 w-4" /> Download mix
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
              <RefreshCw className="h-4 w-4" /> Split another song
            </button>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
