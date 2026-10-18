/**
 * audio-desk-tabs — STACK-20 #18 source-contract + seam tests.
 * The Audio Desk gains the Song Desk's three tabs (Sound packs,
 * Library, Stem splitter) on the WEBSITE's real rails. The pure
 * seam tests pin the payload/parse shapes the tabs speak; the
 * source pins fail if a tab's rail moves, if the Shelf player
 * stops being threaded to the desk, or if the station's
 * members-only gate (the desk's guest treatment) ever opens.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUDIO_DESK_TABS,
  buildSamplePackPayload,
  buildSamplePackZipPayload,
  isAudioDeskTabId,
  parseGeneratedSamples,
  parseSamplePackCatalog,
  samplePackName,
  samplePlayInput,
  stemSourceFileName,
  type PackSample,
} from "./audio-desk-tabs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const audioDesk = read("../../components/world/native/AudioDesk.tsx");
const audioDeskTabs = read("../../components/world/native/AudioDeskTabs.tsx");
const desks = read("../../components/world/native/CreateDesks.tsx");
const stationPanel = read("../../components/world/StationPanel.tsx");
const stations = read("./stations.ts");

describe("the desk's tab registry", () => {
  it("is benches first (the desk as it was), then the three crossed-over tabs", () => {
    expect(AUDIO_DESK_TABS.map((t) => t.id)).toEqual(["benches", "packs", "library", "stems"]);
    expect(AUDIO_DESK_TABS.map((t) => t.label)).toEqual(["Benches", "Sound packs", "Library", "Stem splitter"]);
    expect(isAudioDeskTabId("packs")).toBe(true);
    expect(isAudioDeskTabId("create")).toBe(false);
    expect(isAudioDeskTabId(null)).toBe(false);
  });
});

describe("parseSamplePackCatalog — the catalog boundary", () => {
  const catalogPayload = {
    genres: ["trap", "lofi"],
    keys: ["A", "C"],
    packSizes: [{ size: 10, credits: 500 }],
    types: [
      { key: "kick", label: "Kick", origin: "synthesized", blurb: "Punchy lows." },
      { key: "melody", label: "Melody loop", origin: "ai-generated", blurb: "A hook." },
      { key: "", label: "Broken", origin: "synthesized", blurb: "" },
      { label: "No key", origin: "synthesized", blurb: "" },
    ],
    license: "Royalty-free — use in your own productions.",
  };

  it("parses genres, keys, types and the license; broken type rows drop", () => {
    const catalog = parseSamplePackCatalog(catalogPayload);
    expect(catalog).not.toBeNull();
    expect(catalog!.genres).toEqual(["trap", "lofi"]);
    expect(catalog!.keys).toEqual(["A", "C"]);
    expect(catalog!.types).toHaveLength(2);
    expect(catalog!.types[0]).toEqual({ key: "kick", label: "Kick", origin: "synthesized", blurb: "Punchy lows." });
    expect(catalog!.types[1]!.origin).toBe("ai-generated");
    expect(catalog!.license).toContain("Royalty-free");
  });

  it("a non-object payload is not a catalog; a partial one degrades to empty lists", () => {
    expect(parseSamplePackCatalog(null)).toBeNull();
    expect(parseSamplePackCatalog("nope")).toBeNull();
    expect(parseSamplePackCatalog(42)).toBeNull();
    const partial = parseSamplePackCatalog({ genres: "trap" });
    expect(partial).toEqual({ genres: [], keys: [], types: [], license: "" });
  });

  it("an unknown origin reads as synthesized, never as AI", () => {
    const catalog = parseSamplePackCatalog({ types: [{ key: "hat", label: "Hat", origin: "mystery" }] });
    expect(catalog!.types[0]!.origin).toBe("synthesized");
  });
});

describe("buildSamplePackPayload — the website's generate shape", () => {
  it("posts genre/bpm/key/size, and types ONLY when some are picked", () => {
    expect(buildSamplePackPayload({ genre: "trap", bpm: 140, musicalKey: "A", packSize: 10, types: [] })).toEqual({
      genre: "trap",
      bpm: 140,
      musicalKey: "A",
      packSize: 10,
    });
    expect(
      buildSamplePackPayload({ genre: "lofi", bpm: 82, musicalKey: "C", packSize: 25, types: ["kick", "hat"] }),
    ).toEqual({ genre: "lofi", bpm: 82, musicalKey: "C", packSize: 25, types: ["kick", "hat"] });
  });

  it("names the pack the website's way", () => {
    expect(samplePackName({ genre: "Trap", bpm: 140, musicalKey: "A" })).toBe("trap-140bpm-a");
    /* The site's transform deletes symbols/spaces outright — no dash-joining. */
    expect(samplePackName({ genre: "R&B Soul", bpm: 90, musicalKey: "F#" })).toBe("rbsoul-90bpm-f");
  });
});

