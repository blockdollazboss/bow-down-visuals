/**
 * social-wave2 — Social Wave II (stack-100 #79–#84) seam + sources.
 *
 * Pins:
 * - #79 the feed rails are feed.tsx's verbatim: mode + limit=20 +
 *   `before` cursor on the last post's created_at, hasMore = a full
 *   page; New Drops is the discovery wire (limit=40), not the feed;
 * - #80 the verbs are PostCard's verbatim rails (repost, saves,
 *   author delete, poll vote) with PostCard's rules (one vote,
 *   members only, delete offered only on my own posts);
 * - #81 Explore + search ride /api/explore and
 *   /api/discovery/search exactly as explore.tsx / search.tsx do,
 *   and an empty box never fires the search rail;
 * - #82 the bench is the admin page's rails (/api/admin/*), gated
 *   fail-closed: only a confirmed `isAdmin === true` shows it;
 * - #83/#84 the profile view/edit rails are the creator-platform +
 *   profile-website routes verbatim, with updateMeSchema's own
 *   gates mirrored (name 1–80, bio ≤2000) and the referral share
 *   link shaped like artist-setup's (?ref=CODE on my page);
 * - source pins: the desks ride the seam, the host docks Explore
 *   at the Hall and My Profile at My Studio, and no desk calls the
 *   member AI moderation scan by mistake.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  FEED_PAGE_SIZE, FEED_VIEWS, feedPagePath, feedHasMore, mergeFeedPage,
  DROPS_PATH, normalizeDrops,
  SAVES_PATH, repostPath, saveRemovePath, postDeletePath, pollVotePath,
  feedVerbAllowed, postIsOwn, pollTotalVotes, pollPercent, pollVotable,
  EXPLORE_PATH, DISCOVERY_SEARCH_TYPES, discoverySearchPath,
  normalizeSearchResults, searchHasResults,
  ADMIN_STATUS_PATH, ADMIN_REPORTS_PATH, ADMIN_DMCA_REPORTS_PATH,
  ADMIN_CONTENT_REMOVED_PATH, adminQueuePath, adminQueueItemPath,
  adminContentPath, REPORT_STATUSES, moderationBenchVisible,
  normalizeAdminReports, normalizeAdminContent, normalizeRemovedContent,
  MY_PROFILE_PATH, MY_LAYOUT_PATH, MY_THEME_SETTINGS_PATH, publicProfilePath,
  normalizeOwnProfile, normalizePublicProfile, SOCIAL_PLATFORMS,
  socialLinkRows, socialLinksFromRows, profileBasicsReady, referralShareUrl,
  SOCIAL_WAVE2_PROMOTIONS, SOCIAL_NATIVE_FOLLOW_ONS,
} from "./social-desk";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const deskSrc = read("../../components/world/native/SocialDesk.tsx");
const wave2Src = read("../../components/world/native/SocialWave2.tsx");
const panelSrc = read("../../components/world/StationPanel.tsx");

describe("#79 feed views + pagination — feed.tsx's exact rails", () => {
  it("pins the page paths verbatim (mode, limit 20, before cursor)", () => {
    expect(FEED_PAGE_SIZE).toBe(20);
    expect(feedPagePath("chrono")).toBe("/api/feed?mode=chrono&limit=20");
    expect(feedPagePath("foryou")).toBe("/api/feed?mode=foryou&limit=20");
    expect(feedPagePath("chrono", "2026-10-20T00:00:00.000Z")).toBe(
      "/api/feed?mode=chrono&limit=20&before=2026-10-20T00%3A00%3A00.000Z",
    );
    expect(feedPagePath("foryou", null)).toBe("/api/feed?mode=foryou&limit=20");
  });

  it("the three views are the page's three views, in its order", () => {
    expect(FEED_VIEWS.map((v) => v.key)).toEqual(["chrono", "foryou", "drops"]);
    expect(FEED_VIEWS.map((v) => v.label)).toEqual(["Latest", "For You", "New Drops"]);
  });

  it("hasMore is the page's rule: a full page may have more, a short page is the end", () => {
    expect(feedHasMore(20)).toBe(true);
    expect(feedHasMore(19)).toBe(false);
    expect(feedHasMore(0)).toBe(false);
  });

  it("appending a page dedupes by id — the boundary second never renders twice", () => {
    const a = [{ id: "p1" }, { id: "p2" }];
    const merged = mergeFeedPage(a, [{ id: "p2" }, { id: "p3" }]);
    expect(merged.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("New Drops is the discovery wire, limit 40 — DropsWire's rail, not the feed's", () => {
    expect(DROPS_PATH).toBe("/api/discovery/feed?limit=40");
    const drops = normalizeDrops({
      items: [
        { id: "t1", kind: "track", title: "Song", thumb: null, created_at: "2026-10-20T00:00:00Z" },
        { id: "v1", kind: "video", title: "Clip", thumb: "x.png", created_at: "2026-10-21T00:00:00Z" },
        { noId: true },
        "junk",
      ],
    });
    expect(drops.map((d) => d.id)).toEqual(["t1", "v1"]);
    expect(normalizeDrops({})).toEqual([]);
    expect(normalizeDrops(null)).toEqual([]);
  });
});

describe("#80 feed verbs — PostCard's exact rails and rules", () => {
  it("pins every verb path verbatim", () => {
    expect(repostPath("p 1")).toBe("/api/posts/p%201/repost");
    expect(SAVES_PATH).toBe("/api/saves");
    expect(saveRemovePath("p1")).toBe("/api/saves/post/p1");
    expect(postDeletePath("p1")).toBe("/api/posts/p1");
    expect(pollVotePath("p1")).toBe("/api/posts/p1/poll/vote");
  });

  it("members verb, guests read — the rails are requireAuth regardless", () => {
    expect(feedVerbAllowed(false)).toBe(true);
    expect(feedVerbAllowed(true)).toBe(false);
  });

  it("delete is offered only on my own posts (profile id match)", () => {
    expect(postIsOwn({ profile_id: "me" }, "me")).toBe(true);
    expect(postIsOwn({ profile_id: "them" }, "me")).toBe(false);
    expect(postIsOwn({ profile_id: "me" }, null)).toBe(false);
  });

  it("poll math is the card's: totals, rounded percents, one member one vote", () => {
    const poll = {
      options: [
        { id: "a", option_text: "Yes", vote_count: 3 },
        { id: "b", option_text: "No", vote_count: 1 },
      ],
      viewer_option_id: null,
    };
    expect(pollTotalVotes(poll)).toBe(4);
    expect(pollPercent(poll, "a")).toBe(75);
    expect(pollPercent(poll, "b")).toBe(25);
    expect(pollPercent({ options: [], viewer_option_id: null }, "a")).toBe(0);
    expect(pollVotable(poll, false)).toBe(true);
    expect(pollVotable(poll, true)).toBe(false);
    expect(pollVotable({ ...poll, viewer_option_id: "a" }, false)).toBe(false);
    expect(pollVotable(null, false)).toBe(false);
  });
});

describe("#81 explore + search — the discovery rails verbatim", () => {
  it("pins the explore path and the search query shape", () => {
    expect(EXPLORE_PATH).toBe("/api/explore");
    expect(discoverySearchPath("queen bee", "all")).toBe("/api/discovery/search?q=queen+bee&type=all");
    expect(discoverySearchPath("bee", "creator")).toBe("/api/discovery/search?q=bee&type=creator");
    expect(DISCOVERY_SEARCH_TYPES.map((t) => t.key)).toEqual(["all", "creator", "track", "video", "playlist"]);
  });

  it("an empty box never fires the rail (search.tsx renders no state until a query commits)", () => {
    expect(discoverySearchPath("", "all")).toBeNull();
    expect(discoverySearchPath("   ", "track")).toBeNull();
  });

  it("results normalize per section; missing sections read as empty, never a crash", () => {
    const r = normalizeSearchResults({
      creators: [{ id: "c1", slug: "bee", display_name: "Bee", avatar_url: null }],
      tracks: [{ id: "t1", title: "Song" }],
    });
    expect(r.creators).toHaveLength(1);
    expect(r.tracks).toHaveLength(1);
    expect(r.videos).toEqual([]);
    expect(r.playlists).toEqual([]);
    expect(searchHasResults(r)).toBe(true);
    expect(searchHasResults(normalizeSearchResults(null))).toBe(false);
  });
});

describe("#82 the admin moderation bench — fail-closed, admin rails only", () => {
  it("pins every admin path verbatim (admin.tsx's bench)", () => {
    expect(ADMIN_STATUS_PATH).toBe("/api/admin/status");
    expect(ADMIN_REPORTS_PATH).toBe("/api/admin/reports");
    expect(ADMIN_DMCA_REPORTS_PATH).toBe("/api/admin/dmca-reports");
    expect(ADMIN_CONTENT_REMOVED_PATH).toBe("/api/admin/content/removed");
    expect(adminQueuePath("reports")).toBe("/api/admin/reports");
    expect(adminQueuePath("dmca-reports")).toBe("/api/admin/dmca-reports");
    expect(adminQueueItemPath("reports", "r 1")).toBe("/api/admin/reports/r%201");
    expect(adminQueueItemPath("dmca-reports", "d1")).toBe("/api/admin/dmca-reports/d1");
    expect(adminContentPath("p1")).toBe("/api/admin/content/p1");
  });

  it("the workflow vocabulary is the server's own (both queues share it)", () => {
    expect(REPORT_STATUSES).toEqual(["new", "reviewing", "actioned", "dismissed"]);
  });

  it("the bench shows ONLY on a confirmed admin status — everything else is nothing", () => {
    expect(moderationBenchVisible(true)).toBe(true);
    expect(moderationBenchVisible(false)).toBe(false);
    expect(moderationBenchVisible(null)).toBe(false);
  });

  it("queue/content payloads guard into rows; malformed reads as no state, never junk", () => {
    expect(normalizeAdminReports({ reports: [{ id: "r1", status: "new" }] })).toHaveLength(1);
    expect(normalizeAdminReports({})).toEqual([]);
    expect(normalizeAdminContent({ content: { id: "p1", kind: "post", body: "x", author: null, removed: false, removalReason: null } })?.id).toBe("p1");
    expect(normalizeAdminContent({ content: { noId: 1 } })).toBeNull();
    expect(normalizeAdminContent(null)).toBeNull();
    expect(normalizeRemovedContent({ content: [{ id: "p2" }] })).toHaveLength(1);
    expect(normalizeRemovedContent({})).toEqual([]);
  });
});

describe("#83/#84 own profile — the creator-profile rails verbatim", () => {
  it("pins the view + edit paths verbatim", () => {
    expect(MY_PROFILE_PATH).toBe("/api/creator-profiles/me");
    expect(MY_LAYOUT_PATH).toBe("/api/creator-profiles/me/layout");
    expect(MY_THEME_SETTINGS_PATH).toBe("/api/creator-profiles/me/theme-settings");
    expect(publicProfilePath("queen bee")).toBe("/api/creator-profiles/queen%20bee");
  });

  it("the owner read guards into the profile (404/junk is no profile, never a crash)", () => {
    const own = normalizeOwnProfile({
      id: "pr1", slug: "bee", display_name: "Queen Bee", bio: "hi",
      social_links: { instagram: "https://ig.example/bee" }, referral_code: "BEE1",
      follower_count: 12, total_plays: 99, is_public: true,
    });
    expect(own?.slug).toBe("bee");
    expect(own?.referral_code).toBe("BEE1");
    expect(own?.social_links["instagram"]).toContain("ig.example");
    expect(normalizeOwnProfile({ slug: "no-id" })).toBeNull();
    expect(normalizeOwnProfile(null)).toBeNull();
  });

  it("the visitor read unwraps profile + counts + shelves, defaulting counts to zero", () => {
    const view = normalizePublicProfile({
      profile: { id: "pr1", slug: "bee", display_name: "Bee" },
      counts: { tracks: 3 },
      top_tracks: [{ id: "t1", title: "Song", play_count: 5 }],
      top_videos: [],
    });
    expect(view?.counts).toEqual({ tracks: 3, videos: 0, playlists: 0 });
    expect(view?.topTracks[0]?.title).toBe("Song");
    expect(normalizePublicProfile({ counts: {} })).toBeNull();
  });

  it("social rows lead with artist-setup's platform set and keep extra keys", () => {
    expect(SOCIAL_PLATFORMS).toEqual(["instagram", "tiktok", "youtube", "x", "twitch", "spotify", "website"]);
    const rows = socialLinkRows({ instagram: "https://ig", bandcamp: "https://bc" });
    expect(rows.map((r) => r.platform)).toEqual([...SOCIAL_PLATFORMS, "bandcamp"]);
    expect(rows.find((r) => r.platform === "instagram")?.url).toBe("https://ig");
    expect(rows.find((r) => r.platform === "tiktok")?.url).toBe("");
  });

  it("rows save back trimmed, blanks dropped (an emptied field unlinks)", () => {
    expect(
      socialLinksFromRows([
        { platform: "instagram", url: "  https://ig  " },
        { platform: "x", url: "   " },
      ]),
    ).toEqual({ instagram: "https://ig" });
  });

  it("the basics gate mirrors updateMeSchema: name 1–80 trimmed, bio ≤ 2000", () => {
    expect(profileBasicsReady("Bee", "")).toBe(true);
    expect(profileBasicsReady("   ", "")).toBe(false);
    expect(profileBasicsReady("x".repeat(81), "")).toBe(false);
    expect(profileBasicsReady("Bee", "b".repeat(2000))).toBe(true);
    expect(profileBasicsReady("Bee", "b".repeat(2001))).toBe(false);
  });

  it("the referral share link is my page carrying ?ref=CODE — and no code, no link", () => {
    expect(referralShareUrl("https://bowdownvisuals.com", "bee", "BEE1")).toBe(
      "https://bowdownvisuals.com/artist/bee?ref=BEE1",
    );
    expect(referralShareUrl("https://bowdownvisuals.com", "bee", null)).toBeNull();
    expect(referralShareUrl("https://bowdownvisuals.com", "bee", undefined)).toBeNull();
  });
});

describe("the wave-2 promotion record", () => {
  it("items 79–84 are recorded as built, and the follow-on log stays empty", () => {
    expect(SOCIAL_WAVE2_PROMOTIONS.map((p) => p.item)).toEqual(["79", "80", "81", "82", "83", "84"]);
    expect(SOCIAL_WAVE2_PROMOTIONS.map((p) => p.id)).toEqual([
      "feed-views-pagination", "feed-verbs", "explore-search",
      "moderation-bench", "own-profile-view", "profile-editing",
    ]);
    expect(SOCIAL_NATIVE_FOLLOW_ONS).toEqual([]);
  });
});

describe("source pins — the wave-2 desks and their docks", () => {
  it("the board rides the feed seam: views, cursor pagination, drops wire, verbs", () => {
    for (const needle of [
      "feedPagePath(view)", "feedPagePath(view, before)", "feedHasMore(page.length)",
      "mergeFeedPage(prev ?? [], page)", "DROPS_PATH", "normalizeDrops",
      'data-testid="world-feed-view-chrono"', 'data-testid="world-feed-view-foryou"',
      'data-testid="world-feed-view-drops"', 'data-testid="world-feed-load-more"',
      'data-testid="world-feed-drops"',
      "repostPath(post.id)", "SAVES_PATH", "saveRemovePath(post.id)",
      "postDeletePath(post.id)", "pollVotePath(post.id)", "pollVotable(poll, isGuest)",
      'data-testid="world-feed-repost"', 'data-testid="world-feed-save"',
      'data-testid="world-feed-delete"', 'data-testid="world-feed-delete-confirm"',
      'data-testid="world-feed-poll"', 'data-testid="world-feed-why"',
      "postIsOwn(post, myProfileId)", "MY_PROFILE_PATH",
    ]) {
      expect(deskSrc, needle).toContain(needle);
    }
  });

  it("the explore desk rides the discovery rails with honest empty/failed states", () => {
    for (const needle of [
      "EXPLORE_PATH", "normalizeExploreData", "discoverySearchPath(query, searchType)",
      "normalizeSearchResults", 'data-testid="world-explore-desk"',
      'data-testid="world-explore-search-input"', 'data-testid="world-explore-results"',
      'data-testid="world-explore-creators"', 'data-testid="world-explore-shorts"',
      'data-testid="world-explore-posts"', 'data-testid="world-explore-events"',
      'data-testid="world-explore-groups"',
    ]) {
      expect(wave2Src, needle).toContain(needle);
    }
  });

  it("the bench gates on the status rail and fires only admin verbs", () => {
    for (const needle of [
      "ADMIN_STATUS_PATH", "moderationBenchVisible(isAdmin)", "if (!visible) return null;",
      "adminQueuePath(queueKind)", "adminQueueItemPath(kind, id)",
      "ADMIN_CONTENT_REMOVED_PATH", "adminContentPath(id)", "parseContentId(lookupInput)",
      "REMOVAL_REASONS", 'data-testid="world-moderation-bench"',
      'data-testid="world-moderation-queue-failed"',
      'data-testid="world-moderation-remove"', 'data-testid="world-moderation-restore"',
    ]) {
      expect(wave2Src, needle).toContain(needle);
    }
    /* The member AI scan is NOT the admin bench — neither desk calls it. */
    expect(wave2Src).not.toContain("/api/community/moderate");
    expect(deskSrc).not.toContain("/api/community/moderate");
  });

  it("the profile desk views as a visitor and edits on the editor's three rails", () => {
    for (const needle of [
      "MY_PROFILE_PATH", "publicProfilePath(own.slug)", "normalizePublicProfile",
      'data-testid="world-my-profile-visitor"', 'data-testid="world-my-profile-private"',
      'data-testid="world-profile-edit-bio"', 'data-testid="world-profile-edit-save"',
      "socialLinkRows(own.social_links)", "socialLinksFromRows(rows)",
      "MY_LAYOUT_PATH", "moveBlock", "toggleBlockVisibility", "addableBlockTypes",
      'data-testid="world-profile-layout-save"',
      "MY_THEME_SETTINGS_PATH", "themeSettingsPatch",
      'data-testid="world-profile-theme-save"',
      "referralShareUrl", 'data-testid="world-profile-referral"',
    ]) {
      expect(wave2Src, needle).toContain(needle);
    }
  });

  it("the host docks Explore at the Hall and My Profile at My Studio", () => {
    expect(panelSrc).toContain("<ExploreDesk isLight={isLight} />");
    expect(panelSrc).toContain("<MyProfileDesk isLight={isLight} />");
    expect(panelSrc).toContain('station.id === "my-studio"');
  });
});
