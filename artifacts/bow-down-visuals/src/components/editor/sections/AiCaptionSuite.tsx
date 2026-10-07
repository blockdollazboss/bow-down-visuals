import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Captions, Upload, Film, Wand2, Loader2, AlertCircle, CheckCircle2,
  Plus, Trash2, Download, Languages, Palette, Type, ArrowRight,
  ArrowLeft, Sparkles, Image as ImageIcon, CalendarClock, Clock3,
  Ban, RefreshCw, ChevronRight,
} from "lucide-react";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EditorCard, Field, Segmented, Chip } from "@/components/editor/controls";

/* ─── AI Caption Suite — the single user-facing concept for captions ───
 * Orchestrates the four caption backend routes as one guided flow:
 *   1. GENERATE  → POST /api/auto-captions      (Whisper word timings + editable transcript)
 *   2. STYLE     → POST /api/caption-styler      (AI word-sync burn, async job w/ polled status)
 *              → POST /api/style-subtitles       (burn the step-1 transcript, SRT-based)
 *   3. TRANSLATE → POST /api/translate-captions  (10-language translations of the captions)
 * No backend routes were renamed or removed — the panel is the one place
 * users think about captions. */

export interface CaptionSuiteVideo {
  id: string;
  label: string;
  url: string;
}

interface Props {
  /** Auth token getter for the raw upload call. */
  getAccessToken?: () => Promise<string | null>;
  /** Videos from the editor timeline the user can caption directly. */
  timelineVideos: CaptionSuiteVideo[];
  /** Push caption lines into the editor timeline's caption track. */
  onPushToTimeline?: (lines: { startSec: number; endSec: number; text: string }[]) => void;
}

interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface SuiteLine {
  id: string;
  start: number;
  end: number;
  text: string;
  words: WordTiming[];
}

type Step = 1 | 2 | 3;
type GenStatus = "idle" | "uploading" | "working" | "done" | "error";
type BurnMode = "wordsync" | "transcript";
type BurnStatus = "idle" | "working" | "done" | "error";
type TranslateStatus = "idle" | "working" | "done" | "error";

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ── Style catalogs (mirror the server route options) ─────────────────
 * caption-styler styles are TRUE word-timed karaoke (server re-transcribes
 * with Whisper word timestamps) → canonical AI styling path.
 * style-subtitles styles burn an SRT → burn-only path for when you already
 * have a transcript (SRT has no word timings; its "karaoke" is a visual
 * treatment, not true word sync — the server file says so itself). */
const WORDSYNC_STYLES = [
  { key: "hormozi", label: "Hormozi", blurb: "Bold pop — big words, active word highlighted" },
  { key: "minimal", label: "Minimal", blurb: "Clean and quiet — small white text" },
  { key: "karaoke", label: "Karaoke", blurb: "Classic word-by-word sweep" },
  { key: "neon", label: "Neon", blurb: "Glowing cyan/magenta pop" },
  { key: "luxury-gold", label: "Luxury Gold", blurb: "Gold-on-black brand style" },
] as const;

const TRANSCRIPT_STYLES = [
  { key: "karaoke", label: "Karaoke", blurb: "Big bold gold text — sing-along energy" },
  { key: "word-by-word", label: "Word by Word", blurb: "TikTok-style bold text on a dark box" },
  { key: "minimal", label: "Minimal", blurb: "Small clean white text, stays out of the way" },
  { key: "bold-outline", label: "Bold Outline", blurb: "Chunky white text, readable anywhere" },
  { key: "neon", label: "Neon", blurb: "Glowing cyan text, night-club energy" },
] as const;

const LANGUAGES = [
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
] as const;

/* ── SRT / VTT builders ─────────────────────────────────────────────── */
function pad(n: number, len = 2) {
  return String(n).padStart(len, "0");
}
function secToSrt(sec: number) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}
function secToVtt(sec: number) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}
function buildSrt(lines: SuiteLine[]) {
  return (
    lines
      .map((l, i) => `${i + 1}\n${secToSrt(l.start)} --> ${secToSrt(l.end)}\n${l.text.trim() || "(empty)"}\n`)
      .join("\n") + "\n"
  );
}
function buildVtt(lines: SuiteLine[]) {
  return (
    "WEBVTT\n\n" +
    lines
      .map((l) => `${secToVtt(l.start)} --> ${secToVtt(l.end)}\n${l.text.trim() || "(empty)"}\n`)
      .join("\n") +
    "\n"
  );
}
function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ── Preview caption CSS per style key (approximation for the live preview) */
const PREVIEW_STYLE_CLASS: Record<string, string> = {
  "hormozi": "font-black uppercase text-white text-2xl md:text-4xl [text-shadow:2px_2px_0_#000,-2px_2px_0_#000,2px_-2px_0_#000,-2px_-2px_0_#000]",
  "minimal": "font-medium text-white/90 text-lg md:text-xl [text-shadow:1px_1px_2px_rgba(0,0,0,0.8)]",
  "karaoke": "font-black text-[#FFD700] text-2xl md:text-3xl [text-shadow:2px_2px_0_#000]",
  "neon": "font-black text-cyan-300 text-2xl md:text-3xl [text-shadow:0_0_12px_rgba(0,255,255,0.9),2px_2px_0_#000]",
  "luxury-gold": "font-black text-[#E8C468] text-2xl md:text-3xl [text-shadow:2px_2px_0_#000]",
  "word-by-word": "font-black text-white text-xl md:text-2xl bg-black/80 px-3 py-1 rounded-lg",
  "bold-outline": "font-black text-white text-2xl md:text-3xl [text-shadow:3px_3px_0_#000,-3px_3px_0_#000,3px_-3px_0_#000,-3px_-3px_0_#000]",
};
const PREVIEW_POS_CLASS: Record<string, string> = {
  top: "top-6",
  middle: "top-1/2 -translate-y-1/2",
  bottom: "bottom-8",
};

