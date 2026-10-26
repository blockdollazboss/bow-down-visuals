import { describe, it, expect, vi } from "vitest";
import {
  buildSongAudioContextItems,
  SONG_FADE_PRESETS_SEC,
  SONG_VOLUME_STEPS,
  type SongAudioMenuActions,
  type SongAudioMenuState,
  type SongSyncModeOption,
} from "./audio-context-menu";
import { TIMELINE_LOCKED_MESSAGE } from "./timeline-lock";
import type { ContextMenuItem } from "../components/editor/ClipContextMenu";

const SYNC_MODES: SongSyncModeOption[] = [
  { id: "keep-as-is", label: "Keep As-Is" },
  { id: "trim-audio", label: "Trim Audio to Video" },
  { id: "fade-audio", label: "Fade Audio at Video End" },
];

function state(patch: Partial<SongAudioMenuState> = {}): SongAudioMenuState {
  return {
    locked: false,
    canSplit: true,
    volume: 100,
    muted: false,
    fadeIn: 2,
    fadeOut: 0,
    cropEnabled: false,
    syncMode: "keep-as-is",
    loopEnabled: false,
    loopHasRegion: false,
    ...patch,
  };
}

type ActionMocks = { [K in keyof SongAudioMenuActions]: ReturnType<typeof vi.fn> };

function actions(): SongAudioMenuActions & ActionMocks {
  return {
    splitAtPlayhead: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    setFadeIn: vi.fn(),
    setFadeOut: vi.fn(),
    toggleCropSong: vi.fn(),
    setSyncMode: vi.fn(),
    toggleLoop: vi.fn(),
    clearLoopRegion: vi.fn(),
  };
}

function item(items: ContextMenuItem[], key: string): ContextMenuItem {
  const found = items.find((i) => i.key === key);
  if (!found) throw new Error(`missing item ${key}`);
  return found;
}

function child(parent: ContextMenuItem, key: string): ContextMenuItem {
  const found = (parent.children ?? []).find((i) => i.key === key);
  if (!found) throw new Error(`missing child ${key}`);
  return found;
}

describe("song (timeline audio lane) context menu", () => {
  it("split calls the transport split handler, gated on the playhead like the button", () => {
    const a = actions();
    const items = buildSongAudioContextItems(state(), SYNC_MODES, a);
    expect(item(items, "split").disabled).toBeFalsy();
    item(items, "split").onClick?.();
    expect(a.splitAtPlayhead).toHaveBeenCalledTimes(1);

    const noSplit = buildSongAudioContextItems(state({ canSplit: false }), SYNC_MODES, a);
    expect(item(noSplit, "split").disabled).toBe(true);
    expect(item(noSplit, "split").disabledTitle).toMatch(/playhead/i);
  });

  it("volume submenu offers the steps, checks the current value, and sets through the action", () => {
    const a = actions();
    const items = buildSongAudioContextItems(state({ volume: 50 }), SYNC_MODES, a);
    const volume = item(items, "volume");
    expect(volume.label).toBe("Song volume — 50%");
    expect((volume.children ?? []).map((c) => c.key)).toEqual(SONG_VOLUME_STEPS.map((v) => `volume-${v}`));
    expect(child(volume, "volume-50").checked).toBe(true);
    expect(child(volume, "volume-100").checked).toBe(false);
    child(volume, "volume-25").onClick?.();
    expect(a.setVolume).toHaveBeenCalledWith(25);
  });

  it("mute toggles through setMuted and reflects state", () => {
    const a = actions();
    const items = buildSongAudioContextItems(state({ muted: true }), SYNC_MODES, a);
    expect(item(items, "mute").label).toBe("Unmute song");
    expect(item(items, "mute").checked).toBe(true);
    item(items, "mute").onClick?.();
    expect(a.setMuted).toHaveBeenCalledWith(false);
  });

  it("fade submenus offer the presets, check the current durations, and set through the actions", () => {
    const a = actions();
    const items = buildSongAudioContextItems(state({ fadeIn: 2, fadeOut: 0 }), SYNC_MODES, a);
    const fadeIn = item(items, "fade-in");
    const fadeOut = item(items, "fade-out");
    expect((fadeIn.children ?? []).length).toBe(SONG_FADE_PRESETS_SEC.length);
    expect(child(fadeIn, "fade-in-2").checked).toBe(true);
    expect(child(fadeOut, "fade-out-0").label).toBe("Off");
    expect(child(fadeOut, "fade-out-0").checked).toBe(true);
    child(fadeIn, "fade-in-0.5").onClick?.();
    expect(a.setFadeIn).toHaveBeenCalledWith(0.5);
    child(fadeOut, "fade-out-5").onClick?.();
    expect(a.setFadeOut).toHaveBeenCalledWith(5);
  });

  it("crop toggles through the transport crop action and reflects state", () => {
    const a = actions();
    const items = buildSongAudioContextItems(state({ cropEnabled: true }), SYNC_MODES, a);
    expect(item(items, "crop").checked).toBe(true);
    item(items, "crop").onClick?.();
    expect(a.toggleCropSong).toHaveBeenCalledTimes(1);
  });

  it("sync submenu is built from the dock's own mode list and checks the active mode", () => {
    const a = actions();
    const items = buildSongAudioContextItems(state({ syncMode: "trim-audio" }), SYNC_MODES, a);
    const sync = item(items, "sync-mode");
    expect((sync.children ?? []).map((c) => c.label)).toEqual(SYNC_MODES.map((m) => m.label));
    expect(child(sync, "sync-trim-audio").checked).toBe(true);
    child(sync, "sync-fade-audio").onClick?.();
    expect(a.setSyncMode).toHaveBeenCalledWith("fade-audio");
  });

  it("loop submenu toggles playback and clears the region only when one exists", () => {
    const a = actions();
    const noRegion = buildSongAudioContextItems(state(), SYNC_MODES, a);
    const loopNoRegion = item(noRegion, "loop");
    expect(child(loopNoRegion, "loop-toggle").checked).toBe(false);
    expect(child(loopNoRegion, "loop-clear").disabled).toBe(true);
    expect(child(loopNoRegion, "loop-clear").disabledTitle).toMatch(/Shift\+drag/i);

    const withRegion = buildSongAudioContextItems(state({ loopEnabled: true, loopHasRegion: true }), SYNC_MODES, a);
    const loop = item(withRegion, "loop");
    expect(child(loop, "loop-toggle").checked).toBe(true);
    child(loop, "loop-toggle").onClick?.();
    expect(a.toggleLoop).toHaveBeenCalledTimes(1);
    expect(child(loop, "loop-clear").disabled).toBeFalsy();
    child(loop, "loop-clear").onClick?.();
    expect(a.clearLoopRegion).toHaveBeenCalledTimes(1);
  });

  it("a locked timeline disables every item with the lock message", () => {
    const a = actions();
    const items = buildSongAudioContextItems(state({ locked: true, loopHasRegion: true }), SYNC_MODES, a);
    for (const it of items) {
      if (it.divider) continue;
      expect(it.disabled, `item ${it.key} should be disabled`).toBe(true);
      expect(it.disabledTitle).toBe(TIMELINE_LOCKED_MESSAGE);
    }
  });
});
