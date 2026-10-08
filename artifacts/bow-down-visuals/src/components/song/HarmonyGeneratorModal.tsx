import { useEffect, useRef, useState } from "react";
import { Loader2, X, Users, Mic2, Palette, Link2, Check, AlertCircle, Download, SlidersHorizontal, Music4, Sparkles, Disc3 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { useHubProject } from "@/lib/hub-project";

/* ─── HarmonyGeneratorModal ─────────────────────────────────────────────────
   "Add harmonies" — AI Harmony Generator (Suno parity), docked inside Song
   Maker results next to Cover / Vocal Polish / Rework (no new page, no new
   sidebar item).

   Two engines, honestly labelled:
     - Classic doubles (300 VB, always on): pitch-preserving rubberband
       doubles of the SAME voice (third/fifth/octave up/down, full stack).
     - AI harmonies (600 VB, needs ELEVENLABS_API_KEY + HARMONY_VOICE_IDS):
       each part re-voiced into a distinct backing-singer voice via
       speech-to-speech. The UI never claims AI when serving classic.

   Result chains into: Mix into song · Download stems · Send to Mix & Master
   (?audioUrl= intake) · Lyric video · Cover art · Add to album · share.
   Harmonies are written to the hub project as song/stems assets. */

export interface HarmonySource {
  /** Library song id — becomes the harmony mix's parent_song_id. */
  songId?: string;
  title: string;
  /** Must be a real URL (not blob:) — the server downloads it to harmonize. */
  audioUrl: string;
  artistName?: string;
}

interface HarmonyGeneratorModalProps {
  open: boolean;
  onClose: () => void;
  source: HarmonySource | null;
  initialLyrics?: string;
}

interface HarmonyModeInfo {
  key: "classic" | "ai";
  label: string;
  blurb: string;
  cost: number;
  available: boolean;
  missing: string[];
}

interface HarmonyStyleInfo {
  key: string;
  label: string;
  blurb: string;
  parts: Array<{ key: string; label: string; semitones: number }>;
}

interface HarmonyStem {
  key: string;
  label: string;
  url: string;
}

interface HarmonyResult {
  song: { id: string; title: string; audio_url: string; source: string; parent_song_id: string | null; created_at: string };
  mixedPreviewUrl: string;
  stems: HarmonyStem[];
  harmonyMode: "ai" | "classic";
  modeNote: string;
  style: string;
  mixLevel: number;
  durationMs: number;
  creditsRemaining: number;
}

type Phase = "form" | "generating" | "done";

const MADE_WITH = "Made with Bow Down Visuals";

function formatLrcTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  const cs = Math.floor((totalSeconds % 1) * 100);
  return `[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}]`;
}

/** Evenly distribute lyric lines across the audio duration as LRC. */
function lyricsToLrc(lyrics: string, durationSec: number): string {
  const lines = lyrics
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^\[.*\]$/.test(l) && !/^(verse|chorus|hook|bridge|outro|intro|pre-chorus)/i.test(l));
  if (lines.length === 0) return "";
  const step = Math.max(durationSec / lines.length, 1);
  return lines.map((l, i) => `${formatLrcTime(1 + i * step)}${l}`).join("\n");
}

function audioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement("audio");
    el.preload = "metadata";
    el.onloadedmetadata = () => resolve(el.duration && isFinite(el.duration) ? el.duration : 180);
    el.onerror = () => resolve(180);
    el.src = url;
    setTimeout(() => resolve(180), 8000);
  });
}

