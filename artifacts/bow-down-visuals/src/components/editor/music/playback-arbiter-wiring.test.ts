/**
 * Editor playback arbiter — wiring pins.
 *
 * The arbiter's behavior is unit-tested in lib/playback-arbiter.test.ts;
 * these pins lock the WIRING that behavior depends on: the editor page
 * owns the single instance and registers the master, useMixPreview
 * registers the mix engine, TimelinePreviewPlayer exposes a real pause()
 * on its handle, and the Music Studio header transports the master
 * (via selectHeaderTransport) instead of running a second clock.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const page = read("../../../pages/video-editor.tsx");
const timelinePlayer = read("../../TimelinePreviewPlayer.tsx");
const useMixPreviewSrc = read("./useMixPreview.ts");
const musicStudio = read("./MusicStudio.tsx");

describe("editor owns one arbiter and registers the master player", () => {
  it("creates a single PlaybackArbiter and provides it at the page root", () => {
    expect(page).toContain("useState(() => new PlaybackArbiter())");
    expect(page).toContain("<PlaybackArbiterContext.Provider value={playbackArbiter}>");
  });

  it("registers the master participant, pausing through the timeline handle", () => {
    expect(page).toContain("playbackArbiter.register({");
    expect(page).toContain("id: MASTER_PLAYBACK_ID");
    expect(page).toContain("pause: () => timelinePlayerRef.current?.pause()");
    expect(page).toContain("isPlaying: () => previewStateRef.current?.isPlaying ?? false");
  });

  it("notifies the arbiter whenever the master play state flips", () => {
    expect(page).toContain("playbackArbiter.notifyPlaying(MASTER_PLAYBACK_ID)");
    expect(page).toContain("playbackArbiter.notifyStopped(MASTER_PLAYBACK_ID)");
  });

  it("hands MusicStudio the master mirror only when the timeline has audio", () => {
    expect(page).toContain("masterPlayer={previewAudioUrl ? {");
    expect(page).toContain("state: previewEngineState");
    expect(page).toContain("onTogglePlay: () => timelinePlayerRef.current?.togglePlay()");
  });
});

describe("TimelinePlayerHandle exposes a guarded pause()", () => {
  it("declares pause() on the handle interface", () => {
    expect(timelinePlayer).toContain("pause: () => void;");
  });

  it("implements pause() through pauseTimeline, guarded by playingRef", () => {
    expect(timelinePlayer).toContain("if (playingRef.current) pauseTimeline();");
  });
});

describe("useMixPreview registers the mix engine with the arbiter", () => {
  it("consumes the arbiter from context (null-safe outside the editor)", () => {
    expect(useMixPreviewSrc).toContain("const arbiter = usePlaybackArbiter();");
    expect(useMixPreviewSrc).toContain("if (!arbiter) return;");
  });

  it("registers the mix participant with a live snapshot read + engine pause", () => {
    expect(useMixPreviewSrc).toContain("arbiter.register({");
    expect(useMixPreviewSrc).toContain("id: MIX_PLAYBACK_ID");
    expect(useMixPreviewSrc).toContain('snapRef.current.playState === "playing"');
    expect(useMixPreviewSrc).toContain("pause: () => engineRef.current?.pause()");
  });

  it("notifies the arbiter when the mix starts and stops", () => {
    expect(useMixPreviewSrc).toContain("arbiter.notifyPlaying(MIX_PLAYBACK_ID)");
    expect(useMixPreviewSrc).toContain("arbiter.notifyStopped(MIX_PLAYBACK_ID)");
  });
});

describe("Music Studio header transports the master for the project song", () => {
  it("selects its transport through selectHeaderTransport", () => {
    expect(musicStudio).toContain("selectHeaderTransport({");
    expect(musicStudio).toContain("anySolo");
    expect(musicStudio).toContain("const mirrorMaster = header.source === \"master\";");
  });

  it("the header button toggles the master via the handle when mirroring", () => {
    expect(musicStudio).toContain("if (mirrorMaster && masterPlayer) masterPlayer.onTogglePlay();");
    expect(musicStudio).toContain('data-testid="musicstudio-play"');
  });

  it("the header clock renders the selected transport, never the raw mix clock", () => {
    expect(musicStudio).toContain("{formatTime(headerPosition)}");
    expect(musicStudio).toContain("{formatTime(headerDuration || durationSec)}");
    expect(musicStudio).not.toContain("{formatTime(preview.position)}");
  });
});
