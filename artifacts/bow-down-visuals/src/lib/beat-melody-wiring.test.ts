import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(path.resolve(import.meta.dirname, rel), "utf8");

const aiAudio = read("../pages/ai-audio.tsx");
const roll = read("../components/beat-studio/BeatMelodyRoll.tsx");
const midiSynth = read("./midi-synth.ts");
const beatProject = read("./beat-project.ts");

describe("beat melodic roll wiring (W1-L2)", () => {
  it("the sequencer renders the melodic roll and stores melody per pattern", () => {
    expect(aiAudio).toContain("BeatMelodyRoll");
    expect(aiAudio).toContain("melody={patterns[activePat]!.melody}");
    /* Composed at the beat join: melody lives in the ONE project shape —
     * BeatPatternData in lib/beat-project carries the lanes, and the
     * lib's clone/normalize carry them through copy/paste/clear/load. */
    expect(beatProject).toContain("melody: BeatMelodyLanes");
    expect(beatProject).toContain("melody: cloneBeatMelody(p.melody)");
    expect(beatProject).toContain("melody: normalizeBeatMelody(r.melody)");
    // the trap preset's seeded melody reaches pattern A + preset loads
    // (Stack 100 A11: the presets live in lib/beat-presets.ts now; the page
    // consumes the registry's BEAT_PRESETS — same data, same call shape.)
    expect(aiAudio).toContain("melody: cloneBeatMelody(BEAT_PRESETS.trap.melody ?? emptyBeatMelody())");
    expect(aiAudio).toContain("melody: cloneBeatMelody(p.melody ?? emptyBeatMelody())");
  });

  it("melodic notes sound live AND in the offline WAV render through the shared midi-synth voices", () => {
    /* Composed call sites: live reads the playing pattern's lanes at the
     * bar-relative step; the render walks each play's lanes per bar. */
    expect(aiAudio).toContain("notesStartingAtStep(pat.melody[v.id], s % BEAT_STEPS, bpmRef.current)");
    /* stack1500: BOTH paths convert through the one feel-aware
     * converter (humanizedBeatNoteMidi, lib/beat-feel) — at feel 0 it
     * is exactly beatLaneToMidi's output, so this stays the single
     * conversion truth the render/playback agreement rests on. */
    expect(aiAudio).toContain("humanizedBeatNoteMidi(note, bpmRef.current, swingRef.current, feelRef.current, patId, v.id)");
    expect(aiAudio).toContain("humanizedBeatNoteMidi(note, bpmRef.current, sw, feelRef.current, pid, v.id)");
    // both call sites schedule via the one exported voice scheduler
    expect(aiAudio.match(/scheduleMidiVoice\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(midiSynth).toContain("export function scheduleMidiVoice(");
    // melody gains route into the mixer graph's master input
    expect(aiAudio).toContain("gn.connect(graph.master.input)");
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
