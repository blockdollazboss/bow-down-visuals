import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { Loader2, Play, Pause, Download, Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useTranslation } from "react-i18next";

type Preset = "karaoke" | "popin" | "lowerthird";

interface TimedWord {
  word: string;
  start: number;
  end: number;
}

interface BurnResult {
  words: TimedWord[];
  srt: string;
  vtt: string;
  preset: Preset;
  creditsRemaining: number;
}

const PRESETS: Array<{ id: Preset; nameKey: string; descKey: string }> = [
  { id: "karaoke", nameKey: "captionStyler.presetKaraoke", descKey: "captionStyler.presetKaraokeDesc" },
  { id: "popin", nameKey: "captionStyler.presetPopin", descKey: "captionStyler.presetPopinDesc" },
  { id: "lowerthird", nameKey: "captionStyler.presetLowerthird", descKey: "captionStyler.presetLowerthirdDesc" },
];

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PreviewWord({
  word,
  active,
  preset,
}: {
  word: TimedWord;
  active: boolean;
  preset: Preset;
}) {
  if (preset === "karaoke") {
    return (
      <span
        className={`transition-colors duration-150 ${active ? "text-[#C9A84C]" : "text-white"}`}
      >
        {word.word}
      </span>
    );
  }
  if (preset === "popin") {
    return (
      <span
        className={`inline-block text-white transition-transform duration-150 ${
          active ? "scale-125 text-[#C9A84C]" : "scale-100"
        }`}
      >
        {word.word}
      </span>
    );
  }
  /* lowerthird — minimal bar: words sit in one clean line, active word underlined gold */
  return (
    <span
      className={`text-white transition-colors duration-150 ${
        active ? "underline decoration-[#C9A84C] decoration-2 underline-offset-4" : ""
      }`}
    >
      {word.word}
    </span>
  );
}

