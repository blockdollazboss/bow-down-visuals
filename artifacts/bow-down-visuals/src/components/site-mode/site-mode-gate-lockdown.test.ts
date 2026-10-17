/**
 * site-mode-gate-lockdown.test.ts — Access lock-down Lane 4
 * (audit ~/workspace/access-lockdown/AUDIT.md §4.6, §5.1 Lane 4).
 *
 * Creator custom domains render via SiteModeGate INSTEAD of AppShell —
 * so the AppShell-level GuestGate (Lane 2) must never apply there: on a
 * creator's own domain the profile-storefront IS the site, and a fan
 * mid buy/tip flow must not meet the sign-in wall. These source-contract
 * pins (the pattern site-mode-theme.test.ts established) hold that:
 *
 *  (a) SiteMode's render path never mounts AppShell (and with it the
 *      routed app gate): SiteModeGate returns <SiteMode> INSTEAD of its
 *      children on a resolved creator host, and SiteMode.tsx mounts no
 *      AppShell / guest gate of its own. In App.tsx the gate wraps
 *      <AppShell /> as its children — children render only on the main
 *      app host, never on a creator domain.
 *
 *  (b) The profile surface SiteMode renders still exposes the store +
 *      tip entry points with their routes/links intact:
 *        - store: SiteMode renders <ProfileSections mode="public">,
 *          whose "merch" section is MerchSection — its shop link comes
 *          from merchShopHref (lib/profile-shop-link.ts: /shop/<handle>
 *          or /storefronts, never the owner's /my-shop manager). The
 *          href RESOLUTION behavior itself is already pinned by
 *          src/lib/profile-shop-link.test.ts — not duplicated here.
 *        - tip: SiteMode renders <ProfileActions>, which carries the
 *          Tip Jar link to /tips/<slug> (the public guest-checkout tip
 *          landing, audit §2) when the creator's tip jar is enabled.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const siteModeSource = read("./SiteMode.tsx");
const appSource = read("../../App.tsx");
const profileSectionsSource = read("../artist/profile-sections.tsx");

describe("SiteMode vs the guest gate — the gate never applies on a creator domain (audit §4.6)", () => {
  it("SiteModeGate returns <SiteMode> INSTEAD of its children on a creator host", () => {
    expect(siteModeSource).toContain(
      'if (phase === "site" && slug) return <SiteMode slug={slug} />;',
    );
    // Children (the whole routed app) render only as the fall-through,
    // i.e. on the main app host / an unresolved host.
    const siteReturn = siteModeSource.indexOf('phase === "site"');
    const childrenReturn = siteModeSource.indexOf("return <>{children}</>;");
    expect(siteReturn).toBeGreaterThan(-1);
    expect(childrenReturn).toBeGreaterThan(siteReturn);
  });

  it("SiteMode's own render path mounts no AppShell and no guest gate", () => {
    // Code only — the file's header comment legitimately NAMES AppShell
    // ("renders INSTEAD of <AppShell />"), so strip block comments first.
    const siteModeCode = siteModeSource.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(siteModeCode).not.toContain("<AppShell");
    expect(siteModeCode).not.toContain("AppShell");
    expect(siteModeCode).not.toContain("GuestGate");
    expect(siteModeCode).not.toContain("<ProtectedRoute");
    expect(siteModeCode).not.toContain("public-routes");
  });

  it("in App.tsx, <AppShell /> exists only as SiteModeGate's children", () => {
    expect(appSource).toMatch(/<SiteModeGate>\s*<AppShell \/>\s*<\/SiteModeGate>/);
    // Exactly one AppShell mount in the app root — inside the gate.
    expect(appSource.match(/<AppShell \/>/g) ?? []).toHaveLength(1);
  });
});

describe("SiteMode's profile surface — store + tip entry points intact (audit §4.6)", () => {
  it("SiteMode renders the public profile sections and profile actions", () => {
    expect(siteModeSource).toContain('<ProfileSections profile={profile} mode="public" />');
    expect(siteModeSource).toContain("<ProfileActions profile={profile} />");
  });

  it("store entry point: the merch section SiteMode renders links out via merchShopHref", () => {
    // ProfileSections dispatches the "merch" section to MerchSection…
    expect(profileSectionsSource).toContain('case "merch":');
    expect(profileSectionsSource).toContain("<MerchSection");
    // …whose shop link is resolved by merchShopHref (behavior pinned by
    // src/lib/profile-shop-link.test.ts: /shop/<handle>, else
    // /storefronts, never /my-shop) and labelled as the shop door.
    expect(profileSectionsSource).toContain(
      'import { merchShopHref } from "@/lib/profile-shop-link";',
    );
    expect(profileSectionsSource).toContain("const shopHref = merchShopHref(profile);");
    expect(profileSectionsSource).toContain("Full shop");
    expect(profileSectionsSource).toContain("Visit the shop");
  });

  it("tip entry point: ProfileActions carries the Tip Jar link to /tips/<slug>", () => {
    expect(profileSectionsSource).toContain("profile.tip_jar_enabled");
    expect(profileSectionsSource).toContain(
      "href={`/tips/${encodeURIComponent(profile.slug)}`}",
    );
    expect(profileSectionsSource).toContain("Tip Jar");
  });
});
