import { useEffect, useState } from "react";
import {
  Timer, Loader2, AlertTriangle, ChevronDown, ChevronUp,
  Wand2, Clapperboard, Trash2,
} from "lucide-react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Wave 9A — Lyrics-to-Timeline ─────────────────────────────────────────
   Dedup note: CaptionsSection's Auto Sync measures timing from AUDIO (Whisper).
   This panel is different: it estimates per-line timings from LYRICS TEXT
   alone via the text model (50 VB) — before audio exists — for creators
   drafting a lyric video / caption plan. Results are editable and hand off to
   the video editor via localStorage (`wave9a_lyric_captions`).

   JSON shape written to `wave9a_lyric_captions` (read by the editor worker):
   {
     "version": 1,
     "createdAt": "<ISO>",
     "songTitle": "<string>",
     "durationSec": <number>,
     "lines": [ { "text": "<lyric line>", "start": <seconds>, "end": <seconds> } ]
   } */

export interface TimedLine {
  text: string;
  start: number;
  end: number;
}

interface LyricsToTimelineProps {
  lyrics?: string | null;
  songTitle?: string | null;
  durationSec?: number | null;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

export function LyricsToTimeline({ lyrics, songTitle, durationSec }: LyricsToTimelineProps) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { refreshProfile } = useAuth();
  const [, navigate] = useLocation();

  const [open, setOpen] = useState(true);
  const [lyricsText, setLyricsText] = useState(lyrics ?? "");
  const [duration, setDuration] = useState<number>(Math.round(durationSec ?? 180));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [lines, setLines] = useState<TimedLine[]>([]);
  const [sent, setSent] = useState(false);

  /* Receive lyrics from the sibling Song Structure Builder ("Send lyrics to
     Timeline") — same-tab custom event + localStorage for cross-tab. */
  useEffect(() => {
    const fromStorage = () => {
      try {
        const raw = localStorage.getItem("wave9a_lyrics_handoff");
        if (raw) {
          const h = JSON.parse(raw) as { lyrics?: string };
          if (h.lyrics && !lyricsText) setLyricsText(h.lyrics);
        }
      } catch {
        /* ignore */
      }
    };
    fromStorage();
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { lyrics?: string } | undefined;
      if (detail?.lyrics) setLyricsText(detail.lyrics);
    };
    window.addEventListener("wave9a:lyrics", handler);
    return () => window.removeEventListener("wave9a:lyrics", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (lyrics && !lyricsText) setLyricsText(lyrics);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyrics]);

  useEffect(() => {
    if (durationSec && durationSec > 0) setDuration(Math.round(durationSec));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationSec]);

  async function place() {
    if (loading || !lyricsText.trim()) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setSent(false);
    try {
      const res = await confirmedFetch("/api/wave9a/lyrics/timing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: 50,
        overrideFeature: "Lyrics-to-Timeline",
        body: JSON.stringify({
          lyrics: lyricsText.trim(),
          durationSec: duration,
          title: (songTitle ?? "").trim(),
        }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as {
        lines?: TimedLine[];
        error?: string;
        message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.lines) || data.lines.length === 0) {
        throw new Error(data.message || data.error || t("wave9.timeline.errorGeneric"));
      }
      setLines(data.lines);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wave9.timeline.errorGeneric"));
    } finally {
      setLoading(false);
    }
  }

  function updateLine(i: number, patch: Partial<TimedLine>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, j) => j !== i));
  }

  /* Handoff: write the caption plan for the video editor and navigate. */
  function openInVideoEditor() {
    localStorage.setItem(
      "wave9a_lyric_captions",
      JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        songTitle: (songTitle ?? "").trim(),
        durationSec: duration,
        lines,
      })
    );
    setSent(true);
    navigate("/video-editor");
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] overflow-hidden" data-testid="lyrics-to-timeline">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Timer className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-black text-white">{t("wave9.timeline.title")}</p>
          <p className="text-[11px] text-white/40">{t("wave9.timeline.subtitle")}</p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-white/30 shrink-0" /> : <ChevronDown className="h-4 w-4 text-white/30 shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/[0.06]">
          <div className="pt-3">
            <label className="block mb-1.5 text-xs font-semibold uppercase tracking-wider text-white/45">
              {t("wave9.timeline.lyricsLabel")}
            </label>
            <textarea
              className={`${inputClass} min-h-[110px] resize-y`}
              placeholder={t("wave9.timeline.lyricsPlaceholder")}
              value={lyricsText}
              onChange={(e) => setLyricsText(e.target.value)}
            />
          </div>

          <div>
            <label className="block mb-1.5 text-xs font-semibold uppercase tracking-wider text-white/45">
              {t("wave9.timeline.durationLabel")}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={5}
                max={3600}
                value={duration}
                onChange={(e) => setDuration(Math.max(5, Math.min(3600, Number(e.target.value) || 5)))}
                className="w-32 rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-sm text-white outline-none focus:border-primary/60"
              />
              <span className="text-xs text-white/40">{t("wave9.timeline.seconds")}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={place}
            disabled={loading || !lyricsText.trim()}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {loading ? t("wave9.timeline.placing") : t("wave9.timeline.place")}
          </button>

          {outOfCredits && <OutOfCredits />}
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {lines.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <p className="text-xs font-black uppercase tracking-widest text-white/50">
                {t("wave9.timeline.timedHeading", { count: lines.length })}
              </p>
              <div className="max-h-72 overflow-y-auto space-y-1.5 pr-0.5">
                {lines.map((l, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-2.5 py-2">
                    <span className="text-[10px] font-black text-white/30 w-6 shrink-0">{i + 1}</span>
                    <p className="flex-1 text-xs text-white/80 truncate">{l.text}</p>
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      value={l.start}
                      onChange={(e) => updateLine(i, { start: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-16 rounded-lg border border-white/10 bg-black/60 px-1.5 py-1 text-[11px] text-center text-white outline-none focus:border-primary/50 tabular-nums"
                      aria-label={t("wave9.timeline.startLabel")}
                    />
                    <span className="text-white/25 text-[11px]">–</span>
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      value={l.end}
                      onChange={(e) => updateLine(i, { end: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-16 rounded-lg border border-white/10 bg-black/60 px-1.5 py-1 text-[11px] text-center text-white outline-none focus:border-primary/50 tabular-nums"
                      aria-label={t("wave9.timeline.endLabel")}
                    />
                    <span className="hidden sm:inline text-[10px] font-mono text-white/30 tabular-nums w-16 shrink-0">
                      {fmt(l.start)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="text-white/25 hover:text-red-300 transition shrink-0"
                      aria-label={t("wave9.timeline.remove")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={openInVideoEditor}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-6 py-3.5 text-sm font-black text-primary transition hover:bg-primary/20"
                data-testid="lyrics-open-video-editor"
              >
                <Clapperboard className="h-4 w-4" /> {t("wave9.timeline.openEditor")}
              </button>
              {sent && <p className="text-center text-xs text-emerald-300">{t("wave9.timeline.sentHint")}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
