import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2, X, AudioWaveform, Play, Pause, Download, AlertCircle,
  CheckCircle2, Info, Music4, ArrowUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import { useHubProject } from "@/lib/hub-project";

/* ─── VocalPolishModal ──────────────────────────────────────────────────
   Suno-parity vocal finishing, docked inside Song Maker results and the
   audio post chain (no new page, no new sidebar item).

   Gentle tuning nudge (auto-detected global drift toward the nearest
   semitone, strength-scaled) + key shift + tempo shift, all rendered
   server-side with ffmpeg (rubberband when available).

   Honest by design: the nudge corrects average drift, not individual
   sour notes — the copy says so, plainly.

   After a polish the result chains into:
     → Use in song     (hub asset — becomes the song the chain sees)
     → Send to Mix & Master (deep link with ?audioUrl=)
     → Download        (polished MP3) */

export interface VocalPolishSource {
  /** Must be a real URL (not blob:) — the server downloads it for processing. */
  audioUrl: string;
  title: string;
  artistName?: string;
}

interface VocalPolishModalProps {
  open: boolean;
  onClose: () => void;
  source: VocalPolishSource | null;
  onPolished?: (outputUrl: string) => void;
}

type Phase = "form" | "generating" | "done";

interface PolishJobResponse {
  jobId?: string;
  status?: string;
  outputUrl?: string | null;
  detectedTuningCents?: number | null;
  tuningAppliedCents?: number;
  tuningSkipped?: boolean;
  filterPath?: "rubberband" | "fallback" | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

const CREDIT_COST = 200;

export function VocalPolishModal({ open, onClose, source, onPolished }: VocalPolishModalProps) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();
  const { addAsset } = useHubProject();
  const overlayRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const [phase, setPhase] = useState<Phase>("form");
  const [strength, setStrength] = useState(35);
  const [keyShift, setKeyShift] = useState(0);
  const [tempoPct, setTempoPct] = useState(100);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>("queued");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [detectedCents, setDetectedCents] = useState<number | null>(null);
  const [appliedCents, setAppliedCents] = useState<number>(0);
  const [tuningSkipped, setTuningSkipped] = useState(false);
  const [filterPath, setFilterPath] = useState<"rubberband" | "fallback" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [ab, setAb] = useState<"original" | "polished">("polished");
  const [playing, setPlaying] = useState(false);
  const [usedInSong, setUsedInSong] = useState(false);

