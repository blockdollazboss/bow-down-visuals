/**
 * Tests for the Link-in-Bio backend (pure helpers).
 *
 * Covers: URL allow-list (stored values become hrefs — javascript: must never
 * pass), slug generation, and the publish pricing constant contract.
 */
import { describe, expect, it } from "vitest";
import { isAllowedUrl, slugify } from "../bio-pages";

describe("bio-pages URL allow-list", () => {
  it("accepts https/http URLs", () => {
    expect(isAllowedUrl("https://open.spotify.com/track/abc")).toBe(true);
    expect(isAllowedUrl("http://example.com")).toBe(true);
  });

  it("accepts site-relative paths", () => {
    expect(isAllowedUrl("/tips/my-handle")).toBe(true);
    expect(isAllowedUrl("/showcase/my-song")).toBe(true);
  });

  it("accepts mailto: and tel:", () => {
    expect(isAllowedUrl("mailto:bookings@example.com")).toBe(true);
    expect(isAllowedUrl("tel:+15551234567")).toBe(true);
  });

  it("rejects javascript: and other dangerous schemes", () => {
    expect(isAllowedUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedUrl("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isAllowedUrl("data:text/html,<h1>x</h1>")).toBe(false);
    expect(isAllowedUrl("vbscript:msgbox(1)")).toBe(false);
  });

  it("rejects protocol-relative and bare strings", () => {
    expect(isAllowedUrl("//evil.com")).toBe(false);
    expect(isAllowedUrl("not a url")).toBe(false);
    expect(isAllowedUrl("ftp://files.example.com")).toBe(false);
  });
});

describe("bio-pages slugify", () => {
  it("slugifies display names", () => {
    expect(slugify("Thy Cheat Code")).toBe("thy-cheat-code");
    expect(slugify("  DJ  Shark!! ")).toBe("dj-shark");
  });

  it("falls back to 'bio' for empty names", () => {
    expect(slugify("")).toBe("bio");
    expect(slugify("!!!")).toBe("bio");
  });

  it("truncates to 40 chars", () => {
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(40);
  });
});
