/**
 * get-paid-checklist.test.ts — first-run truth pins for the Get Paid
 * finale (Lane N6, stack1000).
 *
 * The checklist's share step promises: "Shares carry your ?ref= code —
 * new fans earn you referral credit." It used to share the bare profile
 * URL — no code was ever attached, so fans arriving through a brand-new
 * creator's first share earned them nothing. These pins hold the fix:
 * the checklist resolves the creator's own code from /api/referrals/me
 * (the ShareMenu pattern) and every share/copy of the page URL carries
 * it, while sharing still works when the code can't be loaded.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withRefCode } from "@/lib/referral-link";

const src = readFileSync(new URL("./get-paid-checklist.tsx", import.meta.url), "utf8");

describe("GetPaidChecklist — the ?ref= promise is kept", () => {
  it("still makes the promise the fix has to keep", () => {
    expect(src).toContain("Shares carry your ?ref= code");
  });

  it("resolves the creator's own referral code from the referrals rail", () => {
    expect(src).toContain('fetch("/api/referrals/me"');
    expect(src).toContain("getAccessToken");
  });

  it("routes both share and copy through the ref-carrying URL", () => {
    expect(src).toContain("navigator.clipboard.writeText(shareUrl())");
    expect(src).toContain("const url = shareUrl();");
    expect(src).toContain("withRefCode(profileUrl(profile), refCode)");
  });
});

describe("withRefCode", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubSite(hostname = "bowdownvisuals.com") {
    vi.stubGlobal("window", {
      location: { origin: `https://${hostname}`, hostname },
    });
  }

  it("appends the code to a same-site page URL", () => {
    stubSite();
    expect(withRefCode("https://bowdownvisuals.com/artist/king", "ABC123")).toBe(
      "https://bowdownvisuals.com/artist/king?ref=ABC123",
    );
  });

  it("leaves the URL bare when there is no code (share never breaks)", () => {
    stubSite();
    expect(withRefCode("https://bowdownvisuals.com/artist/king", null)).toBe(
      "https://bowdownvisuals.com/artist/king",
    );
  });

  it("never overwrites a ref already on the URL", () => {
    stubSite();
    expect(withRefCode("https://bowdownvisuals.com/artist/king?ref=FIRST", "ABC123")).toBe(
      "https://bowdownvisuals.com/artist/king?ref=FIRST",
    );
  });

  it("does not stamp the code onto off-site URLs", () => {
    stubSite();
    expect(withRefCode("https://example.com/artist/king", "ABC123")).toBe(
      "https://example.com/artist/king",
    );
  });
});
