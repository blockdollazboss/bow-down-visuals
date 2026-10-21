import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Access lockdown Lane 3 — guest honesty on the surfaces that stay
 * public (AUDIT §2 profiles, §3.4 World voice chip, plus the earnings
 * signed-out state).
 *
 * The defects were all the same shape: a member-only action presented
 * to a guest as if it worked, then silently failing (Follow no-op,
 * Shout draft kept, earnings 401 error card), or a members-only
 * affordance advertised with no explanation (World voice). These pins
 * hold the honest guest variants in place — and hold the member paths
 * byte-for-byte beside them, so the fix can't quietly become a member
 * regression.
 *
 * Source-contract pins, the house pattern for component contracts
 * (node-env vitest, no tsx rendering — cf. email-list-honesty.test.ts,
 * enter-world-button.test.ts).
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const profileSections = read("../components/artist/profile-sections.tsx");
const worldSource = read("../pages/world.tsx");
const earningsSource = read("../pages/earnings.tsx");
const earningsDataSource = read("./earnings-data.ts");

const segment = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  expect(a, `segment start ${from}`).toBeGreaterThanOrEqual(0);
  expect(b, `segment end ${to}`).toBeGreaterThan(a);
  return src.slice(a, b);
};

const actions = segment(
  profileSections,
  "export function ProfileActions",
  "export function MadeWithBadge",
);
const shoutWall = segment(
  profileSections,
  "export function ShoutWallSection",
  "/* ─── Top creators",
);

describe("profile Follow — guest gets “Sign in to follow”, members keep the toggle", () => {
  it("ProfileActions reads the session", () => {
    expect(actions).toContain("const { user } = useAuth();");
  });

  it("the guest branch renders the sign-in variant with this profile's slug in ?next=", () => {
    expect(actions).toContain("!user ? (");
    expect(actions).toContain('data-testid="profile-follow-signin"');
    expect(actions).toContain("Sign in to follow");
    expect(actions).toContain(
      "href={`/login?next=/artist/${encodeURIComponent(profile.slug)}`}",
    );
  });

  it("the guest variant is a Link, not the toggle button — it can never fire follow", () => {
    const guest = segment(actions, 'data-testid="profile-follow-signin"', ") : (");
    expect(guest).not.toContain("toggleFollow");
    expect(guest).not.toContain("onClick");
  });

  it("the member toggle is unchanged: same handler, same labels, same quiet catch", () => {
    expect(actions).toContain("const toggleFollow = async () => {");
    expect(actions).toContain("unfollowProfile(profile.slug)");
    expect(actions).toContain("followProfile(profile.slug)");
    expect(actions).toContain("/* stay quiet — no dead button, just no-op on auth failure */");
    expect(actions).toContain('onClick={() => void toggleFollow()}');
    expect(actions).toContain('{following ? "Following" : "Follow"} · {count.toLocaleString()}');
  });
});

describe("Shout Wall composer — guests get a pitch, members keep the composer", () => {
  it("ShoutWallSection reads the session", () => {
    expect(shoutWall).toContain("const { user } = useAuth();");
  });

  it("the guest pitch renders in the composer's place, linking back to this profile", () => {
    expect(shoutWall).toContain("!preview && !user && (");
    expect(shoutWall).toContain('data-testid="shout-wall-signin"');
    expect(shoutWall).toContain("Sign in to shout");
    expect(shoutWall).toContain(
      "href={`/login?next=/artist/${encodeURIComponent(slug)}`}",
    );
  });

  it("the member composer is unchanged and now gated on a session", () => {
    expect(shoutWall).toContain("!preview && user && (");
    expect(shoutWall).toContain('placeholder="Leave some love on the wall…"');
    expect(shoutWall).toContain("const c = await postComment(slug, body);");
    /* The guest pitch comes first in source order, so a guest never
       reaches the composer branch. */
    expect(shoutWall.indexOf('data-testid="shout-wall-signin"')).toBeLessThan(
      shoutWall.indexOf('placeholder="Leave some love on the wall…"'),
    );
  });
});

describe("World — guest voice chip + gamepad help scoping", () => {
  it("guests see the disabled members-only voice chip, linking to sign-in for /world", () => {
    expect(worldSource).toContain('isGuest && status === "inside" && (');
    expect(worldSource).toContain('data-testid="world-guest-voice-chip"');
    expect(worldSource).toContain("Voice is for members — sign in to talk");
    expect(worldSource).toContain('href="/login?next=/world"');
  });

  it("the member voice block is untouched — still gated on !isGuest, modes + Join intact", () => {
    expect(worldSource).toContain('{!isGuest && status === "inside" && (');
    expect(worldSource).toContain('data-testid="world-voice-modes"');
    expect(worldSource).toContain("Join voice");
  });

  it("the gamepad voice step is scoped to members; the rest of the help line stays", () => {
    const pad = segment(worldSource, 'data-testid="world-pad-line"', "</p>");
    expect(pad).toContain(
      '{!isGuest && "A steps voice (off · proximity · lobby · deafen), "}',
    );
    expect(pad).toContain("Y switches view");
    expect(pad).toContain("LB opens the door you&rsquo;re standing at");
    expect(pad).toContain("D-pad and face buttons perform the actions below.");
    /* The voice step is advertised exactly once in the page — inside
       that member-only conditional. */
    expect(worldSource.split("A steps voice").length - 1).toBe(1);
  });
});

describe("Earnings — signed-out pitch instead of the doomed-fetch error card", () => {
  it("the page reads user + auth loading from the session", () => {
    expect(earningsSource).toContain(
      "const { user, loading: authLoading, getAccessToken } = useAuth();",
    );
  });

  it("the fetch never fires without a session (guard precedes the load)", () => {
    expect(earningsSource).toContain("if (authLoading || !user) return;");
    /* Batch union (lockdown × earnings-load-fix): the page no longer
       fetches directly — its one network path is the guarded effect's
       loadEarnings call, and the guard precedes it. The endpoint
       literal lives in the loader (lib/earnings-data.ts), which only
       that guarded call can reach. */
    expect(earningsSource).not.toContain('fetch("/api/earnings"');
    expect(earningsSource.indexOf("if (authLoading || !user) return;")).toBeLessThan(
      earningsSource.indexOf("await loadEarnings({"),
    );
    expect(earningsDataSource).toContain('fetchFn("/api/earnings"');
  });

  it("the signed-out branch renders the pitch — before the failure branch", () => {
    expect(earningsSource).toContain("if (!authLoading && !user) {");
    expect(earningsSource).toContain('data-testid="earnings-signin"');
    expect(earningsSource).toContain('href="/login?next=/earnings"');
    expect(earningsSource).toContain("Sign in to view earnings");
    expect(earningsSource.indexOf("if (!authLoading && !user) {")).toBeLessThan(
      earningsSource.indexOf("if (failed) {"),
    );
  });

  it("signed-in states are unchanged: loading copy and the real-failure error card remain", () => {
    expect(earningsSource).toContain("Loading your money picture…");
    expect(earningsSource).toContain(
      "Couldn&apos;t load your earnings — try again in a moment.",
    );
  });
});
