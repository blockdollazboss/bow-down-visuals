process.env.NODE_ENV = "production";

import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const artifactDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(artifactDir, "dist", "public");

const ROUTES = [
  {
    path: "/",
    outFile: "index.html",
    title: "Bow Down Visuals — Create Songs, Music Videos & Promo Clips With AI",
    description:
      "Tell us your artist, genre, and idea. In seconds, Bow Down Visuals generates lyrics, a full video treatment, promo content, and more — ready to use.",
  },
  {
    path: "/pricing",
    outFile: "pricing/index.html",
    title: "Pricing — Bow Down Visuals",
    description:
      "Choose your creator plan. Beta members lock in the founding rate and get bonus credits when Bow Down Visuals' AI song, video, and promo tools go live.",
  },
  {
    path: "/waitlist",
    outFile: "waitlist/index.html",
    title: "Join the Waitlist — Bow Down Visuals",
    description:
      "Join the Bow Down Visuals waitlist for early access to AI-powered song, music video, and promo clip creation built for independent artists.",
  },
  {
    path: "/tools",
    outFile: "tools/index.html",
    title: "AI Tools for Creators — Thumbnails, Hooks, Videos, Songs & More | Bow Down Visuals",
    description: "Every AI tool on Bow Down Visuals: thumbnail maker, hook generator, caption writer, music video maker, clip cutter, and song maker. Free to browse.",
  },
  {
    path: "/for",
    outFile: "for/index.html",
    title: "AI Tools by Creator Type — YouTubers, Podcasters, Streamers & More | Bow Down Visuals",
    description: "AI toolkits tuned for your kind of creator: YouTubers, podcasters, streamers, musicians, TikTokers, and educators. Tools, templates, and workflows per lane.",
  },
  {
    path: "/tools/ai-thumbnail-maker",
    outFile: "tools/ai-thumbnail-maker/index.html",
    title: "AI Thumbnail Maker — High-CTR YouTube Thumbnails in Seconds | Bow Down Visuals",
    description: "Generate scroll-stopping YouTube thumbnails with AI. Pick a proven template style, describe your video, and get a high-CTR thumbnail in seconds.",
  },
  {
    path: "/tools/ai-hook-generator",
    outFile: "tools/ai-hook-generator/index.html",
    title: "AI Hook Generator — Viral Video Hooks for TikTok, Reels & Shorts | Bow Down Visuals",
    description: "Generate scroll-stopping video hooks with AI. Pick a template for music promos, tutorials, announcements and more — 5 viral-ready hooks in seconds.",
  },
  {
    path: "/tools/ai-caption-generator",
    outFile: "tools/ai-caption-generator/index.html",
    title: "AI Caption Generator — Captions & Hashtags for Every Post | Bow Down Visuals",
    description: "Write better captions with AI. 30 caption packs for releases, launches, tours, merch drops and more — with hashtag sets tuned for reach.",
  },
  {
    path: "/tools/ai-music-video-maker",
    outFile: "tools/ai-music-video-maker/index.html",
    title: "AI Music Video Maker — Turn Songs Into Cinematic Videos | Bow Down Visuals",
    description: "Make music videos with AI: generate clips from text or images, sync lyric cuts to the beat, and export release-ready videos for any platform.",
  },
  {
    path: "/tools/ai-clip-maker",
    outFile: "tools/ai-clip-maker/index.html",
    title: "AI Clip Maker — Turn Long Videos Into Viral Short Clips | Bow Down Visuals",
    description: "Repurpose long videos into Shorts, Reels, and TikToks with AI. Auto-find the best moments, cut vertical clips, and add captions in one flow.",
  },
  {
    path: "/tools/ai-song-maker",
    outFile: "tools/ai-song-maker/index.html",
    title: "AI Song Maker — Write & Produce Full Songs With AI | Bow Down Visuals",
    description: "Create original songs with AI: lyrics, melodies, and full production in any genre. From a one-line idea to a release-ready track.",
  },
  {
    path: "/for/youtubers",
    outFile: "for/youtubers/index.html",
    title: "AI Video Tools for YouTubers — Thumbnails, Hooks & Edits | Bow Down Visuals",
    description: "AI tools built for YouTubers: high-CTR thumbnail maker, viral hook generator, clip cutter, and caption packs — everything to grow your channel.",
  },
  {
    path: "/for/podcasters",
    outFile: "for/podcasters/index.html",
    title: "AI Tools for Podcasters — Clips, Captions & Promotion | Bow Down Visuals",
    description: "AI tools for podcasters: turn episodes into viral clips, generate captions and hooks, and promote every episode without hiring an editor.",
  },
  {
    path: "/for/streamers",
    outFile: "for/streamers/index.html",
    title: "AI Tools for Streamers — Highlights, Clips & Channel Branding | Bow Down Visuals",
    description: "AI tools for streamers: auto-cut stream highlights, viral clips from VODs, thumbnails, and hooks — turn every stream into a week of content.",
  },
  {
    path: "/for/musicians",
    outFile: "for/musicians/index.html",
    title: "AI Tools for Musicians — Songs, Videos & Release Promo | Bow Down Visuals",
    description: "AI tools for musicians: generate songs, make music videos, write viral hooks and captions — the full pipeline from idea to release day.",
  },
  {
    path: "/for/tiktokers",
    outFile: "for/tiktokers/index.html",
    title: "AI Tools for TikTokers — Hooks, Captions & Viral Clips | Bow Down Visuals",
    description: "AI tools for TikTok creators: scroll-stopping hooks, caption packs with hashtags, and clip templates — post daily without burning out.",
  },
  {
    path: "/for/educators",
    outFile: "for/educators/index.html",
    title: "AI Tools for Educators & Course Creators — Lessons Into Content | Bow Down Visuals",
    description: "AI tools for educators: turn lessons into Shorts, write hooks that make learning scroll-stopping, and promote courses without a marketing team.",
  },
  {
    path: "/genres/hip-hop",
    outFile: "genres/hip-hop/index.html",
    title: "Make Hip-Hop With AI — Beats, Lyrics & Music Videos | Bow Down Visuals",
    description: "Create hip-hop with AI: hard-hitting beats, bar-for-bar lyrics, and cinematic music videos. From boom bap to trap to drill.",
  },
  {
    path: "/genres/pop",
    outFile: "genres/pop/index.html",
    title: "Make Pop Music With AI — Hooks, Production & Visuals | Bow Down Visuals",
    description: "Create pop music with AI: unforgettable hooks, polished production, and release-ready visuals. From dance-pop to bedroom pop.",
  },
  {
    path: "/genres/edm",
    outFile: "genres/edm/index.html",
    title: "Make EDM With AI — Drops, Builds & Festival Anthems | Bow Down Visuals",
    description: "Produce EDM with AI: massive drops, euphoric builds, and festival-ready masters. House, dubstep, techno, trance and more.",
  },
  {
    path: "/genres/rock",
    outFile: "genres/rock/index.html",
    title: "Make Rock Music With AI — Riffs, Anthems & Live Energy | Bow Down Visuals",
    description: "Create rock with AI: driving riffs, anthemic choruses, and live-band energy. From garage rock to alt-rock to hard rock.",
  },
  {
    path: "/genres/rnb",
    outFile: "genres/rnb/index.html",
    title: "Make R&B With AI — Smooth Vocals, Slow Jams & Soul | Bow Down Visuals",
    description: "Create R&B with AI: silky vocal runs, lush chords, and late-night grooves. From classic soul to modern alternative R&B.",
  },
  {
    path: "/genres/lofi",
    outFile: "genres/lofi/index.html",
    title: "Make Lo-Fi Beats With AI — Chill Study & Relaxing Beats | Bow Down Visuals",
    description: "Create lo-fi beats with AI: dusty drums, jazzy chords, and cozy textures. Perfect for study playlists, streams, and relaxing content.",
  },
  {
    path: "/genres/country",
    outFile: "genres/country/index.html",
    title: "Make Country Music With AI — Storytelling Songs & Heartfelt Ballads | Bow Down Visuals",
    description: "Create country music with AI: storytelling lyrics, acoustic warmth, and heartfelt ballads. From classic country to modern country-pop.",
  },
  {
    path: "/genres/trap",
    outFile: "genres/trap/index.html",
    title: "Make Trap Music With AI — 808s, Hi-Hats & Hard Beats | Bow Down Visuals",
    description: "Produce trap with AI: sliding 808s, rapid hi-hats, and dark atmospheric beats. From Atlanta trap to rage to drill-adjacent sounds.",
  },
];

