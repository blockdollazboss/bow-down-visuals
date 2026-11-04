import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* Findability fix (2026-10-18): the sidebar's poetic "Thy ___" labels made
   features unfindable — the sidebar search box filters the RENDERED labels,
   so a label that doesn't say "live" can never be found by typing "live".
   These pins hold the real feature names in the nav, the new front doors
   in their home sections, the legacy-route redirects, and the one-website
   shell wrap for the pages the nav now leads to. The shell wrap gained a
   second ring later the same day: sixteen more pages moved inside
   AuthedLayout, and /beats + /shoutouts got their sidebar doors with it.
   The final ring wrapped the big four — /promote, /coach, /academy,
   /branding-kit — including the no-double-host pin for the two pages
   that used to draw the shell-level marketing Cheat Code host. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const sidebar = read("../components/layout/app-sidebar.tsx");
const app = read("../App.tsx");

const LOCALES = ["en", "de", "es", "fr", "it", "pt", "ar", "hi", "ja", "ko"] as const;
const navOf = (loc: string) => readJson(`../locales/${loc}.json`).nav as Record<string, string>;

/* Every nav key whose label this fix names or hangs. */
const WIRED_KEYS = [
  "create", "dashboard", "myProjects", "audioStudio", "hookStudio",
  "thumbnailStudio", "thyBooks", "brandingKit", "goLive", "monetizationCoach",
  "creatorAcademy", "library", "pricing", "visualBucHistory",
  "makeSong", "beatMaker", "earnings", "quests", "allFeatures",
  "memberships", "team", "tips", "community", "liveShopping", "nfcCards",
  "beatsMarketplace", "fanShoutouts",
  /* Stack-200 lane 1: the back-office trio's keys — nav.contracts was
     missing from ALL ten locales before this pass. */
  "contracts", "llcGuide", "copyright",
  /* stack1400 org wave: nav.releaseChecklist stays pinned as a catalog
     key present in all ten locales. It is no longer the Publish door's
     label — the door uses nav.publish. The stack1400 reviewed locale
     pass translated nav.publish into all nine non-en catalogs, so it
     moves into this every-locale list alongside releaseChecklist. */
  "publish", "releaseChecklist",
  "myStudio", "branding", "promote", "social", "getPaid",
] as const;

