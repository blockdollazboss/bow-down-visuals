import { describe, it, expect } from "vitest";
import { resolveVideoAudio, resolveVideoAudioUrl } from "./resolve-video-audio-url";
import type { MusicStudioSettings, AudioExportRecord } from "@/lib/editor-settings";

type MS = Pick<MusicStudioSettings, "videoAudio" | "exports" | "stems">;

function baseVideoAudio(source: MS["videoAudio"]["source"]): MS["videoAudio"] {
  return {
    source,
    startSec: 0,
    fadeIn: 0,
    fadeOut: 0,
    loopAudio: false,
    matchVideoLength: true,
    syncMode: "keep-as-is",
  };
}

function exportRecord(kind: AudioExportRecord["kind"], url: string, format: AudioExportRecord["format"] = "mp3"): AudioExportRecord {
  return {
    id: `${kind}-${format}`,
    label: kind,
    kind,
    url,
    format,
    stemsUsed: [],
    mixSettings: { masterVolume: 100, stems: [] },
    createdAt: new Date().toISOString(),
  };
}

const PROJECT_AUDIO = "https://cdn.example.com/uploaded-song.mp3";
const STEM_AUDIO = "https://cdn.example.com/stem-fallback.mp3";
const FULL_MIX_MP3 = "https://cdn.example.com/full-mix.mp3";
const FULL_MIX_WAV = "https://cdn.example.com/full-mix.wav";
const INSTRUMENTAL = "https://cdn.example.com/instrumental.mp3";
const ACAPELLA = "https://cdn.example.com/acapella.mp3";

describe("resolveVideoAudioUrl", () => {
  it("uses the rendered full-mix export when the studio mix is selected and available", () => {
    const ms: MS = {
      videoAudio: baseVideoAudio("full-mix"),
      exports: [exportRecord("full", FULL_MIX_MP3)],
      stems: [],
    };
    expect(resolveVideoAudioUrl(ms, PROJECT_AUDIO)).toBe(FULL_MIX_MP3);
  });

  it("prefers the mp3 full-mix export over a wav full-mix export", () => {
    const ms: MS = {
      videoAudio: baseVideoAudio("full-mix"),
      exports: [exportRecord("full", FULL_MIX_WAV, "wav"), exportRecord("full", FULL_MIX_MP3, "mp3")],
      stems: [],
    };
    expect(resolveVideoAudioUrl(ms, PROJECT_AUDIO)).toBe(FULL_MIX_MP3);
  });

  it("falls back to the uploaded song when full-mix is selected but never rendered", () => {
    const ms: MS = {
      videoAudio: baseVideoAudio("full-mix"),
      exports: [],
      stems: [],
    };
    expect(resolveVideoAudioUrl(ms, PROJECT_AUDIO)).toBe(PROJECT_AUDIO);
  });

  it("reports the fallback when a selected rendered mix is missing", () => {
    const ms: MS = {
      videoAudio: baseVideoAudio("instrumental"),
      exports: [exportRecord("acapella", ACAPELLA)],
      stems: [],
    };
    expect(resolveVideoAudio(ms, PROJECT_AUDIO)).toMatchObject({
      url: PROJECT_AUDIO,
      requestedSource: "instrumental",
      missingExport: true,
      fallbackSource: "project-audio",
    });
  });

  it("does not treat an empty export record as a rendered mix", () => {
    const ms: MS = {
      videoAudio: baseVideoAudio("full-mix"),
      exports: [exportRecord("full", "")],
      stems: [],
    };
    expect(resolveVideoAudio(ms, PROJECT_AUDIO).missingExport).toBe(true);
    expect(resolveVideoAudioUrl(ms, PROJECT_AUDIO)).toBe(PROJECT_AUDIO);
  });

  it("falls back to the first stem when full-mix is selected, unrendered, and there is no project audio", () => {
    const ms: MS = {
      videoAudio: baseVideoAudio("full-mix"),
      exports: [],
      stems: [{ id: "s1", name: "Stem 1", url: STEM_AUDIO } as MS["stems"][number]],
    };
    expect(resolveVideoAudioUrl(ms, null)).toBe(STEM_AUDIO);
  });

  it("resolves the instrumental export when selected and available", () => {
    const ms: MS = {
      videoAudio: baseVideoAudio("instrumental"),
      exports: [exportRecord("instrumental", INSTRUMENTAL)],
      stems: [],
    };
    expect(resolveVideoAudioUrl(ms, PROJECT_AUDIO)).toBe(INSTRUMENTAL);
  });

  it("falls back to the uploaded song when instrumental is selected but never rendered", () => {
    const ms: MS = {
      videoAudio: baseVideoAudio("instrumental"),
      exports: [exportRecord("acapella", ACAPELLA)],
      stems: [],
    };
    expect(resolveVideoAudioUrl(ms, PROJECT_AUDIO)).toBe(PROJECT_AUDIO);
  });

  it("resolves the acapella export when selected and available", () => {
    const ms: MS = {
      videoAudio: baseVideoAudio("acapella"),
      exports: [exportRecord("acapella", ACAPELLA)],
      stems: [],
    };
    expect(resolveVideoAudioUrl(ms, PROJECT_AUDIO)).toBe(ACAPELLA);
  });

  it("uses the uploaded song directly when source is 'uploaded'", () => {
    const ms: MS = {
      videoAudio: baseVideoAudio("uploaded"),
      exports: [exportRecord("full", FULL_MIX_MP3)],
      stems: [],
    };
    expect(resolveVideoAudioUrl(ms, PROJECT_AUDIO)).toBe(PROJECT_AUDIO);
  });

  it("returns null when source is 'none' and there is no project audio or stem", () => {
    const ms: MS = {
      videoAudio: baseVideoAudio("none"),
      exports: [exportRecord("full", FULL_MIX_MP3)],
      stems: [],
    };
    expect(resolveVideoAudioUrl(ms, null)).toBeNull();
  });
});
