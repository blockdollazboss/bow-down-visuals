import { describe, it, expect } from "vitest";
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
