/**
 * Tests for the Stock Media Library route helpers.
 *
 * Covers: the 50-Visual-Buc import price, Pexels video file selection
 * (prefer HD MP4), video/photo normalization (including photographer
 * attribution passthrough), and null-guards for unusable provider payloads.
 * Live Pexels calls are not exercised here — no network in unit tests.
 */
import { describe, expect, it } from "vitest";

import {
  STOCK_IMPORT_CREDIT_COST,
  pickPexelsVideoFile,
  normalizePexelsVideo,
  normalizePexelsPhoto,
} from "../stock";

describe("STOCK_IMPORT_CREDIT_COST", () => {
  it("is 50 Visual Bucs per import", () => {
    expect(STOCK_IMPORT_CREDIT_COST).toBe(50);
  });
});

describe("pickPexelsVideoFile", () => {
  const files = [
    { id: 1, quality: "sd", file_type: "video/mp4", width: 640, height: 360, link: "https://videos.pexels.com/sd.mp4" },
    { id: 2, quality: "hd", file_type: "video/mp4", width: 1280, height: 720, link: "https://videos.pexels.com/hd.mp4" },
    { id: 3, quality: "uhd", file_type: "video/mp4", width: 3840, height: 2160, link: "https://videos.pexels.com/uhd.mp4" },
  ];

  it("prefers the HD mp4 file", () => {
    expect(pickPexelsVideoFile(files)?.link).toBe("https://videos.pexels.com/hd.mp4");
  });

  it("falls back to SD when no HD mp4 exists", () => {
    expect(pickPexelsVideoFile([files[0]!])?.link).toBe("https://videos.pexels.com/sd.mp4");
  });

  it("ignores non-mp4 files", () => {
    expect(
      pickPexelsVideoFile([
        { id: 9, quality: "hd", file_type: "video/quicktime", width: 1, height: 1, link: "https://videos.pexels.com/a.mov" },
      ]),
    ).toBeNull();
  });

  it("returns null for an empty file list", () => {
    expect(pickPexelsVideoFile([])).toBeNull();
  });
});

describe("normalizePexelsVideo", () => {
  const base = {
    id: 123,
    width: 1280,
    height: 720,
    duration: 12,
    image: "https://images.pexels.com/preview.jpg",
    url: "https://www.pexels.com/video/123/",
    user: { name: "Jane Doe", url: "https://www.pexels.com/@janedoe" },
    video_files: [
      { id: 1, quality: "hd", file_type: "video/mp4", width: 1280, height: 720, link: "https://videos.pexels.com/hd.mp4" },
    ],
  };

  it("normalizes a video and carries photographer attribution", () => {
    const item = normalizePexelsVideo(base);
    expect(item).not.toBeNull();
    expect(item!.id).toBe("pexels-video-123");
    expect(item!.type).toBe("video");
    expect(item!.fileUrl).toBe("https://videos.pexels.com/hd.mp4");
    expect(item!.previewUrl).toBe("https://images.pexels.com/preview.jpg");
    expect(item!.durationSec).toBe(12);
    expect(item!.photographer).toBe("Jane Doe");
    expect(item!.photographerUrl).toBe("https://www.pexels.com/@janedoe");
    expect(item!.sourceUrl).toBe("https://www.pexels.com/video/123/");
  });

  it("returns null when no usable video file exists", () => {
    expect(normalizePexelsVideo({ ...base, video_files: [] })).toBeNull();
  });
});

describe("normalizePexelsPhoto", () => {
  const base = {
    id: 456,
    width: 4000,
    height: 3000,
    alt: "City lights at night",
    photographer: "John Smith",
    photographer_url: "https://www.pexels.com/@johnsmith",
    url: "https://www.pexels.com/photo/456/",
    src: {
      original: "https://images.pexels.com/original.jpg",
      large: "https://images.pexels.com/large.jpg",
      medium: "https://images.pexels.com/medium.jpg",
      small: "https://images.pexels.com/small.jpg",
    },
  };

  it("normalizes a photo with attribution and sensible URLs", () => {
    const item = normalizePexelsPhoto(base);
    expect(item).not.toBeNull();
    expect(item!.id).toBe("pexels-photo-456");
    expect(item!.type).toBe("photo");
    expect(item!.title).toBe("City lights at night");
    expect(item!.previewUrl).toBe("https://images.pexels.com/medium.jpg");
    expect(item!.fileUrl).toBe("https://images.pexels.com/large.jpg");
    expect(item!.downloadUrl).toBe("https://images.pexels.com/original.jpg");
    expect(item!.photographer).toBe("John Smith");
    expect(item!.photographerUrl).toBe("https://www.pexels.com/@johnsmith");
    expect(item!.durationSec).toBeUndefined();
  });

  it("falls back gracefully when alt/photographer are blank", () => {
    const item = normalizePexelsPhoto({ ...base, alt: "", photographer: "" });
    expect(item!.title).toBe("Stock photo 456");
    expect(item!.photographer).toBe("Pexels");
  });
});
