/* W3c — Beat Studio WebMIDI record wiring: the sequencer page must
 * actually mount the panel, run the house WebMIDI session, monitor
 * through the transport's own seams, and write recorded notes into
 * the patterns state — never a side channel. Source-level assertions,
 * same style as the other beat wiring suites. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(path.resolve(import.meta.dirname, rel), "utf8");

const aiAudio = read("../components/audio-studio/AiAudio.tsx");
const panel = read("../components/beat-studio/BeatMidiPanel.tsx");
const beatMidi = read("./beat-midi.ts");
const webMidi = read("./web-midi.ts");

describe("beat MIDI record wiring (W3c)", () => {
  it("the sequencer mounts the MIDI panel behind its toggle", () => {
    expect(aiAudio).toContain("BeatMidiPanel");
    expect(aiAudio).toContain('data-testid="beat-midi-toggle"');
    expect(aiAudio).toContain("supported={webMidiSupported()}");
    expect(aiAudio).toContain("onConnect={connectMidi}");
    expect(aiAudio).toContain("onToggleArm={toggleMidiArm}");
    expect(panel).toContain('data-testid="beat-midi-panel"');
    expect(panel).toContain('data-testid="beat-midi-connect"');
    expect(panel).toContain('data-testid="beat-midi-arm"');
  });

  it("the page runs the house WebMIDI session and reports honest states", () => {
    expect(aiAudio).toContain("openWebMidi(handleMidiEvent)");
    expect(aiAudio).toContain('setMidiStatus("blocked")');
    expect(aiAudio).toContain("setMidiInputs(session.inputs)");
    // the panel names absence plainly instead of faking a device list
    expect(panel).toContain('data-testid="beat-midi-unsupported"');
    expect(panel).toContain('data-testid="beat-midi-no-devices"');
    // the session releases with the component
    expect(aiAudio).toContain("midiSessionRef.current?.close()");
  });

  it("monitoring rides the transport's own seams — no second sound path", () => {
    const monitor = aiAudio.slice(
      aiAudio.indexOf("const monitorMidiTarget"),
      aiAudio.indexOf("const midiTargetLabel"),
    );
    expect(monitor).toContain("playTrackHit(");
    expect(monitor).toContain("synthBass(");
    expect(monitor).toContain("scheduleMidiVoice(");
    expect(monitor).toContain("graph.tracks[tr.id]");
    expect(monitor).toContain('graph.tracks["bass"]');
    expect(monitor).toContain("getMelodyGains(ctx)");
    // beat-midi itself synthesizes nothing and calls no network
    expect(beatMidi).not.toContain("createOscillator");
    expect(beatMidi).not.toContain("fetch(");
  });

  it("recorded notes are written into the patterns state via the lib's pure ops", () => {
    expect(aiAudio).toContain("recorded.apply(prev[recorded.patternId]!)");
    expect(aiAudio).toContain("applyRecordedMelodyNote(prev[done.patternId]!, done.voice, done.note)");
    // only while armed AND the transport is running
    expect(aiAudio).toContain("position: midiArmedRef.current ? midiEventPosition(e) : null");
    expect(aiAudio).toContain("if (!ctx || !playingRef.current) return null");
    // held melody notes flush before the transport stops
    const stop = aiAudio.slice(aiAudio.indexOf("const stop = useCallback"), aiAudio.indexOf("const stop = useCallback") + 400);
    expect(stop).toContain("flushMidiTake()");
  });

  it("the event channel rides the shared WebMIDI session (additive)", () => {
    expect(webMidi).toContain("channel?: number");
    expect(webMidi).toContain("const channel = data[0]! & 0x0f");
    expect(beatMidi).toContain("BEAT_MIDI_DRUM_CHANNEL = 9");
  });

  it("recording is a free manual tool — no charge rail anywhere near it", () => {
    expect(beatMidi).not.toContain("CREDIT_COSTS");
    expect(panel).not.toContain("CREDIT_COSTS");
    const midiBlock = aiAudio.slice(
      aiAudio.indexOf("const midiPositionNow"),
      aiAudio.indexOf("const start = useCallback"),
    );
    expect(midiBlock).not.toContain("CREDIT_COSTS");
    expect(midiBlock).not.toContain("fetch(");
  });
});
