import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  FALLBACK_PRICING,
  buildAiSavePayload,
  buildMetadataPayload,
  buildPresaveSettingsPayload,
  buildReleasePayload,
  buildSplitsPayload,
  buildStrategyPayload,
  checklistPasses,
  draftFromRelease,
  draftWithSong,
  emptyReleaseDraft,
  SPLIT_INVITE_PATH,
  SPLIT_SHARE_LINK_PATH,
  buildSplitInviteBody,
  parseBarcodeResult,
  parseMetadataResult,
  parsePlatformStatuses,
  parsePresaveMint,
  parsePresaveStats,
  parseReleaseDetail,
  parseReleaseList,
  parseReleasePricing,
  parseReleaseSongs,
  parseSplitInviteResult,
  parseSplitShareLink,
  parseSplitsSave,
  parseStrategyResult,
  parseSubmitChecklist,
  parseSubmitResult,
  smartlinkUrl,
  splitInviteReady,
  submitPriceFor,
  validateReleaseDraft,
  validateSmartlinkSettings,
  type ReleaseDetail,
} from "./release-desk";

const RELEASE_WIRE = {
  id: "rel-1",
  title: "Golden Hour",
  artistName: "Thy Artist",
  releaseType: "ep",
  releaseDate: "2026-12-01",
  platforms: ["spotify", "tidal"],
  audioUrl: "https://cdn.example.com/master.wav",
  artworkUrl: "https://cdn.example.com/cover.png",
  genre: "Hip-Hop",
  subgenre: "Boom bap",
  isrc: "USABC2412345",
  upc: "093123456783",
  upcKind: "internal",
  label: "Bow Down",
  labelImprint: "",
  copyrightCLine: "© 2026 Bow Down",
  copyrightPLine: "℗ 2026 Bow Down",
  explicit: true,
  explicitDeclared: true,
  territoriesMode: "worldwide",
  territories: [],
  originalReleaseDate: "",
  preorderDate: "",
  tracks: [
    { title: "Golden Hour", isrc: "USABC2412345" },
    { title: "Second Cut" },
  ],
  status: "draft",
  creditsCharged: 0,
  aggregator: "mock",
  presaveSlug: "abc123def4",
  splitShareSlug: null,
  royaltySplits: [{ name: "Thy Artist", role: "artist", email: null, share: 100 }],
  checklist: [
    { key: "title", label: "Release title", ok: true, hint: "fine" },
    { key: "audio", label: "Master audio", ok: true, hint: "fine" },
  ],
  platformStatuses: [],
  metadata: { lyrics: "la la" },
  strategy: null,
};

describe("release pricing — live read, 2D fallback", () => {
  it("parses the pricing endpoint's tiers and AI costs", () => {
    const p = parseReleasePricing({
      tiers: [
        { type: "single", credits: 1000, label: "Single", blurb: "1 track" },
        { type: "ep", credits: 2000, label: "EP", blurb: "2–6 tracks" },
        { type: "album", credits: 3000, label: "Album", blurb: "7–30 tracks" },
      ],
      aiMetadataCost: 100,
      aiStrategyCost: 100,
      aggregator: "mock",
      aggregatorLive: false,
    });
    expect(submitPriceFor(p, "single")).toBe(1000);
    expect(submitPriceFor(p, "ep")).toBe(2000);
    expect(submitPriceFor(p, "album")).toBe(3000);
    expect(p.aiMetadataCost).toBe(100);
    expect(p.aggregatorLive).toBe(false);
  });

  it("falls back to the shipped constants on a bad read — never invents a price", () => {
    expect(parseReleasePricing(null)).toBe(FALLBACK_PRICING);
    expect(parseReleasePricing({ tiers: [] })).toBe(FALLBACK_PRICING);
    expect(submitPriceFor(FALLBACK_PRICING, "single")).toBeGreaterThan(0);
  });
});

describe("release detail parsing", () => {
  it("reads the full rowToRelease DTO", () => {
    const r = parseReleaseDetail({ release: RELEASE_WIRE })!;
    expect(r.title).toBe("Golden Hour");
    expect(r.releaseType).toBe("ep");
    expect(r.tracks).toHaveLength(2);
    expect(r.tracks[1]).toEqual({ title: "Second Cut", isrc: "" });
    expect(r.royaltySplits[0]).toMatchObject({ name: "Thy Artist", share: 100 });
    expect(r.presaveSlug).toBe("abc123def4");
    expect(checklistPasses(r.checklist)).toBe(true);
  });

  it("parses the list endpoint and skips id-less rows", () => {
    const list = parseReleaseList({ releases: [RELEASE_WIRE, { title: "no id" }, null] });
    expect(list).toHaveLength(1);
    expect(parseReleaseList({})).toEqual([]);
    expect(parseReleaseDetail({})).toBeNull();
  });

  it("an empty checklist never passes", () => {
    expect(checklistPasses([])).toBe(false);
  });
});

