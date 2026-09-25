import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Upload, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, Captions, Info, Sparkles,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";

/* ─── AI Caption Styler ───────────────────────────────────────────────────
   Upload a video → AI transcribes with word-level timestamps → animated
   word-by-word captions burned in, Hormozi-style. Real ffmpeg + ASS
   karaoke rendering — never faked. 3 credits per video, refunded
   automatically if the job fails. Server-owned background job: safe to
   close the tab while it runs. */

const CREDIT_COST = 3;

type StyleKey = "hormozi" | "minimal" | "karaoke" | "neon" | "luxury-gold";
type PositionKey = "top" | "middle" | "bottom";
type FontSizeKey = "small" | "medium" | "large";

const STYLES: Array<{ key: StyleKey; label: string; blurb: string }> = [
  { key: "hormozi", label: "Hormozi", blurb: "Bold pop — the TikTok/Reels look" },
  { key: "minimal", label: "Minimal", blurb: "Clean and quiet" },
  { key: "karaoke", label: "Karaoke", blurb: "Classic word sweep" },
  { key: "neon", label: "Neon", blurb: "Glowing cyan pop" },
  { key: "luxury-gold", label: "Luxury Gold", blurb: "Gold-on-black brand style" },
];

const POSITIONS: Array<{ key: PositionKey; label: string }> = [
  { key: "top", label: "Top" },
  { key: "middle", label: "Middle" },
  { key: "bottom", label: "Bottom" },
];

const FONT_SIZES: Array<{ key: FontSizeKey; label: string }> = [
  { key: "small", label: "Small" },
  { key: "medium", label: "Medium" },
  { key: "large", label: "Large" },
];

type JobStatus = "idle" | "uploading" | "queued" | "transcribing" | "rendering" | "done" | "failed";

