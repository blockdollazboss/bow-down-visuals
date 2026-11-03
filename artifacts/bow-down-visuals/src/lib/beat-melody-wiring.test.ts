import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(path.resolve(import.meta.dirname, rel), "utf8");

const aiAudio = read("../pages/ai-audio.tsx");
const roll = read("../components/beat-studio/BeatMelodyRoll.tsx");
const midiSynth = read("./midi-synth.ts");

describe("beat melodic roll wiring (W1-L2)", () => {
  it("the sequencer renders the melodic roll and stores melody per pattern", () => {
    expect(aiAudio).toContain("BeatMelodyRoll");
    expect(aiAudio).toContain("melody: BeatMelodyLanes");
    // all four pattern slots + copy/paste/clear carry the melody lanes
    expect(aiAudio).toContain("melody: cloneBeatMelody(p.melody)");
    expect(aiAudio).toContain("melody: emptyBeatMelody()");
  });

  it("melodic notes sound live AND in the offline WAV render through the shared midi-synth voices", () => {
    expect(aiAudio).toContain("notesStartingAtStep(melodyRef.current[v.id], s, bpmRef.current)");
    expect(aiAudio).toContain("beatLaneToMidi(melodyRef.current[v.id], bpmRef.current, sw)");
    // both call sites schedule via the one exported voice scheduler
    expect(aiAudio.match(/scheduleMidiVoice\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(midiSynth).toContain("export function scheduleMidiVoice(");
    // no duplicated synth recipes on the beat side
    expect(aiAudio).not.toContain("voiceSpec");
    expect(aiAudio).not.toContain("VoiceSpec");
    expect(roll).not.toContain("createOscillator");
  });

  it("the dead bass Pitch dropdown is gone (its state was bound but never read)", () => {
    expect(aiAudio).not.toContain("bassPaint");
    expect(aiAudio).not.toContain("bassPitch");
    // the 808 bass roll itself stays
    expect(aiAudio).toContain("toggleBass");
    expect(aiAudio).toContain("synthBass");
  });

  it("the roll offers at least the Keys and Pluck voices and a velocity control", () => {
    expect(roll).toContain("BEAT_MELODIC_VOICES");
    expect(roll).toContain("beat-melody-velocity");
    expect(roll).toContain("setBeatNoteVelocity");
    expect(roll).toContain("auditionNote");
  });
});
