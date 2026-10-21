/* Podcast Studio helpers — cost estimation mirrors the backend
   (see api-server/src/routes/generate/podcast.ts). Keep WORDS_PER_MINUTE,
   SECONDS_PER_BLOCK and PODCAST_CREDITS_PER_10MIN in sync with the server. */

export const WORDS_PER_MINUTE = 150;
export const SECONDS_PER_BLOCK = 600;
export const PODCAST_CREDITS_PER_10MIN = 3;
export const MAX_SCRIPT_CHARS = 36_000;

export type PodcastMode = "script" | "topic" | "video" | "dialogue";
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

/* ── Multi-speaker dialogue (ElevenLabs text-to-dialogue) ────────────────
   Mirrors api-server/src/routes/generate/podcast-dialogue.ts — keep
   DIALOGUE_CREDITS_PER_10MIN and the tag format in sync with the server. */

/**
 * PLACEHOLDER — NOT USER-APPROVED. Proposed dialogue price; the final price
 * needs the user's explicit approval (server gate: DIALOGUE_PRICING_APPROVED).
 */
export const DIALOGUE_CREDITS_PER_10MIN = 3;
export const DIALOGUE_SECONDS_PER_BLOCK = 600;
export const MAX_DIALOGUE_SPEAKERS = 8;

/** `NAME: line` — same tag format the server parses. */
const DIALOGUE_TAG_RE = /^([A-Za-z][A-Za-z0-9 _-]{0,29}):\s*(.+)$/;

/** Speaker names in first-appearance order. */
export function parseDialogueSpeakers(script: string): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of script.split("\n")) {
    const line = rawLine.trim();
    if (!line || /^#{1,3}\s+/.test(line)) continue;
    const m = line.match(DIALOGUE_TAG_RE);
    if (!m || !m[2]!.trim()) continue;
    const name = m[1]!.trim();
    if (!seen.has(name)) {
      seen.add(name);
      order.push(name);
    }
  }
  return order;
}

/** Lines that carry no speaker tag (the server drops them — warn the user). */
export function countUntaggedDialogueLines(script: string): number {
  let n = 0;
  for (const rawLine of script.split("\n")) {
    const line = rawLine.trim();
    if (!line || /^#{1,3}\s+/.test(line)) continue;
    const m = line.match(DIALOGUE_TAG_RE);
    if (!m || !m[2]!.trim()) n++;
  }
  return n;
}

export interface DialogueEstimate extends PodcastEstimate {
  turnCount: number;
  speakerCount: number;
}

export function estimateDialogueCost(script: string): DialogueEstimate {
  const speakers = parseDialogueSpeakers(script);
  const base = estimatePodcastCost(script);
  const turnCount = script
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && DIALOGUE_TAG_RE.test(l)).length;
  return {
    ...base,
    credits: Math.max(1, Math.ceil(base.estimatedSeconds / DIALOGUE_SECONDS_PER_BLOCK)) * DIALOGUE_CREDITS_PER_10MIN,
    turnCount,
    speakerCount: speakers.length,
  };
}

/** Prefilled sample so the dialogue flow works in one tap (simple default). */
export const SAMPLE_DIALOGUE = `ALEX: Welcome back to Creator Cheat Code, the show where we turn content into cash.
JORDAN: And today we're talking about the one thing every creator gets wrong — the first three seconds.
ALEX: Exactly. If your hook doesn't stop the scroll, nothing else matters. Not the edit, not the lighting.
JORDAN: So what's the fix? Give it to me straight.
ALEX: Lead with the payoff. Tell them what they'll get before you tell them who you are.
JORDAN: That's free game right there. Try it on your next upload and watch the retention graph.`;
