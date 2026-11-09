process.env.NODE_ENV = "production";

import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const artifactDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(artifactDir, "dist", "public");

/* Access lock-down (Lane 4, audit ~/workspace/access-lockdown/AUDIT.md
   §1.4 / §4.6 / §5.1): this script prerenders ONLY the static public
   set listed in ROUTES below — nothing else. In particular it must
   NEVER generate the SEO / marketing family: /pricing, /beta-access,
   /tools + /tools/*, /for + /for/* and the genre hubs are NOT
   prerendered routes. That family is LOCKED behind sign-in by the
   owner's ruling, and a prerendered page that bounces to /login is a
   soft-404 risk, so no file for it may exist in the output at all.
   (C-15, Stack 400: this header previously named the family in a way
   that read as part of the prerender set — the lockdown census
   flagged it as the lie the next SEO lane would rebuild from. The
   family is named here only to be excluded.) The matching sitemap
   trim lives in public/sitemap.xml; both lists are pinned by
   src/lib/prerender-sitemap-lockdown.test.ts. Parameterized routes get
   no invented entries, ever.

   Stack-300 SEO #84 (deliberate revisit, same pattern as W3's /world
   sitemap revisit and N10's /scenes revisit): the static public set
   joins the prerender list as HEAD-ONLY entries. The defect: only `/`
   had a prerendered file, so every other public page shipped the
   HOMEPAGE's <title>/description/canonical/OG to crawlers and
   non-JS scrapers (the SPA fallback serves the one shell verbatim).
   These are live app surfaces, not static marketing pages — their
   bodies are NOT server-rendered (entry-server.tsx still registers
   ONLY `/`; the lockdown test pins that) — but each route now gets
   its own static HTML file carrying its OWN head: the title and
   description are copied verbatim from the page's own usePageTitle
   call (rendered form: "<title> | Bow Down Visuals"), the canonical
   and og:url point at the route itself, and a route may pin its own
   share image via `image` (root-relative; absolutized against
   SITE_URL). Humans are unaffected: the client boots the full App
   into the empty root exactly as it does from the shell today. */
