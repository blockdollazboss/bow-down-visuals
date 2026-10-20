#!/usr/bin/env node
/* ─── Operator knowledge generator — Cloud Operator Phase 1 ────────────────
   Builds src/lib/operator-knowledge.json, the feature knowledge base the
   Thy Cheat Code chat (routes/chat.ts) answers from.

   EVERYTHING in the output is derived from the codebase's own sources of
   truth — nothing is hand-typed feature copy:

     routes/paths/components .. artifacts/bow-down-visuals/src/App.tsx
     access (public / locked) .. src/lib/public-routes.ts ROUTE_MATRIX
     display names + sections .. src/components/layout/app-sidebar.tsx
                                 (labels resolved through src/locales/en.json)
     desk modules + handoffs ... src/lib/desks.ts (Visual Vibes registry)
     page guides ............... src/guides/*.ts (route + pageName)
     descriptions .............. en.json page namespaces (prose fields only,
                                 with the namespace recorded as provenance)
     prices .................... src/lib/credit-costs.ts CREDIT_COSTS — the
                                 frontend registry that records server charges
                                 (cross-checked against server-side *_COST
                                 constants; disagreements print as warnings)
     credit packs ................ src/routes/stripe-payments.ts PACK_MAP

   The only hand-kept data in THIS file is classification, mirroring how
   public-routes.ts keeps ROUTE_MATRIX: STAGE_RULES (which journey stage a
   route belongs to, for routes the sidebar doesn't list) and EXCLUSIONS
   (every route / page file deliberately left out of the knowledge base,
   with the reason). The coverage test (src/lib/__tests__/
   operator-knowledge.test.ts) re-derives the route + page-file sets and
   fails if anything is neither in the knowledge base nor excluded here.

   Run:  node scripts/generate-operator-knowledge.mjs
   (from artifacts/api-server; re-run whenever features or prices change)
   ───────────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(API_DIR, "..", "..");
const FE_SRC = path.join(REPO_ROOT, "artifacts", "bow-down-visuals", "src");
const API_SRC = path.join(API_DIR, "src");
const OUT_FILE = path.join(API_SRC, "lib", "operator-knowledge.json");

const read = (p) => readFileSync(p, "utf8");
const rel = (p) => path.relative(REPO_ROOT, p).split(path.sep).join("/");

/* ═══ Reviewed classification data ════════════════════════════════════════ */

/** Sidebar section titleKey → journey stage. */
const SECTION_STAGE = {
  "nav.myStudio": "studio",
  "nav.create": "create",
  "nav.branding": "brand",
  "nav.promote": "promote",
  "nav.social": "social",
  "nav.getPaid": "money",
};

/** The money journey, in order. Handoffs walk this chain. */
export const JOURNEY = ["create", "brand", "promote", "money"];

/** Canonical entry point per journey stage (used for next-step handoffs
    when a feature has no desk-level handoff of its own). */
const STAGE_ENTRY = {
  create: { label: "Create", path: "/create" },
  brand: { label: "Branding Kit", path: "/branding-kit" },
  promote: { label: "Promote", path: "/promote" },
  money: { label: "Monetization Coach", path: "/coach" },
};

/** Stage for routes the sidebar does not list, by first path segment.
    Reviewed by hand against the full route table — keep in sync. */
