import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guest doors carry the way back (stack1000 R1, public-surface truth).
 *
 * On the public surfaces, a guest tapping a member action met the
 * sign-in screen with NO return path: buy, claim, make-an-offer and
 * restock taps on the public product page, the challenge vote/join
 * doors, the ticket door on a public live watch page, the fan-club
 * join, and every Follow pill all bounced to a bare /login (or
 * /signup) — after signing in, the fan landed on the default home
 * and the thing they were doing was gone. The beats license modal
 * was worse: it let a guest complete the whole purchase flow, fired
 * the POST, and rendered the 401's "Please sign in to do that." in
 * the modal's SUCCESS styling, with no door at all.
 *
 * The house contract is lib/auth-next.ts loginPathWithNext — the
 * GuestGate, ProtectedRoute, /presave and /unlock already build
 * their doors with it; the receiving screens honor ?next=. These
 * source-contract pins hold every fixed door to that contract.
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const productPage = read("../pages/storefront-product.tsx");
const challengePage = read("../pages/challenge.tsx");
const liveWatch = read("../pages/live-watch.tsx");
const membershipsPage = read("../pages/memberships.tsx");
const followButton = read("../components/discovery/FollowButton.tsx");
const beatsPage = read("../pages/beats.tsx");

describe("guest doors on public surfaces carry ?next= back", () => {
  it("storefront product page: every member-action bounce goes through the door builder", () => {
    expect(productPage).not.toContain('navigate("/login")');
    expect(productPage).toContain("loginPathWithNext(location, search)");
    // buy, claim, offer, restock subscribe + its token-miss twin.
    expect(productPage.match(/navigate\(signInDoor\)/g)?.length).toBe(5);
  });

  it("challenge page: vote and join doors return to the challenge", () => {
    expect(challengePage).not.toContain('navigate("/login")');
    expect(challengePage).toContain("loginPathWithNext(`/challenge/${slug}`)");
    expect(challengePage).toContain(": signInDoor;");
  });

  it("live watch ticket door: the sign-in button carries this show's address", () => {
    expect(liveWatch).not.toContain('href="/login"');
    expect(liveWatch).toContain('data-testid="btn-signin-for-ticket"');
    expect(liveWatch).toContain("href={signInHref}");
    expect(liveWatch.match(/loginPathWithNext\(`\/live\/\$\{id\}`\)/g)?.length).toBe(2);
  });

  it("memberships: the fan-club join and the guest card return to the club", () => {
    expect(membershipsPage).not.toContain('window.location.href = "/login"');
    expect(membershipsPage).not.toContain('<Link href="/login"');
    expect(membershipsPage).toContain("window.location.href = signInDoor");
    expect(membershipsPage).toContain("creator=${encodeURIComponent(creatorUserId)}");
  });

  it("FollowButton: the guest pill is a sign-in door back to this page, not a bare /signup", () => {
    expect(followButton).not.toContain('href="/signup"');
    expect(followButton).toContain("loginPathWithNext(location)");
  });

  it("beats: a guest meets the sign-in door in the license modal, never a futile submit", () => {
    // The backstop guard inside reserveLicense.
    expect(beatsPage).toContain("if (!user) return;");
    // The door itself, carrying the way back to /beats.
    expect(beatsPage).toContain('loginPathWithNext("/beats")');
    expect(beatsPage).toContain("beats.signInToLicenseButton");
    // The pay button still exists — in the signed-in branch.
    expect(beatsPage).toContain("onClick={reserveLicense}");
  });
});
