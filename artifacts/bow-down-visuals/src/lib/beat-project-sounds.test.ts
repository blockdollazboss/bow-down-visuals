/* W2-L2 — beat-project track-sound assignment: the additive
 * trackSounds/trackSoundNames fields — defaults for old projects,
 * defensive normalization, round-trip persistence, and the pure
 * setTrackSound op. (L1's own coverage stays in beat-project.test.ts.) */
import { describe, it, expect } from "vitest";
import {
  BEAT_TRACK_COUNT,
  defaultBeatProject,
  defaultTrackSoundNames,
  defaultTrackSounds,
  deserializeBeatProject,
  normalizeBeatProject,
  serializeBeatProject,
  setTrackSound,
} from "@/lib/beat-project";
import { defaultSoundIdForTrack } from "@/lib/beat-sounds";

describe("defaults", () => {
  it("a fresh project assigns every track its built-in synth voice", () => {
    const p = defaultBeatProject();
    expect(p.trackSounds).toHaveLength(BEAT_TRACK_COUNT);
    expect(p.trackSounds).toEqual(defaultTrackSounds());
    expect(p.trackSounds[0]).toBe("synth:kick");
    expect(p.trackSounds[8]).toBe("synth:crash");
    expect(p.trackSoundNames).toEqual(defaultTrackSoundNames());
    expect(p.trackSoundNames.every((n) => n === null)).toBe(true);
  });

  it("an OLD project (no sound fields) normalizes to the synth voices", () => {
    const old = {
      version: 1,
      patterns: {},
      activePattern: "A",
      bpm: 120,
      swing: 0,
      mixer: {},
      arrangement: [],
      mode: "pattern",
    };
    const p = normalizeBeatProject(old)!;
    expect(p.trackSounds).toEqual(
      Array.from({ length: BEAT_TRACK_COUNT }, (_, i) => defaultSoundIdForTrack(i)),
    );
    expect(p.trackSoundNames.every((n) => n === null)).toBe(true);
  });
});

describe("normalization", () => {
  it("keeps valid assignments (incl. future bank ids) and their names", () => {
    const p = normalizeBeatProject({
      trackSounds: ["bank:royal-kick-1", "upload:abc-1"],
      trackSoundNames: ["Royal Kick 1", "My Snare"],
    })!;
    expect(p.trackSounds[0]).toBe("bank:royal-kick-1");
    expect(p.trackSounds[1]).toBe("upload:abc-1");
    expect(p.trackSounds[2]).toBe("synth:clap"); // missing → default
    expect(p.trackSoundNames[0]).toBe("Royal Kick 1");
    expect(p.trackSoundNames[1]).toBe("My Snare");
    expect(p.trackSoundNames[2]).toBeNull();
  });

  it("garbage ids default per track; a synth assignment drops its name", () => {
    const p = normalizeBeatProject({
      trackSounds: ["", 42, null, "synth:chat"],
      trackSoundNames: ["X", "Y", "Z", "Should Drop"],
    })!;
    expect(p.trackSounds[0]).toBe("synth:kick");
    expect(p.trackSounds[1]).toBe("synth:snare");
    expect(p.trackSounds[2]).toBe("synth:clap");
    expect(p.trackSounds[3]).toBe("synth:chat");
    expect(p.trackSoundNames[3]).toBeNull();
    // Names follow their (defaulted) assignment: track 0 defaulted to
    // its synth voice, so its captured name is dropped too.
    expect(p.trackSoundNames[0]).toBeNull();
  });

  it("round-trips assignments through serialize/deserialize", () => {
    let p = defaultBeatProject();
    p = setTrackSound(p, 0, "upload:session-1", "Basement Kick");
    p = setTrackSound(p, 4, "bank:royal-ohat-2", "Royal Open Hat 2");
    const back = deserializeBeatProject(serializeBeatProject(p));
    expect(back.trackSounds[0]).toBe("upload:session-1");
    expect(back.trackSoundNames[0]).toBe("Basement Kick");
    expect(back.trackSounds[4]).toBe("bank:royal-ohat-2");
    expect(back.trackSoundNames[4]).toBe("Royal Open Hat 2");
    expect(back.trackSounds[1]).toBe("synth:snare");
  });
});

describe("setTrackSound", () => {
  it("assigns immutably, captures the name, and clears it on synth reset", () => {
    const p0 = defaultBeatProject();
    const p1 = setTrackSound(p0, 2, "upload:x1", "  Hand Clap Take 2 ");
    expect(p1).not.toBe(p0);
    expect(p0.trackSounds[2]).toBe("synth:clap"); // original untouched
    expect(p1.trackSounds[2]).toBe("upload:x1");
    expect(p1.trackSoundNames[2]).toBe("Hand Clap Take 2");
    const p2 = setTrackSound(p1, 2, "synth:clap");
    expect(p2.trackSounds[2]).toBe("synth:clap");
    expect(p2.trackSoundNames[2]).toBeNull();
  });

  it("out-of-range tracks and garbage ids are safe", () => {
    const p0 = defaultBeatProject();
    expect(setTrackSound(p0, 99, "upload:x")).toBe(p0);
    expect(setTrackSound(p0, -1, "upload:x")).toBe(p0);
    const p1 = setTrackSound(p0, 0, "");
    expect(p1.trackSounds[0]).toBe("synth:kick");
  });
});