describe("wizard draft — payload + validation mirror the 2D wizard", () => {
  it("a prefill seeds artwork + title only (Stack-100 #55)", () => {
    const d = emptyReleaseDraft({ coverUrl: "https://x/c.png", title: "My Song" });
    expect(d.artworkUrl).toBe("https://x/c.png");
    expect(d.title).toBe("My Song");
    expect(d.tracks).toEqual([{ title: "My Song", isrc: "" }]);
    expect(d.explicit).toBeNull();
  });

  it("validation names the first gap, in the wizard's order", () => {
    const d = emptyReleaseDraft();
    expect(validateReleaseDraft(d)).toContain("Title and artist");
    d.title = "T";
    d.artistName = "A";
    expect(validateReleaseDraft(d)).toContain("explicit-content declaration");
    d.explicit = false;
    d.explicitConfirmed = true;
    expect(validateReleaseDraft(d)).toContain("master audio");
    d.audioUrl = "https://x/a.wav";
    expect(validateReleaseDraft(d)).toContain("Every track needs a title");
    d.tracks = [{ title: "T", isrc: "" }];
    expect(validateReleaseDraft(d)).toContain("release date");
    d.releaseDate = "2027-01-01";
    expect(validateReleaseDraft(d)).toBeNull();
  });

  it("the payload carries the rail's fields, tracks trimmed, lyrics only when typed", () => {
    const d = emptyReleaseDraft();
    Object.assign(d, {
      title: "  Song ",
      artistName: " Artist ",
      audioUrl: "https://x/a.wav",
      explicit: true,
      explicitConfirmed: true,
      releaseDate: "2027-01-01",
      territoriesText: "us, ca x1",
    });
    d.tracks = [{ title: " Song ", isrc: " usabc2412345 " }];
    const body = buildReleasePayload(d);
    expect(body["title"]).toBe("Song");
    expect(body["tracks"]).toEqual([{ title: "Song", isrc: "usabc2412345" }]);
    expect(body["territories"]).toEqual(["US", "CA"]);
    expect(body).not.toHaveProperty("lyrics");
    d.lyrics = " words ";
    expect(buildReleasePayload(d)["lyrics"]).toBe("words");
  });

  it("draftFromRelease round-trips an editable draft", () => {
    const detail = parseReleaseDetail({ release: RELEASE_WIRE }) as ReleaseDetail;
    const d = draftFromRelease(detail);
    expect(d.title).toBe("Golden Hour");
    expect(d.explicit).toBe(true);
    expect(d.explicitConfirmed).toBe(true);
    expect(d.lyrics).toBe("la la");
    expect(validateReleaseDraft(d)).toBeNull();
  });
});

describe("song library — the wizard's music step", () => {
  it("parses /api/songs rows and prefills blanks only, like the 2D wizard", () => {
    const songs = parseReleaseSongs({
      songs: [{ id: "s1", title: "Lib Song", audio_url: "https://x/lib.wav", genre: "Soul", isrc: "USXYZ2499999", cover_art_url: "https://x/lib.png", lyrics: "words" }, { title: "no id" }],
    });
    expect(songs).toHaveLength(1);
    const d = emptyReleaseDraft();
    d.title = "Typed Title";
    const withSong = draftWithSong(d, songs[0]!);
    expect(withSong.songId).toBe("s1");
    expect(withSong.audioUrl).toBe("https://x/lib.wav");
    expect(withSong.title).toBe("Typed Title"); // typed wins
    expect(withSong.genre).toBe("Soul");
    expect(withSong.artworkUrl).toBe("https://x/lib.png");
    expect(draftWithSong(withSong, null).songId).toBeNull();
  });

  it("songId rides only on create", () => {
    const d = emptyReleaseDraft();
    d.songId = "s1";
    expect(buildReleasePayload(d)).not.toHaveProperty("songId");
    expect(buildReleasePayload(d, { forCreate: true })["songId"]).toBe("s1");
  });
});

