process.env.NODE_ENV = "production";

import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const artifactDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(artifactDir, "dist", "public");

/* Access lock-down (Lane 4, audit ~/workspace/access-lockdown/AUDIT.md
   §1.4 / §4.6 / §5.1): prerender ONLY the static public set. The SEO /
   marketing family (/pricing, /beta-access, /tools + /tools/*, /for +
   /for/*, genre hubs) is LOCKED behind sign-in by the owner's ruling —
   a prerendered page that bounces to /login is a soft-404 risk, so it
   must not be generated at all. The matching sitemap trim lives in
   public/sitemap.xml; both lists are pinned by
   src/lib/prerender-sitemap-lockdown.test.ts. Public-but-dynamic routes
   (/artist/:slug, /charts, /shorts, marketplace browse, legal pages…)
   are NOT added here — they were never prerendered, and parameterized
   routes get no invented entries. */
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
