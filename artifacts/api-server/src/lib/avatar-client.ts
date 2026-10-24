/**
 * avatar-client.ts — AI avatar / talking-head provider abstraction.
 *
 * Provider chosen at deploy time via env. Hedra (Character-3) is the wired
 * engine (owner ruling, Oct 24 2026: Hedra is THE avatar engine, priced
 * 1,200 VB per generation). HeyGen remains selectable but its submit is
 * not implemented — it fails honestly, never silently.
 *
 * Env:
 *   HEDRA_API_KEY  — Hedra API v3 key (https://www.hedra.com/develop/api-keys).
 *                    v3 auth is `Authorization: Key <key>`; the console key is
 *                    a `key_id:secret` pair stored whole in this one variable.
 *   HEYGEN_API_KEY — HeyGen API key (reserved; submit not implemented).
 *   AVATAR_PROVIDER — "heygen" | "hedra" (default: hedra when its key exists,
 *                    else heygen when its key exists).
 *   HEDRA_AVATAR_MODEL — model id override (default "hedra-character-3").
 *   HEDRA_AVATAR_RESOLUTION — "540p" | "720p" | "1080p" (default "720p").
 *   AVATAR_TTS_VOICE_ID — ElevenLabs voice used to speak the script when no
 *                    driving audio is supplied (default: stock voice).
 *   ELEVENLABS_API_KEY / ELEVENLABS_TTS_MODEL — the site's existing TTS rail,
 *                    used to turn a script into the driving audio Hedra needs.
 *
 * Hedra v3 contract (hedra.com/docs, verified Oct 24 2026):
 *   POST /v3/files (multipart) → { url } upload handle (~1h lifetime)
 *   POST /v3/models/{model} { input, idempotency_key } → 202 { job_id, ... }
 *   GET  /v3/jobs/{id}/status → { status: IN_QUEUE|IN_PROGRESS|COMPLETED|FAILED }
 *   GET  /v3/jobs/{id} → { status, outputs: [{ status, url, asset_id }], error }
 * Character-3 is audio-driven: it requires a start image + driving audio.
 * There is no script input — the script is spoken via the site's TTS rail.
 */

export type AvatarProvider = "heygen" | "hedra";

export function avatarProviderName(): AvatarProvider | null {
  const forced = (process.env["AVATAR_PROVIDER"] || "").toLowerCase();
  if (forced === "heygen" && process.env["HEYGEN_API_KEY"]) return "heygen";
  if (forced === "hedra" && process.env["HEDRA_API_KEY"]) return "hedra";
  // Owner-ruled default engine: Hedra first when its key exists.
  if (process.env["HEDRA_API_KEY"]) return "hedra";
  if (process.env["HEYGEN_API_KEY"]) return "heygen";
  return null;
}

/** True only when a provider key is configured. The UI gates on this. */
export function avatarProviderConfigured(): boolean {
  return avatarProviderName() !== null;
}

export class AvatarNotConfiguredError extends Error {
  readonly code = "AVATAR_PROVIDER_NOT_CONFIGURED";
  constructor() {
    super(
      "AI avatar generation is not connected yet — no HeyGen or Hedra API key is configured on the server. " +
        "Add HEDRA_API_KEY (or HEYGEN_API_KEY) to enable talking-head presenters.",
    );
    this.name = "AvatarNotConfiguredError";
  }
}

/** The request itself is missing something the provider cannot work without. */
export class AvatarInputError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AvatarInputError";
    this.code = code;
  }
}

/** The provider answered with an error (or an unreadable response). */
export class AvatarProviderError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "AvatarProviderError";
    this.status = status;
  }
}

function requireProvider(): AvatarProvider {
  const provider = avatarProviderName();
  if (!provider) throw new AvatarNotConfiguredError();
  return provider;
}

export interface AvatarCatalogEntry {
  id: string;
  name: string;
  /** Short descriptor shown in the picker. */
  style: string;
  /** Provider-side avatar id, filled in once the provider is wired. */
  providerAvatarId: string | null;
  /**
   * Character image for this presenter, when one exists. Hedra has no stock
   * presenter library, so these are null until a real character image is
   * attached — a Hedra generation takes the image from the request instead.
   */
  imageUrl: string | null;
}

