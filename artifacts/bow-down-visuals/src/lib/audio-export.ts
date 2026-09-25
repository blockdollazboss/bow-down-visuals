import type {
  AudioExportRecord,
  AudioExportKind,
  StemEffects,
  VideoAudioSource,
} from "@/lib/editor-settings";
import type { FetchImpl } from "@/hooks/use-confirmed-api";

export type AudioExportType = "full-mp3" | "full-wav" | "instrumental-mp3" | "acapella-mp3";

export interface AudioExportButton {
  id: AudioExportType;
  label: string;
  kind: AudioExportKind;
  format: "mp3" | "wav";
}

export const AUDIO_EXPORT_BUTTONS: AudioExportButton[] = [
  { id: "full-mp3", label: "Export Full Mix MP3", kind: "full", format: "mp3" },
  { id: "full-wav", label: "Export Full Mix WAV", kind: "full", format: "wav" },
  { id: "instrumental-mp3", label: "Export Instrumental MP3", kind: "instrumental", format: "mp3" },
  { id: "acapella-mp3", label: "Export Acapella MP3", kind: "acapella", format: "mp3" },
];

export type DirectAudioExportStatus =
  | { status: "idle" }
  | { status: "rendering"; exportType: AudioExportType; label: string }
  | { status: "complete"; exportType: AudioExportType; label: string }
  | { status: "error"; exportType: AudioExportType; label: string; message: string };

/** The video editor always uses the MP3 variant when it needs a rendered mix. */
export function audioExportTypeForVideoAudioSource(
  source: VideoAudioSource,
): AudioExportType | null {
  switch (source) {
    case "full-mix":
      return "full-mp3";
    case "instrumental":
      return "instrumental-mp3";
    case "acapella":
      return "acapella-mp3";
    default:
      return null;
  }
}

type RenderableStem = Pick<{
  name: string;
  type: string;
  muted: boolean;
  url: string;
}, "name" | "type" | "muted" | "url">;

/**
 * Keep the fallback action honest about whether the server can select stems
 * for the requested mix. This mirrors the role matching in the API export
 * route, so instrumental/acapella actions are not offered for unrelated or
 * muted stems.
 */
export function canRenderVideoAudioSource(
  source: VideoAudioSource,
  stems: RenderableStem[],
): boolean {
  const active = stems.filter((stem) => !stem.muted && stem.url.startsWith("http"));
  if (source === "full-mix") return active.length > 0;

  const text = (stem: RenderableStem) => `${stem.type} ${stem.name}`.toLowerCase();
  const isVocal = (stem: RenderableStem) =>
    /ad[- ]?lib|back|harmon|bgv|lead|vocal|vox|verse|hook|rap/.test(text(stem));
  const isInstrumental = (stem: RenderableStem) =>
    /808|bass|sub|hi[- ]?hat|hat|drum|perc|kick|snare|beat|instrument|full song|melod|synth|key|piano|guitar|string|pad/.test(text(stem));

  if (source === "instrumental") return active.some(isInstrumental);
  if (source === "acapella") return active.some(isVocal);
  return false;
}

export interface ExportStemPayload {
  id: string;
  name: string;
  type: string;
  url: string;
  volume: number;
  muted: boolean;
  /** Mixer solo — when any stem is soloed, only soloed stems render in a full mix. */
  solo: boolean;
  /** -100 (L) … 100 (R). */
  pan: number;
  trimStart: number;
  trimEnd: number;
  durationSec?: number;
  /** Per-stem effect chain (EQ, reverb, delay, compression, saturation, de-ess, denoise). */
  effects?: StemEffects;
}

export interface MasterBusPayload {
  volume: number;
  compression: number;
  stereoWidth: number;
  bassBoost: number;
  eqTone: string;
  loudnessTarget: string;
  limiter: boolean;
  fadeIn: boolean;
  fadeOut: boolean;
}

export interface AudioExportRequest {
  exportType: AudioExportType;
  stems: ExportStemPayload[];
  masterVolume: number;
  /** Full master bus settings — compression, EQ, bass boost, stereo width, loudness, fades. */
  masterSettings?: MasterBusPayload;
}

export interface AudioExportResponse {
  url: string;
  format: "mp3" | "wav";
  kind: AudioExportKind;
  exportType: AudioExportType;
  stemsUsed: string[];
  createdAt: string;
  /** Non-fatal issues from the render, e.g. vocal tuning unavailable server-side. */
  warnings?: string[];
}

const FRIENDLY_ERRORS: Record<string, string> = {
  no_stems: "No stems match this export. Upload or label your stems and try again.",
  ffmpeg_unavailable: "Audio export isn't available on this server right now.",
  stem_download_failed: "A stem file couldn't be downloaded. Re-upload it and try again.",
  export_failed: "Export failed. Please try again.",
  export_timeout:
    "The render took too long and was stopped. Try exporting fewer stems, turning off heavy per-stem effects, or a shorter section of the song.",
  invalid_type: "That export type isn't supported.",
  invalid_stem_url: "One or more stems came from an untrusted source. Re-upload them and try again.",
  too_many_stems: "Too many stems to export. Remove a few and try again.",
  job_not_found: "This export job expired. Please start the export again.",
};

