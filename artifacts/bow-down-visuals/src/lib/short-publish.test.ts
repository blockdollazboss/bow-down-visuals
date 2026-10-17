import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SHORT_MAX_DURATION_SEC,
  SHORTS_API_PATH,
  buildShortPostBody,
  duetEditorHref,
  postShortPublishHref,
  shortSoundEditorHref,
  stitchEditorHref,
} from "./short-publish";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const publishSource = read("../pages/publish.tsx");
const shortsSource = read("../pages/shorts.tsx");
const soundSource = read("../pages/sound.tsx");
const repurposeSource = read("../pages/repurpose.tsx");
const videoEditorSource = read("../pages/video-editor.tsx");

describe("postShortPublishHref — the 'post a short' deep link", () => {
  it("carries the short intent into the publish page", () => {
    const href = postShortPublishHref();
    expect(href.startsWith("/publish?")).toBe(true);
    const q = new URLSearchParams(href.split("?")[1]);
    expect(q.get("short")).toBe("1");
    expect(q.get("type")).toBe("video");
  });

  it("a sound-carrying href hands the reference to the publish page (and keeps the short intent)", () => {
    const href = postShortPublishHref({ soundId: "golden-hour-x1y2", soundTitle: "Golden Hour", soundUrl: "https://cdn/s.mp3" });
    const q = new URLSearchParams(href.split("?")[1]);
    expect(q.get("short")).toBe("1");
    expect(q.get("soundId")).toBe("golden-hour-x1y2");
    expect(q.get("soundTitle")).toBe("Golden Hour");
    expect(q.get("soundUrl")).toBe("https://cdn/s.mp3");
    const bare = new URLSearchParams(postShortPublishHref().split("?")[1]);
    expect(bare.get("soundId")).toBeNull();
  });

  it("both Shorts-page post buttons use it", () => {
    expect(shortsSource.match(/postShortPublishHref\(\)/g)).toHaveLength(2);
  });
});

describe("buildShortPostBody — the POST /api/shorts payload", () => {
  const base = {
    profileId: "11111111-2222-3333-4444-555555555555",
    title: "  Golden hour hook  ",
    videoUrl: "supabase://clips/v.mp4",
    publish: true,
  };

  it("builds the schema shape the shorts endpoint writes is_short from", () => {
    const body = buildShortPostBody({ ...base, thumbnailUrl: "https://cdn/x.jpg", tags: ["gold"], durationSec: 42 });
    expect(body).toEqual({
      profile_id: base.profileId,
      title: "Golden hour hook",
      video_url: base.videoUrl,
      thumbnail_url: "https://cdn/x.jpg",
      description: "",
      tags: ["gold"],
      duration_sec: 42,
      is_published: true,
    });
  });

  it("clamps duration into the endpoint's 0–180 window", () => {
    expect(buildShortPostBody({ ...base, durationSec: 999 }).duration_sec).toBe(SHORT_MAX_DURATION_SEC);
    expect(buildShortPostBody({ ...base, durationSec: -4 }).duration_sec).toBe(0);
    expect(buildShortPostBody({ ...base, durationSec: null }).duration_sec).toBe(0);
    expect(buildShortPostBody({ ...base, durationSec: 12.6 }).duration_sec).toBe(13);
  });

  it("caps tags at 30 × 40 chars and drops blanks", () => {
    const tags = Array.from({ length: 35 }, (_, i) => ` tag-${i} `);
    const body = buildShortPostBody({ ...base, tags: [...tags, "   ", "x".repeat(60)] });
    expect(body.tags).toHaveLength(30);
    expect((body.tags as string[])[0]).toBe("tag-0");
    const longOnly = buildShortPostBody({ ...base, tags: ["x".repeat(60)] });
    expect((longOnly.tags as string[])[0]).toHaveLength(40);
  });

  it("drafts ride the same body with is_published=false", () => {
    expect(buildShortPostBody({ ...base, publish: false }).is_published).toBe(false);
  });

  it("forwards a sound reference so the created short is stamped with its sound (0091 columns)", () => {
    const body = buildShortPostBody({
      ...base,
      soundId: "golden-hour-x1y2",
      soundTitle: "Golden Hour",
      soundUrl: "https://cdn/sound.mp3",
    });
    expect(body.sound_id).toBe("golden-hour-x1y2");
    expect(body.sound_title).toBe("Golden Hour");
    expect(body.sound_url).toBe("https://cdn/sound.mp3");
  });

  it("a title-only sound reference still rides (the server derives the sound id from it)", () => {
    const body = buildShortPostBody({ ...base, soundTitle: "  Loose Title  " });
    expect(body.sound_title).toBe("Loose Title");
    expect("sound_id" in body).toBe(false);
    expect("sound_url" in body).toBe(false);
  });

  it("no sound reference → no sound keys at all (the row's sound stays unrecorded, honestly)", () => {
    const body = buildShortPostBody({ ...base, soundId: "   ", soundTitle: null, soundUrl: undefined });
    expect("sound_id" in body).toBe(false);
    expect("sound_title" in body).toBe(false);
    expect("sound_url" in body).toBe(false);
  });

  it("clamps the sound reference to the endpoint's caps (id 80 / title 120)", () => {
    const body = buildShortPostBody({ ...base, soundId: "s".repeat(120), soundTitle: "t".repeat(200) });
    expect((body.sound_id as string)).toHaveLength(80);
    expect((body.sound_title as string)).toHaveLength(120);
  });
});

