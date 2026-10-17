import { describe, it, expect } from "vitest";
import {
  withProjectAudio,
  turboSongVideoInputData,
  editorAudioUrlFromInputData,
  editorLyricsFromInputData,
  isPersistableMediaUrl,
} from "./project-handoff";

/* DE-10: the flagship flows saved projects whose input_data had no
   audioUrl, and the editor derives the timeline's song audio SOLELY from
   input_data.audioUrl — so the project opened silent. These tests pin
   the saver side of that seam: whatever audio a desk holds MUST be in
   the saved input_data, readable back exactly the way the editor reads. */

const AUDIO = "https://cdn.example.com/songs/midnight-run.mp3";

describe("withProjectAudio", () => {
  it("merges the audio URL into the form values being saved", () => {
    const form = { artistName: "Thy Cheat Code", songTitle: "Midnight Run", lyrics: "la la" };
    const saved = withProjectAudio(form, AUDIO);
    expect(saved.audioUrl).toBe(AUDIO);
    expect(saved.artistName).toBe("Thy Cheat Code");
    expect(saved.lyrics).toBe("la la");
  });

  it("does not mutate the form object it was given", () => {
    const form = { lyrics: "words" };
    withProjectAudio(form, AUDIO);
    expect(form).toEqual({ lyrics: "words" });
  });

  it("adds no audioUrl key when the desk holds no audio", () => {
    const form = { lyrics: "words" };
    expect(withProjectAudio(form, null)).toBe(form);
    expect(withProjectAudio(form, undefined)).toBe(form);
    expect(withProjectAudio(form, "")).toBe(form);
    expect("audioUrl" in withProjectAudio(form, null)).toBe(false);
  });

  it("never persists a blob: URL — it would be dead when the project reopens", () => {
    const form = { lyrics: "words" };
    expect(withProjectAudio(form, "blob:https://app.example/abc-123")).toBe(form);
  });
});

describe("turboSongVideoInputData", () => {
  it("carries idea, lyrics AND the song — the project opens with audio loaded", () => {
    const saved = turboSongVideoInputData({
      idea: "a song about the grind",
      lyrics: "hook line\nverse line",
      audioUrl: AUDIO,
    });
    expect(saved.simpleMode).toBe(true);
    expect(editorAudioUrlFromInputData(saved)).toBe(AUDIO);
    expect(editorLyricsFromInputData(saved)).toBe("hook line\nverse line");
  });

  it("still carries the lyrics when the flow ran without audio", () => {
    const saved = turboSongVideoInputData({ idea: "x", lyrics: "only words", audioUrl: null });
    expect(editorAudioUrlFromInputData(saved)).toBeNull();
    expect(editorLyricsFromInputData(saved)).toBe("only words");
  });
});

describe("the editor seam, from the savers' side", () => {
  it("a Make Video save (form values + held audio) opens with audio and words", () => {
    const watchedForm = {
      artistName: "Thy Cheat Code",
      songTitle: "Midnight Run",
      genre: "Hip Hop",
      lyrics: "the picked song's own lyrics",
    };
    const saved = withProjectAudio({ ...watchedForm }, AUDIO);
    expect(editorAudioUrlFromInputData(saved)).toBe(AUDIO);
    expect(editorLyricsFromInputData(saved)).toBe("the picked song's own lyrics");
  });

  it("an Advanced Song+Video save (form values + held audio) opens with audio", () => {
    const watchedForm = { artistName: "Thy Cheat Code", existingLyrics: "draft words" };
    const saved = withProjectAudio({ ...watchedForm }, AUDIO);
    expect(editorAudioUrlFromInputData(saved)).toBe(AUDIO);
  });

  it("the reader still honors the legacy snake_case key", () => {
    expect(editorAudioUrlFromInputData({ audio_url: AUDIO })).toBe(AUDIO);
    expect(editorAudioUrlFromInputData({})).toBeNull();
    expect(editorAudioUrlFromInputData(null)).toBeNull();
  });
});

describe("isPersistableMediaUrl", () => {
  it("accepts durable URLs and rejects session-only ones", () => {
    expect(isPersistableMediaUrl(AUDIO)).toBe(true);
    expect(isPersistableMediaUrl("blob:https://app.example/x")).toBe(false);
    expect(isPersistableMediaUrl("")).toBe(false);
    expect(isPersistableMediaUrl(null)).toBe(false);
    expect(isPersistableMediaUrl(undefined)).toBe(false);
  });
});
