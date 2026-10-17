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
});

describe("publish page short wiring (source)", () => {
  it("consumes ?short=1 into short intent", () => {
    expect(publishSource).toContain('params.get("short") === "1"');
    expect(publishSource).toContain("setShortIntent(true)");
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
