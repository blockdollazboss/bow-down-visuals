/**
 * create-desks — Lane 6 (Create Desks, NATIVE-PLAN §3.6) pins.
 *
 * (a) Every desk's displayed price is the REAL server charge, read
 *     from the exact source its page uses (the credit-cost registry,
 *     the cover tier table, the artist-image model table, or the
 *     server-default constants the pages badge) — never invented.
 * (b) Payload builders mirror the pages' request bodies field for
 *     field (Turbo and Advanced), including the folds and defaults.
 * (c) Poll interpreters speak the pages' status words.
 * (d) Draft + editor-seed payloads match the shapes make-video
 *     posts to /api/drafts and /api/projects.
 * (e) The jukebox chip's gate: only published-track ids pass.
 * (f) All six create stations exist in the registry as pattern
 *     "create", and the follow-on log names the audio deep end.
 */
import { describe, it, expect } from "vitest";
import {
  artistImageCost,
  audioCleanupCost,
  beatCost,
  buildArtistImagePayload,
  buildCoverArtPayload,
  buildCoverInMotionPayload,
  buildDraftPayload,
  buildEditorProjectPayload,
  buildRunwayClipPayload,
  buildSfxPayload,
  buildBeatPayload,
  buildSongPayloadAdvanced,
  buildSongPayloadTurbo,
  buildSongVideoPayloadAdvanced,
  buildSongVideoPayloadTurbo,
  buildThumbnailPayload,
  buildVideoPlanPayload,
  coverArtCost,
  coverInMotionCost,
  deverbCost,
  distributeHrefForCover,
  finishMySongCost,
  interpretJobPoll,
  interpretTaskPoll,
  isCreateDeskId,
  jukeboxTrackIdOf,
  resultExcerpt,
  scheduleHrefForMedia,
  sfxCost,
  songDeskCost,
  songVideoDeskCost,
  thumbnailDeskCost,
  videoClipCost,
  videoPlanCost,
  EMPTY_SONG_ADVANCED,
} from "./create-desks";
import { CREATE_DESK_NATIVE_FOLLOWONS } from "./create-desks-followons";
import { getCreditCost } from "../credit-costs";
import { getCoverArtTier } from "../cover-art";
import { ARTIST_IMAGE_MODELS } from "../../components/generate-artist-image";
import { PALACE_STATIONS } from "./stations";

describe("create desk costs — the real charges, from the pages' own sources (pin a)", () => {
  it("registry-priced desks equal getCreditCost for their endpoint", () => {
    expect(songDeskCost()).toBe(getCreditCost("/api/generate-song")!.cost);
    expect(songVideoDeskCost()).toBe(getCreditCost("/api/generate-song-video")!.cost);
    expect(videoClipCost()).toBe(getCreditCost("/api/generate-runway-clip")!.cost);
    expect(videoPlanCost()).toBe(getCreditCost("/api/generate-video-plan")!.cost);
    expect(audioCleanupCost()).toBe(getCreditCost("/api/audio-cleanup")!.cost);
    expect(deverbCost()).toBe(getCreditCost("/api/deverb")!.cost);
    expect(beatCost()).toBe(getCreditCost("/api/beat/generate")!.cost);
    expect(sfxCost()).toBe(getCreditCost("/api/generate-sfx")!.cost);
  });

  it("registry values are the known server charges", () => {
    expect(songDeskCost()).toBe(400);
    expect(songVideoDeskCost()).toBe(400);
    expect(videoClipCost()).toBe(400);
    expect(videoPlanCost()).toBe(200);
    expect(audioCleanupCost()).toBe(300);
    expect(beatCost()).toBe(300);
    expect(sfxCost()).toBe(100);
  });

  it("cover art costs come from the cover page's tier table", () => {
    expect(coverArtCost("standard")).toBe(getCoverArtTier("standard").credits);
    expect(coverArtCost("premium")).toBe(getCoverArtTier("premium").credits);
    expect(coverArtCost("standard")).toBe(200);
    expect(coverArtCost("premium")).toBe(300);
  });

  it("artist image costs come from the image modal's model table", () => {
    for (const m of ARTIST_IMAGE_MODELS) {
      expect(artistImageCost(m.id)).toBe(m.credits);
    }
  });

  it("unregistered server-default desks match the pages' badges (400 / up-to-300)", () => {
    expect(finishMySongCost()).toBe(400);
    expect(coverInMotionCost()).toBe(400);
    /* Thumbnail: server charges 100 text + 200 image; the page
       badges it "up to 300 Visual Bucs" — the desk shows the max. */
    expect(thumbnailDeskCost()).toBe(300);
  });
});

