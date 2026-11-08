import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  IMAGE_DOWNSCALE_TARGET_BYTES,
  IMAGE_ENCODE_ATTEMPTS,
  PUBLISH_IMAGE_MAX_BYTES,
  PUBLISH_MEDIA_MAX_BYTES,
  downscaledFileName,
  isImageFile,
  mediaOversizeMessage,
  needsImageDownscale,
  scaledDimensions,
} from "./upload-prep";

const MB = 1024 * 1024;

describe("upload-prep limits mirror the server door (stack300 #69)", () => {
  it("image cap is 10 MB and media cap is 80 MB, matching publish.ts", () => {
    expect(PUBLISH_IMAGE_MAX_BYTES).toBe(10 * MB);
    expect(PUBLISH_MEDIA_MAX_BYTES).toBe(80 * MB);
    expect(IMAGE_DOWNSCALE_TARGET_BYTES).toBeLessThan(PUBLISH_IMAGE_MAX_BYTES);
  });
});

describe("needsImageDownscale", () => {
  it("leaves an image that already fits completely untouched", () => {
    expect(needsImageDownscale({ type: "image/jpeg", size: 4 * MB })).toBe(false);
    expect(needsImageDownscale({ type: "image/png", size: 9 * MB })).toBe(false);
  });

  it("flags images over the target (incl. everything over the 10 MB cap)", () => {
    expect(needsImageDownscale({ type: "image/jpeg", size: 9.5 * MB })).toBe(true);
    expect(needsImageDownscale({ type: "image/jpeg", size: 25 * MB })).toBe(true);
  });

  it("never flags non-images, however large", () => {
    expect(needsImageDownscale({ type: "video/mp4", size: 79 * MB })).toBe(false);
    expect(needsImageDownscale({ type: "audio/mpeg", size: 50 * MB })).toBe(false);
  });
});

describe("mediaOversizeMessage — pre-upload rejection", () => {
  it("rejects a non-image over 80 MB with the server's own wording, before any upload", () => {
    expect(mediaOversizeMessage({ type: "video/mp4", size: 81 * MB })).toBe(
      "This file exceeds the 80 MB upload limit. Please use a smaller file.",
    );
  });

  it("passes non-images at or under the cap, and all images (downscale path judges them)", () => {
    expect(mediaOversizeMessage({ type: "video/mp4", size: 80 * MB })).toBeNull();
    expect(mediaOversizeMessage({ type: "audio/mpeg", size: 12 * MB })).toBeNull();
    expect(mediaOversizeMessage({ type: "image/jpeg", size: 40 * MB })).toBeNull();
  });
});

describe("scaledDimensions", () => {
  it("caps the longest side and preserves aspect", () => {
    expect(scaledDimensions(4000, 3000, 2560)).toEqual({ width: 2560, height: 1920 });
    expect(scaledDimensions(2000, 4000, 1000)).toEqual({ width: 500, height: 1000 });
  });

  it("never upscales and never returns a zero side", () => {
    expect(scaledDimensions(800, 600, 2560)).toEqual({ width: 800, height: 600 });
    const tiny = scaledDimensions(10000, 1, 1280);
    expect(tiny.height).toBe(1);
    expect(tiny.width).toBe(1280);
  });
});

describe("encode ladder + filename truth", () => {
  it("ladder is gentlest-first and strictly shrinking in dimension", () => {
    const dims = IMAGE_ENCODE_ATTEMPTS.map((a) => a.maxDimension);
    expect(dims).toEqual([...dims].sort((a, b) => b - a));
    expect(IMAGE_ENCODE_ATTEMPTS[0]?.quality).toBeGreaterThan(
      IMAGE_ENCODE_ATTEMPTS[IMAGE_ENCODE_ATTEMPTS.length - 1]?.quality ?? 0,
    );
  });

  it("renames the file when the re-encode changed its type", () => {
    expect(downscaledFileName("photo.png", "image/jpeg")).toBe("photo.jpg");
    expect(downscaledFileName("photo.jpg", "image/jpeg")).toBe("photo.jpg");
    expect(downscaledFileName("art", "image/webp")).toBe("art.webp");
    expect(isImageFile({ type: "image/png" })).toBe(true);
    expect(isImageFile({ type: "video/mp4" })).toBe(false);
  });
});

describe("the upload hook is wired to prep (source pin)", () => {
  const hook = readFileSync(
    resolve(import.meta.dirname, "../hooks/use-file-upload.ts"),
    "utf8",
  );

  it("downscales oversize images and rejects before fetch when still over the cap", () => {
    expect(hook).toContain("downscaleImageFile");
    expect(hook).toContain("needsImageDownscale");
    // The oversize decision happens before the network call.
    expect(hook.indexOf("IMAGE_OVERSIZE_MESSAGE")).toBeGreaterThan(-1);
    expect(hook.indexOf("IMAGE_OVERSIZE_MESSAGE")).toBeLessThan(hook.indexOf('fetch("/api/publish/upload"'));
    expect(hook.indexOf("mediaOversizeMessage")).toBeLessThan(hook.indexOf('fetch("/api/publish/upload"'));
  });
});
