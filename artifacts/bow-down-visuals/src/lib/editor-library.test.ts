import { describe, expect, it } from "vitest";
import type { LibraryAsset } from "./asset-library";
import {
  audioFileTypeForUrl,
  isAudioAsset,
  isTimelineAsset,
  sceneFromLibraryAsset,
  stemFromLibraryAsset,
} from "./editor-library";

const videoAsset: LibraryAsset = {
  id: "gen-1",
  mediaKind: "video",
  hubKind: "clip",
  label: "Rooftop performance",
  url: "https://cdn.example/clips/rooftop.mp4",
  origin: "generation",
  detail: null,
  createdAt: "2026-10-17T00:00:00.000Z",
};

const imageAsset: LibraryAsset = { ...videoAsset, id: "gen-2", mediaKind: "image", hubKind: "image", url: "https://cdn.example/img/cover.png" };
const audioAsset: LibraryAsset = { ...videoAsset, id: "gen-3", mediaKind: "audio", hubKind: "song", url: "https://cdn.example/songs/track.wav" };
const now = new Date("2026-10-17T12:00:00.000Z");

describe("editor library asset routing", () => {
  it("video and image assets go to the timeline; audio and stems to the soundtrack", () => {
    expect(isTimelineAsset(videoAsset)).toBe(true);
    expect(isTimelineAsset(imageAsset)).toBe(true);
    expect(isTimelineAsset(audioAsset)).toBe(false);
    expect(isAudioAsset(audioAsset)).toBe(true);
    expect(isAudioAsset({ ...audioAsset, mediaKind: "stems" })).toBe(true);
    expect(isAudioAsset(videoAsset)).toBe(false);
    expect(isTimelineAsset({ ...videoAsset, mediaKind: "script" })).toBe(false);
  });
});

describe("sceneFromLibraryAsset", () => {
  it("builds a completed scene carrying the asset's own URL and label", () => {
    const scene = sceneFromLibraryAsset(videoAsset, 3, now);
    expect(scene).toMatchObject({
      id: "library-gen-1-s3",
      sceneNumber: 3,
      action: "Rooftop performance",
      demoClipUrl: "https://cdn.example/clips/rooftop.mp4",
      thumbnailUrl: null,
      provider: "library",
      generationStatus: "completed",
      approved: true,
      generatedAt: "2026-10-17T12:00:00.000Z",
    });
  });

  it("an image asset thumbnails itself", () => {
    expect(sceneFromLibraryAsset(imageAsset, 1, now).thumbnailUrl).toBe(imageAsset.url);
  });
});

describe("stemFromLibraryAsset", () => {
  it("builds a soundtrack stem the preview/render path resolves like a handoff sound", () => {
    const stem = stemFromLibraryAsset(audioAsset, now);
    expect(stem).toMatchObject({
      id: "library-gen-3",
      name: "Rooftop performance",
      type: "Full Song Mix",
      url: "https://cdn.example/songs/track.wav",
      fileType: "audio/wav",
      volume: 100,
      muted: false,
      startTime: 0,
    });
    expect(stem.effects).toBeDefined();
  });
});

describe("audioFileTypeForUrl", () => {
  it("maps extensions the way the sound handoff does", () => {
    expect(audioFileTypeForUrl("https://x/a.wav")).toBe("audio/wav");
    expect(audioFileTypeForUrl("https://x/a.m4a?sig=1")).toBe("audio/mp4");
    expect(audioFileTypeForUrl("https://x/a.ogg")).toBe("audio/ogg");
    expect(audioFileTypeForUrl("https://x/a.flac")).toBe("audio/flac");
    expect(audioFileTypeForUrl("https://x/a.mp3")).toBe("audio/mpeg");
    expect(audioFileTypeForUrl("https://x/noext")).toBe("audio/mpeg");
  });
});
