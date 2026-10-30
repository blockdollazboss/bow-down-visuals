import { describe, it, expect } from "vitest";
import {
  defaultComposerPlatforms,
  type ScheduledPostShape,
} from "./scheduler";

/* ─── defaultComposerPlatforms (EVERYTHING-SMART, stack900 K1) ────────
   A fresh scheduler composer must open on the creator's OWN platform
   set — what they posted to last, narrowed to accounts still
   connected — never the generic ["instagram"] for everyone. */

function post(
  platforms: ScheduledPostShape["platforms"],
  createdAt: string,
): Pick<ScheduledPostShape, "platforms" | "createdAt"> {
  return { platforms, createdAt };
}

const acct = (platform: string, expired = false) => ({ platform, expired });

describe("defaultComposerPlatforms", () => {
  it("opens on the most recent post's platforms, not the generic default", () => {
    const posts = [
      post(["instagram"], "2026-10-01T10:00:00Z"),
      post(["tiktok", "x"], "2026-10-20T10:00:00Z"),
    ];
    expect(defaultComposerPlatforms(posts, [])).toEqual(["tiktok", "x"]);
  });

  it("drops platforms the creator has since disconnected", () => {
    const posts = [post(["tiktok", "facebook"], "2026-10-20T10:00:00Z")];
    const accounts = [acct("tiktok")];
    expect(defaultComposerPlatforms(posts, accounts)).toEqual(["tiktok"]);
  });

  it("treats an expired account as not connected", () => {
    const posts = [post(["facebook"], "2026-10-20T10:00:00Z")];
    const accounts = [acct("facebook", true), acct("instagram")];
    expect(defaultComposerPlatforms(posts, accounts)).toEqual(["instagram"]);
  });

  it("falls back to connected accounts (canonical order) when there are no posts", () => {
    const accounts = [acct("x"), acct("tiktok")];
    expect(defaultComposerPlatforms([], accounts)).toEqual(["tiktok", "x"]);
  });

  it("ignores posts with an empty platform set when looking for the last used", () => {
    const posts = [
      post(["instagram"], "2026-10-01T10:00:00Z"),
      post([], "2026-10-25T10:00:00Z"),
    ];
    expect(defaultComposerPlatforms(posts, [])).toEqual(["instagram"]);
  });

  it("returns null when the system knows nothing (composer keeps its own default)", () => {
    expect(defaultComposerPlatforms([], [])).toBeNull();
  });
});
