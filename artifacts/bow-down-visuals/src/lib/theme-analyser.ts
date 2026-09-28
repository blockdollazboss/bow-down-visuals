/* Shared audio analyser for the theme song — lets visual elements
   (like the homepage spotlight rig) pulse on the actual BEAT.

   Usage:
     attachThemeAnalyser(audioElement) — call once when the theme song
       starts playing. Creates an AudioContext + AnalyserNode hooked to
       the element. Safe to call repeatedly; only attaches once.
     getThemeBeat() — returns { pulse, bpm, bass, energy } or null when
       no analyser is attached / audio isn't playing.
       - pulse: 0..1, spikes to 1 on every detected kick, decays fast.
         Drive light brightness/opacity directly off this.
       - bpm: estimated tempo, 0 until confident.
       - bass/energy: 0..1 smoothed levels for secondary motion.

   Beat detection: classic onset detector on the low band. We track a
   rolling average of bass energy; when the instant energy jumps well
   above the average we call it a kick. A cooldown (~250ms) prevents
   double-triggers on the same hit. The pulse decays exponentially so
   visuals get a sharp attack + smooth release — like a real light rig.

   The AudioContext is created lazily on first attach (which happens after
   a user gesture unlocked playback), so autoplay policies are satisfied.
*/

let analyser: AnalyserNode | null = null;
let freqData: Uint8Array | null = null;
let attachedTo: HTMLAudioElement | null = null;

/* Beat-detector state */
let bassHistory: number[] = [];
let lastBeatAt = 0;
let pulse = 0;
let beatIntervals: number[] = [];
let lastPulseT = 0;

const HISTORY_N = 43;       // ~0.7s of bass history at 60fps polling
const BEAT_COOLDOWN_MS = 240;
const ONSET_THRESHOLD = 1.35; // instant must exceed avg by this factor

export function attachThemeAnalyser(audio: HTMLAudioElement): void {
  if (typeof window === "undefined") return;
  if (attachedTo === audio && analyser) return; // already hooked
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    if (ctx.state === "suspended") void ctx.resume();
    const src = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256; // 128 frequency bins
    analyser.smoothingTimeConstant = 0.72;
    src.connect(analyser);
    analyser.connect(ctx.destination);
    freqData = new Uint8Array(analyser.frequencyBinCount);
    attachedTo = audio;
    // reset detector state for the new source
    bassHistory = [];
    beatIntervals = [];
    pulse = 0;
    lastBeatAt = 0;
  } catch {
    analyser = null;
    freqData = null;
  }
}

export interface ThemeBeat {
  /** 0..1 — spikes to 1 on each kick, decays fast. Drive lights off this. */
  pulse: number;
  /** Estimated BPM, 0 until confident. */
  bpm: number;
  /** Smoothed bass level 0..1. */
  bass: number;
  /** Smoothed overall energy 0..1. */
  energy: number;
}

export function getThemeBeat(): ThemeBeat | null {
  if (!analyser || !freqData || !attachedTo || attachedTo.paused) {
    pulse = 0;
    return null;
  }
  analyser.getByteFrequencyData(freqData as Uint8Array<ArrayBuffer>);
  const n = freqData.length;

  const bandAvg = (from: number, to: number): number => {
    const a = Math.max(0, Math.floor(from * n));
    const b = Math.min(n - 1, Math.ceil(to * n));
    let sum = 0;
    for (let i = a; i <= b; i++) sum += freqData![i];
    return sum / Math.max(1, b - a + 1) / 255;
  };

  const now = performance.now();
  const dt = Math.min(100, now - (lastPulseT || now));
  lastPulseT = now;

  const bass = bandAvg(0.02, 0.14);
  const energy = bass * 0.55 + bandAvg(0.14, 0.45) * 0.3 + bandAvg(0.45, 0.85) * 0.15;

  // Rolling average of bass energy.
  bassHistory.push(bass);
  if (bassHistory.length > HISTORY_N) bassHistory.shift();
  const avg = bassHistory.reduce((s, v) => s + v, 0) / bassHistory.length;

  // Onset: instant bass jumps above its recent average → kick.
  if (
    bassHistory.length > 12 &&
    bass > 0.08 && // ignore near-silence
    bass > avg * ONSET_THRESHOLD &&
    now - lastBeatAt > BEAT_COOLDOWN_MS
  ) {
    if (lastBeatAt > 0) {
      const interval = now - lastBeatAt;
      if (interval > 250 && interval < 2000) {
        beatIntervals.push(interval);
        if (beatIntervals.length > 12) beatIntervals.shift();
      }
    }
    lastBeatAt = now;
    pulse = 1;
  } else {
    // Fast exponential decay — snappy attack, smooth release.
    pulse *= Math.exp(-dt / 110);
    if (pulse < 0.01) pulse = 0;
  }

  // BPM from median interval.
  let bpm = 0;
  if (beatIntervals.length >= 4) {
    const sorted = [...beatIntervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    bpm = Math.round(60000 / median);
  }

  return { pulse, bpm, bass, energy };
}