describe("splits / barcode / submit answers", () => {
  it("builds the splits PUT body like the 2D editor (blank role/email absent)", () => {
    expect(
      buildSplitsPayload([
        { name: " A ", role: "", email: "", share: 60 },
        { name: "B", role: "producer", email: "b@x.com", share: 40 },
      ]),
    ).toEqual({
      splits: [
        { name: "A", role: undefined, email: undefined, share: 60 },
        { name: "B", role: "producer", email: "b@x.com", share: 40 },
      ],
    });
  });

  it("parses the splits save (agreement version rides along)", () => {
    const out = parseSplitsSave({ splits: [{ name: "A", share: 100 }], agreementVersion: 2 });
    expect(out.agreementVersion).toBe(2);
    expect(out.splits).toHaveLength(1);
  });

  it("parses barcode + submit + submit-checklist answers", () => {
    expect(parseBarcodeResult({ barcode: "093123456783", notice: "Internal catalog ID minted" })).toEqual({
      barcode: "093123456783",
      notice: "Internal catalog ID minted",
    });
    const sub = parseSubmitResult({ release: RELEASE_WIRE, notice: "Sandbox mode", creditsUsed: 2000 });
    expect(sub.release?.id).toBe("rel-1");
    expect(sub.creditsUsed).toBe(2000);
    expect(parseSubmitChecklist({ checklist: [{ key: "audio", label: "Master audio", ok: false, hint: "add it" }] })).toEqual([
      { key: "audio", label: "Master audio", ok: false, hint: "add it" },
    ]);
  });

  it("parses delivery statuses, skipping platform-less rows", () => {
    expect(
      parsePlatformStatuses({ platformStatuses: [{ platform: "spotify", status: "live", detail: null }, { status: "queued" }] }),
    ).toEqual([{ platform: "spotify", status: "live", detail: null }]);
  });
});

describe("AI benches — payloads mirror the 2D page", () => {
  it("metadata + strategy payloads and results", () => {
    expect(buildMetadataPayload({ vibe: " warm ", lyrics: " la ", artistName: "A", workingTitle: "T" })).toEqual({
      vibe: "warm",
      lyrics: "la",
      artistName: "A",
      workingTitle: "T",
    });
    expect(parseMetadataResult({ titleOptions: ["One"], description: "d", genreTags: ["rap"] })).toEqual({
      titleOptions: ["One"],
      description: "d",
      genreTags: ["rap"],
    });
    expect(parseMetadataResult({})).toBeNull();

    const detail = parseReleaseDetail({ release: RELEASE_WIRE })!;
    expect(buildStrategyPayload(detail, { genreTags: ["rap", "soul"] })).toEqual({
      title: "Golden Hour",
      artistName: "Thy Artist",
      genreTags: ["rap", "soul"],
      releaseDate: "2026-12-01",
      platforms: ["spotify", "tidal"],
    });
    expect(parseStrategyResult({ timing: "Drop Friday" })).toMatchObject({ timing: "Drop Friday" });
    expect(parseStrategyResult({})).toBeNull();
  });

  it("the AI save body carries only what was generated", () => {
    expect(buildAiSavePayload({ metadata: null, strategy: null })).toEqual({});
    expect(
      buildAiSavePayload({ metadata: { titleOptions: ["X"], description: null, genreTags: [] }, strategy: null }),
    ).toEqual({ metadata: { titleOptions: ["X"], description: null, genreTags: [] } });
  });
});

