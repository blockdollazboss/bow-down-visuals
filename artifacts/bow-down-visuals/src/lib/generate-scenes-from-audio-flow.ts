/**
 * Orchestrates the full "generate scenes straight from this song" flow used by
 * the song-upload steps in make-video.tsx and song-and-video.tsx:
 *   1. Reuse (or fetch) the AI section analysis for the lyrics via /api/analyze-sections.
 *   2. Read the uploaded audio file's duration.
 *   3. Hand both to audio-scene-generator.ts (which also runs beat detection)
 *      to build the final SceneData[].
 *
 * Kept separate from the pages so both entry points share one implementation.
 */
import { readAudioDuration } from "@/lib/audio-stems";
import { generateScenesFromAudio } from "@/lib/audio-scene-generator";
import type { SongStructure } from "@/lib/song-structure";
import type { SceneData } from "@/lib/scene-parser";
import type { FetchImpl } from "@/hooks/use-confirmed-api";

export interface RunAudioSceneFlowParams {
  lyrics: string;
  audioUrl: string;
  audioFile: File | null;
  /** Reused if already analyzed (e.g. user already clicked "Find Hook & Verses"). */
  songStructure: SongStructure | null;
  getAccessToken: () => Promise<string | null | undefined>;
  /** Pass confirmedFetch from useConfirmedApi() to confirm credit spend first. */
  fetchImpl?: FetchImpl;
}

export interface RunAudioSceneFlowResult {
  songStructure: SongStructure;
  scenes: SceneData[];
}

export async function runAudioSceneFlow(params: RunAudioSceneFlowParams): Promise<RunAudioSceneFlowResult | null> {
  const { lyrics, audioUrl, audioFile, songStructure, getAccessToken, fetchImpl = fetch } = params;

  if (!audioUrl) {
    throw new Error("Upload a song first.");
  }
  if (!lyrics || lyrics.trim().length < 10) {
    throw new Error("Add or transcribe lyrics first so scenes can be aligned to the song's structure.");
  }

  let structure = songStructure;
  if (!structure) {
    const token = await getAccessToken();
    const res = await fetchImpl("/api/analyze-sections", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
      body: JSON.stringify({ lyrics }),
    });
    if (!res) return null; // user cancelled the credit confirmation
    if (!res.ok) throw new Error("Song section analysis failed.");
    structure = (await res.json()) as SongStructure;
  }

  const durationSec = audioFile ? (await readAudioDuration(audioFile)) ?? null : null;

  const { scenes } = await generateScenesFromAudio({ audioUrl, durationSec, songStructure: structure });
  if (scenes.length === 0) {
    throw new Error("Could not derive scenes from this song's structure.");
  }

  return { songStructure: structure, scenes };
}
