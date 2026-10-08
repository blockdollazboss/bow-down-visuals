import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X, Play, Pause, Timer, Sparkles, Download, Copy, Check,
  AlertTriangle, Rocket, RotateCcw, Undo2, Music4, Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useHubProject } from "@/lib/hub-project";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import {
  buildLrc,
  validateLrc,
  splitLrcLines,
  fromAlignedLines,
  sanitizeLrcFilename,
  LRC_AI_ALIGN_ENDPOINT,
  LRC_AI_ALIGN_CREDITS,
  type TimedLyricLine,
} from "@/lib/lrc";
import { formatLyricTime, parseLyricTime, type LyricVideoLine } from "@/lib/lyric-video";

/* ─── LrcExportModal ────────────────────────────────────────────────────────
   Synced Lyrics Export (.lrc) — DistroKid "synced lyrics to Apple Music"
   parity, docked inside Song Maker results and the Lyric Video timing
   review (no new page, no new sidebar item).

   Two honest paths to timestamps:
     1. Tap to sync (FREE) — play the song, tap each line as it's sung.
        No AI runs, nothing is guessed.
     2. AI align (200 Visual Bucs) — reuses the lyric-video Whisper aligner;
        its own price is confirmed up front, never hidden.
   If timedLines arrive from an earlier alignment (lyric video flow), they
   are reused as-is — no new charge.

   Output: downloadable .lrc + copy-to-clipboard + "Add to release assets"
   (saved into the hub project tray, ready for the Distribute page).

   Honesty label (always visible): the LRC file is for submission to
   distributors that accept LRC — actual synced-lyrics delivery to
   Apple Music etc. needs a distribution partner; this tool does not
   deliver lyrics to any platform. */

export interface LrcExportSource {
  /** Must be a real URL (not blob:) — the server downloads it for AI align. */
  audioUrl: string;
  title: string;
  artistName?: string;
  lyrics: string;
  /** Timed lines from an earlier AI alignment — reused free, no new charge. */
  timedLines?: TimedLyricLine[] | null;
  durationSec?: number | null;
}

interface LrcExportModalProps {
  open: boolean;
  onClose: () => void;
  source: LrcExportSource | null;
}

type Mode = "tap" | "ai" | "review";

