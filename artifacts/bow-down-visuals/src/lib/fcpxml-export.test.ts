/**
 * fcpxml-export.test.ts — Pro Finishing Door: the FCPXML timeline export
 * carries the editor model's clips, order, trims, and timing honestly.
 *
 * Fixture timeline:
 *   clip A "Intro"      0s–5s,  no trims, normal speed
 *   clip B "Verse & Hook" 5s–15s, trimStart 1.5 / trimEnd 0.5, flat 2x speed
 *   (2s gap)
 *   clip C "Outro"      17s–22s, speed ramps (carried flat, with a comment)
 *   + the song on lane -1
 */
import { describe, it, expect } from "vitest";
import { buildFcpxml, fcpxmlTime, fcpxmlFileName, type FcpxmlTimelineInput } from "./fcpxml-export";

const fixture: FcpxmlTimelineInput = {
  projectName: "Test Project",
  fps: 30,
  width: 1080,
  height: 1920,
  clips: [
    {
      name: "Intro",
      src: "https://cdn.example.com/clips/intro.mp4",
      startSec: 0,
      durationSec: 5,
      sourceStartSec: 0,
      sourceDurationSec: 5,
      speed: 1,
      hasSpeedRamp: false,
    },
    {
      name: "Verse & Hook",
      src: "https://cdn.example.com/clips/verse.mp4",
      startSec: 5,
      durationSec: 10,
      sourceStartSec: 1.5,
      sourceDurationSec: 12,
      speed: 2,
      hasSpeedRamp: false,
    },
    {
      name: "Outro",
      src: "https://cdn.example.com/clips/outro.mp4",
      startSec: 17,
      durationSec: 5,
      sourceStartSec: 0,
      sourceDurationSec: 5,
      speed: 1,
      hasSpeedRamp: true,
    },
  ],
  audio: {
    name: "Song",
    src: "https://cdn.example.com/audio/song.mp3",
    durationSec: 22,
  },
};

describe("fcpxmlTime", () => {
  it("renders frame-aligned rational seconds", () => {
    expect(fcpxmlTime(0, 30)).toBe("0s");
    expect(fcpxmlTime(4, 30)).toBe("4s");
    expect(fcpxmlTime(2.5, 30)).toBe("5/2s");
    expect(fcpxmlTime(1.5, 30)).toBe("3/2s");
    expect(fcpxmlTime(1 / 30, 30)).toBe("1/30s");
  });
});

describe("fcpxmlFileName", () => {
  it("slugs the project name", () => {
    expect(fcpxmlFileName("My Great Video!")).toBe("my-great-video.fcpxml");
    expect(fcpxmlFileName("")).toBe("bow-down-visuals-timeline.fcpxml");
  });
});

describe("buildFcpxml", () => {
  const xml = buildFcpxml(fixture);

  it("is a well-formed FCPXML 1.10 document shell", () => {
    expect(xml.startsWith(`<?xml version="1.0" encoding="UTF-8"?>`)).toBe(true);
    expect(xml).toContain(`<fcpxml version="1.10">`);
    expect(xml.trimEnd().endsWith(`</fcpxml>`)).toBe(true);
    // Every opened structural tag is closed.
    for (const tag of ["resources", "library", "event", "project", "sequence", "spine"]) {
      expect(xml).toContain(`<${tag}`);
      expect(xml).toContain(`</${tag}>`);
    }
    expect(xml).toContain(`frameDuration="1/30s" width="1080" height="1920"`);
    // Sequence duration covers the last clip's end (17 + 5).
    expect(xml).toContain(`<sequence format="r1" duration="22s"`);
  });

  it("declares one asset per clip plus the song, with honest durations", () => {
    expect(xml).toContain(`src="https://cdn.example.com/clips/intro.mp4" start="0s" duration="5s" hasVideo="1"`);
    // Clip B's asset must cover the retimed consumption: start 1.5 + 10s at
    // 2x = 21.5s of source — more than its modeled span (12s), so the asset
    // duration grows to the consumed end.
    expect(xml).toContain(`src="https://cdn.example.com/clips/verse.mp4" start="0s" duration="43/2s" hasVideo="1"`);
    expect(xml).toContain(`src="https://cdn.example.com/audio/song.mp3" start="0s" duration="22s" hasVideo="0" hasAudio="1"`);
  });

  it("places clips in order with their trims as start points", () => {
    const introAt = xml.indexOf(`name="Intro" ref=`);
    const verseAt = xml.indexOf(`name="Verse &amp; Hook" ref=`);
    const outroAt = xml.indexOf(`name="Outro" ref=`);
    expect(introAt).toBeGreaterThan(-1);
    expect(verseAt).toBeGreaterThan(introAt);
    expect(outroAt).toBeGreaterThan(verseAt);
    expect(xml).toContain(`offset="0s" start="0s" duration="5s"`);
    // Clip B: offset 5s on the timeline, in-point at its 1.5s trim.
    expect(xml).toContain(`offset="5s" start="3/2s" duration="10s"`);
    expect(xml).toContain(`offset="17s" start="0s" duration="5s"`);
  });

  it("keeps the manual-layout gap as a real gap element", () => {
    expect(xml).toContain(`<gap name="Gap" offset="15s" start="0s" duration="2s"/>`);
  });

  it("retimes flat speed with a timeMap, and flags ramps honestly", () => {
    expect(xml).toContain(`<timeMap>`);
    // 2x: at timeline 10s the source playhead reaches 1.5 + 20 = 21.5s.
    expect(xml).toContain(`<timept time="0s" value="3/2s" interp="smooth"/>`);
    expect(xml).toContain(`<timept time="10s" value="43/2s" interp="smooth"/>`);
    // The ramped clip is carried flat and the file itself says so.
    expect(xml).toContain(`uses speed ramps in Bow Down Visuals; FCPXML carries it at flat timing`);
  });

  it("connects the song on lane -1 for the sequence duration", () => {
    expect(xml).toContain(`lane="-1" offset="0s" start="0s" duration="22s"`);
  });

  it("escapes XML in names and carries no invented metadata", () => {
    expect(xml).toContain(`name="Verse &amp; Hook"`);
    expect(xml).not.toContain(`"Verse & Hook"`);
    // No placeholder dimensions, no fake timecode sources.
    expect(xml).toContain(`tcStart="0s"`);
    expect(xml).not.toContain("undefined");
    expect(xml).not.toContain("NaN");
  });

  it("omits the audio lane cleanly when there is no song", () => {
    const silent = buildFcpxml({ ...fixture, audio: null });
    expect(silent).not.toContain(`lane="-1"`);
    expect(silent).not.toContain("song.mp3");
    expect(silent).toContain(`<sequence format="r1" duration="22s"`);
  });
});
