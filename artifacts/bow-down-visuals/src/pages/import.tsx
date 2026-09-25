import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Link2, Loader2, Download, AlertTriangle, CheckCircle2,
  ArrowLeft, Import, ShieldCheck, Music, Clapperboard, RefreshCw,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Media Importer ────────────────────────────────────────────────────
   Paste a link — YouTube, SoundCloud, TikTok, Instagram, X, Vimeo, or a
   direct audio/video file — and the server pulls it into your library.
   2 credits per import, refunded automatically if the job fails.

   Legal framing (critical, also enforced server-side): this is for the
   user's OWN content, backups, and royalty-free material. The UI never
   markets it as a piracy downloader, and the user must actively confirm
   they have the rights before every import. */

const CREDIT_COST = 2;

type ImportFormat = "video" | "audio";

const FORMATS: Array<{ key: ImportFormat; label: string; blurb: string; icon: typeof Clapperboard }> = [
  { key: "video", label: "Video · MP4", blurb: "Best quality video, browser-ready", icon: Clapperboard },
  { key: "audio", label: "Audio · MP3", blurb: "Audio-only, 192k MP3 for your song library", icon: Music },
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

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function MediaImport() {
  const { user } = useAuth();
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
          setError(data.error || "Import job not found");
          return;
        }
        if (data.status === "done") {
          setStatus("done");
          setTitle(data.title ?? null);
          setMediaType(data.mediaType ?? null);
          setOutputUrl(data.outputUrl ?? null);
          setFileSize(data.fileSize ?? null);
        } else if (data.status === "failed") {
          setStatus("failed");
          setError(data.error || `Import failed — your ${CREDIT_COST} credits were refunded.`);
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
  }, [jobId, status]);

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
        setError(data.message || data.error || "Could not start the import.");
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
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Import className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">Media Importer</h1>
            <p className="text-sm text-white/45">Paste a link, pull it into your library — {CREDIT_COST} credits</p>
          </div>
        </div>

        {/* Rights framing — stated up front, confirmed per import */}
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-primary/25 bg-primary/[0.05] px-4 py-3">
          <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-white/60 leading-relaxed">
            <span className="text-white/85 font-semibold">Only import content you own or have the rights to</span> —
            your own uploads, backups, client work, and royalty-free material. This tool exists so
            creators can pull their own media into Bow Down Visuals in one click. Importing someone
            else's copyrighted work without permission violates our terms and can get your account
            suspended.
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
                Paste your link
              </label>
              <div className="relative">
                <Link2 className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                  className="w-full rounded-2xl border border-white/[0.1] bg-white/[0.03] pl-11 pr-4 py-4 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none"
                />
              </div>
              <p className="mt-2 text-xs text-white/35">
                Works with {SUPPORTED.join(" · ")} and direct links to audio/video files (MP3, MP4, WAV, …).
                Files up to 500&nbsp;MB.
              </p>
            </div>

            <div>
              <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">Format</p>
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
                        <span className="font-bold text-white text-sm">{f.label}</span>
                      </span>
                      <span className="text-xs text-white/40 mt-1 block">{f.blurb}</span>
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
                I confirm this is <span className="text-white/85 font-semibold">my own content, a backup, client
                work, or royalty-free material</span> that I have the right to import — not someone
                else's copyrighted work.
              </span>
            </label>

            <button
              onClick={startImport}
              disabled={!urlLooksValid || !rightsConfirmed || !user}
              className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Import media · {CREDIT_COST} credits
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
              {status === "starting" ? "Starting your import…" : status === "queued" ? "In the import queue…" : "Downloading your media…"}
            </p>
            <p className="text-sm text-white/40 mt-1">
              This runs on our servers — safe to close this tab. Your file will be waiting in your library.
            </p>
          </div>
        )}

        {/* Result */}
        {status === "done" && outputUrl && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-white/80">Imported{title ? ` — ${title}` : ""}</p>
                {fileSize != null && (
                  <p className="text-xs text-white/40">{formatBytes(fileSize)} · saved to your {mediaType === "audio" ? "song" : "video"} library</p>
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
                <Download className="h-4 w-4" /> Download
              </a>
              <button
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
              >
                <RefreshCw className="h-4 w-4" /> New import
              </button>
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
