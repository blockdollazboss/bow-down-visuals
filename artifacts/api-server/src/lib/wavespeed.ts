import { logger } from "./logger";

/**
 * WaveSpeed lip-sync provider client — the LatentSync route.
 *
 * Owner's verdict (2026-10-24, judged twice against timed lyrics):
 * LatentSync via WaveSpeed is CLEAN; the incumbent direct Sync.so route
 * is the glitchy one. LatentSync is therefore the DEFAULT lip-sync route
 * behind the LIP_SYNC_PROVIDER switch (see lib/sync-labs.ts
 * getLipSyncProviderName); the direct Sync.so route remains available as
 * the premium upsell (LIP_SYNC_PROVIDER=sync).
 *
 * API shape (verified 2026-10-24 through the custom.wavespeed connector
 * helper, same account): base https://api.wavespeed.ai/api/v3, Bearer
 * key in the Authorization header, submit = POST /{model} with the model
 * inputs as JSON, poll = GET /predictions/{id}/result. Model inputs here
 * are the poller's public signed URLs for the trimmed video + audio
 * segments (WaveSpeed accepts public URLs directly — the media-ticket
 * upload flow is only for local files, which the server never has).
 *
 * BILLING SAFETY — the rule the connector doc and the paid-provider
 * testing law both state: a submit is NEVER retried automatically. A
 * retry after an unclear failure can create a second, billed task.
 * waveSpeedSubmit therefore makes exactly one HTTP attempt; when the
 * outcome is unknowable (no response at all) the error classifies as
 * "transport" and the poller fails the job with submit_outcome_unknown
 * instead of resubmitting. Outcomes are recovered by prediction id via
 * waveSpeedStatus, which is a free read and safe to repeat.
 */

/* ── Server-side secret (never sent to the browser) ── */

/** Resolved WaveSpeed API key, or null when none is configured. */
export function getWaveSpeedApiKey(): string | null {
  const key = process.env["WAVESPEED_API_KEY"];
  return key && key.length > 0 ? key : null;
}

export function isWaveSpeedConfigured(): boolean {
  return getWaveSpeedApiKey() !== null;
}

/** WaveSpeed API base URL (overridable via WAVESPEED_BASE_URL for staging/tests). */
export function getWaveSpeedBase(): string {
  return process.env["WAVESPEED_BASE_URL"] ?? "https://api.wavespeed.ai/api/v3";
}

/** The LatentSync model id on WaveSpeed (override via LIP_SYNC_LATENTSYNC_MODEL). */
export function getLatentSyncModel(): string {
  return process.env["LIP_SYNC_LATENTSYNC_MODEL"] || "bytedance/latentsync";
}

export interface WaveSpeedJob {
  /** Raw provider status: created | processing | completed | failed | cancelled | timeout | deleted. */
  status: string;
  outputUrl?: string;
  error?: string;
}

/** Typed provider error: carries the HTTP status (null when no response arrived). */
export class WaveSpeedError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "WaveSpeedError";
    this.status = status;
  }
}

/** How a WaveSpeed submit failure should be treated by the background poller. */
export type WaveSpeedSubmitErrorKind =
  /** Provider answered 429 / 5xx: no task was issued; wait with backoff and resubmit later. */
  | "transient"
  /** No response at all: the submit may or may not have created a billed task — NEVER resubmit blind. */
  | "transport"
  /** Provider is out of funds (402 / insufficient-balance body): fail closed, immediately. */
  | "balance"
  /** Other 4xx (validation, auth): fail the job immediately. */
  | "permanent";

const BALANCE_MESSAGE_RE = /insufficient|not enough credit|balance|out of credit|credits? exhausted/i;

/** True when the provider is refusing work for lack of funds. */
export function isWaveSpeedBalanceError(err: unknown): boolean {
  const status = err instanceof WaveSpeedError ? err.status : null;
  if (status === 402) return true;
  const message = err instanceof Error ? err.message : String(err ?? "");
  return BALANCE_MESSAGE_RE.test(message);
}

/**
 * Classify a waveSpeedSubmit failure. Balance is checked FIRST: an
 * out-of-funds provider must fail the job closed with a clear state —
 * never a backoff loop that looks like waiting, never a half-charge.
 */
