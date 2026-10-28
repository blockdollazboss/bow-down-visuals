import { describe, expect, it, vi } from "vitest";
import {
  PlaybackArbiter,
  MASTER_PLAYBACK_ID,
  MIX_PLAYBACK_ID,
  type PlaybackParticipant,
} from "./playback-arbiter";

/** A fake engine whose play state the test flips directly. */
function fakeParticipant(id: string) {
  const state = { playing: false };
  const participant: PlaybackParticipant = {
    id,
    isPlaying: () => state.playing,
    pause: vi.fn(() => {
      state.playing = false;
    }),
  };
  return { participant, state };
}

describe("PlaybackArbiter — one playback truth", () => {
  it("starting the master pauses the mix (master start wins)", () => {
    const arbiter = new PlaybackArbiter();
    const master = fakeParticipant(MASTER_PLAYBACK_ID);
    const mix = fakeParticipant(MIX_PLAYBACK_ID);
    arbiter.register(master.participant);
    arbiter.register(mix.participant);

    mix.state.playing = true;
    arbiter.notifyPlaying(MASTER_PLAYBACK_ID);

    expect(mix.participant.pause).toHaveBeenCalledTimes(1);
    expect(mix.state.playing).toBe(false);
    expect(master.participant.pause).not.toHaveBeenCalled();
    expect(arbiter.getActiveId()).toBe(MASTER_PLAYBACK_ID);
  });

  it("starting the mix pauses the master (mix start wins)", () => {
    const arbiter = new PlaybackArbiter();
    const master = fakeParticipant(MASTER_PLAYBACK_ID);
    const mix = fakeParticipant(MIX_PLAYBACK_ID);
    arbiter.register(master.participant);
    arbiter.register(mix.participant);

    master.state.playing = true;
    arbiter.notifyPlaying(MIX_PLAYBACK_ID);

    expect(master.participant.pause).toHaveBeenCalledTimes(1);
    expect(master.state.playing).toBe(false);
    expect(mix.participant.pause).not.toHaveBeenCalled();
    expect(arbiter.getActiveId()).toBe(MIX_PLAYBACK_ID);
  });

  it("never pauses the participant that just started", () => {
    const arbiter = new PlaybackArbiter();
    const master = fakeParticipant(MASTER_PLAYBACK_ID);
    arbiter.register(master.participant);

    master.state.playing = true;
    arbiter.notifyPlaying(MASTER_PLAYBACK_ID);

    expect(master.participant.pause).not.toHaveBeenCalled();
  });

  it("does not pause a peer that is not playing", () => {
    const arbiter = new PlaybackArbiter();
    const master = fakeParticipant(MASTER_PLAYBACK_ID);
    const mix = fakeParticipant(MIX_PLAYBACK_ID);
    arbiter.register(master.participant);
    arbiter.register(mix.participant);

    arbiter.notifyPlaying(MASTER_PLAYBACK_ID);

    expect(mix.participant.pause).not.toHaveBeenCalled();
  });

  it("pausing is mutual and repeatable — the second start wins the second time", () => {
    const arbiter = new PlaybackArbiter();
    const master = fakeParticipant(MASTER_PLAYBACK_ID);
    const mix = fakeParticipant(MIX_PLAYBACK_ID);
    arbiter.register(master.participant);
    arbiter.register(mix.participant);

    mix.state.playing = true;
    arbiter.notifyPlaying(MASTER_PLAYBACK_ID);
    expect(mix.state.playing).toBe(false);

    master.state.playing = true;
    arbiter.notifyPlaying(MIX_PLAYBACK_ID);
    expect(master.state.playing).toBe(false);
    expect(arbiter.getActiveId()).toBe(MIX_PLAYBACK_ID);
  });

  it("notifyStopped clears only the matching active source", () => {
    const arbiter = new PlaybackArbiter();
    const master = fakeParticipant(MASTER_PLAYBACK_ID);
    arbiter.register(master.participant);

    arbiter.notifyPlaying(MASTER_PLAYBACK_ID);
    arbiter.notifyStopped(MIX_PLAYBACK_ID);
    expect(arbiter.getActiveId()).toBe(MASTER_PLAYBACK_ID);
    arbiter.notifyStopped(MASTER_PLAYBACK_ID);
    expect(arbiter.getActiveId()).toBeNull();
  });

  it("an unregistered participant is no longer paused", () => {
    const arbiter = new PlaybackArbiter();
    const master = fakeParticipant(MASTER_PLAYBACK_ID);
    const mix = fakeParticipant(MIX_PLAYBACK_ID);
    arbiter.register(master.participant);
    const unregisterMix = arbiter.register(mix.participant);
    unregisterMix();

    mix.state.playing = true;
    arbiter.notifyPlaying(MASTER_PLAYBACK_ID);

    expect(mix.participant.pause).not.toHaveBeenCalled();
  });

  it("a stale unregister cannot evict a newer registration under the same id", () => {
    const arbiter = new PlaybackArbiter();
    const master = fakeParticipant(MASTER_PLAYBACK_ID);
    const mixA = fakeParticipant(MIX_PLAYBACK_ID);
    const mixB = fakeParticipant(MIX_PLAYBACK_ID);
    arbiter.register(master.participant);
    const unregisterA = arbiter.register(mixA.participant);
    arbiter.register(mixB.participant);

    unregisterA(); // stale cleanup from the first mount
    master.state.playing = true;
    mixB.state.playing = true;
    arbiter.notifyPlaying(MASTER_PLAYBACK_ID);

    expect(mixB.participant.pause).toHaveBeenCalledTimes(1);
  });

  it("a peer whose pause notifies back mid-iteration cannot corrupt the sweep", () => {
    const arbiter = new PlaybackArbiter();
    const master = fakeParticipant(MASTER_PLAYBACK_ID);
    const mixState = { playing: true };
    const mix: PlaybackParticipant = {
      id: MIX_PLAYBACK_ID,
      isPlaying: () => mixState.playing,
      pause: () => {
        mixState.playing = false;
        arbiter.notifyStopped(MIX_PLAYBACK_ID); // synchronous notify-back
      },
    };
    arbiter.register(master.participant);
    arbiter.register(mix);

    arbiter.notifyPlaying(MASTER_PLAYBACK_ID);

    expect(mixState.playing).toBe(false);
    expect(arbiter.getActiveId()).toBe(MASTER_PLAYBACK_ID);
  });
});
