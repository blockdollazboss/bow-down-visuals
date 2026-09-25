import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Upload, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, MonitorUp, Info, RefreshCw,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── Video Upscaler ──────────────────────────────────────────────────────
   Honest CPU upscaling: ffmpeg Lanczos resampling to 1080p or 4K.
   It increases resolution while preserving aspect ratio — it does NOT
   invent detail that wasn't in the source. The copy on this page must
   never say "enhance" or "AI upscale". 3 credits per upscale, refunded
   automatically if the job fails. Server-owned background job: safe to
   close the tab while it runs. */

const CREDIT_COST = 3;

type TargetKey = "1080p" | "4k";

const TARGETS: Array<{ key: TargetKey; label: string; blurb: string }> = [
  { key: "1080p", label: "1080p Full HD", blurb: "Crisp for socials & YouTube" },
  { key: "4k", label: "4K Ultra HD", blurb: "Maximum sharpness for premieres" },
];

type JobStatus = "idle" | "uploading" | "queued" | "processing" | "done" | "failed";

interface UpscaleJobResponse {
  jobId?: string;
  status?: string;
  outputUrl?: string | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

export default function Upscale() {
  usePageTitle("Video Upscaler", "Upscale your videos to crisp HD and 4K quality with AI.");
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState<TargetKey>("1080p");
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
     lives on the server, so closing this page loses nothing — reopening
     won't resume polling, but the output stays in your library. */
  useEffect(() => {
    if (!jobId || (status !== "queued" && status !== "processing")) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/upscale/${jobId}`);
        const data: UpscaleJobResponse = await res.json();
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
          setError(data.error || "Upscale failed — your 3 credits were refunded.");
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

  async function startUpscale() {
    if (!file || !user) return;
    setStatus("uploading");
    setError(null);
    setOutOfCredits(false);
    try {
      const form = new FormData();
      form.append("video", file);
      form.append("target", target);
      const res = await confirmedFetch("/api/upscale", { method: "POST", body: form });
      if (!res) { setStatus("idle"); return; } // user cancelled the credit confirmation
      const data: UpscaleJobResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || "Could not start the upscale.");
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
    setJobId(null);
    setStatus("idle");
    setOutputUrl(null);
    setError(null);
    setOutOfCredits(false);
  }

  const busy = status === "uploading" || status === "queued" || status === "processing";

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <MonitorUp className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">Video Upscaler</h1>
            <p className="text-sm text-white/45">Bump your clips to 1080p or 4K — {CREDIT_COST} credits</p>
          </div>
        </div>

        {/* Honest framing — never "AI enhance" */}
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
          <p className="text-xs text-white/55 leading-relaxed">
            This upscales with high-quality CPU resampling — it raises the resolution while keeping
            your aspect ratio intact. It <span className="text-white/80 font-semibold">won't invent detail</span> that
            wasn't in the original footage. Best results come from clean, well-lit source clips.
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
                  <p className="font-semibold text-white/70">Drop a video here, or click to browse</p>
                  <p className="text-xs text-white/35 mt-1">MP4, MOV, WebM — up to 80 MB</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </div>

            {/* Target picker */}
            <div>
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">Upscale to</p>
              <div className="grid grid-cols-2 gap-3">
                {TARGETS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTarget(t.key)}
                    className={`rounded-xl border px-4 py-3.5 text-left transition ${
                      target === t.key
                        ? "border-primary/60 bg-primary/[0.08]"
                        : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <p className="font-bold text-white">{t.label}</p>
                    <p className="text-xs text-white/40 mt-0.5">{t.blurb}</p>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={startUpscale}
              disabled={!file || !user}
              className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Upscale to {target === "4k" ? "4K" : "1080p"} · {CREDIT_COST} credits
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
              {status === "uploading" ? "Uploading…" : status === "queued" ? "In the render queue…" : "Upscaling your video…"}
            </p>
            <p className="text-sm text-white/40 mt-1">
              This runs on our servers — safe to close this tab. Your upscaled video will be waiting in your library.
            </p>
          </div>
        )}

        {/* Result */}
        {status === "done" && outputUrl && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
              <p className="text-sm font-semibold text-white/80">Upscale complete — {target === "4k" ? "4K" : "1080p"}</p>
            </div>
            <video src={outputUrl} controls className="w-full rounded-2xl border border-white/[0.08] bg-black" />
            <div className="flex gap-3">
              <a
                href={outputUrl}
                download={`upscaled-${target}.mp4`}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 font-bold text-black transition hover:brightness-110"
              >
                <Download className="h-4 w-4" /> Download
              </a>
              <button
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
              >
                <RefreshCw className="h-4 w-4" /> New upscale
              </button>
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