describe("parseGeneratedSamples + samplePlayInput — audition honesty", () => {
  const payload = {
    samples: [
      {
        id: "s1",
        name: "Deep Kick",
        type: "kick",
        typeLabel: "Kick",
        origin: "synthesized",
        url: "https://cdn.example.com/kick.wav",
        durationSec: 1.2,
        bpm: 140,
        musicalKey: "A",
        genre: "trap",
      },
      { id: "s2", name: "Ghost (no file)", url: "" },
      { name: "No id loop", url: "https://cdn.example.com/loop.wav" },
    ],
  };

  it("keeps only rows with a playable URL; an id-less row keys off its URL", () => {
    const samples = parseGeneratedSamples(payload);
    expect(samples).toHaveLength(2);
    expect(samples[0]!.name).toBe("Deep Kick");
    expect(samples[1]!.id).toBe("https://cdn.example.com/loop.wav");
    expect(samples[1]!.typeLabel).toBe("Sample");
    expect(parseGeneratedSamples(null)).toEqual([]);
    expect(parseGeneratedSamples({})).toEqual([]);
  });

  it("builds the Shelf play input — one player, the samples tab as its website home", () => {
    const [first] = parseGeneratedSamples(payload);
    const input = samplePlayInput(first!);
    expect(input).toMatchObject({
      kind: "track",
      id: "s1",
      title: "Deep Kick",
      artistName: "Sound library",
      src: "https://cdn.example.com/kick.wav",
      pagePath: "/audio-studio?tab=aiaudio&sub=samples",
    });
    const broken: PackSample = { ...first!, url: "  " };
    expect(samplePlayInput(broken)).toBeNull();
  });

  it("builds the zip rail's body, with the website's fallback pack name", () => {
    const samples = parseGeneratedSamples(payload);
    expect(buildSamplePackZipPayload(samples, "trap-140bpm-a")).toEqual({
      urls: ["https://cdn.example.com/kick.wav", "https://cdn.example.com/loop.wav"],
      packName: "trap-140bpm-a",
    });
    expect(buildSamplePackZipPayload(samples, "").packName).toBe("sample-pack");
  });
});

describe("stemSourceFileName — an owned track becomes the splitter's file", () => {
  it("slugs the title and follows the blob's type", () => {
    expect(stemSourceFileName("My Song!", "audio/wav")).toBe("my-song.wav");
    expect(stemSourceFileName("Midnight Run", "audio/mpeg")).toBe("midnight-run.mp3");
    expect(stemSourceFileName("Voice Memo", "audio/mp4")).toBe("voice-memo.m4a");
    expect(stemSourceFileName("!!!", "")).toBe("track.mp3");
  });
});

