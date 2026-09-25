import type { FetchImpl } from "@/hooks/use-confirmed-api";

export interface GenerateMusicAudioRequest {
  prompt: string;
  /** Desired length in seconds (server clamps to 10–300, default 60). */
  lengthSeconds?: number;
  artistName?: string;
  songTitle?: string;
  /** Active artist vault — server swaps vocals to its locked voice if set. */
  artistVaultId?: string;
}

export interface GenerateMusicAudioResponse {
  url: string;
  storagePath: string;
  durationMs: number;
  creditsRemaining: number;
  genHistoryId: string;
}

const FRIENDLY_ERRORS: Record<string, string> = {
  missing_prompt: "Add a prompt describing the sound you want first.",
  audio_gen_unavailable: "Real audio generation isn't set up on this server yet.",
  audio_gen_failed: "Music generation failed. Try a different prompt or try again shortly.",
  audio_gen_empty: "Music generation returned no audio. Please try again.",
  upload_failed: "Could not save the generated audio. Please try again.",
};

export async function generateMusicAudio(
  token: string,
  payload: GenerateMusicAudioRequest,
  /** Pass confirmedFetch from useConfirmedApi() to confirm credit spend first. */
  fetchImpl: FetchImpl = fetch,
): Promise<GenerateMusicAudioResponse | null> {
  let res: Response | null;
  try {
    res = await fetchImpl("/api/generate-music-audio", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Network error while generating audio. Please try again.");
  }
  if (!res) return null; // user cancelled the credit confirmation

  let data: (Partial<GenerateMusicAudioResponse> & { error?: string; code?: string }) | null = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }

  if (res.status === 402 || data?.error === "out_of_credits") {
    throw new Error("out_of_credits");
  }

  if (!res.ok) {
    const code = data?.code;
    throw new Error((code && FRIENDLY_ERRORS[code]) || data?.error || "Music generation failed. Please try again.");
  }
  if (!data?.url) {
    throw new Error("Generation finished but no audio was returned.");
  }
  return data as GenerateMusicAudioResponse;
}
