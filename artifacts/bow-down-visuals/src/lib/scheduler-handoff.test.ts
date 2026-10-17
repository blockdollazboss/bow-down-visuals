import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildSchedulerHref,
  parseSchedulerMediaType,
  releaseAnnounceCaption,
  songAnnounceCaption,
  trackPageUrl,
} from "./scheduler-handoff";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const schedulerSource = read("../pages/scheduler.tsx");
const distributeSource = read("../pages/distribute.tsx");
const songsSource = read("../pages/songs.tsx");

describe("buildSchedulerHref — the ?schedule=1 protocol", () => {
  it("a caption-only handoff opens the composer prefilled", () => {
    const href = buildSchedulerHref({ caption: "hello world" });
    const q = new URLSearchParams(href.split("?")[1]);
    expect(href.startsWith("/scheduler?")).toBe(true);
    expect(q.get("schedule")).toBe("1");
    expect(q.get("caption")).toBe("hello world");
    expect(q.get("media")).toBeNull();
  });

  it("media carries its type so cover art is stored as an image post", () => {
    const href = buildSchedulerHref({
      caption: "announce",
      media: "https://cdn/cover.jpg",
      mediaType: "image",
    });
    const q = new URLSearchParams(href.split("?")[1]);
    expect(q.get("media")).toBe("https://cdn/cover.jpg");
    expect(q.get("mediaType")).toBe("image");
  });

  it("media without an explicit type defaults to video", () => {
    const q = new URLSearchParams(
      buildSchedulerHref({ caption: "c", media: "https://cdn/v.mp4" }).split("?")[1],
    );
    expect(q.get("mediaType")).toBe("video");
  });

  it("platforms join into the protocol's platform param", () => {
    const q = new URLSearchParams(
      buildSchedulerHref({ caption: "c", platforms: ["tiktok", "instagram"] }).split("?")[1],
    );
    expect(q.get("platform")).toBe("tiktok,instagram");
  });
});

describe("parseSchedulerMediaType", () => {
  it("only 'image' means image; everything else is video", () => {
    expect(parseSchedulerMediaType("image")).toBe("image");
    expect(parseSchedulerMediaType("video")).toBe("video");
    expect(parseSchedulerMediaType(null)).toBe("video");
    expect(parseSchedulerMediaType("bogus")).toBe("video");
  });
});

describe("announcement captions carry the canonical on-site link", () => {
  it("a release announcement carries its pre-save link", () => {
    const caption = releaseAnnounceCaption({
      title: "Golden Hour",
      artistName: "Thy Cheat Code",
      releaseDate: "2026-11-01",
      presaveUrl: "https://bowdownvisuals.com/presave/golden-hour",
    });
    expect(caption).toContain("Golden Hour");
    expect(caption).toContain("Thy Cheat Code");
    expect(caption).toContain("drops 2026-11-01");
    expect(caption).toContain("https://bowdownvisuals.com/presave/golden-hour");
  });

  it("a release without a date says it's dropping soon", () => {
    const caption = releaseAnnounceCaption({
      title: "T",
      artistName: "A",
      presaveUrl: "https://x/presave/t",
    });
    expect(caption).toContain("is dropping soon");
    expect(caption).toContain("https://x/presave/t");
  });

  it("a song announcement carries the track's own page", () => {
    const trackUrl = trackPageUrl("https://bowdownvisuals.com", "song-42");
    expect(trackUrl).toBe("https://bowdownvisuals.com/track/song-42");
    const caption = songAnnounceCaption({ title: "Midnight Run", trackUrl });
    expect(caption).toContain("Midnight Run");
    expect(caption).toContain("https://bowdownvisuals.com/track/song-42");
  });

  it("a scheduled post composed from a release round-trips: href → composer params → caption + image media", () => {
    const href = buildSchedulerHref({
      caption: releaseAnnounceCaption({
        title: "Golden Hour",
        artistName: "Thy Cheat Code",
        releaseDate: "2026-11-01",
        presaveUrl: "https://bowdownvisuals.com/presave/golden-hour",
      }),
      media: "https://cdn/cover.jpg",
      mediaType: "image",
    });
    const q = new URLSearchParams(href.split("?")[1]);
    expect(q.get("caption")).toContain("/presave/golden-hour");
    expect(q.get("media")).toBe("https://cdn/cover.jpg");
    expect(parseSchedulerMediaType(q.get("mediaType"))).toBe("image");
  });
});

describe("surface wiring (source)", () => {
  it("the scheduler consumes mediaType and stores the composer's real type (no hardcoded 'video')", () => {
    expect(schedulerSource).toContain('params.get("mediaType")');
    expect(schedulerSource).toContain("parseSchedulerMediaType");
    expect(schedulerSource).toContain("mediaTypePrefill={mediaTypePrefill}");
    expect(schedulerSource).not.toContain('mediaType: "video",');
  });

  it("distribute's pre-save panel announces through the builder with its cover art", () => {
    expect(distributeSource).toContain("releaseAnnounceCaption");
    expect(distributeSource).toContain("buildSchedulerHref");
    expect(distributeSource).toContain('mediaType: release.artworkUrl ? "image" : undefined');
  });

  it("the song library has an Announce action built from the song itself", () => {
    expect(songsSource).toContain("songAnnounceCaption");
    expect(songsSource).toContain("trackPageUrl(window.location.origin, s.id)");
    expect(songsSource).toContain("Announce");
  });
});