describe("payload builders mirror the pages (pin b)", () => {
  it("song Turbo: prompt is the topic, style fields ride empty, page instructions verbatim", () => {
    const p = buildSongPayloadTurbo("  a song about the crown  ");
    expect(p.songTopic).toBe("a song about the crown");
    expect(p.instructions).toBe(
      "Create a complete song from this description. Write the lyrics and choose the style automatically.",
    );
    for (const k of ["artistName", "songTitle", "genre", "mood", "explicit", "voiceStyle", "beatStyle", "songLength"]) {
      expect(p[k], k).toBe("");
    }
    expect(p.artistVault).toBeNull();
  });

  it("song Advanced: form fields post under the API's names", () => {
    const adv = {
      ...EMPTY_SONG_ADVANCED,
      artistName: "King",
      cleanOrExplicit: "Clean",
      specialInstructions: "No autotune",
    };
    const p = buildSongPayloadAdvanced("topic", adv);
    expect(p.explicit).toBe("Clean");
    expect(p.instructions).toBe("No autotune");
    expect(p.artistName).toBe("King");
    expect(p.songTopic).toBe("topic");
  });

  it("song+video Turbo posts the simple intake's defaults", () => {
    const p = buildSongVideoPayloadTurbo("idea");
    expect(p.songTopic).toBe("idea");
    expect(p.genre).toBe("Hip Hop");
    expect(p.mood).toBe("Energetic");
    expect(p.videoStyle).toBe("Street Cinematic");
    expect(p.platform).toBe("TikTok / Reels / Shorts - 9:16");
    expect(p.explicit).toBe("Clean");
  });

  it("song+video Advanced folds location/length/instructions like the page", () => {
    const adv = { ...EMPTY_SONG_ADVANCED, videoStyle: "", platform: "", specialInstructions: "End on the hook" };
    const p = buildSongVideoPayloadAdvanced("topic", adv, { locationIdeas: "The palace", videoLength: "60 seconds" });
    expect(p.instructions).toBe("Location Ideas: The palace\n\nVideo Length: 60 seconds\n\nEnd on the hook");
  });

  it("video plan + runway clip bodies match make-video / the scene timeline", () => {
    const plan = buildVideoPlanPayload("my lyrics");
    expect(plan.lyrics).toBe("my lyrics");
    expect(plan.presenter).toBeNull();
    const clip = buildRunwayClipPayload("a palace scene", "blurry");
    expect(clip).toEqual({ promptText: "a palace scene", negativePrompt: "blurry", ratio: "720:1280" });
  });

  it("cover art, cover-in-motion and artist image bodies match their panels", () => {
    const cover = buildCoverArtPayload("dark and triumphant", {
      songTitle: " Crown ",
      artistName: " King ",
      style: "luxury-gold",
      aspectRatio: "1:1",
      tier: "premium",
    });
    expect(cover).toEqual({
      songTitle: "Crown",
      artistName: "King",
      mood: "dark and triumphant",
      style: "luxury-gold",
      aspectRatio: "1:1",
      tier: "premium",
      attribution: false,
    });
    expect(buildCoverInMotionPayload("https://x/y.png")).toEqual({
      imageUrl: "https://x/y.png",
      style: "",
      durationSec: 5,
    });
    expect(buildArtistImagePayload("portrait", "gen4_image")).toEqual({
      promptText: "portrait",
      model: "gen4_image",
      ratio: "1080:1080",
      referenceImageUrl: null,
    });
  });

  it("thumbnail body matches the single-shot form (prompt rides as requests)", () => {
    const p = buildThumbnailPayload("big bold text", {
      artistName: "King",
      songTitle: "Crown",
      platform: "YouTube",
      artStyle: "",
      colorTheme: "",
      mood: "",
      featuredText: "NEW",
    });
    expect(p.requests).toBe("big bold text");
    expect(p.artistName).toBe("King");
    expect(p.featuredText).toBe("NEW");
    expect(p.artistVault).toBeNull();
  });

  it("beat + sfx bodies match the AI audio tabs, with the pages' defaults", () => {
    expect(buildBeatPayload("dark vibe")).toEqual({
      vibe: "dark vibe",
      genre: "trap",
      bpm: 140,
      musicalKey: "C",
      lengthSeconds: 60,
      beatTitle: undefined,
    });
    expect(buildSfxPayload("a door slam")).toEqual({
      prompt: "a door slam",
      durationSeconds: 3,
      category: "impacts",
    });
  });
});

