import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Upload, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, Mic2, Info, RefreshCw, Music2, AudioLines,
  Play, Pause, MicOff,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── AI Vocal Remover ──────────────────────────────────────────────────
   Upload any song → true Demucs stem separation → instrumental MP3 +
   acapella MP3. Key and tempo are preserved (separation reassigns
   time-frequency bins; nothing is time-stretched or pitch-shifted).
   Optional karaoke mode adds Whisper word-timing lyrics synced to the
   instrumental. 3 credits per song, refunded automatically if the job
   fails. Server-owned background job: safe to close the tab while it runs. */

const CREDIT_COST = 3;
const MAX_MB = 25;

type JobStatus = "idle" | "uploading" | "queued" | "processing" | "done" | "failed";

interface KaraokeWord {
  word: string;
  start: number;
  end: number;
}

interface JobResponse {
  jobId?: string;
  status?: string;
  instrumentalUrl?: string | null;
  acapellaUrl?: string | null;
  karaokeUrl?: string | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

export default function VocalRemover() {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [karaoke, setKaraoke] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [instrumentalUrl, setInstrumentalUrl] = useState<string | null>(null);
  const [acapellaUrl, setAcapellaUrl] = useState<string | null>(null);
  const [words, setWords] = useState<KaraokeWord[] | null>(null);
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
        const data: JobResponse = await res.json();
        if (!res.ok) {
          setStatus("failed");
          setError(data.error || "Job not found");
          return;
        }
        if (data.status === "done") {
          setStatus("done");
          setInstrumentalUrl(data.instrumentalUrl ?? null);
          setAcapellaUrl(data.acapellaUrl ?? null);
          if (data.karaokeUrl) {
            try {
              const kr = await fetch(data.karaokeUrl);
              const kj = (await kr.json()) as { words?: KaraokeWord[] };
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
          setError(data.error || "Vocal removal failed — your 3 credits were refunded.");
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
      setError("Please choose an audio file (MP3 or WAV).");
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setError(`This audio exceeds the ${MAX_MB} MB upload limit.`);
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
      const res = await fetch("/api/vocal-removal", { method: "POST", body: form });
      const data: JobResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || "Could not start vocal removal.");
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
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Mic2 className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">AI Vocal Remover</h1>
            <p className="text-sm text-white/45">Instrumental + acapella from any song — {CREDIT_COST} credits</p>
          </div>
        </div>

        {/* Honest framing — true separation, limits stated up front */}
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
          <p className="text-xs text-white/55 leading-relaxed">
            True AI stem separation (Demucs) — not a vocal filter.{" "}
            <span className="text-white/80 font-semibold">Key and tempo are preserved.</span>{" "}
            Heavily reverbed or whispered vocals may leave faint artifacts, and dense
            harmonies can bleed slightly into the instrumental. Only use on songs you
            own or have the rights to edit.
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
                  <p className="text-xs text-white/40 mt-1">{(file.size / 1024 / 1024).toFixed(1)} MB — click to change</p>
                </div>
              ) : (
                <div>
                  <p className="font-semibold text-white/70">Drop a song here, or click to browse</p>
                  <p className="text-xs text-white/35 mt-1">MP3 or WAV — up to {MAX_MB} MB</p>
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
            <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3.5">
              <input
                type="checkbox"
                checked={karaoke}
                onChange={(e) => setKaraoke(e.target.checked)}
                className="mt-1 h-4 w-4 accent-[#C9A84C]"
              />
              <span>
                <span className="block font-bold text-white text-sm">Karaoke mode</span>
                <span className="block text-xs text-white/40 mt-0.5">
                  Adds word-synced lyrics to sing along with the instrumental (AI transcription, included free).
                </span>
              </span>
            </label>

            <button
              onClick={startRemoval}
              disabled={!file || !user}
              className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Remove vocals · {CREDIT_COST} credits
            </button>
            {creditsRemaining != null && (
              <p className="text-center text-xs text-white/35">{creditsRemaining} credits remaining</p>
            )}
          </div>
        ) : null}

        {/* Progress */}
        {busy && (
          <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
            <p className="font-bold text-white">
              {status === "uploading" ? "Uploading…" : status === "queued" ? "In the separation queue…" : "Separating stems…"}
            </p>
            <p className="text-sm text-white/40 mt-1">
              AI stem separation takes a few minutes on full songs. This runs on our
              servers — safe to close this tab. Your stems will be waiting here.
            </p>
          </div>
        )}

        {/* Result */}
        {status === "done" && instrumentalUrl && acapellaUrl && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
              <p className="text-sm font-semibold text-white/80">Vocals removed — two stems ready</p>
            </div>

            {/* Instrumental */}
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-4">
              <div className="flex items-center gap-2.5 mb-3">
                <Music2 className="h-4 w-4 text-primary" />
                <p className="font-bold text-white text-sm">Instrumental</p>
                <span className="text-[10px] uppercase tracking-wider text-white/30">karaoke-ready</span>
              </div>
              <audio src={instrumentalUrl} controls className="w-full" />
              <a
                href={instrumentalUrl}
                download="instrumental.mp3"
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
              >
                <Download className="h-4 w-4" /> Download instrumental
              </a>
            </div>

            {/* Acapella */}
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-4">
              <div className="flex items-center gap-2.5 mb-3">
                <AudioLines className="h-4 w-4 text-primary" />
                <p className="font-bold text-white text-sm">Acapella</p>
                <span className="text-[10px] uppercase tracking-wider text-white/30">isolated vocals</span>
              </div>
              <audio src={acapellaUrl} controls className="w-full" />
              <a
                href={acapellaUrl}
                download="acapella.mp3"
                className="mt-3 inline-flex items-center gap-2 rounded-xl border border-white/[0.12] px-5 py-2.5 text-sm font-semibold text-white/70 hover:border-white/25 transition"
              >
                <Download className="h-4 w-4" /> Download acapella
              </a>
            </div>

            {/* Karaoke player */}
            {words && words.length > 0 && (
              <div className="rounded-2xl border border-primary/25 bg-primary/[0.04] px-5 py-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <MicOff className="h-4 w-4 text-primary" />
                    <p className="font-bold text-white text-sm">Karaoke mode</p>
                  </div>
                  <button
                    onClick={toggleKaraokePlay}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
                  >
                    {karaokePlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    {karaokePlaying ? "Pause" : "Sing along"}
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
                  Lyrics auto-transcribed from the vocals — check against the official lyrics for performance use.
                </p>
              </div>
            )}
            {karaokeMissing && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-200/70">
                  Karaoke lyrics couldn't be generated for this song (transcription unavailable) —
                  your instrumental and acapella are unaffected.
                </p>
              </div>
            )}

            <button
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
            >
              <RefreshCw className="h-4 w-4" /> New song
            </button>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
