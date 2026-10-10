import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Link2, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, Import, ShieldCheck, Music, Clapperboard, RefreshCw,
  Scissors, Sparkles, FolderOpen,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useHubProject } from "@/lib/hub-project";

/* ─── Media Importer ────────────────────────────────────────────────────
   Paste a link — YouTube, SoundCloud, TikTok, Instagram, X, Vimeo, or a
   direct audio/video file — and the server pulls it into your library.
   2 credits per import, refunded automatically if the job fails.

   Legal framing (critical, also enforced server-side): this is for the
   user's OWN content, backups, and royalty-free material. The UI never
   markets it as a piracy downloader, and the user must actively confirm
   they have the rights before every import. */

const CREDIT_COST = 200;

type ImportFormat = "video" | "audio";

const FORMATS: Array<{ key: ImportFormat; labelKey: string; blurbKey: string; icon: typeof Clapperboard }> = [
  { key: "video", labelKey: "importPage.formatVideo", blurbKey: "importPage.formatVideoBlurb", icon: Clapperboard },
  { key: "audio", labelKey: "importPage.formatAudio", blurbKey: "importPage.formatAudioBlurb", icon: Music },
];

const SUPPORTED = ["YouTube", "SoundCloud", "TikTok", "Instagram", "X", "Vimeo"];

type JobStatus = "idle" | "starting" | "queued" | "processing" | "done" | "failed";

interface JobResponse {
  jobId?: string;
  status?: string;
  title?: string | null;
  mediaType?: "video" | "audio" | null;
  format?: string;
  outputUrl?: string | null;
  fileSize?: number | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
  creditsUsed?: number;
}

function formatBytes(
  n: number | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (n < 1024 * 1024) return t("importPage.kbSize", { size: (n / 1024).toFixed(0) });
  return t("importPage.mbSize", { size: (n / 1024 / 1024).toFixed(1) });
}

