/* ── Audio ducking — editor model (Stack 5 #5) ───────────────────────────
 * The ducking control lives on the music/song lane (LanesPanel). Settings
 * are house-simple terms; the mapping to sidechaincompress parameters is
 * mirrored on the server (api-server ducking-filter.ts) — same formulas,
 * tested on both sides:
 *   threshold  = 0.08 − sensitivity × 0.0007
 *   ratio      = 2 + amount × 0.18
 *   musicLevel = 1 − amount × 0.004
 */

export interface DuckingSettings {
  enabled: boolean;
  /** "Duck amount" 0..100 — how far the music drops under the voice. */
  amount: number;
  /** "Voice sensitivity" 0..100 — how quiet a voice still triggers ducking. */
  sensitivity: number;
  /** Voice track URL the music ducks under (vocal stem / uploaded voice).
   *  null = not set — the editor says so and export refuses to fake it. */
  voiceUrl: string | null;
}

export function defaultDuckingSettings(): DuckingSettings {
  return { enabled: false, amount: 60, sensitivity: 50, voiceUrl: null };
}

export function duckingParamsFromSimple(amount: number, sensitivity: number) {
  const a = Math.min(100, Math.max(0, amount));
  const s = Math.min(100, Math.max(0, sensitivity));
  return {
    threshold: Math.round((0.08 - s * 0.0007) * 10000) / 10000,
    ratio: Math.round((2 + a * 0.18) * 100) / 100,
    attackMs: 200,
    releaseMs: 500,
    musicLevel: Math.round((1 - a * 0.004) * 1000) / 1000,
  };
}

/** Payload for the standalone POST /duck-audio endpoint (its own charge —
 *  used by the "preview the duck" action, NOT by timeline export, which
 *  applies ducking inside the export render). */
export function buildDuckAudioPayload(settings: DuckingSettings, musicUrl: string) {
  const p = duckingParamsFromSimple(settings.amount, settings.sensitivity);
  return {
    voiceUrl: settings.voiceUrl,
    musicUrl,
    attackMs: p.attackMs,
    releaseMs: p.releaseMs,
    musicLevel: p.musicLevel,
    threshold: p.threshold,
    ratio: p.ratio,
  };
}

/** The ducking block the timeline export sends with the render. */
export function buildExportDucking(settings: DuckingSettings) {
  if (!settings.enabled) return null;
  return {
    enabled: true,
    amount: settings.amount,
    sensitivity: settings.sensitivity,
    voiceUrl: settings.voiceUrl,
  };
}
