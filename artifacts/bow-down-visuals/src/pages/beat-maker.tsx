import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MarketingBadge } from "@/components/MarketingBadge";
import {
  Sparkles, Loader2, Download, Play, Square, Shuffle,
  Trash2, Wand2, Disc3, Scissors, Store, Music4, Timer, KeyRound,
  SlidersHorizontal, Lock,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserMode } from "@/contexts/UserModeContext";
import { CREDIT_COSTS } from "@/lib/credit-costs";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* Single source of truth for the AI beat price — the credit-cost registry. */
const BEAT_COST = CREDIT_COSTS["/api/beat/generate"]?.cost ?? 300;

/* ─── Beat Maker ────────────────────────────────────────────────────────────
   The first module of the One Unified Creation Hub.
   AI Beat (default, dead simple): describe the vibe, get a studio instrumental
   (3 Visual Bucs, ElevenLabs Music, instrumental-only prompt). Hands off to
   the Stem Splitter and the Beats Marketplace.
   Step Sequencer (Advanced mode — Creator Level 6): 16-step drum machine,
   100% client-side Web Audio synthesis (zero provider cost → free). Presets,
   swing, WAV export. */

const GENRES = [
  "hip-hop", "trap", "drill", "r&b", "afrobeats", "pop",
  "edm", "lofi", "dancehall", "jersey-club",
] as const;

const DURATIONS = [
  { labelKey: "beatMaker.duration30s", value: 30 },
  { labelKey: "beatMaker.duration1m", value: 60 },
  { labelKey: "beatMaker.duration2m", value: 120 },
  { labelKey: "beatMaker.duration3m", value: 180 },
] as const;

const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

const inputClass =
  "h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 " +
  "focus:border-primary/50 focus:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/25 " +
  "focus-visible:ring-offset-0 transition-colors rounded-xl";
const textareaClass =
  "bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 " +
  "focus:border-primary/50 focus:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/25 " +
  "focus-visible:ring-offset-0 transition-colors rounded-xl resize-none";

interface GeneratedBeat {
  url: string;
  title: string;
  durationMs: number;
  meta?: Record<string, string>;
}