const ROUTES = [
  {
    path: "/",
    outFile: "index.html",
    /* W3 lane 16 (D-7): the prerendered homepage IS the crawler copy of
       `/` — its title/description must match index.html exactly, or
       crawlers and everyone else get two different cards for `/`. */
    title: "Bow Down Visuals — The Content Creator's Cheat Code",
    description:
      "The AI studio for every creator — songs, videos, promo clips, branding, and business tools. Create, brand, promote, and get paid: pay only for what you create.",
  },
  /* ── Head-only entries (Stack-300 SEO #84) ──────────────────────────
     Copy source for every title/description: the page's own
     usePageTitle call (or its en.json meta strings for i18n pages). */
  {
    path: "/world",
    outFile: "world/index.html",
    headOnly: true,
    title: "The World — The King's Plaza | Bow Down Visuals",
    description:
      "Step into the King's Plaza, the palace's front square. Six districts stand open around it: Stage Grounds, Listening Gardens, Creation Row, The Ateliers, The Boardwalk and Creator Heights. Inside, palace desks mirror the site's Create, Brand, Promote and Money features.",
    /* The World pins the flagship lockup card as ITS share image —
       the route owns it explicitly instead of inheriting whatever
       the homepage shell carries. */
    image: "/opengraph.jpg",
  },
  {
    path: "/charts",
    outFile: "charts/index.html",
    headOnly: true,
    title: "Charts | Bow Down Visuals",
    description: "The hottest tracks, videos, and creators on Bow Down Visuals right now.",
  },
  {
    path: "/scenes",
    outFile: "scenes/index.html",
    headOnly: true,
    title: "Local Scenes | Bow Down Visuals",
    description:
      "Every city with a real scene — the creators who declared it, their real shows, and the city's own chart.",
  },
  {
    path: "/shorts",
    outFile: "shorts/index.html",
    headOnly: true,
    title: "Shorts | Bow Down Visuals",
    description: "Watch creator shorts on Bow Down Visuals.",
  },
  {
    path: "/beats",
    outFile: "beats/index.html",
    headOnly: true,
    title: "Beat Marketplace | Bow Down Visuals",
    description:
      "Buy and sell beats: producers list instrumentals, and artists preview and license them by tier.",
  },
  {
    path: "/shoutouts",
    outFile: "shoutouts/index.html",
    headOnly: true,
    title: "Shoutouts | Bow Down Visuals",
    description:
      "Sell personalized video shoutouts to fans — set your price and manage requests in one place.",
  },
  {
    path: "/memberships",
    outFile: "memberships/index.html",
    headOnly: true,
    title: "Memberships | Bow Down Visuals",
    description:
      "Launch your fan club with paid membership tiers, member perks, and tracking.",
  },
  {
    path: "/contests",
    outFile: "contests/index.html",
    headOnly: true,
    title: "Contests | Bow Down Visuals",
    description:
      "Run fan contests and giveaways with entry tracking and a provably fair winner draw.",
  },
  {
    path: "/winners",
    outFile: "winners/index.html",
    headOnly: true,
    title: "Winners' Circle — Hall of Fame | Bow Down Visuals",
    description:
      "The Winners' Circle: meet the creators taking home Bow Down Visuals challenge crowns, and see the winning work that earned them.",
  },
  {
    path: "/terms",
    outFile: "terms/index.html",
    headOnly: true,
    title: "Terms of Service | Bow Down Visuals",
    description: "The terms governing your use of Bow Down Visuals.",
  },
  {
    path: "/privacy",
    outFile: "privacy/index.html",
    headOnly: true,
    title: "Privacy Policy | Bow Down Visuals",
    description: "How Bow Down Visuals handles your data.",
  },
  {
    path: "/refund-policy",
    outFile: "refund-policy/index.html",
    headOnly: true,
    title: "Refund Policy | Bow Down Visuals",
    description: "Our refund policy for Visual Bucs and purchases.",
  },
  {
    path: "/storefronts",
    outFile: "storefronts/index.html",
    headOnly: true,
    title: "Creator Storefronts | Bow Down Visuals",
    description:
      "Every creator gets their own shop on Bow Down Visuals — merch, music, and digital drops, all in one gold-standard storefront.",
  },
  {
    path: "/app",
    outFile: "app/index.html",
    headOnly: true,
    title: "Get the App — Bow Down Visuals | Bow Down Visuals",
    description:
      "Get the Bow Down Visuals app — download the Android APK or the Chrome extension, or install the web app on iPhone, iPad, Windows and Mac.",
  },
]

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
      /* Head-only routes (Stack-300 SEO #84) skip the SSR body: the
         file is the shell with the route's own head rewritten below.
         The client boots the full App into the empty root on load,
         exactly as it does for every non-prerendered route today. */
      let appHtml = "";
      if (!route.headOnly) {
        try {
          appHtml = renderMarketingPage(route.path);
        } catch (err) {
          console.warn(
            `[prerender] Skipping "${route.path}" — render failed, falling back to the CSR shell for this route.`,
            err,
          );
          continue;
        }
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

      /* Per-route share image (Stack-300 SEO #84): a route that pins
         its own `image` gets og:image / twitter:image rewritten to it
         (absolutized against the same site base as the canonical);
         routes without one keep the shell's card, as before. */
      if (route.image) {
        const imageUrl = `${siteBase()}${route.image}`;
        html = html
          .replace(
            /<meta property="og:image" content=".*?" \/>/,
            `<meta property="og:image" content="${imageUrl}" />`,
          )
          .replace(
            /<meta name="twitter:image" content=".*?" \/>/,
            `<meta name="twitter:image" content="${imageUrl}" />`,
          );
      }

      const outPath = path.join(publicDir, route.outFile);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, html);
      console.log(`[prerender] Wrote ${route.outFile}`);
    }
  } finally {
    await vite.close();
  }
}

function siteBase() {
  return (process.env.SITE_URL ?? "https://bowdownvisuals.com").replace(/\/+$/, "");
}

function canonicalHref(routePath) {
  const site = siteBase();
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
