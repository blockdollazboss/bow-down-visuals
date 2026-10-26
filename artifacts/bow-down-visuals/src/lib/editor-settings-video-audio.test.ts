import { describe, it, expect } from "vitest";
import {
  defaultMusicStudioSettings,
  normalizeEditorSettings,
  normalizeMusicStudio,
  type MusicStudioSettings,
} from "./editor-settings";

/* The song track's track-level volume/mute (VideoAudioSync.volume/muted) —
   the edit-plan counterparts of the per-clip ClipEdit fields. Defaults are
   full volume / unmuted; stored values are clamped (volume) and strict
   booleans (muted) so a corrupt project file can never load loud or odd. */

function storedMusicStudio(videoAudio: Record<string, unknown>): Partial<MusicStudioSettings> {
  return { videoAudio } as unknown as Partial<MusicStudioSettings>;
}

describe("song-track volume / mute settings", () => {
  it("defaults to full volume, unmuted", () => {
    const va = defaultMusicStudioSettings().videoAudio;
    expect(va.volume).toBe(100);
    expect(va.muted).toBe(false);
    expect(normalizeMusicStudio(null).videoAudio.volume).toBe(100);
    expect(normalizeMusicStudio(null).videoAudio.muted).toBe(false);
    expect(normalizeEditorSettings(null).musicStudio.videoAudio.volume).toBe(100);
  });

  it("keeps a stored in-range volume and a stored mute", () => {
    const va = normalizeMusicStudio(storedMusicStudio({ volume: 40, muted: true })).videoAudio;
    expect(va.volume).toBe(40);
    expect(va.muted).toBe(true);
  });

  it("clamps out-of-range volumes into 0–100", () => {
    expect(normalizeMusicStudio(storedMusicStudio({ volume: 250 })).videoAudio.volume).toBe(100);
    expect(normalizeMusicStudio(storedMusicStudio({ volume: -5 })).videoAudio.volume).toBe(0);
    expect(normalizeMusicStudio(storedMusicStudio({ volume: 0 })).videoAudio.volume).toBe(0);
  });

  it("falls back to 100 for a non-numeric volume and to unmuted for a non-boolean mute", () => {
    const va = normalizeMusicStudio(storedMusicStudio({ volume: "loud", muted: "yes" })).videoAudio;
    expect(va.volume).toBe(100);
    expect(va.muted).toBe(false);
    const nan = normalizeMusicStudio(storedMusicStudio({ volume: Number.NaN })).videoAudio;
    expect(nan.volume).toBe(100);
  });

  it("survives the full settings normalize path", () => {
    const settings = normalizeEditorSettings({
      musicStudio: storedMusicStudio({ volume: 25, muted: true }) as MusicStudioSettings,
    });
    expect(settings.musicStudio.videoAudio.volume).toBe(25);
    expect(settings.musicStudio.videoAudio.muted).toBe(true);
  });
});