  // Reset when opened for a new source.
  useEffect(() => {
    if (open && source) {
      setPhase("form");
      setStrength(35);
      setKeyShift(0);
      setTempoPct(100);
      setJobId(null);
      setOutputUrl(null);
      setError(null);
      setOutOfCredits(false);
      setAb("polished");
      setPlaying(false);
      setUsedInSong(false);
    }
  }, [open, source?.audioUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup polling on unmount/close.
  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  if (!open || !source) return null;

  async function startPolish() {
    setError(null);
    setOutOfCredits(false);
    setPhase("generating");
    setJobStatus("queued");
    try {
      const res = await confirmedFetch("/api/vocal-polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioUrl: source!.audioUrl,
          correctionStrength: strength,
          keyShift,
          tempoFactor: tempoPct / 100,
        }),
      });
      if (!res) {
        // User cancelled the credit confirmation.
        setPhase("form");
        return;
      }
      const data: PolishJobResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setPhase("form");
        return;
      }
      if (!res.ok || !data.jobId) {
        setPhase("form");
        setError(data.message || data.error || t("vocalPolish.errorStartFailed"));
        return;
      }
      setJobId(data.jobId);
      setJobStatus(data.status ?? "queued");
      pollRef.current = window.setInterval(() => void pollJob(data.jobId!), 3000);
    } catch {
      setPhase("form");
      setError(t("vocalPolish.errorNetwork"));
    }
  }

  async function pollJob(id: string) {
    try {
      const res = await fetch(`/api/vocal-polish/${id}`);
      const data: PolishJobResponse = await res.json();
      if (!res.ok) {
        stopPolling();
        setPhase("form");
        setError(data.error || t("vocalPolish.errorJobNotFound"));
        return;
      }
      setJobStatus(data.status ?? "processing");
      if (data.status === "done" && data.outputUrl) {
        stopPolling();
        setOutputUrl(data.outputUrl);
        setDetectedCents(typeof data.detectedTuningCents === "number" ? data.detectedTuningCents : null);
        setAppliedCents(typeof data.tuningAppliedCents === "number" ? data.tuningAppliedCents : 0);
        setTuningSkipped(data.tuningSkipped === true);
        setFilterPath(data.filterPath ?? null);
        setPhase("done");
        setAb("polished");
      } else if (data.status === "failed") {
        stopPolling();
        setPhase("form");
        setError(data.error || t("vocalPolish.errorJobFailed", { cost: CREDIT_COST }));
      }
    } catch {
      /* keep polling on transient network errors */
    }
  }

  function stopPolling() {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function flipAb(side: "original" | "polished") {
    const el = audioRef.current;
    const tcur = el ? el.currentTime : 0;
    const wasPlaying = playing;
    setAb(side);
    requestAnimationFrame(() => {
      const next = audioRef.current;
      if (!next) return;
      next.currentTime = tcur;
      if (wasPlaying) void next.play().catch(() => {});
    });
  }

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }

  function handleUseInSong() {
    if (!outputUrl) return;
    addAsset({
      kind: "song",
      url: outputUrl,
      label: `${source!.title} — vocal polish`,
      detail: "VocalPolish output",
    });
    setUsedInSong(true);
    onPolished?.(outputUrl);
    toast({
      title: t("vocalPolish.useInSong"),
      description: t("vocalPolish.useInSongHint"),
    });
  }

  function handleSendToMixMaster() {
    if (!outputUrl) return;
    window.location.href = `/mix-master?audioUrl=${encodeURIComponent(outputUrl)}`;
  }

  function reset() {
    stopPolling();
    setPhase("form");
    setJobId(null);
    setOutputUrl(null);
    setError(null);
    setOutOfCredits(false);
    setAb("polished");
    setPlaying(false);
    setUsedInSong(false);
  }

  const keyLabel = keyShift === 0 ? "±0" : `${keyShift > 0 ? "+" : ""}${keyShift}`;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-6"
      onClick={(e) => { if (e.target === overlayRef.current && phase !== "generating") onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={t("vocalPolish.title")}
    >
      <div className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-[#0a0a0a] border border-primary/25 shadow-[0_0_60px_-10px_rgba(255,200,60,0.25)]">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 bg-[#0a0a0a]/95 backdrop-blur border-b border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
              <AudioWaveform className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">{t("vocalPolish.title")}</p>
              <p className="text-xs text-white/40 truncate">“{source.title}” · {t("vocalPolish.buttonCost")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === "generating"}
            className="rounded-lg p-2 text-white/50 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
            aria-label={t("vocalPolish.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {/* Honest framing — no "perfect vocals" claims */}
          <div className="flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
            <p className="text-xs text-white/55 leading-relaxed">
              {t("vocalPolish.honestIntro")}{" "}
              <span className="text-white/80 font-semibold">{t("vocalPolish.honestStrong")}</span>{" "}
              {t("vocalPolish.honestMid")}{" "}
              <span className="text-white/80 font-semibold">{t("vocalPolish.honestEnd")}</span>
            </p>
          </div>

          {outOfCredits && (
            <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-300">
                Not enough Visual Bucs for vocal polish ({CREDIT_COST}). Top up your balance to keep creating.
              </p>
            </div>
          )}
          {error && (
            <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {phase === "form" && (
            <div className="space-y-5">
              {/* Tuning nudge */}
              <div data-min-stars="2">
                <label className="flex items-center justify-between text-sm font-medium text-white/70 mb-1.5">
                  <span>{t("vocalPolish.strengthLabel")}</span>
                  <span className="text-primary font-bold">{t("vocalPolish.strengthValue", { n: strength })}</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={strength}
                  onChange={(e) => setStrength(Number(e.target.value))}
                  className="w-full accent-[#FFD700]"
                />
                <p className="text-[11px] text-white/30 mt-1">{t("vocalPolish.strengthHint")}</p>
              </div>

              {/* Key shift */}
              <div data-min-stars="2">
                <label className="flex items-center justify-between text-sm font-medium text-white/70 mb-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <Music4 className="h-4 w-4 text-white/40" /> {t("vocalPolish.keyShiftLabel")}
                  </span>
                  <span className="text-primary font-bold">{t("vocalPolish.keyShiftValue", { n: keyLabel })}</span>
                </label>
                <input
                  type="range"
                  min={-6}
                  max={6}
                  step={0.5}
                  value={keyShift}
                  onChange={(e) => setKeyShift(Number(e.target.value))}
                  className="w-full accent-[#FFD700]"
                />
                <div className="flex justify-between text-[11px] text-white/30">
                  <span>-6 st</span>
                  <span>original key</span>
                  <span>+6 st</span>
                </div>
                <p className="text-[11px] text-white/30 mt-1">{t("vocalPolish.keyShiftHint")}</p>
              </div>

              {/* Tempo */}
              <div data-min-stars="2">
                <label className="flex items-center justify-between text-sm font-medium text-white/70 mb-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <ArrowUpDown className="h-4 w-4 text-white/40" /> {t("vocalPolish.tempoLabel")}
                  </span>
                  <span className="text-primary font-bold">{t("vocalPolish.tempoValue", { n: tempoPct })}</span>
                </label>
                <input
                  type="range"
                  min={80}
                  max={120}
                  step={1}
                  value={tempoPct}
                  onChange={(e) => setTempoPct(Number(e.target.value))}
                  className="w-full accent-[#FFD700]"
                />
                <div className="flex justify-between text-[11px] text-white/30">
                  <span>80% slower</span>
                  <span>original</span>
                  <span>120% faster</span>
                </div>
                <p className="text-[11px] text-white/30 mt-1">{t("vocalPolish.tempoHint")}</p>
              </div>

              <p className="text-[11px] text-white/35 leading-relaxed">{t("vocalPolish.bestOnStems")}</p>

              <Button
                type="button"
                onClick={() => void startPolish()}
                className="w-full gold-glow font-bold text-base rounded-xl gap-2"
                style={{ height: "52px" }}
              >
                <AudioWaveform className="h-5 w-5" />
                {t("vocalPolish.polishButton", { cost: CREDIT_COST })}
              </Button>
            </div>
          )}

          {phase === "generating" && (
            <div className="py-10 flex flex-col items-center text-center gap-3">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-white font-semibold">
                {jobStatus === "queued" ? t("vocalPolish.statusQueued") : t("vocalPolish.statusProcessing")}
              </p>
              <p className="text-xs text-white/40 max-w-sm">{t("vocalPolish.progressNote")}</p>
            </div>
          )}

          {phase === "done" && outputUrl && (
            <div className="space-y-4">
              <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-white/80">{t("vocalPolish.completeTitle")}</p>
                  <p className="text-xs text-white/45 mt-0.5">
                    {tuningSkipped
                      ? t("vocalPolish.tuningSkipped")
                      : detectedCents != null && Math.abs(appliedCents) >= 0.5
                        ? t("vocalPolish.tuningDetail", {
                            cents: `${detectedCents > 0 ? "+" : ""}${detectedCents.toFixed(0)}`,
                            applied: `${appliedCents > 0 ? "+" : ""}${appliedCents.toFixed(0)}`,
                          })
                        : t("vocalPolish.tuningNone")}
                  </p>
                  {filterPath === "fallback" && (
                    <p className="text-[11px] text-amber-300/70 mt-1">{t("vocalPolish.fallbackNote")}</p>
                  )}
                </div>
              </div>

              {/* A/B toggle — position-preserving */}
              <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
                {(["original", "polished"] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    onClick={() => flipAb(side)}
                    className={`flex-1 rounded-lg px-4 py-2 text-sm font-bold transition ${
                      ab === side ? "bg-primary text-black" : "text-white/50 hover:text-white/80"
                    }`}
                  >
                    {side === "original" ? t("vocalPolish.abOriginal") : t("vocalPolish.abPolished")}
                  </button>
                ))}
              </div>

              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-black transition hover:brightness-110"
                    aria-label={playing ? "Pause" : "Play"}
                  >
                    {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
                  </button>
                  <div className="flex-1">
                    <p className="text-xs font-bold text-white/50 uppercase tracking-wider">
                      {ab === "original" ? t("vocalPolish.abOriginal") : t("vocalPolish.abPolished")}
                    </p>
                    <p className="text-xs text-white/35 mt-1 truncate">“{source.title}”</p>
                  </div>
                </div>
                <audio
                  ref={audioRef}
                  src={ab === "original" ? source.audioUrl : outputUrl}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  className="hidden"
                />
                <p className="text-xs text-white/35 text-center mt-3">{t("vocalPolish.abHint")}</p>
              </div>

              {/* Handoff chain */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleUseInSong}
                  disabled={usedInSong}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-sm font-bold text-black hover:brightness-110 transition-all disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {usedInSong ? "In your song ✓" : t("vocalPolish.useInSong")}
                </button>
                <button
                  type="button"
                  onClick={handleSendToMixMaster}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2.5 text-sm font-semibold text-white/80 hover:text-white hover:border-primary/50 hover:bg-primary/5 transition-all"
                >
                  <Music4 className="h-4 w-4" /> {t("vocalPolish.sendToMixMaster")}
                </button>
                <a
                  href={outputUrl}
                  download={`vocal-polish-${source.title.replace(/[^\w\-]+/g, "-").slice(0, 40)}.mp3`}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2.5 text-sm font-semibold text-white/80 hover:text-white hover:border-primary/50 hover:bg-primary/5 transition-all"
                >
                  <Download className="h-4 w-4" /> {t("vocalPolish.downloadButton")}
                </a>
                <button
                  type="button"
                  onClick={reset}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2.5 text-sm font-semibold text-white/80 hover:text-white hover:border-primary/50 hover:bg-primary/5 transition-all"
                >
                  {t("vocalPolish.newPolish")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
