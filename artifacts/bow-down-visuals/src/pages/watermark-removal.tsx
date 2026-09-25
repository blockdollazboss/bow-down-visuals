import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Upload, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, Eraser, Info, RefreshCw,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── Watermark Removal ───────────────────────────────────────────────────
   Removes a static watermark/logo from your own video with ffmpeg's delogo
   filter (blends the region from surrounding pixels). Honest framing:
   this works well on small, static corner watermarks — it will NOT cleanly
   remove large, moving, or semi-transparent animated watermarks (those
   smear instead). 2 credits per removal, refunded automatically if the job
   fails. Server-owned background job: safe to close the tab while it runs. */

const CREDIT_COST = 2;

type PresetKey = "bottom-right" | "bottom-left" | "top-right" | "top-left" | "custom";

const PRESETS: Array<{ key: PresetKey; label: string; blurb: string }> = [
  { key: "bottom-right", label: "Bottom right", blurb: "Most common logo spot" },
  { key: "bottom-left", label: "Bottom left", blurb: "Captions & bugs" },
  { key: "top-right", label: "Top right", blurb: "Channel logos" },
  { key: "top-left", label: "Top left", blurb: "Preview watermarks" },
  { key: "custom", label: "Custom region", blurb: "Set exact coordinates" },
];

type JobStatus = "idle" | "uploading" | "queued" | "processing" | "done" | "failed";

interface JobResponse {
  jobId?: string;
  status?: string;
  outputUrl?: string | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

export default function WatermarkRemoval() {
  usePageTitle("Watermark Removal", "Clean watermarks from your own content — pristine exports, no logos.");
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [preset, setPreset] = useState<PresetKey>("bottom-right");
  const [custom, setCustom] = useState({ x: "10", y: "10", w: "20", h: "15" });
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
    if (!jobId || (status !== "queued" && status !== "processing")) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/watermark-removal/${jobId}`);
        const data: JobResponse = await res.json();
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
          setError(data.error || "Removal failed — your 2 credits were refunded.");
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

  function customValid(): boolean {
    const x = Number(custom.x), y = Number(custom.y);
    const w = Number(custom.w), h = Number(custom.h);
    return [x, y, w, h].every(Number.isFinite)
      && w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= 100 && y + h <= 100;
  }

  async function startRemoval() {
    if (!file || !user) return;
    if (preset === "custom" && !customValid()) {
      setError("Custom region must be x, y, w, h as 0–100 percentages that fit inside the frame.");
      return;
    }
    setStatus("uploading");
    setError(null);
    setOutOfCredits(false);
    try {
      const form = new FormData();
      form.append("video", file);
      form.append("preset", preset);
      if (preset === "custom") {
        form.append("custom", JSON.stringify({
          x: Number(custom.x), y: Number(custom.y),
          w: Number(custom.w), h: Number(custom.h),
        }));
      }
      const res = await fetch("/api/watermark-removal", { method: "POST", body: form });
      const data: JobResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || "Could not start watermark removal.");
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
            <Eraser className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">Watermark Removal</h1>
            <p className="text-sm text-white/45">Clean logos off your own videos — {CREDIT_COST} credits</p>
          </div>
        </div>

        {/* Honest framing — delogo limits stated up front */}
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
          <p className="text-xs text-white/55 leading-relaxed">
            Works best on <span className="text-white/80 font-semibold">small, static corner watermarks</span> —
            the marked area is blended from surrounding pixels. It{" "}
            <span className="text-white/80 font-semibold">won't cleanly remove</span> large, moving, or
            semi-transparent animated watermarks (those smear). Only use on videos you own or have
            the rights to edit.
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

            {/* Location picker */}
            <div>
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">Watermark location</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPreset(p.key)}
                    className={`rounded-xl border px-4 py-3.5 text-left transition ${
                      preset === p.key
                        ? "border-primary/60 bg-primary/[0.08]"
                        : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <p className="font-bold text-white text-sm">{p.label}</p>
                    <p className="text-xs text-white/40 mt-0.5">{p.blurb}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom region inputs */}
            {preset === "custom" && (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-4">
                <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3">
                  Region (% of frame — x, y from top-left)
                </p>
                <div className="grid grid-cols-4 gap-3">
                  {(["x", "y", "w", "h"] as const).map((k) => (
                    <label key={k} className="block">
                      <span className="text-xs text-white/40 uppercase">{k}</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={custom[k]}
                        onChange={(e) => setCustom((c) => ({ ...c, [k]: e.target.value }))}
                        className="mt-1 w-full rounded-lg border border-white/[0.1] bg-black/40 px-3 py-2 text-sm text-white focus:border-primary/60 focus:outline-none"
                      />
                    </label>
                  ))}
                </div>
                {!customValid() && (
                  <p className="mt-2 text-xs text-amber-400/80">
                    Region must fit inside the frame: x + w ≤ 100, y + h ≤ 100, w and h above 0.
                  </p>
                )}
              </div>
            )}

            <button
              onClick={startRemoval}
              disabled={!file || !user || (preset === "custom" && !customValid())}
              className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Remove watermark · {CREDIT_COST} credits
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
              {status === "uploading" ? "Uploading…" : status === "queued" ? "In the render queue…" : "Removing the watermark…"}
            </p>
            <p className="text-sm text-white/40 mt-1">
              This runs on our servers — safe to close this tab. Your cleaned video will be waiting in your library.
            </p>
          </div>
        )}

        {/* Result */}
        {status === "done" && outputUrl && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
              <p className="text-sm font-semibold text-white/80">Watermark removed</p>
            </div>
            <video src={outputUrl} controls className="w-full rounded-2xl border border-white/[0.08] bg-black" />
            <div className="flex gap-3">
              <a
                href={outputUrl}
                download="watermark-removed.mp4"
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 font-bold text-black transition hover:brightness-110"
              >
                <Download className="h-4 w-4" /> Download
              </a>
              <button
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
              >
                <RefreshCw className="h-4 w-4" /> New video
              </button>
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