describe("findability — nav labels are the features' real names", () => {
  it("en labels use the plain feature names", () => {
    const nav = navOf("en");
    expect(nav.create).toBe("Create");
    expect(nav.dashboard).toBe("Dashboard");
    expect(nav.myProjects).toBe("My Projects");
    expect(nav.audioStudio).toBe("Audio Studio");
    expect(nav.hookStudio).toBe("Hook Studio");
    expect(nav.thumbnailStudio).toBe("Thumbnail Studio");
    expect(nav.thyBooks).toBe("Books");
    expect(nav.brandingKit).toBe("Branding Kit");
    expect(nav.goLive).toBe("Go Live");
    expect(nav.monetizationCoach).toBe("Monetization Coach");
    expect(nav.creatorAcademy).toBe("Creator Academy");
    expect(nav.library).toBe("Library");
    expect(nav.pricing).toBe("Pricing");
    expect(nav.visualBucHistory).toBe("Visual Bucs History");
    expect(nav.makeSong).toBe("Make Song");
    expect(nav.beatMaker).toBe("Beat Maker");
    expect(nav.earnings).toBe("Earnings");
    expect(nav.quests).toBe("Quests");
    expect(nav.allFeatures).toBe("All Features");
    expect(nav.beatsMarketplace).toBe("Beats Marketplace");
    expect(nav.fanShoutouts).toBe("Fan Shoutouts");
    expect(nav.publish).toBe("Publish");
    expect(nav.contracts).toBe("Contracts");
    expect(nav.llcGuide).toBe("LLC Guide");
    expect(nav.copyright).toBe("Copyright");
  });

  it("page titles carry the same real names in en", () => {
    const en = readJson("../locales/en.json");
    expect(en.goLive.pageTitle).toBe("Go Live");
    expect(en.brandingKit.pageTitle).toBe("Branding Kit");
    expect(en.brandingKit.title).toBe("Branding Kit");
    expect(en.academy.pageTitle).toBe("Creator Academy");
    expect(en.pricing.pageTitle).toBe("Pricing");
    expect(en.myProjects.pageTitle).toBe("My Projects");
    expect(en.create.title).toBe("Create");
    expect(en.dashboard.metaTitle).toBe("Dashboard");
    expect(en.audioStudio.title).toBe("Audio Studio");
    expect(en.thumbnailStudio.title).toBe("Thumbnail Studio");
    expect(en.library.pageTitle).toBe("Library");
  });

  it("every locale has every wired key, and none of them is a poetic Thy-label", () => {
    for (const loc of LOCALES) {
      const nav = navOf(loc);
      for (const key of WIRED_KEYS) {
        expect(nav[key], `${loc}.nav.${key}`).toBeTruthy();
        expect(nav[key], `${loc}.nav.${key}`).not.toMatch(/^Thy\s/);
      }
    }
  });

  it("the en labels the sidebar search must find contain the searched words", () => {
    const nav = navOf("en");
    const searchable: Array<[string, string]> = [
      ["goLive", "live"],
      ["audioStudio", "audio"],
      ["thumbnailStudio", "thumbnail"],
      ["brandingKit", "brand"],
      ["earnings", "earnings"],
      ["makeSong", "song"],
      ["beatMaker", "beat"],
      ["beatsMarketplace", "beat"],
      ["fanShoutouts", "shoutout"],
      ["monetizationCoach", "coach"],
      ["creatorAcademy", "academy"],
      ["pricing", "pricing"],
      ["myProjects", "projects"],
      ["publish", "publish"],
    ];
    for (const [key, word] of searchable) {
      expect(nav[key].toLowerCase(), `nav.${key}`).toContain(word);
    }
  });
});