export function CaptionStyler({ initialTranscript = "" }: { initialTranscript?: string }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();

  const [transcript, setTranscript] = useState(initialTranscript);
  const [preset, setPreset] = useState<Preset>("karaoke");
  const [wordsPerSecond, setWordsPerSecond] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BurnResult | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const timerRef = useRef<number | null>(null);

  const duration = useMemo(
    () => (result && result.words.length > 0 ? result.words[result.words.length - 1]!.end : 0),
    [result],
  );

  /* Playhead drives the per-word timing preview. */
  useEffect(() => {
    if (!playing || !result) return;
    const tick = () => setPlayhead((p) => (p + 0.1 >= duration ? 0 : p + 0.1));
    timerRef.current = window.setInterval(tick, 100);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [playing, result, duration]);

  async function onBurn() {
    if (!transcript.trim()) {
      setError(t("wave8.captionStyler.errorEmpty"));
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setPlaying(false);
    setPlayhead(0);
    try {
      const res = await confirmedFetch("/api/wave8/caption-styler/burn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: transcript.trim(), preset, wordsPerSecond }),
      });
      if (!res) {
        setError(t("wave8.captionStyler.errorCancelled"));
        return;
      }
      if (res.status === 402) {
        setError(t("wave8.captionStyler.errorOutOfCredits"));
        return;
      }
      if (!res.ok) {
        setError(t("wave8.captionStyler.errorFailed"));
        return;
      }
      const data = (await res.json()) as BurnResult;
      setResult(data);
    } catch {
      setError(t("wave8.captionStyler.errorFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div id="caption-styler" className="mt-10 rounded-2xl border border-primary/25 bg-black/60 p-5 md:p-6">
      <div className="mb-1">
        <h2 className="text-lg font-bold text-white">{t("wave8.captionStyler.title")}</h2>
        <p className="text-sm text-white/50 mt-1">{t("wave8.captionStyler.subtitle")}</p>
      </div>

      {/* Preset picker with mini visual previews */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPreset(p.id)}
            className={`rounded-2xl border-2 p-3 text-left transition-all ${
              preset === p.id
                ? "border-primary bg-primary/[0.08]"
                : "border-white/[0.08] bg-white/[0.02] hover:border-white/25"
            }`}
          >
            {/* mini preview */}
            <div className="h-14 rounded-xl bg-black/80 border border-white/10 flex items-center justify-center gap-1.5 overflow-hidden mb-2.5 px-2">
              {p.id === "karaoke" && (
                <>
                  <span className="text-white text-xs font-bold">YOUR</span>
                  <span className="text-[#C9A84C] text-xs font-bold">HOOK</span>
                  <span className="text-white/40 text-xs font-bold">HERE</span>
                </>
              )}
              {p.id === "popin" && (
                <>
                  <span className="text-white text-xs font-bold">POP</span>
                  <span className="text-[#C9A84C] text-sm font-bold scale-125 inline-block">IN</span>
                </>
              )}
              {p.id === "lowerthird" && (
                <div className="border-l-2 border-[#C9A84C] pl-2">
                  <span className="text-white text-xs font-semibold">lower third caption</span>
                </div>
              )}
            </div>
            <p className="text-sm font-bold text-white">{t(`wave8.${p.nameKey}`)}</p>
            <p className="text-xs text-white/40 mt-0.5">{t(`wave8.${p.descKey}`)}</p>
          </button>
        ))}
      </div>

      {/* Transcript + pace */}
      <div className="mt-5 space-y-4">
        <div>
          <Label className="text-white/70 text-sm font-semibold">{t("wave8.captionStyler.transcriptLabel")}</Label>
          <Textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={4}
            placeholder={t("wave8.captionStyler.transcriptPlaceholder")}
            className="mt-1.5 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 rounded-xl resize-none"
          />
        </div>
        <div className="flex items-center gap-4">
          <Label className="text-white/70 text-sm font-semibold whitespace-nowrap">
            {t("wave8.captionStyler.paceLabel")}
          </Label>
          <input
            type="range"
            min={1}
            max={8}
            step={0.5}
            value={wordsPerSecond}
            onChange={(e) => setWordsPerSecond(Number(e.target.value))}
            className="w-full accent-[#C9A84C]"
            aria-label={t("wave8.captionStyler.paceLabel")}
          />
          <span className="text-sm text-[#C9A84C] font-bold w-10 text-right">{wordsPerSecond}</span>
        </div>
      </div>

      <div className="mt-5">
        <Button
          type="button"
          size="lg"
          disabled={loading || !transcript.trim()}
          onClick={onBurn}
          className="w-full sm:w-auto gold-glow font-bold px-10 rounded-xl"
        >
          {loading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> {t("wave8.captionStyler.burnBusy")}
            </>
          ) : (
            t("wave8.captionStyler.burnButton")
          )}
        </Button>
      </div>

      {error && (
        <div className="mt-4 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
          <p className="text-red-400 text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Result: preview + downloads + export handoff */}
      {result && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-bold text-white">{t("wave8.captionStyler.styledTitle")}</p>
            <p className="text-xs text-white/40">
              {t("wave8.captionStyler.styledSummary", { count: result.words.length })}
            </p>
          </div>

          {/* per-word timing preview over a dark box */}
          <div className="rounded-2xl bg-black/80 border border-white/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-white/50 uppercase tracking-wide">
                {t("wave8.captionStyler.previewTitle")}
              </p>
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                className="h-8 w-8 rounded-full bg-primary text-black flex items-center justify-center hover:opacity-90"
                aria-label={playing ? t("wave8.captionStyler.previewPause") : t("wave8.captionStyler.previewPlay")}
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
            </div>
            <div
              className={`min-h-[96px] flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 py-6 rounded-xl bg-black/60 ${
                preset === "lowerthird" ? "items-end justify-start" : ""
              }`}
            >
              {result.words.map((w, i) => (
                <span key={i}>
                  <PreviewWord
                    word={w}
                    active={playhead >= w.start && playhead < w.end}
                    preset={preset}
                  />
                </span>
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(duration, 0.1)}
              step={0.1}
              value={Math.min(playhead, duration)}
              onChange={(e) => {
                setPlayhead(Number(e.target.value));
                setPlaying(false);
              }}
              className="w-full mt-3 accent-[#C9A84C]"
              aria-label={t("wave8.captionStyler.previewTitle")}
            />
            <p className="text-xs text-white/30 mt-2">{t("wave8.captionStyler.previewHint")}</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => downloadFile(result.srt, "captions.srt", "text/plain")}
              className="border-white/10 bg-white/5 text-white hover:bg-white/10 gap-2"
            >
              <Download className="h-4 w-4" /> {t("wave8.captionStyler.downloadSrt")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => downloadFile(result.vtt, "captions.vtt", "text/vtt")}
              className="border-white/10 bg-white/5 text-white hover:bg-white/10 gap-2"
            >
              <Download className="h-4 w-4" /> {t("wave8.captionStyler.downloadVtt")}
            </Button>
            {/* Handoff: no export section exists on this page — send to the video editor. */}
            <Link href="/video-editor">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-primary/30 bg-primary/[0.06] text-primary hover:bg-primary/[0.12] gap-2"
              >
                <Clapperboard className="h-4 w-4" /> {t("wave8.captionStyler.continueExport")}
              </Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
