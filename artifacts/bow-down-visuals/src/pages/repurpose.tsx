import { useEffect, useRef, useState } from "react";
import {
  Recycle, Loader2, Upload, Link2, Copy, Check, Download,
  AlertTriangle, RefreshCw, Clapperboard, Image as ImageIcon,
  MessageSquareText, Share2, Sparkles, Film, Captions, Scissors,
  Play, Clock, Flame,
} from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { PublishToProfileButton } from "@/components/publish/PublishToProfileButton";
import { HighlightCutter } from "@/components/wave8/HighlightCutter";
import { formatClipTimestamp, buildTimestampExport } from "@/lib/clip-maker";
import {
  PACK_CREDITS,
  REROLL_CREDITS,
  formatRepurposeTimestamp,
  buildCaptionsExport,
  packProgress,
  PLATFORM_LABELS,
  type PlatformKey,
} from "@/lib/repurpose";
import { useTranslation } from "react-i18next";
import { useHubProject } from "@/lib/hub-project";

/* ─── Thy Cheat Code's Content Repurposer ─────────────────────────────────
   One video in, content calendar out: upload a video → AI transcribes it
   and builds a 10-piece repurpose pack — 3 auto-cut vertical clips, 3 AI
   thumbnails, 5 caption+hashtag sets, 4 platform-optimized descriptions.
   5 credits for the full pack. Individual re-rolls 1 credit each.
   Viewing, copying, and downloading finished outputs is free. */

interface Moment {
  id: string;
  startSec: number;
  endSec: number;
  title: string;
  reason: string;
  quote: string;
}

interface CaptionSet {
  caption: string;
  hashtags: string[];
}

interface PlatformDescriptions {
  tiktok: string;
  reels: string;
  shorts: string;
  x: string;
}