describe("findability — the doors are hung in their home sections", () => {
  it("wires each new sidebar entry to its real route with its real-name key", () => {
    const doors: Array<[string, string]> = [
      ["/create?panel=song", "nav.makeSong"],
      ["/audio-studio?tab=aiaudio&sub=beats", "nav.beatMaker"],
      ["/nfc-cards", "nav.nfcCards"],
      ["/live-shopping", "nav.liveShopping"],
      ["/community", "nav.community"],
      /* Stack-28 #44 deliberate pin correction: the Quests door now
         carries the #quests anchor (A1-03) — same route, same key,
         aimed at the widget instead of the top of the dashboard. */
      ["/dashboard#quests", "nav.quests"],
      ["/earnings", "nav.earnings"],
      ["/memberships", "nav.memberships"],
      ["/team", "nav.team"],
      ["/tips", "nav.tips"],
      ["/features", "nav.allFeatures"],
      ["/beats", "nav.beatsMarketplace"],
      ["/shoutouts", "nav.fanShoutouts"],
      /* Stack-200 lane 1: the back-office trio leaves the Coach-only path. */
      ["/contracts", "nav.contracts"],
      ["/llc-guide", "nav.llcGuide"],
      ["/copyright", "nav.copyright"],
    ];
    for (const [href, labelKey] of doors) {
      expect(sidebar, `${href} / ${labelKey}`).toContain(
        `{ href: "${href}", labelKey: "${labelKey}"`,
      );
    }
  });

  it("puts Earnings, Memberships, Team and Tips inside the Get Paid section", () => {
    const getPaid = sidebar.slice(sidebar.indexOf('titleKey: "nav.getPaid"'));
    const section = getPaid.slice(0, getPaid.indexOf("];"));
    for (const href of ["/earnings", "/memberships", "/team", "/tips"]) {
      expect(section).toContain(`href: "${href}"`);
    }
  });

  it("puts the back-office trio (Contracts, LLC Guide, Copyright) inside Get Paid", () => {
    const getPaid = sidebar.slice(sidebar.indexOf('titleKey: "nav.getPaid"'));
    const section = getPaid.slice(0, getPaid.indexOf("];"));
    for (const href of ["/contracts", "/llc-guide", "/copyright"]) {
      expect(section).toContain(`href: "${href}"`);
    }
  });

  it("puts Beats Marketplace in Create and Fan Shoutouts in Social", () => {
    const beatsAt = sidebar.indexOf('href: "/beats"');
    expect(beatsAt).toBeGreaterThan(sidebar.indexOf('titleKey: "nav.create"'));
    expect(beatsAt).toBeLessThan(sidebar.indexOf('titleKey: "nav.branding"'));
    const shoutoutsAt = sidebar.indexOf('href: "/shoutouts"');
    expect(shoutoutsAt).toBeGreaterThan(sidebar.indexOf('titleKey: "nav.social"'));
    expect(shoutoutsAt).toBeLessThan(sidebar.indexOf('titleKey: "nav.getPaid"'));
  });

  it("puts Live Shopping beside Go Live in Promote", () => {
    const goLiveAt = sidebar.indexOf('href: "/go-live"');
    const liveShoppingAt = sidebar.indexOf('href: "/live-shopping"');
    expect(goLiveAt).toBeGreaterThan(-1);
    expect(liveShoppingAt).toBeGreaterThan(goLiveAt);
  });

  it("the sidebar search filters on the rendered (real-name) labels", () => {
    /* Deliberate pin correction (search-truth, Stack1000 lane N5): the
       filter no longer matches the whole typed string as one substring
       of the label — it runs the shared plain-words matcher over a
       haystack that STARTS with the rendered real-name label, so the
       label stays the primary thing searched (this pin's intent) while
       multi-word queries ("get paid") can land at all. */
    expect(sidebar).toContain("matchesQuery(");
    expect(sidebar).toContain("${t(link.labelKey)} ${link.searchTerms ?? \"\"} ${link.href}");
  });

  it("the sidebar search also matches alias terms and routes (Stack-200 lane 1)", () => {
    /* The label alone can't find "stream" (Go Live), "logo" (Branding
       Kit) or an English alias typed in a non-English locale — the
       per-link searchTerms carry those words and the filter reads them.
       Pin correction (Stack1000 N5): the three fields are now composed
       into ONE haystack string for the plain-words matcher instead of
       three separate whole-string includes() checks — the alias words
       below are still the words that make each door findable. */
    expect(sidebar).toContain("${t(link.labelKey)} ${link.searchTerms ?? \"\"} ${link.href}");
    const aliasPins: Array<[string, string]> = [
      ["/go-live", "stream"],
      ["/go-live", "live"],
      ["/create?panel=song", "song"],
      ["/audio-studio?tab=aiaudio&sub=beats", "beat"],
      ["/branding-kit", "brand"],
      ["/branding-kit", "logo"],
      ["/coach", "coach"],
      ["/my-projects", "projects"],
      ["/earnings", "earnings"],
      ["/contracts", "legal"],
      ["/copyright", "copyright"],
    ];
    for (const [href, word] of aliasPins) {
      const at = sidebar.indexOf(`href: "${href}"`);
      expect(at, href).toBeGreaterThan(-1);
      const entry = sidebar.slice(at, sidebar.indexOf("}", at));
      expect(entry, `${href} aliases`).toContain("searchTerms:");
      expect(entry.toLowerCase(), `${href} ~ ${word}`).toContain(word);
    }
    /* Pricing is a footer link: the footer never filters out, so the
       Pricing door stays visible during every search. */
    expect(sidebar).toContain('{ href: "/pricing", labelKey: "nav.pricing"');
  });

  it("every section entry carries alias terms, and the footer pins its aliases too (Stack-200 lane 1 closure)", () => {
    /* No sidebar entry may rely on its label alone: each SECTIONS entry
       carries English searchTerms, so the required alias words (live,
       stream, song, beat, brand, coach, pricing, projects) land in
       every locale. Pricing lives in the footer — it stays visible
       during every search AND carries its alias terms. */
    const sectionsBlock = sidebar.slice(
      sidebar.indexOf("const SECTIONS"),
      sidebar.indexOf("const FOOTER_LINKS"),
    );
    const labelCount = (sectionsBlock.match(/labelKey:/g) ?? []).length;
    const termCount = (sectionsBlock.match(/searchTerms:/g) ?? []).length;
    expect(labelCount).toBeGreaterThan(0);
    expect(termCount).toBe(labelCount);
    const footerBlock = sidebar.slice(
      sidebar.indexOf("const FOOTER_LINKS"),
      sidebar.indexOf("function SidebarSection"),
    );
    for (const href of ["/pricing", "/features", "/credit-history", "/settings", "/admin"]) {
      const at = footerBlock.indexOf(`href: "${href}"`);
      expect(at, href).toBeGreaterThan(-1);
      const entry = footerBlock.slice(at, footerBlock.indexOf("}", at));
      expect(entry, `${href} footer aliases`).toContain("searchTerms:");
    }
    const pricingAt = footerBlock.indexOf('href: "/pricing"');
    const pricingEntry = footerBlock.slice(pricingAt, footerBlock.indexOf("}", pricingAt));
    expect(pricingEntry.toLowerCase()).toContain("pricing");
    expect(pricingEntry.toLowerCase()).toContain("plans");
  });

  it("the retired Thy Vision name survives nowhere — the 404 door and the carousel toast use My Projects", () => {
    /* Stack-200 lane 1 closure: nav.myProjects was renamed on the
       Oct-18 pass, but two non-sidebar strings kept the poetic name —
       notFound.myProjects (the 404 page's My Projects button) in 9 of
       10 catalogs and carouselMaker.exportDone ("saved to Thy Vision")
       in all 10. Both now carry each locale's real My Projects name. */
    for (const loc of LOCALES) {
      const cat = readJson(`../locales/${loc}.json`);
      expect(cat.notFound.myProjects, `${loc}.notFound.myProjects`).toBe(cat.nav.myProjects);
      expect(
        cat.carouselMaker.exportDone,
        `${loc}.carouselMaker.exportDone`,
      ).toContain(cat.nav.myProjects);
      expect(read(`../locales/${loc}.json`), `${loc} raw`).not.toContain("Thy Vision");
    }
    expect(readJson("../locales/en.json").notFound.myProjects).toBe("My Projects");
  });
});