function AiBeatTab({ onGenerated }: { onGenerated?: (beat: GeneratedBeat) => void }) {
  const { t } = useTranslation();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [vibe, setVibe] = useState("");
  const [genre, setGenre] = useState<string>("trap");
  const [bpm, setBpm] = useState(140);
  const [musicalKey, setMusicalKey] = useState("C");
  const [duration, setDuration] = useState(60);
  const [title, setTitle] = useState("");
  const [generating, setGenerating] = useState(false);
  const [beat, setBeat] = useState<GeneratedBeat | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!vibe.trim() || generating) return;
    setGenerating(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch("/api/beat/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vibe: vibe.trim(),
          genre,
          bpm,
          musicalKey,
          lengthSeconds: duration,
          beatTitle: title.trim() || undefined,
        }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = await res.json().catch(() => ({}));
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.url) {
        setError(data.error || t("beatMaker.errorGenerateFailed"));
        return;
      }
      const generated: GeneratedBeat = {
        url: data.url,
        title: title.trim() || t("beatMaker.defaultBeatTitle", { genre, bpm }),
        durationMs: data.durationMs ?? duration * 1000,
        meta: { genre, bpm: String(bpm), key: musicalKey },
      };
      setBeat(generated);
      onGenerated?.(generated);
      if (data.creditsRemaining !== undefined) refreshProfile();
    } catch {
      setError(t("beatMaker.errorNetwork"));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-5">
        <div>
          <Label className="text-white/70 text-sm mb-2 block">{t("beatMaker.vibeLabel")}</Label>
          <Textarea
            value={vibe}
            onChange={(e) => setVibe(e.target.value)}
            placeholder={t("beatMaker.vibePlaceholder")}
            rows={4}
            className={textareaClass}
          />
        </div>

        <div>
          <Label className="text-white/70 text-sm mb-2 block">{t("beatMaker.genreLabel")}</Label>
          <div className="flex flex-wrap gap-2">
            {GENRES.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGenre(g)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  genre === g
                    ? "bg-primary text-black border-primary font-semibold"
                    : "border-white/15 text-white/60 hover:border-white/30 hover:text-white"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <Label className="text-white/70 text-sm mb-2 flex items-center gap-1.5">
              <Timer className="w-3.5 h-3.5" /> {t("beatMaker.bpmLabel")}
            </Label>
            <Input
              type="number" min={60} max={200} value={bpm}
              onChange={(e) => setBpm(Math.min(200, Math.max(60, Number(e.target.value) || 140)))}
              className={inputClass}
            />
          </div>
          <div>
            <Label className="text-white/70 text-sm mb-2 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" /> {t("beatMaker.keyLabel")}
            </Label>
            <select
              value={musicalKey}
              onChange={(e) => setMusicalKey(e.target.value)}
              className={`${inputClass} w-full px-3 appearance-none cursor-pointer [&>option]:bg-zinc-900`}
            >
              {KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-white/70 text-sm mb-2 block">{t("beatMaker.lengthLabel")}</Label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className={`${inputClass} w-full px-3 appearance-none cursor-pointer [&>option]:bg-zinc-900`}
            >
              {DURATIONS.map((d) => <option key={d.value} value={d.value}>{t(d.labelKey)}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-white/70 text-sm mb-2 block">{t("beatMaker.titleLabel")}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("beatMaker.titlePlaceholder")}
              className={inputClass}
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>
        )}

        <Button
          onClick={generate}
          disabled={generating || !vibe.trim()}
          className="w-full h-12 rounded-xl bg-primary text-black font-bold hover:bg-primary/90 disabled:opacity-50"
        >
          {generating ? (
            <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> {t("beatMaker.cookingButton")}</>
          ) : (
            <><Sparkles className="w-5 h-5 mr-2" /> {t("beatMaker.generateButton", { cost: BEAT_COST.toLocaleString("en-US") })}</>
          )}
        </Button>
        <p className="text-xs text-white/40 text-center -mt-2">
          {t("beatMaker.instrumentalNote")}
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
          <Music4 className="w-4 h-4 text-primary" /> {t("beatMaker.yourBeatTitle")}
        </h3>
        {beat ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-black/40 border border-white/10 p-4">
              <p className="text-white font-medium truncate">{beat.title}</p>
              <p className="text-white/40 text-xs mt-0.5">
                {t("beatMaker.beatMeta", { genre, bpm, key: musicalKey, secs: Math.round(beat.durationMs / 1000) })}
              </p>
              <audio src={beat.url} controls className="w-full mt-3" />
            </div>
            <div className="grid gap-2">
              <a
                href={beat.url} download={`${beat.title}.mp3`}
                className="flex items-center justify-center gap-2 h-10 rounded-xl border border-white/15 text-white/80 text-sm hover:border-white/30 hover:text-white transition-colors"
              >
                <Download className="w-4 h-4" /> {t("beatMaker.downloadMp3")}
              </a>
              {/* Hub handoffs — the beat flows into the next steps */}
              <Link
                href="/stems"
                className="flex items-center justify-center gap-2 h-10 rounded-xl border border-primary/40 text-primary text-sm font-medium hover:bg-primary/10 transition-colors"
              >
                <Scissors className="w-4 h-4" /> {t("beatMaker.splitStems")}
              </Link>
              <Link
                href="/beats"
                className="flex items-center justify-center gap-2 h-10 rounded-xl border border-white/15 text-white/80 text-sm hover:border-white/30 hover:text-white transition-colors"
              >
                <Store className="w-4 h-4" /> {t("beatMaker.sellMarketplace")}
              </Link>
              <Link
                href="/make-song"
                className="flex items-center justify-center gap-2 h-10 rounded-xl border border-white/15 text-white/80 text-sm hover:border-white/30 hover:text-white transition-colors"
              >
                <Disc3 className="w-4 h-4" /> {t("beatMaker.turnIntoSong")}
              </Link>
            </div>
          </div>
        ) : (
          <div className="h-48 rounded-xl border border-dashed border-white/15 flex flex-col items-center justify-center text-center p-6">
            <Wand2 className="w-8 h-8 text-white/20 mb-3" />
            <p className="text-white/40 text-sm">
              {t("beatMaker.emptyState")}
            </p>
          </div>
        )}
      </div>

      {outOfCredits && <OutOfCredits onClose={() => setOutOfCredits(false)} />}
    </div>
  );
}

/* ─── Step Sequencer ────────────────────────────────────────────────────────
   100% client-side: every drum is synthesized live with the Web Audio API,
   so playing and exporting costs nothing (no provider calls → free). */

