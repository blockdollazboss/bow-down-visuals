import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Upload, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, AudioWaveform, Info, RefreshCw, Play, Pause,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── AI Mastering ─────────────────────────────────────────────────────────
   Real DSP mastering chain (ffmpeg): subsonic cleanup → glue compression →
   sweetening EQ → stereo widening → two-pass EBU R128 loudness normalization
   with true-peak limiting. Outputs 24-bit WAV + 320kbps MP3.
   4 credits per master, refunded automatically if the job fails.
   Server-owned background job: safe to close the tab while it runs.
   Honest copy: mastering polishes a mix — it can't fix a bad one. */

const CREDIT_COST = 4;

type PresetKey = "streaming" | "club" | "radio" | "lofi";

const PRESETS: Array<{ key: PresetKey; label: string; blurb: string; spec: string }> = [
  { key: "streaming", label: "Streaming", blurb: "Spotify / Apple Music ready — clean and dynamic.", spec: "-14 LUFS · -1.0 dBTP" },
  { key: "club", label: "Club", blurb: "Loud and punchy for big sound systems.", spec: "-9 LUFS · -1.0 dBTP" },
  { key: "radio", label: "Radio", blurb: "Broadcast-friendly vocal presence.", spec: "-12 LUFS · -1.0 dBTP" },
  { key: "lofi", label: "Lo-Fi", blurb: "Gentle, warm and dynamic with a soft top end.", spec: "-14 LUFS · -1.5 dBTP" },
];

type JobStatus = "idle" | "uploading" | "queued" | "processing" | "done" | "failed";

interface MasteringStats {
  inputLufs: number | null;
  inputTruePeak: number | null;
  inputLra: number | null;
  targetLufs: number | null;
  targetTruePeak: number | null;
  outputLufs: number | null;
}