describe("source pins — the tabs ride the website's rails", () => {
  it("the desk renders the tab bar and all three tabs, fed by ONE my-music fetch", () => {
    expect(audioDesk).toContain("AUDIO_DESK_TABS");
    expect(audioDesk).toContain("world-audio-desk-tab-");
    expect(audioDesk).toContain('fetch("/api/world/my-music"');
    expect(audioDesk).toContain("parseMyMusic");
    expect(audioDesk).toContain("<SoundPacksTab");
    expect(audioDesk).toContain("<LibraryTab");
    expect(audioDesk).toContain("<StemsTab");
    /* The library's Split-stems chip hands the row to the stems tab. */
    expect(audioDesk).toContain("setDeskTab(\"stems\")");
    expect(audioDesk).toContain("props.shelfPlayer");
  });

  it("sound packs ride catalog → generate → zip, with the 402 told honestly", () => {
    expect(audioDeskTabs).toContain('fetch("/api/sample-pack/catalog"');
    expect(audioDeskTabs).toContain('fetch("/api/sample-pack/generate"');
    expect(audioDeskTabs).toContain('fetch("/api/sample-pack/zip"');
    expect(audioDeskTabs).toContain("buildSamplePackPayload");
    expect(audioDeskTabs).toContain("parseGeneratedSamples");
    expect(audioDeskTabs).toContain("res.status === 402");
    expect(audioDeskTabs).toContain("creditsForSize");
    expect(audioDeskTabs).toContain('data-testid="world-audio-packs-generate"');
    expect(audioDeskTabs).toContain('data-testid="world-audio-packs-audition"');
    expect(audioDeskTabs).toContain('data-testid="world-audio-packs-zip"');
    /* Audition is on the palace's ONE Shelf player, never a private element. */
    expect(audioDeskTabs).toContain("samplePlayInput");
    expect(audioDeskTabs).toContain("shelfPlayer.play(input)");
    expect(audioDeskTabs).not.toContain("new Audio(");
  });

  it("the library plays through the Booth's exact seams", () => {
    expect(audioDeskTabs).toContain("playInputFromMyMusic");
    expect(audioDeskTabs).toContain("shelfPlayer.queueNext(input)");
    expect(audioDeskTabs).toContain('recordPlay("track", row.id)');
    /* A draft hearing is not a public play — the Booth's rule, kept. */
    expect(audioDeskTabs).toContain("if (row.isPublished) recordPlay");
    expect(audioDeskTabs).toContain('data-testid="world-audio-library-play"');
    expect(audioDeskTabs).toContain('data-testid="world-audio-library-queue"');
    expect(audioDeskTabs).toContain('data-testid="world-audio-library-split"');
  });

  it("the stem splitter rides the registry's stems bench rail, file field and all", () => {
    expect(audioDeskTabs).toContain('audioBenchOf("stems")');
    expect(audioDeskTabs).toContain("MASTER_FILE_FIELD");
    expect(audioDeskTabs).toContain("stemsFields");
    expect(audioDeskTabs).toContain("audioBenchJobIdOf");
    expect(audioDeskTabs).toContain('interpretAudioBenchResponse("stems"');
    expect(audioDeskTabs).toContain("stemSourceFileName");
    expect(audioDeskTabs).toContain('data-testid="world-audio-stems-pick"');
    expect(audioDeskTabs).toContain('data-testid="world-audio-stems-run"');
    expect(audioDeskTabs).toContain('data-testid="world-audio-stems-result"');
  });

  it("the Shelf player is threaded host → panel → desk props", () => {
    expect(desks).toContain("shelfPlayer?: ShelfPlayerController");
    const panelBlock = stationPanel.slice(
      stationPanel.indexOf("<CreateDeskPanel"),
      stationPanel.indexOf("/>", stationPanel.indexOf("<CreateDeskPanel")),
    );
    expect(panelBlock).toContain("shelfPlayer={shelfPlayer}");
  });

  it("the guest gate stands: the audio-desk station stays members-only", () => {
    const at = stations.indexOf('id: "audio-desk"');
    expect(at).toBeGreaterThan(-1);
    expect(stations.slice(at, at + 500)).toContain("membersOnly: true");
  });
});