const TRACKS = [
  { id: "kick",  labelKey: "beatMaker.trackKick",      color: "bg-amber-400" },
  { id: "snare", labelKey: "beatMaker.trackSnare",     color: "bg-rose-400" },
  { id: "clap",  labelKey: "beatMaker.trackClap",      color: "bg-orange-400" },
  { id: "chat",  labelKey: "beatMaker.trackClosedHat", color: "bg-sky-400" },
  { id: "ohat",  labelKey: "beatMaker.trackOpenHat",   color: "bg-cyan-300" },
  { id: "b808",  labelKey: "beatMaker.track808",       color: "bg-violet-400" },
  { id: "perc",  labelKey: "beatMaker.trackPerc",      color: "bg-emerald-400" },
  { id: "shk",   labelKey: "beatMaker.trackShaker",    color: "bg-lime-300" },
] as const;

type TrackId = typeof TRACKS[number]["id"];
const STEPS = 16;

/* Synthesize one drum hit at time t. All sounds are oscillator/noise based —
   no samples, no network. */
function synthHit(ctx: BaseAudioContext, id: TrackId, t: number, dest: AudioNode) {
  const g = ctx.createGain();
  g.connect(dest);

  if (id === "kick") {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    o.connect(g); o.start(t); o.stop(t + 0.26);
  } else if (id === "b808") {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.3);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(g); o.start(t); o.stop(t + 0.6);
  } else if (id === "snare") {
    noiseBurst(ctx, t, 0.18, 1800, g, 0.7);
    const o = ctx.createOscillator();
    o.type = "triangle"; o.frequency.setValueAtTime(190, t);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.5, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    o.connect(g2); g2.connect(dest); o.start(t); o.stop(t + 0.12);
  } else if (id === "clap") {
    [0, 0.012, 0.024].forEach((off) => noiseBurst(ctx, t + off, 0.09, 1200, g, 0.4));
    noiseBurst(ctx, t + 0.036, 0.22, 1000, g, 0.5);
  } else if (id === "chat") {
    noiseBurst(ctx, t, 0.05, 8000, g, 0.32, "highpass");
  } else if (id === "ohat") {
    noiseBurst(ctx, t, 0.32, 7500, g, 0.3, "highpass");
  } else if (id === "perc") {
    const o = ctx.createOscillator();
    o.type = "square"; o.frequency.setValueAtTime(620, t);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g); o.start(t); o.stop(t + 0.1);
  } else { // shk
    noiseBurst(ctx, t, 0.09, 6000, g, 0.18, "highpass");
  }
}

function noiseBurst(
  ctx: BaseAudioContext, t: number, dur: number, freq: number,
  dest: AudioNode, vol: number, type: BiquadFilterType = "bandpass",
) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(dest);
  src.start(t); src.stop(t + dur + 0.02);
}

/* Presets — classic starting patterns (true = hit). Rows: kick,snare,clap,chat,ohat,808,perc,shk */
const PRESETS: Record<string, { nameKey: string; bpm: number; grid: boolean[][] }> = {
  trap: {
    nameKey: "beatMaker.presetTrap", bpm: 140,
    grid: [
      [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      [0,0,0,0,1,0,0,1,0,0,0,0,1,0,0,0],
      [1,0,1,1,0,1,0,1,1,0,1,1,0,1,1,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
      [1,0,0,0,0,0,0,0,0,0,1,0,0,1,0,0],
      [0,0,1,0,0,0,1,0,0,0,0,0,1,0,0,0],
      [1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1],
    ].map((r) => r.map(Boolean)),
  },
  drill: {
    nameKey: "beatMaker.presetDrill", bpm: 142,
    grid: [
      [1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,1],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,1,0,1,0,1,1,0,1,0,1,1,0,1,0,1],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0],
      [0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],
    ].map((r) => r.map(Boolean)),
  },
  boombap: {
    nameKey: "beatMaker.presetBoomBap", bpm: 92,
    grid: [
      [1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,0,1,0,1,0,1,0,1,0,1,0,1,1,0,1],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,1,0,0,1,0,0,1,0,0,0,0,1,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
    ].map((r) => r.map(Boolean)),
  },
  afrobeats: {
    nameKey: "beatMaker.presetAfrobeats", bpm: 102,
    grid: [
      [1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,0],
      [0,0,1,0,0,0,1,0,0,0,0,0,1,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0],
      [1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,0,0,0,1,0,0,1,0,0,1,0,0,1,0,0],
      [1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1],
    ].map((r) => r.map(Boolean)),
  },
};

