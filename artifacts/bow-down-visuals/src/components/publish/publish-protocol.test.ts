import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildPublishUrl } from "@/lib/publish-protocol";

/* DE-8: /publish already accepted a thumbnail param, but Thumbnail Studio
   never sent one — the thumbnail was a download-only artifact. These tests
   pin the protocol the studio's new "Use as thumbnail for…" action rides:
   type=video + artworkUrl MUST land in the URL as `thumbnail`, with the
   target video attached when the project has one. */

const THUMB = "https://cdn.example.com/thumbs/abc.png";
const VIDEO = "https://cdn.example.com/videos/final.mp4";

describe("buildPublishUrl — thumbnail attachment", () => {
  it("a video publish with artworkUrl carries it as the thumbnail param", () => {
    const url = buildPublishUrl({
      type: "video",
      category: "video",
      videoUrl: VIDEO,
      title: "Midnight Run (Official Video)",
      artworkUrl: THUMB,
      from: "/thumbnail-studio",
      fromLabel: "Thumbnail Studio",
    });
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("type")).toBe("video");
    expect(params.get("thumbnail")).toBe(THUMB);
    expect(params.get("videoUrl")).toBe(VIDEO);
    expect(params.get("title")).toBe("Midnight Run (Official Video)");
    expect(params.get("from")).toBe("/thumbnail-studio");
  });

  it("the thumbnail still attaches when the project has no video yet", () => {
    const url = buildPublishUrl({
      type: "video",
      category: "video",
      artworkUrl: THUMB,
      from: "/thumbnail-studio",
      fromLabel: "Thumbnail Studio",
    });
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("thumbnail")).toBe(THUMB);
    expect(params.get("videoUrl")).toBeNull();
  });

  it("for audio the same artwork travels as `artwork`, not `thumbnail`", () => {
    const url = buildPublishUrl({ type: "audio", artworkUrl: THUMB });
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("artwork")).toBe(THUMB);
    expect(params.get("thumbnail")).toBeNull();
  });
});

/**
 * Stack-30 C6 — thumbnail attach completeness.
 *
 * DE-8 wired the generated result's action bar, but two surfaces in
 * the same page still stranded the chosen thumbnail: the A/B-test
 * winner (which traveled only as a localStorage hand-off to Video
 * Studio) and the library shelf (download/delete only). All three
 * surfaces now render the same PublishToProfileButton; the winner
 * and the library ride the project's newest video/clip as the
 * target exactly like the result bar. These source pins keep any of
 * the three from silently losing the attach again — the URL the
 * button builds is pinned by the protocol tests above.
 */
describe("thumbnail-studio — every surface attaches through the publish protocol (source)", () => {
  const src = readFileSync(new URL("../../pages/thumbnail-studio.tsx", import.meta.url), "utf8");

  it("the A/B winner banner attaches the winning thumbnail", () => {
    expect(src).toContain("artworkUrl={winnerUrl}");
  });

  it("the library card attaches its thumbnail", () => {
    expect(src).toContain("artworkUrl={thumb.thumbnail_url}");
  });

  it("the library lightbox attaches its thumbnail", () => {
    expect(src).toContain("artworkUrl={lightbox.thumbnail_url}");
  });

  it("all four attach points (result bar, winner, library card, library lightbox) render the protocol button", () => {
    expect(src.match(/<PublishToProfileButton/g)).toHaveLength(4);
    expect(src).toContain("artworkUrl={selectedImage.url}");
  });
});
