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
  type ShareCard,
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

  it("includes a meta-refresh + link back into the SPA", () => {
    const html = buildOgHtml(card);
    expect(html).toContain(
      `<meta http-equiv="refresh" content="0;url=${ORIGIN}/track/abc" />`,
    );
    expect(html).toContain(`<a href="${ORIGIN}/track/abc">`);
  });
});