export function classifyWaveSpeedSubmitError(err: unknown): WaveSpeedSubmitErrorKind {
  if (isWaveSpeedBalanceError(err)) return "balance";
  const status = err instanceof WaveSpeedError ? err.status : null;
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return "transient";
  }
  if (status !== null && status >= 400) return "permanent";
  if (err instanceof WaveSpeedError) return "transport"; // constructed from a no-response failure
  return "transport"; // fetch threw (timeout / DNS / reset) — outcome unknowable
}

/** Normalized provider status: "pending" | "processing" | "completed" | "failed". */
export function normalizeWaveSpeedStatus(job: WaveSpeedJob): string {
  const s = String(job.status ?? "").toLowerCase();
  if (s === "completed") return "completed";
  if (s === "failed" || s === "cancelled" || s === "timeout" || s === "deleted") return "failed";
  if (s === "processing" || s === "running") return "processing";
  return "pending";
}

/* WaveSpeed wraps payloads in a { data: ... } envelope (the connector
   helper unwraps the same way). Accept both shapes. */
function unwrap(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    if (rec["data"] && typeof rec["data"] === "object") {
      return rec["data"] as Record<string, unknown>;
    }
    return rec;
  }
  return {};
}

function providerErrorMessage(action: string, status: number, bodyText: string): string {
  let detail = bodyText.slice(0, 400);
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const inner = unwrap(parsed);
    const msg = inner["message"] ?? inner["msg"] ?? inner["error"] ?? parsed["message"];
    if (typeof msg === "string" && msg.length > 0) detail = msg.slice(0, 400);
  } catch {
    /* keep the raw slice */
  }
  return `WaveSpeed ${action} failed: HTTP ${status} — ${detail}`;
}

/**
 * Submit ONE LatentSync generation. Exactly one HTTP attempt — see the
 * billing-safety note at the top of this file. The inputs are public
 * URLs (the poller's trimmed, signed video + audio segments).
 * Returns the prediction id.
 */
export async function waveSpeedSubmit(
  videoUrl: string,
  audioUrl: string,
  apiKey: string,
): Promise<string> {
  const model = getLatentSyncModel();
  const payload = { video: videoUrl, audio: audioUrl };
  logger.info("[lip-sync] WaveSpeed payload keys: %s", ["model", "input[video]", "input[audio]"].join(", "));

  let res: Response;
  try {
    res = await fetch(`${getWaveSpeedBase()}/${model}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    // No response: the task may exist provider-side. Surface as a
    // status-less WaveSpeedError so the classifier returns "transport"
    // and the poller refuses to resubmit blind.
    throw new WaveSpeedError(
      `WaveSpeed submit outcome unknown (no response): ${err instanceof Error ? err.message : String(err)}`,
      null,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new WaveSpeedError(providerErrorMessage("submit", res.status, body), res.status);
  }
  const data = unwrap((await res.json().catch(() => ({}))) as unknown);
  const id = data["id"];
  if (typeof id !== "string" || !id) {
    throw new WaveSpeedError("WaveSpeed returned no prediction ID.", res.status);
  }
  return id;
}

/**
 * Single-shot status check for one WaveSpeed prediction. A free read —
 * safe to call repeatedly; the background poller calls this on its
 * backoff schedule and run-all's recovery path recovers by id.
 */
export async function waveSpeedStatus(
  predictionId: string,
  apiKey: string,
): Promise<WaveSpeedJob> {
  let res: Response;
  try {
    res = await fetch(`${getWaveSpeedBase()}/predictions/${predictionId}/result`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new WaveSpeedError(
      `WaveSpeed status check failed (no response): ${err instanceof Error ? err.message : String(err)}`,
      null,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new WaveSpeedError(providerErrorMessage("status check", res.status, body), res.status);
  }
  const data = unwrap((await res.json().catch(() => ({}))) as unknown);
  const outputs = data["outputs"];
  const firstOutput = Array.isArray(outputs) ? outputs[0] : undefined;
  const rawError = data["error"];
  return {
    status: typeof data["status"] === "string" ? data["status"] : "",
    outputUrl: typeof firstOutput === "string" ? firstOutput : undefined,
    error:
      typeof rawError === "string"
        ? rawError
        : rawError && typeof rawError === "object"
          ? JSON.stringify(rawError).slice(0, 300)
          : undefined,
  };
}
