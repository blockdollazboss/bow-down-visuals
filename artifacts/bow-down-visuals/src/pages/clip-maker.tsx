import { useEffect, useRef, useState } from "react";
import {
  Clapperboard, Loader2, Sparkles, Upload, Link2, Scissors,
  Copy, Check, Download, AlertTriangle, Play, Clock, Flame, Captions,
} from "lucide-react";
import { PublishToProfileButton } from "@/components/publish/PublishToProfileButton";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { formatClipTimestamp, buildTimestampExport } from "@/lib/clip-maker";
import { useTranslation } from "react-i18next";
import { useHubProject } from "@/lib/hub-project";
import { HighlightCutter } from "@/components/wave8/HighlightCutter";

/* ─── Thy Cheat Code's AI Streamer Clip Maker ─────────────────────────────
   Upload a stream VOD → Whisper transcribes it → GPT-6 finds the best
   moments → server-side ffmpeg cuts them into vertical 9:16 clips.
   3 credits per AI analysis, 2 credits per rendered clip. Viewing the
   highlight list, selecting highlights, and copying timestamps are free. */

type VibeKey = "funny" | "hype" | "wholesome";

interface Vibe {
  key: VibeKey;
  label: string;
  blurb: string;
  icon: typeof Flame;
}

const CLIP_LENGTHS = [15, 30, 60];
const ANALYZE_COST = 3;
const CUT_COST_PER_CLIP = 2;

interface Highlight {
  id: string;
  startSec: number;
  endSec: number;
  title: string;
  reason: string;
  quote: string;
}

interface AnalyzeResponse {
  videoRef?: string;
  videoUrl?: string;
  durationSec?: number;
  highlights?: Highlight[];
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

interface CutClip {
  title: string;
  startSec: number;
  endSec: number;
  outputUrl: string | null;
  outputRef: string | null;
}

interface CutJobResponse {
  jobId?: string;
  status?: "queued" | "processing" | "done" | "failed";
  clips?: CutClip[];
  error?: string;
  message?: string;
}

function fmt(sec: number): string {
  return formatClipTimestamp(sec);
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

export default function ClipMaker() {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();

  const VIBES: Vibe[] = [
    { key: "funny", label: t("clipMaker.vibeFunnyLabel"), blurb: t("clipMaker.vibeFunnyBlurb"), icon: Sparkles },
    { key: "hype", label: t("clipMaker.vibeHypeLabel"), blurb: t("clipMaker.vibeHypeBlurb"), icon: Flame },
    { key: "wholesome", label: t("clipMaker.vibeWholesomeLabel"), blurb: t("clipMaker.vibeWholesomeBlurb"), icon: Clapperboard },
  ];

  /* source + preferences */
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [clipLength, setClipLength] = useState(30);
  const [maxClips, setMaxClips] = useState(5);
  const [vibe, setVibe] = useState<VibeKey>("hype");

  /* analysis */
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /* cutting */
  const [cutting, setCutting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<CutJobResponse | null>(null);
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
      const data = (await res.json().catch(() => ({}))) as AnalyzeResponse;
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
      const data = (await res.json().catch(() => ({}))) as CutJobResponse;
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
        const data = (await res.json().catch(() => ({}))) as CutJobResponse;
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
                  addAsset({ kind: "clip", url: c.outputUrl, label: c.title || "Clip", detail: `${fmt(c.startSec)}–${fmt(c.endSec)} · ${vibe}` });
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
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-28">
        {/* Hero */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
            <Scissors className="h-3.5 w-3.5" />
            {t("clipMaker.badge")}
          </div>
          <h1 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">
            {t("clipMaker.heroTitleStart")} <span className="text-primary">{t("clipMaker.heroTitleHighlight")}</span>
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-white/55">
            {t("clipMaker.heroSubtitle")}
          </p>
        </div>

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
                          {fmt(h.startSec)}–{fmt(h.endSec)}
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
                      <div className="font-mono text-xs text-white/40">{fmt(c.startSec)}–{fmt(c.endSec)}</div>
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
                              from="/clip-maker"
                              fromLabel="Clip Maker"
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
      </main>

    </div>
  );
}
