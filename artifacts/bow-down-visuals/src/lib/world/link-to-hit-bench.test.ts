/**
 * link-to-hit-bench — Stack 300 world parity (Lane B
 * item 12) seam pins. The bench mirrors the panel: the
 * analyze route's price as the override (no registry
 * entry for this rail — the panel's override is the house
 * pattern), the free upload step's answer, the panel's
 * file/comment/genre rules, its analyze body (an upload
 * with no description speaks as "Uploaded video: <name>"),
 * and a package guard that keeps the two pipelines'
 * segment labels honest. Copy: linkToHit is new to the
 * catalogs with this bench — en values are the panel's
 * own literals; the other nine carry them English-verbatim
 * UNREVIEWED.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LINK_TO_HIT_ANALYZE_PATH,
  LINK_TO_HIT_COST,
  LINK_TO_HIT_GENRE_PRESETS,
  LINK_TO_HIT_MAX_COMMENTS,
  LINK_TO_HIT_SONG_STATION_ID,
  LINK_TO_HIT_UPLOAD_PATH,
  addLinkToHitComment,
  buildLinkToHitPayload,
  linkToHitFileVerdict,
  linkToHitFinalGenre,
  linkToHitInputReady,
  linkToHitPackageOf,
  linkToHitSongCopyText,
  linkToHitSongSeed,
  linkToHitUploadUrlOf,
  type LinkToHitPackage,
} from "./link-to-hit-bench";

const PKG: LinkToHitPackage = {
  source: { title: "The clip", author: "@someone", thumbnail: "https://x/t.jpg" },
  comedyConcept: "Roast the comments, keep the chorus",
  segments: [
    { type: "source", description: "The original fall" },
    { type: "generated", description: "Comic-book pop-up", prompt: "draw it loud" },
  ],
  songTitle: "Comments Made Me Do It",
  hook: "You typed it, I sang it",
  songLyrics: "Verse one from the thread",
  musicPrompt: "comedy pop, bouncy",
};

const BASE_INPUT = {
  url: "",
  description: "",
  hasUpload: false,
  fileName: "",
  comments: [] as string[],
  genre: "Comedy Pop",
};

describe("the rails + the price", () => {
  it("analyzes where the panel analyzes, at the route's 300; uploads free on their own rail", () => {
    expect(LINK_TO_HIT_ANALYZE_PATH).toBe("/api/link-to-hit/analyze");
    expect(LINK_TO_HIT_UPLOAD_PATH).toBe("/api/upload-clip");
    expect(LINK_TO_HIT_COST).toBe(300);
    expect(LINK_TO_HIT_SONG_STATION_ID).toBe("song-desk");
    expect(linkToHitUploadUrlOf({ url: "https://cdn/clip.mp4" })).toBe("https://cdn/clip.mp4");
    expect(linkToHitUploadUrlOf({})).toBeNull();
  });

  it("carries the panel's genre presets verbatim", () => {
    expect(LINK_TO_HIT_GENRE_PRESETS).toEqual([
      "Hip-Hop", "Pop", "Country", "Rock", "EDM", "R&B", "Gospel",
      "Reggaeton", "Afrobeats", "Comedy Pop", "Novelty", "Punk",
    ]);
    expect(linkToHitFinalGenre("  ", "Punk")).toBe("Punk");
    expect(linkToHitFinalGenre(" zydeco ", "Punk")).toBe("zydeco");
  });
});

describe("the panel's rules", () => {
  it("files: a video under the caller's ceiling", () => {
    expect(linkToHitFileVerdict({ type: "video/mp4", size: 10 }, 100)).toBe("ok");
    expect(linkToHitFileVerdict({ type: "video/mp4", size: 101 }, 100)).toBe("too-large");
    expect(linkToHitFileVerdict({ type: "audio/mp3", size: 10 }, 100)).toBe("not-video");
  });

  it("comments: trimmed, capped at 20; the run needs one source", () => {
    expect(addLinkToHitComment([], "  ha  ")).toEqual(["ha"]);
    const full = Array.from({ length: LINK_TO_HIT_MAX_COMMENTS }, (_, i) => `c${i}`);
    expect(addLinkToHitComment(full, "x")).toBeNull();
    expect(linkToHitInputReady(BASE_INPUT)).toBe(false);
    expect(linkToHitInputReady({ ...BASE_INPUT, url: "https://tiktok/x" })).toBe(true);
    expect(linkToHitInputReady({ ...BASE_INPUT, description: "a guy slips" })).toBe(true);
    expect(linkToHitInputReady({ ...BASE_INPUT, hasUpload: true, fileName: "v.mp4" })).toBe(true);
  });

  it("the analyze body: hosted URL in, upload speaks its filename without a description", () => {
    expect(buildLinkToHitPayload({ ...BASE_INPUT, hasUpload: true, fileName: "v.mp4" }, "https://cdn/v.mp4")).toEqual({
      url: "https://cdn/v.mp4",
      description: "Uploaded video: v.mp4",
      comments: [],
      genre: "Comedy Pop",
    });
    expect(
      buildLinkToHitPayload({ ...BASE_INPUT, description: "  described  " }, "https://x"),
    ).toMatchObject({ description: "described" });
  });
});

describe("the answer guard", () => {
  it("takes the whole package; segments keep only the two pipelines' labels", () => {
    expect(linkToHitPackageOf(PKG)).toEqual(PKG);
    expect(linkToHitPackageOf({ ...PKG, comedyConcept: "" })).toBeNull();
    expect(linkToHitPackageOf({})).toBeNull();
    const drifted = linkToHitPackageOf({
      ...PKG,
      segments: [...PKG.segments, { type: "mystery", description: "?" }],
    });
    expect(drifted?.segments).toHaveLength(2);
    expect(linkToHitPackageOf({ ...PKG, source: null })?.source).toBeNull();
  });

  it("copies the song and seeds it in the panel's own formats", () => {
    expect(linkToHitSongCopyText(PKG)).toBe("Comments Made Me Do It\n\nHOOK:\nYou typed it, I sang it\n\nVerse one from the thread");
    expect(linkToHitSongSeed(PKG, "Comedy Pop")).toBe(
      "Comments Made Me Do It\n\nHOOK:\nYou typed it, I sang it\n\nVerse one from the thread\n\nGenre: Comedy Pop\nMusic prompt: comedy pop, bouncy",
    );
  });
});

describe("the copy — the namespace, verbatim in every catalog until reviewed", () => {
  it("linkToHit rides all ten catalogs identically", () => {
    const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as Record<string, any>;
    const en = readJson("../../locales/en.json");
    expect(en.linkToHit.title).toBe("Link-to-Hit");
    expect(en.linkToHit.tooLarge).toContain("{{limit}}");
    for (const loc of ["ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"]) {
      const cat = readJson(`../../locales/${loc}.json`);
      expect(cat.linkToHit, loc).toEqual(en.linkToHit);
    }
  });
});
