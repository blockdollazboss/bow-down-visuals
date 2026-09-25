/* Podcast Studio helpers — cost estimation mirrors the backend
   (see api-server/src/routes/generate/podcast.ts). Keep WORDS_PER_MINUTE,
   SECONDS_PER_BLOCK and PODCAST_CREDITS_PER_10MIN in sync with the server. */

export const WORDS_PER_MINUTE = 150;
export const SECONDS_PER_BLOCK = 600;
export const PODCAST_CREDITS_PER_10MIN = 3;
export const MAX_SCRIPT_CHARS = 36_000;

export type PodcastMode = "script" | "topic" | "video";
export type PodcastFormat = "single" | "dual";

export interface PodcastEstimate {
  wordCount: number;
  estimatedSeconds: number;
  billableBlocks: number;
  credits: number;
}

export function estimatePodcastCost(script: string): PodcastEstimate {
  const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
  const estimatedSeconds = Math.ceil((wordCount / WORDS_PER_MINUTE) * 60);
  const billableBlocks = Math.max(1, Math.ceil(estimatedSeconds / SECONDS_PER_BLOCK));
  return {
    wordCount,
    estimatedSeconds,
    billableBlocks,
    credits: billableBlocks * PODCAST_CREDITS_PER_10MIN,
  };
}

/** Rough estimate for topic mode before the AI script exists (~8-10 min). */
export function estimateTopicModeCost(): PodcastEstimate {
  return estimatePodcastCost(new Array(1350).fill("word").join(" "));
}

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatTimestamp(totalSeconds: number): string {
  return formatDuration(totalSeconds);
}

export interface PodcastChapter {
  title: string;
  startSeconds: number;
}