/** Mix renders run as a background job (can take several minutes for a full
 *  song with many stems/effects), so the client polls until it finishes
 *  instead of holding one long-lived request open. */
interface MixExportJobStatus {
  status: "queued" | "processing" | "done" | "failed";
  result?: AudioExportResponse;
  error?: string;
  code?: string;
}

const POLL_INTERVAL_MS = 2_500;
/** 12 minutes of polling — comfortably above the server's 10-minute FFmpeg ceiling. */
const MAX_POLL_MS = 12 * 60_000;

function throwFriendly(code: string | undefined, fallback: string): never {
  throw new Error((code && FRIENDLY_ERRORS[code]) || fallback);
}

export async function requestAudioExport(
  token: string,
  payload: AudioExportRequest,
  /** Pass confirmedFetch from useConfirmedApi() to confirm credit spend first. */
  fetchImpl: FetchImpl = fetch,
): Promise<AudioExportResponse | null> {
  let res: Response | null;
  try {
    res = await fetchImpl("/api/music/export", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Network error during export. Please try again.");
  }
  if (!res) return null; // user cancelled the credit confirmation

  let data: (Partial<{ jobId: string }> & { error?: string; code?: string }) | null = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }

  if (!res.ok) {
    throwFriendly(data?.code, data?.error || "Export failed. Please try again.");
  }
  if (!data?.jobId) {
    throw new Error("Export could not be started. Please try again.");
  }

  return pollMixExportJob(token, data.jobId);
}

async function pollMixExportJob(token: string, jobId: string): Promise<AudioExportResponse> {
  const deadline = Date.now() + MAX_POLL_MS;
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    let res: Response;
    try {
      res = await fetch(`/api/music/export/job/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      throw new Error("Network error while checking export progress. Please try again.");
    }

    let job: (Partial<MixExportJobStatus> & { error?: string; code?: string }) | null = null;
    try {
      job = await res.json();
    } catch {
      /* non-JSON response */
    }

    if (!res.ok) {
      throwFriendly(job?.code, job?.error || "Export failed. Please try again.");
    }
    if (job?.status === "done") {
      if (!job.result?.url) throw new Error("Export finished but no file was returned.");
      return job.result;
    }
    if (job?.status === "failed") {
      throwFriendly(job.code, job.error || "Export failed. Please try again.");
    }
    if (Date.now() > deadline) {
      throw new Error(
        "The render is taking unusually long. It may still finish — check back in a few minutes, or try again with fewer stems.",
      );
    }
    /* status is "queued" or "processing" — keep polling */
  }
}

export interface PreviewRenderResult {
  /** Blob URL for an <audio> element. Caller is responsible for revoking it. */
  url: string;
  seconds: number;
  warnings: string[];
}

/**
 * Renders a short (5-20s) clip through the *real* server-side FFmpeg mix
 * pipeline — the exact same code path as a full export — so users can hear
 * the true render (including things the browser preview can't reproduce,
 * like real pitch correction) before spending export credits.
 */
export async function requestPreviewRender(
  token: string,
  payload: {
    stems: ExportStemPayload[];
    masterVolume: number;
    masterSettings?: MasterBusPayload;
    previewSeconds?: number;
  },
  /** Pass confirmedFetch from useConfirmedApi() to confirm credit spend first. */
  fetchImpl: FetchImpl = fetch,
): Promise<PreviewRenderResult | null> {
  let res: Response | null;
  try {
    res = await fetchImpl("/api/music/preview-render", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Network error while rendering the preview. Please try again.");
  }
  if (!res) return null; // user cancelled the credit confirmation

  if (!res.ok) {
    let data: { error?: string; code?: string } | null = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON response */
    }
    throwFriendly(data?.code, data?.error || "Preview render failed. Please try again.");
  }

  const seconds = Number(res.headers.get("X-Preview-Seconds")) || payload.previewSeconds || 12;
  let warnings: string[] = [];
  const rawWarnings = res.headers.get("X-Preview-Warnings");
  if (rawWarnings) {
    try {
      warnings = JSON.parse(decodeURIComponent(rawWarnings));
    } catch {
      /* ignore malformed warnings header */
    }
  }

  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), seconds, warnings };
}

/** Build an AudioExportRecord from a completed export response + the live mix. */
export function buildExportRecord(
  btn: AudioExportButton,
  resp: AudioExportResponse,
  mixSettings: AudioExportRecord["mixSettings"],
): AudioExportRecord {
  return {
    id: `exp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    label: btn.label,
    kind: resp.kind,
    url: resp.url,
    format: resp.format,
    stemsUsed: resp.stemsUsed,
    mixSettings,
    createdAt: resp.createdAt,
  };
}