describe("org wave (stack1400) — the §1b missing-doors census", () => {
  /* Audit §1b/§5-rank-3 listed 14 signed-in surfaces as having no sidebar
     door. Re-verified against this tree: 13 already had doors in their
     home sections (the 2026-10-18 findability pass + Stack-200 lane 1
     banked them); /publish was the only true orphan. These pins hold the
     whole census so no door can silently fall off again. */
  const CENSUS: Array<{ href: string; section: string }> = [
    { href: "/earnings", section: "nav.getPaid" },
    { href: "/team", section: "nav.getPaid" },
    { href: "/contracts", section: "nav.getPaid" },
    { href: "/copyright", section: "nav.getPaid" },
    { href: "/llc-guide", section: "nav.getPaid" },
    { href: "/tips", section: "nav.getPaid" },
    { href: "/memberships", section: "nav.getPaid" },
    /* Fan Shoutouts' door was banked in Social (pinned above) — it has
       a door; the census records where it actually hangs. */
    { href: "/shoutouts", section: "nav.social" },
    { href: "/community", section: "nav.social" },
    { href: "/beats", section: "nav.create" },
    { href: "/nfc-cards", section: "nav.branding" },
    { href: "/live-shopping", section: "nav.promote" },
    { href: "/publish", section: "nav.promote" },
  ];
  const SECTION_ORDER = [
    "nav.myStudio", "nav.create", "nav.branding",
    "nav.promote", "nav.social", "nav.getPaid",
  ];
  const sectionBlock = (titleKey: string) => {
    const at = sidebar.indexOf(`titleKey: "${titleKey}"`);
    expect(at, titleKey).toBeGreaterThan(-1);
    const next = SECTION_ORDER.map((k) => sidebar.indexOf(`titleKey: "${k}"`, at + 1))
      .filter((i) => i > at);
    const end = next.length > 0 ? Math.min(...next) : sidebar.indexOf("const FOOTER_LINKS");
    return sidebar.slice(at, end);
  };

  it("every census surface is a real route in App.tsx", () => {
    for (const { href } of [...CENSUS, { href: "/features", section: "footer" }]) {
      expect(app, href).toContain(`<Route path="${href}">`);
    }
  });

  it("every census door renders in its home section and links to its route", () => {
    for (const { href, section } of CENSUS) {
      expect(sectionBlock(section), `${href} in ${section}`).toContain(`href: "${href}"`);
    }
    const footerBlock = sidebar.slice(
      sidebar.indexOf("const FOOTER_LINKS"),
      sidebar.indexOf("function SidebarSection"),
    );
    expect(footerBlock, "/features in the sidebar footer").toContain('href: "/features"');
    expect(footerBlock).toContain('labelKey: "nav.allFeatures"');
  });

  it("the Publish door — the one true orphan — hangs in Promote with publish aliases", () => {
    const promote = sectionBlock("nav.promote");
    expect(promote).toContain('{ href: "/publish", labelKey: "nav.publish"');
    const at = sidebar.indexOf('href: "/publish"');
    const entry = sidebar.slice(at, sidebar.indexOf("}", at));
    expect(entry).toContain("searchTerms:");
    expect(entry.toLowerCase()).toContain("publish");
  });

  it("renders /publish inside AuthedLayout, so the authed sidebar door leads somewhere real", () => {
    const shellAt = app.indexOf("<AuthedLayout>");
    expect(app.slice(shellAt), "/publish inside shell").toContain('<Route path="/publish">');
    expect(app.slice(0, shellAt), "/publish not outside shell").not.toContain('<Route path="/publish">');
  });
});

