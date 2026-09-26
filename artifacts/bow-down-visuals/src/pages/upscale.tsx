import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Upload, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, MonitorUp, Image as ImageIcon, Eraser, Sparkles,
  Info, RefreshCw, ChevronsLeftRight,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { usePageTitle } from "@/hooks/use-page-title";
import { WatermarkRemovalTool } from "./watermark-removal";
import {
  COMPARE_POS_DEFAULT,
  COMPARE_KEY_STEP,
  COMPARE_KEY_STEP_LARGE,
  clampComparePos,
  compareClipPath,
  comparePosFromClientX,
} from "@/lib/compare-slider";

/* ─── Upscale & Clean ─────────────────────────────────────────────────────
   Three creator tools on one page: video upscaling, image upscaling, and
   watermark removal. Honest CPU upscaling everywhere: ffmpeg Lanczos
   resampling raises the resolution — it does NOT invent detail that wasn't
   in the source. The copy on this page must never say "enhance" or
   "AI upscale". Every job is credit-backed: 3 credits for video upscales,
   3 credits for image upscales, 2 credits for watermark removal —
   refunded automatically if the job fails. */

type TabKey = "video" | "image" | "watermark";

const TABS: Array<{ key: TabKey; label: string; icon: typeof MonitorUp }> = [
  { key: "video", label: "Video Upscale", icon: MonitorUp },
  { key: "image", label: "Image Upscale", icon: ImageIcon },
  { key: "watermark", label: "Watermark Removal", icon: Eraser },
];

/* ─── Tab 1: Video Upscaler (existing tool, unchanged behavior) ────────── */

const VIDEO_CREDIT_COST = 3;

type TargetKey = "1080p" | "4k";

const TARGETS: Array<{ key: TargetKey; label: string; blurb: string }> = [
  { key: "1080p", label: "1080p Full HD", blurb: "Crisp for socials & YouTube" },
  { key: "4k", label: "4K Ultra HD", blurb: "Maximum sharpness for premieres" },
];

type VideoJobStatus = "idle" | "uploading" | "queued" | "processing" | "done" | "failed";

interface UpscaleJobResponse {
  jobId?: string;
  status?: string;
  outputUrl?: string | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

function VideoUpscaleTool() {
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState<TargetKey>("1080p");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<VideoJobStatus>("idle");
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
          setStatus(data.status as VideoJobStatus);
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
    <>
      <div className="flex items-center gap-3 mb-2">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <MonitorUp className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-xl font-black">Video Upscaler</h2>
          <p className="text-sm text-white/45">Bump your clips to 1080p or 4K — {VIDEO_CREDIT_COST} credits</p>
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
            Upscale to {target === "4k" ? "4K" : "1080p"} · {VIDEO_CREDIT_COST} credits
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
    </>
  );
}

/* ─── Tab 2: Image Upscaler (new) ─────────────────────────────────────── */

const IMAGE_CREDIT_COST = 3;
const IMAGE_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

type ImageScaleKey = "2x" | "4x";

const IMAGE_SCALES: Array<{ key: ImageScaleKey; label: string; blurb: string }> = [
  { key: "2x", label: "2x size", blurb: "Sharper thumbs, covers & posts" },
  { key: "4x", label: "4x size", blurb: "Print-ready detail, max pixels" },
];

type ImageJobStatus = "idle" | "uploading" | "done" | "failed";

