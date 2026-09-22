/**
 * Derives a structured, timed SceneData[] list directly from a song's audio —
 * no text breakdown required. Combines two analyses that already exist
 * elsewhere in the app:
 *   - beat-grid.ts: client-side BPM/beat detection on the audio itself
 *   - SongStructure (from /api/analyze-sections): AI-detected lyric sections
 *
 * Section boundaries come from the AI analysis (using its timestamps when
 * present, otherwise proportional to lyric length), then every boundary is
 * snapped to the nearest detected beat so cuts land musically. Each section
 * is further split into scene-sized chunks whose length scales with the
 * song's tempo (roughly one scene per 4 bars), also snapped to the grid.
 *
 * Output is plain SceneData[] in the same "M:SS-M:SS" timestamp format the
 * text-breakdown parser produces, so every downstream feature (clip
 * generation, chaining, captions, export) works unmodified.
 */
import { detectBeatGrid, snapToBeat, type BeatGrid } from "@/lib/beat-grid";
import type { SongStructure, SongSection } from "@/lib/song-structure";
import type { SceneData } from "@/lib/scene-parser";

function formatTimestamp(sec: number): string {
  const clamped = Math.max(0, sec);
  const m = Math.floor(clamped / 60);
  const s = Math.round(clamped % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Parse a "1:23" style timestamp into seconds, or null if unparseable. */
function parseMMSS(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d+):(\d{2})/);
  if (!m) return null;
  return +m[1] * 60 + +m[2];
}

interface SectionBounds {
  section: SongSection;
  start: number;
  end: number;
}

/**
 * Derive section start/end boundaries (seconds) for a SongStructure.
 * Uses AI-provided timestamps when every section has one, otherwise
 * distributes sections proportionally by lyric line count across the full
 * song duration. Every boundary is then snapped to the nearest beat.
 */
function deriveSectionBounds(
  structure: SongStructure,
  durationSec: number,
  beats: number[] | null,
): SectionBounds[] {
  const sections = structure.sections.filter((s) => s.name);
  if (sections.length === 0) return [];

  const explicitStarts = sections.map((s) => parseMMSS(s.startTime));
  const useExplicit = structure.hasTimestamps && explicitStarts.every((v) => v !== null);

  let rawBounds: { start: number; end: number }[];
  if (useExplicit) {
    rawBounds = sections.map((s, i) => {
      const start = explicitStarts[i]!;
      const explicitEnd = parseMMSS(s.endTime);
      const nextStart = explicitStarts[i + 1];
      const end = explicitEnd ?? nextStart ?? durationSec;
      return { start, end };
    });
  } else {
    const weights = sections.map((s) => Math.max(1, (s.lyrics ?? "").split("\n").filter((l) => l.trim()).length));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    rawBounds = weights.map((w) => {
      const start = acc;
      acc += (w / totalWeight) * durationSec;
      return { start, end: acc };
    });
  }

  return sections.map((section, i) => {
    const raw = rawBounds[i]!;
    const isFirst = i === 0;
    const isLast = i === sections.length - 1;
    const start = isFirst ? 0 : snapToBeat(raw.start, beats);
    const end = isLast ? durationSec : snapToBeat(raw.end, beats);
    return { section, start: Math.min(start, Math.max(end - 0.5, 0)), end: Math.max(end, start + 0.5) };
  });
}

/**
 * Split a section into scene-sized cut points aligned to the beat grid.
 * Targets roughly one scene per 4 bars (bpm-aware) so pacing scales with
 * tempo; falls back to a flat 4s target when no beat grid is available.
 */
function splitSectionIntoCuts(start: number, end: number, beatGrid: BeatGrid | null): number[] {
  const duration = end - start;
  if (duration <= 0) return [start, end];

  const barLength = beatGrid && beatGrid.bpm > 0 ? (60 / beatGrid.bpm) * 4 : 4;
  const targetSceneLength = Math.min(8, Math.max(2.5, barLength));
  const sceneCount = Math.max(1, Math.round(duration / targetSceneLength));
  const step = duration / sceneCount;

  const cuts: number[] = [start];
  for (let i = 1; i < sceneCount; i++) {
    const raw = start + i * step;
    cuts.push(beatGrid ? snapToBeat(raw, beatGrid.beats) : raw);
  }
  cuts.push(end);

  // Snapping can collapse two cuts onto the same beat — dedupe and re-sort,
  // rounding to avoid floating point noise producing near-duplicate cuts.
  const rounded = cuts.map((c) => Math.round(c * 100) / 100);
  return Array.from(new Set(rounded)).sort((a, b) => a - b);
}

function emptySceneDefaults(): Omit<SceneData, "id" | "sceneNumber" | "timestamp" | "section" | "lyricLine" | "aiVideoPrompt"> {
  return {
    location: "",
    action: "",
    cameraMovement: "",
    lighting: "",
    mood: "",
    negativePrompt: "",
    approved: false,
    demoClipUrl: null,
    thumbnailUrl: null,
    clipId: null,
    runwayJobId: null,
    provider: null,
    generationStatus: null,
    promptUsed: null,
    generatedAt: null,
  };
}

export interface GenerateScenesFromAudioParams {
  audioUrl: string;
  /** Best-known duration of the song in seconds; falls back to detected beat range or 180s. */
  durationSec: number | null;
  songStructure: SongStructure;
}

export interface GenerateScenesFromAudioResult {
  scenes: SceneData[];
  beatGrid: BeatGrid | null;
}

/**
 * Build a structured, timed SceneData[] directly from a song's audio + its
 * AI section analysis. Runs beat detection internally (cached by beat-grid.ts).
 */
export async function generateScenesFromAudio(
  params: GenerateScenesFromAudioParams,
): Promise<GenerateScenesFromAudioResult> {
  const { audioUrl, durationSec, songStructure } = params;

  const beatGrid = await detectBeatGrid(audioUrl, durationSec);
  const totalDuration = durationSec && durationSec > 0 ? durationSec : (beatGrid?.beats.at(-1) ?? 180);

  const sectionBounds = deriveSectionBounds(songStructure, totalDuration, beatGrid?.beats ?? null);

  const scenes: SceneData[] = [];
  for (const { section, start, end } of sectionBounds) {
    const cuts = splitSectionIntoCuts(start, end, beatGrid);
    const lyricLines = (section.lyrics ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    const sectionPrompt = [section.notes, songStructure.videoPacing].filter(Boolean).join(" — ");

    for (let i = 0; i < cuts.length - 1; i++) {
      const sceneStart = cuts[i]!;
      const sceneEnd = cuts[i + 1]!;
      const lyricLine = lyricLines[i] ?? lyricLines[lyricLines.length - 1] ?? "";

      scenes.push({
        id: `scene-${scenes.length}`,
        sceneNumber: scenes.length + 1,
        timestamp: `${formatTimestamp(sceneStart)}-${formatTimestamp(sceneEnd)}`,
        section: section.name,
        lyricLine,
        aiVideoPrompt: sectionPrompt,
        ...emptySceneDefaults(),
      });
    }
  }

  return { scenes, beatGrid };
}