const SEGMENT_STAGE = {
  "": "studio",
  world: "world",
  admin: "admin",
  login: "account",
  signup: "account",
  "qr-login": "account",
  "reset-password": "account",
  "beta-access": "account",
  waitlist: "account",
  terms: "account",
  privacy: "account",
  "refund-policy": "account",
  copyright: "account",
  contact: "account",
  settings: "account",
  account: "account",
  pricing: "money",
  "creator-pricing": "money",
  credits: "money",
  "credit-history": "money",
  earnings: "money",
  coach: "money",
  "brand-deals": "money",
  distribute: "money",
  royalties: "money",
  memberships: "money",
  tips: "money",
  "get-paid": "money",
  create: "create",
  hub: "create",
  "my-projects": "create",
  "video-editor": "create",
  "audio-studio": "create",
  "thumbnail-studio": "create",
  "cover-art": "create",
  "caption-styler": "create",
  hooks: "create",
  books: "create",
  podcast: "create",
  "ai-audio": "create",
  songs: "create",
  song: "create",
  beats: "create",
  "beat-maker": "create",
  library: "studio",
  dashboard: "studio",
  "choose-artist": "studio",
  "artist-setup": "brand",
  "artist-vault": "brand",
  "branding-kit": "brand",
  "brand-kit": "brand",
  "link-in-bio": "brand",
  bio: "brand",
  "press-kit": "brand",
  promote: "promote",
  scheduler: "promote",
  "social-accounts": "promote",
  campaigns: "promote",
  ugc: "promote",
  home: "social",
  community: "social",
  groups: "social",
  messages: "social",
  explore: "social",
  friends: "social",
  collabs: "social",
  notifications: "social",
  live: "social",
  "go-live": "social",
  contests: "social",
  events: "social",
  arcade: "social",
  charts: "discover",
  shorts: "discover",
  templates: "discover",
  tools: "discover",
  for: "discover",
  genres: "discover",
  marketplace: "discover",
  shops: "discover",
  storefronts: "discover",
  shop: "discover",
  store: "discover",
  artist: "discover",
  track: "discover",
  watch: "discover",
  playlist: "discover",
  premiere: "discover",
  press: "discover",
  extension: "studio",
  download: "studio",
  guides: "studio",
  academy: "studio",
  review: "account",
  "sync-one-sheet": "account",
};

/** Routes / page files deliberately NOT in the knowledge base, each with
    the reason. The coverage test fails on anything unlisted here that is
    also missing from the knowledge base — no silent gaps. */
const EXCLUDED_ROUTES = {
  "*": "Catch-all 404 route — not a feature.",
};
const EXCLUDED_PAGE_FILES = {
  "artifacts/bow-down-visuals/src/pages/not-found.tsx":
    "The 404 page — rendered by the catch-all route (component={NotFound}); not a feature.",
  "artifacts/bow-down-visuals/src/pages/songs/albums-section.tsx":
    "Section component imported by the legacy songs page (pages/songs.tsx); not a route of its own.",
  // Every other unrouted page file is expected to be a legacy standalone
  // page whose same-name route now redirects into a tabbed host — the
  // generator derives that reason from the redirect itself (see assembly).
  // A file that matches neither this map nor a redirecting same-name route
  // is reported UNREVIEWED and fails the coverage test until classified.
};

/* ═══ Extractors ══════════════════════════════════════════════════════════ */

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

/** App.tsx: component→page-file imports and the route table. */
function extractApp() {
  const appPath = path.join(FE_SRC, "App.tsx");
  const src = read(appPath);
  const pageImport = new Map(); // component name -> repo-rel page file
  const importRe = /import\s+(?:\{\s*)?([A-Z][A-Za-z0-9]*)(?:\s*\})?\s+from\s+"(@\/pages\/[^"]+)"/g;
  let m;
  while ((m = importRe.exec(src))) {
    const file = m[2].replace("@/", "artifacts/bow-down-visuals/src/");
    pageImport.set(m[1], file);
  }
  const lazyRe = /const\s+([A-Z][A-Za-z0-9]*)\s*=\s*(?:lazy|lazyWithRetry)\(\(\)\s*=>\s*import\("(@\/pages\/[^"]+)"\)\)/g;
  while ((m = lazyRe.exec(src))) {
    pageImport.set(m[1], m[2].replace("@/", "artifacts/bow-down-visuals/src/"));
  }

  /* Local wrapper components defined in App.tsx (e.g. BrandDealsRoute)
     render exactly one page component — resolve through them. */
  const wrapperMap = new Map();
  const wrapRe = /function\s+([A-Z][A-Za-z0-9]*)\s*\([^)]*\)\s*\{([\s\S]{0,1200}?)\n\}/g;
  while ((m = wrapRe.exec(src))) {
    const tags = [...m[2].matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)].map((t) => t[1]);
    const target = tags.find((t) => pageImport.has(t));
    if (target) wrapperMap.set(m[1], target);
  }

  const routes = [];
  const routeRe = /<Route\b([\s\S]*?)(?:<\/Route>|\/>)/g;
  while ((m = routeRe.exec(src))) {
    const block = m[1];
    const pathM = block.match(/path="([^"]+)"/);
    const compAttrM = block.match(/component=\{([A-Za-z0-9]+)\}/);
    const redirectM = block.match(/(?:Redirect|CreateRedirect|QueryPreservingRedirect)[^>]*?to="([^"]+)"/);
    let component = null;
    if (compAttrM) component = compAttrM[1];
    else {
      const tags = [...block.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)].map((t) => t[1]);
      component = tags.find((t) => pageImport.has(t)) ?? tags.map((t) => wrapperMap.get(t)).find(Boolean) ?? null;
    }
    routes.push({
      path: pathM ? pathM[1] : "*",
      component,
      redirectTo: redirectM ? redirectM[1] : null,
    });
  }
  return { routes, pageImport };
}

