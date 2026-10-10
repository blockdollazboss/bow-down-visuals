import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Upload, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, MonitorUp, Image as ImageIcon, Eraser, Sparkles,
  Info, RefreshCw, ChevronsLeftRight,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";
import { useHubProject } from "@/lib/hub-project";
import { Clapperboard } from "lucide-react";
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

type TabKey = "video" | "image" | "enhance";

const TABS: Array<{ key: TabKey; labelKey: string; shortKey: string; icon: typeof MonitorUp }> = [
  { key: "video", labelKey: "upscale.tabVideo", shortKey: "upscale.tabVideoShort", icon: MonitorUp },
  { key: "image", labelKey: "upscale.tabImage", shortKey: "upscale.tabImageShort", icon: ImageIcon },
  { key: "enhance", labelKey: "upscale.tabEnhance", shortKey: "upscale.tabEnhanceShort", icon: Eraser },
];

/* ─── Tab 1: Video Upscaler (existing tool, unchanged behavior) ────────── */

const VIDEO_CREDIT_COST = 300;

type TargetKey = "1080p" | "4k";

const TARGETS: Array<{ key: TargetKey; labelKey: string; blurbKey: string }> = [
  { key: "1080p", labelKey: "upscale.target1080p", blurbKey: "upscale.target1080pBlurb" },
  { key: "4k", labelKey: "upscale.target4k", blurbKey: "upscale.target4kBlurb" },
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
  const { t } = useTranslation();
  const { user } = useAuth();
  const { addAsset } = useHubProject();
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
          setError(data.error || t("upscale.jobNotFound"));
          return;
        }
        if (data.status === "done") {
          setStatus("done");
          setOutputUrl(data.outputUrl ?? null);
          /* The upscaled video flows into the hub project for the next step. */
          if (data.outputUrl) {
            try { addAsset({ kind: "video", url: data.outputUrl, label: `Upscaled video (${target})`, detail: "Video upscaler" }); } catch { /* non-fatal */ }
          }
        } else if (data.status === "failed") {
          setStatus("failed");
          setError(data.error || t("upscale.videoUpscaleFailedRefunded"));
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
      setError(t("upscale.videoFileError"));
      return;
    }
    if (f.size > 80 * 1024 * 1024) {
      setError(t("upscale.videoSizeError"));
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
        setError(data.message || data.error || t("upscale.startFailed"));
        return;
      }
      setJobId(data.jobId);
      setStatus("queued");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError(t("upscale.networkError"));
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
          <h2 className="text-xl font-black">{t("upscale.videoUpscalerTitle")}</h2>
          <p className="text-sm text-white/45">{t("upscale.videoUpscalerSub", { cost: VIDEO_CREDIT_COST })}</p>
        </div>
      </div>

      {/* Honest framing — never "AI enhance" */}
      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
        <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
        <p className="text-xs text-white/55 leading-relaxed">
          {t("upscale.videoHonestFraming1")}
          <span className="text-white/80 font-semibold">{t("upscale.videoHonestFramingStrong")}</span>
          {t("upscale.videoHonestFraming2")}
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
                <p className="text-xs text-white/40 mt-1">{t("upscale.fileChosen", { size: (file.size / 1024 / 1024).toFixed(1) })}</p>
              </div>
            ) : (
              <div>
                <p className="font-semibold text-white/70">{t("upscale.dropVideoPrompt")}</p>
                <p className="text-xs text-white/35 mt-1">{t("upscale.dropVideoHint")}</p>
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
          <div data-min-stars="2">
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">{t("upscale.upscaleTo")}</p>
            <div className="grid grid-cols-2 gap-3">
              {TARGETS.map((tg) => (
                <button
                  key={tg.key}
                  type="button"
                  onClick={() => setTarget(tg.key)}
                  className={`rounded-xl border px-4 py-3.5 text-left transition ${
                    target === tg.key
                      ? "border-primary/60 bg-primary/[0.08]"
                      : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                  }`}
                >
                  <p className="font-bold text-white">{t(tg.labelKey)}</p>
                  <p className="text-xs text-white/40 mt-0.5">{t(tg.blurbKey)}</p>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={startUpscale}
            disabled={!file || !user}
            className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("upscale.upscaleVideoButton", { target: target === "4k" ? "4K" : "1080p", cost: VIDEO_CREDIT_COST })}
          </button>
          {creditsRemaining != null && (
            <p className="text-center text-xs text-white/35">{t("upscale.creditsRemaining", { count: creditsRemaining })}</p>
          )}
        </div>
      ) : null}

      {/* Progress */}
      {busy && (
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
          <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
          <p className="font-bold text-white">
            {status === "uploading" ? t("upscale.statusUploading") : status === "queued" ? t("upscale.statusQueued") : t("upscale.statusUpscalingVideo")}
          </p>
          <p className="text-sm text-white/40 mt-1">
            {t("upscale.videoProgressNote")}
          </p>
        </div>
      )}

      {/* Result */}
      {status === "done" && outputUrl && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
            <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
            <p className="text-sm font-semibold text-white/80">{t("upscale.videoUpscaleComplete", { target: target === "4k" ? "4K" : "1080p" })}</p>
          </div>
          <video src={outputUrl} controls className="w-full rounded-2xl border border-white/[0.08] bg-black" />
          <div className="flex gap-3">
            <a
              href={outputUrl}
              download={`upscaled-${target}.mp4`}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 font-bold text-black transition hover:brightness-110"
            >
              <Download className="h-4 w-4" /> {t("upscale.download")}
            </a>
            <button
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
            >
              <RefreshCw className="h-4 w-4" /> {t("upscale.newUpscale")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Tab 2: Image Upscaler (new) ─────────────────────────────────────── */

const IMAGE_CREDIT_COST = 300;
const IMAGE_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

type ImageScaleKey = "2x" | "4x";

const IMAGE_SCALES: Array<{ key: ImageScaleKey; labelKey: string; blurbKey: string }> = [
  { key: "2x", labelKey: "upscale.scale2x", blurbKey: "upscale.scale2xBlurb" },
  { key: "4x", labelKey: "upscale.scale4x", blurbKey: "upscale.scale4xBlurb" },
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
  const { t } = useTranslation();
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
      setError(t("upscale.imageFileError"));
      return;
    }
    if (f.size > IMAGE_MAX_BYTES) {
      setError(t("upscale.imageSizeError"));
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
            ? t("upscale.upscaleFailedServer", { msg: data.message || data.error, cost: IMAGE_CREDIT_COST })
            : t("upscale.upscaleFailedRefunded", { cost: IMAGE_CREDIT_COST }),
        );
        return;
      }
      setOutputUrl(data.url);
      setStatus("done");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError(t("upscale.networkErrorNotSpent", { cost: IMAGE_CREDIT_COST }));
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
          <h2 className="text-xl font-black">{t("upscale.imageUpscalerTitle")}</h2>
          <p className="text-sm text-white/45">{t("upscale.imageUpscalerSub", { cost: IMAGE_CREDIT_COST })}</p>
        </div>
      </div>

      {/* Honest framing — never "AI enhance" */}
      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
        <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
        <p className="text-xs text-white/55 leading-relaxed">
          {t("upscale.imageHonestFraming1")}
          <span className="text-white/80 font-semibold">{t("upscale.imageHonestFramingStrong")}</span>
          {t("upscale.imageHonestFraming2")}
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
                <img src={previewUrl} alt={t("upscale.previewAlt")} className="mx-auto mb-3 max-h-40 rounded-xl border border-white/[0.08]" />
                <p className="font-semibold text-white">{file.name}</p>
                <p className="text-xs text-white/40 mt-1">{t("upscale.fileChosen", { size: (file.size / 1024 / 1024).toFixed(1) })}</p>
              </div>
            ) : (
              <div>
                <p className="font-semibold text-white/70">{t("upscale.dropImagePrompt")}</p>
                <p className="text-xs text-white/35 mt-1">{t("upscale.dropImageHint")}</p>
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
          <div data-min-stars="2">
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">{t("upscale.upscaleTo")}</p>
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
                  <p className="font-bold text-white">{t(s.labelKey)}</p>
                  <p className="text-xs text-white/40 mt-0.5">{t(s.blurbKey)}</p>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={startUpscale}
            disabled={!file || !user}
            className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("upscale.upscaleImageButton", { scale, cost: IMAGE_CREDIT_COST })}
          </button>
          {creditsRemaining != null && (
            <p className="text-center text-xs text-white/35">{t("upscale.creditsRemaining", { count: creditsRemaining })}</p>
          )}
        </div>
      ) : null}

      {/* Progress */}
      {busy && (
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
          <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
          <p className="font-bold text-white">{t("upscale.statusUpscalingImage")}</p>
          <p className="text-sm text-white/40 mt-1">{t("upscale.imageProgressNote")}</p>
        </div>
      )}

      {/* Result with before/after compare slider */}
      {status === "done" && outputUrl && previewUrl && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
            <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
            <p className="text-sm font-semibold text-white/80">{t("upscale.imageUpscaleComplete", { scale })}</p>
          </div>

          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label={t("upscale.compareAriaLabel")}
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
            <img src={previewUrl} alt={t("upscale.beforeAlt")} className="block w-full h-auto" draggable={false} />
            {/* After (upscaled) — clipped layer on top, LEFT = before, RIGHT = after */}
            <div className="absolute inset-0" style={{ clipPath: compareClipPath(clampedPos) }}>
              <img src={outputUrl} alt={t("upscale.afterAlt")} className="block w-full h-auto" draggable={false} />
            </div>
            <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white/80">
              {t("upscale.beforeLabel")}
            </span>
            <span className="absolute right-3 top-3 rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-black">
              {t("upscale.afterLabel")}
            </span>
            {/* Handle */}
            <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${clampedPos}%` }}>
              <div className="absolute inset-y-0 -translate-x-1/2 w-0.5 bg-white/90 shadow-[0_0_12px_rgba(0,0,0,0.6)]" />
              <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-black shadow-lg">
                <ChevronsLeftRight className="h-4 w-4" />
              </div>
            </div>
          </div>
          <p className="text-center text-xs text-white/35">{t("upscale.compareHint")}</p>

          <div className="flex gap-3">
            <a
              href={outputUrl}
              download={`upscaled-${scale}.png`}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 font-bold text-black transition hover:brightness-110"
            >
              <Download className="h-4 w-4" /> {t("upscale.download")}
            </a>
            <button
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
            >
              <RefreshCw className="h-4 w-4" /> {t("upscale.newImage")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Tab 3: Enhance (merged from the Watermark Removal page) ───────────
   Removes a static watermark/logo from your own video with ffmpeg's delogo
   filter (blends the region from surrounding pixels). Honest framing:
   this works well on small, static corner watermarks — it will NOT cleanly
   remove large, moving, or semi-transparent animated watermarks (those
   smear instead). 2 credits per removal (POST /api/watermark-removal;
   registry key "/api/watermark-removal"), refunded automatically if the
   job fails. Server-owned background job: safe to close the tab while it
   runs. Finished outputs hand off to the video editor (→ /video-editor). */

const ENHANCE_CREDIT_COST = 200;

type EnhancePresetKey = "bottom-right" | "bottom-left" | "top-right" | "top-left" | "custom";

const ENHANCE_PRESETS: Array<{ key: EnhancePresetKey; labelKey: string; blurbKey: string }> = [
  { key: "bottom-right", labelKey: "watermarkRemoval.presetBottomRight", blurbKey: "watermarkRemoval.presetBottomRightBlurb" },
  { key: "bottom-left", labelKey: "watermarkRemoval.presetBottomLeft", blurbKey: "watermarkRemoval.presetBottomLeftBlurb" },
  { key: "top-right", labelKey: "watermarkRemoval.presetTopRight", blurbKey: "watermarkRemoval.presetTopRightBlurb" },
  { key: "top-left", labelKey: "watermarkRemoval.presetTopLeft", blurbKey: "watermarkRemoval.presetTopLeftBlurb" },
  { key: "custom", labelKey: "watermarkRemoval.presetCustom", blurbKey: "watermarkRemoval.presetCustomBlurb" },
];

type EnhanceJobStatus = "idle" | "uploading" | "queued" | "processing" | "done" | "failed";

interface EnhanceJobResponse {
  jobId?: string;
  status?: string;
  outputUrl?: string | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

function WatermarkRemovalTool({ showBackLink = true }: { showBackLink?: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { addAsset } = useHubProject();
  const { confirmedFetch } = useConfirmedApi();
  const [file, setFile] = useState<File | null>(null);
  const [preset, setPreset] = useState<EnhancePresetKey>("bottom-right");
  const [custom, setCustom] = useState({ x: "10", y: "10", w: "20", h: "15" });
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<EnhanceJobStatus>("idle");
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
        const data: EnhanceJobResponse = await res.json();
        if (!res.ok) {
          setStatus("failed");
          setError(data.error || t("watermarkRemoval.jobNotFound"));
          return;
        }
        if (data.status === "done") {
          setStatus("done");
          setOutputUrl(data.outputUrl ?? null);
          /* The cleaned video flows into the hub project for the next step. */
          if (data.outputUrl) {
            try { addAsset({ kind: "video", url: data.outputUrl, label: "Watermark-free video", detail: "Watermark removal" }); } catch { /* non-fatal */ }
          }
        } else if (data.status === "failed") {
          setStatus("failed");
          setError(data.error || t("watermarkRemoval.removalFailedRefunded", { bucs: ENHANCE_CREDIT_COST }));
        } else {
          setStatus(data.status as EnhanceJobStatus);
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
      setError(t("watermarkRemoval.videoFileError"));
      return;
    }
    if (f.size > 80 * 1024 * 1024) {
      setError(t("watermarkRemoval.videoSizeError"));
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
      setError(t("watermarkRemoval.customRegionError"));
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
      const res = await confirmedFetch("/api/watermark-removal", { method: "POST", body: form });
      if (!res) { setStatus("idle"); return; } // user cancelled the credit confirmation
      const data: EnhanceJobResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || t("watermarkRemoval.startFailedError"));
        return;
      }
      setJobId(data.jobId);
      setStatus("queued");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError(t("watermarkRemoval.networkError"));
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
      {showBackLink && (
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> {t("watermarkRemoval.back")}
        </Link>
      )}

      <div className="flex items-center gap-3 mb-2">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Eraser className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-xl font-black">{t("watermarkRemoval.toolTitle")}</h2>
          <p className="text-sm text-white/45">{t("watermarkRemoval.toolSub", { cost: ENHANCE_CREDIT_COST })}</p>
        </div>
      </div>

      {/* Honest framing — delogo limits stated up front */}
      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
        <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
        <p className="text-xs text-white/55 leading-relaxed">
          {t("watermarkRemoval.honestFraming1")}{" "}
          <span className="text-white/80 font-semibold">{t("watermarkRemoval.honestFramingStrong1")}</span>
          {t("watermarkRemoval.honestFramingMid")}{" "}
          <span className="text-white/80 font-semibold">{t("watermarkRemoval.honestFramingStrong2")}</span>
          {t("watermarkRemoval.honestFraming2")}
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
                <p className="text-xs text-white/40 mt-1">{t("watermarkRemoval.fileChosen", { size: (file.size / 1024 / 1024).toFixed(1) })}</p>
              </div>
            ) : (
              <div>
                <p className="font-semibold text-white/70">{t("watermarkRemoval.dropPrompt")}</p>
                <p className="text-xs text-white/35 mt-1">{t("watermarkRemoval.dropHint")}</p>
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
          <div data-min-stars="2">
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">{t("watermarkRemoval.locationLabel")}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {ENHANCE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  data-min-stars={p.key === "custom" ? "6" : undefined}
                  onClick={() => setPreset(p.key)}
                  className={`rounded-xl border px-4 py-3.5 text-left transition ${
                    preset === p.key
                      ? "border-primary/60 bg-primary/[0.08]"
                      : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                  }`}
                >
                  <p className="font-bold text-white text-sm">{t(p.labelKey)}</p>
                  <p className="text-xs text-white/40 mt-0.5">{t(p.blurbKey)}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Custom region inputs */}
          {preset === "custom" && (
            <div data-min-stars="6" className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-4">
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3">
                {t("watermarkRemoval.customRegionLabel")}
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
                  {t("watermarkRemoval.customRegionHint")}
                </p>
              )}
            </div>
          )}

          <button
            onClick={startRemoval}
            disabled={!file || !user || (preset === "custom" && !customValid())}
            className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("watermarkRemoval.removeButton", { cost: ENHANCE_CREDIT_COST })}
          </button>
          {creditsRemaining != null && (
            <p className="text-center text-xs text-white/35">{t("watermarkRemoval.creditsRemaining", { count: creditsRemaining })}</p>
          )}
        </div>
      ) : null}

      {/* Progress */}
      {busy && (
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
          <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
          <p className="font-bold text-white">
            {status === "uploading" ? t("watermarkRemoval.statusUploading") : status === "queued" ? t("watermarkRemoval.statusQueued") : t("watermarkRemoval.statusProcessing")}
          </p>
          <p className="text-sm text-white/40 mt-1">
            {t("watermarkRemoval.progressNote")}
          </p>
        </div>
      )}

      {/* Result */}
      {status === "done" && outputUrl && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
            <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
            <p className="text-sm font-semibold text-white/80">{t("watermarkRemoval.removalComplete")}</p>
          </div>
          <video src={outputUrl} controls className="w-full rounded-2xl border border-white/[0.08] bg-black" />
          <div className="flex gap-3">
            <a
              href={outputUrl}
              download="watermark-removed.mp4"
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 font-bold text-black transition hover:brightness-110"
            >
              <Download className="h-4 w-4" /> {t("watermarkRemoval.download")}
            </a>
            <button
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
            >
              <RefreshCw className="h-4 w-4" /> {t("watermarkRemoval.newVideo")}
            </button>
          </div>
          {/* Handoff — the cleaned video continues into the video editor */}
          <a
            href={`/video-editor?video=${encodeURIComponent(outputUrl)}`}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-primary/40 bg-primary/10 px-6 py-3.5 text-sm font-bold text-primary transition hover:bg-primary hover:text-black"
          >
            <Clapperboard className="h-4 w-4" /> {t("watermarkRemoval.sendToVideoEditor", { defaultValue: "Send to Visual Vibes" })}
          </a>
        </div>
      )}
    </>
  );
}

/* ─── Page shell with tabs ────────────────────────────────────────────── */

export default function Upscale({ embedded }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  usePageTitle(t("upscale.pageTitle"), t("upscale.pageDescription"));
  const [tab, setTab] = useState<TabKey>(() => {
    try { return new URLSearchParams(window.location.search).get("tab") === "enhance" ? "enhance" : "video"; } catch { return "video"; }
  });

  return (
    <div className={embedded ? "text-white" : "min-h-screen bg-black text-white"}>
      <main className={embedded ? "" : "mx-auto max-w-3xl px-4 py-10"}>
        {/* Back link + hero (standalone page only; the shell provides them when embedded) */}
        {!embedded && (
        <>
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> {t("upscale.back")}
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">{t("upscale.pageTitle")}</h1>
            <p className="text-sm text-white/45">{t("upscale.pageSub")}</p>
          </div>
        </div>
        </>
        )}

        {/* Tab bar */}
        <div className="mt-6 grid grid-cols-3 gap-1.5 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-1.5" role="tablist" aria-label={t("upscale.tabListLabel")}>
          {TABS.map((tb) => {
            const active = tab === tb.key;
            const Icon = tb.icon;
            return (
              <button
                key={tb.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(tb.key)}
                className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                  active
                    ? "bg-primary text-black"
                    : "text-white/55 hover:text-white hover:bg-white/[0.04]"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{tb.key === "enhance" ? t(tb.labelKey, { defaultValue: "Enhance" }) : t(tb.labelKey)}</span>
                <span className="sm:hidden">{tb.key === "enhance" ? t(tb.shortKey, { defaultValue: "Enhance" }) : t(tb.shortKey)}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-8">
          {tab === "video" && <VideoUpscaleTool />}
          {tab === "image" && <ImageUpscaleTool />}
          {tab === "enhance" && <WatermarkRemovalTool showBackLink={false} />}
        </div>
      </main>

    </div>
  );
}
