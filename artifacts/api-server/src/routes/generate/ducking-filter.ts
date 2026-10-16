/* ── Audio ducking — shared sidechain graph (Stack 5 #5) ─────────────────
 * ONE builder for both callers:
 *   • POST /duck-audio (standalone mix, 150 Visual Bucs — unchanged price)
 *   • the video export pre-pass (ducking settings on the music lane)
 * Input layout is fixed: [0:a] = music, [1:a] = voice. The voice is split:
 * one copy is the audible track, the other drives sidechaincompress on the
 * levelled music; the two are mixed with normalize=0.
 *
 * The editor speaks in house-simple terms — "Duck amount" and "Voice
 * sensitivity", both 0..100 — mapped here (and mirrored in the frontend
 * lib/ducking.ts; the mapping values are tested on both sides):
 *   threshold  = 0.08 − sensitivity × 0.0007   (0.08 … 0.01)
 *   ratio      = 2 + amount × 0.18             (2 … 20)
 *   musicLevel = 1 − amount × 0.004            (1 … 0.6 base level pre-duck)
 * attack/release keep the proven route defaults (200ms / 500ms).
 */

export interface DuckingParams {
  threshold: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  musicLevel: number;
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

export function duckingParamsFromSimple(amount: number, sensitivity: number): DuckingParams {
  const a = clamp(amount, 0, 100);
  const s = clamp(sensitivity, 0, 100);
  return {
    threshold: Math.round((0.08 - s * 0.0007) * 10000) / 10000,
    ratio: Math.round((2 + a * 0.18) * 100) / 100,
    attackMs: 200,
    releaseMs: 500,
    musicLevel: Math.round((1 - a * 0.004) * 1000) / 1000,
  };
}

export function buildDuckingMixFilter(p: DuckingParams): string {
  const threshold = clamp(p.threshold, 0.005, 0.2);
  const ratio = clamp(p.ratio, 1, 20);
  const attack = clamp(p.attackMs, 20, 2000);
  const release = clamp(p.releaseMs, 50, 3000);
  const musicLevel = clamp(p.musicLevel, 0.1, 1);
  return (
    `[1:a]asplit=2[voice_out][sc];` +
    `[0:a]volume=${musicLevel}[music_leveled];` +
    `[music_leveled][sc]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attack}:release=${release}[ducked];` +
    `[ducked][voice_out]amix=inputs=2:duration=longest:normalize=0[aout]`
  );
}
