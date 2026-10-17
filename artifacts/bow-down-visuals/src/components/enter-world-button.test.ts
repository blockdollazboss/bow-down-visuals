/**
 * enter-world-button.test.ts — The Reverse Door (owner, 2026-10-17):
 * "Every page on my website should have something to click to take you
 * into the VR world."
 *
 * Pins the contract:
 *  (a) the shell control renders across representative routes — home, a
 *      studio page, a social page, the artist profile page, plus a
 *      marketing page and an auth page (AppShell serves all of them) —
 *      and its target is /world;
 *  (b) the artist profile's primary-actions row carries a
 *      "Visit in the World" action pointing at /world;
 *  (c) the control is NOT hidden for signed-out/guest state — neither
 *      the component nor the visibility rule takes any auth input.
 *
 * How this suite renders: vitest runs in node with no DOM harness and
 * tsconfig sets jsx:preserve, so tests import the pure contract module
 * (lib/world-entry.ts — the repo's established split, cf.
 * GenerateArtistImageModal.test.ts importing generate-artist-image.ts)
 * and render the REAL anchor the shell control is built from — wouter's
 * Link fed with the contract's own href/label/class/test-id — through
 * react-dom/server inside a Router on a static location hook, once
 * per route.
 * The component and the two wirings a static render can't reach (the
 * AppShell mount, the profile actions row) are pinned by source, the
 * pattern site-mode-theme.test.ts established for component contracts.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Link, Router, type BaseLocationHook, type BaseSearchHook } from "wouter";
import {
  ENTER_WORLD_CLASSNAME,
  ENTER_WORLD_LABEL,
  ENTER_WORLD_TEST_ID,
  PROFILE_VISIT_WORLD_TEST_ID,
  VISIT_WORLD_LABEL,
  WORLD_ROUTE,
  isWorldRoute,
  shouldShowWorldEntry,
} from "@/lib/world-entry";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const buttonSource = read("./EnterWorldButton.tsx");
const appSource = read("../App.tsx");
const profileSectionsSource = read("./artist/profile-sections.tsx");
const artistPublicSource = read("../pages/artist-public.tsx");

/**
 * Render the shell door exactly as EnterWorldButton builds it — the
 * component is a thin wrapper over these contract pieces (pinned by
 * source below) — as if the visitor were standing on `path`. Returns
 * "" when the visibility rule hides the door, mirroring the component.
 */
function renderDoorAt(path: string): string {
  if (!shouldShowWorldEntry(path)) return "";
  /* A static location hook standing on `path` (wouter's memory hook
     has no server snapshot, so it can't SSR; this one is the same
     Router contract with a fixed location). */
  const hook: BaseLocationHook = () => [path, () => undefined];
  const searchHook: BaseSearchHook = () => "";
  return renderToStaticMarkup(
    createElement(
      Router,
      { hook, searchHook },
      createElement(
        Link,
        {
          href: WORLD_ROUTE,
          "data-testid": ENTER_WORLD_TEST_ID,
          className: ENTER_WORLD_CLASSNAME,
        },
        ENTER_WORLD_LABEL,
      ),
    ),
  );
}

describe("isWorldRoute / shouldShowWorldEntry — the visibility rule", () => {
  it("recognizes the World route and its subpaths", () => {
    expect(isWorldRoute("/world")).toBe(true);
    expect(isWorldRoute("/world/")).toBe(true);
    expect(isWorldRoute("/world?ref=ABC")).toBe(true);
  });

  it("does not match lookalike or ordinary routes", () => {
    expect(isWorldRoute("/")).toBe(false);
    expect(isWorldRoute("/worlds")).toBe(false);
    expect(isWorldRoute("/artist/world")).toBe(false);
    expect(isWorldRoute("/create")).toBe(false);
  });

  it("hides the door only inside the World itself", () => {
    expect(shouldShowWorldEntry("/world")).toBe(false);
    expect(shouldShowWorldEntry("/")).toBe(true);
    expect(shouldShowWorldEntry("/login")).toBe(true);
  });
});

