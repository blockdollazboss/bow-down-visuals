import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2, X, Mic, Play, Pause, Download, AlertCircle,
  CheckCircle2, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import { useHubProject } from "@/lib/hub-project";

/* ─── SingingVoiceModal ─────────────────────────────────────────────
   Singing-voice conversion, docked inside the Song Maker results next to
   the other voice actions (Vocal Polish, Harmony). NOT a new page, no new
   sidebar item.

   The modal presents the singing voice as a VOICE CHOICE alongside the
   existing options: pick a voice from the catalog, convert the song's
   vocals into that singing timbre.

   Provider: Jammable-shaped conversion API. No key is configured yet —
   the voice list loads as placeholder samples and the convert CTA stays
   disabled with a clear message. Price is a PLACEHOLDER (800 VB) until the
   user approves the real price.

   After a conversion the result chains into:
     → Use in song     (hub asset — becomes the song the chain sees)
     → Download        (converted MP3) */

export interface SingingVoiceSource {
  /** Must be a real URL (not blob:) — the server sends it to the provider. */
  audioUrl: string;
  title: string;
  artistName?: string;
}

interface SingingVoiceModalProps {
  open: boolean;
  onClose: () => void;
  source: SingingVoiceSource | null;
  onConverted?: (outputUrl: string) => void;
}

type Phase = "form" | "generating" | "done";

interface SingingVoiceEntry {
  id: string;
  name: string;
  style: string;
}