interface MasteringJobResponse {
  jobId?: string;
  status?: string;
  preset?: PresetKey;
  stats?: MasteringStats;
  wavUrl?: string | null;
  mp3Url?: string | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

function fmtLufs(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)} LUFS` : "—";
}

export default function Mastering() {
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [file, setFile] = useState<File | null>(null);
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [preset, setPreset] = useState<PresetKey>("streaming");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [stats, setStats] = useState<MasteringStats | null>(null);
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
        const data: MasteringJobResponse = await res.json();
        if (!res.ok) return; // keep polling on transient errors
        if (data.status === "done") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setStatus("done");
          setStats(data.stats ?? null);
          setWavUrl(data.wavUrl ?? null);
          setMp3Url(data.mp3Url ?? null);
        } else if (data.status === "failed") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setStatus("failed");
          setError(data.error || "Mastering failed — your credits were refunded.");
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
    const ok = f.type.startsWith("audio/") || /\.(wav|mp3|aiff|aif|flac|m4a|ogg)$/i.test(f.name);
    if (!ok) {
      setError("Please choose an audio file (WAV, MP3, AIFF, FLAC, M4A, OGG).");
      return;
    }
    if (f.size > 100 * 1024 * 1024) {
      setError("That file is over 100 MB — please use a smaller mix.");
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
      const data: MasteringJobResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
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
      setError("Network error — please try again.");
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
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#C9A84C]/15 text-[#f7dd7f]">
            <AudioWaveform className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">AI Mastering</h1>
            <p className="text-sm text-white/45">Release-ready masters from your mix — {CREDIT_COST} credits</p>
          </div>
        </div>

        {/* Honest framing */}
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <Info className="h-4 w-4 text-[#C9A84C]/70 shrink-0 mt-0.5" />
          <p className="text-xs text-white/55 leading-relaxed">
            A real DSP chain — subsonic cleanup, glue compression, sweetening EQ, stereo
            widening, then two-pass loudness normalization with true-peak limiting. It{" "}
            <span className="text-white/80 font-semibold">polishes a good mix; it can't fix a bad one.</span>{" "}
            Trust your ears on the A/B comparison before you ship it.
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
                  <p className="text-xs text-white/40 mt-1">{(file.size / 1024 / 1024).toFixed(1)} MB — click to change</p>
                </div>
              ) : (
                <div>
                  <p className="font-semibold text-white/70">Drop your mix here, or click to browse</p>
                  <p className="text-xs text-white/35 mt-1">WAV, MP3, AIFF, FLAC, M4A, OGG — up to 100 MB</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.wav,.mp3,.aiff,.aif,.flac,.m4a,.ogg"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </div>

            {/* Preset picker */}
            <div>
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">Mastering preset</p>
              <div className="grid grid-cols-2 gap-3">
                {PRESETS.map((p) => (
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
                    <p className={`font-bold text-sm ${preset === p.key ? "text-[#f7dd7f]" : "text-white/80"}`}>{p.label}</p>
                    <p className="text-xs text-white/45 mt-1 leading-relaxed">{p.blurb}</p>
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
              {!user ? "Sign in to master" : `Master my track — ${CREDIT_COST} credits`}
            </button>
            {typeof creditsRemaining === "number" && (
              <p className="text-center text-xs text-white/35">{creditsRemaining} credits remaining</p>
            )}
          </div>
        )}

        {/* Processing */}
        {busy && (
          <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
            <Loader2 className="h-8 w-8 text-[#C9A84C] mx-auto mb-4 animate-spin" />
            <p className="font-bold text-white">
              {status === "uploading" ? "Uploading your mix…" : status === "queued" ? "Queued — warming up the chain…" : "Mastering in progress…"}
            </p>
            <p className="text-xs text-white/40 mt-2">
              Analyzing loudness → two-pass normalization → rendering WAV + MP3. Safe to close this tab — the job runs on the server.
            </p>
          </div>
        )}

        {/* Result: A/B player + loudness stats + downloads */}
        {status === "done" && (
          <div className="mt-6 space-y-5">
            <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <p className="text-sm text-emerald-200/80">Master complete — compare it against your original below.</p>
            </div>

            {/* A/B player */}
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-bold text-white/40 uppercase tracking-wider">Before / After</p>
                <div className="flex rounded-lg border border-white/[0.1] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => flipSide("before")}
                    disabled={!beforeUrl}
                    className={`px-4 py-1.5 text-xs font-bold transition disabled:opacity-30 ${
                      abSide === "before" ? "bg-white/[0.12] text-white" : "text-white/40 hover:text-white/70"
                    }`}
                  >
                    Before
                  </button>
                  <button
                    type="button"
                    onClick={() => flipSide("after")}
                    disabled={!mp3Url}
                    className={`px-4 py-1.5 text-xs font-bold transition disabled:opacity-30 ${
                      abSide === "after" ? "bg-[#C9A84C]/25 text-[#f7dd7f]" : "text-white/40 hover:text-white/70"
                    }`}
                  >
                    After
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
                Listening to: <span className="text-white/60 font-semibold">{abSide === "before" ? "your original mix" : "the mastered version"}</span> — position is preserved when you flip.
              </p>
            </div>

            {/* Loudness stats */}
            {stats && (
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
                <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3">Loudness report</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Mix loudness", value: fmtLufs(stats.inputLufs) },
                    { label: "Master loudness", value: fmtLufs(stats.outputLufs ?? stats.targetLufs) },
                    { label: "True peak (mix)", value: typeof stats.inputTruePeak === "number" ? `${stats.inputTruePeak.toFixed(1)} dBTP` : "—" },
                    { label: "Target ceiling", value: typeof stats.targetTruePeak === "number" ? `${stats.targetTruePeak.toFixed(1)} dBTP` : "—" },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl bg-black/40 border border-white/[0.06] px-3 py-2.5">
                      <p className="text-[10px] text-white/35 uppercase tracking-wider">{s.label}</p>
                      <p className="text-sm font-black text-[#f7dd7f] mt-1 font-mono">{s.value}</p>
                    </div>
                  ))}
                </div>
                {typeof stats.inputLra === "number" && (
                  <p className="text-[11px] text-white/30 mt-3">
                    Dynamic range (mix): <span className="text-white/55 font-mono">{stats.inputLra.toFixed(1)} LU</span> — preserved through the chain, not crushed.
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
              onClick={reset}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.1] py-3 text-sm font-bold text-white/50 hover:text-white/80 hover:bg-white/[0.04] transition"
            >
              <RefreshCw className="h-4 w-4" /> Master another track
            </button>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
