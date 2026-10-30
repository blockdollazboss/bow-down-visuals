/**
 * Profile slug — the client mirror of the server's SLUG_RE
 * (routes/creator-platform.ts: /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/ after
 * trim + lowercase). The editor must refuse exactly what the server
 * refuses, at the same boundary values, and say the rule out loud.
 */
import { describe, it, expect } from "vitest";
import { profileSlugError, PROFILE_SLUG_RULE } from "./artist-profiles";

describe("profileSlugError (server SLUG_RE mirror)", () => {
  it("accepts ordinary slugs", () => {
    expect(profileSlugError("shark-king")).toBeNull();
    expect(profileSlugError("abc")).toBeNull();
    expect(profileSlugError("a1-b2")).toBeNull();
  });

  it("length boundaries: 2 fails, 3 passes, 40 passes, 41 fails", () => {
    expect(profileSlugError("ab")).toBe(PROFILE_SLUG_RULE);
    expect(profileSlugError("abc")).toBeNull();
    expect(profileSlugError("a".repeat(40))).toBeNull();
    expect(profileSlugError("a".repeat(41))).toBe(PROFILE_SLUG_RULE);
  });

  it("no leading or trailing hyphen", () => {
    expect(profileSlugError("-abc")).toBe(PROFILE_SLUG_RULE);
    expect(profileSlugError("abc-")).toBe(PROFILE_SLUG_RULE);
    expect(profileSlugError("a-b")).toBeNull();
  });

  it("the server lowercases before matching — so does the mirror", () => {
    expect(profileSlugError("Shark-King")).toBeNull();
  });

  it("rejects characters outside the pattern", () => {
    expect(profileSlugError("a_b")).toBe(PROFILE_SLUG_RULE);
    expect(profileSlugError("a b")).toBe(PROFILE_SLUG_RULE);
    expect(profileSlugError("")).toBe(PROFILE_SLUG_RULE);
  });

  it("the rule text states the server's real limits", () => {
    expect(PROFILE_SLUG_RULE).toContain("3-40");
  });
});