interface ConvertResponse {
  jobId?: string;
  status?: string;
  outputUrl?: string | null;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

const CREDIT_COST = 800; // PLACEHOLDER — needs user price approval

export function SingingVoiceModal({ open, onClose, source, onConverted }: SingingVoiceModalProps) {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();
  const { addAsset } = useHubProject();
  const overlayRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const [phase, setPhase] = useState<Phase>("form");
  const [voices, setVoices] = useState<SingingVoiceEntry[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [strength, setStrength] = useState(70);
  const [keepInstrumental, setKeepInstrumental] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [checking, setChecking] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>("queued");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [ab, setAb] = useState<"original" | "converted">("converted");
  const [playing, setPlaying] = useState(false);
  const [usedInSong, setUsedInSong] = useState(false);

  // Reset when opened for a new source; load gate + catalog.
  useEffect(() => {
    if (open && source) {
      setPhase("form");
      setVoiceId("");
      setStrength(70);
      setKeepInstrumental(true);
      setJobId(null);
      setOutputUrl(null);
      setError(null);
      setOutOfCredits(false);
      setAb("converted");
      setPlaying(false);
      setUsedInSong(false);
      setChecking(true);
      (async () => {
        try {
          const [sRes, vRes] = await Promise.all([
            fetch("/api/singing-voice/status"),
            fetch("/api/singing-voice/voices"),
          ]);
          if (sRes.ok) {
            const s = (await sRes.json()) as { configured?: boolean };
            setConfigured(s.configured === true);
          }
          if (vRes.ok) {
            const v = (await vRes.json()) as { voices?: SingingVoiceEntry[] };
            setVoices(v.voices ?? []);
          }
        } catch {
          /* gate stays closed */
        } finally {
          setChecking(false);
        }
      })();
    }
  }, [open, source?.audioUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !source) return null;

  async function startConversion() {
    if (!voiceId || !configured) return;
    setPhase("generating");
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch("/api/singing-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voiceId,
          sourceAudioUrl: source!.audioUrl,
          strength,
          keepInstrumental,
        }),
        overrideCost: CREDIT_COST,
        overrideFeature: "Singing-Voice Conversion",
      });
      if (!res) { setPhase("form"); return; } // user cancelled the credit confirmation
      const data: ConvertResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        setPhase("form");
        return;
      }
      if (res.status === 503) {
        setError(data.message || t("singingVoice.notConfiguredError", { defaultValue: "Singing-voice conversion isn't connected yet." }));
        setPhase("form");
        return;
      }
      if (!res.ok || !data.jobId) throw new Error(data.message || data.error || "Conversion failed to start");
      setJobId(data.jobId);
      setJobStatus("queued");
      pollRef.current = window.setInterval(async () => {
        try {
          const pr = await fetch(`/api/singing-voice/jobs/${data.jobId}`);
          const pd: ConvertResponse = await pr.json();
          if (!pr.ok) return;
          if (pd.status === "done") {
            if (pollRef.current) window.clearInterval(pollRef.current);
            setJobStatus("done");
            setOutputUrl(pd.outputUrl ?? null);
            setPhase("done");
          } else if (pd.status === "failed") {
            if (pollRef.current) window.clearInterval(pollRef.current);
            setError(pd.error || t("singingVoice.failedRefunded", { defaultValue: "Conversion failed — credits refunded." }));
            setPhase("form");
          } else {
            setJobStatus(pd.status ?? "processing");
          }
        } catch {
          /* keep polling on transient errors */
        }
      }, 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("singingVoice.startFailed", { defaultValue: "Could not start conversion." }));
      setPhase("form");
    }
  }

  function useInSong() {
    if (!outputUrl) return;
    try {
      addAsset({ kind: "song", url: outputUrl, label: `Singing-voice conversion (${source!.title})`, detail: "Singing Voice" });
    } catch { /* non-fatal */ }
    setUsedInSong(true);
    onConverted?.(outputUrl);
    toast({
      title: t("singingVoice.usedInSong", { defaultValue: "Converted vocal is now the song" }),
      description: t("singingVoice.usedInSongDetail", { defaultValue: "Downstream steps (video, distribute) will use this version." }),
    });
  }

  const playingUrl = ab === "original" ? source.audioUrl : outputUrl;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-6"
      onClick={(e) => { if (e.target === overlayRef.current && phase !== "generating") onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={t("singingVoice.title", { defaultValue: "Singing Voice" })}
    >
      <div className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-[#0a0a0a] border border-primary/25 shadow-[0_0_60px_-10px_rgba(255,200,60,0.25)]">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 bg-[#0a0a0a]/95 backdrop-blur border-b border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
              <Mic className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">
                {t("singingVoice.title", { defaultValue: "Singing Voice" })}
                <span className="ml-2 text-[10px] font-black text-primary/80 uppercase tracking-widest border border-primary/30 bg-primary/10 rounded-full px-2 py-0.5">
                  {t("singingVoice.costBadge", { defaultValue: "{{cost}} VB · price TBD", cost: CREDIT_COST })}
                </span>
              </p>
              <p className="text-xs text-white/40 truncate">“{source.title}”</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === "generating"}
            className="rounded-lg p-2 text-white/50 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
            aria-label={t("singingVoice.close", { defaultValue: "Close" })}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {/* Honest framing */}
          <div className="flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <Info className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
            <p className="text-xs text-white/55 leading-relaxed">
              {t("singingVoice.honest", {
                defaultValue:
                  "Converts your song's vocals into a chosen singing voice's timbre — same melody and timing, new voice. Works best on clean vocal stems; a full mix converts everything sung in it.",
              })}
            </p>
          </div>

          {/* Provider gate */}
          {!checking && !configured && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3">
              <AlertCircle className="h-4 w-4 text-amber-300/80 shrink-0 mt-0.5" />
              <p className="text-xs text-white/60 leading-relaxed">
                {t("singingVoice.notConfigured", {
                  defaultValue:
                    "Singing-voice conversion isn't connected yet — the site owner needs to add a provider key. The voices below are samples; the Convert button stays disabled until then. You won't be charged.",
                })}
              </p>
            </div>
          )}

          {outOfCredits && (
            <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-300">
                {t("singingVoice.outOfCredits", { defaultValue: "Not enough Visual Bucs for singing-voice conversion ({{cost}}).", cost: CREDIT_COST })}
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
            <>
              {/* Voice choice */}
              <div>
                <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">
                  {t("singingVoice.voiceLabel", { defaultValue: "Choose a singing voice" })}
                </p>
                {checking ? (
                  <div className="flex items-center gap-2 text-xs text-white/40">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t("singingVoice.loadingVoices", { defaultValue: "Loading voices…" })}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {voices.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setVoiceId(v.id)}
                        className={`rounded-xl border px-4 py-3 text-left transition ${
                          voiceId === v.id
                            ? (isLight ? "border-[#C9A84C] bg-[#F7ECD2] shadow-[0_0_0_1px_#C9A84C,0_10px_28px_rgba(201,168,76,0.22)]" : "border-primary bg-primary/[0.16] shadow-[0_0_0_1px_rgba(212,175,55,0.55)]")
                            : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                        }`}
                      >
                        <p className="font-bold text-white text-sm">{v.name}</p>
                        <p className="text-xs text-white/40 mt-0.5">{v.style}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Strength */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-white/40 uppercase tracking-wider">
                    {t("singingVoice.strengthLabel", { defaultValue: "Voice strength" })}
                  </p>
                  <span className="text-xs text-white/60 font-mono">{strength}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={strength}
                  onChange={(e) => setStrength(Number(e.target.value))}
                  className="w-full accent-[#d4af37]"
                />
              </div>

              {/* Keep instrumental */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={keepInstrumental}
                  onChange={(e) => setKeepInstrumental(e.target.checked)}
                  className="h-4 w-4 accent-[#d4af37]"
                />
                <span className="text-sm text-white/70">
                  {t("singingVoice.keepInstrumental", { defaultValue: "Keep my instrumental under the converted vocal" })}
                </span>
              </label>

              <Button
                type="button"
                onClick={startConversion}
                disabled={!voiceId || !configured || checking}
                title={!configured ? t("singingVoice.disabledTitle", { defaultValue: "Connect a provider key to enable" }) : undefined}
                className="w-full gold-glow font-bold"
              >
                {t("singingVoice.convertButton", { defaultValue: "Convert vocals ({{cost}} VB — price TBD)", cost: CREDIT_COST })}
              </Button>
            </>
          )}

          {phase === "generating" && (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
              <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
              <p className="font-bold text-white">
                {t("singingVoice.working", { defaultValue: "Converting vocals… ({status})", status: jobStatus })}
              </p>
              <p className="text-sm text-white/40 mt-1">
                {t("singingVoice.workingNote", { defaultValue: "This runs on the server — safe to close this window." })}
              </p>
            </div>
          )}

          {phase === "done" && outputUrl && (
            <div className="space-y-4">
              <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
                <p className="text-sm font-semibold text-white/80">
                  {t("singingVoice.done", { defaultValue: "Vocals converted." })}
                </p>
              </div>

              {/* A/B */}
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { k: "original", label: t("singingVoice.abOriginal", { defaultValue: "Original" }) },
                    { k: "converted", label: t("singingVoice.abConverted", { defaultValue: "Converted" }) },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.k}
                    type="button"
                    onClick={() => { setAb(o.k); setPlaying(false); }}
                    className={`rounded-xl border px-3 py-2 text-sm font-bold transition ${
                      ab === o.k ? (isLight ? "border-[#C9A84C] bg-[#F7ECD2] shadow-[0_0_0_1px_#C9A84C,0_10px_28px_rgba(201,168,76,0.22)]" : "border-primary bg-primary/[0.16] shadow-[0_0_0_1px_rgba(212,175,55,0.55)]") : "border-white/10 text-white/50 hover:border-white/25"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <audio
                ref={audioRef}
                src={playingUrl ?? undefined}
                controls
                className="w-full"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
              />

              <div className="flex gap-3">
                <Button type="button" onClick={useInSong} disabled={usedInSong} className="flex-1 gold-glow font-bold">
                  {usedInSong
                    ? t("singingVoice.usedLabel", { defaultValue: "In use ✓" })
                    : t("singingVoice.useInSong", { defaultValue: "Use in song" })}
                </Button>
                <a
                  href={outputUrl}
                  download={`singing-voice-${source.title.replace(/[^a-z0-9]+/gi, "-")}.mp3`}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/[0.12] px-5 py-2.5 font-semibold text-white/70 hover:border-white/25 transition"
                >
                  <Download className="h-4 w-4" /> {t("singingVoice.download", { defaultValue: "Download" })}
                </a>
              </div>
              {playing && <p className="sr-only">{t("singingVoice.playing", { defaultValue: "Playing preview" })}</p>}
              <div className="hidden">
                <button type="button" onClick={() => audioRef.current?.paused ? audioRef.current?.play() : audioRef.current?.pause()}>
                  <Play className="h-4 w-4" /><Pause className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