const GEN_TIPS = [
  "Extracting the audio track from your video…",
  "Transcribing with Whisper — this is the slow part, usually 1–3 minutes…",
  "Aligning word-level timings for the karaoke effect…",
  "Burning the preview captions into the video…",
];
export function AiCaptionSuite({ getAccessToken, timelineVideos, onPushToTimeline }: Props) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();

  const [step, setStep] = useState<Step>(1);
  const [sourceMode, setSourceMode] = useState<"upload" | "timeline">("timeline");
  const [file, setFile] = useState<File | null>(null);
  const [timelineId, setTimelineId] = useState<string>("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [genStatus, setGenStatus] = useState<GenStatus>("idle");
  const [genError, setGenError] = useState<string | null>(null);
  const [genElapsed, setGenElapsed] = useState(0);
  const [genTipIdx, setGenTipIdx] = useState(0);
  const [keyReady, setKeyReady] = useState<boolean | null>(null);

  const [lines, setLines] = useState<SuiteLine[]>([]);
  const [burnedPreviewUrl, setBurnedPreviewUrl] = useState<string | null>(null);
  const [pushed, setPushed] = useState(false);

  const [burnMode, setBurnMode] = useState<BurnMode>("wordsync");
  const [styleKey, setStyleKey] = useState<string>("hormozi");
  const [position, setPosition] = useState<"top" | "middle" | "bottom">("bottom");
  const [fontSize, setFontSize] = useState<"small" | "medium" | "large">("medium");
  const [withEmoji, setWithEmoji] = useState(false);
  const [burnStatus, setBurnStatus] = useState<BurnStatus>("idle");
  const [burnJobStatus, setBurnJobStatus] = useState<string | null>(null);
  const [burnError, setBurnError] = useState<string | null>(null);
  const [burnResultUrl, setBurnResultUrl] = useState<string | null>(null);

  const [langs, setLangs] = useState<string[]>([]);
  const [translateStatus, setTranslateStatus] = useState<TranslateStatus>("idle");
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [translations, setTranslations] = useState<Record<string, SuiteLine[]>>({});
  const [activeLang, setActiveLang] = useState<string>("");

  const [endCard, setEndCard] = useState(true); // "Made with Bow Down Visuals" outro — default ON
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [shared, setShared] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const elapsedTimer = useRef<number | null>(null);
  const burnPollTimer = useRef<number | null>(null);

  const step2Unlocked = lines.length > 0;
  const step3Unlocked = step2Unlocked && burnResultUrl != null;

  /* ── Check whether the server can transcribe (honest key-missing state) */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await confirmedFetch("/api/auto-captions/info", { skipConfirm: true });
        if (!res) return;
        const data = (await res.json().catch(() => ({}))) as { ready?: boolean };
        if (!cancelled) setKeyReady(data.ready ?? true);
      } catch {
        if (!cancelled) setKeyReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [confirmedFetch]);

  /* ── Elapsed clock + rotating honest stage hints while generating */
  useEffect(() => {
    if (genStatus === "working" || genStatus === "uploading") {
      elapsedTimer.current = window.setInterval(() => setGenElapsed((e) => e + 1), 1000);
    } else if (elapsedTimer.current) {
      window.clearInterval(elapsedTimer.current);
      elapsedTimer.current = null;
    }
    return () => {
      if (elapsedTimer.current) window.clearInterval(elapsedTimer.current);
    };
  }, [genStatus]);

  useEffect(() => {
    if (genStatus !== "working") return;
    const id = window.setInterval(() => setGenTipIdx((i) => (i + 1) % GEN_TIPS.length), 18000);
    return () => window.clearInterval(id);
  }, [genStatus]);

  useEffect(() => () => {
    if (burnPollTimer.current) window.clearInterval(burnPollTimer.current);
  }, []);

  const activeLine = useMemo(() => {
    return lines.find((l) => previewTime >= l.start && previewTime <= l.end) ?? null;
  }, [lines, previewTime]);

  function fmtElapsed(sec: number) {
    return `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
  }

  /** The branded outro line: appended to the transcript so it burns into
   *  transcript-mode exports, ships in SRT/VTT downloads, and gets
   *  translated in step 3 — the viral loop. Visible + editable + removable. */
  function endCardLine(duration: number | null): SuiteLine {
    const lastEnd = lines.filter((l) => l.id !== "endcard").reduce((m, l) => Math.max(m, l.end), 0);
    const lineEnd = duration && duration > 3 ? duration : lastEnd + 2.5;
    return {
      id: "endcard",
      start: Number(Math.max(0, lineEnd - 2.5).toFixed(1)),
      end: Number(lineEnd.toFixed(1)),
      text: t("captionSuite.endCardText"),
      words: [],
    };
  }

  function syncEndCard(nextLines: SuiteLine[], wantOn: boolean, duration: number | null) {
    const has = nextLines.some((l) => l.id === "endcard");
    if (wantOn && !has) return [...nextLines, endCardLine(duration)];
    if (!wantOn && has) return nextLines.filter((l) => l.id !== "endcard");
    return nextLines;
  }

  function toggleEndCard(on: boolean) {
    setEndCard(on);
    setLines((prev) => syncEndCard(prev, on, videoDuration));
    setPushed(false);
  }

  // Re-time the end-card when the real video duration loads.
  useEffect(() => {
    if (videoDuration == null) return;
    setLines((prev) => {
      if (!prev.some((l) => l.id === "endcard")) return prev;
      return [...prev.filter((l) => l.id !== "endcard"), endCardLine(videoDuration)];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoDuration]);

  /* ── STEP 1: upload (if needed) → POST /api/auto-captions ──────────── */
  async function resolveSourceUrl(): Promise<string> {
    if (sourceMode === "timeline") {
      const v = timelineVideos.find((x) => x.id === timelineId);
      if (!v) throw new Error(t("captionSuite.pickTimelineVideoFirst"));
      return v.url;
    }
    if (videoUrl) return videoUrl; // already uploaded
    if (!file) throw new Error(t("captionSuite.chooseFileFirst"));
    const token = await getAccessToken?.().catch(() => null);
    if (!token) throw new Error(t("captionSuite.signInToUpload"));
    const form = new FormData();
    form.append("clip", file, file.name);
    const upRes = await fetch("/api/upload-clip", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const upData = (await upRes.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
    if (!upRes.ok || !upData.url) {
      throw new Error(upData.message ?? upData.error ?? t("captionSuite.uploadFailed"));
    }
    setVideoUrl(upData.url);
    return upData.url;
  }

  async function handleGenerate() {
    setGenError(null);
    setPushed(false);
    try {
      setGenStatus("uploading");
      setGenElapsed(0);
      setGenTipIdx(0);
      const url = await resolveSourceUrl();
      setGenStatus("working");
      /* 300 Visual Bucs — the confirm dialog names the cost (registered in
         credit-costs.ts as /api/auto-captions). Server does its own 402
         pre-check and refunds on failure. */
      const res = await confirmedFetch("/api/auto-captions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: url, includeWords: true }),
      });
      if (!res) { setGenStatus("idle"); return; } // user cancelled the confirm
      const data = (await res.json().catch(() => ({}))) as {
        url?: string; lineCount?: number; wordCount?: number; error?: string;
        lines?: { start: number; end: number; text: string; words: WordTiming[] }[];
      };
      if (!res.ok) throw new Error(data.error ?? t("captionSuite.generateFailed", { status: res.status }));
      const raw = data.lines ?? [];
      if (raw.length === 0) throw new Error(t("captionSuite.noSpeech"));
      const mapped: SuiteLine[] = raw.map((l) => ({
        id: newId("line"), start: l.start, end: l.end, text: l.text, words: l.words ?? [],
      }));
      setLines(syncEndCard(mapped, endCard, videoDuration));
      setBurnedPreviewUrl(data.url ?? null);
      setBurnResultUrl(null);
      setTranslations({});
      setLangs([]);
      setGenStatus("done");
      setStep(2);
    } catch (err) {
      setGenStatus("error");
      setGenError(err instanceof Error ? err.message : t("captionSuite.generateFailedGeneric"));
    }
  }

  function updateLine(id: string, patch: Partial<SuiteLine>) {
    setLines((prev) => prev.map((l) => {
      if (l.id !== id) return l;
      // Editing text invalidates word timings (they no longer align).
      const dropWords = patch.text !== undefined && patch.text !== l.text;
      return { ...l, ...patch, words: dropWords ? [] : l.words };
    }));
    setPushed(false);
  }

  function deleteLine(id: string) {
    setLines((prev) => prev.filter((l) => l.id !== id));
    setPushed(false);
  }

  function addLine() {
    const last = lines[lines.length - 1];
    const start = last ? last.end + 0.2 : 0;
    setLines((prev) => [...prev, { id: newId("line"), start: Number(start.toFixed(1)), end: Number((start + 2).toFixed(1)), text: "", words: [] }]);
  }
  /* ── STEP 2: burn — caption-styler (async, polled) or style-subtitles ─ */
  function buildSrtFromLines() {
    return buildSrt(lines.filter((l) => l.text.trim().length > 0));
  }

  async function pollBurnJob(jobId: string) {
    if (burnPollTimer.current) window.clearInterval(burnPollTimer.current);
    burnPollTimer.current = window.setInterval(async () => {
      try {
        const res = await confirmedFetch(`/api/caption-styler/${jobId}`, { skipConfirm: true });
        if (!res) return;
        const data = (await res.json().catch(() => ({}))) as {
          status?: string; outputUrl?: string | null; error?: string | null;
        };
        setBurnJobStatus(data.status ?? null);
        if (data.status === "done") {
          if (burnPollTimer.current) window.clearInterval(burnPollTimer.current);
          setBurnResultUrl(data.outputUrl ?? null);
          setBurnStatus("done");
        } else if (data.status === "failed") {
          if (burnPollTimer.current) window.clearInterval(burnPollTimer.current);
          setBurnStatus("error");
          setBurnError(data.error ?? t("captionSuite.burnFailedGeneric"));
        }
      } catch (err) {
        if (burnPollTimer.current) window.clearInterval(burnPollTimer.current);
        setBurnStatus("error");
        setBurnError(err instanceof Error ? err.message : t("captionSuite.burnFailedGeneric"));
      }
    }, 3000);
  }

  async function handleBurn() {
    setBurnError(null);
    try {
      if (lines.filter((l) => l.text.trim()).length === 0) {
        throw new Error(t("captionSuite.noCaptionText"));
      }
      setBurnStatus("working");
      setBurnJobStatus(null);
      setBurnResultUrl(null);

      if (burnMode === "wordsync") {
        /* Canonical AI path: POST /api/caption-styler (300). The server
           re-transcribes with Whisper word timings and burns TRUE word-sync
           karaoke. Async server-owned job — poll for real status. */
        let uploadFile = file;
        if (!uploadFile) {
          const srcUrl = videoUrl ?? timelineVideos.find((x) => x.id === timelineId)?.url;
          if (!srcUrl) throw new Error(t("captionSuite.needSourceForStyler"));
          const blob = await (await fetch(srcUrl)).blob();
          uploadFile = new File([blob], "caption-source.mp4", { type: blob.type || "video/mp4" });
        }
        const form = new FormData();
        form.append("video", uploadFile, uploadFile.name);
        form.append("style", styleKey);
        form.append("position", position);
        form.append("fontSize", fontSize);
        form.append("withEmoji", String(withEmoji));
        const res = await confirmedFetch("/api/caption-styler", { method: "POST", body: form });
        if (!res) { setBurnStatus("idle"); return; }
        const data = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string; message?: string };
        if (!res.ok || !data.jobId) {
          throw new Error(data.message ?? data.error ?? t("captionSuite.burnFailedGeneric"));
        }
        setBurnJobStatus("queued");
        void pollBurnJob(data.jobId);
      } else {
        /* Burn-only path: POST /api/style-subtitles (200). Burns the
           step-1 transcript (SRT, end-card included) in one of the 5
           subtitle presets. */
        const srcUrl = videoUrl ?? timelineVideos.find((x) => x.id === timelineId)?.url;
        if (!srcUrl) throw new Error(t("captionSuite.needSourceForBurn"));
        const res = await confirmedFetch("/api/style-subtitles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoUrl: srcUrl, srt: buildSrtFromLines(), style: styleKey }),
        });
        if (!res) { setBurnStatus("idle"); return; }
        const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
        if (!res.ok || !data.url) {
          throw new Error(data.message ?? data.error ?? t("captionSuite.burnFailedGeneric"));
        }
        setBurnResultUrl(data.url);
        setBurnStatus("done");
      }
    } catch (err) {
      setBurnStatus("error");
      setBurnError(err instanceof Error ? err.message : t("captionSuite.burnFailedGeneric"));
    }
  }

  /* ── STEP 3: translate — POST /api/translate-captions ─────────────── */
  function toggleLang(code: string) {
    setLangs((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function handleTranslate() {
    setTranslateError(null);
    try {
      const usable = lines.filter((l) => l.text.trim().length > 0);
      if (usable.length === 0) throw new Error(t("captionSuite.noCaptionText"));
      if (langs.length === 0) throw new Error(t("captionSuite.pickLanguageFirst"));
      setTranslateStatus("working");
      /* 50 Visual Bucs per language — cost is dynamic, so we pass it
         explicitly. Server pre-checks the total and refunds on failure. */
      const res = await confirmedFetch("/api/translate-captions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          captions: usable.map((l) => ({ start: l.start, end: l.end, text: l.text })),
          targetLanguages: langs,
        }),
        overrideCost: 50 * langs.length,
        overrideFeature: t("captionSuite.translateFeature"),
      });
      if (!res) { setTranslateStatus("idle"); return; }
      const data = (await res.json().catch(() => ({}))) as {
        translations?: Record<string, { start: number; end: number; text: string }[]>;
        error?: string; message?: string;
      };
      if (!res.ok || !data.translations) {
        throw new Error(data.message ?? data.error ?? t("captionSuite.translateFailedGeneric"));
      }
      const mapped: Record<string, SuiteLine[]> = {};
      for (const [code, caps] of Object.entries(data.translations)) {
        mapped[code] = caps.map((c) => ({ id: newId("tline"), start: c.start, end: c.end, text: c.text, words: [] }));
      }
      setTranslations(mapped);
      setActiveLang(Object.keys(mapped)[0] ?? "");
      setTranslateStatus("done");
    } catch (err) {
      setTranslateStatus("error");
      setTranslateError(err instanceof Error ? err.message : t("captionSuite.translateFailedGeneric"));
    }
  }

  function updateTranslatedLine(code: string, id: string, text: string) {
    setTranslations((prev) => ({
      ...prev,
      [code]: (prev[code] ?? []).map((l) => (l.id === id ? { ...l, text } : l)),
    }));
  }

  /* ── Virality: one-click share of the finished captioned clip ─────── */
  async function handleNativeShare() {
    if (!burnResultUrl) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: t("captionSuite.shareTitle"),
          text: t("captionSuite.shareText"),
          url: burnResultUrl,
        });
      } else {
        await navigator.clipboard.writeText(burnResultUrl);
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      }
    } catch { /* user cancelled */ }
  }

  async function handleCopyLink() {
    if (!burnResultUrl) return;
    try {
      await navigator.clipboard.writeText(burnResultUrl);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch { /* clipboard unavailable */ }
  }

  function socialShareHref(network: "x" | "facebook" | "whatsapp" | "telegram") {
    if (!burnResultUrl) return "#";
    const url = encodeURIComponent(burnResultUrl);
    const text = encodeURIComponent(t("captionSuite.shareText"));
    switch (network) {
      case "x": return `https://twitter.com/intent/tweet?text=${text}&url=${url}`;
      case "facebook": return `https://www.facebook.com/sharer/sharer.php?u=${url}`;
      case "whatsapp": return `https://wa.me/?text=${text}%20${url}`;
      case "telegram": return `https://t.me/share/url?url=${url}&text=${text}`;
    }
  }

  /* ── Shared bits ──────────────────────────────────────────────────── */
  function handlePushToTimeline(useLines: SuiteLine[]) {
    const mapped = useLines
      .filter((l) => l.text.trim().length > 0)
      .map((l) => ({ startSec: l.start, endSec: l.end, text: l.text }));
    onPushToTimeline?.(mapped);
    setPushed(true);
  }

  const steps: { n: Step; label: string; icon: React.ReactNode; unlocked: boolean }[] = [
    { n: 1, label: t("captionSuite.stepGenerate"), icon: <Wand2 className="h-4 w-4" />, unlocked: true },
    { n: 2, label: t("captionSuite.stepStyle"), icon: <Palette className="h-4 w-4" />, unlocked: step2Unlocked },
    { n: 3, label: t("captionSuite.stepTranslate"), icon: <Languages className="h-4 w-4" />, unlocked: step3Unlocked },
  ];

  const styleCatalog = burnMode === "wordsync" ? WORDSYNC_STYLES : TRANSCRIPT_STYLES;
  useEffect(() => {
    if (!styleCatalog.some((s) => s.key === styleKey)) {
      setStyleKey(styleCatalog[0]?.key ?? "hormozi");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burnMode]);

  const previewStyleClass = PREVIEW_STYLE_CLASS[styleKey] ?? PREVIEW_STYLE_CLASS["minimal"]!;
  const previewPosClass = PREVIEW_POS_CLASS[position];
  const translateCost = 50 * langs.length;
  const burnCost = burnMode === "wordsync" ? 300 : 200;
  const activeTranslated = activeLang ? translations[activeLang] ?? [] : [];
  const activeLangLabel = LANGUAGES.find((l) => l.code === activeLang)?.label ?? activeLang;
  return (
    <EditorCard
      title={t("captionSuite.title")}
      subtitle={t("captionSuite.subtitle")}
      icon={<Captions className="h-4 w-4" />}
      right={
        <span className="text-[10px] font-black uppercase tracking-widest text-[#E8C468] border border-[#E8C468]/30 bg-[#E8C468]/10 rounded-full px-2.5 py-1">
          {t("captionSuite.allInOne")}
        </span>
      }
      className="border-[#E8C468]/20"
    >
      {/* ── Step stepper ── */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {steps.map((s, i) => (
          <div key={s.n} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!s.unlocked}
              onClick={() => setStep(s.n)}
              data-testid={`caption-suite-step-${s.n}`}
              className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-black uppercase tracking-wider transition-colors ${
                step === s.n
                  ? "border-[#E8C468] bg-[#E8C468]/15 text-[#E8C468]"
                  : s.unlocked
                    ? "border-white/10 bg-white/[0.03] text-white/60 hover:text-white hover:border-white/25"
                    : "border-white/[0.06] bg-white/[0.01] text-white/25 cursor-not-allowed"
              }`}
            >
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${
                step === s.n ? "bg-[#E8C468] text-black" : "bg-white/10 text-white/60"
              }`}>{s.n}</span>
              {s.icon}
              {s.label}
            </button>
            {i < steps.length - 1 && <ChevronRight className="h-4 w-4 text-white/20" />}
          </div>
        ))}
      </div>

      {/* ════════════ STEP 1 — GENERATE ════════════ */}
      {step === 1 && (
        <div className="space-y-5">
          {keyReady === false && (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
              <Ban className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-red-300">{t("captionSuite.keyMissingTitle")}</p>
                <p className="text-xs text-red-200/70 mt-1">{t("captionSuite.keyMissingBody")}</p>
              </div>
            </div>
          )}

          <Field label={t("captionSuite.sourceLabel")} hint={t("captionSuite.sourceHint")}>
            <Segmented
              value={sourceMode}
              onChange={(v) => { setSourceMode(v); setVideoUrl(null); setFile(null); }}
              options={[
                { value: "timeline", label: t("captionSuite.sourceTimeline") },
                { value: "upload", label: t("captionSuite.sourceUpload") },
              ]}
            />
          </Field>

          {sourceMode === "timeline" ? (
            timelineVideos.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {timelineVideos.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => { setTimelineId(v.id); setVideoUrl(null); }}
                    data-testid={`caption-suite-video-${v.id}`}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                      timelineId === v.id
                        ? "border-[#E8C468] bg-[#E8C468]/10"
                        : "border-white/10 bg-white/[0.02] hover:border-white/25"
                    }`}
                  >
                    <Film className={`h-5 w-5 shrink-0 ${timelineId === v.id ? "text-[#E8C468]" : "text-white/40"}`} />
                    <span className="text-xs font-bold text-white/80 truncate">{v.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/40 rounded-xl border border-dashed border-white/15 p-4">
                {t("captionSuite.noTimelineVideos")}
              </p>
            )
          ) : (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setVideoUrl(null); }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f && f.type.startsWith("video/")) { setFile(f); setVideoUrl(null); }
                }}
                className="w-full rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center hover:border-[#E8C468]/50 transition-colors"
              >
                <Upload className="h-6 w-6 text-[#E8C468] mx-auto mb-2" />
                <p className="text-sm font-bold text-white/80">
                  {file ? file.name : t("captionSuite.dropHint")}
                </p>
                <p className="text-[11px] text-white/35 mt-1">{t("captionSuite.dropSub")}</p>
              </button>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <Button
              type="button"
              disabled={genStatus === "working" || genStatus === "uploading" || keyReady === false}
              onClick={handleGenerate}
              data-testid="caption-suite-generate"
              className="bg-[#E8C468] text-black font-black hover:bg-[#f0d47e]"
            >
              {(genStatus === "working" || genStatus === "uploading") ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{genStatus === "uploading" ? t("captionSuite.uploading") : t("captionSuite.generating")}</>
              ) : (
                <><Wand2 className="h-4 w-4 mr-2" />{t("captionSuite.generateBtn")}</>
              )}
            </Button>
            <span className="text-[11px] text-white/40 font-bold uppercase tracking-wider">
              {t("captionSuite.generateCost")}
            </span>
            {(genStatus === "working" || genStatus === "uploading") && (
              <span className="ml-auto flex items-center gap-2 text-xs text-white/50 font-mono">
                <Clock3 className="h-4 w-4" />{fmtElapsed(genElapsed)}
              </span>
            )}
          </div>

          {(genStatus === "working" || genStatus === "uploading") && (
            <div className="rounded-xl border border-[#E8C468]/25 bg-[#E8C468]/[0.06] p-4 space-y-3">
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full w-1/3 rounded-full bg-[#E8C468] animate-[captionSlide_1.6s_ease-in-out_infinite]" />
              </div>
              <p className="text-xs text-white/60">{GEN_TIPS[genTipIdx]}</p>
              <p className="text-[11px] text-white/30">{t("captionSuite.keepTabOpen")}</p>
            </div>
          )}

          {genStatus === "error" && genError && (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
              <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-bold text-red-300">{t("captionSuite.generateFailedTitle")}</p>
                <p className="text-xs text-red-200/70 mt-1">{genError}</p>
                <p className="text-[11px] text-red-200/50 mt-1">{t("captionSuite.refundNote")}</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={handleGenerate}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />{t("captionSuite.retry")}
              </Button>
            </div>
          )}

          {lines.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs font-black uppercase tracking-widest text-white/50">
                  {t("captionSuite.transcriptTitle", { count: lines.length })}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button" variant="outline" size="sm"
                    onClick={() => handlePushToTimeline(lines)}
                    data-testid="caption-suite-push-timeline"
                  >
                    {pushed ? <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-green-400" /> : null}
                    {pushed ? t("captionSuite.pushed") : t("captionSuite.pushToTimeline")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={addLine}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" />{t("captionSuite.addLine")}
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-white/35">{t("captionSuite.editHint")}</p>
              <div className="max-h-72 overflow-y-auto space-y-2 rounded-xl border border-white/[0.07] bg-black/30 p-3">
                {lines.map((l) => (
                  <div key={l.id} className="flex items-center gap-2">
                    <input
                      type="number" step="0.1" min="0" value={l.start}
                      onChange={(e) => updateLine(l.id, { start: Number(e.target.value) || 0 })}
                      className="w-16 shrink-0 bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white/70 font-mono"
                      aria-label={t("captionSuite.startLabel")}
                    />
                    <input
                      type="number" step="0.1" min="0" value={l.end}
                      onChange={(e) => updateLine(l.id, { end: Number(e.target.value) || 0 })}
                      className="w-16 shrink-0 bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white/70 font-mono"
                      aria-label={t("captionSuite.endLabel")}
                    />
                    <input
                      type="text" value={l.text}
                      onChange={(e) => updateLine(l.id, { text: e.target.value })}
                      placeholder={t("captionSuite.linePlaceholder")}
                      className="flex-1 min-w-0 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white/85 placeholder:text-white/25 focus:outline-none focus:border-[#E8C468]/50"
                    />
                    {l.id === "endcard" && (
                      <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-black bg-[#E8C468] rounded-full px-2 py-0.5">
                        {t("captionSuite.brandBadge")}
                      </span>
                    )}
                    {l.words.length > 0 && (
                      <span className="hidden sm:inline text-[10px] text-[#E8C468]/70 font-bold shrink-0" title={t("captionSuite.wordTimedTitle")}>
                        {l.words.length}w
                      </span>
                    )}
                    <button
                      type="button" onClick={() => deleteLine(l.id)}
                      className="text-white/30 hover:text-red-400 transition-colors shrink-0"
                      aria-label={t("captionSuite.deleteLine")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-end">
                <Button type="button" onClick={() => setStep(2)} className="bg-[#E8C468] text-black font-black hover:bg-[#f0d47e]">
                  {t("captionSuite.toStyle")}<ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {/* ════════════ STEP 2 — STYLE ════════════ */}
      {step === 2 && (
        <div className="space-y-5">
          {!step2Unlocked ? (
            <div className="rounded-xl border border-dashed border-white/15 p-6 text-center">
              <Wand2 className="h-6 w-6 text-white/25 mx-auto mb-2" />
              <p className="text-sm text-white/50">{t("captionSuite.lockedStep2")}</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setStep(1)}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />{t("captionSuite.backToGenerate")}
              </Button>
            </div>
          ) : (
            <>
              <Field label={t("captionSuite.burnModeLabel")} hint={t("captionSuite.burnModeHint", { cost: burnCost })}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setBurnMode("wordsync")}
                    data-testid="caption-suite-mode-wordsync"
                    className={`rounded-xl border p-3.5 text-left transition-colors ${
                      burnMode === "wordsync" ? "border-[#E8C468] bg-[#E8C468]/10" : "border-white/10 bg-white/[0.02] hover:border-white/25"
                    }`}
                  >
                    <p className="text-sm font-black text-white flex items-center gap-2">
                      <Sparkles className={`h-4 w-4 ${burnMode === "wordsync" ? "text-[#E8C468]" : "text-white/40"}`} />
                      {t("captionSuite.modeWordsync")}
                    </p>
                    <p className="text-[11px] text-white/45 mt-1">{t("captionSuite.modeWordsyncDesc")}</p>
                    <p className="text-[11px] font-bold text-[#E8C468] mt-1.5">300 {t("captionSuite.credits")}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBurnMode("transcript")}
                    data-testid="caption-suite-mode-transcript"
                    className={`rounded-xl border p-3.5 text-left transition-colors ${
                      burnMode === "transcript" ? "border-[#E8C468] bg-[#E8C468]/10" : "border-white/10 bg-white/[0.02] hover:border-white/25"
                    }`}
                  >
                    <p className="text-sm font-black text-white flex items-center gap-2">
                      <Type className={`h-4 w-4 ${burnMode === "transcript" ? "text-[#E8C468]" : "text-white/40"}`} />
                      {t("captionSuite.modeTranscript")}
                    </p>
                    <p className="text-[11px] text-white/45 mt-1">{t("captionSuite.modeTranscriptDesc")}</p>
                    <p className="text-[11px] font-bold text-[#E8C468] mt-1.5">200 {t("captionSuite.credits")}</p>
                  </button>
                </div>
              </Field>

              <Field label={t("captionSuite.styleLabel")} hint={t("captionSuite.styleHint")}>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {styleCatalog.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setStyleKey(s.key)}
                      data-testid={`caption-suite-style-${s.key}`}
                      title={s.blurb}
                      className={`rounded-xl border p-3 text-left transition-colors ${
                        styleKey === s.key ? "border-[#E8C468] bg-[#E8C468]/10" : "border-white/10 bg-white/[0.02] hover:border-white/25"
                      }`}
                    >
                      <p className={`text-xs font-black ${styleKey === s.key ? "text-[#E8C468]" : "text-white/80"}`}>{s.label}</p>
                      <p className="text-[10px] text-white/40 mt-1 leading-snug">{s.blurb}</p>
                    </button>
                  ))}
                </div>
              </Field>

              {burnMode === "wordsync" && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field label={t("captionSuite.positionLabel")}>
                    <Segmented
                      value={position}
                      onChange={setPosition}
                      options={[
                        { value: "top", label: t("captionSuite.posTop") },
                        { value: "middle", label: t("captionSuite.posMiddle") },
                        { value: "bottom", label: t("captionSuite.posBottom") },
                      ]}
                    />
                  </Field>
                  <Field label={t("captionSuite.sizeLabel")}>
                    <Segmented
                      value={fontSize}
                      onChange={setFontSize}
                      options={[
                        { value: "small", label: t("captionSuite.sizeSmall") },
                        { value: "medium", label: t("captionSuite.sizeMedium") },
                        { value: "large", label: t("captionSuite.sizeLarge") },
                      ]}
                    />
                  </Field>
                  <Field label={t("captionSuite.emojiLabel")} hint={t("captionSuite.emojiHint")}>
                    <div className="flex items-center gap-2 pt-1">
                      <Switch checked={withEmoji} onCheckedChange={setWithEmoji} />
                      <span className="text-xs text-white/50">{withEmoji ? t("common.on") : t("common.off")}</span>
                    </div>
                  </Field>
                </div>
              )}

              {/* Branded end-card — the viral loop. Default ON. Burns into
                  transcript-mode exports; ships in SRT/VTT; translated in step 3. */}
              <div className="flex items-start gap-3 rounded-xl border border-[#E8C468]/25 bg-[#E8C468]/[0.05] p-4">
                <Switch checked={endCard} onCheckedChange={toggleEndCard} data-testid="caption-suite-endcard" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-white">{t("captionSuite.endCardLabel")}</p>
                  <p className="text-[11px] text-white/45 mt-0.5">{t("captionSuite.endCardDesc")}</p>
                  {burnMode === "wordsync" && endCard && (
                    <p className="text-[11px] text-[#E8C468]/80 mt-1">{t("captionSuite.endCardWordsyncNote")}</p>
                  )}
                </div>
              </div>

              {/* Live style preview — original video with the chosen style overlaid in sync */}
              {videoUrl && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-white/45 uppercase tracking-widest">{t("captionSuite.previewLabel")}</p>
                  <div className="relative rounded-xl overflow-hidden border border-white/10 bg-black max-w-md">
                    <video
                      src={burnResultUrl ?? videoUrl}
                      controls
                      playsInline
                      className="w-full aspect-video"
                      onTimeUpdate={(e) => setPreviewTime(e.currentTarget.currentTime)}
                      onLoadedMetadata={(e) => setVideoDuration(e.currentTarget.duration || null)}
                    />
                    {!burnResultUrl && activeLine && (
                      <div className={`absolute inset-x-0 ${previewPosClass} pointer-events-none flex justify-center px-4`}>
                        <p className={`text-center leading-snug ${previewStyleClass} ${activeLine.id === "endcard" ? "bg-black/70 px-4 py-1.5 rounded-xl border border-[#E8C468]/40" : ""}`}>
                          {activeLine.words.length > 0
                            ? activeLine.words.map((w, i) => (
                                <span key={i} className={previewTime >= w.start && previewTime <= w.end ? "text-[#FFD700]" : undefined}>
                                  {w.word}{i < activeLine.words.length - 1 ? " " : ""}
                                </span>
                              ))
                            : activeLine.text}
                        </p>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-white/30">{t("captionSuite.previewHint")}</p>
                </div>
              )}

              <div className="flex items-center gap-3 flex-wrap">
                <Button
                  type="button"
                  disabled={burnStatus === "working"}
                  onClick={handleBurn}
                  data-testid="caption-suite-burn"
                  className="bg-[#E8C468] text-black font-black hover:bg-[#f0d47e]"
                >
                  {burnStatus === "working" ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t("captionSuite.burning")}</>
                  ) : (
                    <><Palette className="h-4 w-4 mr-2" />{t("captionSuite.burnBtn", { cost: burnCost })}</>
                  )}
                </Button>
                {burnMode === "wordsync" && burnJobStatus && burnStatus === "working" && (
                  <span className="text-xs font-bold text-[#E8C468] uppercase tracking-wider flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t(`captionSuite.job_${burnJobStatus}`, { defaultValue: burnJobStatus })}
                  </span>
                )}
              </div>

              {burnStatus === "error" && burnError && (
                <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                  <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-red-300">{t("captionSuite.burnFailedTitle")}</p>
                    <p className="text-xs text-red-200/70 mt-1">{burnError}</p>
                    <p className="text-[11px] text-red-200/50 mt-1">{t("captionSuite.refundNote")}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={handleBurn}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />{t("captionSuite.retry")}
                  </Button>
                </div>
              )}

              {burnStatus === "done" && burnResultUrl && (
                <div className="rounded-xl border border-green-500/25 bg-green-500/[0.07] p-4 space-y-3">
                  <p className="text-sm font-bold text-green-300 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />{t("captionSuite.burnDone")}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button type="button" variant="outline" size="sm" asChild>
                      <a href={burnResultUrl} download target="_blank" rel="noreferrer">
                        <Download className="h-3.5 w-3.5 mr-1.5" />{t("captionSuite.downloadVideo")}
                      </a>
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => downloadTextFile("captions.srt", buildSrt(lines), "text/plain")}>
                      <Download className="h-3.5 w-3.5 mr-1.5" />SRT
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => downloadTextFile("captions.vtt", buildVtt(lines), "text/vtt")}>
                      <Download className="h-3.5 w-3.5 mr-1.5" />VTT
                    </Button>
                    <Button type="button" onClick={() => setStep(3)} className="bg-[#E8C468] text-black font-black hover:bg-[#f0d47e]" size="sm">
                      {t("captionSuite.toTranslate")}<ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                    </Button>
                  </div>

                  {/* ── Virality: one-click share of the finished clip ── */}
                  <div className="pt-3 border-t border-white/[0.07] space-y-2">
                    <p className="text-[10px] font-black text-white/45 uppercase tracking-widest">{t("captionSuite.shareTitle")}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button type="button" size="sm" onClick={handleNativeShare} className="bg-[#E8C468] text-black font-black hover:bg-[#f0d47e]">
                        {t("captionSuite.shareBtn")}
                      </Button>
                      {(["x", "facebook", "whatsapp", "telegram"] as const).map((net) => (
                        <Button key={net} type="button" variant="outline" size="sm" asChild>
                          <a href={socialShareHref(net)} target="_blank" rel="noreferrer">
                            {t(`captionSuite.share_${net}`)}
                          </a>
                        </Button>
                      ))}
                      <Button type="button" variant="outline" size="sm" onClick={handleCopyLink}>
                        {shared ? <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-green-400" /> : null}
                        {shared ? t("captionSuite.copied") : t("captionSuite.copyLink")}
                      </Button>
                    </div>
                  </div>

                  <div className="pt-1 border-t border-white/[0.07]">
                    <p className="text-[10px] font-black text-white/45 uppercase tracking-widest mb-2">{t("captionSuite.handoffTitle")}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button type="button" variant="outline" size="sm" asChild>
                        <a href={`/thumbnail-maker?video=${encodeURIComponent(burnResultUrl)}`}>
                          <ImageIcon className="h-3.5 w-3.5 mr-1.5" />{t("captionSuite.handoffThumb")}
                        </a>
                      </Button>
                      <Button type="button" variant="outline" size="sm" asChild>
                        <a href={`/scheduler?video=${encodeURIComponent(burnResultUrl)}`}>
                          <CalendarClock className="h-3.5 w-3.5 mr-1.5" />{t("captionSuite.handoffScheduler")}
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {/* ════════════ STEP 3 — TRANSLATE ════════════ */}
      {step === 3 && (
        <div className="space-y-5">
          {!step3Unlocked ? (
            <div className="rounded-xl border border-dashed border-white/15 p-6 text-center">
              <Languages className="h-6 w-6 text-white/25 mx-auto mb-2" />
              <p className="text-sm text-white/50">{t("captionSuite.lockedStep3")}</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setStep(step2Unlocked ? 2 : 1)}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />{t("captionSuite.backToStyle")}
              </Button>
            </div>
          ) : (
            <>
              <Field label={t("captionSuite.langLabel")} hint={t("captionSuite.langHint", { cost: translateCost })}>
                <div className="flex flex-wrap gap-2">
                  {LANGUAGES.map((l) => (
                    <Chip
                      key={l.code}
                      active={langs.includes(l.code)}
                      onClick={() => toggleLang(l.code)}
                    >
                      {l.label}
                    </Chip>
                  ))}
                </div>
              </Field>

              <div className="flex items-center gap-3 flex-wrap">
                <Button
                  type="button"
                  disabled={translateStatus === "working" || langs.length === 0}
                  onClick={handleTranslate}
                  data-testid="caption-suite-translate"
                  className="bg-[#E8C468] text-black font-black hover:bg-[#f0d47e]"
                >
                  {translateStatus === "working" ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t("captionSuite.translating")}</>
                  ) : (
                    <><Languages className="h-4 w-4 mr-2" />{t("captionSuite.translateBtn", { cost: translateCost, n: langs.length, langWord: langs.length === 1 ? t("captionSuite.oneLanguage") : t("captionSuite.manyLanguages") })}</>
                  )}
                </Button>
              </div>

              {translateStatus === "error" && translateError && (
                <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                  <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-red-300">{t("captionSuite.translateFailedTitle")}</p>
                    <p className="text-xs text-red-200/70 mt-1">{translateError}</p>
                    <p className="text-[11px] text-red-200/50 mt-1">{t("captionSuite.refundNote")}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={handleTranslate}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />{t("captionSuite.retry")}
                  </Button>
                </div>
              )}

              {Object.keys(translations).length > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(translations).map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setActiveLang(code)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
                          activeLang === code
                            ? "border-[#E8C468] bg-[#E8C468]/15 text-[#E8C468]"
                            : "border-white/10 text-white/50 hover:text-white"
                        }`}
                      >
                        {LANGUAGES.find((l) => l.code === code)?.label ?? code}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-xs font-black uppercase tracking-widest text-white/50">
                      {t("captionSuite.translatedTitle", { lang: activeLangLabel, count: activeTranslated.length })}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button" variant="outline" size="sm"
                        onClick={() => downloadTextFile(`captions-${activeLang}.srt`, buildSrt(activeTranslated), "text/plain")}
                      >
                        <Download className="h-3.5 w-3.5 mr-1.5" />SRT
                      </Button>
                      <Button
                        type="button" variant="outline" size="sm"
                        onClick={() => downloadTextFile(`captions-${activeLang}.vtt`, buildVtt(activeTranslated), "text/vtt")}
                      >
                        <Download className="h-3.5 w-3.5 mr-1.5" />VTT
                      </Button>
                      <Button
                        type="button" variant="outline" size="sm"
                        onClick={() => handlePushToTimeline(activeTranslated)}
                      >
                        {t("captionSuite.pushLangToTimeline")}
                      </Button>
                    </div>
                  </div>

                  <div className="max-h-72 overflow-y-auto space-y-2 rounded-xl border border-white/[0.07] bg-black/30 p-3">
                    {activeTranslated.map((l) => (
                      <div key={l.id} className="flex items-center gap-2">
                        <span className="w-32 shrink-0 text-[11px] text-white/35 font-mono truncate">
                          {l.start.toFixed(1)}s → {l.end.toFixed(1)}s
                        </span>
                        <input
                          type="text" value={l.text}
                          onChange={(e) => updateTranslatedLine(activeLang, l.id, e.target.value)}
                          className="flex-1 min-w-0 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white/85 focus:outline-none focus:border-[#E8C468]/50"
                        />
                      </div>
                    ))}
                  </div>

                  {burnResultUrl && (
                    <div className="rounded-xl border border-[#E8C468]/25 bg-[#E8C468]/[0.05] p-4 space-y-2">
                      <p className="text-[10px] font-black text-white/45 uppercase tracking-widest">{t("captionSuite.shareTitle")}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button type="button" size="sm" onClick={handleNativeShare} className="bg-[#E8C468] text-black font-black hover:bg-[#f0d47e]">
                          {t("captionSuite.shareBtn")}
                        </Button>
                        {(["x", "facebook", "whatsapp", "telegram"] as const).map((net) => (
                          <Button key={net} type="button" variant="outline" size="sm" asChild>
                            <a href={socialShareHref(net)} target="_blank" rel="noreferrer">
                              {t(`captionSuite.share_${net}`)}
                            </a>
                          </Button>
                        ))}
                        <Button type="button" variant="outline" size="sm" onClick={handleCopyLink}>
                          {shared ? <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-green-400" /> : null}
                          {shared ? t("captionSuite.copied") : t("captionSuite.copyLink")}
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap pt-1">
                        <Button type="button" variant="outline" size="sm" asChild>
                          <a href={`/thumbnail-maker?video=${encodeURIComponent(burnResultUrl)}`}>
                            <ImageIcon className="h-3.5 w-3.5 mr-1.5" />{t("captionSuite.handoffThumb")}
                          </a>
                        </Button>
                        <Button type="button" variant="outline" size="sm" asChild>
                          <a href={`/scheduler?video=${encodeURIComponent(burnResultUrl)}`}>
                            <CalendarClock className="h-3.5 w-3.5 mr-1.5" />{t("captionSuite.handoffScheduler")}
                          </a>
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <style>{`@keyframes captionSlide { 0% { margin-left: 0; } 50% { margin-left: 66%; } 100% { margin-left: 0; } }`}</style>
    </EditorCard>
  );
}