interface StylerJobResponse {
  jobId?: string;
  status?: string;
  outputUrl?: string | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

export default function CaptionStyler() {
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [file, setFile] = useState<File | null>(null);
  const [style, setStyle] = useState<StyleKey>("hormozi");
  const [position, setPosition] = useState<PositionKey>("bottom");
  const [fontSize, setFontSize] = useState<FontSizeKey>("medium");
  const [withEmoji, setWithEmoji] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const pollRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Poll the server-owned job until it completes. Tab-safe: the job
     lives on the server, so closing this page loses nothing. */
  useEffect(() => {
    if (!jobId || !["queued", "transcribing", "rendering"].includes(status)) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/caption-styler/${jobId}`);
        const data: StylerJobResponse = await res.json();
        if (!res.ok) {
          setStatus("failed");
          setError(data.error || "Job not found");
          return;
        }
        if (data.status === "done") {
          setStatus("done");
          setOutputUrl(data.outputUrl ?? null);
        } else if (data.status === "failed") {
          setStatus("failed");
          setError(data.error || "Caption styling failed — your 3 credits were refunded.");
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

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      setError("Please choose a video file.");
      return;
    }
    if (f.size > 80 * 1024 * 1024) {
      setError("This video exceeds the 80 MB upload limit.");
      return;
    }
    setFile(f);
    setError(null);
    setOutputUrl(null);
    setJobId(null);
    setStatus("idle");
  }

  async function startStyling() {
    if (!file || !user) return;
    setStatus("uploading");
    setError(null);
    setOutOfCredits(false);
    try {
      const form = new FormData();
      form.append("video", file);
      form.append("style", style);
      form.append("position", position);
      form.append("fontSize", fontSize);
      form.append("withEmoji", withEmoji ? "true" : "false");
      const res = await confirmedFetch("/api/caption-styler", {
        method: "POST",
        body: form,
        overrideCost: CREDIT_COST, // registry is stale at 1; backend + UI agree on 3
        overrideFeature: "Caption Styler",
      });
      if (!res) { setStatus("idle"); return; } // user cancelled the credit confirmation
      const data: StylerJobResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || "Could not start the caption job.");
        return;
      }
      setJobId(data.jobId);
      setStatus((data.status as JobStatus) || "queued");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError("Network error — please try again.");
    }
  }

  const busy = ["uploading", "queued", "transcribing", "rendering"].includes(status);
  const statusLabel: Record<string, string> = {
    uploading: "Uploading…",
    queued: "Queued…",
    transcribing: "Transcribing your video…",
    rendering: "Burning in captions…",
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-amber-300">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>

        <div className="mt-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-yellow-600">
            <Captions className="h-6 w-6 text-black" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              AI <span className="bg-gradient-to-r from-amber-300 to-yellow-500 bg-clip-text text-transparent">Caption Styler</span>
            </h1>
            <p className="text-sm text-zinc-400">Hormozi-style animated captions, burned into your video.</p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-amber-500/20 bg-zinc-950 p-6">
          {/* Upload */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition ${
              dragOver ? "border-amber-400 bg-amber-400/5" : "border-zinc-700 hover:border-amber-500/50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            <Upload className="mx-auto h-8 w-8 text-amber-400" />
            <p className="mt-3 font-medium">{file ? file.name : "Drop your video here or click to browse"}</p>
            <p className="mt-1 text-xs text-zinc-500">MP4, MOV, WebM — up to 80 MB</p>
          </div>

          {/* Style presets */}
          <p className="mt-6 text-sm font-semibold text-zinc-300">Caption style</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {STYLES.map((s) => (
              <button
                key={s.key}
                onClick={() => setStyle(s.key)}
                className={`rounded-xl border p-3 text-left transition ${
                  style === s.key
                    ? "border-amber-400 bg-amber-400/10"
                    : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
                }`}
              >
                <p className="text-sm font-semibold">{s.label}</p>
                <p className="mt-0.5 text-xs text-zinc-500">{s.blurb}</p>
              </button>
            ))}
          </div>

          {/* Position + size */}
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-semibold text-zinc-300">Position</p>
              <div className="mt-2 flex gap-2">
                {POSITIONS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setPosition(p.key)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                      position === p.key
                        ? "border-amber-400 bg-amber-400/10 text-amber-200"
                        : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-300">Font size</p>
              <div className="mt-2 flex gap-2">
                {FONT_SIZES.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFontSize(f.key)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                      fontSize === f.key
                        ? "border-amber-400 bg-amber-400/10 text-amber-200"
                        : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Emoji toggle */}
          <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3">
            <input
              type="checkbox"
              checked={withEmoji}
              onChange={(e) => setWithEmoji(e.target.checked)}
              className="h-4 w-4 accent-amber-400"
            />
            <span className="text-sm">
              <span className="font-semibold">Auto-emoji</span>{" "}
              <span className="text-zinc-500">— adds 🔥💰👑 where the words call for it (beta)</span>
            </span>
          </label>

          {/* Action */}
          <button
            onClick={startStyling}
            disabled={!file || !user || busy}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-600 px-6 py-3 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
            {busy ? statusLabel[status] ?? "Working…" : `Style my captions · ${CREDIT_COST} credits`}
          </button>
          {!user && (
            <p className="mt-2 text-center text-xs text-zinc-500">
              <Link href="/login" className="text-amber-300 underline">Sign in</Link> to style captions.
            </p>
          )}

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {status === "done" && outputUrl && (
            <div className="mt-4 rounded-xl border border-green-500/30 bg-green-500/10 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-green-200">
                <CheckCircle2 className="h-4 w-4" /> Your captioned video is ready
              </p>
              <video src={outputUrl} controls className="mt-3 w-full rounded-lg" />
              <a
                href={outputUrl}
                download
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-green-500 px-4 py-2 text-sm font-bold text-black hover:brightness-110"
              >
                <Download className="h-4 w-4" /> Download MP4
              </a>
            </div>
          )}

          {typeof creditsRemaining === "number" && (
            <p className="mt-3 text-center text-xs text-zinc-500">{creditsRemaining} credits remaining</p>
          )}
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-xs text-zinc-500">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p>
            Captions are generated from AI transcription with word-level timing and burned in with
            real karaoke highlighting. If your video has no clear speech, the job is refunded
            automatically. Emoji rendering depends on system fonts.
          </p>
        </div>
      </main>
      <SiteFooter />

      {outOfCredits && (
        <div className="mt-4">
          <OutOfCredits />
        </div>
      )}
    </div>
  );
}
