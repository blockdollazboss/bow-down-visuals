/* ─── Editor ⇄ asset library (linkage fix, audit DE-7) ────────────────────
   The editor's Media/Music rails browse the creator's OWN library through
   the unified /api/asset-library client (previously consumed only by
   Thumbnail Studio) instead of making them re-upload files they already
   own. These builders are the pure seam: a library asset becomes either
   a timeline scene (video/image — the same SceneData shape the stock
   import writes) or a soundtrack stem (audio — the same AudioStem shape
   the "Use this sound" handoff inserts, so preview/render resolve it
   identically). No charge anywhere here: the assets are already theirs. */

import type { LibraryAsset } from "./asset-library";
import { defaultStemEffects, type AudioStem } from "./editor-settings";
import type { SceneData } from "./scene-parser";

/** Assets that can sit on the video timeline as a scene. */
export function isTimelineAsset(asset: LibraryAsset): boolean {
  return asset.mediaKind === "video" || asset.mediaKind === "image";
}

/** Assets that can ride the soundtrack (stems resolve as audio too). */
export function isAudioAsset(asset: LibraryAsset): boolean {
  return asset.mediaKind === "audio" || asset.mediaKind === "stems";
}

/** MIME type from an audio URL's extension — the sound handoff's mapping. */
export function audioFileTypeForUrl(url: string): string {
  const ext = url.split(/[?#]/)[0]!.split(".").pop()?.toLowerCase();
  return ext === "wav"
    ? "audio/wav"
    : ext === "m4a"
      ? "audio/mp4"
      : ext === "ogg"
        ? "audio/ogg"
        : ext === "flac"
          ? "audio/flac"
          : "audio/mpeg";
}

/** A library video/image as a timeline scene (stock-import shape). */
export function sceneFromLibraryAsset(asset: LibraryAsset, sceneNumber: number, now = new Date()): SceneData {
  return {
    id: `library-${asset.id}-s${sceneNumber}`,
    sceneNumber,
    timestamp: "",
    section: "My Library",
    lyricLine: "",
    location: "",
    action: asset.label,
    cameraMovement: "",
    lighting: "",
    mood: "",
    aiVideoPrompt: "",
    negativePrompt: "",
    approved: true,
    demoClipUrl: asset.url,
    thumbnailUrl: asset.mediaKind === "image" ? asset.url : null,
    clipId: null,
    runwayJobId: null,
    provider: "library",
    generationStatus: "completed",
    promptUsed: null,
    generatedAt: now.toISOString(),
    clipReusedIntentionally: true,
  };
}

/** A library audio asset as a project soundtrack stem (sound-handoff shape). */
export function stemFromLibraryAsset(asset: LibraryAsset, now = new Date()): AudioStem {
  return {
    id: `library-${asset.id}`,
    name: asset.label,
    type: "Full Song Mix",
    url: asset.url,
    storagePath: "",
    fileType: audioFileTypeForUrl(asset.url),
    fileSize: 0,
    uploadedAt: now.toISOString(),
    muted: false,
    solo: false,
    locked: false,
    volume: 100,
    pan: 0,
    trimStart: 0,
    trimEnd: 0,
    startTime: 0,
    effects: defaultStemEffects(),
    fxChain: [],
  };
}
