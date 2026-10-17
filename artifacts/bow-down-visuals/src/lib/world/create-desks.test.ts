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
  buildMusicAudioPayload,
  buildPublishTrackPayload,
  interpretJobPoll,
  interpretTaskPoll,
  isCreateDeskId,
  jukeboxTrackIdOf,
  musicAudioCost,
  profileIdOfProfilesResponse,
  publishedTrackIdOfResponse,
  resultExcerpt,
  songMusicPromptOf,
  SONG_AUDIO_LENGTH_SECONDS,
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

describe("the publish rail — Ring 2 items 2.1 + 2.2 (pin g)", () => {
  const PACKAGE = [
    "## SONG CONCEPT",
    "A crown anthem.",
    "",
    "## BEST SONG TITLE",
    "Heavy Crown",
    "",
    "## FULL LYRICS",
    "Verse one lines",
    "",
    "## AI MUSIC PROMPT",
    "Dark trap, 140 BPM, heavy 808s",
    "",
    "## COVER ART PROMPT",
    "Gold on black",
  ].join("\n");
  const TRACK_UUID = "123e4567-e89b-12d3-a456-426614174000";

  it("music audio price is the server's duration tiers, from the registry base", () => {
    const base = getCreditCost("/api/generate-music-audio")!.cost;
    expect(base).toBe(400);
    expect(musicAudioCost(30)).toBe(base);
    expect(musicAudioCost(60)).toBe(base);
    expect(musicAudioCost(120)).toBe(base * 2);
    expect(musicAudioCost(180)).toBe(base * 2);
    expect(musicAudioCost(240)).toBe(base * 3);
    /* The desk's default length is the route's own 60s default tier. */
    expect(SONG_AUDIO_LENGTH_SECONDS).toBe(60);
    expect(musicAudioCost()).toBe(400);
  });

  it("the audio payload is GenerationResult's step: music prompt + package lyrics", () => {
    expect(songMusicPromptOf(PACKAGE)).toBe("Dark trap, 140 BPM, heavy 808s");
    expect(
      buildMusicAudioPayload({ rawResult: PACKAGE, artistName: " King ", songTitle: "Heavy Crown" }),
    ).toEqual({
      prompt: "Dark trap, 140 BPM, heavy 808s",
      lyrics: "Verse one lines",
      artistName: "King",
      songTitle: "Heavy Crown",
      lengthSeconds: SONG_AUDIO_LENGTH_SECONDS,
    });
    /* No music prompt in the package → no payload, honestly null. */
    expect(songMusicPromptOf("## FULL LYRICS\nwords only")).toBeNull();
    expect(buildMusicAudioPayload({ rawResult: "## FULL LYRICS\nwords only" })).toBeNull();
  });

  it("the publish payload is the /publish page's audio save body, published", () => {
    expect(
      buildPublishTrackPayload({
        profileId: "prof-1",
        title: " Heavy Crown ",
        audioUrl: "https://cdn/x.mp3",
        genre: "Trap",
        durationSec: 60,
      }),
    ).toEqual({
      profile_id: "prof-1",
      title: "Heavy Crown",
      audio_url: "https://cdn/x.mp3",
      genre: "Trap",
      category: "music",
      tags: [],
      duration_sec: 60,
      download_price_cents: 0,
      is_published: true,
    });
    /* Blank genre/duration ride undefined, exactly as the page omits them. */
    const bare = buildPublishTrackPayload({ profileId: "p", title: "T", audioUrl: "u" });
    expect(bare.genre).toBeUndefined();
    expect(bare.duration_sec).toBeUndefined();
    expect(bare.is_published).toBe(true);
  });

  it("the profile id reads every shape GET /api/creator-profiles answers", () => {
    expect(profileIdOfProfilesResponse([{ id: "a" }, { id: "b" }])).toBe("a");
    expect(profileIdOfProfilesResponse({ profiles: [{ id: "c" }] })).toBe("c");
    expect(profileIdOfProfilesResponse({ id: "d" })).toBe("d");
    /* No profile yet → null: the desk must say so, never invent one. */
    expect(profileIdOfProfilesResponse([])).toBeNull();
    expect(profileIdOfProfilesResponse({ profiles: [] })).toBeNull();
    expect(profileIdOfProfilesResponse(null)).toBeNull();
    expect(profileIdOfProfilesResponse("nope")).toBeNull();
  });

  it("only a real publish response lights the jukebox chip (2.2's gate)", () => {
    expect(publishedTrackIdOfResponse({ track: { id: TRACK_UUID } })).toBe(`track:${TRACK_UUID}`);
    /* A response without a uuid track id is NOT a publish the room
       can play — the chip stays dark and the desk says so. */
    expect(publishedTrackIdOfResponse({ track: { id: 42 } })).toBeNull();
    expect(publishedTrackIdOfResponse({ track: {} })).toBeNull();
    expect(publishedTrackIdOfResponse({})).toBeNull();
    expect(publishedTrackIdOfResponse(null)).toBeNull();
  });
});

