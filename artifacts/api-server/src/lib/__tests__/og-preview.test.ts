/* Unit tests for the bot-facing OG preview helpers (og-preview.ts).
   Resolver functions hit the DB and are covered by integration; everything
   here is pure and fast. */
import { describe, it, expect } from "vitest";
import {
  isSocialBot,
  matchShareableRoute,
  escapeHtml,
  truncate,
  absoluteMediaUrl,
  genericCard,
  buildOgHtml,
  buildPostCard,
  postAttachmentImage,
  type ShareCard,
  type PostCardSource,
} from "../og-preview";

const ORIGIN = "https://bowdownvisuals.com";

describe("isSocialBot", () => {
  it.each([
    "Twitterbot/1.0",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Facebot",
    "Discordbot/2.0; +https://discordapp.com",
    "TelegramBot (like TwitterBot)",
    "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Slack-ImgProxy (+https://api.slack.com/robots)",
    "WhatsApp/2.19.81 A",
    "Pinterestbot/1.0",
    "redditbot/1.0",
    "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "SkypeUriPreview Preview/0.5",
  ])("detects scraper UA: %s", (ua) => {
    expect(isSocialBot(ua)).toBe(true);
  });

  it.each([
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "",
  ])("ignores real browsers/empty: %s", (ua) => {
    expect(isSocialBot(ua)).toBe(false);
  });

  it("handles undefined", () => {
    expect(isSocialBot(undefined)).toBe(false);
  });
});

describe("matchShareableRoute", () => {
  it.each([
    ["/track/abc123", { kind: "track", param: "abc123" }],
    ["/watch/xyz-789", { kind: "video", param: "xyz-789" }],
    ["/playlist/pl_01abcd", { kind: "playlist", param: "pl_01abcd" }],
    ["/post/550e8400-e29b-41d4-a716-446655440003", { kind: "post", param: "550e8400-e29b-41d4-a716-446655440003" }],
    ["/artist/shark-king", { kind: "artist", param: "shark-king" }],
    ["/showcase/neon-nights", { kind: "showcase", param: "neon-nights" }],
    ["/challenge/summer-banger", { kind: "challenge", param: "summer-banger" }],
    ["/albums/midnight-tape", { kind: "album", param: "midnight-tape" }],
    ["/bio/djshark", { kind: "bio", param: "djshark" }],
    ["/plan/q4-push", { kind: "plan", param: "q4-push" }],
    ["/review/AbC123_-xYz8901234567890", { kind: "review", param: "AbC123_-xYz8901234567890" }],
    ["/sound/original-sound-1", { kind: "sound", param: "original-sound-1" }],
    ["/shop/shark-merch", { kind: "shop", param: "shark-merch" }],
    ["/templates", { kind: "templates", param: "" }],
    ["/templates/", { kind: "templates", param: "" }],
    ["/templates/thumbnails", { kind: "templates-thumbnails", param: "" }],
    ["/templates/hooks", { kind: "templates-hooks", param: "" }],
    ["/templates/captions", { kind: "templates-captions", param: "" }],
    ["/templates/videos", { kind: "templates-videos", param: "" }],
    ["/hashtag/fyp", { kind: "hashtag", param: "fyp" }],
    ["/genre/hip-hop", { kind: "genre", param: "hip-hop" }],
    ["/vertical/gaming", { kind: "vertical", param: "gaming" }],
    ["/presave/midnight-tape", { kind: "presave", param: "midnight-tape" }],
    ["/tips/djshark", { kind: "tips", param: "djshark" }],
    ["/join/djshark", { kind: "join", param: "djshark" }],
    ["/c/shark-card", { kind: "card", param: "shark-card" }],
    ["/press/djshark", { kind: "press", param: "djshark" }],
    /* W3 lane 16 (D-6): public landings that previously had no card. */
    ["/premiere/550e8400-e29b-41d4-a716-446655440000", { kind: "premiere", param: "550e8400-e29b-41d4-a716-446655440000" }],
    ["/live/550e8400-e29b-41d4-a716-446655440001", { kind: "live", param: "550e8400-e29b-41d4-a716-446655440001" }],
    ["/storefront/product/550e8400-e29b-41d4-a716-446655440002", { kind: "product", param: "550e8400-e29b-41d4-a716-446655440002" }],
    ["/photo-preset/golden-hour", { kind: "photo-preset", param: "golden-hour" }],
    ["/collection/djshark", { kind: "collection", param: "djshark" }],
    ["/splits/0123abcdef", { kind: "splits", param: "0123abcdef" }],
    ["/unlock/vip-drop", { kind: "unlock", param: "vip-drop" }],
    ["/challenge/summer-banger/winners", { kind: "challenge-winners", param: "summer-banger" }],
  ])("matches %s", (path, expected) => {
    expect(matchShareableRoute(path)).toEqual(expected);
  });

  it.each(["/", "/dashboard", "/api/media/track/abc", "/track", "/artist/", "/track/a", "/login", "/songs"])(
    "ignores non-shareable %s",
    (path) => {
      expect(matchShareableRoute(path)).toBeNull();
    },
  );
});

