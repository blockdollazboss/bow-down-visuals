import type { AudioExportRecord, AudioExportKind } from "@/lib/editor-settings";

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

export interface ExportStemPayload {
  id: string;
  name: string;
  type: string;
  url: string;
  volume: number;
  muted: boolean;
  trimStart: number;
  trimEnd: number;
  durationSec?: number;
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
}

const FRIENDLY_ERRORS: Record<string, string> = {
  no_stems: "No stems match this export. Upload or label your stems and try again.",
  ffmpeg_unavailable: "Audio export isn't available on this server right now.",
  stem_download_failed: "A stem file couldn't be downloaded. Re-upload it and try again.",
  export_failed: "Export failed. Please try again.",
  invalid_type: "That export type isn't supported.",
  invalid_stem_url: "One or more stems came from an untrusted source. Re-upload them and try again.",
  too_many_stems: "Too many stems to export. Remove a few and try again.",
};

export async function requestAudioExport(
  token: string,
  payload: AudioExportRequest,
): Promise<AudioExportResponse> {
  let res: Response;
  try {
    res = await fetch("/api/music/export", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Network error during export. Please try again.");
  }

  let data: (Partial<AudioExportResponse> & { error?: string; code?: string }) | null = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }

  if (!res.ok) {
    const code = data?.code;
    throw new Error((code && FRIENDLY_ERRORS[code]) || data?.error || "Export failed. Please try again.");
  }
  if (!data?.url) {
    throw new Error("Export finished but no file was returned.");
  }
  return data as AudioExportResponse;
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
