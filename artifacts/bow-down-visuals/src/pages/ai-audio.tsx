import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Loader2, Download, Play, Pause, Square, Shuffle,
  Trash2, Wand2, Disc3, Scissors, Store, Music4, Timer, KeyRound,
  SlidersHorizontal, Lock, Tag, AudioWaveform, ArrowLeft, AlertTriangle,
  CheckCircle2, FileArchive, Zap, Bomb, Wind, TrendingUp, MousePointerClick,
  Cloud, Footprints, Library, Package, Check, Sparkles, Copy, ClipboardPaste,
  Volume2, VolumeX, Clapperboard, Piano,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { stashBeatHandoff } from "@/lib/beat-handoff";
import { useAuth } from "@/contexts/AuthContext";
import { useUserMode } from "@/contexts/UserModeContext";
import { CREDIT_COSTS } from "@/lib/credit-costs";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import ShareMenu from "@/components/ShareMenu";
import { useHubProject } from "@/lib/hub-project";
import { usePageTitle } from "@/hooks/use-page-title";
import { ProducerTagMaker } from "@/components/producer-tag/ProducerTagMaker";
import {
  PACK_SIZE_OPTIONS, creditsForSize, originBadge, formatDuration,
  type SampleOrigin,
} from "@/lib/sample-pack";
import {
  loadSfxLibrary, saveSfxItem, removeSfxItem, createZip, encodeWav, sfxSlug,
  type SfxItem,
} from "@/lib/sfx";
/* ─── Beat Maker ────────────────────────────────────────────────────────────
   The first module of the One Unified Creation Hub.
   AI Beat (default, dead simple): describe the vibe, get a studio instrumental
   (300 Visual Bucs, ElevenLabs Music, instrumental-only prompt). Hands off to
   the Stem Splitter and the Beats Marketplace.
   Step Sequencer (Advanced mode — Creator Level 6): 16-step drum machine,
   100% client-side Web Audio synthesis (zero provider cost → free). Presets,
   swing, WAV export. */

/* Single source of truth for the AI beat price — the credit-cost registry. */
const BEAT_COST = CREDIT_COSTS["/api/beat/generate"]?.cost ?? 300;

const BEAT_GENRES = [
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

const beatInputClass =
  "h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 " +
  "focus:border-primary/50 focus:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/25 " +
  "focus-visible:ring-offset-0 transition-colors rounded-xl";
const beatTextareaClass =
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
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { refreshProfile, getAccessToken } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [vibe, setVibe] = useState("");
  const [genre, setGenre] = useState<string>("trap");
  const [bpm, setBpm] = useState(140);
  const [musicalKey, setMusicalKey] = useState("C");
  const [duration, setDuration] = useState(60);
  const [title, setTitle] = useState("");
  const [generating, setGenerating] = useState(false);
  const [beat, setBeat] = useState<GeneratedBeat | null>(null);
  const { addAsset } = useHubProject();
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
      /* The beat flows into the project — make-song, stems and the hub rail can pick it up. */
      addAsset({
        kind: "beat",
        url: data.url,
        label: generated.title,
        detail: `${genre} · ${bpm} BPM · ${musicalKey}`,
        meta: { genre, bpm: String(bpm), key: musicalKey },
      });
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
      <div className={`rounded-2xl border p-6 space-y-5 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
        <div>
          <Label className="text-white/70 text-sm mb-2 block">{t("beatMaker.vibeLabel")}</Label>
          <Textarea
            value={vibe}
            onChange={(e) => setVibe(e.target.value)}
            placeholder={t("beatMaker.vibePlaceholder")}
            rows={4}
            className={beatTextareaClass}
          />
        </div>

        <div>
          <Label className="text-white/70 text-sm mb-2 block">{t("beatMaker.genreLabel")}</Label>
          <div className="flex flex-wrap gap-2">
            {BEAT_GENRES.map((g) => (
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

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 [&>*]:min-w-0">
          <div>
            <Label className="text-white/70 text-sm mb-2 flex items-center gap-1.5">
              <Timer className="w-3.5 h-3.5" /> {t("beatMaker.bpmLabel")}
            </Label>
            <Input
              type="number" min={60} max={200} value={bpm}
              onChange={(e) => setBpm(Math.min(200, Math.max(60, Number(e.target.value) || 140)))}
              className={`${beatInputClass} w-full`}
            />
          </div>
          <div>
            <Label className="text-white/70 text-sm mb-2 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" /> {t("beatMaker.keyLabel")}
            </Label>
            <select
              value={musicalKey}
              onChange={(e) => setMusicalKey(e.target.value)}
              className={`${beatInputClass} w-full px-3 appearance-none cursor-pointer [&>option]:bg-zinc-900`}
            >
              {KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-white/70 text-sm mb-2 block">{t("beatMaker.lengthLabel")}</Label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className={`${beatInputClass} w-full px-3 appearance-none cursor-pointer [&>option]:bg-zinc-900`}
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
              className={`${beatInputClass} w-full`}
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>
        )}

        <Button
          onClick={generate}
          disabled={generating || !vibe.trim()}
          className={`w-full h-12 rounded-xl font-bold disabled:cursor-not-allowed ${!vibe.trim() && !generating ? (isLight ? "border border-[#C9A84C]/60 bg-[#EFE3C2] text-[#7A5A12] shadow-none" : "border border-primary/30 bg-primary/20 text-primary/70 shadow-none") : "bg-primary text-black hover:bg-primary/90"}`}
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

      <div className={`rounded-2xl border p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
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
              {/* Hub handoffs — the beat flows into the next steps (URL carries it; the hub tray keeps it too) */}
              <Link
                href={`/audio-studio?tab=stems&audioUrl=${encodeURIComponent(beat.url)}`}
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
                href={`/make-song?audioUrl=${encodeURIComponent(beat.url)}`}
                className="flex items-center justify-center gap-2 h-10 rounded-xl border border-white/15 text-white/80 text-sm hover:border-white/30 hover:text-white transition-colors"
              >
                <Disc3 className="w-4 h-4" /> {t("beatMaker.turnIntoSong")}
              </Link>
              <div data-testid="btn-beat-share">
                <ShareMenu
                  getToken={getAccessToken}
                  shareUrl={beat.url}
                  text={beat.title}
                  contentType="song"
                />
              </div>
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
  { id: "crash", labelKey: "beatMaker.trackCrash",     color: "bg-fuchsia-400" },
] as const;

type TrackId = typeof TRACKS[number]["id"];
const STEPS = 16;

/* Synthesize one drum hit at time t. All sounds are oscillator/noise based —
   no samples, no network. vel: 1 = normal, >1 = accent. */
function synthHit(ctx: BaseAudioContext, id: TrackId, t: number, dest: AudioNode, vel = 1) {
  const g = ctx.createGain();
  g.gain.value = vel;
  g.connect(dest);

  if (id === "kick") {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    o.connect(g); o.start(t); o.stop(t + 0.26);
  } else if (id === "b808") {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.3);
    g.gain.setValueAtTime(0.9 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(g); o.start(t); o.stop(t + 0.6);
  } else if (id === "snare") {
    noiseBurst(ctx, t, 0.18, 1800, g, 0.7);
    const o = ctx.createOscillator();
    o.type = "triangle"; o.frequency.setValueAtTime(190, t);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.5 * vel, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    o.connect(g2); g2.connect(dest); o.start(t); o.stop(t + 0.12);
  } else if (id === "clap") {
    [0, 0.012, 0.024].forEach((off) => noiseBurst(ctx, t + off, 0.09, 1200, g, 0.4));
    noiseBurst(ctx, t + 0.036, 0.22, 1000, g, 0.5);
  } else if (id === "chat") {
    noiseBurst(ctx, t, 0.05, 8000, g, 0.32, "highpass");
  } else if (id === "ohat") {
    noiseBurst(ctx, t, 0.32, 7500, g, 0.3, "highpass");
  } else if (id === "crash") {
    noiseBurst(ctx, t, 1.1, 5200, g, 0.34, "highpass");
    noiseBurst(ctx, t, 0.5, 9000, g, 0.18, "highpass");
  } else if (id === "perc") {
    const o = ctx.createOscillator();
    o.type = "square"; o.frequency.setValueAtTime(620, t);
    g.gain.setValueAtTime(0.22 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g); o.start(t); o.stop(t + 0.1);
  } else { // shk
    noiseBurst(ctx, t, 0.09, 6000, g, 0.18, "highpass");
  }
}

/* 808 bass note with a short pitch glide into the target. midi: 24 (C1)..47 (B2). */
function synthBass(ctx: BaseAudioContext, midi: number, t: number, dest: AudioNode, vel = 1, prevMidi: number | null = null) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const o = ctx.createOscillator();
  o.type = "sine";
  if (prevMidi != null) {
    const pf = 440 * Math.pow(2, (prevMidi - 69) / 12);
    o.frequency.setValueAtTime(Math.max(20, pf), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f), t + 0.045);
  } else {
    o.frequency.setValueAtTime(Math.max(20, f), t);
  }
  const o2 = ctx.createOscillator();
  o2.type = "triangle";
  o2.frequency.setValueAtTime(Math.max(20, f * 2), t);
  const g = ctx.createGain();
  const g2 = ctx.createGain();
  g2.gain.value = 0.16;
  const dur = 0.85;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9 * vel, t + 0.014);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); o2.connect(g2); g2.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.05);
  o2.start(t); o2.stop(t + dur + 0.05);
}