describe("escapeHtml / truncate", () => {
  it("escapes hostile titles", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      `&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;`,
    );
  });

  it("truncates with ellipsis", () => {
    expect(truncate("hello world", 5)).toBe("hell…");
    expect(truncate("hi", 5)).toBe("hi");
  });
});

describe("absoluteMediaUrl", () => {
  it("passes absolute URLs through", () => {
    expect(absoluteMediaUrl("https://cdn.example.com/a.png", ORIGIN)).toBe(
      "https://cdn.example.com/a.png",
    );
  });
  it("resolves site-relative paths against the origin", () => {
    expect(absoluteMediaUrl("/uploads/a.png", ORIGIN)).toBe(
      `${ORIGIN}/uploads/a.png`,
    );
  });
  it("resolves bare storage keys against the origin", () => {
    expect(absoluteMediaUrl("uploads/a.png", ORIGIN)).toBe(
      `${ORIGIN}/uploads/a.png`,
    );
  });
  it("returns null for empty input", () => {
    expect(absoluteMediaUrl(null, ORIGIN)).toBeNull();
    expect(absoluteMediaUrl("  ", ORIGIN)).toBeNull();
  });
});

describe("genericCard", () => {
  it("post fallback names the post surface and its real URL", () => {
    const card = genericCard({ kind: "post", param: "p12345" }, ORIGIN);
    expect(card.title).toBe("Post on Bow Down Visuals");
    expect(card.url).toBe(`${ORIGIN}/post/p12345`);
    expect(card.image).toBe(`${ORIGIN}/og-fallback.png`);
  });

  it("uses the branded fallback image, never the homepage card", () => {
    const card = genericCard({ kind: "track", param: "abc123" }, ORIGIN);
    expect(card.image).toBe(`${ORIGIN}/og-fallback.png`);
    expect(card.image).not.toContain("opengraph.jpg");
    expect(card.url).toBe(`${ORIGIN}/track/abc123`);
    expect(card.twitterCard).toBe("summary_large_image");
    expect(card.robots).toBe("index, follow");
  });

  it("noindexes review links", () => {
    const card = genericCard({ kind: "review", param: "tok12345678901234567890" }, ORIGIN);
    expect(card.robots).toBe("noindex, nofollow");
  });

  it("noindexes splits agreements (unguessable share slugs, D-6)", () => {
    const card = genericCard({ kind: "splits", param: "0123abcdef" }, ORIGIN);
    expect(card.robots).toBe("noindex, nofollow");
    expect(card.url).toBe(`${ORIGIN}/splits/0123abcdef`);
  });

  it("builds canonical-shaped URLs for the W3 lane 16 kinds", () => {
    expect(genericCard({ kind: "product", param: "p12345" }, ORIGIN).url).toBe(
      `${ORIGIN}/storefront/product/p12345`,
    );
    expect(genericCard({ kind: "challenge-winners", param: "summer" }, ORIGIN).url).toBe(
      `${ORIGIN}/challenge/summer/winners`,
    );
    expect(genericCard({ kind: "premiere", param: "p12345" }, ORIGIN).url).toBe(
      `${ORIGIN}/premiere/p12345`,
    );
  });
});

