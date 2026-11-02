/**
 * trend-preload-landing.test.ts — stack1300 lane (UPGRADE #178 remainder).
 *
 * The Trend Radar's one-tap preloads promised a head start and landed on
 * a surface that didn't consume them:
 *  - SOUND rows link to /create?panel=video&sound=track:<id>, but the
 *    video panel's only ?sound= intake was the viral finder's plain-title
 *    protocol — the literal string "track:<id>" landed in the Song title
 *    field and no sound was attached anywhere.
 *  - FORMAT rows link to /create?panel=video&concept=…, but the video
 *    panel never read ?concept= at all (the song panel has read it all
 *    along for the TOPIC rows, which land correctly).
 *
 * The fix teaches the video panel both intakes: track: resolves through
 * the shared streaming rail and attaches as the project's song (the
 * audioUrl state an upload fills); concept scaffolds the special
 * instructions the plan generator reads. These pins are the contract.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMakeVideoSoundParam } from "./make-video-deep-link";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const makeVideoSource = read("../pages/make-video.tsx");
const makeSongSource = read("../pages/make-song.tsx");

describe("#178 sound preload — the ?sound= value is interpreted, never stuffed raw into the title", () => {
  it("a track: value parses as a track attach, with its id intact", () => {
    expect(parseMakeVideoSoundParam("track:9f2c1e4a-77")).toEqual({ kind: "track", id: "9f2c1e4a-77" });
  });

  it("a plain finder title still parses as a title prefill", () => {
    expect(parseMakeVideoSoundParam("Midnight Run — TRGDY")).toEqual({
      kind: "title",
      title: "Midnight Run — TRGDY",
    });
  });

  it("empty / missing values parse to nothing", () => {
    expect(parseMakeVideoSoundParam(null)).toBeNull();
    expect(parseMakeVideoSoundParam("")).toBeNull();
    expect(parseMakeVideoSoundParam("   ")).toBeNull();
    expect(parseMakeVideoSoundParam("track:")).toBeNull();
  });

  it("the video panel routes ?sound= through the parser instead of the raw title setter", () => {
    expect(makeVideoSource).toContain("parseMakeVideoSoundParam(params.get(\"sound\"))");
    expect(makeVideoSource).not.toContain('setValue("songTitle", sound.slice(0, 120))');
  });

  it("a resolved track attaches as the project's song and titles the form with the real title", () => {
    expect(makeVideoSource).toContain("fetchTrack(soundParam.id)");
    expect(makeVideoSource).toContain("setAudioUrl(audioUrl)");
    expect(makeVideoSource).toContain('setValue("songTitle", found.track.title.slice(0, 120))');
  });

  it("an unresolvable track fails honestly on the audio block, never silently", () => {
    expect(makeVideoSource).toContain('setAudioSceneError(t("makeVideo.soundAttachFailed"))');
  });
});

describe("#178 format preload — the video panel consumes ?concept= as the scaffold", () => {
  it("the video panel reads concept and lands it in the special instructions the plan generator consumes", () => {
    expect(makeVideoSource).toContain('params.get("concept")');
    expect(makeVideoSource).toContain('setValue("specialInstructions", concept.slice(0, 2000))');
  });
});

describe("#178 topic preload — the song panel's existing concept intake stays the landing (regression pin)", () => {
  it("the song panel still lands concept in the song topic", () => {
    expect(makeSongSource).toContain('params.get("concept")');
    expect(makeSongSource).toContain('setValue("songTopic", deepConcept.slice(0, 2000))');
  });
});
