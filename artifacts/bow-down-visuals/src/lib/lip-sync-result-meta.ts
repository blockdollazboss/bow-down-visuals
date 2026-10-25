/**
 * Lip-sync result honesty (Stack-200, editor priority lane, item 191).
 *
 * Migration 0230 put the provider result metadata on the lip-sync job
 * record: the provider, the model, the input dimensions probed at
 * submit time, the output dimensions probed at completion, and
 * `resolutionReduced` (true / false / null when a probe could not
 * answer). The job poll already returns it (`resultMeta` on
 * GET /api/lip-sync/job/:id) — but no editor surface read it, so a
 * creator whose clip came back smaller (the known LatentSync route:
 * 672x1344 in, 432x880 out) was never told.
 *
 * These pure helpers turn that record into the plain sentence the
 * editor shows at completion. Unknown is stated as unknown, never
 * hidden and never guessed.
 */

export interface LipSyncResultMeta {
  provider?: string | null;
  model?: string | null;
  inputWidth?: number | null;
  inputHeight?: number | null;
  outputWidth?: number | null;
  outputHeight?: number | null;
  /** true = provider returned a smaller frame; false = same/larger; null = a probe could not answer. */
  resolutionReduced?: boolean | null;
}

function dims(w: unknown, h: unknown): string | null {
  return typeof w === "number" && typeof h === "number" && w > 0 && h > 0
    ? `${w}×${h}`
    : null;
}

/**
 * Human provider label for editor surfaces (board item 60): the raw
 * provider ids ("latentsync", "sync") are internal names, never shown
 * to creators verbatim.
 */
export function lipSyncProviderLabel(provider: string | null | undefined): string {
  switch ((provider ?? "").trim().toLowerCase()) {
    case "latentsync":
      return "LatentSync";
    case "sync":
    case "sync.so":
    case "synclabs":
    case "sync-labs":
      return "Sync";
    case "wavespeed":
      return "WaveSpeed";
    case "hedra":
      return "Hedra";
    default:
      return provider?.trim() ? provider.trim() : "Lip Sync";
  }
}

/**
 * The plain completion sentence for a finished lip-sync job, or null
 * when there is no metadata at all to report (older jobs pre-0230 —
 * silence is honest there; inventing dimensions would not be).
 */
export function formatLipSyncResultMeta(
  meta: LipSyncResultMeta | null | undefined,
): string | null {
  if (!meta || typeof meta !== "object") return null;
  const out = dims(meta.outputWidth, meta.outputHeight);
  const into = dims(meta.inputWidth, meta.inputHeight);
  if (!out) {
    /* A record exists but the output probe could not answer: say so
       plainly rather than printing nothing about the final size. */
    if (
      meta.resolutionReduced === undefined &&
      meta.inputWidth === undefined &&
      meta.outputWidth === undefined
    ) {
      return null;
    }
    return "Final size: not reported by the lip-sync provider.";
  }
  if (meta.resolutionReduced === true && into) {
    return `Final size: ${out} — smaller than the ${into} clip you sent. The lip-sync provider reduced the resolution; the original clip is unchanged.`;
  }
  if (meta.resolutionReduced === true) {
    return `Final size: ${out} — the lip-sync provider reduced the resolution; the original clip is unchanged.`;
  }
  if (meta.resolutionReduced === false && into) {
    return `Final size: ${out} — same resolution as the clip you sent.`;
  }
  if (meta.resolutionReduced === false) {
    return `Final size: ${out}.`;
  }
  /* resolutionReduced null/unknown: state the size, state the unknown. */
  return into
    ? `Final size: ${out} (sent: ${into}) — the provider did not report whether the resolution changed.`
    : `Final size: ${out}.`;
}