export function HarmonyGeneratorModal({ open, onClose, source, initialLyrics = "" }: HarmonyGeneratorModalProps) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();
  const { addAsset } = useHubProject();
  const [modes, setModes] = useState<HarmonyModeInfo[]>([]);
  const [styles, setStyles] = useState<HarmonyStyleInfo[]>([]);
  const [mode, setMode] = useState<"classic" | "ai">("classic");
  const [style, setStyle] = useState<string>("stack");
  const [keyHint, setKeyHint] = useState("");
  const [mixLevel, setMixLevel] = useState(35);
  const [lyrics, setLyrics] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [result, setResult] = useState<HarmonyResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [mixedIntoSong, setMixedIntoSong] = useState(false);
  // Handoff state
  const [lyricBusy, setLyricBusy] = useState(false);
  const [lyricVideoUrl, setLyricVideoUrl] = useState<string | null>(null);
  const [lyricError, setLyricError] = useState<string | null>(null);
  const [artBusy, setArtBusy] = useState(false);
  const [artUrl, setArtUrl] = useState<string | null>(null);
  const [artError, setArtError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Reset + capability probe every time the modal opens.
  useEffect(() => {
    if (!open) return;
    setModes([]);
    setStyles([]);
    setMode("classic");
    setStyle("stack");
    setKeyHint("");
    setMixLevel(35);
    setLyrics(initialLyrics);
    setPhase("form");
    setError(null);
    setOutOfCredits(false);
    setAiUnavailable(false);
    setResult(null);
    setCopied(false);
    setMixedIntoSong(false);
    setLyricVideoUrl(null);
    setLyricError(null);
    setArtUrl(null);
    setArtError(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await confirmedFetch("/api/generate-harmony/modes", { skipConfirm: true });
        if (!res?.ok || cancelled) return;
        const data = (await res.json()) as {
          modes?: HarmonyModeInfo[];
          styles?: HarmonyStyleInfo[];
          defaultMode?: string;
          defaultStyle?: string;
          defaultMixLevel?: number;
        };
        if (cancelled) return;
        setModes(data.modes ?? []);
        setStyles(data.styles ?? []);
        // Preselect AI harmonies when the server has the voices wired; otherwise classic.
        const ai = data.modes?.find((m) => m.key === "ai");
        setMode(ai?.available ? "ai" : "classic");
        if (data.defaultStyle) setStyle(data.defaultStyle);
        if (typeof data.defaultMixLevel === "number") setMixLevel(data.defaultMixLevel);
      } catch {
        /* modes probe failing is non-fatal — server re-validates on generate */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const aiModeInfo = modes.find((m) => m.key === "ai");
  const classicCost = modes.find((m) => m.key === "classic")?.cost ?? 300;
  const aiCost = aiModeInfo?.cost ?? 600;
  const cost = mode === "ai" ? aiCost : classicCost;
  const canGenerate = phase === "form" && !!source?.audioUrl && !source.audioUrl.startsWith("blob:");

  async function handleGenerate(useMode: "classic" | "ai") {
    if (!source || !canGenerate) return;
    setPhase("generating");
    setError(null);
    setOutOfCredits(false);
    setAiUnavailable(false);
    try {
      const res = await confirmedFetch("/api/generate-harmony", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          songId: source.songId,
          audioUrl: source.audioUrl,
          keyHint: keyHint.trim() || undefined,
          style,
          mixLevel,
          mode: useMode,
        }),
        overrideCost: useMode === "ai" ? aiCost : classicCost,
        overrideFeature: t("harmony.confirmFeature", { mode: useMode === "ai" ? t("harmony.modeAiShort") : t("harmony.modeClassicShort") }),
      });
      if (!res) { setPhase("form"); return; } // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as HarmonyResult & { error?: string; code?: string; missing?: string[]; message?: string };
      if (res.status === 402) {
        setOutOfCredits(true);
        setPhase("form");
        return;
      }
      if (res.status === 503 && data.code?.includes("not_configured")) {
        // AI engine not wired on this server — honest, with a one-click classic fallback.
        setAiUnavailable(true);
        setError(data.error ?? t("harmony.aiNotConfigured"));
        setPhase("form");
        return;
      }
      if (!res.ok || !data.mixedPreviewUrl) {
        throw new Error(data.error ?? data.message ?? t("harmony.generateFailed"));
      }
      setResult(data);
      setPhase("done");
      // ── COHERENCE: harmonies write to the hub project. ──
      addAsset({
        kind: "song",
        url: data.mixedPreviewUrl,
        label: data.song.title,
        detail: t("harmony.hubMixDetail"),
        meta: { sourceAsset: source.title, handoff: "harmony", harmonyMode: data.harmonyMode },
      });
      for (const stem of data.stems) {
        addAsset({
          kind: "stems",
          url: stem.url,
          label: `${data.song.title} — ${stem.label}`,
          detail: t("harmony.hubStemDetail"),
          meta: { sourceAsset: source.title, handoff: "harmony", stemKey: stem.key },
        });
      }
      toast({ title: t("harmony.createdTitle"), description: t("harmony.createdDesc", { title: data.song.title }) });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("harmony.generateFailed"));
      setPhase("form");
    }
  }

  function handleMixIntoSong() {
    if (!result) return;
    // The mixed preview IS the source with the harmonies blended in at the
    // chosen level — this promotes it as the working version of the song.
    addAsset({
      kind: "song",
      url: result.mixedPreviewUrl,
      label: result.song.title,
      detail: t("harmony.mixedIntoSongDetail"),
      meta: { sourceAsset: source?.title ?? "", handoff: "harmony-mix-in" },
    });
    setMixedIntoSong(true);
    toast({ title: t("harmony.mixedIntoSongTitle"), description: t("harmony.mixedIntoSongDesc") });
  }

  async function handleLyricVideo() {
    if (!result || lyricBusy) return;
    if (!lyrics.trim()) {
      toast({ title: t("harmony.lyricsNeededTitle"), description: t("harmony.lyricsNeededDesc"), variant: "destructive" });
      return;
    }
    setLyricBusy(true);
    setLyricError(null);
    try {
      const duration = await audioDuration(result.mixedPreviewUrl);
      const lrc = lyricsToLrc(lyrics, duration);
      if (!lrc) throw new Error(t("harmony.lrcFailed"));
      const res = await confirmedFetch("/api/karaoke-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioUrl: result.mixedPreviewUrl,
          lrc,
          title: result.song.title,
          artist: source?.artistName ?? "",
          theme: "gold-luxury",
        }),
      });
      if (!res) return;
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || t("harmony.lyricVideoFailed"));
      setLyricVideoUrl(data.url);
    } catch (e) {
      setLyricError(e instanceof Error ? e.message : t("harmony.lyricVideoFailed"));
    } finally {
      setLyricBusy(false);
    }
  }

  async function handleCoverArt() {
    if (!result || artBusy) return;
    setArtBusy(true);
    setArtError(null);
    try {
      const res = await confirmedFetch("/api/cover-art", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          songTitle: result.song.title,
          artistName: source?.artistName?.trim() || t("harmony.unknownArtist"),
          mood: t("harmony.coverArtMood"),
        }),
      });
      if (!res) return;
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || t("harmony.coverArtFailed"));
      setArtUrl(data.url);
    } catch (e) {
      setArtError(e instanceof Error ? e.message : t("harmony.coverArtFailed"));
    } finally {
      setArtBusy(false);
    }
  }

  async function handleShare() {
    if (!result) return;
    let code = "";
    try {
      const res = await confirmedFetch("/api/referrals/me", { skipConfirm: true });
      if (res?.ok) {
        const data = (await res.json()) as { code?: string };
        if (data.code) code = data.code;
      }
    } catch {
      /* share works without the code too */
    }
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const link = code ? `${origin}/?ref=${encodeURIComponent(code)}` : `${origin}/`;
    const text = t("harmony.shareText", {
      title: result.song.title,
      mixUrl: result.mixedPreviewUrl,
      link,
      madeWith: MADE_WITH,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: t("harmony.shareCopiedTitle"), description: t("harmony.shareCopiedDesc") });
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast({ title: t("harmony.copyFailedTitle"), description: t("harmony.copyFailedDesc"), variant: "destructive" });
    }
  }

  if (!open) return null;
  const src = source ?? { title: "", audioUrl: "" };
  const selectedStyle = styles.find((s) => s.key === style);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-6"
      onClick={(e) => { if (e.target === overlayRef.current && phase !== "generating") onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={t("harmony.title")}
    >
      <div className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-[#0a0a0a] border border-primary/25 shadow-[0_0_60px_-10px_rgba(255,200,60,0.25)]">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 bg-[#0a0a0a]/95 backdrop-blur border-b border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
              <Users className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">{t("harmony.title")}</p>
              <p className="text-xs text-white/40 truncate">{t("harmony.subtitle", { title: src.title })}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === "generating"}
            className="rounded-lg p-2 text-white/50 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
            aria-label={t("harmony.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {phase !== "done" && (
            <>
              {/* Engine picker — honest labels */}
              <div>
                <p className="text-sm font-medium text-white/70 mb-2">{t("harmony.engineLabel")}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMode("classic")}
                    className={`text-left p-3.5 rounded-xl border transition-all ${
                      mode === "classic"
                        ? "bg-primary/10 border-primary/60"
                        : "bg-white/[0.03] border-white/10 hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-sm font-bold ${mode === "classic" ? "text-primary" : "text-white/80"}`}>
                        <Disc3 className="h-4 w-4 inline mr-1.5 -mt-0.5" />
                        {t("harmony.modeClassicLabel")}
                      </p>
                      <span className="text-[11px] font-bold text-primary whitespace-nowrap">{classicCost} {t("harmony.vb")}</span>
                    </div>
                    <p className="text-xs text-white/40 mt-1.5 leading-relaxed">{t("harmony.modeClassicBlurb")}</p>
                    <p className="text-[11px] text-emerald-400/90 font-semibold mt-1">{t("harmony.alwaysAvailable")}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("ai")}
                    className={`text-left p-3.5 rounded-xl border transition-all ${
                      mode === "ai"
                        ? "bg-primary/10 border-primary/60"
                        : "bg-white/[0.03] border-white/10 hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-sm font-bold ${mode === "ai" ? "text-primary" : "text-white/80"}`}>
                        <Sparkles className="h-4 w-4 inline mr-1.5 -mt-0.5" />
                        {t("harmony.modeAiLabel")}
                      </p>
                      <span className="text-[11px] font-bold text-primary whitespace-nowrap">{aiCost} {t("harmony.vb")}</span>
                    </div>
                    <p className="text-xs text-white/40 mt-1.5 leading-relaxed">{t("harmony.modeAiBlurb")}</p>
                    <p className={`text-[11px] font-semibold mt-1 ${aiModeInfo?.available === false ? "text-amber-400/90" : "text-white/30"}`}>
                      {aiModeInfo?.available === false ? t("harmony.aiNeedsSetup") : t("harmony.aiCheckNote")}
                    </p>
                  </button>
                </div>
              </div>

              {/* Harmony style */}
              <div>
                <p className="text-sm font-medium text-white/70 mb-2">{t("harmony.styleLabel")}</p>
                <div className="flex flex-wrap gap-2">
                  {styles.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setStyle(s.key)}
                      className={`px-4 py-2 rounded-lg text-sm transition-all border ${
                        style === s.key
                          ? "bg-primary/15 border-primary/60 text-primary font-semibold"
                          : "bg-white/5 border-white/10 text-white/70 hover:border-primary/40"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                  {styles.length === 0 && <p className="text-xs text-white/40">{t("harmony.loadingStyles")}</p>}
                </div>
                {selectedStyle && <p className="text-xs text-white/40 mt-2">{selectedStyle.blurb}</p>}
                {selectedStyle && selectedStyle.parts.length > 0 && (
                  <p className="text-[11px] text-white/30 mt-1">
                    {t("harmony.partsLine", { parts: selectedStyle.parts.map((p) => `${p.label} (${p.semitones > 0 ? "+" : ""}${p.semitones})`).join(" · ") })}
                  </p>
                )}
              </div>

              {/* Key hint + mix level */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1.5">
                    {t("harmony.keyHintLabel")} <span className="text-white/30 font-normal">{t("harmony.optional")}</span>
                  </label>
                  <input
                    value={keyHint}
                    onChange={(e) => setKeyHint(e.target.value.slice(0, 16))}
                    placeholder={t("harmony.keyHintPlaceholder")}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50"
                  />
                  <p className="text-[11px] text-white/30 mt-1">{t("harmony.keyHintHint")}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1.5">
                    {t("harmony.mixLabel")} <span className="text-primary font-bold">{mixLevel}%</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={mixLevel}
                    onChange={(e) => setMixLevel(Number(e.target.value))}
                    className="w-full accent-[#FFD700]"
                  />
                  <div className="flex justify-between text-[11px] text-white/30">
                    <span>{t("harmony.mixLow")}</span>
                    <span>{t("harmony.mixHigh")}</span>
                  </div>
                </div>
              </div>

              {/* Lyrics (for the lyric-video handoff) */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">
                  {t("harmony.lyricsLabel")} <span className="text-white/30 font-normal">{t("harmony.lyricsOptional")}</span>
                </label>
                <textarea
                  value={lyrics}
                  onChange={(e) => setLyrics(e.target.value)}
                  placeholder={t("harmony.lyricsPlaceholder")}
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50 resize-none"
                />
              </div>

              <Button
                type="button"
                onClick={() => void handleGenerate(mode)}
                disabled={!canGenerate}
                className="w-full gold-glow font-bold text-base rounded-xl gap-2"
                style={{ height: "52px" }}
              >
                <Users className="h-5 w-5" />
                {t("harmony.generateCta", { cost })}
              </Button>

              {!canGenerate && phase === "form" && (
                <p className="text-xs text-amber-400/80 text-center">{t("harmony.needAudio")}</p>
              )}

              {aiUnavailable && (
                <div className="p-4 rounded-xl border border-amber-500/25 bg-amber-500/5 flex flex-col gap-2.5">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-200/90">{t("harmony.aiNotConfigured")}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { setMode("classic"); void handleGenerate("classic"); }}
                    className="rounded-xl border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
                  >
                    {t("harmony.useClassicInstead", { cost: classicCost })}
                  </Button>
                </div>
              )}

              {outOfCredits && (
                <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-300">{t("harmony.outOfCredits", { cost })}</p>
                </div>
              )}
              {error && !aiUnavailable && (
                <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}
            </>
          )}

          {phase === "generating" && (
            <div className="py-10 flex flex-col items-center text-center gap-3">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-white font-semibold">{t("harmony.generating", { title: src.title })}</p>
              <p className="text-xs text-white/40 max-w-sm">
                {mode === "ai" ? t("harmony.generatingAiHint") : t("harmony.generatingClassicHint")}
              </p>
            </div>
          )}

          {phase === "done" && result && (
            <div className="space-y-4">
              <div className="rounded-xl border border-primary/30 bg-primary/[0.05] p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-sm font-bold text-white">{result.song.title}</p>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${
                    result.harmonyMode === "ai"
                      ? "border-primary/50 text-primary bg-primary/10"
                      : "border-white/20 text-white/50 bg-white/5"
                  }`}>
                    {result.harmonyMode === "ai" ? t("harmony.modeAiShort") : t("harmony.modeClassicShort")}
                  </span>
                </div>
                <audio controls src={result.mixedPreviewUrl} className="w-full h-9" />
                <p className="text-[11px] text-white/35 mt-2 leading-relaxed">{result.modeNote}</p>
                <p className="text-[11px] text-primary/80 font-semibold mt-1">{MADE_WITH}</p>
              </div>

              {/* Stems */}
              <div>
                <p className="text-sm font-medium text-white/70 mb-2">{t("harmony.stemsLabel")}</p>
                <div className="space-y-1.5">
                  {result.stems.map((stem) => (
                    <div key={stem.key} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                      <span className="text-xs text-white/70 font-medium truncate">{stem.label}</span>
                      <a
                        href={stem.url}
                        download={`${result.song.title} - ${stem.label}.mp3`}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-white transition-colors shrink-0"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t("harmony.download")}
                      </a>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-2">
                    <span className="text-xs text-white/80 font-bold truncate">{t("harmony.mixLabelShort")}</span>
                    <a
                      href={result.mixedPreviewUrl}
                      download={`${result.song.title} - Harmony Mix.mp3`}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-white transition-colors shrink-0"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t("harmony.download")}
                    </a>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleMixIntoSong}
                  disabled={mixedIntoSong}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-3 py-2.5 text-sm font-bold text-primary hover:bg-primary/20 transition-all disabled:opacity-60"
                >
                  {mixedIntoSong ? <Check className="h-4 w-4" /> : <Music4 className="h-4 w-4" />}
                  {mixedIntoSong ? t("harmony.mixedIn") : t("harmony.mixIntoSong")}
                </button>
                <Link
                  href={`/mix-master?audioUrl=${encodeURIComponent(result.mixedPreviewUrl)}`}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2.5 text-sm font-semibold text-white/80 hover:text-white hover:border-primary/50 hover:bg-primary/5 transition-all"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  {t("harmony.sendToMixMaster")}
                </Link>
                <button
                  type="button"
                  onClick={() => void handleLyricVideo()}
                  disabled={lyricBusy || !!lyricVideoUrl}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2.5 text-sm font-semibold text-white/80 hover:text-white hover:border-primary/50 hover:bg-primary/5 transition-all disabled:opacity-50"
                >
                  {lyricBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic2 className="h-4 w-4" />}
                  {lyricVideoUrl ? t("harmony.lyricVideoReady") : t("harmony.lyricVideo")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCoverArt()}
                  disabled={artBusy || !!artUrl}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2.5 text-sm font-semibold text-white/80 hover:text-white hover:border-primary/50 hover:bg-primary/5 transition-all disabled:opacity-50"
                >
                  {artBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Palette className="h-4 w-4" />}
                  {artUrl ? t("harmony.coverArtReady") : t("harmony.coverArt")}
                </button>
                <Link
                  href={`/songs?song=${encodeURIComponent(result.song.id)}&addToAlbum=1`}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2.5 text-sm font-semibold text-white/80 hover:text-white hover:border-primary/50 hover:bg-primary/5 transition-all"
                >
                  <Disc3 className="h-4 w-4" />
                  {t("harmony.addToAlbum")}
                </Link>
                <button
                  type="button"
                  onClick={() => void handleShare()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2.5 text-sm font-semibold text-white/80 hover:text-white hover:border-primary/50 hover:bg-primary/5 transition-all"
                >
                  {copied ? <Check className="h-4 w-4 text-green-400" /> : <Link2 className="h-4 w-4" />}
                  {copied ? t("harmony.copied") : t("harmony.share")}
                </button>
              </div>
              {lyricError && <p className="text-xs text-red-400">{lyricError}</p>}
              {artError && <p className="text-xs text-red-400">{artError}</p>}

              {lyricVideoUrl && (
                <div className="rounded-xl overflow-hidden border border-white/10">
                  <video controls src={lyricVideoUrl} className="w-full max-h-64 bg-black" />
                </div>
              )}
              {artUrl && (
                <div className="rounded-xl overflow-hidden border border-white/10">
                  <img src={artUrl} alt={t("harmony.coverArtAlt", { title: result.song.title })} className="w-full max-h-64 object-cover" />
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="w-full rounded-xl border-white/15 text-white/80"
              >
                {t("harmony.done")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
