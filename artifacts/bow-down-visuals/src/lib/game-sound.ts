/* ─── House game sound — synthesized WebAudio SFX (zero audio assets) ────
   Every game in the palace used to be silent. This module is the whole
   sound department: a tiny synth that builds each effect from
   oscillators and filtered noise at play time, so there are no audio
   files to ship, cache, or 404. One master mute, persisted per device,
   shared by the Arcade and Party Games (the house pattern: a control
   the player can find, state that survives a reload).

   Discipline: the AudioContext is created lazily and only ever resumed
   from inside a user-gesture-driven call chain (game start buttons,
   answer clicks) or an effect those started — browsers refuse
   otherwise, and every failure here degrades to silence, never a crash.
   Game loops call these freely; a muted or unavailable synth is a
   no-op. */

const MUTE_KEY = "bdv:game-sound-muted";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

let muted = typeof window !== "undefined" ? readMuted() : false;
const listeners = new Set<() => void>();

export function isGameSoundMuted(): boolean {
  return muted;
}

export function setGameSoundMuted(next: boolean): void {
  muted = next;
  try {
    window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  } catch {
    /* private mode — the choice just won't persist */
  }
  for (const fn of listeners) fn();
}

export function subscribeGameSoundMuted(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function ensureCtx(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.42;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

interface ToneOpts {
  freq: number;
  freqEnd?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
}

function tone({ freq, freqEnd, dur, type = "sine", gain = 0.5, delay = 0 }: ToneOpts): void {
  const ac = ensureCtx();
  if (!ac || !master) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

interface NoiseOpts {
  dur: number;
  gain?: number;
  delay?: number;
  filterType?: BiquadFilterType;
  filterFreq?: number;
  filterEnd?: number;
}

function noise({ dur, gain = 0.4, delay = 0, filterType = "lowpass", filterFreq = 1200, filterEnd }: NoiseOpts): void {
  const ac = ensureCtx();
  if (!ac || !master) return;
  const t0 = ac.currentTime + delay;
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(filterFreq, t0);
  if (filterEnd) filter.frequency.exponentialRampToValueAtTime(Math.max(10, filterEnd), t0 + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

/** The palace's sound kit. Every entry is safe to call from anywhere —
 *  render loops included — and silently does nothing when muted,
 *  unsupported, or the browser hasn't unlocked audio yet. */
export const gameSfx = {
  /** Runner: the King leaves the floor. */
  jump() {
    tone({ freq: 280, freqEnd: 720, dur: 0.14, type: "triangle", gain: 0.35 });
  },
  /** Runner: a soft board-on-marble thud when a jump lands. */
  land() {
    noise({ dur: 0.07, gain: 0.12, filterFreq: 320 });
  },
  /** A Visual Bucs coin, caught: two bright pings. */
  coin() {
    tone({ freq: 1318, dur: 0.07, type: "sine", gain: 0.32 });
    tone({ freq: 1760, dur: 0.16, type: "sine", gain: 0.3, delay: 0.06 });
  },
  /** Runner: the run ends — a crash of marble and a falling tone. */
  crash() {
    noise({ dur: 0.35, gain: 0.5, filterFreq: 2400, filterEnd: 220 });
    tone({ freq: 220, freqEnd: 42, dur: 0.4, type: "sawtooth", gain: 0.22 });
  },
  /** Skeet: a shot is fired. */
  shot() {
    noise({ dur: 0.09, gain: 0.22, filterType: "bandpass", filterFreq: 900 });
    tone({ freq: 340, freqEnd: 130, dur: 0.09, type: "square", gain: 0.1 });
  },
  /** Skeet: a gold plate shatters mid-flight. */
  shatter() {
    noise({ dur: 0.16, gain: 0.4, filterType: "highpass", filterFreq: 2600 });
    tone({ freq: 1560, freqEnd: 2400, dur: 0.08, type: "triangle", gain: 0.16 });
    tone({ freq: 2093, dur: 0.1, type: "sine", gain: 0.14, delay: 0.03 });
    tone({ freq: 1174, dur: 0.12, type: "sine", gain: 0.1, delay: 0.06 });
  },
  /** A shot that hits nothing — dull and costly. */
  thud() {
    tone({ freq: 130, freqEnd: 70, dur: 0.13, type: "sine", gain: 0.4 });
    noise({ dur: 0.06, gain: 0.1, filterFreq: 300 });
  },
  /** Countdown pressure: one quiet tick per second in the last stretch. */
  tick() {
    tone({ freq: 1050, dur: 0.035, type: "square", gain: 0.08 });
  },
  /** An answer (or a category door) locks in. */
  lockIn() {
    tone({ freq: 660, dur: 0.07, type: "triangle", gain: 0.3 });
    tone({ freq: 990, dur: 0.12, type: "triangle", gain: 0.28, delay: 0.055 });
  },
  /** The reveal lands in your favor — a rising gold arpeggio. */
  revealGood() {
    [523, 659, 784, 1046].forEach((f, i) =>
      tone({ freq: f, dur: 0.16, type: "sine", gain: 0.26, delay: i * 0.07 }),
    );
  },
  /** The reveal does not. A short, honest descent — no mockery. */
  revealBad() {
    tone({ freq: 300, freqEnd: 170, dur: 0.28, type: "triangle", gain: 0.22 });
  },
  /** A neutral sting for results that aren't yours to celebrate. */
  sting() {
    tone({ freq: 440, dur: 0.12, type: "triangle", gain: 0.2 });
    tone({ freq: 587, dur: 0.18, type: "triangle", gain: 0.18, delay: 0.09 });
  },
  /** The crown drops: a small royal fanfare. */
  fanfare() {
    [392, 523, 659, 784].forEach((f, i) =>
      tone({ freq: f, dur: 0.22, type: "triangle", gain: 0.3, delay: i * 0.09 }),
    );
    tone({ freq: 1046, dur: 0.5, type: "sine", gain: 0.26, delay: 0.38 });
    noise({ dur: 0.4, gain: 0.05, filterType: "highpass", filterFreq: 5000, delay: 0.38 });
  },
};