describe("Ring 2 Create Wing depth — storyboard / wizard / song tabs / thumbnails / cover / quests", () => {
  it("2.3 storyboard costs are the registry's, and the step machine only advances on server truth", async () => {
    const { analyzeSectionsCost, transcribeCost, aiEditPlanCost, storyboardStepOf, buildAnalyzeSectionsPayload, buildStoryboardDraftPayload, buildStoryboardProjectPayload, withSceneApproval, withSceneClip } = await import("./create-desks");
    expect(analyzeSectionsCost()).toBe(getCreditCost("/api/analyze-sections")!.cost);
    expect(transcribeCost()).toBe(getCreditCost("/api/transcribe")!.cost);
    expect(aiEditPlanCost()).toBe(getCreditCost("/api/generate/ai-edit-plan")!.cost);
    expect(buildAnalyzeSectionsPayload("words")).toEqual({ lyrics: "words" });
    const base = { hasLyrics: false, hasStructure: false, sceneCount: 0, decidedCount: 0, approvedCount: 0, clippedApprovedCount: 0 };
    expect(storyboardStepOf(base)).toBe("intake");
    expect(storyboardStepOf({ ...base, hasLyrics: true })).toBe("analysis");
    expect(storyboardStepOf({ ...base, hasLyrics: true, hasStructure: true })).toBe("scenes");
    expect(storyboardStepOf({ ...base, hasLyrics: true, hasStructure: true, sceneCount: 2 })).toBe("review");
    expect(storyboardStepOf({ ...base, hasLyrics: true, hasStructure: true, sceneCount: 2, decidedCount: 2, approvedCount: 1 })).toBe("clips");
    expect(storyboardStepOf({ ...base, hasLyrics: true, hasStructure: true, sceneCount: 2, decidedCount: 2, approvedCount: 1, clippedApprovedCount: 1 })).toBe("done");
    const scenes = [{ id: "a", approved: false, demoClipUrl: null as string | null, generationStatus: null as string | null }];
    const approved = withSceneApproval(scenes, "a", true);
    expect(approved[0]!.approved).toBe(true);
    expect(scenes[0]!.approved).toBe(false); // immutable
    expect(withSceneClip(approved, "a", "https://x/c.mp4")[0]).toMatchObject({ demoClipUrl: "https://x/c.mp4", generationStatus: "completed" });
    const draft = buildStoryboardDraftPayload({ title: "T", formValues: { lyrics: "x" }, rawResult: "r", scenes: [{}], songStructure: { sections: [] } });
    expect(draft.workflowType).toBe("make-video");
    const proj = buildStoryboardProjectPayload({ title: "T", inputData: {}, resultText: "r", songStructure: { sections: [] }, scenes: [{ id: "a" }] });
    expect(proj.projectType).toBe("Make a Music Video");
    expect((proj.outputData as Record<string, unknown>)["scenes"]).toEqual([{ id: "a" }]);
  });

  it("2.4 wizard: transcript + edit-plan + project payloads mirror song-and-video.tsx", async () => {
    const { transcriptOfResponse, buildAiEditPlanPayload, aiEditPlanOfResponse, buildSongVideoProjectPayload } = await import("./create-desks");
    expect(transcriptOfResponse({ transcript: "la la" })).toBe("la la");
    expect(transcriptOfResponse({})).toBeNull();
    const p = buildAiEditPlanPayload({ style: "s", styleName: "S", scenes: [{ section: "Hook", lyricLine: "line", action: "jump", mood: "bright" }, {}], audioFound: true, captionStyle: "bold", currentEffects: {}, artistName: "K", lyricsText: "la" });
    expect(p.sceneDescriptions).toEqual(["Hook · line · jump · bright", "Scene 2"]);
    expect(p.sceneCount).toBe(2);
    expect(aiEditPlanOfResponse({ plan: { transitions: [] } })).toEqual({ transitions: [] });
    expect(aiEditPlanOfResponse({})).toBeNull();
    const proj = buildSongVideoProjectPayload({ title: "T", genre: "Hip Hop", mood: "Energetic", inputData: {}, resultText: "r", scenes: [], editorSettings: { aiEdit: {} } });
    expect(proj.projectType).toBe("Make Song + Video");
    expect((proj.outputData as Record<string, unknown>)["editorSettings"]).toEqual({ aiEdit: {} });
  });

  it("2.5 song tabs: inspo/mashup/hum payloads + costs + vault loading mirror the page tabs", async () => {
    const m = await import("./create-desks");
    expect(m.inspoAnalyzeCost()).toBe(0);
    expect(m.inspoGenerateCost()).toBe(getCreditCost("/api/song-inspo/generate")!.cost);
    expect(m.mashupCost()).toBe(getCreditCost("/api/mashup")!.cost);
    expect(m.humToSongCost()).toBe(getCreditCost("/api/hum-to-song")!.cost);
    expect(m.buildInspoAnalyzePayload(" vibe ", " n ")).toEqual({ playlistInput: "vibe", notes: "n" });
    expect(m.buildInspoGeneratePayload({ styleDna: { genre: "Trap" }, artistName: " K " })).toEqual({ styleDna: { genre: "Trap" }, notes: "", artistName: "K", songTitle: "" });
    expect(m.styleDnaOfResponse({ styleDna: { genre: "Trap" } })).toEqual({ genre: "Trap" });
    expect(m.styleDnaOfResponse({})).toBeNull();
    expect(m.buildMashupPayload({ songAId: "a", songBId: "b", style: "blend", balance: 50, crossfadeSec: 4 })).toEqual({ songA: { songId: "a" }, songB: { songId: "b" }, style: "blend", balance: 50, crossfadeSec: 4 });
    expect(m.buildMashupPayload({ songAId: "a", songBId: "b", style: "blend", balance: 50, crossfadeSec: 4, mode: "custom", blendPct: 25, durationA: 200, title: " M " })).toMatchObject({ blendPointSec: 50, title: "M" });
    expect(m.mashupResultOfResponse({ song: { audio_url: "https://x/m.mp3", title: "M" } })).toEqual({ audioUrl: "https://x/m.mp3", title: "M" });
    expect(m.mashupResultOfResponse({})).toBeNull();
    expect(m.humAnalyzeFields()).toEqual([["analyzeOnly", "true"]]);
    expect(m.humGenerateFields({ humRef: "r1", mode: "custom", stylePrompt: "dark", instrumental: true, songTitle: "T" })).toEqual([["humRef", "r1"], ["mode", "custom"], ["stylePrompt", "dark"], ["instrumental", "true"], ["songTitle", "T"]]);
    expect(m.humGenerateFields({ humRef: "r1", mode: "simple", stylePrompt: "dark" })).toEqual([["humRef", "r1"], ["mode", "simple"]]);
    expect(m.humAnalysisOfResponse({ humRef: "r", analysis: { tempoBpm: 90 } })).toMatchObject({ humRef: "r" });
    expect(m.humAnalysisOfResponse({ humRef: "r" })).toBeNull(); // incomplete analysis refused, like the page
    expect(m.vaultsOfResponse({ vaults: [{ id: "v1", artist_name: "King" }, { id: 3 }] })).toEqual([{ id: "v1", artistName: "King" }]);
    expect(m.withArtistVault({ artistVault: null }, { id: "v1" })).toEqual({ artistVault: { id: "v1" } });
  });

  it("2.9+2.10 thumbnail benches: costs from registry, maker fields, variants, CTR truthfulness", async () => {
    const m = await import("./create-desks");
    expect(m.thumbnailGeneratorCost()).toBe(getCreditCost("/api/thumbnail-generator")!.cost);
    expect(m.thumbnailVariantsCost()).toBe(getCreditCost("/api/wave8/thumbnail-ab/variants")!.cost);
    expect(m.thumbnailTestCost()).toBe(getCreditCost("/api/thumbnail-test")!.cost);
    expect(m.thumbnailImproveCost()).toBe(getCreditCost("/api/thumbnail-test/improve")!.cost);
    expect(m.thumbnailGeneratorFields({ prompt: " shout ", stylePreset: "bold-text-pop", aspectRatio: "16:9", overlayText: " NEW ", attribution: true })).toEqual([["prompt", "shout"], ["stylePreset", "bold-text-pop"], ["aspectRatio", "16:9"], ["overlayText", "NEW"], ["attribution", "true"]]);
    expect(m.thumbnailImagesOfResponse({ images: [{ url: "u1", variation: "a" }, { variation: "b" }] })).toEqual([{ url: "u1", variation: "a" }]);
    expect(m.buildThumbnailVariantsPayload({ sourceImageUrl: "u", title: "x".repeat(300), niche: "music" }).title).toHaveLength(200);
    expect(m.thumbnailVariantsOfResponse({ variants: [{ url: "v1", label: "Bold", prompt: "p" }] })).toEqual([{ url: "v1", label: "Bold", prompt: "p" }]);
    const ctr = m.ctrPredictionOfResponse({ result: { winnerIndex: 1, confidence: 82, reasoning: "r", disclaimer: "d", analyses: [{ scores: { overall: 40 } }, { scores: { overall: 91 } }] } });
    expect(ctr).toEqual({ winnerIndex: 1, confidence: 82, reasoning: "r", disclaimer: "d", overallScores: [40, 91] });
    expect(m.ctrPredictionOfResponse({ result: {} })).toBeNull();
    expect(m.ctrPredictionOfResponse(null)).toBeNull();
  });

  it("2.11 cover rails: presets are the page's grid, attribution rides the payload, showcase/share builders", async () => {
    const m = await import("./create-desks");
    expect(m.COVER_ART_PRESETS.map((p) => p.style)).toEqual(["luxury-gold", "dark-moody", "vibrant-pop", "cinematic"]);
    expect(m.buildCoverArtPayload("mood", { songTitle: "T", artistName: "A", style: "retro", aspectRatio: "1:1", tier: "standard", attribution: true }).attribution).toBe(true);
    expect(m.buildShowcasePublishPayload({ title: " T ", mediaType: "image", mediaUrl: "u", thumbnailUrl: "u" })).toEqual({ title: "T", description: "", mediaType: "image", mediaUrl: "u", thumbnailUrl: "u", creatorName: undefined });
    expect(m.showcaseSlugOfResponse({ item: { slug: "my-cover" } })).toBe("my-cover");
    expect(m.showcaseSlugOfResponse({})).toBeNull();
    expect(m.buildShareTrackPayload({ contentType: "image", channel: "copy" })).toEqual({ content_type: "image", content_id: null, channel: "copy" });
  });

  it("§5(a) quest chip: only a server diff earns a chip — completion, progress, and the silent cases", async () => {
    const m = await import("./create-desks");
    const q = (key: string, progress: number, target: number, completed = false) => ({ key, target, reward: 80, progress, completed, claimed: false });
    const before = [q("generate-song", 0, 1), q("make-thumbnail", 1, 2)];
    // completed by this job
    const done = m.questAdvancesBetween(before, [q("generate-song", 1, 1, true), q("make-thumbnail", 1, 2)]);
    expect(done).toEqual([{ key: "generate-song", title: "Generate a song", progress: 1, target: 1, completedNow: true }]);
    expect(m.questChipLine(done[0]!)).toContain("That finished your quest");
    expect(m.questChipLine(done[0]!)).toContain("Claim it at the Treasury");
    // advanced but not completed
    const adv = m.questAdvancesBetween(before, [q("generate-song", 0, 1), q("make-thumbnail", 2, 2, true)]);
    expect(adv[0]!.completedNow).toBe(true);
    const prog = m.questAdvancesBetween([q("make-thumbnail", 0, 2)], [q("make-thumbnail", 1, 2)]);
    expect(m.questChipLine(prog[0]!)).toContain("1 of 2");
    // NO-QUEST case: nothing moved → no chip; no before snapshot → no chip (unprovable)
    expect(m.questAdvancesBetween(before, before)).toEqual([]);
    expect(m.questAdvancesBetween(null, [q("generate-song", 1, 1, true)])).toEqual([]);
    expect(m.questsOfResponse({ quests: [q("generate-song", 0, 1), { bad: true }] })).toHaveLength(1);
    expect(m.questsOfResponse(null)).toEqual([]);
  });
});
