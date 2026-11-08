/**
 * c21-one-door.test.ts — C-21 one-door consolidation pins (owner ruling
 * Nov 5 2026: "Do it — one door: Brand Deals").
 *
 * Brand Deals is the only visible sponsors front door:
 *  - the former Sponsor Dashboard page is the hub's Manage Deals tab,
 *  - the former Post a Deal page is the hub's Post a Deal tab,
 *  - /sponsors/dashboard, /sponsors/post and /sponsor-dashboard redirect
 *    into those tabs (deep-link safe, bookmarks keep working),
 *  - the deal-detail page /sponsors/:id KEEPS WORKING (notifications and
 *    Stripe escrow returns carry those links),
 *  - the Pipeline keeps its own data and gains its honest label:
 *    "My Outreach Pipeline — self-found / off-platform deals".
 *
 * These pins are source/behavior level, in the house style: if a future
 * stack resurrects a second sponsors door or drops a redirect, this
 * file goes red before the owner has to notice.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ROUTE_MATRIX } from "@/lib/public-routes";
import { resolveGateVerdict } from "@/lib/guest-gate-verdict";

const srcRoot = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(srcRoot, rel), "utf8");

const appSource = read("App.tsx");
const hubSource = read("pages/brand-deals.tsx");
const dashboardPanel = read("components/sponsors/SponsorDashboardPanel.tsx");
const postPanel = read("components/sponsors/PostDealPanel.tsx");

const SIGNED_IN = { user: { id: "owner-1" }, loading: false };

describe("C-21: the retired routes redirect into Brand Deals tabs", () => {
  it("App.tsx redirects post + dashboard + the legacy alias into their tabs", () => {
    expect(appSource).toContain(
      '<Route path="/sponsors/post"><Redirect to="/brand-deals?tab=post" /></Route>',
    );
    expect(appSource).toContain(
      '<Route path="/sponsors/dashboard"><Redirect to="/brand-deals?tab=manage" /></Route>',
    );
    expect(appSource).toContain(
      '<Route path="/sponsor-dashboard"><Redirect to="/brand-deals?tab=manage" /></Route>',
    );
  });

  it("the route matrix agrees, entry for entry", () => {
    const byPath = new Map(ROUTE_MATRIX.map((e) => [e.path, e]));
    expect(byPath.get("/sponsors/post")).toMatchObject({
      disposition: "redirect",
      redirectTo: "/brand-deals?tab=post",
    });
    expect(byPath.get("/sponsors/dashboard")).toMatchObject({
      disposition: "redirect",
      redirectTo: "/brand-deals?tab=manage",
    });
    expect(byPath.get("/sponsor-dashboard")).toMatchObject({
      disposition: "redirect",
      redirectTo: "/brand-deals?tab=manage",
    });
    expect(byPath.get("/sponsors/:id")?.disposition).toBe("locked");
  });

  it("the gate verdict lands deep links on the right tabs (signed in)", () => {
    expect(resolveGateVerdict("/sponsors/dashboard", "", SIGNED_IN)).toEqual({
      kind: "redirect",
      to: "/brand-deals?tab=manage",
    });
    expect(resolveGateVerdict("/sponsors/post", "", SIGNED_IN)).toEqual({
      kind: "redirect",
      to: "/brand-deals?tab=post",
    });
    expect(resolveGateVerdict("/sponsor-dashboard", "", SIGNED_IN)).toEqual({
      kind: "redirect",
      to: "/brand-deals?tab=manage",
    });
  });

  it("the standalone page files are gone and nothing imports them", () => {
    expect(existsSync(path.join(srcRoot, "pages/sponsor-dashboard.tsx"))).toBe(false);
    expect(existsSync(path.join(srcRoot, "pages/sponsors-post.tsx"))).toBe(false);
    expect(appSource).not.toContain("pages/sponsor-dashboard");
    expect(appSource).not.toContain("pages/sponsors-post");
  });
});

describe("C-21: deal detail stays a working page", () => {
  it("/sponsors/:id still routes to the detail page behind auth", () => {
    expect(appSource).toContain(
      '<Route path="/sponsors/:id"><ProtectedRoute><SponsorDealDetail /></ProtectedRoute></Route>',
    );
    expect(existsSync(path.join(srcRoot, "pages/sponsor-deal-detail.tsx"))).toBe(true);
  });

  it("the panels still send both parties to the deal page", () => {
    expect(dashboardPanel).toContain("href={`/sponsors/${d.id}`}");
    expect(dashboardPanel).toContain("href={`/sponsors/${a.deal_id}`}");
    expect(postPanel).toContain("`/sponsors/${data.deal.id}`");
  });
});

describe("C-21: Brand Deals carries the Manage + Post tabs", () => {
  it("the tab state accepts ?tab=manage and ?tab=post deep links", () => {
    expect(hubSource).toContain('forced === "manage"');
    expect(hubSource).toContain('forced === "post"');
  });

  it("the tab bar offers Manage deals and Post a deal", () => {
    expect(hubSource).toContain('t("brandDeals.tabs.manage"');
    expect(hubSource).toContain('t("brandDeals.tabs.post"');
  });

  it("the tabs render the folded-in panels", () => {
    expect(hubSource).toContain("<SponsorDashboardPanel");
    expect(hubSource).toContain("<PostDealPanel");
    expect(hubSource).toContain('mainTab === "manage"');
    expect(hubSource).toContain('mainTab === "post"');
  });

  it("the hub itself no longer links out to the retired surfaces", () => {
    expect(hubSource).not.toContain('href="/sponsors/dashboard"');
    expect(hubSource).not.toContain('href="/sponsors/post"');
  });
});

describe("C-21: panel content parity with the retired pages", () => {
  it("Manage Deals reads the same dashboard endpoint with the same three views", () => {
    expect(dashboardPanel).toContain('fetch("/api/sponsors/dashboard"');
    expect(dashboardPanel).toContain('t("sponsorDashboard.tabMyDeals")');
    expect(dashboardPanel).toContain('t("sponsorDashboard.tabMyApplications")');
    expect(dashboardPanel).toContain('t("sponsorDashboard.tabEarnings")');
  });

  it("Post a Deal keeps the same rail, the same 500 charge, the same landing", () => {
    /* Stack-300 A6: the 500 now reads the shared credit-cost registry
       (pinned against the rail) instead of a second typed copy. */
    expect(postPanel).toContain('const POST_COST = getCreditCost("/api/sponsors/deals")?.cost ?? 500;');
    expect(postPanel).toContain('confirmedFetch("/api/sponsors/deals"');
    expect(postPanel).toContain('fetch("/api/sponsors/can-spend"');
  });
});