/**
 * Presenter catalog shown in the picker. providerAvatarId / imageUrl are null
 * until real presenter assets are attached — the entries give the picker its
 * shape, and Hedra generations take the character image per request.
 */
export const AVATAR_PLACEHOLDER_CATALOG: AvatarCatalogEntry[] = [
  { id: "avatar-host-male", name: "Host — Male", style: "Confident studio host", providerAvatarId: null, imageUrl: null },
  { id: "avatar-host-female", name: "Host — Female", style: "Warm studio host", providerAvatarId: null, imageUrl: null },
  { id: "avatar-creator-casual", name: "Creator — Casual", style: "Relaxed creator energy", providerAvatarId: null, imageUrl: null },
  { id: "avatar-creator-bold", name: "Creator — Bold", style: "High-energy hype presenter", providerAvatarId: null, imageUrl: null },
];

export interface AvatarVideoRequest {
  /** Catalog avatar id (see AVATAR_PLACEHOLDER_CATALOG). */
  avatarId: string;
  /** Spoken script for the talking head (plain text). */
  script: string;
  /** Optional voice id override (used by the TTS step when no audio is given). */
  voiceId?: string;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  userId: string;
  /**
   * Character image URL (http/https). Hedra Character-3 animates a still
   * image — without one (here or on the catalog entry) the submit fails
   * honestly with AVATAR_IMAGE_REQUIRED before any provider call.
   */
  imageUrl?: string;
  /**
   * Driving-audio URL (http/https). When present it drives the performance
   * as-is; when absent the script is synthesized through the site's
   * ElevenLabs TTS rail.
   */
  audioUrl?: string;
  /** Optional performance/scene prompt override for the provider. */
  prompt?: string;
  /** Stable per-job key, forwarded to Hedra's own submit idempotency. */
  idempotencyKey?: string;
}

export interface AvatarVideoResult {
  providerJobId: string;
  status: "queued" | "processing" | "done" | "failed";
  videoUrl?: string;
  error?: string;
}

/* ── Hedra v3 ─────────────────────────────────────────────────────── */

export const HEDRA_API_BASE = "https://api.hedra.com/v3";

/** Character-3 start-image ceiling from the published model schema. */
const HEDRA_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Character-3 driving-audio ceiling from the published model schema. */
const HEDRA_MAX_AUDIO_BYTES = 100 * 1024 * 1024;

export function hedraModelId(): string {
  return process.env["HEDRA_AVATAR_MODEL"] || "hedra-character-3";
}

export function hedraResolution(): string {
  const r = (process.env["HEDRA_AVATAR_RESOLUTION"] || "720p").toLowerCase();
  return r === "540p" || r === "1080p" ? r : "720p";
}

function hedraHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Key ${process.env["HEDRA_API_KEY"] ?? ""}`,
    ...extra,
  };
}

export interface HedraCharacter3Input {
  start_image: { source: "url"; url: string };
  audio: { source: "url"; url: string };
  prompt: string;
  aspect_ratio: string;
  resolution: string;
}

/** Pure builder for the Character-3 submit input (pinned by tests). */
export function buildHedraSubmitInput(args: {
  imageHandleUrl: string;
  audioHandleUrl: string;
  prompt: string;
  aspectRatio?: string;
}): HedraCharacter3Input {
  return {
    start_image: { source: "url", url: args.imageHandleUrl },
    audio: { source: "url", url: args.audioHandleUrl },
    prompt: args.prompt,
    aspect_ratio: args.aspectRatio ?? "16:9",
    resolution: hedraResolution(),
  };
}

/** Map a Hedra job payload (status or result envelope) to our states. */
export function mapHedraJobPayload(payload: unknown): AvatarVideoResult {
  const p = (payload ?? {}) as {
    status?: string;
    outputs?: Array<{ status?: string; url?: string }>;
    error?: { code?: string; message?: string } | string | null;
  };
  const raw = String(p.status ?? "").toUpperCase();
  if (raw === "COMPLETED") {
    const out = (p.outputs ?? []).find((o) => o && (o.url || o.status === "COMPLETED"));
    if (out?.url) {
      return { providerJobId: "", status: "done", videoUrl: out.url };
    }
    return {
      providerJobId: "",
      status: "failed",
      error: "Hedra reported completion but returned no video output.",
    };
  }
  if (raw === "FAILED") {
    const msg =
      typeof p.error === "string"
        ? p.error
        : p.error?.message || "Hedra generation failed.";
    return { providerJobId: "", status: "failed", error: msg };
  }
  if (raw === "IN_PROGRESS") return { providerJobId: "", status: "processing" };
  return { providerJobId: "", status: "queued" };
}

async function hedraFetch(path: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${HEDRA_API_BASE}${path}`, {
      ...init,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new AvatarProviderError(
      `Hedra request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body — handled by the status check below */
  }
  if (!res.ok) {
    const env = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new AvatarProviderError(
      `Hedra ${path} failed: HTTP ${res.status}${env?.code ? ` (${env.code})` : ""}${env?.message ? ` — ${env.message}` : ""}`,
      res.status,
    );
  }
  return json;
}

/** Fetch bytes from one of our/user URLs (image or audio source). */
async function fetchMediaBytes(
  url: string,
  kind: "image" | "audio",
): Promise<{ bytes: Buffer; contentType: string }> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  } catch (err) {
    throw new AvatarInputError(
      kind === "image" ? "AVATAR_IMAGE_UNREACHABLE" : "AVATAR_AUDIO_UNREACHABLE",
      `Could not download the ${kind} for the avatar generation: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new AvatarInputError(
      kind === "image" ? "AVATAR_IMAGE_UNREACHABLE" : "AVATAR_AUDIO_UNREACHABLE",
      `Could not download the ${kind} for the avatar generation (HTTP ${res.status}).`,
    );
  }
  const contentType = res.headers.get("content-type") || (kind === "image" ? "image/png" : "audio/mpeg");
  const bytes = Buffer.from(await res.arrayBuffer());
  const max = kind === "image" ? HEDRA_MAX_IMAGE_BYTES : HEDRA_MAX_AUDIO_BYTES;
  if (bytes.length === 0 || bytes.length > max) {
    throw new AvatarInputError(
      kind === "image" ? "AVATAR_IMAGE_INVALID" : "AVATAR_AUDIO_INVALID",
      `The ${kind} for the avatar generation is empty or larger than Hedra accepts.`,
    );
  }
  return { bytes, contentType };
}

/** Upload bytes to Hedra /v3/files and return the upload-handle URL. */
async function hedraUploadFile(
  bytes: Buffer,
  filename: string,
  contentType: string,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
  const json = (await hedraFetch("/files", {
    method: "POST",
    headers: hedraHeaders(),
    body: form,
  })) as { url?: string } | null;
  if (!json?.url) {
    throw new AvatarProviderError("Hedra file upload returned no URL handle.");
  }
  return json.url;
}

