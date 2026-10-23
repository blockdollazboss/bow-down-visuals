/**
 * create-finishers — Stack-100 Stage D (items 49–52) contracts.
 * The Create finishers complete in-world on the 2D flows' REAL
 * rails: same endpoints, same Visual Bucs prices (registry or the
 * server's own probe), same confirmation law. These pins fail if
 * a finisher's rail, price source, or shared-draft guarantee moves.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getCreditCost } from "../credit-costs";
import { LRC_AI_ALIGN_CREDITS, LRC_AI_ALIGN_ENDPOINT } from "../lrc";
import {
  coverSourceForSong,
  ctrPredictionOfResponse,
  lrcSourceForSong,
  packageLyricsOf,
  songCoverCost,
  thumbnailImproveFields,
  thumbnailImprovedUrlOfResponse,
  THUMBNAIL_IMPROVE_FIELD,
} from "./create-desks";
import {
  buildHarmonyPayload,
  buildStemRemixPayload,
  HARMONY_AI_FALLBACK_COST,
  HARMONY_CLASSIC_FALLBACK_COST,
  HARMONY_MODES_ENDPOINT,
  harmonyDefaultMode,
  harmonyModeCost,
  parseHarmonyModesResponse,
  stemKeyOfResultLabel,
  stemRemixPath,
  stemRemixUrlOfResponse,
} from "./audio-benches";
import { CREATE_DESK_NATIVE_FOLLOWONS } from "./create-desks-followons";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desks = read("../../components/world/native/CreateDesks.tsx");
const thumbBenches = read("../../components/world/native/ThumbnailBenches.tsx");
const audioDesk = read("../../components/world/native/AudioDesk.tsx");
const audioTabs = read("../../components/world/native/AudioDeskTabs.tsx");

const PACKAGE = [
  "## BEST SONG TITLE",
  "Crown Anthem",
  "",
  "## FULL LYRICS",
  "Line one of the crown",
  "Line two of the crown",
  "",
  "## AI MUSIC PROMPT",
  "triumphant trap anthem",
].join("\n");

describe("49 — Song Desk finishers: cover-from-package + .lrc export", () => {
  it("the cover price is the registry's, never invented", () => {
    expect(songCoverCost()).toBe(getCreditCost("/api/song-cover")!.cost);
    expect(songCoverCost()).toBe(400);
  });

  it("the .lrc source needs real hosted audio AND package lyrics", () => {
    expect(lrcSourceForSong({ audioUrl: null, title: "T", rawResult: PACKAGE })).toBeNull();
    expect(lrcSourceForSong({ audioUrl: "blob:x", title: "T", rawResult: PACKAGE })).toBeNull();
    expect(lrcSourceForSong({ audioUrl: "https://x/s.mp3", title: "T", rawResult: "## HOOK\nonly a hook" })).toBeNull();
    expect(lrcSourceForSong({ audioUrl: "https://x/s.mp3", title: " Crown ", artistName: " King ", rawResult: PACKAGE })).toEqual({
      audioUrl: "https://x/s.mp3",
      title: "Crown",
      artistName: "King",
      lyrics: "Line one of the crown\nLine two of the crown",
    });
  });

  it("the cover source + package lyrics mirror make-song's modal inputs", () => {
    expect(coverSourceForSong({ audioUrl: null, title: "T" })).toBeNull();
    expect(coverSourceForSong({ audioUrl: "https://x/s.mp3", title: "", artistName: " " })).toEqual({
      audioUrl: "https://x/s.mp3",
      title: "Untitled Song",
      artistName: undefined,
    });
    expect(packageLyricsOf(PACKAGE)).toBe("Line one of the crown\nLine two of the crown");
    expect(packageLyricsOf(null)).toBe("");
  });

  it("the desk docks the site's OWN modals on the finished result", () => {
    expect(desks).toContain('from "@/components/song/CoverSongModal"');
    expect(desks).toContain('from "@/components/song/LrcExportModal"');
    expect(desks).toContain('data-testid="world-song-finishers"');
    expect(desks).toContain('data-testid="world-song-finisher-cover"');
    expect(desks).toContain('data-testid="world-song-finisher-lrc"');
    expect(desks).toContain("songCoverCost()");
    expect(desks).toContain("lrcSourceForSong(");
    expect(desks).toContain("coverSourceForSong(");
    /* The .lrc price honesty rides lib/lrc's own constants. */
    expect(LRC_AI_ALIGN_ENDPOINT).toBe("/api/lyric-video/align");
    expect(LRC_AI_ALIGN_CREDITS).toBe(200);
  });
});

