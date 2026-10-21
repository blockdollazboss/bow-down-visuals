/* Isolated SSR smoke test for SEO pages — bypasses entry-server's chain. */
process.env.NODE_ENV = "production";
import { createServer } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const artifactDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function main() {
  const vite = await createServer({
    root: artifactDir,
    configFile: path.join(artifactDir, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const React = await import("react");
    const { renderToString } = await import("react-dom/server");
    const { Router } = await vite.ssrLoadModule("wouter");
    const { TOOL_PAGES, VERTICAL_HUBS, GENRE_HUBS } = await vite.ssrLoadModule("/src/data/seo-pages.ts");
    const { ToolSeoPage } = await vite.ssrLoadModule("/src/pages/seo/tool-page.tsx");
    const { VerticalHubSeo } = await vite.ssrLoadModule("/src/pages/seo/vertical-hub.tsx");
    const { GenreHubSeo } = await vite.ssrLoadModule("/src/pages/seo/genre-hub.tsx");
    const ToolsIndex = (await vite.ssrLoadModule("/src/pages/seo/tools-index.tsx")).default;
    const ForIndex = (await vite.ssrLoadModule("/src/pages/seo/for-index.tsx")).default;

    const cases = [
      ["tools-index", React.createElement(ToolsIndex)],
      ["for-index", React.createElement(ForIndex)],
      ...TOOL_PAGES.map((t) => [`tool:${t.slug}`, React.createElement(ToolSeoPage, { tool: t })]),
      ...VERTICAL_HUBS.map((v) => [`vertical:${v.slug}`, React.createElement(VerticalHubSeo, { vertical: v })]),
      ...GENRE_HUBS.map((g) => [`genre:${g.slug}`, React.createElement(GenreHubSeo, { genre: g })]),
    ];

    let ok = 0;
    for (const [name, el] of cases) {
      try {
        const html = renderToString(React.createElement(Router, { ssrPath: "/" }, el));
        const h1 = (html.match(/<h1/g) || []).length;
        const h2 = (html.match(/<h2/g) || []).length;
        const jsonld = (html.match(/application\/ld\+json/g) || []).length;
        const links = (html.match(/<a /g) || []).length;
        const pass = h1 >= 1 && h2 >= 3 && jsonld >= 2 && links >= 10;
        console.log(`${pass ? "OK  " : "WARN"} ${name} len=${html.length} h1=${h1} h2=${h2} jsonld=${jsonld} links=${links}`);
        if (pass) ok++;
      } catch (err) {
        console.log(`FAIL ${name}: ${String(err && err.message || err).slice(0, 300)}`);
      }
    }
    console.log(`${ok}/${cases.length} passed`);
    if (ok !== cases.length) process.exit(1);
  } finally {
    await vite.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