interface AnalyzeResponse {
  videoRef?: string;
  durationSec?: number;
  transcript?: string;
  analysis?: {
    videoTitle: string;
    summary: string;
    moments: Moment[];
    captions: CaptionSet[];
    descriptions: PlatformDescriptions;
    thumbnailPrompts: string[];
  };
  clipJobId?: string;
  thumbnailJobId?: string;
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

interface JobClip {
  title: string;
  startSec: number;
  endSec: number;
  outputUrl: string | null;
}

interface JobThumb {
  prompt: string;
  imageUrl: string | null;
}

interface JobResponse {
  jobId?: string;
  kind?: "clips" | "thumbnails";
  status?: "queued" | "processing" | "done" | "failed";
  clips?: JobClip[];
  thumbnails?: JobThumb[];
  error?: string;
  message?: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const cardClass =
  "rounded-2xl border border-white/10 bg-white/[0.02] p-6";

function SectionHeader(props: { icon: typeof Film; step?: number; title: string; blurb?: string; right?: React.ReactNode }) {
  const Icon = props.icon;
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold">
          {props.step != null && (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-sm font-black text-primary">
              {props.step}
            </span>
          )}
          <Icon className="h-5 w-5 text-primary" />
          {props.title}
        </h2>
        {props.blurb && <p className="mt-1 text-sm text-white/50">{props.blurb}</p>}
      </div>
      {props.right}
    </div>
  );
}

/* ─── Stream VOD preset (merged from the Streamer Clip Maker page) ───────
   Upload a stream VOD → Whisper transcribes it → GPT-6 finds the best
   moments → server-side ffmpeg cuts them into vertical 9:16 clips.
   3 credits per AI analysis, 2 credits per rendered clip. Viewing the
   highlight list, selecting highlights, and copying timestamps are free.
   Registry keys: /api/streamer-clips/analyze (3cr), /api/streamer-clips/cut
   (2cr/clip via overrideCost). Wave 8's Stream Highlight Auto-Editor
   (HighlightCutter) is preserved below as its own step. */

type StreamVibeKey = "funny" | "hype" | "wholesome";

interface StreamVibe {
  key: StreamVibeKey;
  label: string;
  blurb: string;
  icon: typeof Flame;
}

const CLIP_LENGTHS = [15, 30, 60];
const ANALYZE_COST = 3;
const CUT_COST_PER_CLIP = 2;

interface StreamHighlight {
  id: string;
  startSec: number;
  endSec: number;
  title: string;
  reason: string;
  quote: string;
}

interface StreamAnalyzeResponse {
  videoRef?: string;
  videoUrl?: string;
  durationSec?: number;
  highlights?: StreamHighlight[];
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

interface StreamCutClip {
  title: string;
  startSec: number;
  endSec: number;
  outputUrl: string | null;
  outputRef: string | null;
}

interface StreamCutJobResponse {
  jobId?: string;
  status?: "queued" | "processing" | "done" | "failed";
  clips?: StreamCutClip[];
  error?: string;
  message?: string;
}

function StreamVodClips() {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();

  const VIBES: StreamVibe[] = [
    { key: "funny", label: t("clipMaker.vibeFunnyLabel"), blurb: t("clipMaker.vibeFunnyBlurb"), icon: Sparkles },
    { key: "hype", label: t("clipMaker.vibeHypeLabel"), blurb: t("clipMaker.vibeHypeBlurb"), icon: Flame },
    { key: "wholesome", label: t("clipMaker.vibeWholesomeLabel"), blurb: t("clipMaker.vibeWholesomeBlurb"), icon: Clapperboard },
  ];

  /* source + preferences */
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [clipLength, setClipLength] = useState(30);
  const [maxClips, setMaxClips] = useState(5);
  const [vibe, setVibe] = useState<StreamVibeKey>("hype");

  /* analysis */
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<StreamAnalyzeResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /* cutting */
  const [cutting, setCutting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<StreamCutJobResponse | null>(null);
  const pollRef = useRef<number | null>(null);

  /* shared */
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  /* Authenticated fetch that routes SPENDING calls through the credit
     confirmation popup. Status/health polls must pass skipConfirm: true. */
  async function authedFetch(
    url: string,
    init: RequestInit & { skipConfirm?: boolean; overrideCost?: number; overrideFeature?: string },
  ) {
    const token = await getAccessToken();
    return confirmedFetch(url, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  }

  function handlePaidFailure(res: Response, data: { error?: string }): boolean {
    if (res.status === 402 || data.error === "out_of_credits") {
      setOutOfCredits(true);
      refreshProfile();
      return true;
    }
    return false;
  }

  async function analyze() {
    if (analyzing || !user) return;
    if (!file && !videoUrl.trim()) {
      setError(t("clipMaker.errorNoSource"));
      return;
    }
    setAnalyzing(true);
    setError(null);
    setOutOfCredits(false);
    setAnalysis(null);
    setJob(null);
    setJobId(null);
    try {
      let res: Response | null;
      if (file) {
        const form = new FormData();
        form.append("video", file);
        form.append("clipLength", String(clipLength));
        form.append("maxClips", String(maxClips));
        form.append("vibe", vibe);
        res = await authedFetch("/api/streamer-clips/analyze", { method: "POST", body: form });
      } else {
        res = await authedFetch("/api/streamer-clips/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoUrl: videoUrl.trim(), clipLength, maxClips, vibe }),
        });
      }
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = (await res.json().catch(() => ({}))) as StreamAnalyzeResponse;
      if (handlePaidFailure(res, data)) return;
      if (!res.ok || !Array.isArray(data.highlights) || data.highlights.length === 0) {
        throw new Error(data.message || data.error || t("clipMaker.errorAnalysisFailed"));
      }
      setAnalysis(data);
      setSelected(new Set(data.highlights.map((h) => h.id)));
      refreshProfile();
      setTimeout(() => {
        document.getElementById("clip-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("clipMaker.errorAnalysisFailed"));
    } finally {
      setAnalyzing(false);
    }
  }

  function toggleHighlight(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function copyTimestamps() {
    if (!analysis?.highlights) return;
    const picks = analysis.highlights.filter((h) => selected.has(h.id));
    const text = buildTimestampExport(picks);
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setError(t("clipMaker.errorCopyFailed")),
    );
  }

  async function cutClips() {
    if (cutting || !user || !analysis?.videoRef) return;
    const picks = (analysis.highlights ?? []).filter((h) => selected.has(h.id));
    if (picks.length === 0) {
      setError(t("clipMaker.errorNoSelection"));
      return;
    }
    setCutting(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await authedFetch("/api/streamer-clips/cut", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoRef: analysis.videoRef,
          clips: picks.map((h) => ({ startSec: h.startSec, endSec: h.endSec, title: h.title })),
        }),
        overrideCost: picks.length * CUT_COST_PER_CLIP,
        overrideFeature: t("clipMaker.cutFeatureName"),
      });
      if (!res) { setCutting(false); return; } // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as StreamCutJobResponse;
      if (handlePaidFailure(res, data)) return;
      if (!res.ok || !data.jobId) {
        throw new Error(data.message || data.error || t("clipMaker.errorCutStartFailed"));
      }
      setJobId(data.jobId);
      refreshProfile();
      pollJob(data.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("clipMaker.errorCutFailed"));
      setCutting(false);
    }
  }

  async function pollJob(id: string) {
    if (pollRef.current) window.clearInterval(pollRef.current);
    const tick = async () => {
      try {
        const res = await authedFetch(`/api/streamer-clips/cut/${id}`, { method: "GET", skipConfirm: true });
        if (!res) return; // unreachable with skipConfirm, keeps TS happy
        const data = (await res.json().catch(() => ({}))) as StreamCutJobResponse;
        if (!res.ok) throw new Error(data.error || t("clipMaker.errorJobLookup"));
        setJob(data);
        if (data.status === "done" || data.status === "failed") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setCutting(false);
          refreshProfile();
          if (data.status === "failed") {
            setError(data.error || t("clipMaker.errorCutRefunded"));
          } else {
            /* Cut clips flow into the hub project — editor, captions and scheduler pick them up. */
            for (const c of data.clips ?? []) {
              if (c.outputUrl) {
                try {
                  addAsset({ kind: "clip", url: c.outputUrl, label: c.title || "Clip", detail: `${formatClipTimestamp(c.startSec)}–${formatClipTimestamp(c.endSec)} · ${vibe}` });
                } catch { /* hub unavailable — non-fatal */ }
              }
            }
          }
        }
      } catch (err) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        setCutting(false);
        setError(err instanceof Error ? err.message : t("clipMaker.errorJobLost"));
      }
    };
    await tick();
    pollRef.current = window.setInterval(tick, 5000);
  }

