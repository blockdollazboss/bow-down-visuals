import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Upload, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, Captions, Info, Sparkles,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";

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

/* Display strings for these live inside the component (via t()); keys stay
   stable because they are sent to the backend as the job config. */
const STYLE_DEFS: StyleKey[] = ["hormozi", "minimal", "karaoke", "neon", "luxury-gold"];
const POSITION_DEFS: PositionKey[] = ["top", "middle", "bottom"];
const FONT_SIZE_DEFS: FontSizeKey[] = ["small", "medium", "large"];

const STYLE_LABEL_KEYS: Record<StyleKey, string> = {
  hormozi: "hormozi",
  minimal: "minimal",
  karaoke: "karaoke",
  neon: "neon",
  "luxury-gold": "luxuryGold",
};

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
  const { t } = useTranslation();
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();

  /* Translated display strings for the style/position/size pickers and the
     busy status labels. */
  const STYLES: Array<{ key: StyleKey; label: string; blurb: string }> = STYLE_DEFS.map((key) => ({
    key,
    label: t(`captionStyler.styles.${STYLE_LABEL_KEYS[key]}.label`),
    blurb: t(`captionStyler.styles.${STYLE_LABEL_KEYS[key]}.blurb`),
  }));
  const POSITIONS: Array<{ key: PositionKey; label: string }> = POSITION_DEFS.map((key) => ({
    key,
    label: t(`captionStyler.positions.${key}`),
  }));
  const FONT_SIZES: Array<{ key: FontSizeKey; label: string }> = FONT_SIZE_DEFS.map((key) => ({
    key,
    label: t(`captionStyler.fontSizes.${key}`),
  }));
  const statusLabel: Record<string, string> = {
    uploading: t("captionStyler.statusUploading"),
    queued: t("captionStyler.statusQueued"),
    transcribing: t("captionStyler.statusTranscribing"),
    rendering: t("captionStyler.statusRendering"),
  };
  const [file, setFile] = useState<File | null>(null);

  /* Deep-link protocol: /caption-styler?video=… pre-loads a video (e.g. a clip
     from clip-maker/repurpose) so there's no download→re-upload round trip. */
  useEffect(() => {
    try {
      const videoParam = new URLSearchParams(window.location.search).get("video");
      if (!videoParam || file) return;
      (async () => {
        try {
          const res = await fetch(videoParam);
          const blob = await res.blob();
          setFile(new File([blob], "video.mp4", { type: blob.type || "video/mp4" }));
          window.history.replaceState(null, "", window.location.pathname);
        } catch {
          setError(t("captionStyler.errorNetwork"));
        }
      })();
    } catch { /* non-browser — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  const [style, setStyle] = useState<StyleKey>("hormozi");
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
          setError(data.error || t("captionStyler.errorJobNotFound"));
          return;
        }
        if (data.status === "done") {
          setStatus("done");
          setOutputUrl(data.outputUrl ?? null);
          /* The captioned video flows into the hub project. */
          if (data.outputUrl) {
            try { addAsset({ kind: "video", url: data.outputUrl, label: "Captioned video", detail: `Caption styler · ${style}` }); } catch { /* non-fatal */ }
          }
        } else if (data.status === "failed") {
          setStatus("failed");
          setError(data.error || t("captionStyler.errorJobFailed"));
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
      setError(t("captionStyler.errorNotVideo"));
      return;
    }
    if (f.size > 80 * 1024 * 1024) {
      setError(t("captionStyler.errorTooLarge"));
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
        setError(data.message || data.error || t("captionStyler.errorStartFailed"));
        return;
      }
      setJobId(data.jobId);
      setStatus((data.status as JobStatus) || "queued");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError(t("captionStyler.errorNetwork"));
    }
  }

  const busy = ["uploading", "queued", "transcribing", "rendering"].includes(status);

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-amber-300">
          <ArrowLeft className="h-4 w-4" /> {t("captionStyler.backToDashboard")}
        </Link>

        <div className="mt-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-yellow-600">
            <Captions className="h-6 w-6 text-black" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t("captionStyler.titleAi")} <span className="bg-gradient-to-r from-amber-300 to-yellow-500 bg-clip-text text-transparent">{t("captionStyler.title")}</span>
            </h1>
            <p className="text-sm text-zinc-400">{t("captionStyler.subtitle")}</p>
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
            <p className="mt-3 font-medium">{file ? file.name : t("captionStyler.dropPrompt")}</p>
            <p className="mt-1 text-xs text-zinc-500">{t("captionStyler.fileHint")}</p>
          </div>

          {/* Style presets */}
          <p data-min-stars="2" className="mt-6 text-sm font-semibold text-zinc-300">{t("captionStyler.styleLabel")}</p>
          <div data-min-stars="2" className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
          <div data-min-stars="3" className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-semibold text-zinc-300">{t("captionStyler.positionLabel")}</p>
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
              <p className="text-sm font-semibold text-zinc-300">{t("captionStyler.fontSizeLabel")}</p>
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
          <label data-min-stars="3" className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3">
            <input
              type="checkbox"
              checked={withEmoji}
              onChange={(e) => setWithEmoji(e.target.checked)}
              className="h-4 w-4 accent-amber-400"
            />
            <span className="text-sm">
              <span className="font-semibold">{t("captionStyler.autoEmoji")}</span>{" "}
              <span className="text-zinc-500">{t("captionStyler.autoEmojiHint")}</span>
            </span>
          </label>

          {/* Action */}
          <button
            onClick={startStyling}
            disabled={!file || !user || busy}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-600 px-6 py-3 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
            {busy ? statusLabel[status] ?? t("captionStyler.statusWorking") : t("captionStyler.styleButton", { n: CREDIT_COST })}
          </button>
          {!user && (
            <p className="mt-2 text-center text-xs text-zinc-500">
              <Link href="/login" className="text-amber-300 underline">{t("captionStyler.signIn")}</Link> {t("captionStyler.signInToStyle")}
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
                <CheckCircle2 className="h-4 w-4" /> {t("captionStyler.doneTitle")}
              </p>
              <video src={outputUrl} controls className="mt-3 w-full rounded-lg" />
              <a
                href={outputUrl}
                download
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-green-500 px-4 py-2 text-sm font-bold text-black hover:brightness-110"
              >
                <Download className="h-4 w-4" /> {t("captionStyler.downloadButton")}
              </a>
            </div>
          )}

          {typeof creditsRemaining === "number" && (
            <p className="mt-3 text-center text-xs text-zinc-500">{t("captionStyler.creditsRemaining", { n: creditsRemaining })}</p>
          )}
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-xs text-zinc-500">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p>
            {t("captionStyler.infoText")}
          </p>
        </div>
      </main>


      {outOfCredits && (
        <div className="mt-4">
          <OutOfCredits />
        </div>
      )}
    </div>
  );
}