describe("smartlink / pre-save (Stack-100 #54)", () => {
  it("forms the URL exactly like the 2D page (<origin>/presave/<slug>)", () => {
    expect(smartlinkUrl("https://bowdownvisuals.com/", "abc123")).toBe("https://bowdownvisuals.com/presave/abc123");
    expect(parsePresaveMint({ slug: "abc123", url: "https://bowdownvisuals.com/presave/abc123" })).toEqual({
      slug: "abc123",
      url: "https://bowdownvisuals.com/presave/abc123",
    });
  });

  it("parses presave-stats: settings, pixels, analytics, counts", () => {
    const stats = parsePresaveStats({
      settings: {
        headline: "Out soon",
        platformLinks: { spotify: "https://open.spotify.com/x", bogus: "https://x" },
        bonusUrl: "https://x/bonus",
        pixels: { metaPixelId: "123456789", tiktokPixelId: null, googleTagId: "G-ABCD1234" },
      },
      linkAnalytics: { views: 40, clicks: 9, clicksLast7d: 4, perLink: [{ linkKey: "spotify", linkTitle: "Spotify", clicks: 9 }] },
      followers: 12,
      shares: 3,
    });
    expect(stats.settings.headline).toBe("Out soon");
    expect(stats.settings.platformLinks).toEqual({ spotify: "https://open.spotify.com/x" });
    expect(stats.settings.pixels.metaPixelId).toBe("123456789");
    expect(stats.linkAnalytics).toMatchObject({ views: 40, clicks: 9, clicksLast7d: 4 });
    expect(stats.followers).toBe(12);
    expect(stats.shares).toBe(3);
  });

  it("a null linkAnalytics stays null — absence is never dressed as zeros", () => {
    expect(parsePresaveStats({ settings: {}, linkAnalytics: null }).linkAnalytics).toBeNull();
  });

  it("pixel validation uses the site's own shapes; the payload trims and carries all fields", () => {
    const base = { headline: "", platformLinks: {}, bonusUrl: "", pixels: { metaPixelId: null, tiktokPixelId: null, googleTagId: null } };
    expect(validateSmartlinkSettings(base)).toBeNull();
    expect(validateSmartlinkSettings({ ...base, pixels: { ...base.pixels, metaPixelId: "abc" } })).toContain("Meta Pixel");
    expect(validateSmartlinkSettings({ ...base, pixels: { ...base.pixels, googleTagId: "X-1" } })).toContain("Google tag");
    const payload = buildPresaveSettingsPayload({
      headline: " Hi ",
      platformLinks: { spotify: " https://s " },
      bonusUrl: "",
      pixels: { metaPixelId: " 123456 ", tiktokPixelId: null, googleTagId: null },
    });
    expect(payload["headline"]).toBe("Hi");
    expect((payload["platformLinks"] as Record<string, string>)["spotify"]).toBe("https://s");
    expect(payload["metaPixelId"]).toBe("123456");
    expect(payload["tiktokPixelId"]).toBe("");
  });
});

describe("Release Desk component (source pins)", () => {
  const desk = readFileSync(new URL("../../components/world/native/ReleaseDesk.tsx", import.meta.url), "utf8");

  it("rides the real distribution rails and nothing else", () => {
    for (const rail of [
      "/api/distribution/releases",
      "/api/distribution/pricing",
      "/submit",
      "/generate-barcode",
      "/splits",
      "/presave",
      "/presave-settings",
      "/presave-stats",
      "/platforms",
      "/api/distribution/metadata",
      "/api/distribution/strategy",
      "/api/songs",
    ]) {
      expect(desk, rail).toContain(rail);
    }
    // No exit door: the desk never links or transfers to the 2D page.
    expect(desk).not.toContain('href="/distribute');
    expect(desk).not.toContain('websitePath="/distribute"');
    expect(desk).not.toContain('target="_blank"');
  });

  it("the paid submit follows the 2D confirmation law (window.confirm naming the live price)", () => {
    expect(desk).toContain("window.confirm");
    expect(desk).toContain("submitPriceFor");
  });

  it("the smartlink section is completable in-world", () => {
    expect(desk).toContain('data-testid="world-release-smartlink"');
    expect(desk).toContain('data-testid="world-release-smartlink-mint"');
    expect(desk).toContain('data-testid="world-release-smartlink-save"');
  });

  it("#55: the Cover Desk chip opens this desk — no /distribute tab-out remains", () => {
    const shared = readFileSync(new URL("../../components/world/native/CreateDeskShared.tsx", import.meta.url), "utf8");
    const createDesks = readFileSync(new URL("../../components/world/native/CreateDesks.tsx", import.meta.url), "utf8");
    expect(shared).toContain("releasePrefill");
    expect(shared).toContain("<ReleaseDeskStandalone");
    expect(shared).not.toContain("releaseHref");
    expect(shared).not.toContain('target="_blank"');
    expect(createDesks).toContain("releasePrefill={{ coverUrl, title: songTitle }}");
    expect(createDesks).not.toContain("distributeHrefForCover(coverUrl, songTitle)");
  });

  it("the Promote Desk hosts the full desk, not the folded status row", () => {
    const business = readFileSync(new URL("../../components/world/native/BusinessDesks.tsx", import.meta.url), "utf8");
    expect(business).toContain("<ReleaseDeskSection");
    expect(business).not.toContain('websitePath="/distribute"');
  });
});

/* ── Item 99 (Stack-100 #2) — split invites against the REAL rail ───
   Facet D-53 claimed POST /api/distribution/splits/invite didn't
   exist and the in-world editor demanded raw user ids. Verified
   against the shipped tree: the rail exists at the canonical nested
   path (POST /api/distribution/releases/:id/splits/invite, pending
   state on distribution_royalty_splits — invite_status +
   invite_token, API-pinned in the api-server distribution suite),
   and the editor already collected name/role/email. The REAL defect
   was that this seam dropped the split `id`, so no in-world invite
   could ever be addressed. These pins are written against the real
   rail's shapes — no faked acceptance anywhere: "invited" is read
   from the server's recorded answer only. */
