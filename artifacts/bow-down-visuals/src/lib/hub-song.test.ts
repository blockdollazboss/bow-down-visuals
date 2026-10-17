import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  pushSongPackageToProject,
  songPickPrefill,
  findSongLyricsScript,
  coverArtSeedFromAsset,
  decodeDataTextUrl,
  COVER_ART_PROMPT_MAX,
  type PushSongInput,
} from "./hub-song";
import type { HubAsset, HubAssetKind } from "./hub-project";

/* The song package writes a song asset + a sibling lyrics script asset
   into the hub project, both stamped with the same meta. These tests pin
   the READ side (DE-8/DE-10): a desk picking the song must recover the
   title, genre, lyrics, and cover-art direction the package saved —
   not just the audio URL. */

const RAW_PACKAGE = [
  "## SONG CONCEPT",
  "A triumphant late-night anthem.",
  "",
  "## BEST SONG TITLE",
  "Midnight Run",
  "",
  "## FULL LYRICS",
  "Hook: we run the night",
  "Verse: city lights behind us",
  "",
  "## HOOK",
  "We run the night",
  "",
  "## MUSIC VIDEO IDEA",
  "Rooftop chase at golden hour.",
  "",
  "## COVER ART PROMPT",
  "Gold crown over a midnight skyline, cinematic, luxury",
  "",
  "## PROMO CAPTION IDEAS",
  "Midnight Run out now",
].join("\n");

function fakeHub() {
  const assets: HubAsset[] = [];
  let n = 0;
  const input: PushSongInput = {
    artistName: "Thy Cheat Code",
    songTitle: "",
    genre: "Hip Hop",
    mood: "Triumphant",
    rawResult: RAW_PACKAGE,
    audioUrl: "https://cdn.example.com/midnight-run.mp3",
    setProjectName: () => {},
    setProjectType: () => {},
    setProjectConcept: () => {},
    addAsset: (a) => {
      const asset = { ...a, id: `asset-${++n}`, createdAt: n } as HubAsset;
      assets.push(asset);
      return asset;
    },
    hasKind: (k: HubAssetKind) => assets.some((a) => a.kind === k),
    latestOfKind: (k: HubAssetKind) => [...assets].reverse().find((a) => a.kind === k),
  };
  return { assets, input };
}

describe("songPickPrefill", () => {
  it("recovers title, genre and the song's own lyrics from a picked song", () => {
    const { assets, input } = fakeHub();
    pushSongPackageToProject(input);
    const song = assets.find((a) => a.kind === "song");
    expect(song).toBeDefined();
    const prefill = songPickPrefill(assets, song!);
    expect(prefill.title).toBe("Midnight Run");
    expect(prefill.genre).toBe("Hip Hop");
    expect(prefill.lyrics).toContain("Hook: we run the night");
    expect(prefill.lyrics).toContain("Verse: city lights behind us");
  });

  it("never borrows another song's lyrics in a multi-song project", () => {
    const { assets, input } = fakeHub();
    pushSongPackageToProject(input);
    const otherRaw = RAW_PACKAGE.replaceAll("Midnight Run", "Second Song")
      .replace("Hook: we run the night", "Hook: a different hook entirely");
    pushSongPackageToProject({
      ...input,
      rawResult: otherRaw,
      audioUrl: "https://cdn.example.com/second-song.mp3",
    });
    const songs = assets.filter((a) => a.kind === "song");
    expect(songs).toHaveLength(2);
    const first = songPickPrefill(assets, songs[0]);
    const second = songPickPrefill(assets, songs[1]);
    expect(first.lyrics).toContain("we run the night");
    expect(second.lyrics).toContain("a different hook entirely");
    expect(second.title).toBe("Second Song");
  });

  it("a song with no package meta prefills nothing — the pick stays URL-only", () => {
    const bare: HubAsset = {
      id: "x",
      kind: "song",
      url: "https://cdn.example.com/upload.mp3",
      label: "upload.mp3",
      createdAt: 1,
    };
    expect(songPickPrefill([bare], bare)).toEqual({});
    expect(findSongLyricsScript([bare], bare)).toBeUndefined();
  });
});

describe("coverArtSeedFromAsset", () => {
  it("surfaces the package's cover-art direction, title, artist and genre", () => {
    const { assets, input } = fakeHub();
    pushSongPackageToProject(input);
    const song = assets.find((a) => a.kind === "song")!;
    const seed = coverArtSeedFromAsset(song);
    expect(seed.coverArtPrompt).toBe("Gold crown over a midnight skyline, cinematic, luxury");
    expect(seed.title).toBe("Midnight Run");
    expect(seed.artist).toBe("Thy Cheat Code");
    expect(seed.genre).toBe("Hip Hop");
  });

  it("the sibling lyrics script carries the same seed (same meta)", () => {
    const { assets, input } = fakeHub();
    pushSongPackageToProject(input);
    const script = assets.find((a) => a.kind === "script")!;
    expect(coverArtSeedFromAsset(script).coverArtPrompt).toContain("Gold crown");
  });

  it("an asset without meta seeds nothing", () => {
    const bare: HubAsset = { id: "y", kind: "image", url: "https://x/y.png", label: "y", createdAt: 1 };
    expect(coverArtSeedFromAsset(bare)).toEqual({});
  });
});

describe("decodeDataTextUrl", () => {
  it("decodes the data: URLs script assets travel as", () => {
    const url = `data:text/plain;charset=utf-8,${encodeURIComponent("line one\nline two")}`;
    expect(decodeDataTextUrl(url)).toBe("line one\nline two");
  });

  it("refuses remote URLs and malformed data", () => {
    expect(decodeDataTextUrl("https://cdn.example.com/lyrics.txt")).toBeNull();
    expect(decodeDataTextUrl("data:text/plain")).toBeNull();
    expect(decodeDataTextUrl("data:text/plain,%E0%A4%A")).toBeNull();
  });
});

/**
 * Stack-30 C5 — the mood input cap matches the seed's real maximum.
 *
 * A song package's coverArtPrompt is stored capped at
 * COVER_ART_PROMPT_MAX (600) and seeds the Cover Art desk's mood
 * field whole — but the mood input capped TYPING at 300, so editing
 * a seeded prompt truncated it to half its length. The input now
 * takes its cap from the same constant the writer slices with.
 */
describe("COVER_ART_PROMPT_MAX — the seed cap and the input cap agree", () => {
  it("is 600, the stored seed's real maximum", () => {
    expect(COVER_ART_PROMPT_MAX).toBe(600);
  });

  it("the package writer stores a long art direction at the full cap, uncropped below it", () => {
    const { assets, input } = fakeHub();
    const longPrompt = "x".repeat(700);
    pushSongPackageToProject({
      ...input,
      rawResult: RAW_PACKAGE.replace(
        "Gold crown over a midnight skyline, cinematic, luxury",
        longPrompt,
      ),
    });
    const song = assets.find((a) => a.kind === "song");
    expect(song?.meta?.["coverArtPrompt"]).toHaveLength(COVER_ART_PROMPT_MAX);
    /* …and the seed reader hands the desk the full stored length. */
    const seed = coverArtSeedFromAsset(song!);
    expect(seed.coverArtPrompt).toHaveLength(COVER_ART_PROMPT_MAX);
  });

  it("the Cover Art desk's mood input takes its maxLength from the same constant (source)", () => {
    const src = readFileSync(new URL("../pages/cover-art.tsx", import.meta.url), "utf8");
    expect(src).toContain("maxLength={COVER_ART_PROMPT_MAX}");
    expect(src).not.toContain("maxLength={300}");
  });
});
