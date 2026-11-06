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
 * state. The page's Stream VOD and Smart Clips modes ride
 * different rail families and are not part of this desk.
 *
 * Copy rides the page's repurpose.* catalog keys; the desk's
 * few framing strings live in worldRepurposeDesk.*.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  Scissors,
  Upload,
} from "lucide-react";
import { useHubProject, type HubAsset } from "@/lib/hub-project";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";
import {
  REPURPOSE_ANALYZE_PATH,
  REPURPOSE_MAX_VIDEO_BYTES,
  REPURPOSE_PACK_COST_VB,
  REPURPOSE_REROLL_COST_VB,
  REPURPOSE_REROLL_PATH,
  REPURPOSE_REROLL_THUMBNAIL_PATH,
  buildRerollBody,
  formatRepurposeTime,
  isRepurposeJobSettled,
  repurposeJobOf,
  repurposeJobPath,
  repurposePackOf,
  rerollResultOf,
  rerolledThumbnailOf,
  type RepurposeCaption,
  type RepurposeJob,
  type RepurposeMoment,
  type RepurposePack,
  type RepurposeRerollKind,
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

  /* ── Background jobs: poll like the page; finished work
        flows into the hub project once per job. ── */
  const pollOnce = useCallback(async () => {
    attemptsRef.current += 1;
    if (attemptsRef.current > MAX_POLL_ATTEMPTS) {
      setJobError(t("repurpose.error.lostJobs"));
      setClipJobId(null);
      setThumbJobId(null);
      return;
    }
    const read = async (id: string | null): Promise<RepurposeJob | null> => {
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
    const [cj, tj] = await Promise.all([read(clipJobId), read(thumbJobId)]);
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
        <p className={`inline-flex items-start gap-1.5 ${errCls}`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {jobError}
        </p>
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
    </div>
  );
}