describe("item 99 — split invites + share link (real rails)", () => {
  it("the split id rides through BOTH parsers (detail read + splits save)", () => {
    const detail = parseReleaseDetail({
      release: {
        ...RELEASE_WIRE,
        royaltySplits: [
          { id: "split-9", name: "Writer", role: "writer", email: "w@x.com", share: 20, inviteStatus: "invited" },
        ],
      },
    })!;
    expect(detail.royaltySplits[0]).toMatchObject({ id: "split-9", inviteStatus: "invited" });
    const saved = parseSplitsSave({
      splits: [{ id: "split-9", name: "Writer", email: "w@x.com", share: 20, inviteStatus: "not_invited" }],
      agreementVersion: 3,
    });
    expect(saved.splits[0]).toMatchObject({ id: "split-9", inviteStatus: "not_invited" });
  });

  it("invite + share-link paths are the canonical nested rails the 2D page uses", () => {
    expect(SPLIT_INVITE_PATH("rel-1")).toBe("/api/distribution/releases/rel-1/splits/invite");
    expect(SPLIT_SHARE_LINK_PATH("rel-1")).toBe("/api/distribution/releases/rel-1/splits/share-link");
  });

  it("the invite body names the split by its saved id — an unsaved payee has no body to send", () => {
    expect(buildSplitInviteBody({ id: "split-9", name: "Writer", email: "w@x.com", share: 20 })).toEqual({ splitId: "split-9" });
    expect(buildSplitInviteBody({ name: "Writer", email: "w@x.com", share: 20 })).toBeNull();
  });

  it("the invite door is ready only with a saved id AND an email (the rail's own gates)", () => {
    expect(splitInviteReady({ id: "s1", name: "W", email: "w@x.com", share: 20 })).toBe(true);
    expect(splitInviteReady({ id: "s1", name: "W", email: "", share: 20 })).toBe(false);
    expect(splitInviteReady({ id: "s1", name: "W", email: null, share: 20 })).toBe(false);
    expect(splitInviteReady({ name: "W", email: "w@x.com", share: 20 })).toBe(false);
    /* Already invited never blocks a re-send. */
    expect(splitInviteReady({ id: "s1", name: "W", email: "w@x.com", share: 20, inviteStatus: "invited" })).toBe(true);
  });

  it("the invite answer is read honestly: recorded only when the server says recorded", () => {
    expect(parseSplitInviteResult({ recorded: true, emailSent: false, note: "share the link" })).toEqual({
      recorded: true, emailSent: false, note: "share the link",
    });
    expect(parseSplitInviteResult({ recorded: true, emailSent: true })).toEqual({
      recorded: true, emailSent: true, note: null,
    });
    expect(parseSplitInviteResult({})).toEqual({ recorded: false, emailSent: false, note: null });
    expect(parseSplitInviteResult(null)).toEqual({ recorded: false, emailSent: false, note: null });
  });

  it("the share-link answer parses slug + url, and only both", () => {
    expect(parseSplitShareLink({ slug: "abc123def4", url: "https://x/splits/abc123def4" })).toEqual({
      slug: "abc123def4", url: "https://x/splits/abc123def4",
    });
    expect(parseSplitShareLink({ slug: "abc123def4" })).toBeNull();
    expect(parseSplitShareLink(null)).toBeNull();
  });

  it("the desk wires both doors (source pin) — invite by email + share link, no raw-user-id field", () => {
    const desk = readFileSync(new URL("../../components/world/native/ReleaseDesk.tsx", import.meta.url), "utf8");
    expect(desk).toContain("SPLIT_INVITE_PATH(selected.id)");
    expect(desk).toContain("SPLIT_SHARE_LINK_PATH(selected.id)");
    expect(desk).toContain("world-release-split-invite-");
    expect(desk).toContain("world-release-split-share");
    /* Status flips to invited ONLY off the recorded answer. */
    expect(desk).toContain('inviteStatus: "invited"');
    expect(desk).toContain("result.recorded");
  });

  it("the server rail exists at the canonical path with pending-invite state (source pin, api-server)", () => {
    const server = readFileSync(
      new URL("../../../../api-server/src/routes/generate/distribution.ts", import.meta.url),
      "utf8",
    );
    expect(server).toContain('router.post("/distribution/releases/:id/splits/invite"');
    expect(server).toContain("invite_status = 'invited'");
    expect(server).toContain("invite_token");
  });
});