export const midiToNoteName = (midi: number): string => {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
};

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

/* Presets — classic starting patterns. Values: 0 = off, 1 = hit, 2 = accent.
   Rows: kick,snare,clap,chat,ohat,808,perc,shk,crash. Bass: MIDI notes per step (null = rest). */
const PRESETS: Record<string, { nameKey: string; fallback: string; bpm: number; grid: number[][]; bass: (number | null)[] }> = {
  trap: {
    nameKey: "beatMaker.presetTrap", fallback: "Trap", bpm: 140,
    grid: [
      [1,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      [0,0,0,0,1,0,0,1,0,0,0,0,1,0,0,0],
      [1,0,2,1,0,1,0,1,1,0,1,2,0,1,1,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
      [1,0,0,0,0,0,0,0,0,0,1,0,0,1,0,0],
      [0,0,1,0,0,0,1,0,0,0,0,0,1,0,0,0],
      [1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ],
    bass: [36,null,null,null,null,null,36,null,null,null,34,null,32,null,31,null],
  },
  drill: {
    nameKey: "beatMaker.presetDrill", fallback: "Drill", bpm: 142,
    grid: [
      [1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,2],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,1,0,1,0,1,1,0,1,0,1,1,0,1,0,1],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0],
      [0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ],
    bass: [33,null,null,33,null,null,33,null,31,null,null,29,null,null,null,null],
  },
  boombap: {
    nameKey: "beatMaker.presetBoomBap", fallback: "Boom Bap", bpm: 92,
    grid: [
      [2,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0],
      [0,0,0,0,2,0,0,0,0,0,0,0,1,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,0,1,0,1,0,1,0,1,0,1,0,1,1,0,1],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,1,0,0,1,0,0,1,0,0,0,0,1,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ],
    bass: [36,null,null,null,null,null,null,null,43,null,null,null,41,null,null,null],
  },
  afrobeats: {
    nameKey: "beatMaker.presetAfrobeats", fallback: "Afrobeats", bpm: 102,
    grid: [
      [1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,0],
      [0,0,1,0,0,0,1,0,0,0,0,0,1,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0],
      [1,0,1,1,0,1,1,0,1,1,0,1,1,0,1,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,0,0,0,1,0,0,1,0,0,1,0,0,1,0,0],
      [1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ],
    bass: [36,null,null,null,36,null,null,null,34,null,null,null,32,null,null,null],
  },
  house: {
    nameKey: "beatMaker.presetHouse", fallback: "House", bpm: 124,
    grid: [
      [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
      [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],
      [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],
      [0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ],
    bass: [36,null,null,null,36,null,null,null,36,null,null,null,39,null,38,null],
  },
};

const emptyGrid = () => TRACKS.map(() => Array(STEPS).fill(0));
const emptyBass = (): (number | null)[] => Array(STEPS).fill(null);

/* 808 bass range: C1 (24) .. B2 (47) */
const BASS_LO = 24;
const BASS_HI = 47;

type PatternId = "A" | "B" | "C" | "D";
const PATTERN_IDS: PatternId[] = ["A", "B", "C", "D"];
interface PatternData { grid: number[][]; bass: (number | null)[] }

function SequencerTab({ onGenerated }: { onGenerated?: (beat: GeneratedBeat) => void }) {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const [, navigate] = useLocation();
  const [patterns, setPatterns] = useState<Record<PatternId, PatternData>>(() => ({
    A: { grid: PRESETS.trap.grid.map((r) => [...r]), bass: [...PRESETS.trap.bass] },
    B: { grid: emptyGrid(), bass: emptyBass() },
    C: { grid: emptyGrid(), bass: emptyBass() },
    D: { grid: emptyGrid(), bass: emptyBass() },
  }));
  const [activePat, setActivePat] = useState<PatternId>("A");
  const [bpm, setBpm] = useState(140);
  const [swing, setSwing] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(-1);
  const [exporting, setExporting] = useState(false);
  const [sending, setSending] = useState(false);
  const [showMixer, setShowMixer] = useState(false);
  const [showBass, setShowBass] = useState(false);
  const [vol, setVol] = useState<number[]>(() => TRACKS.map(() => 1));
  const [mute, setMute] = useState<boolean[]>(() => TRACKS.map(() => false));
  const [solo, setSolo] = useState<boolean[]>(() => TRACKS.map(() => false));
  const [bassVol, setBassVol] = useState(0.9);
  const [bassMute, setBassMute] = useState(false);
  const [bassPaint, setBassPaint] = useState(36); // C2 — pitch painted by bass roll clicks
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const stepRef = useRef(0);
  const nextTimeRef = useRef(0);
  const tapsRef = useRef<number[]>([]);
  const clipRef = useRef<{ grid: number[][]; bass: (number | null)[] } | null>(null);
  const gainCache = useRef(new WeakMap<BaseAudioContext, { drums: GainNode[]; bass: GainNode }>());

  const grid = patterns[activePat]!.grid;
  const bass = patterns[activePat]!.bass;
  const gridRef = useRef(grid);
  const bassRef = useRef(bass);
  const bpmRef = useRef(bpm);
  const swingRef = useRef(swing);
  gridRef.current = grid;
  bassRef.current = bass;
  bpmRef.current = bpm;
  swingRef.current = swing;

  /* ── theme tones ── */
  const T = {
    card: isLight
      ? "border-[#c9a84c]/30 bg-gradient-to-br from-[#FFFDF8] via-[#F7F1E3] to-[#EFE6D0]"
      : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]",
    label: isLight ? "text-[#4A3B22]/70" : "text-white/60",
    heading: isLight ? "text-[#2A2118]" : "text-white",
    dim: isLight ? "text-[#4A3B22]/50" : "text-white/40",
    pill: isLight
      ? "border-[#c9a84c]/30 text-[#4A3B22] hover:border-[#c9a84c]/60 hover:text-[#2A2118]"
      : "border-white/15 text-white/60 hover:border-primary/60 hover:text-white",
    cellOff: isLight
      ? "bg-[#8a6d2f]/[0.07] border-[#8a6d2f]/15 hover:bg-[#8a6d2f]/[0.18]"
      : "bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.1]",
    cellOffBeat: isLight
      ? "bg-[#8a6d2f]/[0.15] border-[#8a6d2f]/25 hover:bg-[#8a6d2f]/[0.24]"
      : "bg-white/[0.07] border-white/10 hover:bg-white/[0.14]",
    patActive: "bg-primary text-black border-transparent font-black",
    slider: "accent-[#C9A84C]",
  };

  /* ── mixer gain graph ── */
  const getGains = (ctx: BaseAudioContext) => {
    let e = gainCache.current.get(ctx);
    if (!e) {
      const drums = TRACKS.map(() => {
        const gn = ctx.createGain();
        gn.connect(ctx.destination);
        return gn;
      });
      const bassG = ctx.createGain();
      bassG.connect(ctx.destination);
      e = { drums, bass: bassG };
      gainCache.current.set(ctx, e);
    }
    return e;
  };
  const applyMixer = useCallback((ctx: BaseAudioContext, v: number[], m: boolean[], s: boolean[], bv: number, bm: boolean) => {
    const { drums, bass: bassG } = getGains(ctx);
    const anySolo = s.some(Boolean);
    TRACKS.forEach((_, ti) => {
      const audible = anySolo ? s[ti] : !m[ti];
      drums[ti]!.gain.value = audible ? v[ti]! : 0;
    });
    bassG.gain.value = bm ? 0 : bv;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getCtx = () => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    if (ctxRef.current.state === "suspended") void ctxRef.current.resume();
    applyMixer(ctxRef.current, vol, mute, solo, bassVol, bassMute);
    return ctxRef.current;
  };
  // Re-apply mixer when faders change during playback
  useEffect(() => {
    if (ctxRef.current && playing) applyMixer(ctxRef.current, vol, mute, solo, bassVol, bassMute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vol, mute, solo, bassVol, bassMute]);

  const scheduleStep = useCallback((s: number, time: number) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { drums, bass: bassG } = getGains(ctx);
    const sw = swingRef.current;
    // Swing delays off-beat 16ths (odd steps), 0–100%
    const when = s % 2 === 1 ? time + (60 / bpmRef.current / 4) * sw : time;
    const g = gridRef.current;
    TRACKS.forEach((tr, ti) => {
      const v = g[ti]?.[s] ?? 0;
      if (v > 0) synthHit(ctx, tr.id, when, drums[ti]!, v === 2 ? 1.4 : 1);
    });
    const bn = bassRef.current[s];
    if (bn != null) {
      const prev = s > 0 ? bassRef.current[s - 1] : null;
      synthBass(ctx, bn, when, bassG, 1, prev);
    }
    // UI highlight slightly ahead-safe: update on the audio clock via timeout
    const ms = Math.max(0, (when - ctx.currentTime) * 1000);
    window.setTimeout(() => setStep(s), ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /* ── grid editing: click toggles, right-click toggles accent ── */
  const patchActive = (fn: (p: PatternData) => PatternData) => {
    setPatterns((prev) => ({ ...prev, [activePat]: fn({ grid: prev[activePat]!.grid.map((r) => [...r]), bass: [...prev[activePat]!.bass] }) }));
  };
  const toggle = (ti: number, s: number) => {
    patchActive((p) => {
      p.grid[ti]![s] = p.grid[ti]![s] === 0 ? 1 : 0;
      return p;
    });
  };
  const toggleAccent = (ti: number, s: number) => {
    patchActive((p) => {
      const cur = p.grid[ti]![s] ?? 0;
      p.grid[ti]![s] = cur === 2 ? 1 : 2;
      return p;
    });
  };
  const toggleBass = (midi: number, s: number) => {
    patchActive((p) => {
      p.bass[s] = p.bass[s] === midi ? null : midi;
      return p;
    });
  };

  const loadPreset = (key: string) => {
    const p = PRESETS[key];
    if (!p) return;
    stop();
    patchActive(() => ({ grid: p.grid.map((r) => [...r]), bass: [...p.bass] }));
    setBpm(p.bpm);
  };

  const randomize = () => {
    stop();
    patchActive(() => ({
      grid: TRACKS.map((_, ti) =>
        Array.from({ length: STEPS }, (_, s) => {
          const density = [0.35, 0.14, 0.1, 0.75, 0.08, 0.3, 0.22, 0.4, 0.05][ti] ?? 0.2;
          if (ti === 1 && s % 4 !== 0 && Math.random() < 0.85) return 0;
          const r = Math.random();
          return r < density * 0.25 ? 2 : r < density ? 1 : 0;
        })
      ),
      bass: Array.from({ length: STEPS }, (_, s) =>
        s % 4 === 0 && Math.random() < 0.7 ? [36, 36, 34, 32][Math.floor(Math.random() * 4)]! : null
      ),
    }));
  };

  /* ── patterns A/B/C/D ── */
  const copyPattern = () => {
    const p = patterns[activePat]!;
    clipRef.current = { grid: p.grid.map((r) => [...r]), bass: [...p.bass] };
  };
  const pastePattern = () => {
    if (!clipRef.current) return;
    const c = clipRef.current;
    patchActive(() => ({ grid: c.grid.map((r) => [...r]), bass: [...c.bass] }));
  };
  const clearPattern = () => {
    stop();
    patchActive(() => ({ grid: emptyGrid(), bass: emptyBass() }));
  };

  /* ── tap tempo ── */
  const tapTempo = () => {
    const now = performance.now();
    const taps = tapsRef.current.filter((ts) => now - ts < 2500);
    taps.push(now);
    tapsRef.current = taps;
    if (taps.length >= 2) {
      const intervals = taps.slice(1).map((ts, i) => ts - taps[i]!);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      setBpm(Math.min(200, Math.max(60, Math.round(60000 / avg))));
    }
  };

  /* ── offline render (shared by WAV export + Send to Visual Vibes) ── */
  const renderBeat = async (bars = 4) => {
    const totalSteps = STEPS * bars;
    const stepDur = 60 / bpmRef.current / 4;
    const totalDur = totalSteps * stepDur + 1.2;
    const sampleRate = 44100;
    const off = new OfflineAudioContext(2, Math.ceil(totalDur * sampleRate), sampleRate);
    applyMixer(off, vol, mute, solo, bassVol, bassMute);
    const { drums, bass: bassG } = getGains(off);
    const g = gridRef.current;
    const bn = bassRef.current;
    const sw = swingRef.current;
    for (let s = 0; s < totalSteps; s++) {
      const si = s % STEPS;
      const tt = s * stepDur + (si % 2 === 1 ? stepDur * sw : 0);
      TRACKS.forEach((tr, ti) => {
        const v = g[ti]?.[si] ?? 0;
        if (v > 0) synthHit(off, tr.id, tt, drums[ti]!, v === 2 ? 1.4 : 1);
      });
      const note = bn[si];
      if (note != null) synthBass(off, note, tt, bassG, 1, si > 0 ? bn[si - 1] : null);
    }
    const rendered = await off.startRendering();
    const blob = audioBufferToWav(rendered);
    return { blob, url: URL.createObjectURL(blob), durationSec: totalDur };
  };

  /* Render 4 bars offline → WAV → download. Pure client-side. */
  const exportWav = async () => {
    setExporting(true);
    try {
      const { blob, url, durationSec } = await renderBeat(4);
      const a = document.createElement("a");
      a.href = url;
      a.download = `beat-${bpm}bpm.wav`;
      a.click();
      // Keep the blob URL alive for this session so the hub project can use it.
      onGenerated?.({
        url,
        title: t("beatMaker.sequencerBeatTitle", { bpm, defaultValue: `Sequencer beat · ${bpm} BPM` }),
        durationMs: Math.round(durationSec * 1000),
        meta: { bpm: String(bpm), source: "sequencer", sessionOnly: "1" },
      });
      void blob;
    } finally {
      setExporting(false);
    }
  };

  /* Render → stash → open the video editor with the beat as a timeline stem. */
  const sendToVisualVibes = async () => {
    setSending(true);
    try {
      const { blob, url, durationSec } = await renderBeat(4);
      const id = stashBeatHandoff({
        blob,
        url,
        title: t("beatMaker.sequencerBeatTitle", { bpm, defaultValue: `Sequencer beat · ${bpm} BPM` }),
        bpm,
        durationSec,
      });
      stop();
      navigate(`/video-editor?beathandoff=${id}&tab=music`);
    } finally {
      setSending(false);
    }
  };

  const bassRows = Array.from({ length: BASS_HI - BASS_LO + 1 }, (_, i) => BASS_HI - i);

  return (
    <div className={`rounded-2xl border p-6 space-y-5 ${T.card}`}>
      {/* Transport */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={playing ? stop : start}
          className={`h-11 px-6 rounded-xl font-bold ${playing ? "bg-red-500 hover:bg-red-600 text-white" : "bg-primary text-black hover:bg-primary/90"}`}
        >
          {playing ? <><Square className="w-4 h-4 mr-2" /> {t("beatMaker.stop", { defaultValue: "Stop" })}</> : <><Play className="w-4 h-4 mr-2" /> {t("beatMaker.play", { defaultValue: "Play" })}</>}
        </Button>
        <div className="flex items-center gap-2">
          <Button
            type="button" onClick={tapTempo} variant="outline"
            className={`h-11 px-4 rounded-xl text-sm font-bold ${T.pill}`}
            title={t("beatMaker.tapTempoHint", { defaultValue: "Tap to set tempo" })}
          >
            <Timer className="w-4 h-4 mr-1.5" /> {t("beatMaker.tapTempo", { defaultValue: "Tap" })}
          </Button>
          <span className={`text-2xl font-black tabular-nums w-14 text-center ${T.heading}`}>{bpm}</span>
          <span className={`text-xs ${T.dim}`}>BPM</span>
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-[180px]">
          <Label className={`${T.label} text-xs whitespace-nowrap`}>{t("beatMaker.bpmLabel", { defaultValue: "Tempo" })}</Label>
          <input
            type="range" min={60} max={200} value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            className={`flex-1 ${T.slider}`}
            aria-label="BPM"
          />
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-[180px]">
          <Label className={`${T.label} text-xs whitespace-nowrap`}>{t("beatMaker.swingLabel", { defaultValue: "Swing" })}</Label>
          <input
            type="range" min={0} max={1} step={0.01} value={swing}
            onChange={(e) => setSwing(Number(e.target.value))}
            className={`flex-1 ${T.slider}`}
            aria-label="Swing"
          />
          <span className={`text-xs tabular-nums w-10 ${T.dim}`}>{Math.round(swing * 100)}%</span>
        </div>
      </div>

      {/* Pattern slots + tools */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-xs font-bold uppercase tracking-wider ${T.label}`}>{t("beatMaker.pattern", { defaultValue: "Pattern" })}</span>
        {PATTERN_IDS.map((pid) => (
          <button
            key={pid} type="button"
            onClick={() => { stop(); setActivePat(pid); }}
            className={`w-9 h-9 rounded-lg border text-sm transition-colors ${activePat === pid ? T.patActive : T.pill}`}
          >
            {pid}
          </button>
        ))}
        <span className={`mx-1 h-6 w-px ${isLight ? "bg-[#8a6d2f]/20" : "bg-white/10"}`} />
        <button type="button" onClick={copyPattern} className={`px-3 py-1.5 rounded-full text-sm border flex items-center gap-1.5 transition-colors ${T.pill}`}>
          <Copy className="w-3.5 h-3.5" /> {t("beatMaker.copy", { defaultValue: "Copy" })}
        </button>
        <button type="button" onClick={pastePattern} disabled={!clipRef.current} className={`px-3 py-1.5 rounded-full text-sm border flex items-center gap-1.5 transition-colors disabled:opacity-40 ${T.pill}`}>
          <ClipboardPaste className="w-3.5 h-3.5" /> {t("beatMaker.paste", { defaultValue: "Paste" })}
        </button>
        <button type="button" onClick={clearPattern} className={`px-3 py-1.5 rounded-full text-sm border flex items-center gap-1.5 transition-colors ${T.pill} hover:!border-red-400/60`}>
          <Trash2 className="w-3.5 h-3.5" /> {t("beatMaker.clear", { defaultValue: "Clear" })}
        </button>
      </div>

      {/* Presets + randomize */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(PRESETS).map(([key, p]) => (
          <button
            key={key} type="button" onClick={() => loadPreset(key)}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${T.pill}`}
          >
            {t(p.nameKey, { defaultValue: p.fallback })}
          </button>
        ))}
        <button
          type="button" onClick={randomize}
          className={`px-3 py-1.5 rounded-full text-sm border flex items-center gap-1.5 transition-colors ${T.pill}`}
        >
          <Shuffle className="w-3.5 h-3.5" /> {t("beatMaker.randomize", { defaultValue: "Randomize" })}
        </button>
        <button
          type="button"
          onClick={() => setShowMixer((v) => !v)}
          className={`px-3 py-1.5 rounded-full text-sm border flex items-center gap-1.5 transition-colors ${T.pill} ${showMixer ? "!border-[#C9A84C] !text-[#C9A84C]" : ""}`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" /> {t("beatMaker.mixer", { defaultValue: "Mixer" })}
        </button>
        <button
          type="button"
          onClick={() => setShowBass((v) => !v)}
          className={`px-3 py-1.5 rounded-full text-sm border flex items-center gap-1.5 transition-colors ${T.pill} ${showBass ? "!border-[#C9A84C] !text-[#C9A84C]" : ""}`}
        >
          <Piano className="w-3.5 h-3.5" /> {t("beatMaker.bassline", { defaultValue: "808 Bass" })}
        </button>
      </div>

      {/* Drum grid — click toggles, right-click toggles accent */}
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="min-w-[640px] space-y-1.5">
          {TRACKS.map((tr, ti) => (
            <div key={tr.id} className="flex items-center gap-1.5">
              <div className="w-24 shrink-0 flex items-center gap-1">
                <button
                  type="button" onClick={() => setMute((m) => m.map((v, i) => (i === ti ? !v : v)))}
                  className={`w-5 h-5 rounded text-[9px] font-black border transition-colors ${mute[ti] ? "bg-red-500/80 border-red-400 text-white" : T.pill}`}
                  title={t("beatMaker.mute", { defaultValue: "Mute" })}
                >M</button>
                <button
                  type="button" onClick={() => setSolo((s) => s.map((v, i) => (i === ti ? !v : v)))}
                  className={`w-5 h-5 rounded text-[9px] font-black border transition-colors ${solo[ti] ? "bg-[#C9A84C] border-[#C9A84C] text-black" : T.pill}`}
                  title={t("beatMaker.solo", { defaultValue: "Solo" })}
                >S</button>
                <span className={`text-xs font-medium truncate ${T.label}`}>{t(tr.labelKey, { defaultValue: tr.id })}</span>
              </div>
              <div className="grid gap-1 flex-1" style={{ gridTemplateColumns: `repeat(${STEPS}, minmax(0,1fr))` }}>
                {Array.from({ length: STEPS }, (_, s) => {
                  const v = grid[ti]?.[s] ?? 0;
                  const isBeat = s % 4 === 0;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggle(ti, s)}
                      onContextMenu={(e) => { e.preventDefault(); toggleAccent(ti, s); }}
                      className={`aspect-square rounded-md border transition-all ${
                        v > 0
                          ? `${tr.color} border-transparent shadow-[0_0_8px_rgba(255,255,255,0.25)] ${v === 2 ? "outline outline-2 outline-[#C9A84C] outline-offset-1" : ""}`
                          : isBeat ? T.cellOffBeat : T.cellOff
                      } ${step === s && playing ? "ring-2 ring-white/70" : ""}`}
                      aria-label={t("beatMaker.stepAria", { label: t(tr.labelKey, { defaultValue: tr.id }), n: s + 1, state: v === 2 ? t("beatMaker.stepAccent", { defaultValue: "accent" }) : v === 1 ? t("beatMaker.stepOn", { defaultValue: "on" }) : t("beatMaker.stepOff", { defaultValue: "off" }) })}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className={`text-xs ${T.dim}`}>
        {t("beatMaker.accentHint", { defaultValue: "Click a step to toggle · right-click for accent · gold ring = accent hit" })}
      </p>

      {/* Mixer */}
      {showMixer && (
        <div className={`rounded-xl border p-4 space-y-2 ${isLight ? "border-[#c9a84c]/25 bg-[#8a6d2f]/[0.04]" : "border-white/10 bg-black/30"}`}>
          <p className={`text-xs font-black uppercase tracking-wider ${T.label}`}>{t("beatMaker.mixerTitle", { defaultValue: "Mixer" })}</p>
          {TRACKS.map((tr, ti) => (
            <div key={tr.id} className="flex items-center gap-2">
              <span className={`w-20 text-xs truncate ${T.label}`}>{t(tr.labelKey, { defaultValue: tr.id })}</span>
              <input
                type="range" min={0} max={1.5} step={0.01} value={vol[ti]}
                onChange={(e) => setVol((v) => v.map((x, i) => (i === ti ? Number(e.target.value) : x)))}
                className={`flex-1 h-1 ${T.slider}`} aria-label={`${tr.id} volume`}
              />
              <span className={`text-xs tabular-nums w-9 text-right ${T.dim}`}>{Math.round((vol[ti] ?? 0) * 100)}%</span>
              {mute[ti] && <VolumeX className="w-3.5 h-3.5 text-red-400" />}
              {!mute[ti] && <Volume2 className={`w-3.5 h-3.5 ${T.dim}`} />}
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <span className={`w-20 text-xs font-bold ${T.label}`}>{t("beatMaker.bassVol", { defaultValue: "808 Bass" })}</span>
            <input
              type="range" min={0} max={1.5} step={0.01} value={bassVol}
              onChange={(e) => setBassVol(Number(e.target.value))}
              className={`flex-1 h-1 ${T.slider}`} aria-label="808 bass volume"
            />
            <button type="button" onClick={() => setBassMute((v) => !v)} className={`px-2 py-0.5 rounded text-[10px] font-black border ${bassMute ? "bg-red-500/80 border-red-400 text-white" : T.pill}`}>M</button>
          </div>
        </div>
      )}

      {/* 808 bass piano roll */}
      {showBass && (
        <div className={`rounded-xl border p-4 space-y-2 ${isLight ? "border-[#c9a84c]/25 bg-[#8a6d2f]/[0.04]" : "border-white/10 bg-black/30"}`}>
          <div className="flex items-center justify-between">
            <p className={`text-xs font-black uppercase tracking-wider ${T.label}`}>
              {t("beatMaker.bassTitle", { defaultValue: "808 Bassline" })}
              <span className={`ml-2 font-medium normal-case ${T.dim}`}>{t("beatMaker.bassHint", { defaultValue: "Click a cell to place the selected pitch · click again to clear" })}</span>
            </p>
            <div className="flex items-center gap-1.5">
              <span className={`text-xs ${T.label}`}>{t("beatMaker.bassPitch", { defaultValue: "Pitch" })}</span>
              <select
                value={bassPaint}
                onChange={(e) => setBassPaint(Number(e.target.value))}
                className={`h-8 rounded-lg border text-xs font-bold px-2 ${isLight ? "border-[#c9a84c]/40 bg-[#FDFBF5] text-[#2A2118]" : "border-white/15 bg-black text-white"}`}
              >
                {Array.from({ length: BASS_HI - BASS_LO + 1 }, (_, i) => BASS_LO + i).map((m) => (
                  <option key={m} value={m}>{midiToNoteName(m)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="flex items-center gap-1 mb-1">
                <div className="w-10 shrink-0" />
                <div className="grid gap-1 flex-1" style={{ gridTemplateColumns: `repeat(${STEPS}, minmax(0,1fr))` }}>
                  {Array.from({ length: STEPS }, (_, s) => (
                    <div key={s} className={`text-center text-[9px] tabular-nums ${s % 4 === 0 ? T.label : T.dim}`}>{s + 1}</div>
                  ))}
                </div>
              </div>
              <div className="space-y-[2px] max-h-64 overflow-y-auto pr-1">
                {bassRows.map((m) => {
                  const name = midiToNoteName(m);
                  const isC = name.startsWith("C");
                  const isBlack = name.includes("#");
                  return (
                    <div key={m} className="flex items-center gap-1">
                      <div className={`w-10 shrink-0 text-[10px] tabular-nums text-right pr-1 ${isC ? "font-black text-[#C9A84C]" : T.dim}`}>{name}</div>
                      <div className="grid gap-1 flex-1" style={{ gridTemplateColumns: `repeat(${STEPS}, minmax(0,1fr))` }}>
                        {Array.from({ length: STEPS }, (_, s) => {
                          const on = bass[s] === m;
                          return (
                            <button
                              key={s} type="button"
                              onClick={() => toggleBass(m, s)}
                              className={`h-4 rounded-[3px] border transition-all ${
                                on
                                  ? "bg-violet-400 border-transparent shadow-[0_0_6px_rgba(167,139,250,0.5)]"
                                  : isBlack
                                    ? isLight ? "bg-[#2A2118]/[0.06] border-[#8a6d2f]/10 hover:bg-violet-400/30" : "bg-white/[0.06] border-white/[0.08] hover:bg-violet-400/30"
                                    : isLight ? "bg-[#8a6d2f]/[0.08] border-[#8a6d2f]/15 hover:bg-violet-400/30" : "bg-white/[0.03] border-white/[0.06] hover:bg-violet-400/30"
                              } ${step === s && playing ? "ring-1 ring-white/70" : ""}`}
                              aria-label={`Bass ${name} step ${s + 1}`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Export + handoffs */}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          onClick={exportWav}
          disabled={exporting}
          className="h-11 px-5 rounded-xl bg-primary text-black font-bold hover:bg-primary/90 disabled:opacity-50"
        >
          {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
          {t("beatMaker.exportWavFree", { defaultValue: "Export WAV (free)" })}
        </Button>
        <Button
          onClick={sendToVisualVibes}
          disabled={sending}
          className={`h-11 px-5 rounded-xl font-bold border transition-colors ${isLight ? "border-[#c9a84c]/50 text-[#8a6d2f] hover:bg-[#c9a84c]/10" : "border-primary/40 text-primary hover:bg-primary/10"} disabled:opacity-50`}
          variant="outline"
        >
          {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Clapperboard className="w-4 h-4 mr-2" />}
          {t("beatMaker.sendToVisualVibes", { defaultValue: "Send to Visual Vibes" })}
        </Button>
        <Link
          href="/audio-studio?tab=stems"
          className={`flex items-center gap-2 h-11 px-5 rounded-xl border text-sm font-medium transition-colors ${isLight ? "border-[#c9a84c]/40 text-[#8a6d2f] hover:bg-[#c9a84c]/10" : "border-primary/40 text-primary hover:bg-primary/10"}`}
        >
          <Scissors className="w-4 h-4" /> {t("beatMaker.splitExportedStems", { defaultValue: "Split exported stems" })}
        </Link>
        <Link
          href="/beats"
          className={`flex items-center gap-2 h-11 px-5 rounded-xl border text-sm transition-colors ${T.pill}`}
        >
          <Store className="w-4 h-4" /> {t("beatMaker.sellMarketplace", { defaultValue: "Sell on the marketplace" })}
        </Link>
      </div>
      <p className={`text-xs ${T.dim}`}>
        {t("beatMaker.sequencerNote", { defaultValue: "100% client-side Web Audio synthesis — playing and exporting costs nothing." })}
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
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  return (
    <div className={`rounded-2xl border p-8 text-center space-y-4 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/30 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
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
  const [tab, setTab] = useState<"ai" | "seq" | "tag">(() => {
    try {
      return new URLSearchParams(window.location.search).getAll("tab").includes("tag") ? "tag" : "ai";
    } catch {
      return "ai";
    }
  });
  const { stars, setStars } = useUserMode();
  const advanced = stars >= 6;

  // Drop back to the AI tab if the user leaves Advanced mode mid-session.
  useEffect(() => {
    if (!advanced && tab === "seq") setTab("ai");
  }, [advanced, tab]);

  const enableAdvanced = () => setStars(6);

  return (
    <div className="space-y-6">

      <div className="flex flex-wrap gap-2 p-1 rounded-xl bg-white/[0.04] border border-white/10 max-w-full">
        <button
          type="button"
          onClick={() => setTab("ai")}
          className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
            tab === "ai" ? "bg-primary text-black" : "text-white/60 hover:text-white"
          }`}
        >
          <Sparkles className="w-4 h-4" /> {t("beatMaker.aiBeatTab")}
        </button>
        <button
          type="button"
          onClick={() => setTab("tag")}
          title={t("producerTag.tabTooltip")}
          className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
            tab === "tag" ? "bg-primary text-black" : "text-white/60 hover:text-white"
          }`}
        >
          <Tag className="w-4 h-4" /> {t("producerTag.tabLabel")}
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
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-400/20 text-green-300 font-bold">{t("beatMaker.freeBadge")}</span>
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
      ) : tab === "tag" ? (
        <ProducerTagMaker />
      ) : advanced ? (
        <SequencerTab onGenerated={onGenerated} />
      ) : (
        <SequencerGate onEnable={enableAdvanced} />
      )}
    </div>
  );
}

/* ─── Sample Pack Generator ────────────────────────────────────────────────
   Producers build custom packs: pick genre, BPM, key, size — get drum
   one-shots, melodic loops, basslines, and FX as downloadable WAVs.
   Honest labeling: drums + FX are synthesized with DSP ("Synth"), melodies
   + bass are AI-composed ("AI"). Every file is really rendered. 5 credits
   per 10-sample pack. Royalty-free license included. */

interface CatalogType {
  key: string;
  label: string;
  origin: SampleOrigin;
  blurb: string;
}

interface Catalog {
  genres: string[];
  keys: string[];
  packSizes: Array<{ size: number; credits: number }>;
  types: CatalogType[];
  license: string;
}

interface Sample {
  id: string;
  name: string;
  type: string;
  typeLabel: string;
  origin: SampleOrigin;
  url: string;
  durationSec: number;
  bpm: number;
  musicalKey: string;
  genre: string;
}

function SamplesPanel() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { addAsset } = useHubProject();
  const { confirmedFetch } = useConfirmedApi();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [genre, setGenre] = useState("trap");
  const [bpm, setBpm] = useState(140);
  const [musicalKey, setMusicalKey] = useState("A");
  const [packSize, setPackSize] = useState<10 | 25 | 50>(10);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState("");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [packName, setPackName] = useState("");
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sample-pack/catalog");
        if (!res.ok) return;
        const data = (await res.json()) as Catalog;
        if (!cancelled) {
          setCatalog(data);
          setGenre(data.genres[0] ?? "trap");
          setMusicalKey(data.keys[0] ?? "A");
        }
      } catch { /* catalog is progressive enhancement */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return () => { audioRef.current?.pause(); };
  }, []);

  const toggleType = (key: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const togglePlay = (s: Sample) => {
    if (playingId === s.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.onended = () => setPlayingId(null);
    }
    audioRef.current.src = s.url;
    audioRef.current.play().catch(() => setPlayingId(null));
    setPlayingId(s.id);
  };

  const generate = async () => {
    if (!user) return;
    setGenerating(true);
    setError(null);
    setOutOfCredits(false);
    setSamples([]);
    setProgress(t("samples.progress.charging"));
    try {
      const res = await confirmedFetch("/api/sample-pack/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          genre,
          bpm,
          musicalKey,
          packSize,
          types: selectedTypes.size > 0 ? [...selectedTypes] : undefined,
        }),
      });
      if (!res) return;
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || t("samples.error.generationFailed"));
      }
      setSamples(data.samples ?? []);
      /* Each sample is a persistent URL — report the pack into the hub project. */
      for (const s of data.samples ?? []) {
        if (s.url) {
          try {
            addAsset({ kind: "other", url: s.url, label: s.name || "Sample", detail: `${s.typeLabel || "sample"} · ${s.bpm || "?"} BPM` });
          } catch { /* hub unavailable — non-fatal */ }
        }
      }
      setCreditsRemaining(data.creditsRemaining ?? null);
      setPackName(`${genre}-${bpm}bpm-${musicalKey}`.toLowerCase().replace(/[^a-z0-9-]/g, ""));
      setProgress("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("samples.error.generationFailed"));
      setProgress("");
    } finally {
      setGenerating(false);
    }
  };

  const downloadZip = async () => {
    if (samples.length === 0) return;
    setZipping(true);
    setError(null);
    try {
      const res = await fetch("/api/sample-pack/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: samples.map((s) => s.url),
          packName: packName || "sample-pack",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t("samples.error.zipFailed"));
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${packName || "sample-pack"}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("samples.error.zipDownloadFailed"));
    } finally {
      setZipping(false);
    }
  };

  const cost = creditsForSize(packSize);
  const grouped = samples.reduce<Record<string, Sample[]>>((acc, s) => {
    (acc[s.typeLabel] ||= []).push(s);
    return acc;
  }, {});

  return (
    <>
        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Disc3 className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-2xl font-black">{t("samples.title")}</h2>
            <p className="text-sm text-white/45">
              {t("samples.subtitle", { cost, size: packSize })}
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <Sparkles className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
          <p className="text-xs text-white/55 leading-relaxed">
            {t("samples.honesty.p1")} <span className="text-white/80 font-semibold">{t("samples.honesty.synth")}</span>{t("samples.honesty.p2")} <span className="text-white/80 font-semibold">{t("samples.honesty.ai")}</span>{t("samples.honesty.p3")}
          </p>
        </div>

        {outOfCredits && (
          <div className="mt-4">
            <OutOfCredits />
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* ── Builder ── */}
        <section className={`mt-8 rounded-2xl border p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
          <h2 className="text-sm font-bold uppercase tracking-widest text-white/40 mb-5">{t("samples.buildTitle")}</h2>

          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">{t("samples.genre")}</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {(catalog?.genres ?? ["trap"]).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGenre(g)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold border transition ${
                      genre === g
                        ? "border-primary bg-primary/20 text-primary"
                        : "border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25"
                    }`}
                  >
                    {t(`samples.genres.${g}`, { defaultValue: g })}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">
                {t("samples.key")} <span className="text-white/30 normal-case">{t("samples.keyNote")}</span>
              </label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(catalog?.keys ?? ["A"]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setMusicalKey(k)}
                    className={`h-8 w-9 rounded-lg text-xs font-bold border transition ${
                      musicalKey === k
                        ? "border-primary bg-primary/20 text-primary"
                        : "border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25"
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">
                {t("samples.tempo")} — <span className="text-primary font-bold">{t("samples.bpm", { bpm })}</span>
              </label>
              <input
                type="range" min={60} max={180} value={bpm}
                onChange={(e) => setBpm(Number(e.target.value))}
                className="mt-3 w-full accent-amber-400"
              />
              <div className="flex justify-between text-[10px] text-white/30 mt-1">
                <span>60</span><span>120</span><span>180</span>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">{t("samples.packSize")}</label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {PACK_SIZE_OPTIONS.map((o) => (
                  <button
                    key={o.size}
                    onClick={() => setPackSize(o.size)}
                    className={`rounded-xl border px-3 py-2.5 text-center transition ${
                      packSize === o.size
                        ? "border-primary bg-primary/15"
                        : "border-white/10 bg-white/[0.03] hover:border-white/25"
                    }`}
                  >
                    <div className={`text-lg font-black ${packSize === o.size ? "text-primary" : "text-white/80"}`}>{o.size}</div>
                    <div className="text-[10px] text-white/40">{t("samples.credits", { num: o.credits })}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {catalog && (
            <div className="mt-6">
              <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">
                {t("samples.sampleTypes")} <span className="text-white/30 normal-case">{t("samples.sampleTypesNote")}</span>
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {catalog.types.map((type) => {
                  const active = selectedTypes.has(type.key);
                  const badge = originBadge(type.origin);
                  return (
                    <button
                      key={type.key}
                      onClick={() => toggleType(type.key)}
                      title={type.blurb}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border transition ${
                        active
                          ? "border-primary bg-primary/20 text-primary"
                          : "border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25"
                      }`}
                    >
                      {type.label}
                      <span className={`rounded border px-1 text-[9px] font-bold ${badge.className}`}>{badge.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button
            onClick={generate}
            disabled={generating || !user}
            className={`mt-7 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold disabled:cursor-not-allowed ${!user && !generating ? (isLight ? "border border-[#C9A84C]/60 bg-[#EFE3C2] text-[#7A5A12] shadow-none" : "border border-primary/30 bg-primary/20 text-primary/70 shadow-none") : "bg-primary text-black hover:brightness-110"}`}
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <AudioWaveform className="h-4 w-4" />}
            {generating ? t("samples.cooking") : t("samples.generate", { cost })}
          </button>
          {generating && progress && (
            <p className="mt-3 text-xs text-white/45">{progress}</p>
          )}
          {!user && (
            <p className="mt-3 text-xs text-white/45">
              <Link href="/login" className="text-primary underline">{t("samples.signIn")}</Link>{t("samples.signInSuffix")}
            </p>
          )}
        </section>

        {/* ── Results ── */}
        {samples.length > 0 && (
          <section className="mt-8">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-400" />
                <h2 className="text-lg font-black">
                  {t("samples.yourPack", { num: samples.length })}
                  {creditsRemaining !== null && (
                    <span className="ml-2 text-xs font-normal text-white/40">{t("samples.creditsLeft", { num: creditsRemaining })}</span>
                  )}
                </h2>
              </div>
              <button
                onClick={downloadZip}
                disabled={zipping}
                className="inline-flex items-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 py-2 text-sm font-bold text-primary hover:bg-primary/20 disabled:opacity-50"
              >
                {zipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />}
                {zipping ? t("samples.zipping") : t("samples.downloadZip")}
              </button>
            </div>

            {Object.entries(grouped).map(([label, list]) => (
              <div key={label} className="mb-6">
                <h3 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2 flex items-center gap-2">
                  <Music4 className="h-3.5 w-3.5" /> {label}
                  <span className={`rounded border px-1.5 text-[9px] font-bold ${originBadge(list[0].origin).className}`}>
                    {originBadge(list[0].origin).label === "AI" ? t("samples.aiGenerated") : t("samples.synthesized")}
                  </span>
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {list.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5"
                    >
                      <button
                        onClick={() => togglePlay(s)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary hover:bg-primary/25"
                      >
                        {playingId === s.id ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-white/85">{s.name}</div>
                        <div className="text-[10px] text-white/35">
                          {s.bpm} BPM · {s.musicalKey} · {formatDuration(s.durationSec)} · WAV
                        </div>
                      </div>
                      <a
                        href={s.url}
                        download={`${s.name}.wav`}
                        className="shrink-0 rounded-lg border border-white/10 p-2 text-white/50 hover:border-white/30 hover:text-white"
                        title={t("samples.downloadWav")}
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <p className="mt-4 text-[11px] text-white/30">
              {catalog?.license ?? t("samples.licenseFallback")}
            </p>
          </section>
        )}
    </>
  );
}

/* ─── Thy Cheat Code's Text-to-SFX ──────────────────────────────────────────
   Describe a sound effect in words — AI generates it. POST /api/generate-sfx
   at 1 credit per SFX (ElevenLabs sound generation). Category keys must stay
   in sync with the backend route's SFX_CATEGORY_KEYS. */

interface SfxCategory {
  key: string;
  labelKey: string;
  icon: LucideIcon;
  blurbKey: string;
}

const CATEGORIES: SfxCategory[] = [
  { key: "impacts", labelKey: "sfx.categoryImpacts", icon: Bomb, blurbKey: "sfx.categoryImpactsBlurb" },
  { key: "whooshes", labelKey: "sfx.categoryWhooshes", icon: Wind, blurbKey: "sfx.categoryWhooshesBlurb" },
  { key: "risers", labelKey: "sfx.categoryRisers", icon: TrendingUp, blurbKey: "sfx.categoryRisersBlurb" },
  { key: "ui", labelKey: "sfx.categoryUi", icon: MousePointerClick, blurbKey: "sfx.categoryUiBlurb" },
  { key: "ambient", labelKey: "sfx.categoryAmbient", icon: Cloud, blurbKey: "sfx.categoryAmbientBlurb" },
  { key: "foley", labelKey: "sfx.categoryFoley", icon: Footprints, blurbKey: "sfx.categoryFoleyBlurb" },
];

const SFX_CREDIT_COST = 100;
const MIN_DURATION = 1;
const MAX_DURATION = 10;

interface GenerateResponse {
  url?: string;
  durationSeconds?: number;
  category?: string;
  creditsUsed?: number;
  creditsRemaining?: number;
  genHistoryId?: string;
  error?: string;
  message?: string;
  code?: string;
}

interface LibraryResponse {
  items?: { id: string; prompt: string; url: string; createdAt: string }[];
  error?: string;
}

const sfxInputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

/** Decode an MP3 URL to WAV bytes via the Web Audio API. */
async function mp3UrlToWav(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buf = await res.arrayBuffer();
  const Ctx: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error("This browser can't decode audio for WAV export.");
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(buf);
    const channels: Float32Array[] = [];
    for (let c = 0; c < audio.numberOfChannels; c++) {
      channels.push(audio.getChannelData(c).slice());
    }
    return encodeWav(channels, audio.sampleRate);
  } finally {
    void ctx.close().catch(() => {});
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 4000);
}

function SfxPanel() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState("impacts");
  const [duration, setDuration] = useState(3);
  const [result, setResult] = useState<SfxItem | null>(null);
  const { addAsset } = useHubProject();
  const [loading, setLoading] = useState(false);
  const [converting, setConverting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [library, setLibrary] = useState<SfxItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [packing, setPacking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /* Load the local library, then merge anything the server knows about
     (e.g. generated on another device). */
  useEffect(() => {
    setLibrary(loadSfxLibrary());
    if (!user) return;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/sfx/library", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = (await res.json().catch(() => ({}))) as LibraryResponse;
        if (res.ok && Array.isArray(data.items)) {
          setLibrary((prev) => {
            let next = prev;
            for (const it of data.items!) {
              if (!next.some((p) => p.id === it.id || p.url === it.url)) {
                next = saveSfxItem(next, {
                  id: it.id,
                  prompt: it.prompt || t("sfx.soundEffectFallback"),
                  category: "foley",
                  durationSeconds: 0,
                  url: it.url,
                  createdAt: it.createdAt,
                });
              }
            }
            return next;
          });
        }
      } catch {
        /* library merge is a nicety — local list still works */
      }
    })();
  }, [user, getAccessToken]);

  const generate = useCallback(async () => {
    if (loading || !user) return;
    if (prompt.trim().length < 3) {
      setError(t("sfx.errorShortPrompt"));
      return;
    }
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setResult(null);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/generate-sfx", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          durationSeconds: duration,
          category,
        }),
      });
      if (!res) { setLoading(false); return; } // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as GenerateResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        void refreshProfile();
        return;
      }
      if (!res.ok || !data.url) {
        throw new Error(data.message || data.error || t("sfx.errorGenerationFailed"));
      }
      const item: SfxItem = {
        id: data.genHistoryId ?? `${Date.now()}`,
        prompt: prompt.trim(),
        category,
        durationSeconds: data.durationSeconds ?? duration,
        url: data.url,
        createdAt: new Date().toISOString(),
      };
      setResult(item);
      setLibrary((prev) => saveSfxItem(prev, item));
      addAsset({
        kind: "sfx",
        url: item.url,
        label: item.prompt.length > 60 ? item.prompt.slice(0, 60) + "…" : item.prompt,
        detail: `SFX · ${item.category} · ${item.durationSeconds}s`,
      });
      void refreshProfile();
      setTimeout(() => {
        document.getElementById("sfx-result")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        void audioRef.current?.play().catch(() => {});
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sfx.errorGenerationFailed"));
    } finally {
      setLoading(false);
    }
  }, [loading, user, prompt, duration, category, getAccessToken, refreshProfile]);

  async function downloadWav(item: SfxItem) {
    setConverting(item.id);
    setError(null);
    try {
      const wav = await mp3UrlToWav(item.url);
      downloadBlob(new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" }), `${sfxSlug(item.prompt)}.wav`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sfx.errorWavFailed"));
    } finally {
      setConverting(null);
    }
  }

  function downloadMp3(item: SfxItem) {
    const a = document.createElement("a");
    a.href = item.url;
    a.download = `${sfxSlug(item.prompt)}.mp3`;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function downloadPack() {
    const items = library.filter((i) => selected.has(i.id));
    if (items.length === 0 || packing) return;
    setPacking(true);
    setError(null);
    try {
      const entries = [];
      for (const item of items) {
        const wav = await mp3UrlToWav(item.url);
        entries.push({ name: `${sfxSlug(item.prompt)}.wav`, data: wav });
      }
      const zip = createZip(entries);
      downloadBlob(new Blob([zip.buffer as ArrayBuffer], { type: "application/zip" }), `bdv-sfx-pack-${items.length}.zip`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sfx.errorPackFailed"));
    } finally {
      setPacking(false);
    }
  }

  function removeItem(id: string) {
    setLibrary((prev) => removeSfxItem(prev, id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (result?.id === id) setResult(null);
  }

  const selectedCount = selected.size;

  return (
    <>
        {/* header */}
        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <AudioWaveform className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-2xl font-black">{t("sfx.titleStart")}<span className="text-primary">{t("sfx.titleAccent")}</span></h2>
            <p className="text-sm text-white/45">{t("sfx.heroDescription")}</p>
          </div>
        </div>

        {/* ── generator card ──────────────────────────────────────────── */}
        <div data-dark-lock className={`${isLight ? "relative mt-10 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] p-6 md:p-10" : "relative mt-10 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] p-6 md:p-10"}`}>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <AudioWaveform className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-xl font-bold">{t("sfx.generateCardTitle")}</h2>
              <p className="text-sm text-white/45">
                {t("sfx.generateCardSubtitle", { cost: SFX_CREDIT_COST, max: MAX_DURATION })}
              </p>
            </div>
          </div>

          {/* categories */}
          <p data-min-stars="2" className="mt-8 mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40">
            {t("sfx.categoryLabel")}
          </p>
          <div data-min-stars="2" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CATEGORIES.map(({ key, labelKey, icon: Icon, blurbKey }) => (
              <button
                key={key}
                type="button"
                onClick={() => setCategory(key)}
                className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition ${
                  category === key
                    ? "border-primary/60 bg-primary/10 shadow-[0_0_18px_rgba(218,165,32,0.18)]"
                    : "border-white/10 bg-white/[0.02] hover:border-white/25"
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${category === key ? "text-primary" : "text-white/40"}`} aria-hidden="true" />
                <span>
                  <span className="block text-[13px] font-bold">{t(labelKey)}</span>
                  <span className="block text-[11px] text-white/40">{t(blurbKey)}</span>
                </span>
              </button>
            ))}
          </div>

          {/* prompt */}
          <label htmlFor="sfx-prompt" className="mt-6 mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40">
            {t("sfx.promptLabel")}
          </label>
          <textarea
            id="sfx-prompt"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("sfx.promptPlaceholder")}
            className={`${sfxInputClass} resize-none`}
            maxLength={500}
          />

          {/* duration */}
          <div data-min-stars="3" className="mt-6 flex items-center gap-4">
            <label htmlFor="sfx-duration" className="text-[11px] font-bold uppercase tracking-widest text-white/40 shrink-0">
              {t("sfx.durationLabel")}
            </label>
            <input
              id="sfx-duration"
              type="range"
              min={MIN_DURATION}
              max={MAX_DURATION}
              step={1}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="flex-1 accent-[#C9A84C] cursor-pointer"
            />
            <span className="w-12 text-right text-sm font-bold tabular-nums text-primary">{duration}s</span>
          </div>

          <button
            type="button"
            onClick={generate}
            disabled={loading || !user}
            className={`mt-8 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-black uppercase tracking-widest transition active:scale-[0.99] disabled:cursor-not-allowed ${!user && !loading ? (isLight ? "border border-[#C9A84C]/60 bg-[#EFE3C2] text-[#7A5A12] shadow-none" : "border border-primary/30 bg-primary/20 text-primary/70 shadow-none") : "bg-gradient-to-r from-[#f7dd7f] to-[#C9A84C] text-black hover:brightness-110"}`}
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t("sfx.generatingLabel")}</>
            ) : (
              <><Zap className="h-4 w-4" aria-hidden="true" /> {t("sfx.generateButton", { cost: SFX_CREDIT_COST })}</>
            )}
          </button>
          {!user && (
            <p className="mt-3 text-center text-xs text-white/40">{t("sfx.signInPrompt")}</p>
          )}

          {error && (
            <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>
          )}
          {outOfCredits && (
            <div className="mt-6"><OutOfCredits /></div>
          )}
        </div>

        {/* ── result ──────────────────────────────────────────────────── */}
        {result && (
          <div id="sfx-result" data-dark-lock className={`${isLight ? "relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] p-6 md:p-8" : "relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] p-6 md:p-8"}`}>
            <h2 className="text-lg font-bold">{t("sfx.resultTitle")}</h2>
            <p className="mt-1 text-sm text-white/50 line-clamp-2">“{result.prompt}”</p>
            <audio ref={audioRef} src={result.url} controls className="mt-4 w-full accent-[#C9A84C]" />
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void downloadWav(result)}
                disabled={converting === result.id}
                className="flex items-center gap-1.5 rounded-xl border border-primary/50 bg-primary/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary transition hover:bg-primary/20 disabled:opacity-40"
              >
                {converting === result.id
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
                WAV
              </button>
              <button
                type="button"
                onClick={() => downloadMp3(result)}
                className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-bold uppercase tracking-widest text-white/70 transition hover:border-white/30 hover:text-white"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" /> MP3
              </button>
            </div>
          </div>
        )}

        {/* ── library ─────────────────────────────────────────────────── */}
        <div className="relative mt-12">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Library className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-xl font-bold">{t("sfx.libraryTitle")}</h2>
                <p className="text-sm text-white/45">
                  {library.length === 0
                    ? t("sfx.libraryEmptyDesc")
                    : t("sfx.librarySubtitle", { count: library.length })}
                </p>
              </div>
            </div>
            {selectedCount > 0 && (
              <button
                type="button"
                data-min-stars="5"
                onClick={() => void downloadPack()}
                disabled={packing}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#f7dd7f] to-[#C9A84C] px-4 py-2.5 text-xs font-black uppercase tracking-widest text-black transition hover:brightness-110 disabled:opacity-40"
              >
                {packing
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  : <Package className="h-3.5 w-3.5" aria-hidden="true" />}
                {t("sfx.packButton", { count: selectedCount })}
              </button>
            )}
          </div>

          {library.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-dashed border-white/15 p-10 text-center text-sm text-white/35">
              {t("sfx.libraryEmpty")}
            </div>
          ) : (
            <ul className="mt-6 space-y-2">
              {library.map((item) => {
                const isSel = selected.has(item.id);
                return (
                  <li
                    key={item.id}
                    className={`flex items-center gap-3 rounded-2xl border p-3 transition ${
                      isSel ? (isLight ? "border-[#C9A84C] bg-[#F7ECD2] shadow-[0_0_0_1px_#C9A84C,0_10px_28px_rgba(201,168,76,0.22)]" : "border-primary bg-primary/[0.16] shadow-[0_0_0_1px_rgba(212,175,55,0.55)]") : "border-white/10 bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSelect(item.id)}
                      data-min-stars="5"
                      aria-label={isSel ? t("sfx.deselectLabel") : t("sfx.selectForPackLabel")}
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition ${
                        isSel ? "border-primary bg-primary text-black" : "border-white/20 text-transparent hover:border-white/40"
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{item.prompt}</p>
                      <p className="text-[11px] uppercase tracking-widest text-white/35">
                        {item.category}{item.durationSeconds > 0 ? ` · ${item.durationSeconds}s` : ""}
                      </p>
                      <audio src={item.url} controls className="mt-2 h-8 w-full accent-[#C9A84C]" preload="none" />
                    </div>
                    <div className="flex shrink-0 flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={() => void downloadWav(item)}
                        disabled={converting === item.id}
                        className="flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition hover:border-primary/50 hover:text-primary disabled:opacity-40"
                      >
                        {converting === item.id
                          ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                          : <Download className="h-3 w-3" aria-hidden="true" />}
                        WAV
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        aria-label={t("sfx.removeFromLibraryLabel")}
                        className="flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition hover:border-red-500/50 hover:text-red-300"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" /> Del
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
    </>
  );
}

/* ─── Beat Maker panel wrapper ────────────────────────────────────────────
   BeatMakerModule keeps its own inner tabs (AI Beat / Producer Tag /
   Step Sequencer); this wrapper gives the tab a compact tool header. */

function BeatMakerPanel() {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Disc3 className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-2xl font-black">{t("beatMaker.title")}</h2>
          <p className="text-sm text-white/45">{t("beatMaker.subtitle")}</p>
        </div>
      </div>
      <div className="mt-6">
        <BeatMakerModule />
      </div>
    </div>
  );
}

/* ─── AI Audio hub shell ──────────────────────────────────────────────────
   One page, three generators. Each keeps its own paid endpoint, credit cost,
   and handoffs — only the page chrome is shared. */

type AiAudioTab = "beats" | "samples" | "sfx";

const AI_AUDIO_TABS: Array<{ id: AiAudioTab; icon: LucideIcon; labelKey: string; descKey: string }> = [
  { id: "beats", icon: Disc3, labelKey: "aiAudio.tabs.beats", descKey: "aiAudio.desc.beats" },
  { id: "samples", icon: Library, labelKey: "aiAudio.tabs.samples", descKey: "aiAudio.desc.samples" },
  { id: "sfx", icon: Zap, labelKey: "aiAudio.tabs.sfx", descKey: "aiAudio.desc.sfx" },
];

export default function AiAudio() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const [tab, setTab] = useState<AiAudioTab>(() => {
    try {
      /* Phase 3: the host (Audio Studio) owns ?tab=; our sub-tab rides
         ?sub= so the two never collide. Legacy standalone links used
         ?tab= — still honored as the fallback. */
      const params = new URLSearchParams(window.location.search);
      const q = params.get("sub") ?? params.get("tab");
      return q === "samples" || q === "sfx" ? q : "beats";
    } catch {
      return "beats";
    }
  });
  usePageTitle(t("aiAudio.title", { defaultValue: "Generate Audio" }),
               t("aiAudio.subtitle", { defaultValue: "Make beats, build sample packs, and generate sound effects — the audio toolkit." }));

  function switchTab(next: AiAudioTab) {
    setTab(next);
    /* Keep the sub-tab shareable — written as ?sub= so it never
       clobbers the host page's own ?tab= (Phase 3 chain fix). */
    try {
      const params = new URLSearchParams(window.location.search);
      params.set("sub", next);
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    } catch {
      /* non-browser — ignore */
    }
  }

  const active = AI_AUDIO_TABS.find((tb) => tb.id === tab) ?? AI_AUDIO_TABS[0];

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-5xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> {t("aiAudio.back", { defaultValue: "Back" })}
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <AudioWaveform className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">{t("aiAudio.title", { defaultValue: "AI Audio" })}</h1>
            <p className="text-sm text-white/45">{t("aiAudio.subtitle", { defaultValue: "Make beats, build sample packs, and generate sound effects — the AI audio toolkit." })}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className={`mt-6 grid grid-cols-3 gap-2 rounded-2xl border p-1.5 ${isLight ? "border-[#C9A84C]/40 bg-[#F7ECD2]/80" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
          {AI_AUDIO_TABS.map((tb) => {
            const Icon = tb.icon;
            const isActive = tab === tb.id;
            return (
              <button
                key={tb.id}
                type="button"
                onClick={() => switchTab(tb.id)}
                className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold transition ${
                  isActive
                    ? "bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] text-black"
                    : "text-white/50 hover:text-white/80"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t(tb.labelKey, { defaultValue: tb.id })}
              </button>
            );
          })}
        </div>

        <p className="text-xs text-white/35 mt-3 leading-relaxed">
          {t(active.descKey, { defaultValue: "" })}
        </p>

        {/* Cross-links: marketplace + trend finder */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <span className="text-[11px] font-bold uppercase tracking-widest text-white/35">
            {t("aiAudio.crossBanner.title", { defaultValue: "Keep it moving" })}
          </span>
          <Link href="/beats" className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:brightness-110 transition">
            <Store className="h-3.5 w-3.5" />
            {t("aiAudio.crossBanner.beats", { defaultValue: "Sell beats on the marketplace" })}
          </Link>
          <Link href="/sounds" className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:brightness-110 transition">
            <TrendingUp className="h-3.5 w-3.5" />
            {t("aiAudio.crossBanner.sounds", { defaultValue: "Find trending sounds" })}
          </Link>
        </div>

        <div className="mt-6">
          {tab === "beats" ? <BeatMakerPanel /> : tab === "samples" ? <SamplesPanel /> : <SfxPanel />}
        </div>
      </main>
    </div>
  );
}