const emptyGrid = () => TRACKS.map(() => Array(STEPS).fill(false));

function SequencerTab({ onGenerated }: { onGenerated?: (beat: GeneratedBeat) => void }) {
  const { t } = useTranslation();
  const [grid, setGrid] = useState<boolean[][]>(() => PRESETS.trap.grid.map((r) => [...r]));
  const [bpm, setBpm] = useState(140);
  const [swing, setSwing] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(-1);
  const [exporting, setExporting] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const stepRef = useRef(0);
  const nextTimeRef = useRef(0);
  const gridRef = useRef(grid);
  const bpmRef = useRef(bpm);
  const swingRef = useRef(swing);
  gridRef.current = grid;
  bpmRef.current = bpm;
  swingRef.current = swing;

  const getCtx = () => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    if (ctxRef.current.state === "suspended") void ctxRef.current.resume();
    return ctxRef.current;
  };

  const scheduleStep = useCallback((s: number, t: number) => {
    const ctx = getCtx();
    const g = gridRef.current;
    const sw = swingRef.current;
    // Swing delays off-beat 16ths (odd steps)
    const when = s % 2 === 1 ? t + (60 / bpmRef.current / 4) * sw : t;
    TRACKS.forEach((tr, ti) => {
      if (g[ti]?.[s]) synthHit(ctx, tr.id, when, ctx.destination);
    });
    // UI highlight slightly ahead-safe: update on the audio clock via timeout
    const ms = Math.max(0, (when - ctx.currentTime) * 1000);
    window.setTimeout(() => setStep(s), ms);
  }, []);

  const start = useCallback(() => {
    const ctx = getCtx();
    setPlaying(true);
    stepRef.current = 0;
    nextTimeRef.current = ctx.currentTime + 0.06;
    timerRef.current = window.setInterval(() => {
      const ahead = 0.12;
      while (nextTimeRef.current < ctx.currentTime + ahead) {
        scheduleStep(stepRef.current, nextTimeRef.current);
        nextTimeRef.current += 60 / bpmRef.current / 4;
        stepRef.current = (stepRef.current + 1) % STEPS;
      }
    }, 25);
  }, [scheduleStep]);

  const stop = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setPlaying(false);
    setStep(-1);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    void ctxRef.current?.close().catch(() => {});
  }, []);

  const toggle = (ti: number, s: number) => {
    setGrid((prev) => {
      const next = prev.map((r) => [...r]);
      next[ti]![s] = !next[ti]![s];
      return next;
    });
  };

  const loadPreset = (key: string) => {
    const p = PRESETS[key];
    if (!p) return;
    stop();
    setGrid(p.grid.map((r) => [...r]));
    setBpm(p.bpm);
  };

  const randomize = () => {
    stop();
    setGrid(TRACKS.map((_, ti) =>
      Array.from({ length: STEPS }, (_, s) => {
        const density = [0.35, 0.14, 0.1, 0.75, 0.08, 0.3, 0.22, 0.4][ti] ?? 0.2;
        // keep kicks/snares roughly on-grid for musicality
        if (ti === 1 && s % 4 !== 0 && Math.random() < 0.85) return false;
        return Math.random() < density;
      })
    ));
  };

  /* Render 4 bars offline → WAV → download. Pure client-side. */
  const exportWav = async () => {
    setExporting(true);
    try {
      const bars = 4;
      const totalSteps = STEPS * bars;
      const stepDur = 60 / bpm / 4;
      const totalDur = totalSteps * stepDur + 0.6;
      const sampleRate = 44100;
      const off = new OfflineAudioContext(2, Math.ceil(totalDur * sampleRate), sampleRate);
      const g = gridRef.current;
      const sw = swingRef.current;
      for (let s = 0; s < totalSteps; s++) {
        const t = s * stepDur + (s % 2 === 1 ? stepDur * sw : 0);
        TRACKS.forEach((tr, ti) => {
          if (g[ti]?.[s % STEPS]) synthHit(off, tr.id, t, off.destination);
        });
      }
      const rendered = await off.startRendering();
      const blob = audioBufferToWav(rendered);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `beat-${bpm}bpm.wav`;
      a.click();
      // Keep the blob URL alive for this session so the hub project can use it.
      onGenerated?.({
        url,
        title: t("beatMaker.sequencerBeatTitle", { bpm }),
        durationMs: Math.round(totalDur * 1000),
        meta: { bpm: String(bpm), source: "sequencer", sessionOnly: "1" },
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-5">
      {/* Transport */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={playing ? stop : start}
          className={`h-11 px-6 rounded-xl font-bold ${playing ? "bg-red-500 hover:bg-red-600 text-white" : "bg-primary text-black hover:bg-primary/90"}`}
        >
          {playing ? <><Square className="w-4 h-4 mr-2" /> {t("beatMaker.stop")}</> : <><Play className="w-4 h-4 mr-2" /> {t("beatMaker.play")}</>}
        </Button>
        <div className="flex items-center gap-2 flex-1 min-w-[180px]">
          <Label className="text-white/60 text-xs whitespace-nowrap w-14">{t("beatMaker.bpmValue", { n: bpm })}</Label>
          <input
            type="range" min={60} max={200} value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            className="flex-1 accent-amber-400"
          />
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-[180px]">
          <Label className="text-white/60 text-xs whitespace-nowrap w-16">{t("beatMaker.swingValue", { n: Math.round(swing * 100) })}</Label>
          <input
            type="range" min={0} max={0.6} step={0.01} value={swing}
            onChange={(e) => setSwing(Number(e.target.value))}
            className="flex-1 accent-amber-400"
          />
        </div>
      </div>

      {/* Presets + tools */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(PRESETS).map(([key, p]) => (
          <button
            key={key} type="button" onClick={() => loadPreset(key)}
            className="px-3 py-1.5 rounded-full text-sm border border-white/15 text-white/60 hover:border-primary/60 hover:text-white transition-colors"
          >
            {t(p.nameKey)}
          </button>
        ))}
        <button
          type="button" onClick={randomize}
          className="px-3 py-1.5 rounded-full text-sm border border-white/15 text-white/60 hover:border-primary/60 hover:text-white transition-colors flex items-center gap-1.5"
        >
          <Shuffle className="w-3.5 h-3.5" /> {t("beatMaker.randomize")}
        </button>
        <button
          type="button" onClick={() => { stop(); setGrid(emptyGrid()); }}
          className="px-3 py-1.5 rounded-full text-sm border border-white/15 text-white/60 hover:border-red-400/60 hover:text-white transition-colors flex items-center gap-1.5"
        >
          <Trash2 className="w-3.5 h-3.5" /> {t("beatMaker.clear")}
        </button>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="min-w-[640px] space-y-1.5">
          {TRACKS.map((tr, ti) => (
            <div key={tr.id} className="flex items-center gap-1.5">
              <div className="w-24 shrink-0 text-xs text-white/60 font-medium truncate">{t(tr.labelKey)}</div>
              <div className="grid gap-1 flex-1" style={{ gridTemplateColumns: `repeat(${STEPS}, minmax(0,1fr))` }}>
                {Array.from({ length: STEPS }, (_, s) => {
                  const on = grid[ti]?.[s];
                  const isBeat = s % 4 === 0;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggle(ti, s)}
                      className={`aspect-square rounded-md border transition-all ${
                        on
                          ? `${tr.color} border-transparent shadow-[0_0_8px_rgba(255,255,255,0.25)]`
                          : isBeat
                            ? "bg-white/[0.07] border-white/10 hover:bg-white/[0.14]"
                            : "bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.1]"
                      } ${step === s && playing ? "ring-2 ring-white/70" : ""}`}
                      aria-label={t("beatMaker.stepAria", { label: t(tr.labelKey), n: s + 1, state: on ? t("beatMaker.stepOn") : t("beatMaker.stepOff") })}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Export + handoffs */}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          onClick={exportWav}
          disabled={exporting}
          className="h-11 px-5 rounded-xl bg-primary text-black font-bold hover:bg-primary/90 disabled:opacity-50"
        >
          {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
          {t("beatMaker.exportWavFree")}
        </Button>
        <Link
          href="/stems"
          className="flex items-center gap-2 h-11 px-5 rounded-xl border border-primary/40 text-primary text-sm font-medium hover:bg-primary/10 transition-colors"
        >
          <Scissors className="w-4 h-4" /> {t("beatMaker.splitExportedStems")}
        </Link>
        <Link
          href="/beats"
          className="flex items-center gap-2 h-11 px-5 rounded-xl border border-white/15 text-white/80 text-sm hover:border-white/30 hover:text-white transition-colors"
        >
          <Store className="w-4 h-4" /> {t("beatMaker.sellMarketplace")}
        </Link>
      </div>
      <p className="text-xs text-white/40">
        {t("beatMaker.sequencerNote")}
      </p>
    </div>
  );
}

/* Encode an AudioBuffer as a 16-bit WAV blob. */
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numCh = Math.min(2, buffer.numberOfChannels);
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const bytes = 44 + len * numCh * 2;
  const ab = new ArrayBuffer(bytes);
  const v = new DataView(ab);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  v.setUint32(4, bytes - 8, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * numCh * 2, true);
  v.setUint16(32, numCh * 2, true);
  v.setUint16(34, 16, true);
  writeStr(36, "data");
  v.setUint32(40, len * numCh * 2, true);
  const chans: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c]![i]!));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

/* ─── Advanced-mode gate ────────────────────────────────────────────────────
   Shown instead of the step sequencer when the user is below Creator Level 6.
   One tap flips the site into Advanced mode (clamped to the plan's max). */

function SequencerGate({ onEnable }: { onEnable: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-primary/30 bg-white/[0.03] p-8 text-center space-y-4">
      <div className="mx-auto w-12 h-12 rounded-full bg-primary/15 border border-primary/40 flex items-center justify-center">
        <Lock className="w-5 h-5 text-primary" />
      </div>
      <div>
        <h3 className="text-white font-bold text-lg">{t("beatMaker.gateTitle")}</h3>
        <p className="text-white/50 text-sm mt-1 max-w-md mx-auto">
          {t("beatMaker.gateBody")}
        </p>
      </div>
      <Button
        onClick={onEnable}
        className="h-11 px-6 rounded-xl bg-primary text-black font-bold hover:bg-primary/90"
      >
        <SlidersHorizontal className="w-4 h-4 mr-2" /> {t("beatMaker.gateButton")}
      </Button>
    </div>
  );
}

/* ─── Page shell ──────────────────────────────────────────────────────────── */

export function BeatMakerModule({ onGenerated }: { onGenerated?: (beat: GeneratedBeat) => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"ai" | "seq">("ai");
  const { stars, setStars } = useUserMode();
  const advanced = stars >= 6;

  // Drop back to the AI tab if the user leaves Advanced mode mid-session.
  useEffect(() => {
    if (!advanced) setTab("ai");
  }, [advanced]);

  const enableAdvanced = () => setStars(6);

  return (
    <div className="space-y-6">

      <div className="flex gap-2 p-1 rounded-xl bg-white/[0.04] border border-white/10 w-fit">
        <button
          type="button"
          onClick={() => setTab("ai")}
          className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
            tab === "ai" ? "bg-primary text-black" : "text-white/60 hover:text-white"
          }`}
        >
          <Sparkles className="w-4 h-4" /> {t("beatMaker.aiBeatTab")}
        </button>
        {advanced ? (
          <button
            type="button"
            onClick={() => setTab("seq")}
            className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
              tab === "seq" ? "bg-primary text-black" : "text-white/60 hover:text-white"
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" /> {t("beatMaker.stepSequencerTab")}
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-400/20 text-emerald-300 font-bold">{t("beatMaker.freeBadge")}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={enableAdvanced}
            title={t("beatMaker.sequencerTooltip")}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 text-white/60 hover:text-white"
          >
            <SlidersHorizontal className="w-4 h-4" /> {t("beatMaker.stepSequencerTab")}
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-bold">{t("beatMaker.advancedBadge")}</span>
          </button>
        )}
      </div>

      {tab === "ai" ? (
        <AiBeatTab onGenerated={onGenerated} />
      ) : advanced ? (
        <SequencerTab onGenerated={onGenerated} />
      ) : (
        <SequencerGate onEnable={enableAdvanced} />
      )}
    </div>
  );
}

export default function BeatMaker() {
  const { t } = useTranslation();
  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl font-black text-white">{t("beatMaker.title")}</h1>
          <MarketingBadge variant="muted">{t("beatMaker.newBadge")}</MarketingBadge>
        </div>
        <p className="text-white/50 mt-2 max-w-2xl">
          {t("beatMaker.subtitle")}
        </p>
      </div>

      <BeatMakerModule />
    </div>
  );
}