describe("C-21: no live door still points at the retired surfaces", () => {
  const doorFiles: Record<string, string> = {
    "pages/coach.tsx": read("pages/coach.tsx"),
    "components/artist/SponsorCreatorSection.tsx": read(
      "components/artist/SponsorCreatorSection.tsx",
    ),
    "pages/sponsor-deal-detail.tsx": read("pages/sponsor-deal-detail.tsx"),
    "components/layout/app-sidebar.tsx": read("components/layout/app-sidebar.tsx"),
  };

  it("coach, profile sponsorship, deal detail and the sidebar use the one door", () => {
    for (const [file, src] of Object.entries(doorFiles)) {
      expect(src, file).not.toContain('"/sponsors/dashboard"');
      expect(src, file).not.toContain('"/sponsors/post"');
      expect(src, file).not.toContain("'/sponsors/dashboard'");
      expect(src, file).not.toContain("'/sponsors/post'");
    }
    expect(doorFiles["pages/coach.tsx"]).toContain('href: "/brand-deals?tab=manage"');
    expect(
      doorFiles["components/artist/SponsorCreatorSection.tsx"],
    ).toContain('href="/brand-deals?tab=manage"');
  });
});

describe("C-21: the Pipeline carries its honest label in every locale", () => {
  const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];
  const catalogs = new Map(
    LOCALES.map((loc) => [
      loc,
      JSON.parse(read(`locales/${loc}.json`)) as Record<string, any>,
    ]),
  );

  it("English carries the exact ruled label", () => {
    const en = catalogs.get("en")!;
    expect(en.outreach.pipelineTitle).toBe(
      "My Outreach Pipeline — self-found / off-platform deals",
    );
    expect(en.wave8.sponsors.title).toBe("My Outreach Pipeline");
    expect(en.brandDeals.tabs.manage).toBe("Manage deals");
    expect(en.brandDeals.tabs.post).toBe("Post a deal");
  });

  it("every locale carries the new tab labels and the pipeline label", () => {
    for (const [loc, cat] of catalogs) {
      expect(cat.brandDeals.tabs.manage, loc).toBeTruthy();
      expect(cat.brandDeals.tabs.post, loc).toBeTruthy();
      expect(cat.outreach.pipelineTitle, loc).toBeTruthy();
      expect(cat.wave8.sponsors.title, loc).toBeTruthy();
      expect(cat.worldBoards.sbSponsorTitle, loc).toBeTruthy();
      expect(cat.sponsorDashboard.eyebrow, loc).toBeTruthy();
    }
  });
});