/** public-routes.ts: ROUTE_MATRIX dispositions + the public allowlist. */
function extractRouteMatrix() {
  const src = read(path.join(FE_SRC, "lib", "public-routes.ts"));
  const matrix = new Map();
  const startIdx = src.indexOf("export const ROUTE_MATRIX");
  const bodyM = startIdx >= 0 ? src.slice(startIdx).match(/=\s*\[([\s\S]*?)\n\];/) : null;
  if (bodyM) {
    const entryRe = /\{\s*path:\s*"([^"]+)",\s*disposition:\s*"([^"]+)"(?:,\s*redirectTo:\s*"([^"]+)")?/g;
    let m;
    while ((m = entryRe.exec(bodyM[1]))) {
      matrix.set(m[1], { disposition: m[2], redirectTo: m[3] ?? null });
    }
  }
  return matrix;
}

/** app-sidebar.tsx SECTIONS: href -> { labelKey, section titleKey }. */
function extractSidebar(en) {
  const src = read(path.join(FE_SRC, "components", "layout", "app-sidebar.tsx"));
  const start = src.indexOf("const SECTIONS");
  const body = start >= 0 ? src.slice(start, src.indexOf("\n];", start)) : "";
  const byPath = new Map();
  let section = null;
  const lineRe = /titleKey:\s*"([^"]+)"|\{\s*href:\s*"([^"]+)",\s*labelKey:\s*"([^"]+)"/g;
  let m;
  while ((m = lineRe.exec(body))) {
    if (m[1]) section = m[1];
    else if (m[2] && section) {
      const label = en.nav?.[m[3].replace("nav.", "")];
      const base = m[2].split("?")[0];
      const existing = byPath.get(base);
      // First write wins; a queryless href beats a ?panel= deep link that
      // merely shares the base path (e.g. /create vs /create?panel=song).
      if (!existing || (existing.href.includes("?") && !m[2].includes("?"))) {
        byPath.set(base, {
          labelKey: m[3],
          name: typeof label === "string" ? label : null,
          section,
          href: m[2],
        });
      }
    }
  }
  return byPath;
}

/** lib/desks.ts: the Visual Vibes desk registry. */
function extractDesks() {
  const src = read(path.join(FE_SRC, "lib", "desks.ts"));
  const desks = [];
  const deskRe = /\{\s*key:\s*"(\w+)",\s*name:\s*"([^"]+)",\s*blurb:\s*"([^"]+)",\s*route:\s*"([^"]+)"/g;
  let m;
  while ((m = deskRe.exec(src))) {
    desks.push({ key: m[1], name: m[2], blurb: m[3], route: m[4], modules: [] });
  }
  const modRe = /m\("(\w+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*\[([^\]]*)\],\s*\[([^\]]*)\]\)/g;
  const kinds = (s) => [...s.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  while ((m = modRe.exec(src))) {
    const desk = desks.find((d) => d.key === m[1]);
    const mod = { key: m[2], label: m[3], route: m[4], accepts: kinds(m[5]), produces: kinds(m[6]) };
    if (desk) desk.modules.push(mod);
  }
  return desks;
}

/** src/guides/*.ts: page guides (route + pageName). */
function extractGuides() {
  const dir = path.join(FE_SRC, "guides");
  const guides = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts") || file === "index.ts" || file === "types.ts") continue;
    const src = read(path.join(dir, file));
    const routeM = src.match(/route:\s*"([^"]+)"/);
    const nameM = src.match(/pageName:\s*"([^"]+)"/);
    const summaryM = src.match(/summary:\s*\n?\s*"([^"]{25,400})"/);
    if (routeM && nameM) {
      guides.push({ route: routeM[1], pageName: nameM[1], summary: summaryM ? summaryM[1] : null, file: `guides/${file}` });
    }
  }
  return guides;
}