  const selectedCount = selected.size;
  const cutCost = selectedCount * CUT_COST_PER_CLIP;
  const highlights = analysis?.highlights ?? [];

  return (
    <div>
      {!user && (
        <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-center text-sm text-amber-200">
          {t("clipMaker.signInPrompt")}
        </div>
      )}

      {/* Step 1 — source */}
      <section className="mt-10 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-sm font-black text-primary">1</span>
          {t("clipMaker.step1Title")}
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/15 bg-black/40 px-4 py-8 text-center transition hover:border-primary/50">
            <Upload className="h-6 w-6 text-primary" />
            <span className="text-sm font-semibold">{file ? file.name : t("clipMaker.chooseFile")}</span>
            <span className="text-xs text-white/40">{t("clipMaker.fileHint")}</span>
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setVideoUrl("");
              }}
            />
          </label>
          <div className="flex flex-col justify-center gap-2 rounded-xl border border-white/10 bg-black/40 px-4 py-6">
            <span className="flex items-center gap-2 text-sm font-semibold text-white/70">
              <Link2 className="h-4 w-4 text-primary" /> {t("clipMaker.orPasteUrl")}
            </span>
            <input
              className={inputClass}
              placeholder={t("clipMaker.urlPlaceholder")}
              value={videoUrl}
              onChange={(e) => {
                setVideoUrl(e.target.value);
                setFile(null);
              }}
            />
            <span className="text-xs text-white/40">{t("clipMaker.urlHint")}</span>
          </div>
        </div>