describe("50 — Thumbnail CTR apply-suggestions rail", () => {
  it("the prediction now carries each candidate's tips, in order", () => {
    const ctr = ctrPredictionOfResponse({
      result: {
        winnerIndex: 0,
        confidence: 70,
        reasoning: "r",
        disclaimer: "d",
        analyses: [
          { scores: { overall: 55 }, tips: ["Bigger face", "  ", "Shorter text"] },
          { scores: { overall: 80 } },
          { scores: { overall: 61 }, tips: "not-a-list" },
        ],
      },
    });
    expect(ctr?.tips).toEqual([["Bigger face", "Shorter text"], [], []]);
    expect(ctr?.overallScores).toEqual([55, 80, 61]);
  });

  it("the improve form is the studio's: the File field + tips joined with newlines", () => {
    expect(THUMBNAIL_IMPROVE_FIELD).toBe("thumbnail");
    expect(thumbnailImproveFields({ tips: ["a", "b"] })).toEqual([["tips", "a\nb"]]);
    expect(thumbnailImprovedUrlOfResponse({ imageUrl: "https://x/i.png" })).toBe("https://x/i.png");
    expect(thumbnailImprovedUrlOfResponse({})).toBeNull();
    expect(thumbnailImprovedUrlOfResponse(null)).toBeNull();
  });

  it("the bench posts to the studio's improve rail at the registry price", () => {
    expect(thumbBenches).toContain('fetch("/api/thumbnail-test/improve"');
    expect(thumbBenches).toContain("thumbnailImproveCost()");
    expect(thumbBenches).toContain("thumbnailImproveFields(");
    expect(thumbBenches).toContain('data-testid="world-thumbnail-ctr-apply"');
    expect(thumbBenches).toContain('data-testid="world-thumbnail-ctr-improved"');
  });
});