/** Speak the script through the site's ElevenLabs TTS rail (voiceover pattern). */
async function synthesizeScriptAudio(req: AvatarVideoRequest): Promise<Buffer> {
  const elevenKey = process.env["ELEVENLABS_API_KEY"];
  if (!elevenKey) {
    throw new AvatarInputError(
      "AVATAR_AUDIO_REQUIRED",
      "This avatar generation needs driving audio: supply an audio file, or configure the site's voice service (ELEVENLABS_API_KEY) so the script can be spoken.",
    );
  }
  const voiceId =
    req.voiceId || process.env["AVATAR_TTS_VOICE_ID"] || "21m00Tcm4TlvDq8ikWAM";
  const model = process.env["ELEVENLABS_TTS_MODEL"] || "eleven_v4";
  let res: Response;
  try {
    res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": elevenKey, "Content-Type": "application/json" },
        body: JSON.stringify({ text: req.script, model_id: model }),
        signal: AbortSignal.timeout(120_000),
      },
    );
  } catch (err) {
    throw new AvatarProviderError(
      `Voice synthesis for the avatar script failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new AvatarProviderError(
      `Voice synthesis for the avatar script failed (HTTP ${res.status}).`,
      res.status,
    );
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) {
    throw new AvatarProviderError("Voice synthesis returned empty audio.");
  }
  return bytes;
}

function defaultPrompt(req: AvatarVideoRequest): string {
  if (req.prompt && req.prompt.trim()) return req.prompt.trim();
  const entry = AVATAR_PLACEHOLDER_CATALOG.find((a) => a.id === req.avatarId);
  const style = entry?.style ?? "Studio presenter";
  return `${style} speaking naturally to camera, expressive and confident, delivering a presenter script.`;
}

async function submitHedraAvatar(req: AvatarVideoRequest): Promise<AvatarVideoResult> {
  // 1. Character image — request first, catalog entry second, else honest stop.
  const entry = AVATAR_PLACEHOLDER_CATALOG.find((a) => a.id === req.avatarId);
  const imageUrl = req.imageUrl || entry?.imageUrl || undefined;
  if (!imageUrl) {
    throw new AvatarInputError(
      "AVATAR_IMAGE_REQUIRED",
      "Hedra Character-3 animates a character image — this presenter has no image attached yet. Supply a character image to generate.",
    );
  }
  const image = await fetchMediaBytes(imageUrl, "image");

  // 2. Driving audio — supplied audio wins; otherwise speak the script.
  let audioBytes: Buffer;
  let audioType = "audio/mpeg";
  if (req.audioUrl) {
    const audio = await fetchMediaBytes(req.audioUrl, "audio");
    audioBytes = audio.bytes;
    audioType = audio.contentType;
  } else {
    if (!req.script || !req.script.trim()) {
      throw new AvatarInputError(
        "AVATAR_AUDIO_REQUIRED",
        "This avatar generation needs a script to speak or a driving audio file.",
      );
    }
    audioBytes = await synthesizeScriptAudio(req);
  }

  // 3. Upload both inputs to Hedra (media must be Hedra handles, not raw URLs).
  const [imageHandle, audioHandle] = await Promise.all([
    hedraUploadFile(image.bytes, "avatar-character.png", image.contentType),
    hedraUploadFile(audioBytes, "avatar-audio.mp3", audioType),
  ]);

  // 4. Submit the Character-3 job (Hedra replays the ack on idempotency key).
  const input = buildHedraSubmitInput({
    imageHandleUrl: imageHandle,
    audioHandleUrl: audioHandle,
    prompt: defaultPrompt(req),
    aspectRatio: req.aspectRatio,
  });
  const ack = (await hedraFetch(`/models/${encodeURIComponent(hedraModelId())}`, {
    method: "POST",
    headers: hedraHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      input,
      ...(req.idempotencyKey ? { idempotency_key: req.idempotencyKey } : {}),
    }),
  })) as { job_id?: string; status?: string } | null;
  if (!ack?.job_id) {
    throw new AvatarProviderError("Hedra accepted the request but returned no job id.");
  }
  return { providerJobId: ack.job_id, status: "processing" };
}

/**
 * Submits a talking-head generation to the configured provider.
 * Hedra is implemented; HeyGen is reserved and throws an honest
 * not-implemented error until its submit is wired.
 */
export async function submitAvatarVideo(req: AvatarVideoRequest): Promise<AvatarVideoResult> {
  const provider = requireProvider();
  if (provider === "hedra") return submitHedraAvatar(req);
  throw new Error(
    `Avatar provider "${provider}" is configured but its live submit call is not implemented yet — Hedra is the wired engine.`,
  );
}

/**
 * Single-shot status/result check for a submitted provider job.
 * For Hedra this reads the full job envelope (outputs ride along), so a
 * "done" result already carries the finished video URL.
 */
export async function getAvatarVideoStatus(providerJobId: string): Promise<AvatarVideoResult> {
  const provider = requireProvider();
  if (provider !== "hedra") {
    throw new Error(
      `Avatar provider "${provider}" is configured but its live status call is not implemented yet — Hedra is the wired engine.`,
    );
  }
  const payload = await hedraFetch(`/jobs/${encodeURIComponent(providerJobId)}`, {
    method: "GET",
    headers: hedraHeaders(),
  });
  const mapped = mapHedraJobPayload(payload);
  return { ...mapped, providerJobId };
}