/** lib/credit-costs.ts CREDIT_COSTS: endpoint -> { cost, feature }. */
function extractCreditCosts() {
  const src = read(path.join(FE_SRC, "lib", "credit-costs.ts"));
  const entries = new Map();
  const re = /"(\/api\/[^"]+)":\s*\{\s*cost:\s*(\d+),\s*feature:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) entries.set(m[1], { cost: Number(m[2]), feature: m[3] });
  return entries;
}

/** routes/stripe-payments.ts PACK_MAP: credit packs. */
function extractPacks() {
  const src = read(path.join(API_SRC, "routes", "stripe-payments.ts"));
  const packs = [];
  const re = /"(\d+)":\s*\{\s*envKey:\s*"[^"]+",\s*credits:\s*(\d+),\s*label:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) {
    packs.push({ credits: Number(m[2]), label: m[3], source: "artifacts/api-server/src/routes/stripe-payments.ts PACK_MAP" });
  }
  return packs;
}

/** Server-side *_COST / *_CREDITS constants (cross-check source). */
function extractServerCostConstants() {
  const found = [];
  for (const file of walk(API_SRC, [".ts"])) {
    if (file.includes("__tests__") || file.endsWith(".test.ts")) continue;
    const src = read(file);
    const re = /(?:export\s+)?const\s+([A-Z][A-Z0-9_]*(?:_COST|_CREDITS))\s*(?::\s*number)?\s*=\s*(\d+)\b/g;
    let m;
    while ((m = re.exec(src))) found.push({ constant: m[1], value: Number(m[2]), file: rel(file) });
  }
  return found;
}

/** data/seo-pages.ts: per-slug SEO pages carry a designed name + prose
    metaDescription for their exact path (/tools/*, /for/*, /genres/*). */
function extractSeoPages() {
  const file = path.join(FE_SRC, "data", "seo-pages.ts");
  const byPath = new Map();
  if (!existsSync(file)) return byPath;
  const src = read(file);
  const pathRe = /path:\s*"(\/[^"]+)"/g;
  let m;
  while ((m = pathRe.exec(src))) {
    const window = src.slice(m.index, m.index + 700);
    const name = window.match(/name:\s*"([^"]+)"/)?.[1];
    const desc = window.match(/metaDescription:\s*\n?\s*"([^"]{25,400})"/)?.[1];
    if (name || desc) byPath.set(m[1], { name: name ?? null, description: desc ?? null });
  }
  return byPath;
}

const PROSE_KEYS = new Set(["description", "pageDescription", "subheading", "subtitle", "tagline", "intro", "summary"]);
/** A page's own t("ns.key") strings, resolved through en.json — the page's
    own words about itself. Returns the longest prose-grade value. */