describe("buildPostCard (Stack1000 P4 share truth)", () => {
  const author = {
    displayName: "Thy Cheat Code",
    slug: "thy-cheat-code",
    avatarUrl: "https://cdn.example.com/avatar.png",
  };
  const basePost: PostCardSource = {
    id: "550e8400-e29b-41d4-a716-446655440003",
    body: "New drop Friday — the crown stays heavy.",
    mediaUrls: [],
    contentWarnings: [],
    createdAt: new Date("2026-10-30T12:00:00.000Z"),
  };

  it("names the actual post: its own words lead the title, author follows", () => {
    const card = buildPostCard(basePost, author, ORIGIN);
    expect(card.title).toBe("New drop Friday — the crown stays heavy. — Thy Cheat Code");
    expect(card.description).toContain("New drop Friday");
    expect(card.url).toBe(`${ORIGIN}/post/${basePost.id}`);
    expect(card.jsonLd?.["@type"]).toBe("SocialMediaPosting");
  });

  it("uses the post's own first attachment image, not the brand fallback", () => {
    const card = buildPostCard(
      {
        ...basePost,
        mediaUrls: [
          { kind: "video", url: "https://cdn.example.com/v.mp4", thumb: "https://cdn.example.com/frame.jpg" },
          { kind: "image", url: "https://cdn.example.com/photo.jpg" },
        ],
      },
      author,
      ORIGIN,
    );
    // First image-bearing attachment wins (the video's cover frame here).
    expect(card.image).toBe("https://cdn.example.com/frame.jpg");
  });

  it("uses a track attachment's artwork and its creator-written alt", () => {
    const card = buildPostCard(
      {
        ...basePost,
        mediaUrls: [
          { kind: "track", id: "t1", artwork: "https://cdn.example.com/art.jpg", alt: "Gold crown cover art" },
        ],
      },
      author,
      ORIGIN,
    );
    expect(card.image).toBe("https://cdn.example.com/art.jpg");
    expect(card.imageAlt).toBe("Gold crown cover art");
  });

  it("content-warned posts never splash their media into the card", () => {
    const card = buildPostCard(
      {
        ...basePost,
        mediaUrls: [{ kind: "image", url: "https://cdn.example.com/covered.jpg" }],
        contentWarnings: ["graphic imagery"],
      },
      author,
      ORIGIN,
    );
    expect(card.image).toBe("https://cdn.example.com/avatar.png");
    expect(card.image).not.toContain("covered.jpg");
  });

  it("media-less posts fall back to the author avatar, then the brand card", () => {
    expect(buildPostCard(basePost, author, ORIGIN).image).toBe(
      "https://cdn.example.com/avatar.png",
    );
    expect(buildPostCard(basePost, { ...author, avatarUrl: null }, ORIGIN).image).toBe(
      `${ORIGIN}/og-fallback.png`,
    );
  });

  it("empty-body posts still name the author, never a generic site line alone", () => {
    const card = buildPostCard({ ...basePost, body: "   " }, author, ORIGIN);
    expect(card.title).toBe("Thy Cheat Code — post on Bow Down Visuals");
    expect(card.description).toBe("A post by Thy Cheat Code on Bow Down Visuals.");
  });

  it("postAttachmentImage skips kinds with no image and resolves relative keys", () => {
    expect(postAttachmentImage([{ kind: "event", id: "e1" }])).toBeNull();
    expect(postAttachmentImage(null)).toBeNull();
    const card = buildPostCard(
      { ...basePost, mediaUrls: [{ kind: "image", url: "/uploads/p.jpg" }] },
      author,
      ORIGIN,
    );
    expect(card.image).toBe(`${ORIGIN}/uploads/p.jpg`);
  });
});

describe("buildOgHtml", () => {
  const card: ShareCard = {
    title: `Test "Track" <b>`,
    description: "A description & more",
    image: `${ORIGIN}/og-fallback.png`,
    imageAlt: "alt",
    url: `${ORIGIN}/track/abc`,
    ogType: "music.song",
    twitterCard: "summary_large_image",
    robots: "index, follow",
    jsonLd: { "@context": "https://schema.org", "@type": "MusicRecording", name: "Test" },
  };

  it("emits escaped og/twitter tags and JSON-LD", () => {
    const html = buildOgHtml(card);
    expect(html).toContain(`<meta property="og:title" content="Test &quot;Track&quot; &lt;b&gt;" />`);
    expect(html).toContain(`<meta name="twitter:card" content="summary_large_image" />`);
    expect(html).toContain(`<meta property="og:image" content="${ORIGIN}/og-fallback.png" />`);
    expect(html).toContain(`"@type":"MusicRecording"`);
    expect(html).not.toContain("<script>alert");
  });

  it("neutralizes </script> inside JSON-LD", () => {
    const evil: ShareCard = {
      ...card,
      jsonLd: { "@context": "https://schema.org", name: `x</script><script>alert(1)` },
    };
    const html = buildOgHtml(evil);
    expect(html).not.toContain("x</script><script>");
    expect(html).toContain("x<\\/script>");
  });

  it("emits og:video tags for videos", () => {
    const html = buildOgHtml({ ...card, videoUrl: "https://cdn.example.com/v.mp4", videoType: "video/mp4" });
    expect(html).toContain(`<meta property="og:video" content="https://cdn.example.com/v.mp4" />`);
    expect(html).toContain(`<meta property="og:video:type" content="video/mp4" />`);
  });

  it("emits image dimensions only for the known 1200x630 brand cards (D-4)", () => {
    const brand = buildOgHtml(card); // card.image is og-fallback.png
    expect(brand).toContain(`<meta property="og:image:width" content="1200" />`);
    expect(brand).toContain(`<meta property="og:image:height" content="630" />`);
    const entity = buildOgHtml({ ...card, image: "https://cdn.example.com/art-800x800.png" });
    expect(entity).not.toContain("og:image:width");
    expect(entity).not.toContain("og:image:height");
  });

  it("canonical strips the ?ref= suffix while og:url keeps it (D-5)", () => {
    const html = buildOgHtml({
      ...card,
      url: `${ORIGIN}/albums/midnight-tape?ref=SHARK1`,
      canonicalUrl: `${ORIGIN}/albums/midnight-tape`,
    });
    expect(html).toContain(
      `<link rel="canonical" href="${ORIGIN}/albums/midnight-tape" />`,
    );
    expect(html).toContain(
      `<meta property="og:url" content="${ORIGIN}/albums/midnight-tape?ref=SHARK1" />`,
    );
  });

  it("includes a meta-refresh + link back into the SPA", () => {
    const html = buildOgHtml(card);
    expect(html).toContain(
      `<meta http-equiv="refresh" content="0;url=${ORIGIN}/track/abc" />`,
    );
    expect(html).toContain(`<a href="${ORIGIN}/track/abc">`);
  });
});