export default function MediaImport() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { addAsset } = useHubProject();
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<ImportFormat>("video");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [title, setTitle] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<"video" | "audio" | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const pollRef = useRef<number | null>(null);

  /* Poll the server-owned job until it completes. Tab-safe: the job
     lives on the server, so closing this page loses nothing. */
  useEffect(() => {
    if (!jobId || (status !== "queued" && status !== "processing")) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/media-import/${jobId}`);
        const data: JobResponse = await res.json();
        if (!res.ok) {
          setStatus("failed");
          setError(data.error || t("importPage.jobNotFound"));
          return;
        }
        if (data.status === "done") {
          setStatus("done");
          setTitle(data.title ?? null);
          setMediaType(data.mediaType ?? null);
          setOutputUrl(data.outputUrl ?? null);
          setFileSize(data.fileSize ?? null);
          /* Imported media flows into the hub project — no more dead-end downloads. */
          if (data.outputUrl) {
            try {
              addAsset({
                kind: data.mediaType === "audio" ? "song" : "video",
                url: data.outputUrl,
                label: data.title || "Imported media",
                detail: "Media importer",
              });
            } catch { /* hub unavailable — non-fatal */ }
          }
        } else if (data.status === "failed") {
          setStatus("failed");
          setError(data.error || t("importPage.importFailedRefunded", { cost: CREDIT_COST }));
        } else {
          setStatus(data.status as JobStatus);
          if (data.title) setTitle(data.title);
        }
      } catch {
        /* keep polling on transient network errors */
      }
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [jobId, status, t]);

  const urlLooksValid = /^https?:\/\/.+\..+/.test(url.trim());

  async function startImport() {
    if (!urlLooksValid || !rightsConfirmed || !user) return;
    setStatus("starting");
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await fetch("/api/media-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), format, rightsConfirmed }),
      });
      const data: JobResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      if (!res.ok || !data.jobId) {
        setStatus("failed");
        setError(data.message || data.error || t("importPage.startFailed"));
        return;
      }
      setJobId(data.jobId);
      setStatus("queued");
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setStatus("failed");
      setError(t("importPage.networkError"));
    }
  }

  function reset() {
    setUrl("");
    setJobId(null);
    setStatus("idle");
    setTitle(null);
    setMediaType(null);
    setOutputUrl(null);
    setFileSize(null);
    setError(null);
    setOutOfCredits(false);
    setRightsConfirmed(false);
  }

  const busy = status === "starting" || status === "queued" || status === "processing";

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> {t("importPage.back")}
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Import className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">{t("importPage.title")}</h1>
            <p className="text-sm text-white/45">{t("importPage.tagline", { cost: CREDIT_COST })}</p>
          </div>
        </div>

        {/* Rights framing — stated up front, confirmed per import */}
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-primary/25 bg-primary/[0.05] px-4 py-3">
          <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-white/60 leading-relaxed">
            <span className="text-white/85 font-semibold">{t("importPage.rightsTitle")}</span> — {t("importPage.rightsBody")}
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

        {/* Import form */}
        {(status === "idle" || status === "failed") && (
          <div className="mt-6 space-y-5">
            <div>
              <label className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2 block">
                {t("importPage.pasteLink")}
              </label>
              <div className="relative">
                <Link2 className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t("importPage.urlPlaceholder")}
                  className="w-full rounded-2xl border border-white/[0.1] bg-white/[0.03] pl-11 pr-4 py-4 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none"
                />
              </div>
              <p className="mt-2 text-xs text-white/35">
                {t("importPage.worksWith", { platforms: SUPPORTED.join(" · ") })}
              </p>
            </div>

            <div data-min-stars="2">
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">{t("importPage.format")}</p>
              <div className="grid grid-cols-2 gap-3">
                {FORMATS.map((f) => {
                  const Icon = f.icon;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFormat(f.key)}
                      className={`rounded-xl border px-4 py-3.5 text-left transition ${
                        format === f.key
                          ? "border-primary/60 bg-primary/[0.08]"
                          : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-primary" />
                        <span className="font-bold text-white text-sm">{t(f.labelKey)}</span>
                      </span>
                      <span className="text-xs text-white/40 mt-1 block">{t(f.blurbKey)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3.5">
              <input
                type="checkbox"
                checked={rightsConfirmed}
                onChange={(e) => setRightsConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-yellow-500"
              />
              <span className="text-xs text-white/60 leading-relaxed">
                {t("importPage.confirmPrefix")} <span className="text-white/85 font-semibold">{t("importPage.confirmEmphasis")}</span> {t("importPage.confirmSuffix")}
              </span>
            </label>

            <button
              onClick={startImport}
              disabled={!urlLooksValid || !rightsConfirmed || !user}
              className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("importPage.importButton", { cost: CREDIT_COST })}
            </button>
            {creditsRemaining != null && (
              <p className="text-center text-xs text-white/35">{t("importPage.creditsRemaining", { count: creditsRemaining })}</p>
            )}
          </div>
        )}

        {/* Progress */}
        {busy && (
          <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
            <p className="font-bold text-white">
              {status === "starting" ? t("importPage.starting") : status === "queued" ? t("importPage.queued") : t("importPage.downloading")}
            </p>
            <p className="text-sm text-white/40 mt-1">
              {t("importPage.progressNote")}
            </p>
          </div>
        )}

        {/* Result */}
        {status === "done" && outputUrl && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-white/80">{title ? t("importPage.importedWithTitle", { title }) : t("importPage.imported")}</p>
                {fileSize != null && (
                  <p className="text-xs text-white/40">{t("importPage.savedToLibrary", { size: formatBytes(fileSize, t), lib: t(mediaType === "audio" ? "importPage.song" : "importPage.video") })}</p>
                )}
              </div>
            </div>
            {mediaType === "video" ? (
              <video src={outputUrl} controls className="w-full rounded-2xl border border-white/[0.08] bg-black" />
            ) : (
              <audio src={outputUrl} controls className="w-full" />
            )}
            <div className="flex gap-3">
              <a
                href={outputUrl}
                download={mediaType === "audio" ? "import.mp3" : "import.mp4"}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 font-bold text-black transition hover:brightness-110"
              >
                <Download className="h-4 w-4" /> {t("importPage.download")}
              </a>
              <button
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
              >
                <RefreshCw className="h-4 w-4" /> {t("importPage.newImport")}
              </button>
            </div>
            {/* Next steps — the import no longer dead-ends at download */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Link
                href={mediaType === "audio" ? `/stems?audioUrl=${encodeURIComponent(outputUrl)}` : `/video-editor`}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-bold text-primary transition hover:bg-primary/20"
              >
                <Scissors className="h-4 w-4" /> {t("importPage.useInStems", { defaultValue: mediaType === "audio" ? "Split stems" : "Open in editor" })}
              </Link>
              <Link
                href={mediaType === "audio" ? `/make-song?audioUrl=${encodeURIComponent(outputUrl)}` : `/caption-styler?video=${encodeURIComponent(outputUrl)}`}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/[0.12] px-4 py-3 text-sm font-bold text-white/70 transition hover:border-white/25 hover:text-white"
              >
                <Sparkles className="h-4 w-4" /> {t("importPage.useInSong", { defaultValue: mediaType === "audio" ? "Use in a song" : "Add captions" })}
              </Link>
              <Link
                href="/my-clips"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/[0.12] px-4 py-3 text-sm font-bold text-white/70 transition hover:border-white/25 hover:text-white"
              >
                <FolderOpen className="h-4 w-4" /> {t("importPage.viewLibrary", { defaultValue: "My clips" })}
              </Link>
            </div>
          </div>
        )}
      </main>

    </div>
  );
}
