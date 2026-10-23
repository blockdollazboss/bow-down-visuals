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
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
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
  HEADSHOT_COST_VISUAL_BUCS,
  HEADSHOT_FLOWS,
  HEADSHOT_PRESETS,
  HEADSHOT_MODELS,
  buildHeadshotPayload,
  headshotReady,
  parseHeadshotFailure,
  STREAM_PACK_COST_VISUAL_BUCS,
  STREAM_PACK_THEMES,
  STREAM_PACK_ASSETS,
  streamPackGenerateReady,
  buildStreamPackGeneratePayload,
  parseStreamPackGenerate,
  streamPackThemeLabel,
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
  BIO_PAGE_THEMES,
  BIO_PUBLISH_COST_VISUAL_BUCS,
  bioDraftFromPage,
  bioPublishBlocker,
  buildBioSavePayload,
  emptyBioDraft,
  isBioAllowedUrl,
  parseBioPageFull,
  parseBioPublishResult,
  validateBioDraft,
  type BioPageDraft,
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
  pressKitDraftFromKit,
  validatePressKitDraft,
  buildPressKitSavePayload,
  pressKitPublicPath,
  brandKitDraftFromKit,
  validateBrandKitDraft,
  buildBrandKitSavePayload,
  setBrandKitColorRole,
  nextBrandKitColor,
  COACH_NICHES,
  COACH_PLATFORMS,
  defaultCoachInputs,
  coachFinalNiche,
  validateCoachInputs,
  buildMoneySnapshot,
  parseMoneyEntries,
  BUSINESS_NATIVE_FOLLOW_ONS,
} from "./business-desks";
import type { BrandKit } from "@/lib/brand-kit";

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

  it("headshot is 100 — the studio component, the route constant and the registry agree", () => {
    expect(HEADSHOT_COST_VISUAL_BUCS).toBe(100);
  });

  it("stream pack is 100 — the route constant and the registry agree", () => {
    expect(STREAM_PACK_COST_VISUAL_BUCS).toBe(100);
    const route = readFileSync(
      new URL("../../../../api-server/src/routes/generate/stream-pack.ts", import.meta.url),
      "utf8",
    );
    /* The server's charge: STREAM_PACK_CREDIT_COST, env-overridable,
       defaulting to 100 — and the catalog endpoint serves the same
       constant to the website page's picker. */
    expect(route).toContain('Number(process.env["STREAM_PACK_CREDITS_PER_IMAGE"]) || 100');
    const registry = readFileSync(new URL("../credit-costs.ts", import.meta.url), "utf8");
    expect(registry).toContain('"/api/stream-pack/generate": { cost: 100, feature: "Stream Pack Generator" }');
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

describe("promote desk — link-in-bio full editing (#59)", () => {
  const FULL = {
    pages: [
      {
        id: "b1",
        slug: "king",
        displayName: "King Shark",
        headline: "Bow down",
        bio: "Creator.",
        avatarUrl: "https://cdn.example/me.png",
        links: [{ title: "Shop", url: "/shop", icon: "shopping-bag" }],
        socials: { instagram: "https://instagram.com/king", tiktok: "" },
        theme: "midnight-gold",
        featured: [{ label: "Latest", url: "/track/1", kind: "track" }],
        tipJarUrl: null,
        isPublished: false,
        viewCount: 9,
        url: "https://bowdownvisuals.com/bio/king",
        updatedAt: "2026-10-01T00:00:00Z",
      },
    ],
  };

  it("parses the full editable page from both the list and a save response", () => {
    const full = parseBioPageFull(FULL)!;
    expect(full.theme).toBe("midnight-gold");
    expect(full.links).toEqual([{ title: "Shop", url: "/shop", icon: "shopping-bag" }]);
    expect(full.socials.instagram).toBe("https://instagram.com/king");
    expect(full.socials.youtube).toBe("");
    expect(full.featuredCount).toBe(1);
    const saved = parseBioPageFull({ ok: true, page: FULL.pages[0] })!;
    expect(saved.id).toBe("b1");
    expect(parseBioPageFull({ pages: [] })).toBeNull();
    expect(parseBioPageFull(null)).toBeNull();
  });

  it("draft round-trips through the save payload in the route's own shape", () => {
    const draft = bioDraftFromPage(parseBioPageFull(FULL)!);
    const payload = buildBioSavePayload(draft);
    expect(payload).toMatchObject({
      displayName: "King Shark",
      slug: "king",
      theme: "midnight-gold",
      avatarUrl: "https://cdn.example/me.png",
      links: [{ title: "Shop", url: "/shop", icon: "shopping-bag" }],
    });
    expect((payload["socials"] as Record<string, string>).instagram).toBe("https://instagram.com/king");
    // Blank rows drop; an empty slug is omitted entirely.
    const blank = buildBioSavePayload({ ...emptyBioDraft(), displayName: "New", links: [{ title: "", url: "", icon: "link" }] });
    expect(blank["links"]).toEqual([]);
    expect("slug" in blank).toBe(false);
  });

  it("validation mirrors the route: name, slug shape, allowed URLs, publish blockers", () => {
    const base: BioPageDraft = {
      ...emptyBioDraft(),
      displayName: "King",
      slug: "king",
      links: [{ title: "Shop", url: "/shop", icon: "link" }],
    };
    expect(validateBioDraft(base)).toBeNull();
    expect(validateBioDraft({ ...base, displayName: " " })).toContain("display name");
    expect(validateBioDraft({ ...base, slug: "Bad Slug!" })).toContain("slug");
    expect(validateBioDraft({ ...base, links: [{ title: "X", url: "javascript:alert(1)", icon: "link" }] })).toContain("real link");
    expect(validateBioDraft({ ...base, links: [{ title: "", url: "https://x.example", icon: "link" }] })).toContain("title");
    expect(isBioAllowedUrl("/shop")).toBe(true);
    expect(isBioAllowedUrl("//evil.example")).toBe(false);
    expect(isBioAllowedUrl("mailto:hi@example.com")).toBe(true);
    expect(bioPublishBlocker({ ...base, links: [] })).toContain("at least one link");
    expect(bioPublishBlocker(base)).toBeNull();
    expect(BIO_PUBLISH_COST_VISUAL_BUCS).toBe(100);
    expect(BIO_PAGE_THEMES.map((t) => t.key)).toEqual(["gold-royal", "midnight-gold", "onyx-minimal"]);
  });

  it("publish result parses; the editor rides the real rails (source pins)", () => {
    expect(parseBioPublishResult({ ok: true, url: "https://bowdownvisuals.com/bio/king", slug: "king" })).toEqual({
      url: "https://bowdownvisuals.com/bio/king",
      slug: "king",
    });
    const desk = readFileSync(new URL("../../components/world/native/BusinessDesks.tsx", import.meta.url), "utf8");
    expect(desk).toContain('data-testid="world-bio-editor"');
    expect(desk).toContain('data-testid="world-bio-publish"');
    expect(desk).toContain("confirmedFetch(`/api/bio-publish/${page.id}`");
    expect(desk).toContain("`/api/bio-pages/${page.id}/unpublish`");
    expect(desk).toContain('data-testid="world-bio-link-add"');
    expect(desk).toContain('data-testid="world-bio-theme"');
    expect(desk).toContain('data-testid="world-bio-slug"');
    expect(desk).toContain('data-testid="world-bio-avatar"');
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

  it("cards parse carries the history record id — null when the record didn't land", () => {
    const withId = parsePromoCards({
      cards: [{ id: "99999999-9999-4999-8999-000000000001", style: "out-now", size: "1:1", url: "https://x/c.png" }],
    });
    expect(withId.cards[0]!.id).toBe("99999999-9999-4999-8999-000000000001");
    const without = parsePromoCards({
      cards: [{ id: null, style: "out-now", size: "1:1", url: "https://x/c.png" }, { style: "out-now", size: "9:16", url: "https://x/d.png" }],
    });
    expect(without.cards.map((c) => c.id)).toEqual([null, null]);
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

  it("coach payload with no answers is the coach page's opening state, snapshot null", () => {
    expect(buildCoachPayload()).toEqual({
      niche: "Music",
      platforms: ["youtube", "tiktok"],
      followers: { youtube: 0, tiktok: 0, instagram: 0 },
      cadence: 3,
      moneySnapshot: null,
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

describe("headshots bench — the studio's rail, native at the Branding Kit Desk", () => {
  it("flows, presets and engines are the page's own, keys exactly as the rail names them", () => {
    expect(HEADSHOT_FLOWS.map((f) => f.key)).toEqual(["autopilot", "preset", "manual"]);
    expect(HEADSHOT_PRESETS.map((p) => p.key)).toEqual(["studio", "stage", "street", "luxury"]);
    expect(HEADSHOT_MODELS.map((m) => [m.key, m.label])).toEqual([
      ["nano-banana-2.1", "Turbo Render"],
      ["ideogram-4.0", "Portrait Render"],
    ]);
  });

  it("payload mirrors the page: preset only in preset flow, words only in manual, face ref trimmed-or-null", () => {
    expect(buildHeadshotPayload({ flow: "autopilot", preset: "studio", promptText: "", model: "nano-banana-2.1" })).toEqual({
      mode: "autopilot",
      model: "nano-banana-2.1",
      referenceImageUrl: null,
    });
    expect(buildHeadshotPayload({ flow: "preset", preset: "luxury", promptText: "ignored", model: "ideogram-4.0" })).toEqual({
      mode: "preset",
      model: "ideogram-4.0",
      referenceImageUrl: null,
      preset: "luxury",
    });
    expect(
      buildHeadshotPayload({ flow: "manual", preset: "stage", promptText: "  noir portrait, hard shadows ", model: "nano-banana-2.1", referenceImageUrl: " https://x/me.jpg " }),
    ).toEqual({
      mode: "manual",
      model: "nano-banana-2.1",
      referenceImageUrl: "https://x/me.jpg",
      promptText: "noir portrait, hard shadows",
    });
    expect(
      buildHeadshotPayload({ flow: "autopilot", preset: "studio", promptText: "", model: "nano-banana-2.1", referenceImageUrl: "   " }),
    ).toEqual({ mode: "autopilot", model: "nano-banana-2.1", referenceImageUrl: null });
  });

  it("the generate gate is the page's: manual needs words, the other flows are ready", () => {
    expect(headshotReady("autopilot", "")).toBe(true);
    expect(headshotReady("preset", "")).toBe(true);
    expect(headshotReady("manual", "   ")).toBe(false);
    expect(headshotReady("manual", "a look")).toBe(true);
  });

  it("a success reads through the shared job interpreter — the rail answers synchronously", () => {
    expect(parseJobStart({ taskId: "headshot-1", status: "succeeded", url: "https://x/h.png", creditCost: 100 })).toEqual({
      taskId: "headshot-1",
      url: "https://x/h.png",
      creditsRemaining: null,
    });
  });

  it("failures sort honestly: credits / provider-down / failed — and a 2xx is no failure", () => {
    expect(parseHeadshotFailure(200, { status: "succeeded", url: "https://x/h.png" })).toBeNull();
    expect(parseHeadshotFailure(402, { error: "out_of_credits", message: "Not enough Visual Bucs." })).toEqual({
      kind: "credits",
      message: "Not enough Visual Bucs.",
    });
    expect(parseHeadshotFailure(400, { code: "out_of_credits" })!.kind).toBe("credits");
    expect(parseHeadshotFailure(503, { error: "AI Headshots are not connected.", code: "provider_not_connected" })).toEqual({
      kind: "provider",
      message: "AI Headshots are not connected.",
    });
    expect(parseHeadshotFailure(500, { code: "provider_not_connected" })!.kind).toBe("provider");
    expect(parseHeadshotFailure(500, { error: "generation blew up" })).toEqual({ kind: "failed", message: "generation blew up" });
    expect(parseHeadshotFailure(400, { error: "Invalid headshot request." })).toEqual({
      kind: "failed",
      message: "Invalid headshot request.",
    });
    expect(parseHeadshotFailure(500, null)).toEqual({ kind: "failed", message: null });
  });
});

describe("stream pack bench — the page's rails, native at the Branding Kit Desk", () => {
  it("themes and assets are the server catalog's own — 6 themes, 12 graphics in the page's groups", () => {
    expect(STREAM_PACK_THEMES.map((t) => [t.key, t.label])).toEqual([
      ["gold-luxury", "Gold Luxury"],
      ["neon-cyber", "Neon Cyber"],
      ["crimson-royal", "Crimson Royal"],
      ["emerald-empire", "Emerald Empire"],
      ["violet-noir", "Violet Noir"],
      ["arctic-frost", "Arctic Frost"],
    ]);
    expect(STREAM_PACK_ASSETS.map((a) => [a.key, a.label, a.group])).toEqual([
      ["webcam-frame", "Webcam Frame", "Overlays"],
      ["chat-frame", "Chat Box Frame", "Overlays"],
      ["alert-follower", "New Follower Alert", "Alerts"],
      ["alert-subscriber", "New Subscriber Alert", "Alerts"],
      ["alert-donation", "Donation Alert", "Alerts"],
      ["panel-about", "About Panel", "Panels"],
      ["panel-rules", "Rules Panel", "Panels"],
      ["panel-schedule", "Schedule Panel", "Panels"],
      ["panel-socials", "Socials Panel", "Panels"],
      ["screen-starting", "Starting Soon Screen", "Screens"],
      ["screen-brb", "Be Right Back Screen", "Screens"],
      ["screen-ending", "Stream Ending Screen", "Screens"],
    ]);
    /* Drift pin: every mirrored key still exists in the server's
       catalog source — the bench never offers a pick the rail
       would 400 as unknown. */
    const route = readFileSync(
      new URL("../../../../api-server/src/routes/generate/stream-pack.ts", import.meta.url),
      "utf8",
    );
    for (const t of STREAM_PACK_THEMES) expect(route, t.key).toContain(`id: "${t.key}"`);
    for (const a of STREAM_PACK_ASSETS) expect(route, a.key).toContain(`key: "${a.key}"`);
  });

  it("payload mirrors the page: channel name trimmed, theme + asset keys as picked", () => {
    expect(
      buildStreamPackGeneratePayload({ channelName: "  Thy Cheat Code  ", theme: "neon-cyber", asset: "alert-follower" }),
    ).toEqual({ channelName: "Thy Cheat Code", theme: "neon-cyber", asset: "alert-follower" });
  });

  it("the generate gate is the page's: a channel name is required", () => {
    expect(streamPackGenerateReady("")).toBe(false);
    expect(streamPackGenerateReady("   ")).toBe(false);
    expect(streamPackGenerateReady("Thy Cheat Code")).toBe(true);
  });

  it("outcomes sort honestly: made / credits / failed — a 2xx without a graphic is never a success", () => {
    expect(
      parseStreamPackGenerate(200, { asset: "webcam-frame", label: "Webcam Frame", url: "https://x/p.png", creditCost: 100 }),
    ).toEqual({ kind: "succeeded", url: "https://x/p.png", label: "Webcam Frame" });
    expect(parseStreamPackGenerate(200, { asset: "webcam-frame" })).toEqual({ kind: "failed", message: null });
    expect(parseStreamPackGenerate(402, { error: "out_of_credits", message: "Not enough Visual Bucs." })).toEqual({
      kind: "credits",
      message: "Not enough Visual Bucs.",
    });
    expect(parseStreamPackGenerate(400, { error: "channelName is required" })).toEqual({
      kind: "failed",
      message: "channelName is required",
    });
    expect(parseStreamPackGenerate(500, { error: "Image generation returned no image data." })).toEqual({
      kind: "failed",
      message: "Image generation returned no image data.",
    });
    expect(parseStreamPackGenerate(500, null)).toEqual({ kind: "failed", message: null });
  });

  it("a library record's theme reads by the catalog's names; unknown themes stay unnamed", () => {
    expect(streamPackThemeLabel("gold-luxury")).toBe("Gold Luxury");
    expect(streamPackThemeLabel("arctic-frost")).toBe("Arctic Frost");
    expect(streamPackThemeLabel("some-old-theme")).toBeNull();
    expect(streamPackThemeLabel(null)).toBeNull();
  });
});

describe("stream pack bench wiring (source pins)", () => {
  const desk = readFileSync(new URL("../../components/world/native/BusinessDesks.tsx", import.meta.url), "utf8");

  it("the bench is native at the desk, riding the page's own rails and the shared library seam", () => {
    expect(desk).toContain('data-testid="world-stream-pack-bench"');
    expect(desk).toContain('data-testid="world-stream-pack-generate"');
    expect(desk).toContain("world-stream-pack-apply-");
    expect(desk).toContain('confirmedFetch("/api/stream-pack/generate"');
    expect(desk).toContain("overrideCost: STREAM_PACK_COST_VISUAL_BUCS");
    expect(desk).toContain("fetchMyStreamPackAssets(getAccessToken)");
    expect(desk).toContain("setStreamPackAssetApplied(");
  });

  it("the shelf's states are honest: a failed load retries, an empty pack says so", () => {
    expect(desk).toContain("Your stream pack wouldn't open — your graphics are safe on the real rails.");
    expect(desk).toContain("No stream graphics yet.");
    expect(desk).toContain("Charged only when the graphic is made — a failed make is never charged.");
  });
});

describe("parity follow-on log — thorough, each bench named", () => {
  it("covers every bench the task names for this lane", () => {
    const ids = BUSINESS_NATIVE_FOLLOW_ONS.map((f) => f.id);
    for (const required of [
      "press-release-panel",
      "coach-full-page-depth",
    ]) {
      expect(ids, required).toContain(required);
    }
    // Stage D Brand wave (Stack-100 #71–#75) graduated the press-kit
    // editor, the jewelry bench, brand-kit manual editing and the
    // logo save-back — all four leave the follow-on log.
    expect(ids).not.toContain("press-kit-layout-editing");
    expect(ids).not.toContain("branding-jewelry-bench");
    expect(ids).not.toContain("brand-kit-generate-edit-apply");
    expect(ids).not.toContain("generated-logo-save-to-kit");
    // Link-in-bio graduated (Stack-100 #59): links/themes/slug/avatar
    // editing, create, the 100 VB publish and unpublish are native at
    // the Promote Desk, so both bio follow-ons leave the log.
    expect(ids).not.toContain("bio-page-layout-theme-editors");
    expect(ids).not.toContain("bio-page-publish-management");
    // The Release wizard graduated (Stack-100 #53/#54): create/edit,
    // metadata, splits, UPC/barcode, submit and the smartlink surface
    // are native at the Promote Room's Release Desk, so it leaves the
    // follow-on log.
    expect(ids).not.toContain("release-wizard");
    // Headshots graduated: the bench is native at the Branding Kit Desk
    // now, so it leaves the follow-on log.
    expect(ids).not.toContain("branding-headshots-bench");
    // Stream pack graduated the same way: library + generate + apply
    // are native at the Branding Kit Desk, reading the same records.
    expect(ids).not.toContain("branding-stream-pack-bench");
    // The Scheduler graduated too (Stack-100 #45): compose, calendar,
    // best-time, edit and cancel are native at the Promote Desk.
    expect(ids).not.toContain("scheduler-calendar");
    for (const f of BUSINESS_NATIVE_FOLLOW_ONS) {
      expect(f.title.startsWith("NATIVE FOLLOW-ON:"), f.id).toBe(true);
      expect(f.benchPath.startsWith("/"), f.id).toBe(true);
      expect(f.note.length, f.id).toBeGreaterThan(20);
    }
  });

  it("promo-card actions AND the full history graduated (Stack-100 #60), so both follow-ons are resolved", () => {
    const ids = BUSINESS_NATIVE_FOLLOW_ONS.map((f) => f.id);
    expect(ids).not.toContain("promo-card-actions");
    /* The desk now reads GET /api/promo-cards itself — the full
       history shelf stands in-world, so the list follow-on leaves
       the log like every graduated item before it. */
    expect(ids).not.toContain("promo-cards-list-endpoint");
    const desk = readFileSync(new URL("../../components/world/native/BusinessDesks.tsx", import.meta.url), "utf8");
    expect(desk).toContain('fetch("/api/promo-cards"');
    expect(desk).toContain("normalizePromoCardHistory");
    expect(desk).toContain('data-testid="world-promote-card-history"');
    expect(desk).toContain('data-testid="world-promote-history-card"');
    expect(desk).toContain('data-testid="world-promote-history-delete"');
    expect(desk).toContain("removePromoCard(h.cards, c.id)");
  });
});

describe("Promote Desk gallery actions (source pins)", () => {
  const desk = readFileSync(new URL("../../components/world/native/BusinessDesks.tsx", import.meta.url), "utf8");

  it("every gallery card carries the panel's four handoffs", () => {
    expect(desk).toContain('data-testid="world-promote-card-download"');
    expect(desk).toContain('data-testid="world-promote-card-schedule"');
    expect(desk).toContain('data-testid="world-promote-card-share"');
    expect(desk).toContain('data-testid="world-promote-card-assets"');
    expect(desk).toContain("downloadImage(c.url, promoCardFileName(c))");
    // #46: the card's Schedule action loads the in-world Scheduler
    // compose — a prefill into SchedulerDeskSection, never the old
    // scheduler-handoff href exit.
    expect(desk).toContain('setCardPrefill({ mediaUrl: c.url, mediaType: "image", caption: cardShareText() })');
    expect(desk).toContain("<SchedulerDeskSection");
    expect(desk).not.toContain("scheduleHrefForMedia");
    expect(desk).toContain("promoCardSharePayload(c, channel)");
    expect(desk).toContain("addGalleryCardToAssets(c)");
  });

  it("the gallery copy no longer denies the saved shelf exists", () => {
    expect(desk).not.toContain("no saved card shelf yet");
    expect(desk).toContain("recorded to your promo card history");
  });
});

/* ─── Stack-100 #71: press-kit FULL editing ──────────────────────── */
describe("press kit full editing (Stack-100 #71)", () => {
  const FULL_KIT = {
    ...KIT,
    website: "https://king.example",
    instagram_url: "https://instagram.com/king",
    tiktok_url: null,
    youtube_url: "https://youtube.com/@king",
    spotify_url: null,
    layout: [
      { key: "photos", visible: false },
      { key: "bio", visible: true },
    ],
  };

  it("the parser now carries socials, website and the saved layout (resolved to all six sections)", () => {
    const kit = parsePressKits({ kits: [FULL_KIT] })[0]!;
    expect(kit.website).toBe("https://king.example");
    expect(kit.instagram_url).toBe("https://instagram.com/king");
    expect(kit.tiktok_url).toBeNull();
    expect(kit.layout.map((e) => e.key)).toEqual(["photos", "bio", "achievements", "press_quotes", "top_tracks", "contact"]);
    expect(kit.layout[0]).toEqual({ key: "photos", visible: false });
  });

  it("the draft seeds every editable field from the kit", () => {
    const kit = parsePressKits({ kits: [FULL_KIT] })[0]!;
    const draft = pressKitDraftFromKit(kit);
    expect(draft.handle).toBe("king-shark");
    expect(draft.instagram_url).toBe("https://instagram.com/king");
    expect(draft.achievements).toEqual(["Gold record"]);
    expect(draft.is_public).toBe(true);
    expect(draft.layout).toHaveLength(6);
  });

  it("validation speaks the route's refusals in words", () => {
    const kit = parsePressKits({ kits: [FULL_KIT] })[0]!;
    const ok = pressKitDraftFromKit(kit);
    expect(validatePressKitDraft(ok)).toBeNull();
    expect(validatePressKitDraft({ ...ok, handle: "ab" })).toContain("press address");
    expect(validatePressKitDraft({ ...ok, artist_name: "  " })).toContain("artist name");
    expect(validatePressKitDraft({ ...ok, booking_email: "not-an-email" })).toContain("booking email");
    expect(validatePressKitDraft({ ...ok, instagram_url: "instagram.com/king" })).toContain("Instagram");
    expect(validatePressKitDraft({ ...ok, press_quotes: [{ quote: "Words", source: "" }] })).toContain("press quote");
    expect(validatePressKitDraft({ ...ok, top_tracks: [{ title: "Song", url: "notaurl" }] })).toContain("listen link");
    expect(validatePressKitDraft({ ...ok, photo_urls: ["notaurl"] })).toContain("photo");
  });

  it("the save payload is the page's PUT body: slugified handle, blanks dropped the page's way", () => {
    const kit = parsePressKits({ kits: [FULL_KIT] })[0]!;
    const draft = {
      ...pressKitDraftFromKit(kit),
      handle: "King Shark 2",
      achievements: [" Gold record ", ""],
      press_quotes: [{ quote: "Great", source: "Mag" }, { quote: "Half", source: "" }],
      top_tracks: [{ title: "Song", url: "https://x/s" }, { title: "", url: "https://x/skip" }],
      photo_urls: [" https://x/p.jpg ", ""],
      is_public: false,
    };
    const p = buildPressKitSavePayload(draft);
    expect(p["handle"]).toBe("king-shark-2");
    expect(p["achievements"]).toEqual(["Gold record"]);
    expect(p["press_quotes"]).toEqual([{ quote: "Great", source: "Mag" }]);
    expect(p["top_tracks"]).toEqual([{ title: "Song", url: "https://x/s" }]);
    expect(p["photo_urls"]).toEqual(["https://x/p.jpg"]);
    expect(p["is_public"]).toBe(false);
    expect(p["layout"]).toHaveLength(6);
    expect(pressKitPublicPath(kit)).toBe("/press/king-shark");
  });

  it("the desk wires the full editor on the page's rails (source pins)", () => {
    const desk = readFileSync(new URL("../../components/world/native/BusinessDesks.tsx", import.meta.url), "utf8");
    expect(desk).toContain('data-testid="world-press-kit-editor"');
    expect(desk).toContain('data-testid="world-press-kit-save"');
    expect(desk).toContain('data-testid="world-press-kit-delete"');
    expect(desk).toContain('data-testid="world-press-kit-public-toggle"');
    expect(desk).toContain('data-testid="world-press-kit-pdf"');
    expect(desk).toContain('data-testid="world-press-kit-copy-link"');
    expect(desk).toContain('method: "PUT"');
    expect(desk).toContain('method: "DELETE"');
    expect(desk).toContain("buildPressKitSavePayload(pkDraft)");
    expect(desk).not.toContain("Layout and theme editing for the kit lives on the website bench");
  });
});

/* ─── Stack-100 #72/#73: brand-kit manual editing + logo save-back ── */
describe("brand kit manual editing (Stack-100 #72) + logo save-back (#73)", () => {
  const RECORD: BrandKit = {
    brandName: "King Shark",
    vibe: "royal",
    industry: null,
    colors: [
      { hex: "#C9A84C", name: "Palace Gold", role: "primary" },
      { hex: "#0B0B0F", name: "Smoke", role: "background" },
    ],
    fonts: [{ heading: "Cinzel", body: "Inter", usage: "Everywhere" }],
    logoPrompt: "A crowned shark",
    taglines: ["Bow down"],
    selectedTagline: "Bow down",
    logoUrl: null,
    bioLines: ["Gold-standard studio."],
    pressFacts: ["100k streams"],
    generatedAt: null,
    updatedAt: null,
  };

  it("the draft seeds name, logo, lines, palette and pairings", () => {
    const draft = brandKitDraftFromKit(RECORD);
    expect(draft.brandName).toBe("King Shark");
    expect(draft.bioLines).toEqual(["Gold-standard studio."]);
    expect(draft.colors).toHaveLength(2);
    expect(draft.fonts[0]!.heading).toBe("Cinzel");
  });

  it("validation is the panel's rule: #RRGGBB + a name per color, heading + body per pairing", () => {
    const draft = brandKitDraftFromKit(RECORD);
    expect(validateBrandKitDraft(draft, true)).toBeNull();
    expect(validateBrandKitDraft({ ...draft, colors: [{ hex: "gold", name: "G", role: "primary" }] }, true)).toContain("#RRGGBB");
    expect(validateBrandKitDraft({ ...draft, fonts: [{ heading: "", body: "Inter", usage: "" }] }, true)).toContain("#RRGGBB");
    // Pre-kit the panel skips the check — the palette doesn't ride that save.
    expect(validateBrandKitDraft({ ...draft, colors: [{ hex: "gold", name: "", role: "primary" }] }, false)).toBeNull();
  });

  it("the save payload mirrors the panel: lines cleaned, palette/fonts only with a kit + non-empty", () => {
    const draft = { ...brandKitDraftFromKit(RECORD), bioLines: [" Line ", ""], logoUrl: " https://x/logo.png " };
    const p = buildBrandKitSavePayload(draft, true);
    expect(p["bioLines"]).toEqual(["Line"]);
    expect(p["logoUrl"]).toBe("https://x/logo.png");
    expect(p["colors"]).toEqual(RECORD.colors);
    expect(p["fonts"]).toEqual(RECORD.fonts);
    const bare = buildBrandKitSavePayload(draft, false);
    expect(bare["colors"]).toBeUndefined();
    expect(bare["fonts"]).toBeUndefined();
  });

  it("role picks swap like the panel; a new color takes the first unused role", () => {
    const swapped = setBrandKitColorRole(RECORD.colors, 1, "primary");
    expect(swapped.map((c) => c.role)).toEqual(["background", "primary"]);
    expect(nextBrandKitColor(RECORD.colors)).toEqual({ hex: "#C9A84C", name: "New color", role: "secondary" });
    const full = ["primary", "secondary", "accent", "neutral", "background"].map((role) => ({ hex: "#000000", name: role, role }));
    expect(nextBrandKitColor(full)).toBeNull();
  });

  it("the desk wires the editor + the logo save-back on the shared seams (source pins)", () => {
    const desk = readFileSync(new URL("../../components/world/native/BusinessDesks.tsx", import.meta.url), "utf8");
    expect(desk).toContain('data-testid="world-brand-kit-editor"');
    expect(desk).toContain('data-testid="world-brand-kit-edit-save"');
    expect(desk).toContain("buildBrandKitSavePayload(editDraft, true)");
    expect(desk).toContain("saveBrandKit(getAccessToken, buildBrandKitSavePayload(editDraft, true))");
    expect(desk).toContain('data-testid="world-logo-save-to-kit"');
    expect(desk).toContain("saveLogoToBrandKit(getAccessToken, logoUrl)");
    expect(desk).not.toContain("Saving it into your brand kit is on the website bench for now");
  });
});

/* ─── Stack-100 #75: the coach on the creator's REAL inputs ───────── */
describe("coach on real inputs (Stack-100 #75)", () => {
  it("the niche/platform lists are the coach page's own", () => {
    expect(COACH_NICHES).toEqual(["Music", "Gaming", "Comedy", "Fitness", "Beauty & Fashion", "Tech", "Education", "Lifestyle"]);
    expect(COACH_PLATFORMS.map((p) => p.key)).toEqual(["youtube", "tiktok", "instagram"]);
    expect(defaultCoachInputs()).toEqual({
      niche: "Music",
      customNiche: "",
      platforms: ["youtube", "tiktok"],
      followers: { youtube: "", tiktok: "", instagram: "" },
      cadence: "3",
    });
  });

  it("the payload carries the creator's real answers — custom niche wins, counts parsed, cadence clamped", () => {
    const inputs = {
      niche: "Music",
      customNiche: " Gospel drill ",
      platforms: ["instagram" as const],
      followers: { youtube: "", tiktok: "", instagram: "12500" },
      cadence: "250",
    };
    expect(coachFinalNiche(inputs)).toBe("Gospel drill");
    const snap = {
      monthIncomeCents: 100, monthExpenseCents: 40, monthNetCents: 60,
      allTimeIncomeCents: 100, allTimeExpenseCents: 40, allTimeNetCents: 60,
      topIncomeCategory: "merch_sales", topExpenseCategory: null, monthLabel: "October 2026",
    };
    expect(buildCoachPayload(inputs, snap)).toEqual({
      niche: "Gospel drill",
      platforms: ["instagram"],
      followers: { youtube: 0, tiktok: 0, instagram: 12500 },
      cadence: 100,
      moneySnapshot: snap,
    });
    expect(validateCoachInputs(inputs)).toBeNull();
    expect(validateCoachInputs({ ...inputs, platforms: [] })).toContain("at least one platform");
    expect(validateCoachInputs({ ...inputs, niche: "", customNiche: " " })).toContain("niche");
  });

  it("the money snapshot is the tracker panel's math on the creator's real entries", () => {
    const entries = parseMoneyEntries({
      entries: [
        { entry_type: "income", category: "merch_sales", amount_cents: 5000, entry_date: "2026-10-03" },
        { entry_type: "income", category: "sponsor_deals", amount_cents: 9000, entry_date: "2026-09-01" },
        { entry_type: "expense", category: "ads", amount_cents: 1200, entry_date: "2026-10-20" },
        { entry_type: "income", category: "merch_sales", amount_cents: "oops", entry_date: "2026-10-01" },
        { entry_type: "income", category: "merch_sales", amount_cents: 100 },
      ],
    });
    expect(entries).toHaveLength(3); // the malformed rows drop, never invent
    const snap = buildMoneySnapshot(entries, new Date(2026, 9, 23));
    expect(snap).toMatchObject({
      monthIncomeCents: 5000,
      monthExpenseCents: 1200,
      monthNetCents: 3800,
      allTimeIncomeCents: 14000,
      allTimeExpenseCents: 1200,
      allTimeNetCents: 12800,
      topIncomeCategory: "merch_sales",
      topExpenseCategory: "ads",
      monthLabel: "October 2026",
    });
    expect(buildMoneySnapshot([], new Date())).toBeNull();
  });

  it("the plan reads back all its moves + eligibility, not just the first move", () => {
    const parsed = parseCoachTodayAction({
      moneyMoves: ["Move one", "Move two"],
      eligibility: [
        { platform: "YouTube", program: "Partner", threshold: "1,000 subs", progress: 42, status: "building", nextStep: "Post twice this week" },
        { platform: "", program: "ghost" },
      ],
      earnings: { rpmNotes: "Music RPM guidance" },
      nextAction: { label: "Distribute music", href: "/distribute" },
    });
    expect(parsed!.moves).toEqual(["Move one", "Move two"]);
    expect(parsed!.eligibility).toHaveLength(1);
    expect(parsed!.eligibility[0]).toMatchObject({ platform: "YouTube", progress: 42 });
    expect(parsed!.earningsNote).toBe("Music RPM guidance");
  });

  it("the desk asks with the real inputs + the real snapshot (source pins)", () => {
    const desk = readFileSync(new URL("../../components/world/native/BusinessDesks.tsx", import.meta.url), "utf8");
    expect(desk).toContain('fetch("/api/money"');
    expect(desk).toContain("buildCoachPayload(coachInputs, coachSnapshot)");
    expect(desk).toContain("buildMoneySnapshot(entries, new Date())");
    expect(desk).toContain('data-testid="world-coach-form"');
    expect(desk).toContain('data-testid="world-coach-niche"');
    expect(desk).toContain('data-testid="world-coach-cadence"');
    expect(desk).not.toContain("body: JSON.stringify(buildCoachPayload())");
  });
});