describe("51 — Audio Desk deep end I: Harmony AI + stems remix", () => {
  const probeJson = {
    modes: [
      { key: "classic", label: "Classic", blurb: "b", cost: 300, available: true, missing: [] },
      { key: "ai", label: "AI", blurb: "b", cost: 650, available: true, missing: [] },
    ],
    styles: [{ key: "stack", label: "Stack" }],
    defaultStyle: "stack",
    defaultMixLevel: 40,
  };

  it("the modes probe parses prices + availability from the server, never the registry", () => {
    const probe = parseHarmonyModesResponse(probeJson);
    expect(probe?.styles).toEqual([{ key: "stack", label: "Stack" }]);
    expect(probe?.defaultMixLevel).toBe(40);
    expect(harmonyModeCost(probe, "ai")).toBe(650);
    expect(harmonyModeCost(probe, "classic")).toBe(300);
    expect(harmonyDefaultMode(probe)).toBe("ai");
    expect(parseHarmonyModesResponse({ modes: [] })).toBeNull();
    expect(parseHarmonyModesResponse(null)).toBeNull();
  });

  it("pre-probe prices are the modal's own fallbacks; AI preselects only when available", () => {
    expect(harmonyModeCost(null, "classic")).toBe(HARMONY_CLASSIC_FALLBACK_COST);
    expect(harmonyModeCost(null, "ai")).toBe(HARMONY_AI_FALLBACK_COST);
    expect(HARMONY_CLASSIC_FALLBACK_COST).toBe(300);
    expect(HARMONY_AI_FALLBACK_COST).toBe(600);
    expect(harmonyDefaultMode(null)).toBe("classic");
    const aiDown = parseHarmonyModesResponse({
      modes: [
        { key: "classic", cost: 300, available: true },
        { key: "ai", cost: 600, available: false, missing: ["voices"] },
      ],
    });
    expect(harmonyDefaultMode(aiDown)).toBe("classic");
    expect(aiDown?.modes.find((m) => m.key === "ai")?.missing).toEqual(["voices"]);
  });

  it("the harmony payload carries the chosen mode; the endpoint is the modal's probe", () => {
    expect(HARMONY_MODES_ENDPOINT).toBe("/api/generate-harmony/modes");
    expect(buildHarmonyPayload({ audioUrl: "u", style: "stack", mixLevel: 35, mode: "ai" })).toMatchObject({ mode: "ai", mixLevel: 35 });
    expect(buildHarmonyPayload({ audioUrl: "u", style: "stack", mixLevel: 35 })).toMatchObject({ mode: "classic" });
  });

  it("the remix payload sends exactly the job's stems, clamped to the server's 0–2", () => {
    expect(buildStemRemixPayload(["vocals", "drums"], { vocals: 1.5, drums: 9 })).toEqual({
      levels: { vocals: 1.5, drums: 2 },
    });
    expect(buildStemRemixPayload(["bass"], {})).toEqual({ levels: { bass: 1 } });
    expect(buildStemRemixPayload(["vocals"], { vocals: -1, guitar: 2 })).toEqual({ levels: { vocals: 0 } });
    expect(stemKeyOfResultLabel("Stem — vocals")).toBe("vocals");
    expect(stemKeyOfResultLabel("Your finished audio")).toBeNull();
    expect(stemRemixPath("job-1")).toBe("/api/stems/job-1/remix");
    expect(stemRemixUrlOfResponse({ url: "https://x/remix.wav" })).toBe("https://x/remix.wav");
    expect(stemRemixUrlOfResponse({})).toBeNull();
  });

  it("the desk probes the modes, confirms harmony at the probe price, and docks the remix panel", () => {
    expect(audioDesk).toContain("HARMONY_MODES_ENDPOINT");
    expect(audioDesk).toContain("parseHarmonyModesResponse");
    expect(audioDesk).toContain('data-testid="world-audio-harmony-modes"');
    expect(audioDesk).toContain("harmonyModeCost(harmonyProbe, harmonyMode)");
    expect(audioDesk).toContain("StemRemixPanel");
    expect(audioTabs).toContain("stemRemixPath(jobId)");
    expect(audioTabs).toContain("buildStemRemixPayload(");
    expect(audioTabs).toContain('data-testid="world-audio-stem-remix"');
    expect(audioTabs).toContain('data-testid="world-audio-stem-remix-run"');
  });
});

describe("52 — Audio Desk deep end II: the shared arrangement studio", () => {
  it("the desk mounts the SITE'S ArrangementStudio — the same component, draft and export rail", () => {
    expect(audioDesk).toContain('from "@/components/audio-studio/ArrangementStudio"');
    expect(audioDesk).toContain("<ArrangementStudio />");
    expect(audioDesk).toContain('data-testid="world-audio-arrangement-studio"');
    /* The old title/BPM/mutes mini-editor is gone — no fork remains. */
    expect(audioDesk).not.toContain('label="Arrangement title"');
    expect(audioDesk).not.toContain("Save the arrangement draft");
  });

  it("the follow-on log no longer lists any of 49–52 as gaps", () => {
    const items = CREATE_DESK_NATIVE_FOLLOWONS.map((f) => f.item).join("\n");
    expect(items).not.toContain("Arrangement timeline editing");
    expect(items).not.toContain("Harmony AI mode");
    expect(items).not.toContain("synced-lyrics .lrc export");
    expect(items).not.toContain("thumbnail-test/improve");
  });
});
