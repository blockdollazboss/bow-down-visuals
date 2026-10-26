/**
 * World static assets vs the global rate limiter (World figures
 * fix, Oct 26 2026). The palace fixture bodies load LAST in the
 * World entry burst and their origin copies are the fallback when
 * the media CDN leg fails — a limiter shed (429) on that single
 * attempt stranded the King and guards on their stand-ins for a
 * whole session. These pins hold the exemption to exactly the
 * inert asset files under /world/: reads only, asset extensions
 * only, and never the SPA page or anything under /api/.
 */
import { describe, expect, it } from "vitest";
import { isWorldStaticAssetPath, skipWorldStaticAssets } from "../rate-limit";

describe("isWorldStaticAssetPath — the exempt asset class", () => {
  it("covers the three fixture bodies", () => {
    expect(isWorldStaticAssetPath("/world/king-gen.glb")).toBe(true);
    expect(isWorldStaticAssetPath("/world/guard-gen.glb")).toBe(true);
    expect(isWorldStaticAssetPath("/world/guard-gen-female.glb")).toBe(true);
  });

  it("covers the sibling world assets (mattes, loops, hall textures)", () => {
    expect(isWorldStaticAssetPath("/world/default-character.png")).toBe(true);
    expect(isWorldStaticAssetPath("/world/default-character-female.png")).toBe(true);
    expect(isWorldStaticAssetPath("/world/loops/shark-king-idle-loop.mp4")).toBe(true);
    expect(isWorldStaticAssetPath("/world/loops/palace-guard-male-idle-poster.png")).toBe(true);
    expect(isWorldStaticAssetPath("/world/textures/marble-cream-goldvein.jpg")).toBe(true);
    expect(isWorldStaticAssetPath("/world/textures/lawn-dark.webp")).toBe(true);
  });

  it("is case-insensitive on the extension", () => {
    expect(isWorldStaticAssetPath("/world/KING-GEN.GLB")).toBe(true);
  });

  it("never matches the SPA page or bare directory", () => {
    expect(isWorldStaticAssetPath("/world")).toBe(false);
    expect(isWorldStaticAssetPath("/world/")).toBe(false);
  });

  it("never matches API routes or lookalike prefixes", () => {
    expect(isWorldStaticAssetPath("/api/world/king-gen.glb")).toBe(false);
    expect(isWorldStaticAssetPath("/worlds/king-gen.glb")).toBe(false);
    expect(isWorldStaticAssetPath("/worldly/king-gen.glb")).toBe(false);
  });

  it("requires the asset extension at the very end", () => {
    expect(isWorldStaticAssetPath("/world/king-gen.glb/extra")).toBe(false);
    expect(isWorldStaticAssetPath("/world/king-gen.glb.json")).toBe(false);
    expect(isWorldStaticAssetPath("/world/README.md")).toBe(false);
  });
});

describe("skipWorldStaticAssets — the limiter skip predicate", () => {
  it("skips reads of world assets", () => {
    expect(skipWorldStaticAssets({ method: "GET", path: "/world/king-gen.glb" })).toBe(true);
    expect(skipWorldStaticAssets({ method: "HEAD", path: "/world/guard-gen.glb" })).toBe(true);
  });

  it("never skips writes, even to an asset path", () => {
    expect(skipWorldStaticAssets({ method: "POST", path: "/world/king-gen.glb" })).toBe(false);
    expect(skipWorldStaticAssets({ method: "PUT", path: "/world/king-gen.glb" })).toBe(false);
    expect(skipWorldStaticAssets({ method: "DELETE", path: "/world/king-gen.glb" })).toBe(false);
  });

  it("never skips ordinary traffic", () => {
    expect(skipWorldStaticAssets({ method: "GET", path: "/api/credits" })).toBe(false);
    expect(skipWorldStaticAssets({ method: "GET", path: "/world" })).toBe(false);
    expect(skipWorldStaticAssets({ method: "GET", path: "/" })).toBe(false);
  });
});
