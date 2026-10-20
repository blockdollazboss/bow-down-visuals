/**
 * business-desks — Lane 7 (NATIVE-PLAN §3.7) pure-logic pins.
 *
 * Costs are the pages'/registry's own figures in Visual Bucs;
 * payloads mirror the website pages' shapes; parsers are tolerant
 * of the real wire (missing fields degrade, never invent); the
 * folded rows (Release / Scheduler / Coach) read only what their
 * endpoints actually return; the parity follow-on log names every
 * bench v1 leaves behind the transfer.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  BRAND_KIT_GENERATE_COST_VISUAL_BUCS,
  buildBrandKitGeneratePayload,
  brandKitGenerateReady,
  LOGO_MODELS,
  logoModelCost,
  INTRO_COST_VISUAL_BUCS,
  PRESS_KIT_GENERATE_COST_VISUAL_BUCS,
  PRESS_KIT_BIO_REFRESH_COST_VISUAL_BUCS,
  PROMO_GENERATOR_COST_VISUAL_BUCS,
  PROMO_CARDS_COST_VISUAL_BUCS,
  COACH_COST_VISUAL_BUCS,
  parseJobStart,
  jobPollOutcome,
  buildLogoPayload,
  buildIntroPayload,
  parsePressKits,
  firstPressKit,
  pressKitGenerateReady,
  buildPressKitGeneratePayload,
  buildRegenerateBioPayload,
  parseBioPages,
  bioPageStatusLine,
  parseBioAnalytics,
  buildPromoGeneratorPayload,
  parsePromoResult,
  buildPromoCardsPayload,
  parsePromoCards,
  parseReleases,
  releaseStatusCounts,
  releaseDeskLine,
  parseVaultedCount,
  parseScheduledPosts,
  upcomingPosts,
  buildCoachPayload,
  parseCoachTodayAction,
  BUSINESS_NATIVE_FOLLOW_ONS,
} from "./business-desks";

describe("costs — quoted up front, from the pages themselves", () => {
  it("logo tiers are the Logo Maker page's 200 / 100 Visual Bucs", () => {
    expect(LOGO_MODELS.map((m) => [m.key, m.costVisualBucs])).toEqual([
      ["premium", 200],
      ["standard", 100],
    ]);
    expect(logoModelCost("premium")).toBe(200);
    expect(logoModelCost("standard")).toBe(100);
    expect(logoModelCost("unknown")).toBe(200);
  });

  it("intro/outro is 750, press kit 300/100, promo + cards + coach 100", () => {
    expect(INTRO_COST_VISUAL_BUCS).toBe(750);
    expect(PRESS_KIT_GENERATE_COST_VISUAL_BUCS).toBe(300);
    expect(PRESS_KIT_BIO_REFRESH_COST_VISUAL_BUCS).toBe(100);
    expect(PROMO_GENERATOR_COST_VISUAL_BUCS).toBe(100);
    expect(PROMO_CARDS_COST_VISUAL_BUCS).toBe(100);
    expect(COACH_COST_VISUAL_BUCS).toBe(100);
  });
});

describe("job kit — logo / intro start + poll interpretation", () => {
  it("an instant success carries its url; a task start carries its id", () => {
    expect(parseJobStart({ status: "succeeded", url: "https://x/logo.png", creditsRemaining: 42 })).toEqual({
      taskId: null,
      url: "https://x/logo.png",
      creditsRemaining: 42,
    });
    expect(parseJobStart({ taskId: "t-1", creditsRemaining: 7 })).toEqual({
      taskId: "t-1",
      url: null,
      creditsRemaining: 7,
    });
    expect(parseJobStart(null)).toEqual({ taskId: null, url: null, creditsRemaining: null });
  });

  it("poll outcomes settle only on succeeded / failed / cancelled", () => {
    expect(jobPollOutcome({ status: "succeeded", url: "https://x/v.mp4" })).toEqual({
      kind: "succeeded",
      url: "https://x/v.mp4",
      creditsRemaining: null,
    });
    expect(jobPollOutcome({ status: "failed", error: "nope" })).toEqual({ kind: "failed", error: "nope" });
    expect(jobPollOutcome({ status: "cancelled" }).kind).toBe("failed");
    expect(jobPollOutcome({ status: "processing", progress: 40 })).toEqual({ kind: "pending" });
    expect(jobPollOutcome({})).toEqual({ kind: "pending" });
  });
});

describe("brand kit desk verbs (Ring 4: generate / edit / apply in-world)", () => {
  it("generation costs the server's standing 200 Visual Bucs", () => {
    expect(BRAND_KIT_GENERATE_COST_VISUAL_BUCS).toBe(200);
  });

  it("generate payload trims and only sends an industry when typed", () => {
    expect(buildBrandKitGeneratePayload({ brandName: "  King Shark ", vibe: " royal gold " })).toEqual({
      brandName: "King Shark",
      vibe: "royal gold",
    });
    expect(
      buildBrandKitGeneratePayload({ brandName: "KS", vibe: "bold", industry: " music " }),
    ).toEqual({ brandName: "KS", vibe: "bold", industry: "music" });
    expect(buildBrandKitGeneratePayload({ brandName: "KS", vibe: "bold", industry: "  " })).toEqual({
      brandName: "KS",
      vibe: "bold",
    });
  });

  it("readiness mirrors the hub panel: a name and a vibe of 3+ characters", () => {
    expect(brandKitGenerateReady({ brandName: "KS", vibe: "royal" })).toBe(true);
    expect(brandKitGenerateReady({ brandName: "  ", vibe: "royal" })).toBe(false);
    expect(brandKitGenerateReady({ brandName: "KS", vibe: "ab" })).toBe(false);
    expect(brandKitGenerateReady({ brandName: "KS", vibe: "  ab  " })).toBe(false);
  });

  it("the desk component wires the verbs to the website's own endpoints", () => {
    const deskSrc = readFileSync(
      new URL("../../components/world/native/BusinessDesks.tsx", import.meta.url),
      "utf8",
    );
    // Generate: the confirmed-charge POST, priced before it runs.
    expect(deskSrc).toContain('confirmedFetch("/api/brand-kit"');
    expect(deskSrc).toContain("overrideCost: BRAND_KIT_GENERATE_COST_VISUAL_BUCS");
    expect(deskSrc).toContain('overrideFeature: "Brand Kit Generator"');
    expect(deskSrc).toContain("buildBrandKitGeneratePayload(");
    // Tagline pick: the free PUT save through the shared client.
    expect(deskSrc).toContain("saveBrandKit(getAccessToken, { selectedTagline: line })");
    // Apply: the free apply endpoint through the shared client.
    expect(deskSrc).toContain("applyBrandKit(getAccessToken)");
  });

  it("the hub panel edits colors/fonts and saves them through the same PUT", () => {
    const panelSrc = readFileSync(
      new URL("../../components/branding/BrandKitPanel.tsx", import.meta.url),
      "utf8",
    );
    expect(panelSrc).toContain('type="color"');
    expect(panelSrc).toContain("BRAND_KIT_COLOR_ROLES");
    expect(panelSrc).toContain("colors: colors.map(");
    expect(panelSrc).toContain("fonts: fonts.map(");
    // Role picks swap rather than collide (the server requires unique roles).
    expect(panelSrc).toContain("setRoleAt");
  });
});

describe("branding payloads mirror the pages", () => {
  it("logo payload trims, and only sends a tagline when there is one", () => {
    expect(buildLogoPayload({ brandName: "  King Shark ", style: "luxury-gold", model: "premium" })).toEqual({
      brandName: "King Shark",
      style: "luxury-gold",
      model: "premium",
    });
    expect(
      buildLogoPayload({ brandName: "KS", style: "gaming", model: "standard", tagline: " Bow down " }),
    ).toEqual({ brandName: "KS", style: "gaming", model: "standard", tagline: "Bow down" });
  });

  it("intro payload maps the logo to referenceImageUrl, like the page", () => {
    expect(buildIntroPayload({ channelName: " KS ", type: "intro" })).toEqual({ channelName: "KS", type: "intro" });
    expect(
      buildIntroPayload({ channelName: "KS", type: "outro", tagline: "thanks", logoUrl: " https://x/l.png " }),
    ).toEqual({ channelName: "KS", type: "outro", tagline: "thanks", referenceImageUrl: "https://x/l.png" });
  });
});

const KIT = {
  id: "k1",
  handle: "king-shark",
  artist_name: "King Shark",
  tagline: "Bow down",
  bio: "A bio.",
  genre: "Hip-hop",
  location: "Atlanta",
  booking_email: "book@example.com",
  achievements: ["Gold record"],
  press_quotes: [{ quote: "Great", source: "Mag" }, { bad: true }],
  photo_urls: ["https://x/p.jpg", 42],
  top_tracks: [{ title: "Song", url: "https://x/s" }, { url: "https://x/no-title" }],
  is_public: true,
};

describe("press kit parsing + payloads", () => {
  it("parses { kits } tolerantly and drops malformed rows/fields", () => {
    const kits = parsePressKits({ kits: [KIT, { handle: "no-id" }, null] });
    expect(kits).toHaveLength(1);
    expect(kits[0]).toMatchObject({ id: "k1", handle: "king-shark", is_public: true });
    expect(kits[0]!.photo_urls).toEqual(["https://x/p.jpg"]);
    expect(kits[0]!.press_quotes).toEqual([{ quote: "Great", source: "Mag" }]);
    expect(kits[0]!.top_tracks).toEqual([{ title: "Song", url: "https://x/s" }]);
    expect(parsePressKits({})).toEqual([]);
    expect(firstPressKit({ kits: [] })).toBeNull();
    expect(firstPressKit({ kits: [KIT] })!.id).toBe("k1");
  });

  it("generate readiness needs a name and a 3–30 char slugified handle", () => {
    expect(pressKitGenerateReady("King Shark", "")).toBe(true); // slug from name
    expect(pressKitGenerateReady("  ", "king-shark")).toBe(false);
    expect(pressKitGenerateReady("Al", "al")).toBe(false);
    expect(pressKitGenerateReady("Valid Name", "!!!")).toBe(false); // slugifies to nothing
    // slugifyHandle truncates to 30 chars, so a long name still yields a valid handle.
    expect(pressKitGenerateReady("A".repeat(40), "")).toBe(true);
  });

  it("generate payload slugifies and carries the page's empty bench fields", () => {
    const p = buildPressKitGeneratePayload({ artistName: " King Shark ", handle: "King Shark!" });
    expect(p["handle"]).toBe("king-shark");
    expect(p["artist_name"]).toBe("King Shark");
    expect(p["achievements"]).toEqual([]);
    expect(p["top_tracks"]).toEqual([]);
  });

  it("regenerate-bio payload is the kit's achievements + the chosen tone", () => {
    const kit = parsePressKits({ kits: [KIT] })[0]!;
    expect(buildRegenerateBioPayload(kit, "luxury")).toEqual({ achievements: ["Gold record"], tone: "luxury" });
  });
});

describe("promote desk — bio pages + analytics", () => {
  const PAGE = {
    id: "b1",
    slug: "king",
    displayName: "King Shark",
    headline: "Bow down",
    isPublished: true,
    viewCount: 120,
    links: [{ title: "a" }, { title: "b" }],
    url: "https://bowdownvisuals.com/bio/king",
    updatedAt: "2026-10-01T00:00:00Z",
  };

  it("parses pages and counts links; status line is honest about drafts", () => {
    const pages = parseBioPages({ pages: [PAGE, { slug: "no-id" }] });
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ linkCount: 2, isPublished: true, viewCount: 120 });
    expect(bioPageStatusLine(pages[0]!)).toContain("Live at https://");
    expect(bioPageStatusLine({ ...pages[0]!, isPublished: false })).toBe("Draft — not published yet");
    expect(parseBioPages(null)).toEqual([]);
  });

  it("analytics parse requires at least one real number", () => {
    expect(parseBioAnalytics({ views: 10, totalClicks: 3, clicksLast7d: 1 })).toEqual({
      views: 10,
      totalClicks: 3,
      clicksLast7d: 1,
    });
    expect(parseBioAnalytics({ ok: true })).toBeNull();
    expect(parseBioAnalytics({ views: 0 })).toEqual({ views: 0, totalClicks: 0, clicksLast7d: 0 });
  });
});

describe("promote desk — promo generator + promo cards", () => {
  it("generator payload is the promote page's shape", () => {
    expect(
      buildPromoGeneratorPayload({
        featureName: "Creation Hub",
        featureTagline: "Guided workflows",
        featureRoute: "/create?panel=hub",
        contentType: "twitter",
        tone: "hype",
        focus: " new song ",
      }),
    ).toEqual({
      featureName: "Creation Hub",
      featureTagline: "Guided workflows",
      featureRoute: "/create?panel=hub",
      contentType: "twitter",
      tone: "hype",
      focus: "new song",
    });
  });

  it("a result needs a title or a body; extras/hashtags keep only strings", () => {
    expect(parsePromoResult({ error: "x" })).toBeNull();
    expect(
      parsePromoResult({ title: "T", body: "B", extras: ["e", 5], hashtags: ["#a"], cta: "Go" }),
    ).toEqual({ title: "T", body: "B", extras: ["e"], hashtags: ["#a"], cta: "Go" });
  });

  it("cards payload defaults to all three sizes; milestone carries its label", () => {
    const p = buildPromoCardsPayload({ releaseTitle: " Waves ", artistName: " KS ", style: "out-now" });
    expect(p).toMatchObject({ releaseTitle: "Waves", artistName: "KS", sizes: ["1:1", "9:16", "16:9"], attribution: true });
    expect(p["milestoneLabel"]).toBeUndefined();
    expect(buildPromoCardsPayload({ releaseTitle: "W", artistName: "K", style: "milestone" })["milestoneLabel"]).toBe("1M STREAMS");
  });

  it("cards parse drops url-less cards and keeps the caption", () => {
    const { cards, suggestedCaption } = parsePromoCards({
      cards: [{ style: "out-now", size: "1:1", url: "https://x/c.png", width: 1080, height: 1080, platforms: ["instagram"] }, { style: "x" }],
      suggestedCaption: "cap",
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ size: "1:1", platforms: ["instagram"] });
    expect(suggestedCaption).toBe("cap");
  });
});

describe("folded rows — release, scheduler, coach", () => {
  it("releases parse + count by status; the desk line is one honest sentence", () => {
    const rels = parseReleases({
      releases: [
        { id: "r1", title: "A", artistName: "KS", status: "packaged", releaseType: "single", releaseDate: "2026-11-01" },
        { id: "r2", title: "B", artistName: "KS", status: "draft", releaseType: "ep" },
        { id: "r3", title: "C", artistName: "KS", status: "draft", releaseType: "album" },
        { title: "no id" },
      ],
    });
    expect(rels).toHaveLength(3);
    expect(releaseStatusCounts(rels)).toEqual([
      { status: "draft", count: 2 },
      { status: "packaged", count: 1 },
    ]);
    expect(releaseDeskLine(rels, 1)).toBe("3 releases — 2 draft · 1 packaged · 1 in the catalog vault");
    expect(releaseDeskLine([], 0)).toContain("No releases yet");
    expect(parseVaultedCount({ vaults: [{ releaseId: "r1" }, { releaseId: "r2" }] })).toBe(2);
    expect(parseVaultedCount({})).toBe(0);
  });

  it("upcoming posts are scheduled-only, soonest first, limited", () => {
    const posts = parseScheduledPosts({
      posts: [
        { id: "p2", caption: "later", platforms: ["tiktok"], scheduledAt: "2026-10-20T10:00:00Z", status: "scheduled" },
        { id: "p1", caption: "sooner", platforms: ["instagram"], scheduledAt: "2026-10-18T10:00:00Z", status: "scheduled" },
        { id: "p3", caption: "draft", platforms: [], scheduledAt: "2026-10-17T10:00:00Z", status: "draft" },
        { id: "p4", caption: "no time", platforms: [], scheduledAt: null, status: "scheduled" },
      ],
    });
    expect(posts).toHaveLength(3);
    expect(upcomingPosts(posts).map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(upcomingPosts(posts, 1).map((p) => p.id)).toEqual(["p1"]);
  });

  it("coach payload is the coach page's defaults; the action falls back honestly", () => {
    expect(buildCoachPayload()).toEqual({
      niche: "Music",
      platforms: ["youtube", "tiktok"],
      followers: { youtube: 0, tiktok: 0, instagram: 0 },
      cadence: 3,
    });
    const parsed = parseCoachTodayAction({
      moneyMoves: ["Release a single this week"],
      nextAction: { label: "Distribute music", href: "/distribute" },
      creatorState: { songs: 2, latestSongTitle: null, releases: 0, submittedReleases: 0, storeProducts: 0, membershipTiers: 0, earningsCents: 0, tipsVb: 0 },
    });
    expect(parsed).toMatchObject({ label: "Distribute music", href: "/distribute", firstMove: "Release a single this week" });
    expect(parsed!.stateSummary).toContain("2 songs in your library");
    // A plan with no structured nextAction still yields the fallback primary.
    expect(parseCoachTodayAction({ moneyMoves: ["Move"] })!.label).toBe("Distribute music");
    expect(parseCoachTodayAction({})).toBeNull();
    expect(parseCoachTodayAction(null)).toBeNull();
  });
});

describe("parity follow-on log — thorough, each bench named", () => {
  it("covers every bench the task names for this lane", () => {
    const ids = BUSINESS_NATIVE_FOLLOW_ONS.map((f) => f.id);
    for (const required of [
      "release-wizard",
      "scheduler-calendar",
      "bio-page-layout-theme-editors",
      "press-kit-layout-editing",
      "branding-headshots-bench",
      "branding-jewelry-bench",
      "branding-stream-pack-bench",
      "coach-full-page-depth",
      "bio-page-publish-management",
    ]) {
      expect(ids, required).toContain(required);
    }
    for (const f of BUSINESS_NATIVE_FOLLOW_ONS) {
      expect(f.title.startsWith("NATIVE FOLLOW-ON:"), f.id).toBe(true);
      expect(f.benchPath.startsWith("/"), f.id).toBe(true);
      expect(f.note.length, f.id).toBeGreaterThan(20);
    }
    // The promo-cards gap is logged as a gap, not hidden.
    expect(BUSINESS_NATIVE_FOLLOW_ONS.find((f) => f.id === "promo-cards-list-endpoint")!.note).toContain("GAP");
  });
});