describe("poll interpreters speak the pages' status words (pin c)", () => {
  it("task polls: succeeded+url done, failed/cancelled failed, else still running", () => {
    expect(interpretTaskPoll({ status: "succeeded", url: "https://x/v.mp4" })).toEqual({
      done: true,
      failed: false,
      url: "https://x/v.mp4",
      error: null,
    });
    expect(interpretTaskPoll({ status: "failed", error: "boom" }).failed).toBe(true);
    expect(interpretTaskPoll({ status: "cancelled" }).done).toBe(true);
    expect(interpretTaskPoll({ status: "running", progress: 40 }).done).toBe(false);
    /* Succeeded with no url is an honest failure, never a blank result. */
    expect(interpretTaskPoll({ status: "succeeded", url: null }).failed).toBe(true);
  });

  it("job polls: done reads outputUrl, failed reads the error", () => {
    expect(interpretJobPoll({ status: "done", outputUrl: "https://x/a.mp3" }).url).toBe("https://x/a.mp3");
    expect(interpretJobPoll({ status: "failed", error: "nope" }).error).toBe("nope");
    expect(interpretJobPoll({ status: "processing" }).done).toBe(false);
    expect(interpretJobPoll({ status: "queued" }).done).toBe(false);
  });
});

describe("drafts + editor seed match the pages' shapes (pin d)", () => {
  it("draft payload is { workflowType, title, draftData }", () => {
    expect(buildDraftPayload("make-song", "T", { rawResult: "x" })).toEqual({
      workflowType: "make-song",
      title: "T",
      draftData: { rawResult: "x" },
    });
  });

  it("editor project payload matches make-video's performSave body", () => {
    const p = buildEditorProjectPayload({
      projectType: "Make a Song",
      title: "King - Crown",
      artistName: "King",
      songTitle: "Crown",
      genre: "Trap",
      mood: "Dark",
      inputData: { songTopic: "crown" },
      resultText: "## FULL LYRICS\n…",
      genHistoryId: "gh1",
    });
    expect(p).toEqual({
      projectType: "Make a Song",
      title: "King - Crown",
      artistName: "King",
      songTitle: "Crown",
      genre: "Trap",
      mood: "Dark",
      inputData: { songTopic: "crown" },
      outputData: { result: "## FULL LYRICS\n…" },
      creditsUsed: 1,
      genHistoryId: "gh1",
    });
  });

  it("next-step hrefs are the pages' own rails", () => {
    expect(scheduleHrefForMedia("https://x/v.mp4", "video", "cap")).toContain("/scheduler?schedule=1");
    expect(scheduleHrefForMedia("https://x/v.mp4", "video", "cap")).toContain("mediaType=video");
    expect(distributeHrefForCover("https://x/c.png", "My Song")).toBe(
      "/distribute?cover=https%3A%2F%2Fx%2Fc.png&title=My%20Song",
    );
  });
});

describe("the jukebox gate + registry coverage (pins e, f)", () => {
  it("only track:<uuid> ids may ride jukebox.add", () => {
    expect(jukeboxTrackIdOf("track:123e4567-e89b-12d3-a456-426614174000")).toBe(
      "track:123e4567-e89b-12d3-a456-426614174000",
    );
    expect(jukeboxTrackIdOf("song:123")).toBeNull();
    expect(jukeboxTrackIdOf("https://x/a.mp3")).toBeNull();
    expect(jukeboxTrackIdOf(null)).toBeNull();
    expect(jukeboxTrackIdOf(undefined)).toBeNull();
  });

  it("all six create stations are registry pattern 'create' and known to the dispatch", () => {
    const createStations = PALACE_STATIONS.filter(
      (s) => s.panel.kind === "native" && s.panel.pattern === "create",
    );
    expect(createStations.map((s) => s.id).sort()).toEqual([
      "audio-desk",
      "cover-art-desk",
      "song-desk",
      "song-video-desk",
      "thumbnail-desk",
      "video-desk",
    ]);
    for (const s of createStations) expect(isCreateDeskId(s.id), s.id).toBe(true);
    expect(isCreateDeskId("jukebox")).toBe(false);
  });

  it("the follow-on log names the audio hub deep end + per-desk leftovers", () => {
    const items = CREATE_DESK_NATIVE_FOLLOWONS.map((f) => `${f.desk}: ${f.item}`);
    expect(items.some((i) => i.includes("full multi-tool audio workbench"))).toBe(true);
    for (const desk of ["song-desk", "video-desk", "song-video-desk", "cover-art-desk", "thumbnail-desk", "audio-desk"]) {
      expect(items.some((i) => i.startsWith(`${desk}:`)), desk).toBe(true);
    }
  });

  it("result excerpts trim long packages honestly", () => {
    expect(resultExcerpt("short")).toBe("short");
    const long = "x".repeat(700);
    const ex = resultExcerpt(long, 100);
    expect(ex.length).toBe(101);
    expect(ex.endsWith("…")).toBe(true);
  });
});