        {/* Preferences */}
        <div className="mt-6 grid gap-5 sm:grid-cols-3">
          <div data-min-stars="2">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/45">{t("clipMaker.clipLength")}</div>
            <div className="flex gap-2">
              {CLIP_LENGTHS.map((len) => (
                <button
                  key={len}
                  onClick={() => setClipLength(len)}
                  className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-bold transition ${
                    clipLength === len
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-white/10 bg-black/40 text-white/55 hover:border-white/25"
                  }`}
                >
                  {t("clipMaker.secondsLabel", { n: len })}
                </button>
              ))}
            </div>
          </div>
          <div data-min-stars="3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/45">
              {t("clipMaker.maxClips")} · <span className="text-primary">{maxClips}</span>
            </div>
            <input
              type="range"
              min={1}
              max={8}
              value={maxClips}
              onChange={(e) => setMaxClips(Number(e.target.value))}
              className="w-full accent-amber-400"
            />
          </div>
          <div data-min-stars="2">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/45">{t("clipMaker.vibe")}</div>
            <div className="flex gap-2">
              {VIBES.map((v) => (
                <button
                  key={v.key}
                  title={v.blurb}
                  onClick={() => setVibe(v.key)}
                  className={`flex-1 rounded-xl border px-2 py-2.5 text-xs font-bold transition ${
                    vibe === v.key
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-white/10 bg-black/40 text-white/55 hover:border-white/25"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={analyze}
          disabled={analyzing || !user}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 text-base font-black text-black transition hover:brightness-110 disabled:opacity-40"
        >
          {analyzing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
          {analyzing ? t("clipMaker.analyzing") : t("clipMaker.findHighlights", { cost: ANALYZE_COST })}
        </button>
        <p className="mt-2 text-center text-xs text-white/40">
          {t("clipMaker.analyzeNote", { vibe })}
        </p>
      </section>

      {outOfCredits && (
        <div className="mt-6">
          <OutOfCredits />
        </div>
      )}
      {error && (
        <div className="mt-6 flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Step 2 — highlights */}
      {highlights.length > 0 && (
        <section id="clip-results" className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-sm font-black text-primary">2</span>
              {t("clipMaker.highlightsFound", { count: highlights.length })}
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => setSelected(new Set(highlights.map((h) => h.id)))}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-white/60 hover:border-white/25"
              >
                {t("clipMaker.selectAll")}
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-white/60 hover:border-white/25"
              >
                {t("clipMaker.clear")}
              </button>
              <button
                onClick={copyTimestamps}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-white/60 hover:border-white/25"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t("clipMaker.copied") : t("clipMaker.copyTimestamps")}
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {highlights.map((h) => {
              const on = selected.has(h.id);
              return (
                <button
                  key={h.id}
                  onClick={() => toggleHighlight(h.id)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition ${
                    on ? "border-primary/60 bg-primary/[0.07]" : "border-white/10 bg-black/40 opacity-70 hover:opacity-100"
                  }`}
                >
                  <span
                    className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                      on ? "border-primary bg-primary text-black" : "border-white/25 text-transparent"
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="flex items-center gap-1 rounded-md bg-black/60 px-2 py-0.5 font-mono text-xs text-primary">
                        <Clock className="h-3 w-3" />
                        {formatClipTimestamp(h.startSec)}–{formatClipTimestamp(h.endSec)}
                      </span>
                      <span className="font-bold">{h.title}</span>
                    </span>
                    <span className="mt-1 block text-sm text-white/55">{h.reason}</span>
                    {h.quote && (
                      <span className="mt-1 block text-sm italic text-white/40">“{h.quote}”</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            onClick={cutClips}
            disabled={cutting || selectedCount === 0 || !user}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 text-base font-black text-black transition hover:brightness-110 disabled:opacity-40"
          >
            {cutting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Scissors className="h-5 w-5" />}
            {cutting
              ? t("clipMaker.cutting")
              : selectedCount === 0
                ? t("clipMaker.selectToCut")
                : t("clipMaker.cutClips", { count: selectedCount, cost: cutCost })}
          </button>
          <p className="mt-2 text-center text-xs text-white/40">
            {t("clipMaker.cutNote")}
          </p>
        </section>
      )}

      {/* Wave 8 — Stream Highlight Auto-Editor: scored reel plan from chat / transcript */}
      <div className="mt-8">
        <HighlightCutter />
      </div>

      {/* Step 3 — cut results */}
      {(job || jobId) && (
        <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-sm font-black text-primary">3</span>
            {t("clipMaker.step3Title")}
            {job?.status === "processing" || job?.status === "queued" ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : null}
          </h2>
          {(!job || job.status === "queued" || job.status === "processing") && (
            <p className="mt-3 flex items-center gap-2 text-sm text-white/55">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              {t("clipMaker.cuttingBackground")}
            </p>
          )}
          {job?.status === "done" && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {job.clips?.map((c, i) => (
                <div key={i} className="overflow-hidden rounded-xl border border-white/10 bg-black/60">
                  {c.outputUrl ? (
                    <video src={c.outputUrl} controls playsInline className="aspect-[9/16] w-full bg-black" />
                  ) : (
                    <div className="flex aspect-[9/16] items-center justify-center text-white/30">
                      <Play className="h-8 w-8" />
                    </div>
                  )}
                  <div className="p-3">
                    <div className="truncate text-sm font-bold">{c.title}</div>
                    <div className="font-mono text-xs text-white/40">{formatClipTimestamp(c.startSec)}–{formatClipTimestamp(c.endSec)}</div>
                    {c.outputUrl && (
                      <>
                        <a
                          href={c.outputUrl}
                          download
                          className="mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-primary/15 px-3 py-2 text-xs font-bold text-primary transition hover:bg-primary/25"
                        >
                          <Download className="h-3.5 w-3.5" /> {t("clipMaker.downloadClip")}
                        </a>
                        <Link
                          href={`/caption-styler?video=${encodeURIComponent(c.outputUrl)}`}
                          className="mt-1.5 flex items-center justify-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs font-bold text-white/70 transition hover:border-white/30 hover:text-white"
                        >
                          <Captions className="h-3.5 w-3.5" /> {t("clipMaker.addCaptions", { defaultValue: "Add captions" })}
                        </Link>
                        <div className="mt-1.5">
                          <PublishToProfileButton
                            compact
                            type="video"
                            category="video"
                            videoUrl={c.outputUrl}
                            title={c.title}
                            from="/repurpose"
                            fromLabel="Repurpose"
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {job?.status === "failed" && (
            <p className="mt-3 text-sm text-red-300">
              {t("clipMaker.cuttingFailedNote", { error: job.error ? `: ${job.error}` : "" })}
            </p>
          )}
        </section>
      )}

      {/* How it works */}
      <section className="mt-10 grid gap-4 sm:grid-cols-3">
        {[
          { icon: Upload, title: t("clipMaker.how1Title"), text: t("clipMaker.how1Text") },
          { icon: Sparkles, title: t("clipMaker.how2Title"), text: t("clipMaker.how2Text", { lengths: CLIP_LENGTHS.join("/"), vibe }) },
          { icon: Scissors, title: t("clipMaker.how3Title"), text: t("clipMaker.how3Text") },
        ].map((s) => (
          <div key={s.title} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <s.icon className="h-6 w-6 text-primary" />
            <div className="mt-2 font-bold">{s.title}</div>
            <div className="mt-1 text-sm text-white/55">{s.text}</div>
          </div>
        ))}
      </section>
    </div>
  );
}

export default function Repurpose({ embedded }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { addAsset } = useHubProject();

  /* source */
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");

  /* pack */
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [clipJob, setClipJob] = useState<JobResponse | null>(null);
  const [thumbJob, setThumbJob] = useState<JobResponse | null>(null);

  /* re-rolls */
  const [rerolling, setRerolling] = useState<string | null>(null);
  const [rerollThumbIdx, setRerollThumbIdx] = useState<number | null>(null);

  /* shared */
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [platformTab, setPlatformTab] = useState<PlatformKey>("tiktok");
  const pollRef = useRef<number | null>(null);

  /* ── Content Pack vs Stream VOD (merged Streamer Clip Maker) ── */
  const [mode, setMode] = useState<"pack" | "stream">("pack");

  /* Deep-link: /repurpose?mode=stream jumps straight to the Stream VOD preset. */
  useEffect(() => {
    try {
      const m = new URLSearchParams(window.location.search).get("mode");
      if (m === "stream") setMode("stream");
    } catch {
      /* non-browser or malformed URL — ignore */
    }
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  async function authedFetch(url: string, init: RequestInit) {
    const token = await getAccessToken();
    return fetch(url, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  }

  function handlePaidFailure(res: Response, data: { error?: string }): boolean {
    if (res.status === 402 || data.error === "out_of_credits") {
      setOutOfCredits(true);
      refreshProfile();
      return true;
    }
    return false;
  }

  function copyText(key: string, text: string) {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 2000);
      },
      () => setError(t("repurpose.error.copyFailed")),
    );
  }

  async function repurpose() {
    if (analyzing || !user) return;
    if (!file && !videoUrl.trim()) {
      setError(t("repurpose.error.noSource"));
      return;
    }
    setAnalyzing(true);
    setError(null);
    setOutOfCredits(false);
    setAnalysis(null);
    setClipJob(null);
    setThumbJob(null);
    try {
      let res: Response;
      if (file) {
        const form = new FormData();
        form.append("video", file);
        res = await authedFetch("/api/repurpose/analyze", { method: "POST", body: form });
      } else {
        res = await authedFetch("/api/repurpose/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoUrl: videoUrl.trim() }),
        });
      }
      const data = (await res.json().catch(() => ({}))) as AnalyzeResponse;
      if (handlePaidFailure(res, data)) return;
      if (!res.ok || !data.analysis) {
        throw new Error(data.message || data.error || t("repurpose.error.repurposeFailed"));
      }
      setAnalysis(data);
      refreshProfile();
      if (data.clipJobId) pollJobs(data.clipJobId, data.thumbnailJobId ?? null);
      setTimeout(() => {
        document.getElementById("repurpose-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("repurpose.error.repurposeFailed"));
    } finally {
      setAnalyzing(false);
    }
  }

  async function pollJobs(clipId: string, thumbId: string | null) {
    if (pollRef.current) window.clearInterval(pollRef.current);
    const tick = async () => {
      try {
        const [clipRes, thumbRes] = await Promise.all([
          authedFetch(`/api/repurpose/jobs/${clipId}`, { method: "GET" }),
          thumbId ? authedFetch(`/api/repurpose/jobs/${thumbId}`, { method: "GET" }) : Promise.resolve(null),
        ]);
        const clipData = (await clipRes.json().catch(() => ({}))) as JobResponse;
        if (!clipRes.ok) throw new Error(clipData.error || t("repurpose.error.clipJobFailed"));
        setClipJob(clipData);
        let thumbData: JobResponse | null = null;
        if (thumbRes) {
          thumbData = (await thumbRes.json().catch(() => ({}))) as JobResponse;
          if (!thumbRes.ok) throw new Error(thumbData.error || t("repurpose.error.thumbJobFailed"));
          setThumbJob(thumbData);
        }
        const clipDone = clipData.status === "done" || clipData.status === "failed";
        const thumbDone = !thumbId || !thumbData || thumbData.status === "done" || thumbData.status === "failed";
        if (clipDone && thumbDone) {
          /* Finished clips + thumbnails flow into the hub project. */
          for (const c of clipData.clips ?? []) {
            if (c.outputUrl) {
              try { addAsset({ kind: "clip", url: c.outputUrl, label: c.title || "Clip", detail: "Repurpose" }); } catch { /* non-fatal */ }
            }
          }
          for (const th of thumbData?.thumbnails ?? []) {
            if (th.imageUrl) {
              try { addAsset({ kind: "thumbnail", url: th.imageUrl, label: th.prompt?.slice(0, 60) || "Thumbnail", detail: "Repurpose" }); } catch { /* non-fatal */ }
            }
          }
          if (pollRef.current) window.clearInterval(pollRef.current);
          refreshProfile();
          if (clipData.status === "failed") {
            setError(clipData.error || t("repurpose.error.clipCuttingFailed"));
          } else if (thumbData && thumbData.status === "failed") {
            setError(t("repurpose.error.thumbFailed"));
          }
        }
      } catch (err) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        setError(err instanceof Error ? err.message : t("repurpose.error.lostJobs"));
      }
    };
    await tick();
    pollRef.current = window.setInterval(tick, 5000);
  }

  async function rerollText(kind: "captions" | "descriptions" | "moments" | "thumbnailPrompts") {
    if (rerolling || !user || !analysis?.transcript) return;
    setRerolling(kind);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await authedFetch("/api/repurpose/reroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: analysis.transcript,
          kind,
          durationSec: analysis.durationSec ?? 0,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { kind?: string; result?: unknown; error?: string; message?: string };
      if (handlePaidFailure(res, data)) return;
      if (!res.ok || data.result == null) {
        throw new Error(data.message || data.error || t("repurpose.error.rerollFailed"));
      }
      setAnalysis((prev) => {
        if (!prev?.analysis) return prev;
        return {
          ...prev,
          analysis: { ...prev.analysis!, [kind]: data.result },
        };
      });
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("repurpose.error.rerollFailed"));
    } finally {
      setRerolling(null);
    }
  }

  async function rerollThumbnail(prompt: string, index: number) {
    if (rerollThumbIdx != null || !user) return;
    setRerollThumbIdx(index);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await authedFetch("/api/repurpose/reroll-thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = (await res.json().catch(() => ({}))) as { imageUrl?: string; error?: string; message?: string };
      if (handlePaidFailure(res, data)) return;
      if (!res.ok || !data.imageUrl) {
        throw new Error(data.message || data.error || t("repurpose.error.thumbRerollFailed"));
      }
      setThumbJob((prev) => {
        if (!prev?.thumbnails) return prev;
        const thumbnails = prev.thumbnails.map((t, i) =>
          i === index ? { ...t, imageUrl: data.imageUrl! } : t,
        );
        return { ...prev, thumbnails };
      });
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("repurpose.error.thumbRerollFailed"));
    } finally {
      setRerollThumbIdx(null);
    }
  }

  const a = analysis?.analysis;
  const clipsReady = (clipJob?.clips ?? []).filter((c) => c.outputUrl).length;
  const thumbsReady = (thumbJob?.thumbnails ?? []).filter((t) => t.imageUrl).length;
  const progress = packProgress({
    clips: clipsReady,
    thumbnails: thumbsReady,
    captions: a ? 1 : 0,
    descriptions: a ? 1 : 0,
  });

  return (
    <div className={embedded ? "text-white" : "min-h-screen bg-black text-white"}>
      <main className={embedded ? "" : "mx-auto max-w-5xl px-4 pb-24 pt-28"}>
        {/* Hero (standalone page only; the shell provides it when embedded) */}
        {!embedded && (
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
            <Recycle className="h-3.5 w-3.5" />
            {t("repurpose.badge")}
          </div>
          <h1 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">
            {t("repurpose.titlePrefix")} <span className="text-primary">{t("repurpose.titleSuffix")}</span>
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-white/55">
            {t("repurpose.hero")}
          </p>
        </div>
        )}

        {/* Mode toggle: 10-piece Content Pack vs Stream VOD clip cutter */}
        <div className="mt-8 flex justify-center">
          <div className="inline-flex rounded-2xl border border-white/10 bg-white/[0.03] p-1.5" role="tablist" aria-label={t("repurpose.modeLabel", { defaultValue: "Repurpose mode" })}>
            <button
              role="tab"
              aria-selected={mode === "pack"}
              onClick={() => setMode("pack")}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                mode === "pack" ? "bg-primary text-black" : "text-white/55 hover:text-white"
              }`}
            >
              <Recycle className="h-4 w-4" />
              {t("repurpose.modePack", { defaultValue: "Content Pack" })}
            </button>
            <button
              role="tab"
              aria-selected={mode === "stream"}
              onClick={() => setMode("stream")}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                mode === "stream" ? "bg-primary text-black" : "text-white/55 hover:text-white"
              }`}
            >
              <Scissors className="h-4 w-4" />
              {t("repurpose.modeStreamVod", { defaultValue: "Stream VOD" })}
            </button>
          </div>
        </div>

        {mode === "stream" ? (
          <StreamVodClips />
        ) : (
        <>

        {!user && (
          <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-center text-sm text-amber-200">
            {t("repurpose.signInRequired")}
          </div>
        )}

        {outOfCredits && (
          <div className="mx-auto mt-8 max-w-xl">
            <OutOfCredits />
          </div>
        )}

        {error && (
          <div className="mx-auto mt-6 flex max-w-3xl items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Step 1 — source */}
        <section className={`${cardClass} mt-10`}>
          <SectionHeader icon={Upload} step={1} title={t("repurpose.step1.title")} blurb={t("repurpose.step1.blurb")} />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/15 bg-black/40 px-4 py-8 text-center transition hover:border-primary/50">
              <Upload className="h-6 w-6 text-primary" />
              <span className="text-sm font-semibold">{file ? file.name : t("repurpose.step1.chooseFile")}</span>
              <span className="text-xs text-white/40">{t("repurpose.step1.fromCameraRoll")}</span>
              <input
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setVideoUrl("");
                }}
              />
            </label>
            <div className="flex flex-col justify-center gap-2 rounded-xl border border-white/10 bg-black/40 px-4 py-6">
              <span className="flex items-center gap-2 text-sm font-semibold text-white/70">
                <Link2 className="h-4 w-4 text-primary" /> {t("repurpose.step1.orPasteUrl")}
              </span>
              <input
                className={inputClass}
                placeholder={t("repurpose.step1.urlPlaceholder")}
                value={videoUrl}
                onChange={(e) => {
                  setVideoUrl(e.target.value);
                  setFile(null);
                }}
              />
              <span className="text-xs text-white/40">{t("repurpose.step1.urlNote")}</span>
            </div>
          </div>
          <div className="mt-6 flex flex-col items-center gap-3">
            <button
              onClick={repurpose}
              disabled={analyzing || !user || (!file && !videoUrl.trim())}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-8 py-3.5 text-base font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {analyzing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
              {analyzing ? t("repurpose.building") : t("repurpose.repurposeButton", { credits: PACK_CREDITS })}
            </button>
            <p className="text-xs text-white/40">
              {t("repurpose.costNote", { pack: PACK_CREDITS * 100, reroll: REROLL_CREDITS })}
            </p>
          </div>
        </section>

        {/* Step 2 — results */}
        {a && (
          <div id="repurpose-results" className="mt-10 space-y-8">
            {/* Pack header */}
            <section className={cardClass}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-black">{a.videoTitle}</h2>
                  {a.summary && <p className="mt-1 max-w-2xl text-sm text-white/55">{a.summary}</p>}
                </div>
                <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-center">
                  <div className="text-2xl font-black text-primary">{progress.done}<span className="text-white/40">/{progress.total}</span></div>
                  <div className="text-[11px] uppercase tracking-wider text-white/50">{t("repurpose.packReady")}</div>
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
              {(clipJob?.status === "processing" || clipJob?.status === "queued" ||
                thumbJob?.status === "processing" || thumbJob?.status === "queued") && (
                <p className="mt-3 flex items-center gap-2 text-sm text-white/50">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  {t("repurpose.renderingNote")}
                </p>
              )}
            </section>

            {/* Clips */}
            <section className={cardClass}>
              <SectionHeader
                icon={Clapperboard}
                title={t("repurpose.clips.title")}
                blurb={t("repurpose.clips.blurb")}
                right={
                  <button
                    onClick={() => rerollText("moments")}
                    disabled={rerolling === "moments"}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-white disabled:opacity-40"
                  >
                    {rerolling === "moments" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {t("repurpose.clips.newMoments", { cost: REROLL_CREDITS })}
                  </button>
                }
              />
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {(clipJob?.clips ?? a.moments.map((m) => ({ title: m.title, startSec: m.startSec, endSec: m.endSec, outputUrl: null as string | null }))).map((clip, i) => (
                  <div key={i} className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
                    <div className="aspect-[9/16] bg-black/60">
                      {clip.outputUrl ? (
                        <video src={clip.outputUrl} controls playsInline className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
                          {clipJob?.status === "failed" ? (
                            <>
                              <AlertTriangle className="h-6 w-6 text-red-400" />
                              <span className="text-xs text-red-200">{t("repurpose.clips.cutFailed")}</span>
                            </>
                          ) : (
                            <>
                              <Loader2 className="h-6 w-6 animate-spin text-primary" />
                              <span className="text-xs text-white/50">{t("repurpose.clips.cutting")}</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <div className="truncate text-sm font-bold">{clip.title}</div>
                      <div className="mt-0.5 text-xs text-white/40">
                        {formatRepurposeTimestamp(clip.startSec)}–{formatRepurposeTimestamp(clip.endSec)}
                      </div>
                      {clip.outputUrl && (
                        <>
                          <a
                            href={clip.outputUrl}
                            download
                            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/25"
                          >
                            <Download className="h-3.5 w-3.5" /> {t("repurpose.download")}
                          </a>
                          <Link
                            href={`/caption-styler?video=${encodeURIComponent(clip.outputUrl)}`}
                            className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/70 transition hover:border-white/30 hover:text-white"
                          >
                            <Captions className="h-3.5 w-3.5" /> {t("repurpose.addCaptions", { defaultValue: "Add captions" })}
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {a.moments.some((m) => m.quote) && (
                <div className="mt-4 space-y-1.5">
                  {a.moments.map((m) => (
                    <p key={m.id} className="text-xs text-white/40">
                      <span className="font-semibold text-white/60">{m.title}:</span> {m.reason}
                      {m.quote && <span className="italic"> — “{m.quote}”</span>}
                    </p>
                  ))}
                </div>
              )}
            </section>

            {/* Thumbnails */}
            <section className={cardClass}>
              <SectionHeader
                icon={ImageIcon}
                title={t("repurpose.thumbs.title")}
                blurb={t("repurpose.thumbs.blurb")}
                right={
                  <button
                    onClick={() => rerollText("thumbnailPrompts")}
                    disabled={rerolling === "thumbnailPrompts"}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-white disabled:opacity-40"
                  >
                    {rerolling === "thumbnailPrompts" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {t("repurpose.thumbs.newConcepts", { cost: REROLL_CREDITS })}
                  </button>
                }
              />
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {(thumbJob?.thumbnails ?? a.thumbnailPrompts.map((p) => ({ prompt: p, imageUrl: null as string | null }))).map((thumb, i) => (
                  <div key={i} className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
                    <div className="aspect-[9/16] bg-black/60">
                      {thumb.imageUrl ? (
                        <img src={thumb.imageUrl} alt={t("repurpose.thumbs.alt", { n: i + 1 })} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
                          {thumbJob?.status === "failed" ? (
                            <>
                              <AlertTriangle className="h-6 w-6 text-red-400" />
                              <span className="text-xs text-red-200">{t("repurpose.thumbs.genFailed")}</span>
                            </>
                          ) : (
                            <>
                              <Loader2 className="h-6 w-6 animate-spin text-primary" />
                              <span className="text-xs text-white/50">{t("repurpose.thumbs.painting")}</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="line-clamp-2 text-xs text-white/45" title={thumb.prompt}>{thumb.prompt}</p>
                      <div className="mt-2 flex gap-2">
                        {thumb.imageUrl && (
                          <a
                            href={thumb.imageUrl}
                            download
                            className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/25"
                          >
                            <Download className="h-3.5 w-3.5" /> {t("repurpose.download")}
                          </a>
                        )}
                        <button
                          onClick={() => rerollThumbnail(thumb.prompt, i)}
                          disabled={rerollThumbIdx === i}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-white disabled:opacity-40"
                        >
                          {rerollThumbIdx === i ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                          {t("repurpose.reroll", { cost: REROLL_CREDITS })}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Captions */}
            <section className={cardClass}>
              <SectionHeader
                icon={MessageSquareText}
                title={t("repurpose.captions.title")}
                blurb={t("repurpose.captions.blurb")}
                right={
                  <div className="flex gap-2">
                    <button
                      onClick={() => copyText("all-captions", buildCaptionsExport(a.captions))}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-white"
                    >
                      {copiedKey === "all-captions" ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                      {t("repurpose.copyAll")}
                    </button>
                    <button
                      onClick={() => rerollText("captions")}
                      disabled={rerolling === "captions"}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-white disabled:opacity-40"
                    >
                      {rerolling === "captions" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      {t("repurpose.reroll", { cost: REROLL_CREDITS })}
                    </button>
                  </div>
                }
              />
              <div className="mt-4 space-y-3">
                {a.captions.map((c, i) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-black/40 p-4">
                    <p className="whitespace-pre-line text-sm text-white/85">{c.caption}</p>
                    {c.hashtags.length > 0 && (
                      <p className="mt-2 text-xs text-primary">{c.hashtags.map((tag) => `#${tag}`).join(" ")}</p>
                    )}
                    <button
                      onClick={() => copyText(`caption-${i}`, `${c.caption}\n${c.hashtags.map((tag) => `#${tag}`).join(" ")}`)}
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-white/50 transition hover:text-white"
                    >
                      {copiedKey === `caption-${i}` ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedKey === `caption-${i}` ? t("repurpose.copied") : t("repurpose.copy")}
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* Platform descriptions */}
            <section className={cardClass}>
              <SectionHeader
                icon={Share2}
                title={t("repurpose.platforms.title")}
                blurb={t("repurpose.platforms.blurb")}
                right={
                  <button
                    onClick={() => rerollText("descriptions")}
                    disabled={rerolling === "descriptions"}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-white disabled:opacity-40"
                  >
                    {rerolling === "descriptions" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {t("repurpose.reroll", { cost: REROLL_CREDITS })}
                  </button>
                }
              />
              <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                {(Object.keys(PLATFORM_LABELS) as PlatformKey[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setPlatformTab(k)}
                    className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                      platformTab === k
                        ? "bg-primary text-black"
                        : "border border-white/15 text-white/60 hover:border-primary/50 hover:text-white"
                    }`}
                  >
                    {PLATFORM_LABELS[k]}
                  </button>
                ))}
              </div>
              <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-4">
                <p className="whitespace-pre-line text-sm text-white/85">
                  {a.descriptions[platformTab] || t("repurpose.platforms.noDesc")}
                </p>
                <button
                  onClick={() => copyText(`platform-${platformTab}`, a.descriptions[platformTab] ?? "")}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-white/50 transition hover:text-white"
                >
                  {copiedKey === `platform-${platformTab}` ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedKey === `platform-${platformTab}` ? t("repurpose.copied") : t("repurpose.copy")}
                </button>
              </div>
            </section>
          </div>
        )}
        </>
        )}
      </main>

    </div>
  );
}
