/**
 * RepurposeDesk — the My Studio board's native Repurpose desk
 * (stack200 world parity lane B1, census item 4), stacked at
 * the board after the Publish desk: a finished video's next
 * step, in the room where the project lives.
 *
 * The Content Pack mode of pages/repurpose.tsx, native: pick
 * a source (a video from the hub project, an upload, or a
 * project-storage URL), confirm the pack charge, and the
 * /api/repurpose rails build the pack — analysis, moments,
 * captions, platform descriptions, thumbnail prompts — while
 * the clip and thumbnail jobs render in the background and
 * flow into the hub project as they finish, exactly like the
 * page. Re-rolls ride the same rails at the same price.
 *
 * Prices are the route's own (the rails are not in the
 * credit registry): the seam's constants ride
 * useConfirmedApi's override, pinned to the route source by
 * the seam tests. A decline runs nothing; a 402 (or the
 * route's out_of_credits body) lands in the out-of-Bucs
 * state.
 *
 * Stack 300 (items 94/95): the page's other two modes live
 * here too, as the StreamVodMode / SmartClipsMode sections
 * below — Stream VOD over the streamer-clips rails (analyze
 * confirms through the credit registry at 300 VB, exactly
 * like the page; cutting confirms the per-clip total as the
 * override, exactly like the page) and Smart Clips over the
 * video-to-shorts rails (propose is free on a plain authed
 * fetch; rendering confirms the per-clip total as the
 * override). Nothing renders a silent charge anywhere: every
 * charge shows the same CreditConfirm its 2D twin shows.
 *
 * Item 118: when the pack poll gives up on a background job,
 * the desk no longer tells the creator to "refresh" (there
 * is no refresh in the World) — the job ids survive in the
 * lost-jobs state and the error line carries a real
 * "Check again" action that re-reads those exact jobs.
 *
 * Copy rides the page's repurpose.* / clipMaker.* /
 * smartClips.* catalog keys; the desk's few framing strings
 * live in worldRepurposeDesk.*.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Flame,
  Loader2,
  RefreshCw,
  Scissors,
  Upload,
  X,
} from "lucide-react";
import { useHubProject, type HubAsset } from "@/lib/hub-project";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { apiErrorMessage } from "@/lib/api-error";
import { buildTimestampExport } from "@/lib/clip-maker";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";
import {
  REPURPOSE_ANALYZE_PATH,
  REPURPOSE_MAX_VIDEO_BYTES,
  REPURPOSE_PACK_COST_VB,
  REPURPOSE_REROLL_COST_VB,
  REPURPOSE_REROLL_PATH,
  REPURPOSE_REROLL_THUMBNAIL_PATH,
  SMART_CLIP_COUNTS,
  SMART_CLIP_LENGTHS,
  SMART_PROPOSE_PATH,
  SMART_RENDER_COST_PER_CLIP_VB,
  SMART_RENDER_PATH,
  STREAM_ANALYZE_COST_VB,
  STREAM_ANALYZE_PATH,
  STREAM_CLIP_LENGTHS,
  STREAM_CUT_COST_PER_CLIP_VB,
  STREAM_CUT_PATH,
  STREAM_MAX_CLIPS,
  STREAM_VIBES,
  buildRerollBody,
  buildSmartRenderBody,
  buildStreamCutBody,
  formatRepurposeTime,
  isRepurposeJobSettled,
  keptSmartDrafts,
  repurposeJobOf,
  repurposeJobPath,
  repurposePackOf,
  rerollResultOf,
  rerolledThumbnailOf,
  smartClipsOf,
  smartDraftOf,
  smartDraftWindow,
  smartProposalsOf,
  streamAnalysisOf,
  streamCutJobOf,
  streamCutJobPath,
  type RepurposeCaption,
  type RepurposeJob,
  type RepurposeMoment,
  type RepurposePack,
  type RepurposeRerollKind,
  type SmartAnalysisMethod,
  type SmartClip,
  type SmartDraft,
  type StreamAnalysis,
  type StreamCutJob,
  type StreamVibe,
} from "@/lib/world/repurpose-desk";

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  reels: "Instagram Reels",
  shorts: "YouTube Shorts",
  x: "X",
};
const PLATFORM_ORDER = ["tiktok", "reels", "shorts", "x"];
const POLL_MS = 5000;
const MAX_POLL_ATTEMPTS = 72;

type Source =
  | { kind: "file"; file: File }
  | { kind: "url"; url: string }
  | { kind: "asset"; url: string; label: string };

function probeDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        const d = Number.isFinite(v.duration) ? v.duration : 0;
        URL.revokeObjectURL(url);
        resolve(d);
      };
      v.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0);
      };
      v.src = url;
    } catch {
      resolve(0);
    }
  });
}

export function RepurposeDesk({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const authHeaders = useDeskAuthHeaders();
  const { project, addAsset } = useHubProject();

  const [source, setSource] = useState<Source | null>(null);
  const [urlText, setUrlText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [pack, setPack] = useState<RepurposePack | null>(null);
  const [clipJobId, setClipJobId] = useState<string | null>(null);
  const [thumbJobId, setThumbJobId] = useState<string | null>(null);
  const [clipJob, setClipJob] = useState<RepurposeJob | null>(null);
  const [thumbJob, setThumbJob] = useState<RepurposeJob | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfBucs, setOutOfBucs] = useState(false);
  const [rerolling, setRerolling] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [mode, setMode] = useState<"pack" | "stream" | "smart">("pack");
  /* Item 118 — when the poll gives up, the job ids survive here
     so the lost-jobs line can offer a real Check again action
     that re-reads exactly these jobs (never a "refresh"). */
  const [lostJobIds, setLostJobIds] = useState<{ clip: string | null; thumb: string | null } | null>(null);
  const [checkingJobs, setCheckingJobs] = useState(false);
  const flowedRef = useRef<Set<string>>(new Set());
  const attemptsRef = useRef(0);

  const projectVideos: HubAsset[] = (project?.assets ?? []).filter((a) => a.kind === "video");

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const inputCls = isLight
    ? "rounded-xl border border-[#7A5A12]/30 bg-white/70 px-3 py-2 text-sm text-[#2a1e07] placeholder:text-[#6B5B36]/60 outline-none"
    : "rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none";
  const errCls = "text-sm text-red-500";
  const goldBtn =
    "bdv-touch-target inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-4 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-60";
  const ghostBtn = `bdv-touch-target inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-black transition disabled:opacity-60 ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;

  /* One pack-job read, shared by the poll and item 118's
     Check again. A job that can't be read parses to null —
     never a guessed state. */
  const readJob = async (id: string | null): Promise<RepurposeJob | null> => {
    if (!id) return null;
    try {
      const res = await fetch(repurposeJobPath(id), {
        headers: await authHeaders(),
        credentials: "include",
      });
      if (!res.ok) return null;
      return repurposeJobOf(await res.json().catch(() => null));
    } catch {
      return null;
    }
  };

  /* ── Background jobs: poll like the page; finished work
        flows into the hub project once per job. ── */
  const pollOnce = useCallback(async () => {
    attemptsRef.current += 1;
    if (attemptsRef.current > MAX_POLL_ATTEMPTS) {
      /* Item 118: the ids are NOT thrown away — they move to
         lostJobIds so Check again can re-read exactly these
         jobs; the copy names the action, not a refresh. */
      setLostJobIds({ clip: clipJobId, thumb: thumbJobId });
      setJobError(t("repurpose.error.lostJobs"));
      setClipJobId(null);
      setThumbJobId(null);
      return;
    }
    const [cj, tj] = await Promise.all([readJob(clipJobId), readJob(thumbJobId)]);
    if (cj) {
      setClipJob(cj);
      if (cj.status === "done" && clipJobId && !flowedRef.current.has(clipJobId)) {
        flowedRef.current.add(clipJobId);
        for (const clip of cj.clips) {
          addAsset({
            kind: "clip",
            url: clip.outputUrl,
            label: clip.title || t("repurpose.clips.title"),
            detail: `${formatRepurposeTime(clip.startSec)}–${formatRepurposeTime(clip.endSec)}`,
          });
        }
      }
      if (cj.status === "failed") setJobError(t("repurpose.error.clipCuttingFailed"));
      if (isRepurposeJobSettled(cj.status)) setClipJobId(null);
    }
    if (tj) {
      setThumbJob(tj);
      if (tj.status === "done" && thumbJobId && !flowedRef.current.has(thumbJobId)) {
        flowedRef.current.add(thumbJobId);
        for (const thumb of tj.thumbnails) {
          addAsset({ kind: "thumbnail", url: thumb.imageUrl, label: thumb.prompt });
        }
      }
      if (tj.status === "failed") setJobError(t("repurpose.error.thumbFailed"));
      if (isRepurposeJobSettled(tj.status)) setThumbJobId(null);
    }
  }, [clipJobId, thumbJobId, authHeaders, addAsset, t]);

  useEffect(() => {
    if (!clipJobId && !thumbJobId) return;
    const id = window.setInterval(() => {
      void pollOnce();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [clipJobId, thumbJobId, pollOnce]);

  /* ── Item 118 — Check again: one honest re-read of the two
        jobs the poll lost track of. A settled job absorbs
        exactly like the poll absorbs it (assets flow from a
        DONE job, the failure copy lands on a failed one); a
        job still working goes back on the poll with a fresh
        attempt budget; a job that still can't be read stays
        lost, so the action stays offered beside the copy. ── */
  async function checkAgain() {
    if (!lostJobIds || checkingJobs) return;
    setCheckingJobs(true);
    try {
      const [cj, tj] = await Promise.all([readJob(lostJobIds.clip), readJob(lostJobIds.thumb)]);
      let nextClip = lostJobIds.clip;
      let nextThumb = lostJobIds.thumb;
      let failure: string | null = null;
      let resumed = false;
      if (cj) {
        setClipJob(cj);
        if (cj.status === "done") {
          if (lostJobIds.clip && !flowedRef.current.has(lostJobIds.clip)) {
            flowedRef.current.add(lostJobIds.clip);
            for (const clip of cj.clips) {
              addAsset({
                kind: "clip",
                url: clip.outputUrl,
                label: clip.title || t("repurpose.clips.title"),
                detail: `${formatRepurposeTime(clip.startSec)}–${formatRepurposeTime(clip.endSec)}`,
              });
            }
          }
          nextClip = null;
        } else if (cj.status === "failed") {
          failure = t("repurpose.error.clipCuttingFailed");
          nextClip = null;
        } else {
          setClipJobId(lostJobIds.clip);
          nextClip = null;
          resumed = true;
        }
      }
      if (tj) {
        setThumbJob(tj);
        if (tj.status === "done") {
          if (lostJobIds.thumb && !flowedRef.current.has(lostJobIds.thumb)) {
            flowedRef.current.add(lostJobIds.thumb);
            for (const thumb of tj.thumbnails) {
              addAsset({ kind: "thumbnail", url: thumb.imageUrl, label: thumb.prompt });
            }
          }
          nextThumb = null;
        } else if (tj.status === "failed") {
          failure = t("repurpose.error.thumbFailed");
          nextThumb = null;
        } else {
          setThumbJobId(lostJobIds.thumb);
          nextThumb = null;
          resumed = true;
        }
      }
      if (resumed) attemptsRef.current = 0;
      const stillLost = nextClip || nextThumb ? { clip: nextClip, thumb: nextThumb } : null;
      setLostJobIds(stillLost);
      setJobError(failure ?? (stillLost ? t("repurpose.error.lostJobs") : null));
    } finally {
      setCheckingJobs(false);
    }
  }

  async function runAnalyze() {
    if (!source) {
      setError(t("repurpose.error.noSource"));
      return;
    }
    /* The 80 MB cap is the route's multer limit (the seam's
       REPURPOSE_MAX_VIDEO_BYTES documents it; the step-1 blurb
       states it) — an oversize upload fails at the rail and
       lands on the failure copy, like the page. */
    setAnalyzing(true);
    setError(null);
    setOutOfBucs(false);
    setJobError(null);
    setLostJobIds(null);
    setCheckingJobs(false);
    try {
      let res: Response | null;
      if (source.kind === "file") {
        const duration = await probeDuration(source.file);
        const fd = new FormData();
        fd.append("video", source.file);
        if (duration > 0) fd.append("durationSec", String(Math.round(duration)));
        res = await confirmedFetch(REPURPOSE_ANALYZE_PATH, {
          method: "POST",
          body: fd,
          overrideCost: REPURPOSE_PACK_COST_VB,
          overrideFeature: "Repurpose pack",
        });
      } else {
        res = await confirmedFetch(REPURPOSE_ANALYZE_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoUrl: source.url }),
          overrideCost: REPURPOSE_PACK_COST_VB,
          overrideFeature: "Repurpose pack",
        });
      }
      if (res === null) return; // member declined — nothing ran
      const data = (await res.clone().json().catch(() => null)) as Record<string, unknown> | null;
      if (res.status === 402 || data?.["error"] === "out_of_credits") {
        setOutOfBucs(true);
        return;
      }
      const parsed = repurposePackOf(data);
      if (!res.ok || !parsed) {
        setError(t("repurpose.error.repurposeFailed"));
        return;
      }
      flowedRef.current = new Set();
      attemptsRef.current = 0;
      setPack(parsed);
      setClipJob(null);
      setThumbJob(null);
      setClipJobId(parsed.clipJobId);
      setThumbJobId(parsed.thumbnailJobId);
    } catch {
      setError(t("repurpose.error.repurposeFailed"));
    } finally {
      setAnalyzing(false);
    }
  }

  async function reroll(kind: RepurposeRerollKind) {
    if (!pack || rerolling) return;
    setRerolling(kind);
    setError(null);
    setOutOfBucs(false);
    try {
      const res = await confirmedFetch(REPURPOSE_REROLL_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRerollBody(kind, pack.transcript, pack.durationSec)),
        overrideCost: REPURPOSE_REROLL_COST_VB,
        overrideFeature: "Repurpose re-roll",
      });
      if (res === null) return;
      const data = await res.clone().json().catch(() => null);
      if (res.status === 402) {
        setOutOfBucs(true);
        return;
      }
      const result = rerollResultOf(kind, data);
      if (!res.ok || result === null) {
        setError(t("repurpose.error.rerollFailed"));
        return;
      }
      setPack((prev) => {
        if (!prev) return prev;
        const analysis = { ...prev.analysis };
        if (kind === "moments") analysis.moments = result as RepurposeMoment[];
        if (kind === "captions") analysis.captions = result as RepurposeCaption[];
        if (kind === "descriptions") analysis.descriptions = result as Record<string, string>;
        if (kind === "thumbnailPrompts") analysis.thumbnailPrompts = result as string[];
        return { ...prev, analysis };
      });
    } catch {
      setError(t("repurpose.error.rerollFailed"));
    } finally {
      setRerolling(null);
    }
  }

  async function rerollThumb(prompt: string, index: number) {
    const key = `thumb-${index}`;
    if (rerolling) return;
    setRerolling(key);
    setError(null);
    setOutOfBucs(false);
    try {
      const res = await confirmedFetch(REPURPOSE_REROLL_THUMBNAIL_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        overrideCost: REPURPOSE_REROLL_COST_VB,
        overrideFeature: "Repurpose thumbnail re-roll",
      });
      if (res === null) return;
      const data = await res.clone().json().catch(() => null);
      if (res.status === 402) {
        setOutOfBucs(true);
        return;
      }
      const imageUrl = rerolledThumbnailOf(data);
      if (!res.ok || !imageUrl) {
        setError(t("repurpose.error.thumbRerollFailed"));
        return;
      }
      setThumbJob((prev) => {
        const thumbs = [...(prev?.thumbnails ?? [])];
        thumbs[index] = { imageUrl, prompt };
        return { jobId: prev?.jobId ?? null, kind: "thumbnails", status: "done", clips: [], thumbnails: thumbs };
      });
      addAsset({ kind: "thumbnail", url: imageUrl, label: prompt });
    } catch {
      setError(t("repurpose.error.thumbRerollFailed"));
    } finally {
      setRerolling(null);
    }
  }

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1600);
    } catch {
      setError(t("repurpose.error.copyFailed"));
    }
  }

  const copyBtn = (key: string, text: string, label?: string) => (
    <button type="button" className={ghostBtn} onClick={() => void copyText(key, text)}>
      {copiedKey === key ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copiedKey === key ? t("repurpose.copied") : (label ?? t("repurpose.copy"))}
    </button>
  );

  const analysis = pack?.analysis ?? null;
  const clipsRendering = clipJobId !== null && clipJob?.status !== "failed";
  const thumbsRendering = thumbJobId !== null && thumbJob?.status !== "failed";

  return (
    <div className="space-y-4" data-testid="world-repurpose-desk">
      <div>
        <p className={`inline-flex items-center gap-2 text-base font-black ${strong}`}>
          <Scissors className="h-4 w-4 text-[#d4af37]" /> {t("worldRepurposeDesk.title")}
        </p>
        <p className={`text-xs leading-relaxed ${muted}`}>{t("repurpose.hero")}</p>
      </div>

      {/* The page's three modes, all native to the desk (items 94/95). */}
      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label={t("repurpose.modeLabel", { defaultValue: "Repurpose mode" })}
      >
        {(
          [
            { id: "pack", label: t("repurpose.modePack", { defaultValue: "Content Pack" }) },
            { id: "stream", label: t("repurpose.modeStreamVod", { defaultValue: "Stream VOD" }) },
            { id: "smart", label: t("repurpose.modeSmart", { defaultValue: "Smart Clips" }) },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            className={`${ghostBtn} ${mode === m.id ? "border-[#d4af37] text-[#d4af37]" : ""}`}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "stream" ? <StreamVodMode isLight={isLight} /> : null}
      {mode === "smart" ? <SmartClipsMode isLight={isLight} /> : null}

      {mode === "pack" ? (
        <>
      {/* Source — the page's step 1, in the room. */}
      <div className={`space-y-3 rounded-xl border p-3 ${cardCls}`}>
        <p className={`text-xs font-black uppercase tracking-wider ${muted}`}>{t("repurpose.step1.title")}</p>
        {projectVideos.length > 0 ? (
          <div className="space-y-1.5" data-testid="world-repurpose-desk-project">
            <p className={`text-[11px] font-bold ${muted}`}>{t("worldRepurposeDesk.fromProject")}</p>
            {projectVideos.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`${ghostBtn} w-full justify-start ${source?.kind === "asset" && source.url === a.url ? "border-[#d4af37] text-[#d4af37]" : ""}`}
                onClick={() => setSource({ kind: "asset", url: a.url, label: a.label })}
              >
                {a.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <label
            className={`${ghostBtn} cursor-pointer ${source?.kind === "file" ? "border-[#d4af37] text-[#d4af37]" : ""}`}
          >
            <Upload className="h-3.5 w-3.5" /> {t("repurpose.step1.chooseFile")}
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setSource({ kind: "file", file: f });
                e.target.value = "";
              }}
            />
          </label>
          <span className={`text-[11px] ${muted}`}>{t("repurpose.step1.blurb")}</span>
          {source?.kind === "file" ? (
            <span className={`text-[11px] font-bold ${strong}`}>{source.file.name}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="url"
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
            placeholder={t("repurpose.step1.urlPlaceholder")}
            aria-label={t("repurpose.step1.orPasteUrl")}
            className={`${inputCls} min-w-[200px] flex-1`}
          />
          <button
            type="button"
            className={ghostBtn}
            disabled={!urlText.trim()}
            onClick={() => setSource({ kind: "url", url: urlText.trim() })}
          >
            {t("repurpose.step1.orPasteUrl")}
          </button>
        </div>
        <p className={`text-[11px] ${muted}`}>{t("repurpose.step1.urlNote")}</p>
        <button
          type="button"
          data-testid="world-repurpose-desk-run"
          className={`${goldBtn} w-full`}
          disabled={analyzing}
          onClick={() => void runAnalyze()}
        >
          {analyzing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> {t("repurpose.building")}
            </>
          ) : (
            t("repurpose.repurposeButton", { credits: REPURPOSE_PACK_COST_VB })
          )}
        </button>
        <p className={`text-[11px] leading-relaxed ${muted}`}>
          {t("repurpose.costNote", { pack: REPURPOSE_PACK_COST_VB, reroll: REPURPOSE_REROLL_COST_VB })}
        </p>
      </div>

      {outOfBucs ? (
        <p className={errCls} data-testid="world-repurpose-desk-outofbucs">
          {t("worldRepurposeDesk.outOfBucs")}
        </p>
      ) : null}
      {error ? <p className={errCls}>{error}</p> : null}
      {jobError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className={`inline-flex items-start gap-1.5 ${errCls}`}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {jobError}
          </p>
          {lostJobIds ? (
            <button
              type="button"
              className={ghostBtn}
              disabled={checkingJobs}
              data-testid="world-repurpose-desk-check-again"
              onClick={() => void checkAgain()}
            >
              {checkingJobs ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {checkingJobs ? t("worldRepurposeDesk.checkingJobs") : t("worldRepurposeDesk.checkAgain")}
            </button>
          ) : null}
        </div>
      ) : null}

      {analysis ? (
        <div className="space-y-4" data-testid="world-repurpose-desk-results">
          <div>
            <p className={`text-sm font-black ${strong}`}>{analysis.videoTitle}</p>
            <p className={`text-xs leading-relaxed ${muted}`}>{analysis.summary}</p>
            {clipJobId || thumbJobId ? (
              <p className={`mt-1 inline-flex items-center gap-1.5 text-[11px] ${muted}`}>
                <Loader2 className="h-3 w-3 animate-spin" /> {t("repurpose.renderingNote")}
              </p>
            ) : null}
          </div>

          {/* Clips + the moments they were cut from. */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className={`text-sm font-black ${strong}`}>{t("repurpose.clips.title")}</p>
              <button
                type="button"
                className={ghostBtn}
                disabled={rerolling !== null}
                onClick={() => void reroll("moments")}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${rerolling === "moments" ? "animate-spin" : ""}`} />
                {t("repurpose.clips.newMoments", { cost: REPURPOSE_REROLL_COST_VB })}
              </button>
            </div>
            <p className={`text-[11px] ${muted}`}>{t("repurpose.clips.blurb")}</p>
            {clipJob?.status === "failed" ? (
              <p className={errCls}>{t("repurpose.clips.cutFailed")}</p>
            ) : clipsRendering && (clipJob?.clips.length ?? 0) === 0 ? (
              <p className={`inline-flex items-center gap-1.5 text-xs ${muted}`}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("repurpose.clips.cutting")}
              </p>
            ) : (
              <div className="space-y-2">
                {(clipJob?.clips ?? []).map((clip, i) => (
                  <article key={`${clip.outputUrl}-${i}`} className={`rounded-xl border p-3 ${cardCls}`}>
                    <p className={`text-xs font-black ${strong}`}>{clip.title}</p>
                    <p className={`text-[11px] ${muted}`}>
                      {formatRepurposeTime(clip.startSec)}–{formatRepurposeTime(clip.endSec)}
                    </p>
                    <video src={clip.outputUrl} controls className="mt-2 w-full rounded-lg" preload="metadata" />
                    <a
                      href={clip.outputUrl}
                      download
                      className={`${ghostBtn} mt-2`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Download className="h-3.5 w-3.5" /> {t("repurpose.download")}
                    </a>
                  </article>
                ))}
              </div>
            )}
            {analysis.moments.length > 0 ? (
              <ul className="space-y-1.5">
                {analysis.moments.map((m) => (
                  <li key={m.id} className={`rounded-lg border px-3 py-2 ${cardCls}`}>
                    <p className={`text-xs font-bold ${strong}`}>
                      {formatRepurposeTime(m.startSec)}–{formatRepurposeTime(m.endSec)} · {m.title}
                    </p>
                    {m.reason ? <p className={`text-[11px] ${muted}`}>{m.reason}</p> : null}
                    {m.quote ? <p className={`text-[11px] italic ${muted}`}>“{m.quote}”</p> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* Thumbnails. */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className={`text-sm font-black ${strong}`}>{t("repurpose.thumbs.title")}</p>
              <button
                type="button"
                className={ghostBtn}
                disabled={rerolling !== null}
                onClick={() => void reroll("thumbnailPrompts")}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${rerolling === "thumbnailPrompts" ? "animate-spin" : ""}`} />
                {t("repurpose.thumbs.newConcepts", { cost: REPURPOSE_REROLL_COST_VB })}
              </button>
            </div>
            <p className={`text-[11px] ${muted}`}>{t("repurpose.thumbs.blurb")}</p>
            {thumbJob?.status === "failed" ? (
              <p className={errCls}>{t("repurpose.thumbs.genFailed")}</p>
            ) : thumbsRendering && (thumbJob?.thumbnails.length ?? 0) === 0 ? (
              <p className={`inline-flex items-center gap-1.5 text-xs ${muted}`}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("repurpose.thumbs.painting")}
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {(thumbJob?.thumbnails ?? []).map((thumb, i) => (
                  <figure key={`${thumb.imageUrl}-${i}`} className="space-y-1">
                    <img
                      src={thumb.imageUrl}
                      alt={t("repurpose.thumbs.alt", { n: i + 1 })}
                      className="aspect-[9/16] w-full rounded-lg object-cover"
                      loading="lazy"
                    />
                    <button
                      type="button"
                      className={`${ghostBtn} w-full justify-center`}
                      disabled={rerolling !== null}
                      onClick={() => void rerollThumb(thumb.prompt, i)}
                    >
                      <RefreshCw className={`h-3 w-3 ${rerolling === `thumb-${i}` ? "animate-spin" : ""}`} />
                      {t("repurpose.reroll", { cost: REPURPOSE_REROLL_COST_VB })}
                    </button>
                  </figure>
                ))}
              </div>
            )}
            {analysis.thumbnailPrompts.length > 0 ? (
              <ul className={`list-disc space-y-0.5 pl-4 text-[11px] ${muted}`}>
                {analysis.thumbnailPrompts.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* Captions. */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className={`text-sm font-black ${strong}`}>{t("repurpose.captions.title")}</p>
              <button
                type="button"
                className={ghostBtn}
                disabled={rerolling !== null}
                onClick={() => void reroll("captions")}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${rerolling === "captions" ? "animate-spin" : ""}`} />
                {t("repurpose.reroll", { cost: REPURPOSE_REROLL_COST_VB })}
              </button>
            </div>
            <p className={`text-[11px] ${muted}`}>{t("repurpose.captions.blurb")}</p>
            {analysis.captions.map((c, i) => {
              const full = `${c.caption}\n\n${c.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}`;
              return (
                <article key={i} className={`rounded-xl border p-3 ${cardCls}`}>
                  <p className={`whitespace-pre-wrap text-xs leading-relaxed ${strong}`}>{full}</p>
                  <div className="mt-2">{copyBtn(`cap-${i}`, full)}</div>
                </article>
              );
            })}
          </section>

          {/* Platform descriptions. */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className={`text-sm font-black ${strong}`}>{t("repurpose.platforms.title")}</p>
              <button
                type="button"
                className={ghostBtn}
                disabled={rerolling !== null}
                onClick={() => void reroll("descriptions")}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${rerolling === "descriptions" ? "animate-spin" : ""}`} />
                {t("repurpose.reroll", { cost: REPURPOSE_REROLL_COST_VB })}
              </button>
            </div>
            <p className={`text-[11px] ${muted}`}>{t("repurpose.platforms.blurb")}</p>
            {PLATFORM_ORDER.map((key) => {
              const desc = analysis.descriptions[key];
              return (
                <article key={key} className={`rounded-xl border p-3 ${cardCls}`}>
                  <p className={`text-xs font-black ${strong}`}>{PLATFORM_LABELS[key]}</p>
                  {desc ? (
                    <>
                      <p className={`mt-1 whitespace-pre-wrap text-xs leading-relaxed ${muted}`}>{desc}</p>
                      <div className="mt-2">{copyBtn(`desc-${key}`, desc)}</div>
                    </>
                  ) : (
                    <p className={`mt-1 text-xs ${muted}`}>{t("repurpose.platforms.noDesc")}</p>
                  )}
                </article>
              );
            })}
          </section>
        </div>
      ) : null}
        </>
      ) : null}
    </div>
  );
}

const STREAM_VIBE_LABEL_KEYS: Record<StreamVibe, string> = {
  funny: "clipMaker.vibeFunnyLabel",
  hype: "clipMaker.vibeHypeLabel",
  wholesome: "clipMaker.vibeWholesomeLabel",
};

/* ════════════════════════════════════════════════════════════
   Item 94 — Stream VOD mode: the page's StreamVodClips, native.
   Analyze confirms through the credit registry at 300 VB —
   the SAME confirm the page shows, no override; cutting
   confirms the per-clip total as the override, exactly like
   the page (the registry's flat cut price is per call, the
   rail charges per clip). Finished clips flow into the hub
   project off the DONE job only.
   ════════════════════════════════════════════════════════════ */
function StreamVodMode({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const authHeaders = useDeskAuthHeaders();
  const { addAsset } = useHubProject();

  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [clipLength, setClipLength] = useState<number>(30);
  const [maxClips, setMaxClips] = useState(5);
  const [vibe, setVibe] = useState<StreamVibe>("hype");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<StreamAnalysis | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [cutting, setCutting] = useState(false);
  const [cutJobId, setCutJobId] = useState<string | null>(null);
  const [cutJob, setCutJob] = useState<StreamCutJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfBucs, setOutOfBucs] = useState(false);
  const [copied, setCopied] = useState(false);
  const flowedRef = useRef(false);
  const attemptsRef = useRef(0);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const inputCls = isLight
    ? "rounded-xl border border-[#7A5A12]/30 bg-white/70 px-3 py-2 text-sm text-[#2a1e07] placeholder:text-[#6B5B36]/60 outline-none"
    : "rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none";
  const errCls = "text-sm text-red-500";
  const goldBtn =
    "bdv-touch-target inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-4 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-60";
  const ghostBtn = `bdv-touch-target inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-black transition disabled:opacity-60 ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;

  /* Poll the background cut job — the pack poll's discipline:
     the page's 5-second cadence and the same attempt budget;
     a job that can't be read yet is not a failure. */
  useEffect(() => {
    if (!cutJobId) return;
    const tick = async () => {
      attemptsRef.current += 1;
      if (attemptsRef.current > MAX_POLL_ATTEMPTS) {
        setError(t("clipMaker.errorJobLost"));
        setCutting(false);
        setCutJobId(null);
        return;
      }
      try {
        const res = await fetch(streamCutJobPath(cutJobId), {
          headers: await authHeaders(),
          credentials: "include",
        });
        if (!res.ok) return;
        const job = streamCutJobOf(await res.json().catch(() => null));
        setCutJob(job);
        if (job.status === "done") {
          if (!flowedRef.current) {
            flowedRef.current = true;
            for (const clip of job.clips) {
              if (!clip.outputUrl) continue;
              addAsset({
                kind: "clip",
                url: clip.outputUrl,
                label: clip.title || t("repurpose.clips.title"),
                detail: `${formatRepurposeTime(clip.startSec)}–${formatRepurposeTime(clip.endSec)}`,
              });
            }
          }
          setCutting(false);
          setCutJobId(null);
        } else if (job.status === "failed") {
          setError(job.error ?? t("clipMaker.errorCutRefunded"));
          setCutting(false);
          setCutJobId(null);
        }
      } catch {
        /* Transient — the next tick retries, like the pack poll. */
      }
    };
    const id = window.setInterval(() => {
      void tick();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [cutJobId, authHeaders, addAsset, t]);

  async function analyze() {
    if (analyzing) return;
    if (!file && !videoUrl.trim()) {
      setError(t("clipMaker.errorNoSource"));
      return;
    }
    setError(null);
    setOutOfBucs(false);
    setAnalyzing(true);
    try {
      let res: Response | null;
      if (file) {
        const fd = new FormData();
        fd.append("video", file);
        fd.append("clipLength", String(clipLength));
        fd.append("maxClips", String(maxClips));
        fd.append("vibe", vibe);
        res = await confirmedFetch(STREAM_ANALYZE_PATH, { method: "POST", body: fd });
      } else {
        res = await confirmedFetch(STREAM_ANALYZE_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoUrl: videoUrl.trim(), clipLength, maxClips, vibe }),
        });
      }
      if (res === null) return; // member declined — nothing ran
      const data = (await res.clone().json().catch(() => null)) as Record<string, unknown> | null;
      if (res.status === 402 || data?.["error"] === "out_of_credits") {
        setOutOfBucs(true);
        return;
      }
      const parsed = res.ok ? streamAnalysisOf(data) : null;
      if (!parsed) {
        setError(t("clipMaker.errorAnalysisFailed"));
        return;
      }
      setAnalysis(parsed);
      setSelected(new Set(parsed.highlights.map((h) => h.id)));
      setCutJob(null);
      setCutJobId(null);
      setCutting(false);
      flowedRef.current = false;
      attemptsRef.current = 0;
    } catch {
      setError(t("clipMaker.errorAnalysisFailed"));
    } finally {
      setAnalyzing(false);
    }
  }

  async function cutClips() {
    if (!analysis || cutting) return;
    const picks = analysis.highlights.filter((h) => selected.has(h.id));
    if (picks.length === 0) {
      setError(t("clipMaker.errorNoSelection"));
      return;
    }
    setError(null);
    setOutOfBucs(false);
    setCutting(true);
    try {
      const res = await confirmedFetch(STREAM_CUT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildStreamCutBody(analysis.videoRef, picks)),
        overrideCost: picks.length * STREAM_CUT_COST_PER_CLIP_VB,
        overrideFeature: t("clipMaker.cutFeatureName"),
      });
      if (res === null) {
        setCutting(false);
        return; // member declined — nothing ran
      }
      const data = (await res.clone().json().catch(() => null)) as Record<string, unknown> | null;
      if (res.status === 402 || data?.["error"] === "out_of_credits") {
        setOutOfBucs(true);
        setCutting(false);
        return;
      }
      const jobId = res.ok && typeof data?.["jobId"] === "string" ? data["jobId"] : null;
      if (!jobId) {
        setError(t("clipMaker.errorCutStartFailed"));
        setCutting(false);
        return;
      }
      flowedRef.current = false;
      attemptsRef.current = 0;
      setCutJob(null);
      setCutJobId(jobId);
    } catch {
      setError(t("clipMaker.errorCutFailed"));
      setCutting(false);
    }
  }

  function togglePick(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function copyTimestamps() {
    if (!analysis) return;
    const picks = analysis.highlights.filter((h) => selected.has(h.id));
    try {
      await navigator.clipboard.writeText(buildTimestampExport(picks));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t("clipMaker.errorCopyFailed"));
    }
  }

  const picks = analysis ? analysis.highlights.filter((h) => selected.has(h.id)) : [];
  const doneClips = (cutJob?.status === "done" ? cutJob.clips : []).filter((c) => c.outputUrl);

  return (
    <div className="space-y-4" data-testid="world-repurpose-desk-stream">
      {/* Source + preferences — the page's step 1, in the room. */}
      <div className={`space-y-3 rounded-xl border p-3 ${cardCls}`}>
        <p className={`text-xs font-black uppercase tracking-wider ${muted}`}>{t("clipMaker.step1Title")}</p>
        <p className={`text-[11px] leading-relaxed ${muted}`}>{t("clipMaker.heroSubtitle")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${ghostBtn} cursor-pointer ${file ? "border-[#d4af37] text-[#d4af37]" : ""}`}>
            <Upload className="h-3.5 w-3.5" /> {t("clipMaker.chooseFile")}
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setFile(f);
                  setVideoUrl("");
                }
                e.target.value = "";
              }}
            />
          </label>
          <span className={`text-[11px] ${muted}`}>{t("clipMaker.fileHint")}</span>
          {file ? (
            <>
              <span className={`text-[11px] font-bold ${strong}`}>{file.name}</span>
              <button type="button" className={ghostBtn} onClick={() => setFile(null)}>
                <X className="h-3.5 w-3.5" /> {t("clipMaker.clear")}
              </button>
            </>
          ) : null}
        </div>
        <input
          type="url"
          value={videoUrl}
          onChange={(e) => {
            setVideoUrl(e.target.value);
            setFile(null);
          }}
          placeholder={t("clipMaker.urlPlaceholder")}
          aria-label={t("clipMaker.orPasteUrl")}
          className={`${inputCls} w-full`}
        />
        <p className={`text-[11px] ${muted}`}>{t("clipMaker.urlHint")}</p>

        <div className="flex flex-wrap gap-4">
          <div className="space-y-1.5">
            <p className={`text-[11px] font-bold ${muted}`}>{t("clipMaker.clipLength")}</p>
            <div className="flex gap-1.5">
              {STREAM_CLIP_LENGTHS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`${ghostBtn} ${clipLength === n ? "border-[#d4af37] text-[#d4af37]" : ""}`}
                  onClick={() => setClipLength(n)}
                >
                  {t("clipMaker.secondsLabel", { n })}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <p className={`text-[11px] font-bold ${muted}`}>
              {t("clipMaker.maxClips")}: {maxClips}
            </p>
            <input
              type="range"
              min={1}
              max={STREAM_MAX_CLIPS}
              value={maxClips}
              onChange={(e) => setMaxClips(Number(e.target.value))}
              className="w-36 accent-[#d4af37]"
              aria-label={t("clipMaker.maxClips")}
            />
          </div>
          <div className="space-y-1.5">
            <p className={`text-[11px] font-bold ${muted}`}>{t("clipMaker.vibe")}</p>
            <div className="flex gap-1.5">
              {STREAM_VIBES.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`${ghostBtn} ${vibe === v ? "border-[#d4af37] text-[#d4af37]" : ""}`}
                  onClick={() => setVibe(v)}
                >
                  {t(STREAM_VIBE_LABEL_KEYS[v])}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          data-testid="world-repurpose-desk-stream-run"
          className={`${goldBtn} w-full`}
          disabled={analyzing}
          onClick={() => void analyze()}
        >
          {analyzing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> {t("clipMaker.analyzing")}
            </>
          ) : (
            t("clipMaker.findHighlights", { cost: STREAM_ANALYZE_COST_VB })
          )}
        </button>
        <p className={`text-[11px] leading-relaxed ${muted}`}>{t("clipMaker.analyzeNote", { vibe })}</p>
      </div>

      {outOfBucs ? (
        <p className={errCls} data-testid="world-repurpose-desk-stream-outofbucs">
          {t("worldRepurposeDesk.streamOutOfBucs")}
        </p>
      ) : null}
      {error ? <p className={errCls}>{error}</p> : null}

      {analysis ? (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`text-sm font-black ${strong}`}>
              {t("clipMaker.highlightsFound", { count: analysis.highlights.length })}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className={ghostBtn}
                onClick={() => setSelected(new Set(analysis.highlights.map((h) => h.id)))}
              >
                {t("clipMaker.selectAll")}
              </button>
              <button type="button" className={ghostBtn} onClick={() => void copyTimestamps()}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t("clipMaker.copied") : t("clipMaker.copyTimestamps")}
              </button>
            </div>
          </div>
          <p className={`text-[11px] ${muted}`}>{t("clipMaker.selectToCut")}</p>
          <ul className="space-y-1.5">
            {analysis.highlights.map((h) => {
              const on = selected.has(h.id);
              return (
                <li key={h.id} className={`rounded-lg border px-3 py-2 ${cardCls}`}>
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={h.title}
                      onClick={() => togglePick(h.id)}
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                        on
                          ? "border-[#d4af37] bg-[#d4af37] text-black"
                          : isLight
                            ? "border-[#7A5A12]/40 text-transparent"
                            : "border-white/25 text-transparent"
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <div className="min-w-0">
                      <p className={`text-xs font-bold ${strong}`}>
                        {formatRepurposeTime(h.startSec)}–{formatRepurposeTime(h.endSec)} · {h.title}
                      </p>
                      {h.reason ? <p className={`text-[11px] ${muted}`}>{h.reason}</p> : null}
                      {h.quote ? <p className={`text-[11px] italic ${muted}`}>“{h.quote}”</p> : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            data-testid="world-repurpose-desk-stream-cut"
            className={`${goldBtn} w-full`}
            disabled={cutting || picks.length === 0}
            onClick={() => void cutClips()}
          >
            {cutting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {t("clipMaker.cutting")}
              </>
            ) : (
              t("clipMaker.cutClips", { count: picks.length, cost: picks.length * STREAM_CUT_COST_PER_CLIP_VB })
            )}
          </button>
          <p className={`text-[11px] leading-relaxed ${muted}`}>{t("clipMaker.cutNote")}</p>
          {cutJobId ? (
            <p className={`inline-flex items-center gap-1.5 text-[11px] ${muted}`}>
              <Loader2 className="h-3 w-3 animate-spin" /> {t("clipMaker.cuttingBackground")}
            </p>
          ) : null}
        </section>
      ) : null}

      {doneClips.length > 0 ? (
        <section className="space-y-2">
          <p className={`text-sm font-black ${strong}`}>{t("clipMaker.step3Title")}</p>
          <div className="space-y-2">
            {doneClips.map((clip, i) => (
              <article key={`${clip.outputUrl}-${i}`} className={`rounded-xl border p-3 ${cardCls}`}>
                <p className={`text-xs font-black ${strong}`}>{clip.title}</p>
                <p className={`text-[11px] ${muted}`}>
                  {formatRepurposeTime(clip.startSec)}–{formatRepurposeTime(clip.endSec)}
                </p>
                <video src={clip.outputUrl ?? undefined} controls className="mt-2 w-full rounded-lg" preload="metadata" />
                <a
                  href={clip.outputUrl ?? undefined}
                  download
                  className={`${ghostBtn} mt-2`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download className="h-3.5 w-3.5" /> {t("clipMaker.downloadClip")}
                </a>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Item 95 — Smart Clips mode: the page's SmartClipFinder,
   native. Proposing is FREE and rides a plain authed fetch,
   exactly like the page; rendering confirms the per-clip
   total as the override, exactly like the page. Only moments
   the creator kept — with windows that still parse inside
   the rail's 5–120s — are ever sent to render.
   ════════════════════════════════════════════════════════════ */
function SmartClipsMode({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const authHeaders = useDeskAuthHeaders();
  const { addAsset } = useHubProject();

  const [videoUrl, setVideoUrl] = useState("");
  const [query, setQuery] = useState("");
  const [count, setCount] = useState<number>(3);
  const [durationSec, setDurationSec] = useState<number>(45);
  const [finding, setFinding] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [drafts, setDrafts] = useState<SmartDraft[] | null>(null);
  const [proposeMethod, setProposeMethod] = useState<SmartAnalysisMethod | null>(null);
  const [resultClips, setResultClips] = useState<SmartClip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfBucs, setOutOfBucs] = useState(false);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const inputCls = isLight
    ? "rounded-xl border border-[#7A5A12]/30 bg-white/70 px-3 py-2 text-sm text-[#2a1e07] placeholder:text-[#6B5B36]/60 outline-none"
    : "rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none";
  const errCls = "text-sm text-red-500";
  const goldBtn =
    "bdv-touch-target inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-4 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-60";
  const ghostBtn = `bdv-touch-target inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-black transition disabled:opacity-60 ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;

  async function findMoments() {
    if (finding) return;
    const url = videoUrl.trim();
    if (!url) {
      setError(t("smartClips.errorNoUrl"));
      return;
    }
    setError(null);
    setOutOfBucs(false);
    setFinding(true);
    try {
      /* Propose is FREE — a plain authed fetch, exactly like the page. */
      const res = await fetch(SMART_PROPOSE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        credentials: "include",
        body: JSON.stringify({
          videoUrl: url,
          count,
          durationSec,
          ...(query.trim() ? { query: query.trim() } : {}),
        }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(apiErrorMessage(data, t("smartClips.errorFailed")));
        return;
      }
      const parsed = smartProposalsOf(data);
      if (!parsed) {
        setError(t("smartClips.errorFailed"));
        return;
      }
      setProposeMethod(parsed.analysisMethod);
      setDrafts(parsed.proposals.map(smartDraftOf));
      setResultClips(null);
    } catch {
      setError(t("smartClips.errorFailed"));
    } finally {
      setFinding(false);
    }
  }

  function updateDraft(index: number, patch: Partial<SmartDraft>) {
    setDrafts((prev) => (prev ? prev.map((d, i) => (i === index ? { ...d, ...patch } : d)) : prev));
  }

  async function renderApproved() {
    if (!drafts || rendering) return;
    const kept = keptSmartDrafts(drafts);
    if (kept.length === 0) return;
    setError(null);
    setOutOfBucs(false);
    setRendering(true);
    try {
      const res = await confirmedFetch(SMART_RENDER_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSmartRenderBody(videoUrl.trim(), kept)),
        overrideCost: kept.length * SMART_RENDER_COST_PER_CLIP_VB,
        overrideFeature: t("smartClips.featureName"),
      });
      if (res === null) return; // member declined — nothing ran
      const data = await res.clone().json().catch(() => null);
      if (res.status === 402 || (data as Record<string, unknown> | null)?.["error"] === "out_of_credits") {
        setOutOfBucs(true);
        return;
      }
      const clips = res.ok ? smartClipsOf(data) : [];
      if (clips.length === 0) {
        setError(apiErrorMessage(data, t("smartClips.errorFailed")));
        return;
      }
      setResultClips(clips);
      for (const clip of clips) {
        addAsset({
          kind: "clip",
          url: clip.url,
          label: clip.title || t("smartClips.featureName"),
          detail: `${formatRepurposeTime(clip.startTime)}–${formatRepurposeTime(clip.endTime)}`,
        });
      }
    } catch {
      setError(t("smartClips.errorFailed"));
    } finally {
      setRendering(false);
    }
  }

  const kept = drafts ? keptSmartDrafts(drafts) : [];

  return (
    <div className="space-y-4" data-testid="world-repurpose-desk-smart">
      {/* Find — the page's form, in the room. */}
      <div className={`space-y-3 rounded-xl border p-3 ${cardCls}`}>
        <p className={`text-xs font-black uppercase tracking-wider ${muted}`}>{t("smartClips.title")}</p>
        <p className={`text-[11px] leading-relaxed ${muted}`}>{t("smartClips.blurb")}</p>
        <div className="space-y-1.5">
          <label className={`text-[11px] font-bold ${muted}`} htmlFor="world-repurpose-smart-url">
            {t("smartClips.urlLabel")}
          </label>
          <input
            id="world-repurpose-smart-url"
            type="url"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder={t("smartClips.urlPlaceholder")}
            className={`${inputCls} w-full`}
          />
          <p className={`text-[11px] ${muted}`}>{t("smartClips.urlHint")}</p>
        </div>
        <div className="space-y-1.5">
          <label className={`text-[11px] font-bold ${muted}`} htmlFor="world-repurpose-smart-query">
            {t("smartClips.searchLabel")}
          </label>
          <input
            id="world-repurpose-smart-query"
            type="text"
            value={query}
            maxLength={300}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("smartClips.searchPlaceholder")}
            className={`${inputCls} w-full`}
          />
          <p className={`text-[11px] ${muted}`}>{t("smartClips.searchHint")}</p>
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="space-y-1.5">
            <p className={`text-[11px] font-bold ${muted}`}>{t("smartClips.countLabel")}</p>
            <div className="flex gap-1.5">
              {SMART_CLIP_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`${ghostBtn} ${count === n ? "border-[#d4af37] text-[#d4af37]" : ""}`}
                  onClick={() => setCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <p className={`text-[11px] font-bold ${muted}`}>{t("smartClips.lengthLabel")}</p>
            <div className="flex gap-1.5">
              {SMART_CLIP_LENGTHS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`${ghostBtn} ${durationSec === n ? "border-[#d4af37] text-[#d4af37]" : ""}`}
                  onClick={() => setDurationSec(n)}
                >
                  {t("smartClips.secondsLabel", { n })}
                </button>
              ))}
            </div>
          </div>
        </div>
        <button
          type="button"
          data-testid="world-repurpose-desk-smart-find"
          className={`${goldBtn} w-full`}
          disabled={finding}
          onClick={() => void findMoments()}
        >
          {finding ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> {t("smartClips.finding")}
            </>
          ) : (
            t("smartClips.findButton")
          )}
        </button>
        <p className={`text-[11px] leading-relaxed ${muted}`}>{t("smartClips.findNote")}</p>
      </div>

      {outOfBucs ? (
        <p className={errCls} data-testid="world-repurpose-desk-smart-outofbucs">
          {t("worldRepurposeDesk.smartOutOfBucs")}
        </p>
      ) : null}
      {error ? <p className={errCls}>{error}</p> : null}

      {drafts !== null ? (
        drafts.length === 0 ? (
          <p className={errCls}>{t("smartClips.errorNoProposals")}</p>
        ) : (
          <section className="space-y-2">
            <p className={`text-sm font-black ${strong}`}>{t("smartClips.proposalsTitle")}</p>
            <p className={`text-[11px] ${muted}`}>
              {proposeMethod === "semantic"
                ? t("smartClips.methodSemantic")
                : proposeMethod === "mixed"
                  ? t("smartClips.methodMixed")
                  : t("smartClips.methodEnergy")}
            </p>
            <p className={`text-[11px] ${muted}`}>{t("smartClips.proposalsHint")}</p>
            {drafts.map((draft, i) => {
              const invalid = draft.keep && smartDraftWindow(draft) === null;
              return (
                <article key={i} className={`rounded-xl border p-3 ${cardCls} ${invalid ? "!border-red-400" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={`text-xs font-black ${strong}`}>{draft.title}</p>
                    {draft.method === "semantic" && draft.score !== null ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-[#d4af37]/15 px-1.5 py-0.5 text-[10px] font-black text-[#d4af37]">
                        <Flame className="h-3 w-3" /> {draft.score}
                      </span>
                    ) : null}
                    {draft.method === "energy" ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-black">
                        {t("smartClips.energyPick")}
                      </span>
                    ) : null}
                  </div>
                  {draft.reason ? <p className={`mt-1 text-[11px] ${muted}`}>{draft.reason}</p> : null}
                  {draft.quote ? (
                    <p className={`mt-1 text-[11px] italic ${muted}`}>
                      {t("smartClips.quoteLabel")}: “{draft.quote}”
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="space-y-1">
                      <span className={`text-[10px] font-bold ${muted}`}>{t("smartClips.startLabel")}</span>
                      <input
                        value={draft.startText}
                        onChange={(e) => updateDraft(i, { startText: e.target.value })}
                        className={`${inputCls} w-20`}
                        inputMode="numeric"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className={`text-[10px] font-bold ${muted}`}>{t("smartClips.endLabel")}</span>
                      <input
                        value={draft.endText}
                        onChange={(e) => updateDraft(i, { endText: e.target.value })}
                        className={`${inputCls} w-20`}
                        inputMode="numeric"
                      />
                    </label>
                    <button
                      type="button"
                      aria-pressed={draft.keep}
                      className={`${ghostBtn} ${draft.keep ? "border-[#d4af37] text-[#d4af37]" : ""}`}
                      onClick={() => updateDraft(i, { keep: !draft.keep })}
                    >
                      {draft.keep ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                      {t("smartClips.keepLabel")}
                    </button>
                  </div>
                  {invalid ? <p className={`mt-1.5 ${errCls}`}>{t("smartClips.invalidTime")}</p> : null}
                </article>
              );
            })}
            <button
              type="button"
              data-testid="world-repurpose-desk-smart-render"
              className={`${goldBtn} w-full`}
              disabled={rendering || kept.length === 0}
              onClick={() => void renderApproved()}
            >
              {rendering ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("smartClips.rendering")}
                </>
              ) : (
                t("smartClips.renderButton", { n: kept.length })
              )}
            </button>
            <p className={`text-[11px] leading-relaxed ${muted}`}>
              {t("smartClips.renderCostNote", {
                per: SMART_RENDER_COST_PER_CLIP_VB,
                total: kept.length * SMART_RENDER_COST_PER_CLIP_VB,
              })}
            </p>
          </section>
        )
      ) : null}

      {resultClips && resultClips.length > 0 ? (
        <section className="space-y-2">
          <p className={`text-sm font-black ${strong}`}>{t("smartClips.resultsTitle")}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {resultClips.map((clip, i) => (
              <article key={`${clip.url}-${i}`} className={`rounded-xl border p-3 ${cardCls}`}>
                <video
                  src={clip.url}
                  controls
                  className="aspect-[9/16] w-full rounded-lg bg-black object-cover"
                  preload="metadata"
                />
                <p className={`mt-2 text-xs font-black ${strong}`}>{clip.title}</p>
                <p className={`text-[11px] ${muted}`}>
                  {formatRepurposeTime(clip.startTime)}–{formatRepurposeTime(clip.endTime)}
                </p>
                {clip.method === "semantic" && clip.score !== null ? (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-[#d4af37]/15 px-1.5 py-0.5 text-[10px] font-black text-[#d4af37]">
                    <Flame className="h-3 w-3" /> {clip.score}
                  </span>
                ) : null}
                {clip.method === "energy" ? (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-black">
                    {t("smartClips.energyPick")}
                  </span>
                ) : null}
                {clip.reason ? <p className={`mt-1 text-[11px] ${muted}`}>{clip.reason}</p> : null}
                {clip.quote ? (
                  <p className={`mt-1 text-[11px] italic ${muted}`}>
                    {t("smartClips.quoteLabel")}: “{clip.quote}”
                  </p>
                ) : null}
                <a href={clip.url} download className={`${ghostBtn} mt-2`} target="_blank" rel="noreferrer">
                  <Download className="h-3.5 w-3.5" /> {t("smartClips.download")}
                </a>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