interface AlignResponse {
  lines?: LyricVideoLine[];
  audioRef?: string;
  matchRate?: number;
  error?: string;
  message?: string;
}

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function LrcExportModal({ open, onClose, source }: LrcExportModalProps) {
  const { t } = useTranslation();
  const { addAsset } = useHubProject();
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const hasReuse = !!source?.timedLines && source.timedLines.length > 0;
  const [mode, setMode] = useState<Mode>(hasReuse ? "review" : "tap");

  /* tap-to-sync state */
  const lyricLines = useMemo(
    () => (source ? splitLrcLines(source.lyrics) : []),
    [source]
  );
  const [stamps, setStamps] = useState<(number | null)[]>([]);
  const [tapIdx, setTapIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [curTime, setCurTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(source?.durationSec ?? null);

  /* review state */
  const [timed, setTimed] = useState<TimedLyricLine[]>([]);

  /* ai align state */
  const [aligning, setAligning] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  /* export state */
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  /* reset whenever the modal opens (or the song changes) */
  useEffect(() => {
    if (!open) return;
    setStamps(lyricLines.map(() => null));
    setTapIdx(0);
    setPlaying(false);
    setCurTime(0);
    setDuration(source?.durationSec ?? null);
    setTimed(hasReuse ? fromAlignedLines(source!.timedLines!) : []);
    setMode(hasReuse ? "review" : "tap");
    setAligning(false);
    setAiError(null);
    setCopied(false);
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source?.audioUrl, source?.lyrics]);

  useEffect(() => {
    if (!open) {
      audioRef.current?.pause();
    }
  }, [open ]);

  const lrcText = useMemo(
    () =>
      buildLrc(timed, {
        title: source?.title,
        artist: source?.artistName,
        lengthSec: duration,
      }),
    [timed, source?.title, source?.artistName, duration]
  );
  const validation = useMemo(() => validateLrc(lrcText), [lrcText]);

  /* ── tap-to-sync ── */
  const tapStamp = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || mode !== "tap" || tapIdx >= lyricLines.length) return;
    const now = Math.round(audio.currentTime * 100) / 100;
    setStamps((prev) => {
      const next = [...prev];
      next[tapIdx] = now;
      return next;
    });
    if (tapIdx + 1 >= lyricLines.length) {
      const final = lyricLines.map((text, i) => ({
        text,
        startSec: i === tapIdx ? now : (stamps[i] ?? 0),
      }));
      setTimed(final);
      setMode("review");
      audio.pause();
    } else {
      setTapIdx(tapIdx + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, tapIdx, lyricLines, stamps]);

  /* spacebar = tap (unless typing in a field) */
  useEffect(() => {
    if (!open || mode !== "tap") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.code === "Space") {
        e.preventDefault();
        tapStamp();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, mode, tapStamp]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }

  function redoLast() {
    if (tapIdx === 0) return;
    setStamps((prev) => {
      const next = [...prev];
      next[tapIdx - 1] = null;
      return next;
    });
    setTapIdx(tapIdx - 1);
  }

  function restartTap() {
    setStamps(lyricLines.map(() => null));
    setTapIdx(0);
  }

  /* ── AI align (paid, via the lyric-video aligner) ── */
  async function runAiAlign() {
    if (aligning || !source) return;
    if (!source.lyrics.trim()) {
      setAiError(t("lrcExport.noLyrics"));
      return;
    }
    setAligning(true);
    setAiError(null);
    try {
      const form = new FormData();
      form.append("lyrics", source.lyrics);
      form.append("audioUrl", source.audioUrl);
      const res = await confirmedFetch(LRC_AI_ALIGN_ENDPOINT, { method: "POST", body: form });
      if (!res) {
        setAligning(false); // user cancelled the credit confirmation
        return;
      }
      const data = (await res.json().catch(() => ({}))) as AlignResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        throw new Error(t("lrcExport.outOfCredits"));
      }
      if (!res.ok || !Array.isArray(data.lines) || data.lines.length === 0) {
        throw new Error(data.message || data.error || t("lrcExport.alignFailed"));
      }
      setTimed(fromAlignedLines(data.lines));
      setMode("review");
      toast({ title: t("lrcExport.alignDoneTitle"), description: t("lrcExport.alignDoneDesc") });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : t("lrcExport.alignFailed"));
    } finally {
      setAligning(false);
    }
  }

  /* ── review edits ── */
  function updateTimed(i: number, patch: Partial<TimedLyricLine>) {
    setTimed((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }
  function removeTimed(i: number) {
    setTimed((prev) => prev.filter((_, j) => j !== i));
  }

  /* ── exports ── */
  const fileName = useMemo(
    () => `${sanitizeLrcFilename(source?.title ? `${source.title}` : "synced-lyrics")}.lrc`,
    [source?.title]
  );

  function downloadLrc() {
    const blob = new Blob([lrcText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function copyLrc() {
    navigator.clipboard.writeText(lrcText).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => toast({ title: t("lrcExport.copyFailed"), variant: "destructive" })
    );
  }

  function addToReleaseAssets() {
    if (!source) return;
    addAsset({
      kind: "script",
      url: `data:text/plain;charset=utf-8,${encodeURIComponent(lrcText)}`,
      label: t("lrcExport.assetLabel", { title: source.title }),
      detail: t("lrcExport.assetDetail"),
      meta: {
        title: source.title,
        artist: source.artistName ?? "",
        handoff: "lrc-export",
        timedLines: String(validation.timedLineCount),
      },
    });
    setSaved(true);
    toast({ title: t("lrcExport.savedTitle"), description: t("lrcExport.savedDesc") });
  }

  if (!open || !source) return null;

  const stampedCount = stamps.filter((s) => s != null).length;
  const tapProgress = lyricLines.length > 0 ? stampedCount / lyricLines.length : 0;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("lrcExport.title")}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-primary/25 bg-[#0a0a0a] shadow-[0_0_80px_rgba(212,175,55,0.15)]"
      >
        {/* header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-white/10 bg-[#0a0a0a]/95 px-5 py-4 backdrop-blur sm:px-6">
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary">
              <Timer className="h-3.5 w-3.5" /> {t("lrcExport.badge")}
            </p>
            <h2 className="mt-1 text-xl font-black text-white">
              {t("lrcExport.title")} <span className="text-primary">(.lrc)</span>
            </h2>
            <p className="mt-0.5 truncate text-xs text-white/45">
              {source.artistName ? `${source.artistName} — ` : ""}{source.title}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t("lrcExport.close")}
            className="rounded-full border border-white/10 p-2 text-white/60 transition hover:border-primary/50 hover:text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <audio
          ref={audioRef}
          src={source.audioUrl}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) setDuration(Math.round(d * 100) / 100);
          }}
          onEnded={() => setPlaying(false)}
        />

        <div className="px-5 py-5 sm:px-6">
          {lyricLines.length === 0 && !hasReuse ? (
            <p className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-200">
              {t("lrcExport.noLyrics")}
            </p>
          ) : (
            <>
              {/* mode tabs */}
              {!hasReuse && mode !== "review" && (
                <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/40 p-1.5">
                  <button
                    onClick={() => setMode("tap")}
                    className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                      mode === "tap" ? "bg-primary text-black" : "text-white/60 hover:text-white"
                    }`}
                  >
                    <Timer className="h-4 w-4" /> {t("lrcExport.tapTab")}
                    <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-black uppercase">
                      {t("lrcExport.freeBadge")}
                    </span>
                  </button>
                  <button
                    onClick={() => setMode("ai")}
                    className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                      mode === "ai" ? "bg-primary text-black" : "text-white/60 hover:text-white"
                    }`}
                  >
                    <Sparkles className="h-4 w-4" /> {t("lrcExport.aiTab")}
                    <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-black">
                      {t("lrcExport.aiCost", { credits: LRC_AI_ALIGN_CREDITS })}
                    </span>
                  </button>
                </div>
              )}

              {hasReuse && mode === "review" && timed.length > 0 && (
                <p className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-2.5 text-xs text-emerald-200">
                  <Check className="h-4 w-4 shrink-0" /> {t("lrcExport.reusedNote")}
                </p>
              )}

              {/* ── tap-to-sync ── */}
              {mode === "tap" && (
                <div>
                  <div className="mb-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/50 p-4">
                    <button
                      onClick={togglePlay}
                      aria-label={playing ? t("lrcExport.pause") : t("lrcExport.play")}
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-black transition hover:brightness-110"
                    >
                      {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex items-center justify-between text-xs text-white/50">
                        <span className="font-mono">{fmtClock(curTime)}</span>
                        <span className="font-mono">{duration != null ? fmtClock(duration) : "–:––"}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary transition-[width]"
                          style={{ width: `${duration ? Math.min(100, (curTime / duration) * 100) : 0}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-[11px] text-white/40">
                        {t("lrcExport.tapHint", { done: stampedCount, total: lyricLines.length })}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={tapStamp}
                    disabled={tapIdx >= lyricLines.length}
                    className={`mb-4 w-full rounded-2xl border py-5 text-lg font-black uppercase tracking-widest transition disabled:opacity-40 ${
                      playing
                        ? "border-primary bg-primary/15 text-primary shadow-[0_0_40px_rgba(212,175,55,0.25)] animate-pulse"
                        : "border-primary/40 bg-primary/[0.06] text-primary hover:bg-primary/10"
                    }`}
                  >
                    {t("lrcExport.tapButton")}
                  </button>

                  <div className="mb-4 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${Math.round(tapProgress * 100)}%` }}
                    />
                  </div>

                  <div className="mb-4 flex gap-2">
                    <button
                      onClick={redoLast}
                      disabled={tapIdx === 0}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/60 transition hover:border-primary/40 hover:text-primary disabled:opacity-40"
                    >
                      <Undo2 className="h-3.5 w-3.5" /> {t("lrcExport.redoLast")}
                    </button>
                    <button
                      onClick={restartTap}
                      disabled={stampedCount === 0}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/60 transition hover:border-primary/40 hover:text-primary disabled:opacity-40"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> {t("lrcExport.restart")}
                    </button>
                    <button
                      onClick={() => {
                        setTimed(lyricLines.map((text, i) => ({ text, startSec: stamps[i] ?? 0 })));
                        setMode("review");
                      }}
                      disabled={stampedCount === 0}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-black text-black transition hover:brightness-110 disabled:opacity-40"
                    >
                      {t("lrcExport.reviewButton")}
                    </button>
                  </div>

                  <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                    {lyricLines.map((line, i) => {
                      const stamped = stamps[i] != null;
                      const current = i === tapIdx;
                      return (
                        <div
                          key={i}
                          className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-sm transition ${
                            current
                              ? "border-primary/60 bg-primary/10"
                              : stamped
                                ? "border-emerald-500/25 bg-emerald-500/5"
                                : "border-white/10 bg-black/40"
                          }`}
                        >
                          <span className={`w-14 shrink-0 font-mono text-xs ${stamped ? "text-emerald-300" : "text-white/30"}`}>
                            {stamped ? `[${fmtClock(stamps[i]!)}]` : "–:––"}
                          </span>
                          <span className={`flex-1 truncate ${current ? "font-bold text-white" : stamped ? "text-white/70" : "text-white/40"}`}>
                            {line}
                          </span>
                          {current && <span className="h-2 w-2 shrink-0 animate-ping rounded-full bg-primary" />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── AI align ── */}
              {mode === "ai" && (
                <div className="rounded-2xl border border-white/10 bg-black/40 p-5 text-center">
                  <Sparkles className="mx-auto mb-3 h-8 w-8 text-primary" />
                  <h3 className="mb-1 text-base font-bold text-white">{t("lrcExport.aiTitle")}</h3>
                  <p className="mx-auto mb-4 max-w-md text-xs leading-relaxed text-white/50">
                    {t("lrcExport.aiBlurb")}
                  </p>
                  {aiError && (
                    <p className="mb-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-left text-xs text-red-200">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {aiError}
                    </p>
                  )}
                  <button
                    onClick={runAiAlign}
                    disabled={aligning}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-50"
                  >
                    {aligning ? <RotateCcw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {aligning ? t("lrcExport.aligning") : t("lrcExport.aiButton", { credits: LRC_AI_ALIGN_CREDITS })}
                  </button>
                  <p className="mt-2 text-[11px] text-white/35">{t("lrcExport.aiPriceNote")}</p>
                </div>
              )}

              {/* ── review + export ── */}
              {mode === "review" && (
                <div>
                  <div className="mb-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/50 p-3">
                    <button
                      onClick={togglePlay}
                      aria-label={playing ? t("lrcExport.pause") : t("lrcExport.play")}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-black transition hover:brightness-110"
                    >
                      {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
                    </button>
                    <p className="text-xs text-white/45">{t("lrcExport.reviewHint")}</p>
                    {!hasReuse && (
                      <button
                        onClick={() => setMode("tap")}
                        className="ml-auto shrink-0 rounded-xl border border-white/10 px-3 py-1.5 text-xs font-semibold text-white/60 transition hover:border-primary/40 hover:text-primary"
                      >
                        {t("lrcExport.backToTap")}
                      </button>
                    )}
                  </div>

                  <div className="mb-4 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                    {timed.map((line, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-2.5 py-1.5">
                        <input
                          value={formatLyricTime(line.startSec)}
                          onChange={(e) => {
                            const v = parseLyricTime(e.target.value);
                            if (v != null) updateTimed(i, { startSec: Math.round(v * 100) / 100 });
                          }}
                          aria-label={t("lrcExport.lineTimeLabel", { n: i + 1 })}
                          className="w-20 shrink-0 rounded-lg border border-white/10 bg-black/60 px-2 py-1.5 text-center font-mono text-xs text-white outline-none focus:border-primary/60"
                        />
                        <span className="flex-1 truncate text-sm text-white/75">{line.text}</span>
                        <button
                          onClick={() => removeTimed(i)}
                          aria-label={t("lrcExport.removeLine", { n: i + 1 })}
                          className="rounded-lg p-1.5 text-white/35 transition hover:text-red-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {timed.length === 0 && (
                      <p className="rounded-xl border border-white/10 p-4 text-center text-xs text-white/40">
                        {t("lrcExport.noTimedLines")}
                      </p>
                    )}
                  </div>

                  {/* validation */}
                  {validation.ok ? (
                    <p className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-2.5 text-xs font-semibold text-emerald-200">
                      <Check className="h-4 w-4 shrink-0" />
                      {t("lrcExport.validNote", { count: validation.timedLineCount })}
                    </p>
                  ) : (
                    <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-red-200">
                        <AlertTriangle className="h-4 w-4" /> {t("lrcExport.invalidTitle")}
                      </p>
                      <ul className="max-h-24 space-y-1 overflow-y-auto text-[11px] text-red-200/90">
                        {validation.errors.map((e, i) => (
                          <li key={i}>• {e}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* preview */}
                  <div className="mb-4 overflow-hidden rounded-2xl border border-white/10">
                    <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-2">
                      <Music4 className="h-3.5 w-3.5 text-primary" />
                      <span className="font-mono text-xs text-white/50">{fileName}</span>
                    </div>
                    <pre className="max-h-44 overflow-y-auto bg-black/60 p-4 font-mono text-[11px] leading-relaxed text-primary/90">
                      {lrcText}
                    </pre>
                  </div>

                  {/* actions */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={downloadLrc}
                      disabled={!validation.ok}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40"
                    >
                      <Download className="h-4 w-4" /> {t("lrcExport.download")}
                    </button>
                    <button
                      onClick={copyLrc}
                      disabled={!validation.ok}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/40 px-4 py-3 text-sm font-bold text-primary transition hover:bg-primary/10 disabled:opacity-40"
                    >
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copied ? t("lrcExport.copied") : t("lrcExport.copy")}
                    </button>
                    <button
                      onClick={addToReleaseAssets}
                      disabled={!validation.ok}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm font-bold text-white/80 transition hover:border-primary/40 hover:text-primary disabled:opacity-40"
                    >
                      {saved ? <Check className="h-4 w-4 text-emerald-300" /> : <Timer className="h-4 w-4" />}
                      {saved ? t("lrcExport.savedBadge") : t("lrcExport.addToRelease")}
                    </button>
                    <button
                      onClick={() => {
                        window.location.href = "/distribute";
                      }}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm font-bold text-white/80 transition hover:border-primary/40 hover:text-primary"
                    >
                      <Rocket className="h-4 w-4" /> {t("lrcExport.openDistribute")}
                    </button>
                  </div>
                </div>
              )}

              {/* honesty label — always visible */}
              <p className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-[11px] leading-relaxed text-white/40">
                {t("lrcExport.honestyNote")}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