describe("the shell control — renders across representative routes", () => {
  /* One route per family AppShell serves: homepage, a studio page, a
     social page, the public artist profile, a marketing page, an auth
     page. The AppShell mount itself is pinned by source below. */
  const REPRESENTATIVE_ROUTES = [
    "/",
    "/create",
    "/home",
    "/artist/thy-cheat-code",
    "/pricing",
    "/login",
  ];

  it.each(REPRESENTATIVE_ROUTES)(
    "renders on %s with the /world target and the approved label",
    (path) => {
      const html = renderDoorAt(path);
      expect(html).toContain(`data-testid="${ENTER_WORLD_TEST_ID}"`);
      expect(html).toContain(`href="${WORLD_ROUTE}"`);
      expect(html).toContain(ENTER_WORLD_LABEL);
    },
  );

  it("is a same-tab client-side link, not an external door", () => {
    const html = renderDoorAt("/");
    expect(html).toContain("<a ");
    expect(html).not.toContain('target="_blank"');
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
    expect(WORLD_ROUTE).toBe("/world");
    expect(ENTER_WORLD_LABEL).toBe("Enter the World");
  });

  it("carries both themes' shell furniture styling", () => {
    const html = renderDoorAt("/");
    /* Dark: gold on smoked glass, like the floating theme toggle. */
    expect(html).toContain("bg-black/60");
    expect(html).toContain("text-primary");
    /* Light: the toggle's bronze-on-white-glass variants. */
    expect(html).toContain("light:bg-white/80");
    expect(html).toContain("light:text-[#7A5A12]");
    /* Shell furniture placement: fixed, top-left under the toggle. */
    expect(html).toContain("fixed");
    expect(html).toContain("left-4");
  });

  it("does not render on /world itself", () => {
    expect(renderDoorAt("/world")).toBe("");
    expect(renderDoorAt("/world/")).toBe("");
  });

  it("(c) renders for guests — the rule and the component take no auth input", () => {
    /* The renders above mount NO AuthProvider at all: a signed-out
       visitor still gets the door, because the hall admits guests.
       Pin that neither piece ever grows an auth dependency. */
    expect(buttonSource).not.toContain("useAuth");
    expect(buttonSource).not.toContain("AuthContext");
    expect(buttonSource).not.toContain("ProtectedRoute");
    const entrySource = read("../lib/world-entry.ts");
    expect(entrySource).not.toContain("useAuth");
    expect(entrySource).not.toContain("AuthContext");
    expect(entrySource).not.toContain("isAuthenticated");
    expect(renderDoorAt("/dashboard")).toContain(ENTER_WORLD_LABEL);
  });

  it("the component is built from the shared contract, nothing hard-coded", () => {
    expect(buttonSource).toContain('from "@/lib/world-entry"');
    expect(buttonSource).toContain("href={WORLD_ROUTE}");
    expect(buttonSource).toContain("{ENTER_WORLD_LABEL}");
    expect(buttonSource).toContain("className={ENTER_WORLD_CLASSNAME}");
    expect(buttonSource).toContain("data-testid={ENTER_WORLD_TEST_ID}");
    expect(buttonSource).toContain("shouldShowWorldEntry(location)");
    expect(buttonSource).toContain("<Link");
  });

  it("is mounted once in AppShell, beside the floating theme toggle", () => {
    const shell = appSource.slice(appSource.indexOf("function AppShell()"));
    expect(shell).toContain("<EnterWorldButton />");
    expect(shell).toContain("<FloatingThemeToggle />");
    /* AppShell — not AuthedLayout — is the mount, so routes that never
       enter the sidebar layout (auth, marketing, public profiles) get
       the door too. Those routes live in the same AppShell Switch: */
    expect(shell).toContain('<Route path="/login">');
    expect(shell).toContain('<Route path="/artist/:slug">');
    expect(appSource).toContain(
      'import { EnterWorldButton } from "@/components/EnterWorldButton";',
    );
    /* Exactly one mount — no duplicate doors. */
    expect(appSource.match(/<EnterWorldButton \/>/g)).toHaveLength(1);
  });
});

describe("artist profile — the contextual Reverse Door", () => {
  it("(b) the primary actions row carries 'Visit in the World' → /world", () => {
    /* ProfileActions is the row with Follow / Tip Jar / Share. */
    const actions = profileSectionsSource.slice(
      profileSectionsSource.indexOf("export function ProfileActions"),
      profileSectionsSource.indexOf("export function MadeWithBadge"),
    );
    expect(actions).toContain("data-testid={PROFILE_VISIT_WORLD_TEST_ID}");
    expect(actions).toContain("href={WORLD_ROUTE}");
    expect(actions).toContain("{VISIT_WORLD_LABEL}");
    expect(PROFILE_VISIT_WORLD_TEST_ID).toBe("profile-visit-world");
    /* It sits in the same row as the Follow button, after it. */
    expect(actions).toContain('"Following" : "Follow"');
    expect(actions.indexOf("PROFILE_VISIT_WORLD_TEST_ID")).toBeGreaterThan(
      actions.indexOf('"Following" : "Follow"'),
    );
    /* Styled with the profile's own tokens, like Tip Jar beside it —
       so it follows the profile in both site themes. */
    expect(actions).toContain("var(--ap-primary)");
  });

  it("uses the approved wording and the shared /world target", () => {
    expect(VISIT_WORLD_LABEL).toBe("Visit in the World");
    /* The label promises the World, never a per-creator room. */
    expect(VISIT_WORLD_LABEL).not.toMatch(/room/i);
  });

  it("the public profile page renders the actions row", () => {
    expect(artistPublicSource).toContain("<ProfileActions profile={profile} />");
  });
});
