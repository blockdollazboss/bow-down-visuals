/**
 * Profile Memberships — GUEST visibility pins (Oct 18, 2026).
 *
 * The flag: during the Oct 17 evening live verification, a guest on a
 * creator profile saw Featured / My Picks / About / Shout Wall but no
 * Memberships section, and the note sat uninvestigated.
 *
 * The investigation's verdict, proven link by link: the guest chain is
 * sound. The public layout carries the block (API-pinned in
 * profile-website.test.ts, including a guest read of the untouched
 * default), the profile DTO carries the owner's user_id (API-pinned in
 * creator-profile-public.test.ts after the historical /undefined bug),
 * the tiers read is unauthenticated and returns active tiers in this
 * lib's DTO shape (API-pinned in memberships-payments.test.ts, called
 * with no auth header), and membershipsViewState renders "tiers" for
 * ANY viewer when an active tier exists (unit-pinned in
 * profile-website.test.ts). The only state that leaves no trace on the
 * page is "hidden": the tiers read succeeded with zero active tiers
 * and the viewer wasn't the owner — the designed behavior (an empty
 * club hides for visitors; the owner gets the set-up invitation).
 *
 * These pins lock the CLIENT-side seams of that chain so a future
 * change can't quietly re-break the guest path:
 *  1. The page mounts the block with the profile DTO's user_id.
 *  2. normalizePublicProfile preserves user_id across the wire
 *     envelope (the client twin of the historical /undefined bug).
 *  3. The tiers read is a plain unauthenticated fetch of the public
 *     endpoint — no token gate a guest would fail.
 *  4. A signed-out viewer with tiers gets "Sign in to join" → /login
 *     (public-storefront behavior), never a dead or missing button.
 *  5. The section's only null render is the loading/hidden line — it
 *     never blanket-hides on a signed-out viewer.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { emptyProfile, normalizePublicProfile } from "./artist-profiles";

const page = readFileSync(new URL("../pages/artist-public.tsx", import.meta.url), "utf8");
const section = readFileSync(
  new URL("../components/artist/ProfileMembershipsSection.tsx", import.meta.url),
  "utf8",
);
const website = readFileSync(new URL("./profile-website.ts", import.meta.url), "utf8");

const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("profile Memberships — the guest chain's client seams", () => {
  it("the page mounts the memberships block with the profile's user_id", () => {
    expect(page).toContain('case "memberships":');
    expect(page).toContain(
      "<ProfileMembershipsSection creatorUserId={profile.user_id} title={block.title} />",
    );
  });

  it("normalizePublicProfile preserves user_id across the wire envelope", () => {
    const profile = emptyProfile({
      user_id: "44444444-4444-4444-8444-444444444444",
      slug: "some-creator",
    });
    const out = normalizePublicProfile({ profile, top_tracks: [], top_videos: [] });
    expect(out.user_id).toBe("44444444-4444-4444-8444-444444444444");
    expect(out.slug).toBe("some-creator");
  });

  it("the tiers read is a plain unauthenticated fetch of the public endpoint", () => {
    const start = website.indexOf("export async function fetchPublicMemberships");
    expect(start).toBeGreaterThan(-1);
    const fn = website.slice(start, start + 400);
    expect(fn).toContain("fetch(`/api/memberships/public/${encodeURIComponent(creatorUserId)}`)");
    expect(fn).not.toContain("Authorization");
    expect(fn).not.toContain("getAccessToken");
  });

  it("a signed-out viewer with tiers gets Sign in to join, routed to /login", () => {
    expect(section).toContain("!user ? (");
    expect(section).toContain('href="/login"');
    expect(section).toContain("Sign in to join");
    /* The guest branch precedes the checkout button it stands in for. */
    expect(section.indexOf("Sign in to join")).toBeLessThan(
      section.indexOf("onClick={() => void join(tier)}"),
    );
  });

  it("the section's only null render is the loading/hidden line", () => {
    expect(section).toContain('if (view === "loading" || view === "hidden") return null;');
    expect(occurrences(section, "return null")).toBe(1);
  });
});