describe("findability — legacy routes redirect, wired pages live in the shell", () => {
  it("redirects /broadcast to /go-live and /video-studio to /video-editor", () => {
    expect(app).toContain('<Route path="/broadcast"><Redirect to="/go-live" /></Route>');
    expect(app).toContain('<Route path="/video-studio"><Redirect to="/video-editor" /></Route>');
    expect(app).not.toContain("pages/broadcast");
    expect(app).not.toContain("pages/video-studio");
  });

  it("renders the wired money doors and the feature registry inside AuthedLayout", () => {
    const shellAt = app.indexOf("<AuthedLayout>");
    expect(shellAt).toBeGreaterThan(-1);
    const inShell = app.slice(shellAt);
    const outsideShell = app.slice(0, shellAt);
    for (const route of ["/earnings", "/memberships", "/team", "/tips", "/nfc-cards", "/features"]) {
      expect(inShell, `${route} inside shell`).toContain(`<Route path="${route}">`);
      expect(outsideShell, `${route} not outside shell`).not.toContain(`<Route path="${route}">`);
    }
  });

  it("renders the second ring of pages inside AuthedLayout (shell wrap, 2026-10-18)", () => {
    const shellAt = app.indexOf("<AuthedLayout>");
    expect(shellAt).toBeGreaterThan(-1);
    const inShell = app.slice(shellAt);
    const outsideShell = app.slice(0, shellAt);
    for (const route of [
      "/hooks", "/scheduler", "/analytics-hub", "/referrals", "/press-kit",
      "/email-list", "/collabs", "/contests", "/storefronts", "/my-shop",
      "/arcade", "/party", "/copyright", "/llc-guide", "/beats", "/shoutouts",
    ]) {
      expect(inShell, `${route} inside shell`).toContain(`<Route path="${route}">`);
      expect(outsideShell, `${route} not outside shell`).not.toContain(`<Route path="${route}">`);
    }
  });

  it("renders the big four inside AuthedLayout (shell wrap, final ring, 2026-10-18)", () => {
    const shellAt = app.indexOf("<AuthedLayout>");
    expect(shellAt).toBeGreaterThan(-1);
    const inShell = app.slice(shellAt);
    const outsideShell = app.slice(0, shellAt);
    for (const route of ["/promote", "/coach", "/academy", "/branding-kit"]) {
      expect(inShell, `${route} inside shell`).toContain(`<Route path="${route}">`);
      expect(outsideShell, `${route} not outside shell`).not.toContain(`<Route path="${route}">`);
    }
  });

  it("keeps the six branding-kit redirect aliases landing on ?tab= routes", () => {
    for (const alias of [
      '<Route path="/logo-maker"><Redirect to="/branding-kit?tab=logo" /></Route>',
      '<Route path="/intros-outros"><Redirect to="/branding-kit?tab=intros" /></Route>',
      '<Route path="/stream-pack"><Redirect to="/branding-kit?tab=stream" /></Route>',
      '<Route path="/branding-shop"><Redirect to="/branding-kit?tab=shop" /></Route>',
      '<Route path="/jewelry"><Redirect to="/branding-kit?tab=jewelry" /></Route>',
    ]) {
      expect(app, alias).toContain(alias);
    }
    expect(app).toContain('to="/branding-kit?tab=shop&subtab=merch"');
  });

  it("never double-hosts Thy Cheat Code on /coach, /academy or /brand-deals (no-double-host pin)", () => {
    /* The shell renders a marketing ThyCheatCodeHost for the routes in
       marketingCoachRoute AND an in-main host inside AuthedLayout. A
       wrapped page still listed there would render the host twice. */
    const listAt = app.indexOf("const marketingCoachRoute = [");
    expect(listAt).toBeGreaterThan(-1);
    const list = app.slice(listAt, app.indexOf("]", listAt));
    expect(list).not.toContain('"/coach"');
    expect(list).not.toContain('"/academy"');
    /* stack1400 org wave: /brand-deals moved inside AuthedLayout, so it
       leaves the marketing list too — the shell's in-main host is his
       one host there now, exactly like /coach and /academy. */
    expect(list).not.toContain('"/brand-deals"');
    for (const kept of ['"/pricing"', '"/shows"']) {
      expect(list, `${kept} keeps the marketing host`).toContain(kept);
    }
  });

  it("drops the full-viewport roots the shell panel makes redundant (big four)", () => {
    /* Inside the content panel a min-h-screen root forces a viewport-tall
       block mid-page (dead scroll). The wrapped pages and the roots
       embedded in them shed it; the panel supplies the min-height. */
    for (const page of ["coach", "academy", "branding-kit"]) {
      expect(read(`../pages/${page}.tsx`), `${page} root`).not.toContain(
        '<div className="min-h-screen bg-black text-white">',
      );
    }
    /* The guides + branding-shop surfaces are components/ modules now
       (stack100 A5) — the same embedded-root rule, read at their new
       homes. */
    for (const [label, mod] of [
      ["guides", "../components/courses/Guides.tsx"],
      ["branding-shop", "../components/branding/BrandingShop.tsx"],
    ] as const) {
      expect(read(mod), `${label} root`).not.toContain(
        '<div className="min-h-screen bg-black text-white">',
      );
    }
    expect(read("../pages/promote.tsx")).not.toContain("min-h-screen ${isLight");
    const jewelry = read("../components/branding/JewelryStudio.tsx");
    expect(jewelry).not.toContain("min-h-screen text-[#2A1E07]");
    expect(jewelry).not.toContain("min-h-screen bg-black text-zinc-100");
    /* Coach's chip-shift <style> hack is retired with the wrap: inside the
       shell the chip sits in <main>, right of the sidebar, clear of the
       fixed theme toggle it was dodging at the viewport's top-left. */
    const coach = read("../pages/coach.tsx");
    expect(coach).not.toContain("div:has(> button > span > span.tcc-accent)");
    expect(coach).not.toContain("margin-left: 3.5rem");
    /* The standalone page wrappers of the embedded branding tools keep
       their own roots — only the embedded roots were stripped. */
    for (const page of ["logo-maker", "intros-outros", "stream-pack"]) {
      expect(read(`../pages/${page}.tsx`), `${page} standalone root kept`).toContain(
        '<div className="min-h-screen bg-black text-white">',
      );
    }
  });
});
