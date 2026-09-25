/* Voiceover Studio helpers — cost estimation mirrors the backend
   (see api-server/src/routes/generate/voiceover.ts). Keep WORDS_PER_MINUTE
   and VOICEOVER_CREDITS_PER_MINUTE in sync with the server. */

export const WORDS_PER_MINUTE = 150;
export const VOICEOVER_CREDITS_PER_MINUTE = 2;

export type VoiceoverEmotion =
  | "energetic"
  | "calm"
  | "dramatic"
  | "conversational";

export const EMOTIONS: { key: VoiceoverEmotion; label: string; blurb: string }[] = [
  {
    key: "energetic",
    label: "Energetic",
    blurb: "High energy — hype intros, ads, announcements",
  },
  {
    key: "calm",
    label: "Calm",
    blurb: "Steady and soothing — tutorials, explainers",
  },
  {
    key: "dramatic",
    label: "Dramatic",
    blurb: "Cinematic weight — trailers, storytelling",
  },
  {
    key: "conversational",
    label: "Conversational",
    blurb: "Natural and friendly — vlogs, podcasts",
  },
];

export interface VoiceoverEstimate {
  wordCount: number;
  estimatedSeconds: number;
  billableMinutes: number;
  credits: number;
}

export function estimateVoiceoverCost(script: string): VoiceoverEstimate {
  const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
  const estimatedSeconds = Math.ceil((wordCount / WORDS_PER_MINUTE) * 60);
  const billableMinutes = Math.max(1, Math.ceil(estimatedSeconds / 60));
  return {
    wordCount,
    estimatedSeconds,
    billableMinutes,
    credits: billableMinutes * VOICEOVER_CREDITS_PER_MINUTE,
  };
}

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/* LocalStorage key the video editor checks on mount for a voiceover
   handoff (see video-editor.tsx). */
export const VOICEOVER_HANDOFF_KEY = "bdv_voiceover_handoff";

export interface VoiceoverHandoff {
  audioUrl: string;
  format: "mp3" | "wav";
  wordCount: number;
  createdAt: number;
}

export function saveVoiceoverHandoff(handoff: VoiceoverHandoff): void {
  try {
    localStorage.setItem(VOICEOVER_HANDOFF_KEY, JSON.stringify(handoff));
  } catch {
    /* storage full or unavailable — the handoff is a convenience, not critical */
  }
}
