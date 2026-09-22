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
  const site = process.env.SITE_URL ?? "https://www.bowdownvisuals.com";
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
