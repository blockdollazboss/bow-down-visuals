import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCreditCost } from "../credit-costs";
import { PUBLISH_VERTICALS } from "../publish-protocol";
import {
  EMPTY_PUBLISH_DRAFT,
  PUBLISH_ARTWORK_MAX_BYTES,
  PUBLISH_DESCRIPTION_MAX,
  PUBLISH_GENRES,
  PUBLISH_ISRC_MAX,
  PUBLISH_MAX_TAGS,
  PUBLISH_PROFILES_PATH,
  PUBLISH_TITLE_MAX,
  PUBLISH_TRACKS_PATH,
  PUBLISH_TRACK_PATH,
  PUBLISH_UPLOAD_MAX_BYTES,
  PUBLISH_UPLOAD_PATH,
  PUBLISH_VIDEOS_PATH,
  PUBLISH_VIDEO_PATH,
  buildPublishStateBody,
  buildTrackPayload,
  buildVideoPayload,
  draftForVertical,
  draftOfItem,
  parsePublishProfiles,
  parsePublishTracks,
  parsePublishVideos,
  priceCentsOfDollarsInput,
  publishArtworkFileError,
  publishCollectionPath,
  publishDurationLabel,
  publishDraftError,
  publishItemOfSaveResponse,
  publishItemPath,
  publishKindForVertical,
  publishMediaFileError,
  publishPriceLabel,
  publishTrackPath,
  publishUploadKindFor,
  publishUploadOfResponse,
  publishVideoPath,
  withPublishItemState,
  withoutPublishItem,
  type PublishDraft,
  type PublishItem,
} from "./publish-desk";

const routeSrc = readFileSync(
  resolve(process.cwd(), "../api-server/src/routes/publish.ts"),
  "utf-8",
);
const pageSrc = readFileSync(resolve(process.cwd(), "src/pages/publish.tsx"), "utf-8");

function trackRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "t1",
    profile_id: "p1",
    title: "Midnight Run",
    audio_url: "https://cdn.example/run.mp3",
    artwork_url: "https://cdn.example/run.jpg",
    genre: "Trap",
    tags: ["music", "trap"],
    isrc: "USRC10000001",
    duration_sec: 187,
    download_price_cents: 499,
    is_published: true,
    ...over,
  };
}

function videoRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "v1",
    profile_id: "p1",
    title: "Studio Day",
    video_url: "https://cdn.example/day.mp4",
    thumbnail_url: "https://cdn.example/day.jpg",
    duration_sec: 65,
    description: "Behind the scenes",
    is_published: false,
    season: 1,
    episode: 3,
    thumbnail_alt_text: "The studio at dawn",
    ...over,
  };
}

