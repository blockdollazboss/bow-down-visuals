/** Flag S-4 (Lane F perf audit): TTL sweep for process-local timestamp maps. */
import { describe, it, expect } from "vitest";
import { cacheControlForFile, spaFallbackStatus } from "../cache-policy";
import { sweepIfLarge, sweepStaleEntries } from "../sweep-map";

describe("sweepStaleEntries", () => {
  it("deletes only entries older than the TTL", () => {
    const now = 1_000_000;
    const map = new Map<string, number>([
      ["fresh", now - 1_000],
      ["stale", now - 61_000],
      ["ancient", now - 3_600_000],
    ]);
    expect(sweepStaleEntries(map, 60_000, now)).toBe(2);
    expect([...map.keys()]).toEqual(["fresh"]);
  });
  it("sweepIfLarge does nothing under the threshold (amortized cost)", () => {
    const now = 1_000_000;
    const map = new Map<string, number>([["stale", now - 3_600_000]]);
    expect(sweepIfLarge(map, 5000, 60_000, now)).toBe(0);
    expect(map.size).toBe(1);
  });
});

describe("cacheControlForFile (engines cache fix)", () => {
  it("vendored engine files are immutable for a year (the audit's top client fix)", () => {
    expect(cacheControlForFile("/srv/dist/public/engines/rvm/rvm_mobilenetv3_fp32.onnx")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(cacheControlForFile("/srv/dist/public/engines/onnxruntime/ort-wasm-simd-threaded.jsep.wasm")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(cacheControlForFile("/srv/dist/public/engines/face-landmarker/face_landmarker.task")).toBe(
      "public, max-age=31536000, immutable",
    );
  });
  it("index.html always revalidates; hashed assets stay immutable; other files get no explicit policy", () => {
    expect(cacheControlForFile("/srv/dist/public/index.html")).toBe("no-cache");
    expect(cacheControlForFile("/srv/dist/public/assets/index-a1b2c3d4.js")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(cacheControlForFile("/srv/dist/public/llms.txt")).toBeNull();
    expect(cacheControlForFile("/srv/dist/public/opengraph.jpg")).toBeNull();
  });
});

describe("spaFallbackStatus (Lane V5 F-2: SPA pages 200, missing assets 404)", () => {
  it("literal and parameterized page paths are 200", () => {
    for (const p of [
      "/", "/shorts", "/pricing", "/go-live", "/go-live/controller",
      "/artist/thy-cheat-code", "/live/9f2c1d", "/unlock/goldwater1",
      "/invite/abc123", "/presave/goldwater1", "/splits/abcdef0123",
      "/video-editor", "/some/future/page",
    ]) expect(spaFallbackStatus(p)).toBe(200);
  });
  it("file-looking paths are 404 (genuinely missing assets)", () => {
    for (const p of [
      "/assets/index-a1b2c3d4.js", "/assets/app.css", "/engines/rvm/model.onnx",
      "/favicon.ico", "/missing.png", "/fonts/inter.woff2", "/media/clip.mp4",
      "/models/face_landmarker.task", "/data.json",
    ]) expect(spaFallbackStatus(p)).toBe(404);
  });
  it("a dotted slug that is not an asset extension still reads as a page", () => {
    expect(spaFallbackStatus("/artist/dr.dre")).toBe(200);
    expect(spaFallbackStatus("/files/my.song")).toBe(200);
  });
});
