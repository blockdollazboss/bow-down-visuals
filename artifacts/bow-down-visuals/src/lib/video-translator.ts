/**
 * video-translator lib — shared frontend helpers for the AI Video Translator.
 *
 * Mirrors the backend pricing (5 credits/min/language) so the UI cost
 * preview matches the charge. If the backend default changes, update both.
 */

export interface TargetLanguage {
  code: string;
  label: string;
}

/** Keep in sync with the backend TARGET_LANGUAGES catalog. */
export const TARGET_LANGUAGES: TargetLanguage[] = [
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "pt", label: "Portuguese" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese (Mandarin)" },
  { code: "hi", label: "Hindi" },
  { code: "ar", label: "Arabic" },
  { code: "ru", label: "Russian" },
  { code: "tr", label: "Turkish" },
];

export const TRANSLATOR_CREDITS_PER_MIN_PER_LANG = 5;
export const TRANSLATOR_MAX_LANGUAGES = 6;
export const TRANSLATOR_MAX_BYTES = 80 * 1024 * 1024; // 80 MB

export function isSupportedLanguage(code: string): boolean {
  return TARGET_LANGUAGES.some((l) => l.code === code);
}

export function languageLabel(code: string): string {
  return TARGET_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

/**
 * Estimate the credit cost. Duration comes from the video element's
 * metadata when available; falls back to a 1-minute floor so the preview
 * never promises less than the charge.
 */
export function estimateTranslateCost(durationSec: number | null, languageCount: number): {
  billableMinutes: number;
  credits: number;
} {
  const secs = durationSec && durationSec > 0 ? durationSec : 60;
  const billableMinutes = Math.max(1, Math.ceil(secs / 60));
  return {
    billableMinutes,
    credits: billableMinutes * languageCount * TRANSLATOR_CREDITS_PER_MIN_PER_LANG,
  };
}

export function formatDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export type TranslateJobStatus = "queued" | "processing" | "done" | "failed";

export interface TranslatedOutput {
  language: string;
  label: string;
  videoUrl: string | null;
  videoRef: string | null;
  srtUrl: string | null;
  srtRef: string | null;
  error: string | null;
}

export interface TranslateJobState {
  jobId: string;
  status: TranslateJobStatus;
  languages: string[];
  sourceName: string;
  durationSec: number | null;
  outputs: TranslatedOutput[];
  error: string | null;
  createdAt: number;
}

export const JOB_POLL_MS = 4000;

export const HONESTY_NOTE = "AI dubbing, not human translation — review before publishing.";