describe("publish page short wiring (source)", () => {
  it("consumes ?short=1 into short intent", () => {
    expect(publishSource).toContain('params.get("short") === "1"');
    expect(publishSource).toContain("setShortIntent(true)");
  });

  it("consumes a handed-over sound reference and stamps the fresh short with it", () => {
    expect(publishSource).toContain('params.get("soundId")');
    expect(publishSource).toContain("setShortSound({ id: pSoundId, title: pSoundTitle, url: pSoundUrl })");
    expect(publishSource).toContain("soundId: shortSound?.id, soundTitle: shortSound?.title, soundUrl: shortSound?.url");
  });

  it("a fresh short save posts to the shorts endpoint; the regular path stays on /api/publish", () => {
    expect(publishSource).toContain("SHORTS_API_PATH");
    expect(SHORTS_API_PATH).toBe("/api/shorts");
    expect(publishSource).toContain("buildShortPostBody");
    expect(publishSource).toContain("/api/publish/${endpoint}");
  });

  it("short success points at the Shorts feed, not the profile anchor", () => {
    expect(publishSource).toContain("/shorts?start=${publishedItem.itemId}");
    expect(publishSource).toContain("/shorts?start=${itemId}");
  });
});

describe("editor deep links (DE-12) — shapes the receivers actually consume", () => {
  it("duet lands on the Repurpose tab with video:<id>", () => {
    expect(duetEditorHref("abc-123")).toBe("/video-editor?tab=repurpose&duet=video:abc-123");
  });

  it("stitch lands on the Repurpose tab with video:<id>", () => {
    expect(stitchEditorHref("abc-123")).toBe("/video-editor?tab=repurpose&stitch=video:abc-123");
  });

  it("a short's sound uses the short:<sound_id> scheme, not a bare id", () => {
    expect(shortSoundEditorHref("my-title-x1y2")).toBe(
      "/video-editor?tab=repurpose&sound=short:my-title-x1y2",
    );
  });

  it("ids are URL-encoded", () => {
    expect(duetEditorHref("a b/c")).toContain("duet=video:a%20b%2Fc");
  });

  it("the Shorts rail and the sound page use the builders", () => {
    expect(shortsSource).toContain("duetEditorHref(item.id)");
    expect(shortsSource).toContain("stitchEditorHref(item.id)");
    expect(shortsSource).toContain("shortSoundEditorHref(item.sound.id)");
    expect(soundSource).toContain("shortSoundEditorHref(data.sound.id)");
  });

  it("no bare editor links remain on those surfaces", () => {
    expect(shortsSource).not.toContain("/video-editor?duet=${");
    expect(shortsSource).not.toContain("/video-editor?stitch=${");
    expect(shortsSource).not.toContain("/video-editor?sound=${");
    expect(soundSource).not.toContain("/video-editor?sound=${");
  });

  it("the Repurpose tab consumes ?stitch= as a first-class mode", () => {
    expect(repurposeSource).toContain('search.get("stitch")');
    expect(repurposeSource).toContain("setLinkMode(mode)");
    expect(repurposeSource).toContain("repurpose.stitchLoaded");
  });

  it("the editor resolves the short: sound scheme through the sounds API", () => {
    expect(videoEditorSource).toContain("/^short:(.+)$/");
    expect(videoEditorSource).toContain("/api/sounds/${encodeURIComponent(shortMatch[1])}");
    expect(videoEditorSource).toContain("shortSoundNoAudioDesc");
  });
});
