import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play, Pause, RotateCcw, FlipHorizontal2,
  Maximize, Minimize, X, Gauge, MonitorPlay,
} from "lucide-react";
import { useTranslation } from "react-i18next";

interface TeleprompterPlayerProps {
  script: string;
  onClose: () => void;
}

const MIN_WPM = 60;
const MAX_WPM = 220;
const WPM_STEP = 5;
const MIN_FONT = 24;
const MAX_FONT = 88;
const FONT_STEP = 4;

/**
 * Fullscreen teleprompter player for the Script Writer page.
 * Smooth requestAnimationFrame auto-scroll calibrated to words-per-minute,
 * with font-size, speed, mirror (hardware teleprompter) and fullscreen controls.
 * Pure UI — no backend, no credit charge.
 */
export function TeleprompterPlayer({ script, onClose }: TeleprompterPlayerProps) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(true);
  const [wpm, setWpm] = useState(140);
  const [fontSize, setFontSize] = useState(44);
  const [mirror, setMirror] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [progress, setProgress] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const wordCount = useMemo(
    () => script.split(/\s+/).filter(Boolean).length,
    [script]
  );
  const readMinutes = useMemo(
    () => Math.max(1, Math.round((wordCount / wpm) * 10) / 10),
    [wordCount, wpm]
  );

  const togglePlay = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      const max = el.scrollHeight - el.clientHeight;
      // If we're sitting at the end, restart from the top on play.
      if (!playing && max > 0 && el.scrollTop >= max - 1) {
        el.scrollTop = 0;
      }
    }
    setPlaying((p) => !p);
  }, [playing]);

  const restart = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setPlaying(true);
  }, []);

  const bumpWpm = useCallback((delta: number) => {
    setWpm((w) => Math.min(MAX_WPM, Math.max(MIN_WPM, w + delta)));
  }, []);

  const bumpFont = useCallback((delta: number) => {
    setFontSize((f) => Math.min(MAX_FONT, Math.max(MIN_FONT, f + delta)));
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await overlayRef.current?.requestFullscreen();
      }
    } catch {
      /* fullscreen unavailable — ignore */
    }
  }, []);

  /* Lock body scroll + keyboard shortcuts while open. */
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowUp":
          e.preventDefault();
          bumpWpm(WPM_STEP);
          break;
        case "ArrowDown":
          e.preventDefault();
          bumpWpm(-WPM_STEP);
          break;
        case "+":
        case "=":
          bumpFont(FONT_STEP);
          break;
        case "-":
        case "_":
          bumpFont(-FONT_STEP);
          break;
      }
    }
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose, togglePlay, bumpWpm, bumpFont]);

  /* Track fullscreen state for the icon. */
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /* Smooth rAF scroll: px-per-word is measured live from the DOM so speed
     stays true at any font size. */
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); // clamp tab-switch jumps
      last = now;
      const el = scrollRef.current;
      if (el && wordCount > 0) {
        const pxPerWord = el.scrollHeight / wordCount;
        el.scrollTop += (wpm / 60) * pxPerWord * dt;
        const max = el.scrollHeight - el.clientHeight;
        if (max > 0 && el.scrollTop >= max - 1) {
          el.scrollTop = max;
          setPlaying(false);
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, wpm, fontSize, wordCount]);

  /* Scroll progress bar. */
  const updateProgress = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
  }, []);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] bg-black text-white flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={t("scriptWriter.teleprompterTitle")}
    >
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 border-b border-amber-400/20 bg-black/80 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-xl bg-amber-400/10 border border-amber-400/30 shrink-0">
            <MonitorPlay className="w-5 h-5 text-amber-300" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-tight truncate">
              {t("scriptWriter.teleprompterTitle")}
            </h2>
            <p className="text-xs text-white/45">
              {t("scriptWriter.teleprompterWords", { count: wordCount })} ·{" "}
              {t("scriptWriter.teleprompterReadTime", { min: readMinutes })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setMirror((m) => !m)}
            aria-pressed={mirror}
            title={t("scriptWriter.teleprompterMirror")}
            aria-label={t("scriptWriter.teleprompterMirror")}
            className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${
              mirror
                ? "border-amber-400/70 bg-amber-400/15 text-amber-300"
                : "border-white/15 bg-white/5 text-white/70 hover:border-amber-400/50 hover:text-amber-300"
            }`}
          >
            <FlipHorizontal2 className="h-5 w-5" />
          </button>
          <button
            onClick={toggleFullscreen}
            title={t("scriptWriter.teleprompterFullscreen")}
            aria-label={t("scriptWriter.teleprompterFullscreen")}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/70 hover:border-amber-400/50 hover:text-amber-300 transition"
          >
            {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
          </button>
          <button
            onClick={onClose}
            title={t("scriptWriter.teleprompterClose")}
            aria-label={t("scriptWriter.teleprompterClose")}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/70 hover:border-red-400/60 hover:text-red-300 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* ── Progress bar ── */}
      <div className="h-1 bg-white/10 shrink-0">
        <div
          className="h-full bg-gradient-to-r from-amber-400 to-yellow-500 transition-[width] duration-150"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      {/* ── Script viewport ── */}
      <div className="relative flex-1 min-h-0">
        {/* Reading guide line */}
        <div className="pointer-events-none absolute left-0 right-0 top-[42%] z-10 flex items-center gap-2 px-4">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-400/60 to-amber-400/60" />
          <div className="h-2 w-2 rotate-45 bg-amber-400/80 shrink-0" />
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-amber-400/60 to-amber-400/60" />
        </div>

        <div
          ref={scrollRef}
          onScroll={updateProgress}
          onClick={togglePlay}
          className="h-full overflow-y-auto cursor-pointer select-none"
          style={{ scrollbarWidth: "none" }}
        >
          <div
            className="mx-auto max-w-4xl px-6 md:px-10"
            style={{
              paddingTop: "45vh",
              paddingBottom: "55vh",
              transform: mirror ? "scaleX(-1)" : undefined,
            }}
          >
            <p
              className="text-white font-medium leading-[1.6] whitespace-pre-wrap text-center"
              style={{ fontSize }}
            >
              {script}
            </p>
          </div>
        </div>
      </div>

      {/* ── Control bar ── */}
      <div className="shrink-0 border-t border-amber-400/20 bg-black/90 px-4 md:px-6 py-4">
        <div className="mx-auto max-w-4xl flex flex-col gap-4">
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={restart}
              title={t("scriptWriter.teleprompterRestart")}
              aria-label={t("scriptWriter.teleprompterRestart")}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/70 hover:border-amber-400/50 hover:text-amber-300 transition"
            >
              <RotateCcw className="h-5 w-5" />
            </button>
            <button
              onClick={togglePlay}
              aria-label={playing ? t("scriptWriter.teleprompterPause") : t("scriptWriter.teleprompterPlay")}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 text-black shadow-[0_0_30px_rgba(251,191,36,0.35)] hover:brightness-110 transition"
            >
              {playing ? (
                <Pause className="h-7 w-7 fill-current" />
              ) : (
                <Play className="h-7 w-7 fill-current translate-x-0.5" />
              )}
            </button>
            <div className="flex h-12 items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2">
              <button
                onClick={() => bumpFont(-FONT_STEP)}
                aria-label={t("scriptWriter.teleprompterFontSmaller")}
                className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 hover:text-amber-300 transition text-lg font-bold"
              >
                A−
              </button>
              <span className="w-12 text-center text-sm font-semibold text-amber-300 tabular-nums">
                {fontSize}
              </span>
              <button
                onClick={() => bumpFont(FONT_STEP)}
                aria-label={t("scriptWriter.teleprompterFontLarger")}
                className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 hover:text-amber-300 transition text-xl font-bold"
              >
                A+
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Gauge className="w-5 h-5 text-amber-300 shrink-0" />
            <span className="text-sm text-white/55 w-14 shrink-0">
              {t("scriptWriter.teleprompterWpm")}
            </span>
            <input
              type="range"
              min={MIN_WPM}
              max={MAX_WPM}
              step={WPM_STEP}
              value={wpm}
              onChange={(e) => setWpm(Number(e.target.value))}
              aria-label={t("scriptWriter.teleprompterWpm")}
              className="flex-1 accent-amber-400"
            />
            <span className="text-sm font-bold text-amber-300 tabular-nums w-20 text-right shrink-0">
              {t("scriptWriter.teleprompterWpmValue", { wpm })}
            </span>
          </div>

          <p className="text-center text-[11px] text-white/35">
            {t("scriptWriter.teleprompterHint")}
          </p>
        </div>
      </div>
    </div>
  );
}