async function main() {
  const template = await fs.readFile(path.join(publicDir, "index.html"), "utf-8");

  const vite = await createServer({
    root: artifactDir,
    configFile: path.join(artifactDir, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "warn",
    optimizeDeps: { noDiscovery: true, include: [] },
  });

  try {
    const { renderMarketingPage } = await vite.ssrLoadModule("/src/entry-server.tsx");

    for (const route of ROUTES) {
      let appHtml;
      try {
        appHtml = renderMarketingPage(route.path);
      } catch (err) {
        console.warn(
          `[prerender] Skipping "${route.path}" — render failed, falling back to the CSR shell for this route.`,
          err,
        );
        continue;
      }

      let html = template
        .replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`)
        .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(route.title)}</title>`)
        .replace(
          /<meta name="description" content=".*?" \/>/,
          `<meta name="description" content="${escapeHtml(route.description)}" />`,
        )
        .replace(
          /<meta property="og:title" content=".*?" \/>/,
          `<meta property="og:title" content="${escapeHtml(route.title)}" />`,
        )
        .replace(
          /<meta property="og:description" content=".*?" \/>/,
          `<meta property="og:description" content="${escapeHtml(route.description)}" />`,
        )
        .replace(
          /<meta name="twitter:title" content=".*?" \/>/,
          `<meta name="twitter:title" content="${escapeHtml(route.title)}" />`,
        )
        .replace(
          /<meta name="twitter:description" content=".*?" \/>/,
          `<meta name="twitter:description" content="${escapeHtml(route.description)}" />`,
        );

      const canonical = canonicalHref(route.path);
      html = html.replace(
        /<link rel="canonical" href=".*?" \/>/,
        `<link rel="canonical" href="${canonical}" />`,
      );
      if (!html.includes('rel="canonical"')) {
        html = html.replace("</head>", `  <link rel="canonical" href="${canonical}" />\n  </head>`);
      }

      html = html.replace(
        /<meta property="og:url" content=".*?" \/>/,
        `<meta property="og:url" content="${canonical}" />`,
      );

      const outPath = path.join(publicDir, route.outFile);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, html);
      console.log(`[prerender] Wrote ${route.outFile}`);
    }
  } finally {
    await vite.close();
  }
}

function canonicalHref(routePath) {
  const site = process.env.SITE_URL ?? "https://bowdownvisuals.com";
  return routePath === "/" ? site + "/" : `${site}${routePath}`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

main().catch((err) => {
  console.error("[prerender] Failed:", err);
  process.exit(1);
});
