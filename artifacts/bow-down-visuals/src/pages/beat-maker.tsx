import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MarketingBadge } from "@/components/MarketingBadge";
import {
  Sparkles, Loader2, Download, Play, Pause, Square, Shuffle,
  Trash2, Wand2, Disc3, Scissors, Store, Music4, Timer, KeyRound,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Beat Maker ────────────────────────────────────────────────────────────
   The first module of the One Unified Creation Hub: make beats two ways.
   Tab 1 — AI Beat: describe the vibe, get a studio instrumental (3 credits,
   ElevenLabs Music, instrumental-only prompt). Hands off to the Stem Splitter
   and the Beats Marketplace.
   Tab 2 — Step Sequencer: 16-step drum machine, 100% client-side Web Audio
   synthesis (zero provider cost → free). Presets, swing, WAV export. */

const GENRES = [
  "hip-hop", "trap", "drill", "r&b", "afrobeats", "pop",
  "edm", "lofi", "dancehall", "jersey-club",
] as const;

const DURATIONS = [
  { label: "30 sec", value: 30 },
  { label: "1 min", value: 60 },
  { label: "2 min", value: 120 },
  { label: "3 min", value: 180 },
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
        setError(data.error || "Beat generation failed — try again.");
        return;
      }
      const generated: GeneratedBeat = {
        url: data.url,
        title: title.trim() || `${genre} beat · ${bpm} BPM`,
        durationMs: data.durationMs ?? duration * 1000,
        meta: { genre, bpm: String(bpm), key: musicalKey },
      };
      setBeat(generated);
      onGenerated?.(generated);
      if (data.creditsRemaining !== undefined) refreshProfile();
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-5">
        <div>
          <Label className="text-white/70 text-sm mb-2 block">Describe the vibe</Label>
          <Textarea
            value={vibe}
            onChange={(e) => setVibe(e.target.value)}
            placeholder="Dark piano melody, heavy 808s, rolling hi-hats — late-night driving energy…"
            rows={4}
            className={textareaClass}
          />
        </div>

        <div>
          <Label className="text-white/70 text-sm mb-2 block">Genre</Label>
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
              <Timer className="w-3.5 h-3.5" /> BPM
            </Label>
            <Input
              type="number" min={60} max={200} value={bpm}
              onChange={(e) => setBpm(Math.min(200, Math.max(60, Number(e.target.value) || 140)))}
              className={inputClass}
            />
          </div>
          <div>
            <Label className="text-white/70 text-sm mb-2 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" /> Key
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
            <Label className="text-white/70 text-sm mb-2 block">Length</Label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className={`${inputClass} w-full px-3 appearance-none cursor-pointer [&>option]:bg-zinc-900`}
            >
              {DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-white/70 text-sm mb-2 block">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Midnight Run"
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
            <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Cooking your beat…</>
          ) : (
            <><Sparkles className="w-5 h-5 mr-2" /> Generate Beat · 3 credits</>
          )}
        </Button>
        <p className="text-xs text-white/40 text-center -mt-2">
          Instrumental only — no vocals. Full arrangement with intro &amp; outro.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
          <Music4 className="w-4 h-4 text-primary" /> Your beat
        </h3>
        {beat ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-black/40 border border-white/10 p-4">
              <p className="text-white font-medium truncate">{beat.title}</p>
              <p className="text-white/40 text-xs mt-0.5">
                {genre} · {bpm} BPM · {musicalKey} · {Math.round(beat.durationMs / 1000)}s
              </p>
              <audio src={beat.url} controls className="w-full mt-3" />
            </div>
            <div className="grid gap-2">
              <a
                href={beat.url} download={`${beat.title}.mp3`}
                className="flex items-center justify-center gap-2 h-10 rounded-xl border border-white/15 text-white/80 text-sm hover:border-white/30 hover:text-white transition-colors"
              >
                <Download className="w-4 h-4" /> Download MP3
              </a>
              {/* Hub handoffs — the beat flows into the next steps */}
              <Link
                href="/stems"
                className="flex items-center justify-center gap-2 h-10 rounded-xl border border-primary/40 text-primary text-sm font-medium hover:bg-primary/10 transition-colors"
              >
                <Scissors className="w-4 h-4" /> Split into stems
              </Link>
              <Link
                href="/beats"
                className="flex items-center justify-center gap-2 h-10 rounded-xl border border-white/15 text-white/80 text-sm hover:border-white/30 hover:text-white transition-colors"
              >
                <Store className="w-4 h-4" /> Sell on Beats Marketplace
              </Link>
              <Link
                href="/make-song"
                className="flex items-center justify-center gap-2 h-10 rounded-xl border border-white/15 text-white/80 text-sm hover:border-white/30 hover:text-white transition-colors"
              >
                <Disc3 className="w-4 h-4" /> Turn it into a full song
              </Link>
            </div>
          </div>
        ) : (
          <div className="h-48 rounded-xl border border-dashed border-white/15 flex flex-col items-center justify-center text-center p-6">
            <Wand2 className="w-8 h-8 text-white/20 mb-3" />
            <p className="text-white/40 text-sm">
              Your generated beat lands here — then split it, sell it, or build a song on it.
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
  { id: "kick",  label: "Kick",      color: "bg-amber-400" },
  { id: "snare", label: "Snare",     color: "bg-rose-400" },
  { id: "clap",  label: "Clap",      color: "bg-orange-400" },
  { id: "chat",  label: "Closed Hat",color: "bg-sky-400" },
  { id: "ohat",  label: "Open Hat",  color: "bg-cyan-300" },
  { id: "b808",  label: "808",       color: "bg-violet-400" },
  { id: "perc",  label: "Perc",      color: "bg-emerald-400" },
  { id: "shk",   label: "Shaker",    color: "bg-lime-300" },
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
const PRESETS: Record<string, { name: string; bpm: number; grid: boolean[][] }> = {
  trap: {
    name: "Trap", bpm: 140,
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
    name: "Drill", bpm: 142,
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
    name: "Boom Bap", bpm: 92,
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
    name: "Afrobeats", bpm: 102,
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

function SequencerTab() {
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
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
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
          {playing ? <><Square className="w-4 h-4 mr-2" /> Stop</> : <><Play className="w-4 h-4 mr-2" /> Play</>}
        </Button>
        <div className="flex items-center gap-2 flex-1 min-w-[180px]">
          <Label className="text-white/60 text-xs whitespace-nowrap w-14">BPM {bpm}</Label>
          <input
            type="range" min={60} max={200} value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            className="flex-1 accent-amber-400"
          />
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-[180px]">
          <Label className="text-white/60 text-xs whitespace-nowrap w-16">Swing {Math.round(swing * 100)}%</Label>
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
            {p.name}
          </button>
        ))}
        <button
          type="button" onClick={randomize}
          className="px-3 py-1.5 rounded-full text-sm border border-white/15 text-white/60 hover:border-primary/60 hover:text-white transition-colors flex items-center gap-1.5"
        >
          <Shuffle className="w-3.5 h-3.5" /> Randomize
        </button>
        <button
          type="button" onClick={() => { stop(); setGrid(emptyGrid()); }}
          className="px-3 py-1.5 rounded-full text-sm border border-white/15 text-white/60 hover:border-red-400/60 hover:text-white transition-colors flex items-center gap-1.5"
        >
          <Trash2 className="w-3.5 h-3.5" /> Clear
        </button>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="min-w-[640px] space-y-1.5">
          {TRACKS.map((tr, ti) => (
            <div key={tr.id} className="flex items-center gap-1.5">
              <div className="w-24 shrink-0 text-xs text-white/60 font-medium truncate">{tr.label}</div>
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
                      aria-label={`${tr.label} step ${s + 1} ${on ? "on" : "off"}`}
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
          Export WAV · Free
        </Button>
        <Link
          href="/stems"
          className="flex items-center gap-2 h-11 px-5 rounded-xl border border-primary/40 text-primary text-sm font-medium hover:bg-primary/10 transition-colors"
        >
          <Scissors className="w-4 h-4" /> Split exported beat into stems
        </Link>
        <Link
          href="/beats"
          className="flex items-center gap-2 h-11 px-5 rounded-xl border border-white/15 text-white/80 text-sm hover:border-white/30 hover:text-white transition-colors"
        >
          <Store className="w-4 h-4" /> Sell on Beats Marketplace
        </Link>
      </div>
      <p className="text-xs text-white/40">
        The sequencer is pure synthesis in your browser — no credits, no uploads. Export the WAV, then split it into stems or list it for sale.
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

/* ─── Page shell ──────────────────────────────────────────────────────────── */

export function BeatMakerModule({ onGenerated }: { onGenerated?: (beat: GeneratedBeat) => void }) {
  const [tab, setTab] = useState<"ai" | "seq">("ai");

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
          <Sparkles className="w-4 h-4" /> AI Beat
        </button>
        <button
          type="button"
          onClick={() => setTab("seq")}
          className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
            tab === "seq" ? "bg-primary text-black" : "text-white/60 hover:text-white"
          }`}
        >
          <Pause className="w-4 h-4 rotate-90" /> Step Sequencer
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-400/20 text-emerald-300 font-bold">FREE</span>
        </button>
      </div>

      {tab === "ai" ? <AiBeatTab onGenerated={onGenerated} /> : <SequencerTab />}
    </div>
  );
}

export default function BeatMaker() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl font-black text-white">Beat Maker</h1>
          <MarketingBadge variant="muted">New</MarketingBadge>
        </div>
        <p className="text-white/50 mt-2 max-w-2xl">
          Make the beat two ways: describe the vibe and let AI cook a full instrumental,
          or program drums yourself on the step sequencer. Either way, it flows straight
          into stems, songs, and the marketplace.
        </p>
      </div>

      <BeatMakerModule />
    </div>
  );
}