function descriptionFromPageText(text, en) {
  const keyRe = /\bt\(\s*"([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+)"/g;
  let best = null;
  let m;
  while ((m = keyRe.exec(text))) {
    const parts = m[1].split(".");
    if (!PROSE_KEYS.has(parts[parts.length - 1])) continue;
    let v = en;
    for (const p of parts) v = v?.[p];
    if (typeof v === "string" && v.length >= 25 && v.length <= 300 && !v.includes("{{") && !v.includes("http")) {
      if (!best || v.length > best.value.length) best = { value: v.trim(), key: m[1] };
    }
  }
  return best;
}

/** Strip comments so doc examples (e.g. the confirmedFetch JSDoc citing
    "/api/generate-song") never attribute endpoints to a file's importers. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\*.*$/gm, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

/** "/api/..." literals in a source file, normalized (${x} -> :param). */
function apiLiterals(rawSrc) {
  const src = stripComments(rawSrc);
  const out = new Set();
  const re = /["'`](\/api\/[A-Za-z0-9_\-/?=&.:${}]+)["'`]/g;
  let m;
  while ((m = re.exec(src))) {
    let ep = m[1].replace(/\$\{[^}]+\}/g, ":param").split("?")[0].replace(/\/+$/, "");
    if (ep.length > 4) out.add(ep);
  }
  return out;
}

/** A page file's own source + its one-hop imports' sources.
    A file naming >40 distinct endpoints is a registry/directory, not a
    caller (lib/credit-costs.ts lists all 200) — its literals must not
    attribute prices to every page that imports it, so it is skipped. */
function pageSources(pageFileAbs) {
  const texts = [read(pageFileAbs)];
  const src = texts[0];
  const importRe = /from\s+"(@\/[^"]+|\.\.?\/[^"]+)"/g;
  let m;
  while ((m = importRe.exec(src))) {
    const spec = m[1];
    const base = spec.startsWith("@/")
      ? path.join(FE_SRC, spec.slice(2))
      : path.resolve(path.dirname(pageFileAbs), spec);
    for (const cand of [base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
      if (existsSync(cand)) {
        try {
          const text = read(cand);
          if (apiLiterals(text).size <= 40) texts.push(text);
        } catch { /* unreadable import — skip */ }
        break;
      }
    }
  }
  return texts;
}

function humanize(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}
function humanizeSlug(slug) {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
function camel(slug) {
  return slug.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Longest-prefix price lookup, mirroring getCreditCost() in credit-costs.ts. */
function priceFor(endpoint, creditCosts) {
  let best = null;
  let bestLen = -1;
  for (const [key, value] of creditCosts) {
    const keyPath = key.split("?")[0];
    if (endpoint === keyPath || endpoint.startsWith(keyPath + "/") || endpoint.startsWith(keyPath + ":")) {
      if (keyPath.length > bestLen) { best = { key, ...value }; bestLen = keyPath.length; }
    }
  }
  return best;
}

/* ═══ Assembly ════════════════════════════════════════════════════════════ */

const CREDIT_COSTS_SOURCE = "artifacts/bow-down-visuals/src/lib/credit-costs.ts CREDIT_COSTS";
/** Reviewed constant→endpoint links for the price cross-check tripwire.
    Values verified against the code when this generator was written. */
const SERVER_PRICE_LINKS = [
  { constant: "GEN45_CREDIT_COST", endpoint: "/api/generate-runway-clip" },
  { constant: "PUBLISH_COST", endpoint: "/api/bio-publish" },
  { constant: "ALBUM_PUBLISH_COST", endpoint: "/api/album-publish" },
];

function resolvePageFile(spec) {
  const base = path.join(REPO_ROOT, spec);
  for (const cand of [base + ".tsx", base + ".ts", path.join(base, "index.tsx"), path.join(base, "index.ts")]) {
    if (existsSync(cand)) return rel(cand);
  }
  return spec + ".tsx"; // unresolved — surfaces in the coverage report
}

function main() {
  const en = JSON.parse(read(path.join(FE_SRC, "locales", "en.json")));
  const { routes, pageImport } = extractApp();
  const matrix = extractRouteMatrix();
  const sidebar = extractSidebar(en);
  const desks = extractDesks();
  const guides = extractGuides();
  const creditCosts = extractCreditCosts();
  const seoPages = extractSeoPages();
  const packs = extractPacks();
  const serverConstants = extractServerCostConstants();

  const deskByRoute = new Map(); // full route (incl ?tab) -> { desk, module|null }
  for (const desk of desks) {
    deskByRoute.set(desk.route, { desk, module: null });
    for (const mod of desk.modules) deskByRoute.set(mod.route, { desk, module: mod });
  }
  const guideByRoute = new Map(guides.map((g) => [g.route, g]));

  const features = [];
  const excluded = [];
  const routedPageFiles = new Set();
  const redirectMap = new Map(); // legacy route path -> redirect target
  const warnings = [];

  const descriptionFor = (routePath) => {
    const slug = routePath.replace(/^\//, "");
    const candidates = [camel(slug.replace(/\//g, "-")), camel(slug.split("/").pop() ?? ""), slug.split("/").pop() ?? ""];
    for (const ns of candidates) {
      const obj = en[ns];
      if (!obj || typeof obj !== "object") continue;
      for (const field of ["pageDescription", "description", "subheading", "tagline"]) {
        const v = obj[field];
        if (typeof v === "string" && v.length >= 25 && v.length <= 300 && !v.includes("{{") && !v.includes("http")) {
          return { description: v.trim(), descriptionSource: `artifacts/bow-down-visuals/src/locales/en.json "${ns}.${field}"` };
        }
      }
    }
    return {};
  };

  const pricesFor = (endpoints) => {
    const byKey = new Map();
    for (const ep of endpoints) {
      const hit = priceFor(ep, creditCosts);
      if (hit && !byKey.has(hit.key)) {
        byKey.set(hit.key, { feature: hit.feature, vb: hit.cost, endpoint: hit.key, source: CREDIT_COSTS_SOURCE });
      }
    }
    return [...byKey.values()].sort((a, b) => a.endpoint.localeCompare(b.endpoint));
  };

  const nextStepsFor = (entry, deskHit) => {
    const steps = [];
    // The journey step always survives the trim — it is the product's spine.
    const stageIdx = JOURNEY.indexOf(entry.stage);
    if (stageIdx >= 0 && stageIdx < JOURNEY.length - 1) {
      const next = STAGE_ENTRY[JOURNEY[stageIdx + 1]];
      steps.push({ label: next.label, path: next.path, source: "CREATE → BRAND → PROMOTE → MONEY journey" });
    }
    if (deskHit?.module) {
      const produces = new Set(deskHit.module.produces);
      for (const desk of desks) {
        for (const mod of desk.modules) {
          if (mod.route === deskHit.module.route) continue;
          if (mod.accepts.some((k) => produces.has(k)) && !steps.some((s) => s.path === mod.route)) {
            steps.push({ label: mod.label, path: mod.route, source: "lib/desks.ts handoff (produces/accepts)" });
          }
        }
      }
    }
    return steps.slice(0, 4);
  };

  for (const route of routes) {
    const matrixEntry = matrix.get(route.path);
    const disposition = matrixEntry?.disposition ?? (route.redirectTo ? "redirect" : null);
    if (route.path === "*") {
      excluded.push({ kind: "route", key: "*", reason: EXCLUDED_ROUTES["*"] });
      continue;
    }
    if (disposition === "redirect" || route.redirectTo) {
      const target = route.redirectTo ?? matrixEntry?.redirectTo ?? "?";
      redirectMap.set(route.path, target);
      excluded.push({
        kind: "route",
        key: route.path,
        reason: `Redirect to ${target} — the target carries the knowledge entry.`,
      });
      continue;
    }
    if (!matrixEntry) warnings.push(`route ${route.path} missing from ROUTE_MATRIX — access defaulted to members`);

    const pageFile = route.component ? resolvePageFile(pageImport.get(route.component)) : null;
    if (pageFile) routedPageFiles.add(pageFile);

    const basePath = route.path.split("?")[0];
    const side = sidebar.get(basePath);
    const deskHit = deskByRoute.get(route.path) ?? deskByRoute.get(basePath);
    const guide = guideByRoute.get(basePath);

    const seo = seoPages.get(basePath);
    let name, nameSource;
    if (side?.name) { name = side.name; nameSource = "app-sidebar.tsx nav label (en.json)"; }
    else if (seo?.name) { name = seo.name; nameSource = "data/seo-pages.ts name"; }
    else if (deskHit?.module) { name = deskHit.module.label; nameSource = "lib/desks.ts module label"; }
    else if (deskHit) { name = deskHit.desk.name; nameSource = "lib/desks.ts desk name"; }
    else if (guide) { name = guide.pageName; nameSource = "src/guides pageName"; }
    else if (route.component) { name = humanize(route.component); nameSource = "App.tsx component name"; }
    else { name = humanizeSlug(basePath.split("/").pop() ?? basePath); nameSource = "route slug"; }

    const firstSeg = basePath.replace(/^\//, "").split("/")[0] ?? "";
    const stage = side ? SECTION_STAGE[side.section] ?? "studio" : SEGMENT_STAGE[firstSeg] ?? "studio";

    let endpoints = [];
    let pageText = "";
    if (pageFile) {
      const abs = path.join(REPO_ROOT, pageFile);
      if (existsSync(abs)) {
        const texts = pageSources(abs);
        pageText = texts[0] ?? "";
        const eps = new Set();
        for (const text of texts) for (const ep of apiLiterals(text)) eps.add(ep);
        endpoints = [...eps].sort();
      }
    }

    const entry = {
      id: (basePath === "/" ? "home" : basePath.replace(/^\//, "").replace(/[/:]/g, "-")) + (route.path.includes("?") ? "-" + route.path.split("?")[1].replace(/[^a-z0-9]+/gi, "-") : ""),
      name,
      nameSource,
      path: route.path,
      stage,
      access: disposition === "public" ? "public" : "members",
      pageFile,
      component: route.component,
      endpoints,
      prices: pricesFor(endpoints),
      ...(guide ? { guide: { pageName: guide.pageName, route: guide.route } } : {}),
      ...(deskHit?.module?.accepts?.length ? { inputs: deskHit.module.accepts } : {}),
    };
    if (seo?.description) {
      entry.description = seo.description;
      entry.descriptionSource = "data/seo-pages.ts metaDescription";
    }
    if (!entry.description && pageText) {
      const prose = descriptionFromPageText(pageText, en);
      if (prose) {
        entry.description = prose.value;
        entry.descriptionSource = `artifacts/bow-down-visuals/src/locales/en.json "${prose.key}" (page's own string)`;
      }
    }
    if (!entry.description && deskHit) {
      entry.description = deskHit.desk.blurb;
      entry.descriptionSource = "lib/desks.ts desk blurb";
    }
    if (!entry.description) Object.assign(entry, descriptionFor(basePath));
    entry.nextSteps = nextStepsFor(entry, deskHit);
    features.push(entry);
  }

  /* Desk modules docked inside a host page (e.g. /video-editor?tab=promo-clips)
     are real named features with their own deep-link paths — add any the
     route table doesn't carry on its own. */
  const featurePaths = new Set(features.map((f) => f.path));
  for (const desk of desks) {
    for (const mod of desk.modules) {
      if (featurePaths.has(mod.route)) continue;
      const hostPath = mod.route.split("?")[0];
      const host = features.find((f) => f.path === hostPath);
      const entry = {
        id: "desk-" + mod.key,
        name: mod.label,
        nameSource: "lib/desks.ts module label",
        path: mod.route,
        stage: "create",
        access: host?.access ?? "members",
        pageFile: host?.pageFile ?? null,
        component: host?.component ?? null,
        endpoints: host?.endpoints ?? [],
        prices: host?.prices ?? [],
        description: desk.blurb,
        descriptionSource: "lib/desks.ts desk blurb",
        ...(mod.accepts.length ? { inputs: mod.accepts } : {}),
        nextSteps: [],
      };
      entry.nextSteps = nextStepsFor(entry, { desk, module: mod });
      features.push(entry);
      featurePaths.add(mod.route);
    }
  }

  /* Deep-link features: a legacy route that redirects into a tab/panel of a
     host page names a real docked feature (Caption Styler lives at
     /hooks?tab=styler). Derive an entry for each redirect target the desk
     registry doesn't already carry. */
  for (const [legacyPath, target] of redirectMap) {
    if (!target.includes("?tab=") && !target.includes("?panel=")) continue;
    if (featurePaths.has(target)) continue;
    const host = features.find((f) => f.path === target.split("?")[0]);
    if (!host) continue;
    const entry = {
      id: "tab-" + legacyPath.replace(/^\//, "").replace(/[/:]/g, "-"),
      name: humanizeSlug(legacyPath.split("/").pop() ?? legacyPath),
      nameSource: "legacy route slug (App.tsx redirect)",
      path: target,
      stage: host.stage,
      access: host.access,
      pageFile: host.pageFile,
      component: host.component,
      endpoints: host.endpoints,
      prices: host.prices,
      nextSteps: host.nextSteps,
    };
    features.push(entry);
    featurePaths.add(target);
  }

  /* Page-file coverage: every file under src/pages is either routed or
     explicitly excluded with a reviewed reason. */
  const allPageFiles = walk(path.join(FE_SRC, "pages"), [".tsx"]).map((p) => rel(p)).sort();
  for (const file of allPageFiles) {
    if (routedPageFiles.has(file)) continue;
    let reason = EXCLUDED_PAGE_FILES[file];
    if (!reason) {
      const slugPath = "/" + file.replace(/^.*\/pages\//, "").replace(/\.tsx$/, "");
      const target = redirectMap.get(slugPath);
      if (target) {
        reason = `Legacy standalone page — route ${slugPath} now redirects to ${target}; the live feature is covered by the target's knowledge entry.`;
      }
    }
    excluded.push({ kind: "pageFile", key: file, reason: reason ?? "UNREVIEWED — not routed from App.tsx; review and record the reason in the generator." });
  }

  /* Guide pass (after every route is known): attach each page guide to the
     feature it teaches. Guide routes are often legacy paths that redirect
     into a host panel — resolve through the redirect map. A guide's summary
     is the most specific human-written description of that exact flow, so
     it outranks desk blurbs and locale prose. */
  for (const entry of features) {
    const guide =
      guideByRoute.get(entry.path) ??
      guides.find((g) => redirectMap.get(g.route) === entry.path) ??
      null;
    if (guide) {
      entry.guide = { pageName: guide.pageName, route: guide.route };
      if (guide.summary) {
        entry.description = guide.summary;
        entry.descriptionSource = `artifacts/bow-down-visuals/src/${guide.file} guide summary`;
      }
    }
  }

  /* Price cross-check tripwire: registry vs server constants. */
  const crossChecks = SERVER_PRICE_LINKS.map((link) => {
    const constant = serverConstants.find((c) => c.constant === link.constant);
    const registry = creditCosts.get(link.endpoint);
    return {
      ...link,
      serverValue: constant?.value ?? null,
      serverSource: constant?.file ?? null,
      registryValue: registry?.cost ?? null,
      agree: constant && registry ? constant.value === registry.cost : null,
    };
  });
  for (const c of crossChecks) {
    if (c.agree === false) warnings.push(`PRICE DISAGREEMENT ${c.constant}=${c.serverValue} (${c.serverSource}) vs CREDIT_COSTS ${c.endpoint}=${c.registryValue}`);
  }

  let baseCommit = "unknown";
  try { baseCommit = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* not a git tree */ }

  const indexHtml = read(path.join(REPO_ROOT, "artifacts", "bow-down-visuals", "index.html"));
  const site = {
    name: "Bow Down Visuals",
    title: indexHtml.match(/property="og:title" content="([^"]+)"/)?.[1] ?? null,
    description: indexHtml.match(/name="description" content="([^"]+)"/)?.[1] ?? null,
    source: "artifacts/bow-down-visuals/index.html (og:title / meta description)",
  };

  const kb = {
    generatedBy: "artifacts/api-server/scripts/generate-operator-knowledge.mjs",
    baseCommit,
    site,
    generatedAt: new Date().toISOString().slice(0, 10),
    counts: {
      routesInApp: routes.length,
      pageFiles: allPageFiles.length,
      features: features.length,
      excludedRoutes: excluded.filter((e) => e.kind === "route").length,
      excludedPageFiles: excluded.filter((e) => e.kind === "pageFile").length,
      pricedActions: creditCosts.size,
      guides: guides.length,
      desks: desks.length,
    },
    packs,
    crossChecks,
    features: features.sort((a, b) => a.path.localeCompare(b.path)),
    excluded,
  };
  writeFileSync(OUT_FILE, JSON.stringify(kb, null, 2) + "\n");

  console.log(`operator knowledge → ${rel(OUT_FILE)}`);
  console.log(`routes in App.tsx: ${routes.length} · page files: ${allPageFiles.length}`);
  console.log(`features: ${features.length} · excluded routes: ${kb.counts.excludedRoutes} · excluded page files: ${kb.counts.excludedPageFiles}`);
  console.log(`priced actions in CREDIT_COSTS: ${creditCosts.size} · packs: ${packs.length} · guides: ${guides.length}`);
  const stages = {};
  for (const f of features) stages[f.stage] = (stages[f.stage] ?? 0) + 1;
  console.log("stages:", stages);
  const unreviewed = excluded.filter((e) => e.reason.includes("UNREVIEWED"));
  if (unreviewed.length) {
    console.log(`\nUNREVIEWED page-file exclusions (${unreviewed.length}):`);
    for (const e of unreviewed) console.log("  " + e.key);
  }
  const noDesc = features.filter((f) => !f.description);
  console.log(`features without a sourced description: ${noDesc.length}`);
  const noPrice = features.filter((f) => f.prices.length === 0);
  console.log(`features without attached prices: ${noPrice.length} (of ${features.length})`);
  if (warnings.length) { console.log("\nWARNINGS:"); for (const w of warnings) console.log("  " + w); }
}

main();