describe("publish-desk — the rails are the API's own (stack1600 wave 4, desk #99)", () => {
  it("every seam path is a route the API actually registers", () => {
    for (const frag of [
      'router.post("/upload"',
      'router.post("/track"',
      'router.get("/tracks"',
      'router.put("/track/:id"',
      'router.delete("/track/:id"',
      'router.post("/video"',
      'router.get("/videos"',
      'router.put("/video/:id"',
      'router.delete("/video/:id"',
    ]) {
      expect(routeSrc, frag).toContain(frag);
    }
    expect(PUBLISH_TRACKS_PATH).toBe("/api/publish/tracks");
    expect(PUBLISH_VIDEOS_PATH).toBe("/api/publish/videos");
    expect(PUBLISH_UPLOAD_PATH).toBe("/api/publish/upload");
    expect(PUBLISH_PROFILES_PATH).toBe("/api/creator-profiles");
    expect(publishCollectionPath("track")).toBe("/api/publish/track");
    expect(publishCollectionPath("video")).toBe("/api/publish/video");
    expect(publishTrackPath("a b")).toBe("/api/publish/track/a%20b");
    expect(publishVideoPath("v9")).toBe("/api/publish/video/v9");
    expect(publishItemPath({ kind: "track", id: "t1" })).toBe(PUBLISH_TRACK_PATH + "/t1");
    expect(publishItemPath({ kind: "video", id: "v1" })).toBe(PUBLISH_VIDEO_PATH + "/v1");
  });

  it("the rail charges nothing — no chargeCredits, no registry rows for /api/publish/*", () => {
    expect(routeSrc).toContain("uploading/publishing is FREE");
    expect(routeSrc).not.toContain("chargeCredits");
    expect(routeSrc).not.toContain("CREDIT_COSTS");
    for (const path of [
      "/api/publish/track",
      "/api/publish/video",
      "/api/publish/tracks",
      "/api/publish/videos",
      "/api/publish/upload",
    ]) {
      expect(getCreditCost(path) ?? undefined, path).toBeUndefined();
    }
    // The priced neighbours are different rails — the desk never
    // quotes them and never calls them free.
    expect(getCreditCost("/api/album-publish")?.cost).toBe(300);
    expect(getCreditCost("/api/social/instagram/publish")?.cost).toBe(100);
  });

  it("the seam's bounds are the rail's caps, read from the route source", () => {
    expect(routeSrc).toContain("80 * 1024 * 1024");
    expect(PUBLISH_UPLOAD_MAX_BYTES).toBe(80 * 1024 * 1024);
    expect(routeSrc).toContain("10 * 1024 * 1024");
    expect(PUBLISH_ARTWORK_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(routeSrc).toContain('cleanStr(b["title"], 160)');
    expect(PUBLISH_TITLE_MAX).toBe(160);
    expect(routeSrc).toContain('cleanStr(b["genre"], 60)');
    expect(routeSrc).toContain('cleanStr(b["isrc"], 32)');
    expect(PUBLISH_ISRC_MAX).toBe(32);
    expect(routeSrc).toContain('cleanStr(b["description"], 2000)');
    expect(PUBLISH_DESCRIPTION_MAX).toBe(2000);
    expect(routeSrc).toContain(".slice(0, 12)");
    expect(PUBLISH_MAX_TAGS).toBe(12);
  });

  it("the genre list is the page's picker list", () => {
    const m = pageSrc.match(/const GENRES = \[([\s\S]*?)\];/);
    if (!m) throw new Error("could not find GENRES in the publish page");
    const pageGenres = [...m[1].matchAll(/"([^"]+)"/g)].map((g) => g[1]);
    expect([...PUBLISH_GENRES]).toEqual(pageGenres);
  });

  it("verticals come from the shared publish protocol, with the page's kind split", () => {
    expect(PUBLISH_VERTICALS).toContain("music");
    expect(publishKindForVertical("music")).toBe("track");
    expect(publishKindForVertical("podcast")).toBe("track");
    expect(publishKindForVertical("education")).toBe("track");
    expect(publishKindForVertical("video")).toBe("video");
    expect(publishKindForVertical("film")).toBe("video");
    expect(publishKindForVertical("tv")).toBe("video");
    expect(publishKindForVertical("other")).toBe("video");
  });
});

describe("publish-desk — profiles in every shape the rail reader accepts", () => {
  it("parses array, { profiles }, and single-object answers", () => {
    const row = { id: "p1", slug: "king", display_name: "King" };
    expect(parsePublishProfiles([row])).toEqual([{ id: "p1", slug: "king", displayName: "King" }]);
    expect(parsePublishProfiles({ profiles: [row] })).toHaveLength(1);
    expect(parsePublishProfiles(row)).toHaveLength(1);
    expect(parsePublishProfiles(null)).toEqual([]);
    expect(parsePublishProfiles({ nope: true })).toEqual([]);
    expect(parsePublishProfiles([{ slug: "no-id" }, row])).toHaveLength(1);
  });
});

describe("publish-desk — row parsers with drift discipline", () => {
  it("parses a track row field for field", () => {
    const [item] = parsePublishTracks({ tracks: [trackRow()] });
    expect(item).toEqual({
      id: "t1",
      kind: "track",
      profileId: "p1",
      title: "Midnight Run",
      mediaUrl: "https://cdn.example/run.mp3",
      artworkUrl: "https://cdn.example/run.jpg",
      isPublished: true,
      genre: "Trap",
      tags: ["music", "trap"],
      isrc: "USRC10000001",
      durationSec: 187,
      downloadPriceCents: 499,
      description: null,
      season: null,
      episode: null,
      thumbnailAltText: null,
    });
  });

  it("parses a video row field for field", () => {
    const [item] = parsePublishVideos({ videos: [videoRow()] });
    expect(item?.kind).toBe("video");
    expect(item?.mediaUrl).toBe("https://cdn.example/day.mp4");
    expect(item?.artworkUrl).toBe("https://cdn.example/day.jpg");
    expect(item?.isPublished).toBe(false);
    expect(item?.season).toBe(1);
    expect(item?.episode).toBe(3);
    expect(item?.thumbnailAltText).toBe("The studio at dawn");
    expect(item?.downloadPriceCents).toBeNull();
  });

  it("drops rows with no id or no media URL — never dresses them up", () => {
    expect(parsePublishTracks({ tracks: [trackRow({ id: "" }), trackRow({ audio_url: "" })] })).toEqual([]);
    expect(parsePublishVideos({ videos: [videoRow({ id: null }), videoRow({ video_url: 42 })] })).toEqual([]);
    expect(parsePublishTracks({})).toEqual([]);
    expect(parsePublishTracks(null)).toEqual([]);
    expect(parsePublishVideos({ videos: "nope" })).toEqual([]);
  });

  it("a titleless row reads Untitled; is_published is strict-true only", () => {
    const [a] = parsePublishTracks({ tracks: [trackRow({ title: "", is_published: 1 })] });
    expect(a?.title).toBe("Untitled");
    expect(a?.isPublished).toBe(false);
    const [b] = parsePublishTracks({ tracks: [trackRow({ tags: ["ok", 5, null] })] });
    expect(b?.tags).toEqual(["ok"]);
  });

  it("a save response yields its row — or null when the answer drifted", () => {
    expect(publishItemOfSaveResponse("track", { track: trackRow() })?.id).toBe("t1");
    expect(publishItemOfSaveResponse("video", { video: videoRow() })?.id).toBe("v1");
    expect(publishItemOfSaveResponse("track", { track: { id: "x" } })).toBeNull();
    expect(publishItemOfSaveResponse("track", {})).toBeNull();
    expect(publishItemOfSaveResponse("video", null)).toBeNull();
  });
});

describe("publish-desk — the composer draft", () => {
  it("draftOfItem round-trips a track and a video", () => {
    const [t] = parsePublishTracks({ tracks: [trackRow()] });
    const td = draftOfItem(t!);
    expect(td.kind).toBe("track");
    expect(td.category).toBe("music"); // tags[0] is the stamped category
    expect(td.title).toBe("Midnight Run");
    expect(td.priceDollars).toBe("4.99");
    expect(td.publishNow).toBe(true);
    const [v] = parsePublishVideos({ videos: [videoRow()] });
    const vd = draftOfItem(v!);
    expect(vd.kind).toBe("video");
    expect(vd.category).toBe("video"); // no category tag → the kind's home vertical
    expect(vd.season).toBe("1");
    expect(vd.episode).toBe("3");
    expect(vd.thumbnailAltText).toBe("The studio at dawn");
    expect(vd.publishNow).toBe(false);
  });

  it("picking a vertical flips the kind like the page picker — music→track, film→video", () => {
    expect(draftForVertical(EMPTY_PUBLISH_DRAFT, "film").kind).toBe("video");
    expect(draftForVertical(EMPTY_PUBLISH_DRAFT, "podcast").kind).toBe("track");
    expect(draftForVertical(EMPTY_PUBLISH_DRAFT, "gaming").category).toBe("gaming");
  });

  it("validation speaks in the rail's terms", () => {
    const ok: PublishDraft = { ...EMPTY_PUBLISH_DRAFT, title: "Song", mediaUrl: "https://x/a.mp3" };
    expect(publishDraftError(ok, { hasFile: false, editing: false })).toBeNull();
    expect(publishDraftError(EMPTY_PUBLISH_DRAFT, { hasFile: false, editing: false })).toMatch(/title/i);
    expect(
      publishDraftError({ ...EMPTY_PUBLISH_DRAFT, title: "Song" }, { hasFile: false, editing: false }),
    ).toMatch(/audio file/i);
    expect(
      publishDraftError(
        { ...EMPTY_PUBLISH_DRAFT, title: "Song", kind: "video" },
        { hasFile: false, editing: false },
      ),
    ).toMatch(/video file/i);
    // An edit with no file and no link still saves (the rail keeps its media).
    expect(
      publishDraftError({ ...EMPTY_PUBLISH_DRAFT, title: "Song" }, { hasFile: false, editing: true }),
    ).toBeNull();
    // A picked file satisfies a create on its own.
    expect(
      publishDraftError({ ...EMPTY_PUBLISH_DRAFT, title: "Song" }, { hasFile: true, editing: false }),
    ).toBeNull();
    expect(
      publishDraftError({ ...ok, tagsInput: Array(13).fill("t").join(",") }, { hasFile: false, editing: false }),
    ).toMatch(/12 tags/);
    expect(
      publishDraftError({ ...ok, season: "0" }, { hasFile: false, editing: false }),
    ).toMatch(/Season/);
    expect(
      publishDraftError({ ...ok, episode: "0" }, { hasFile: false, editing: false }),
    ).toMatch(/Episode/);
    expect(
      publishDraftError({ ...ok, episode: "abc" }, { hasFile: false, editing: false }),
    ).toMatch(/Episode/);
    expect(
      publishDraftError({ ...ok, season: "2", episode: "5" }, { hasFile: false, editing: false }),
    ).toBeNull();
  });

  it("the member's download price: typed dollars → the page's cents math", () => {
    expect(priceCentsOfDollarsInput("4.99")).toBe(499);
    expect(priceCentsOfDollarsInput("")).toBe(0);
    expect(priceCentsOfDollarsInput("-3")).toBe(0);
    expect(priceCentsOfDollarsInput("abc")).toBe(0);
    expect(publishPriceLabel(499)).toBe("$4.99 download");
    expect(publishPriceLabel(0)).toBe("Free download");
    expect(publishPriceLabel(null)).toBe("Free download");
  });
});

describe("publish-desk — page-exact save bodies", () => {
  const draft: PublishDraft = {
    ...EMPTY_PUBLISH_DRAFT,
    title: "  Midnight Run  ",
    genre: "Trap",
    tagsInput: "music, trap ,night",
    isrc: "USRC10000001",
    priceDollars: "4.99",
    publishNow: true,
  };

  it("track body matches the page's object, field for field", () => {
    expect(buildTrackPayload(draft, "p1", "ref-audio", "ref-art", 187)).toEqual({
      profile_id: "p1",
      title: "Midnight Run",
      audio_url: "ref-audio",
      artwork_url: "ref-art",
      genre: "Trap",
      category: "music",
      tags: ["music", "trap", "night"],
      isrc: "USRC10000001",
      duration_sec: 187,
      download_price_cents: 499,
      is_published: true,
    });
  });

  it("video body matches the page's object, incl. alt-text semantics", () => {
    const vd: PublishDraft = {
      ...EMPTY_PUBLISH_DRAFT,
      kind: "video",
      category: "tv",
      title: "Studio Day",
      description: "  Behind the scenes ",
      season: "1",
      episode: "3",
      thumbnailAltText: "",
    };
    // Create: blank alt text is omitted.
    const created = buildVideoPayload(vd, "p1", "ref-video", null, 65, false);
    expect(created.thumbnail_alt_text).toBeUndefined();
    expect(created).toMatchObject({
      profile_id: "p1",
      video_url: "ref-video",
      thumbnail_url: null,
      category: "tv",
      duration_sec: 65,
      description: "Behind the scenes",
      is_published: false,
      season: 1,
      episode: 3,
    });
    // Edit: the field rides verbatim — "" clears, per the rail's CASE.
    const edited = buildVideoPayload(vd, "p1", "ref-video", null, 65, true);
    expect(edited.thumbnail_alt_text).toBe("");
  });

  it("the publish-state toggle sends exactly one field", () => {
    expect(buildPublishStateBody(true)).toEqual({ is_published: true });
    expect(buildPublishStateBody(false)).toEqual({ is_published: false });
  });
});

describe("publish-desk — uploads", () => {
  it("kind derivation is the rail's own (audio/video/image→artwork, else refused)", () => {
    expect(routeSrc).toContain('file.mimetype.startsWith("audio/")');
    expect(publishUploadKindFor("audio/mpeg")).toBe("audio");
    expect(publishUploadKindFor("video/mp4")).toBe("video");
    expect(publishUploadKindFor("image/png")).toBe("artwork");
    expect(publishUploadKindFor("application/pdf")).toBeNull();
  });

  it("pre-flight stops the files the rail would refuse, in the page's words", () => {
    const MB = 1024 * 1024;
    expect(publishMediaFileError({ type: "audio/mpeg", size: 5 * MB }, "track")).toBeNull();
    expect(publishMediaFileError({ type: "video/mp4", size: 5 * MB }, "track")).toMatch(/audio file/i);
    expect(publishMediaFileError({ type: "audio/mpeg", size: 5 * MB }, "video")).toMatch(/video file/i);
    expect(publishMediaFileError({ type: "video/mp4", size: 81 * MB }, "video")).toMatch(/80 MB/);
    expect(publishMediaFileError({ type: "text/plain", size: 10 }, "track")).toMatch(/audio file/i);
    expect(publishArtworkFileError({ type: "image/webp", size: 2 * MB })).toBeNull();
    expect(publishArtworkFileError({ type: "image/png", size: 11 * MB })).toMatch(/10 MB/);
    expect(publishArtworkFileError({ type: "audio/mpeg", size: 10 })).toMatch(/image/i);
  });

  it("an upload answer yields { url, ref } — the ref is what a save stores", () => {
    expect(publishUploadOfResponse({ url: "https://signed/x", ref: "publish/u/audio/x.mp3" })).toEqual({
      url: "https://signed/x",
      ref: "publish/u/audio/x.mp3",
    });
    expect(publishUploadOfResponse({ url: "https://signed/x" })).toEqual({
      url: "https://signed/x",
      ref: null,
    });
    expect(publishUploadOfResponse({ ref: "x" })).toBeNull();
    expect(publishUploadOfResponse(null)).toBeNull();
  });
});

describe("publish-desk — list helpers and labels", () => {
  const items: PublishItem[] = parsePublishTracks({
    tracks: [trackRow(), trackRow({ id: "t2", is_published: false })],
  });

  it("state flips and removals are surgical", () => {
    const flipped = withPublishItemState(items, "t2", true);
    expect(flipped.find((i) => i.id === "t2")?.isPublished).toBe(true);
    expect(flipped.find((i) => i.id === "t1")?.isPublished).toBe(true);
    expect(withoutPublishItem(items, "t1").map((i) => i.id)).toEqual(["t2"]);
    expect(items).toHaveLength(2); // originals untouched
  });

  it("duration labels read like a player", () => {
    expect(publishDurationLabel(187)).toBe("3:07");
    expect(publishDurationLabel(65)).toBe("1:05");
    expect(publishDurationLabel(0)).toBe("0:00");
    expect(publishDurationLabel(null)).toBe("");
  });
});
