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
 * Canonical lip-sync provider id, or null when the value does not name
 * a known route. Mirrors the server's normalizeLipSyncProvider
 * (api-server lib/sync-labs.ts): the recorded route ids are a closed
 * set ("latentsync" | "sync"); legacy aliases ("sync.so", "wavespeed",
 * …) canonicalize to them. Anything else is UNKNOWN — null, never
 * passed through and never guessed (stack1200, Z3 residual).
 */
export function normalizeLipSyncProviderId(
  raw: string | null | undefined,
): string | null {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "latentsync":
    case "wavespeed":
    case "latent-sync":
    case "latent_sync":
      return "latentsync";
    case "sync":
    case "sync-labs":
    case "synclabs":
    case "sync.so":
      return "sync";
    default:
      return null;
  }
}

/**
 * Provenance for a scene's lip-sync stamp on the recovery paths: the
 * FIRST candidate that names a known route wins (callers pass the
 * freshest evidence first — e.g. the check-provider-job answer ahead
 * of the clip's previously recorded stamp). When no candidate knows,
 * the stamp is null: a recovery path must never fabricate the premium
 * route's name for a job that may have run on the default route.
 */
export function resolveLipSyncProvenance(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    const id = normalizeLipSyncProviderId(candidate);
    if (id) return id;
  }
  return null;
}

/**
 * Human provider label for editor surfaces (board item 60): the raw
 * provider ids ("latentsync", "sync") are internal names, never shown
 * to creators verbatim — and neither is the model name behind the
 * default route. Creators see the friendly feature name ("Lip Sync");
 * the internal ids/keys stay unchanged everywhere else.
 *
 * Stack800 lane 3: the default branch used to pass an UNKNOWN id
 * through verbatim — any future provider id would have leaked raw
 * onto a status row. Unknown ids now fall back to the feature name;
 * a raw provider id can never reach a status row through this label.
 */
export function lipSyncProviderLabel(provider: string | null | undefined): string {
  switch ((provider ?? "").trim().toLowerCase()) {
    case "latentsync":
    case "latent-sync":
    case "latent_sync":
      return "Lip Sync";
    case "sync":
    case "sync.so":
    case "synclabs":
    case "sync-labs":
      return "Sync";
    case "wavespeed":
      return "WaveSpeed";
    case "hedra":
      return "Hedra";
    case "heygen":
      return "HeyGen";
    default:
      return "Lip Sync";
  }
}

/**
 * The refund fields the job poll carries (GET /api/lip-sync/job/:id):
 * `chargeRefunded` is the job's own exactly-once refund gate
 * (migration 0311) — true only when the poller's failure refund of the
 * job's up-front charge has fired — and `refundedCredits`, the amount
 * from the job's charge record, rides along only when it has.
 */
export interface LipSyncJobRefundFields {
  chargeRefunded?: boolean | null;
  refundedCredits?: number | null;
}

/**
 * The refund verdict sentence for a terminally failed job, rendered
 * through the caller's translator (the `lipSync.refundNote` key), or
 * null when NO verdict may be stated: the refund never fired for this
 * job (the gate is false/absent — e.g. a failure that carried no
 * completed refund), or the job record names no amount (an amount is
 * never invented here; the figure always comes from the job's own
 * charge record on the server).
 */
export function lipSyncRefundNote(
  job: LipSyncJobRefundFields | null | undefined,
  render: (credits: number) => string,
): string | null {
  if (!job || job.chargeRefunded !== true) return null;
  const credits = job.refundedCredits;
  if (typeof credits !== "number" || !Number.isFinite(credits) || credits <= 0) {
    return null;
  }
  return render(credits);
}

/**
 * A failure message with the refund verdict appended when the job's
 * refund actually fired — and the message untouched when it didn't,
 * so a failure never wears a refund it didn't get.
 */
export function withLipSyncRefundNote(
  message: string,
  job: LipSyncJobRefundFields | null | undefined,
  render: (credits: number) => string,
): string {
  const note = lipSyncRefundNote(job, render);
  return note ? `${message} ${note}` : message;
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
