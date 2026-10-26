/**
 * audio-context-menu.ts — the right-click menu items for the timeline's
 * audio (song) lane in the Studio editor's TimelineDock. Pure builder: it
 * only describes items whose handlers are the dock's REAL setters — the
 * same split / crop / fade / sync / loop / volume functions the transport
 * buttons, waveform drag handles and Sync panel already call. Parity with
 * the clip menu (buildClipCtxItems in TimelineDock): timeline lock
 * disables every mutating item with the lock message as tooltip, and a
 * disabled parent never opens its submenu.
 *
 * Volume and the fades are preset submenus (checked = current value) —
 * the continuous controls stay where they already live (waveform drag
 * handles for the fades; the value itself is the new track-level
 * VideoAudioSync.volume/muted edit-plan fields).
 */
import type { ContextMenuItem } from "../components/editor/ClipContextMenu";
import type { AudioVideoSyncMode } from "./editor-settings";
import { TIMELINE_LOCKED_MESSAGE } from "./timeline-lock";

/** Volume steps offered in the menu (the stored value itself is 0–100). */
export const SONG_VOLUME_STEPS: readonly number[] = [0, 25, 50, 75, 100];

/** Fade presets in seconds (0 = off). Drag handles remain the fine control. */
export const SONG_FADE_PRESETS_SEC: readonly number[] = [0, 0.5, 1, 2, 3, 5];

export interface SongSyncModeOption {
  id: AudioVideoSyncMode;
  label: string;
}

export interface SongAudioMenuState {
  /** Timeline lock — every item disabled with the lock reason. */
  locked: boolean;
  /** The playhead sits over a clip that can split (the transport Split gate). */
  canSplit: boolean;
  /** Song-track volume 0–100 (VideoAudioSync.volume). */
  volume: number;
  /** Song-track mute (VideoAudioSync.muted). */
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  cropEnabled: boolean;
  syncMode: AudioVideoSyncMode;
  loopEnabled: boolean;
  /** A loop region exists (end > start), whether or not playback loops now. */
  loopHasRegion: boolean;
}

export interface SongAudioMenuActions {
  /** The transport Split / S-key handler (splits the clip under the playhead). */
  splitAtPlayhead: () => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  setFadeIn: (sec: number) => void;
  setFadeOut: (sec: number) => void;
  /** The transport "Crop song" toggle. */
  toggleCropSong: () => void;
  setSyncMode: (mode: AudioVideoSyncMode) => void;
  /** The transport loop toggle. */
  toggleLoop: () => void;
  clearLoopRegion: () => void;
}

function fadeLabel(sec: number): string {
  return sec === 0 ? "Off" : `${sec}s`;
}

function fadeChecked(current: number, preset: number): boolean {
  return Math.abs(current - preset) < 0.051;
}

export function buildSongAudioContextItems(
  state: SongAudioMenuState,
  syncModes: readonly SongSyncModeOption[],
  actions: SongAudioMenuActions,
): ContextMenuItem[] {
  /* Timeline lock: every mutating item is disabled with the reason shown;
     a disabled parent also never opens its submenu (same rule as the
     clip menu). The handlers stay gated in the dock as backstop. */
  const lockOff = state.locked
    ? { disabled: true, disabledTitle: TIMELINE_LOCKED_MESSAGE }
    : {};

  return [
    {
      key: "split",
      label: "Split at playhead",
      disabled: state.locked || !state.canSplit,
      disabledTitle: state.locked
        ? TIMELINE_LOCKED_MESSAGE
        : state.canSplit
          ? undefined
          : "Move the playhead over a clip to split it",
      onClick: () => actions.splitAtPlayhead(),
    },
    { key: "div-1", divider: true, label: "" },
    {
      key: "volume",
      label: `Song volume — ${state.volume}%`,
      ...lockOff,
      children: SONG_VOLUME_STEPS.map((v) => ({
        key: `volume-${v}`,
        label: `${v}%`,
        checked: state.volume === v,
        onClick: () => actions.setVolume(v),
      })),
    },
    {
      key: "mute",
      label: state.muted ? "Unmute song" : "Mute song",
      checked: state.muted,
      ...lockOff,
      onClick: () => actions.setMuted(!state.muted),
    },
    {
      key: "fade-in",
      label: "Fade in",
      ...lockOff,
      children: SONG_FADE_PRESETS_SEC.map((sec) => ({
        key: `fade-in-${sec}`,
        label: fadeLabel(sec),
        checked: fadeChecked(state.fadeIn, sec),
        onClick: () => actions.setFadeIn(sec),
      })),
    },
    {
      key: "fade-out",
      label: "Fade out",
      ...lockOff,
      children: SONG_FADE_PRESETS_SEC.map((sec) => ({
        key: `fade-out-${sec}`,
        label: fadeLabel(sec),
        checked: fadeChecked(state.fadeOut, sec),
        onClick: () => actions.setFadeOut(sec),
      })),
    },
    { key: "div-2", divider: true, label: "" },
    {
      key: "crop",
      label: "Crop song",
      checked: state.cropEnabled,
      ...lockOff,
      onClick: () => actions.toggleCropSong(),
    },
    {
      key: "sync-mode",
      label: "Sync mode",
      ...lockOff,
      children: syncModes.map((mode) => ({
        key: `sync-${mode.id}`,
        label: mode.label,
        checked: state.syncMode === mode.id,
        onClick: () => actions.setSyncMode(mode.id),
      })),
    },
    {
      key: "loop",
      label: "Loop region",
      ...lockOff,
      children: [
        {
          key: "loop-toggle",
          label: "Loop playback",
          checked: state.loopEnabled,
          onClick: () => actions.toggleLoop(),
        },
        {
          key: "loop-clear",
          label: "Clear loop region",
          disabled: !state.loopHasRegion,
          disabledTitle: state.loopHasRegion
            ? undefined
            : "Shift+drag on the waveform to set a loop region first",
          onClick: () => actions.clearLoopRegion(),
        },
      ],
    },
  ];
}