interface ImageUpscaleResponse {
  status?: string;
  url?: string;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

function ImageUpscaleTool() {
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scale, setScale] = useState<ImageScaleKey>("2x");
  const [status, setStatus] = useState<ImageJobStatus>("idle");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pos, setPos] = useState<number>(COMPARE_POS_DEFAULT);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (f.size > IMAGE_MAX_BYTES) {
      setError("This image exceeds the 25 MB upload limit.");
      return;
    }
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(f);
    previewUrlRef.current = url;
    setFile(f);
    setPreviewUrl(url);
    setError(null);
    setOutputUrl(null);
    setStatus("idle");
    setPos(COMPARE_POS_DEFAULT);
  }

  async function startUpscale() {
    if (!file || !user) return;
    setStatus("uploading");
    setError(null);
    setOutOfCredits(false);
    try {
      const form = new FormData();
      form.append("image", file);
      form.append("scale", scale);
      const res = await confirmedFetch("/api/upscale/image", { method: "POST", body: form });
      if (!res) { setStatus("idle"); return; } // user cancelled the credit confirmation
      const data: ImageUpscaleResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      if (!res.ok || data.status !== "done" || !data.url) {
        setStatus("failed");
        setError(
          (data.message || data.error)
            ? `${data.message || data.error} — your ${IMAGE_CREDIT_COST} credits were refunded.`
            : `Upscale failed — your ${IMAGE_CREDIT_COST} credits were refunded.`,
        );
        return;
      }
      setOutputUrl(data.url);
      setStatus("done");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError(`Network error — your ${IMAGE_CREDIT_COST} credits were not spent.`);
    }
  }

  function reset() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setFile(null);
    setPreviewUrl(null);
    setStatus("idle");
    setOutputUrl(null);
    setError(null);
    setOutOfCredits(false);
    setPos(COMPARE_POS_DEFAULT);
  }

  function updatePosFromClientX(clientX: number) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos(comparePosFromClientX(clientX, rect.left, rect.width));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? COMPARE_KEY_STEP_LARGE : COMPARE_KEY_STEP;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPos((p) => clampComparePos(p - step));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPos((p) => clampComparePos(p + step));
    }
  }

  const busy = status === "uploading";
  const clampedPos = clampComparePos(pos);

  return (
    <>
      <div className="flex items-center gap-3 mb-2">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <ImageIcon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-xl font-black">Image Upscaler</h2>
          <p className="text-sm text-white/45">Sharpen photos, covers & thumbs — {IMAGE_CREDIT_COST} credits</p>
        </div>
      </div>

      {/* Honest framing — never "AI enhance" */}
      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
        <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
        <p className="text-xs text-white/55 leading-relaxed">
          This enlarges your image with high-quality CPU resampling plus a light sharpening pass.
          It <span className="text-white/80 font-semibold">won't invent detail</span> that wasn't in
          the original — best for crisp, well-lit source images.
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
            {file && previewUrl ? (
              <div>
                <img src={previewUrl} alt="Preview" className="mx-auto mb-3 max-h-40 rounded-xl border border-white/[0.08]" />
                <p className="font-semibold text-white">{file.name}</p>
                <p className="text-xs text-white/40 mt-1">{(file.size / 1024 / 1024).toFixed(1)} MB — click to change</p>
              </div>
            ) : (
              <div>
                <p className="font-semibold text-white/70">Drop an image here, or click to browse</p>
                <p className="text-xs text-white/35 mt-1">PNG, JPG, WebP — up to 25 MB</p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </div>

          {/* Scale picker */}
          <div>
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">Upscale to</p>
            <div className="grid grid-cols-2 gap-3">
              {IMAGE_SCALES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setScale(s.key)}
                  className={`rounded-xl border px-4 py-3.5 text-left transition ${
                    scale === s.key
                      ? "border-primary/60 bg-primary/[0.08]"
                      : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                  }`}
                >
                  <p className="font-bold text-white">{s.label}</p>
                  <p className="text-xs text-white/40 mt-0.5">{s.blurb}</p>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={startUpscale}
            disabled={!file || !user}
            className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Upscale image {scale} · {IMAGE_CREDIT_COST} credits
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
          <p className="font-bold text-white">Upscaling your image…</p>
          <p className="text-sm text-white/40 mt-1">This usually takes a few seconds — safe to wait right here.</p>
        </div>
      )}

      {/* Result with before/after compare slider */}
      {status === "done" && outputUrl && previewUrl && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
            <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
            <p className="text-sm font-semibold text-white/80">Upscale complete — {scale} ({scale === "4x" ? "4x" : "2x"} resolution)</p>
          </div>

          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="Before and after comparison"
            aria-valuenow={clampedPos}
            aria-valuemin={0}
            aria-valuemax={100}
            onKeyDown={onKeyDown}
            onPointerDown={(e) => {
              setDragging(true);
              (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
              updatePosFromClientX(e.clientX);
            }}
            onPointerMove={(e) => { if (dragging) updatePosFromClientX(e.clientX); }}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
            className="relative w-full cursor-ew-resize overflow-hidden rounded-2xl border border-white/[0.08] bg-black select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            style={{ touchAction: "none" }}
          >
            {/* Before (original) — bottom layer */}
            <img src={previewUrl} alt="Before — original image" className="block w-full h-auto" draggable={false} />
            {/* After (upscaled) — clipped layer on top, LEFT = before, RIGHT = after */}
            <div className="absolute inset-0" style={{ clipPath: compareClipPath(clampedPos) }}>
              <img src={outputUrl} alt="After — upscaled image" className="block w-full h-auto" draggable={false} />
            </div>
            <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white/80">
              Before
            </span>
            <span className="absolute right-3 top-3 rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-black">
              After
            </span>
            {/* Handle */}
            <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${clampedPos}%` }}>
              <div className="absolute inset-y-0 -translate-x-1/2 w-0.5 bg-white/90 shadow-[0_0_12px_rgba(0,0,0,0.6)]" />
              <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-black shadow-lg">
                <ChevronsLeftRight className="h-4 w-4" />
              </div>
            </div>
          </div>
          <p className="text-center text-xs text-white/35">Drag the handle — or focus it and use ← → arrow keys — to compare</p>

          <div className="flex gap-3">
            <a
              href={outputUrl}
              download={`upscaled-${scale}.png`}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 font-bold text-black transition hover:brightness-110"
            >
              <Download className="h-4 w-4" /> Download
            </a>
            <button
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
            >
              <RefreshCw className="h-4 w-4" /> New image
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Page shell with tabs ────────────────────────────────────────────── */

export default function Upscale() {
  usePageTitle("Upscale & Clean", "Upscale videos and images to sharper quality, or clean watermarks off your own clips.");
  const [tab, setTab] = useState<TabKey>("video");

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">Upscale & Clean</h1>
            <p className="text-sm text-white/45">Sharper content, pristine exports — every job refunds automatically if it fails</p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="mt-6 grid grid-cols-3 gap-1.5 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-1.5" role="tablist" aria-label="Upscale & Clean tools">
          {TABS.map((t) => {
            const active = tab === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                  active
                    ? "bg-primary text-black"
                    : "text-white/55 hover:text-white hover:bg-white/[0.04]"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{t.label}</span>
                <span className="sm:hidden">{t.label.split(" ")[0]}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-8">
          {tab === "video" && <VideoUpscaleTool />}
          {tab === "image" && <ImageUpscaleTool />}
          {tab === "watermark" && <WatermarkRemovalTool showBackLink={false} />}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
