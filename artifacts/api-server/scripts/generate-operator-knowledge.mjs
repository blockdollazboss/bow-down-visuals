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
                                 with the namespace recorded as provenance);
                                 a deepening pass then covers features still
                                 description-less from other designated prose
                                 only — expanded en.json namespace fields,
                                 the page's own usePageTitle meta text,
                                 data/features.ts SITE_FEATURES taglines, and
                                 page-file DESCRIPTION constants. Page JSX
                                 strings are never quoted (see
                                 deepenDescription).
     prices .................... src/lib/credit-costs.ts CREDIT_COSTS — the
                                 frontend registry that records server charges
                                 (cross-checked against server-side *_COST
                                 constants; disagreements print as warnings).
                                 Two reviewed link tables cover what the
                                 page scan cannot reach: FEATURE_PRICE_LINKS
                                 (registry rails behind multi-hop callers)
                                 and TIERED_PRICE_LINKS (duration-tiered
                                 rails, below). Docked surfaces — tabs,
                                 panels, and modes with no route of their
                                 own — are declared in DOCKED_FEATURES with
                                 their facts extracted the same way.
     credit packs ................ src/routes/stripe-payments.ts PACK_MAP
     takeover offers ............. lib/db/src/schema/spotlight.ts
                                 SPOTLIGHT_OFFER + loading-screen.ts
                                 LOADING_SCREEN_OFFER — the exact objects
                                 GET /api/spotlight/offer and
                                 GET /api/loading-screen/offer serve
                                 (dollar-priced advertising placements;
                                 the only dollar prices in the base)
     duration-tiered prices .... src/routes/generate/music-audio.ts
                                 SONG_PRICE_TIERS — the table the charging
                                 function creditCostForLength derives from.
                                 The CREDIT_COSTS registry records only the
                                 first tier's flat figure for the endpoint,
                                 so the tiers ride the price entry as
                                 `tiers` (see TIERED_PRICE_LINKS).

   The only hand-kept data in THIS file is classification, mirroring how
   public-routes.ts keeps ROUTE_MATRIX: STAGE_RULES (which journey stage a
   route belongs to, for routes the sidebar doesn't list), EXCLUSIONS
   (every route / page file deliberately left out of the knowledge base,
   with the reason), the price link tables, and DOCKED_FEATURES (tab /
   panel / mode surfaces with no route of their own — identity, door,
   host, and fact sources; the prose-less members carry a reviewed
   literal description, marked as such in the entry's descriptionSource).
   The coverage test (src/lib/__tests__/
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
  "artifacts/bow-down-visuals/src/pages/songs/dj-set-prep.tsx":
    "Tab panel component (the DJ Sets tab) imported by the songs library page (pages/songs.tsx); not a route of its own.",
  // Every other unrouted page file is expected to be a legacy standalone
  // page whose same-name route now redirects into a tabbed host — the
  // generator derives that reason from the redirect itself (see assembly).
  // A file that matches neither this map nor a redirecting same-name route
  // is reported UNREVIEWED and fails the coverage test until classified.
};

/** The two paid takeover offers. They are NOT routed pages — they are
    advertising placements sold by inquiry — so no route-table row exists
    for the generator to discover. This table is CLASSIFICATION only
    (which constant backs which offer, where its inquiry door lives);
    every fact the knowledge entry states — name, dollar price, duration,
    surfaces, specs — is EXTRACTED from the *_OFFER constant in lib/db,
    the exact object the offer endpoint serves. The door is verified
    against the Charts page at generation time (the For Brands tab must
    still mount the offer's inquiry modal under its testid) and the route
    file must still serve the constant at the offer endpoint — if either
    stops being true the generator throws rather than emitting stale
    knowledge, and the coverage test pins the entries independently. */
const TAKEOVER_OFFERS = [
  {
    id: "spotlight-takeover",
    constant: "SPOTLIGHT_OFFER",
    schemaFile: "lib/db/src/schema/spotlight.ts",
    routeFile: "spotlight.ts",
    offerRoute: "/spotlight/offer",
    inquireRoute: "/spotlight/inquire",
    modal: "SpotlightModal",
    chartsTestid: "brand-takeover-spotlight",
    doorPath: "/charts",
    doorLabel: "Charts — For Brands tab",
    stage: "promote",
  },
  {
    id: "loading-screen-takeover",
    constant: "LOADING_SCREEN_OFFER",
    schemaFile: "lib/db/src/schema/loading-screen.ts",
    routeFile: "loading-screen.ts",
    offerRoute: "/loading-screen/offer",
    inquireRoute: "/loading-screen/inquire",
    modal: "LoadingScreenModal",
    chartsTestid: "brand-takeover-loading",
    doorPath: "/charts",
    doorLabel: "Charts — For Brands tab",
    stage: "promote",
  },
];
const TAKEOVER_CHARTS_FILE = "artifacts/bow-down-visuals/src/pages/discovery/charts.tsx";

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

/** One *_OFFER constant object literal in a lib/db schema file: the exact
    object the matching GET /api/.../offer endpoint serves. Parses the
    literal's own fields — a field that stops parsing fails the whole
    generation loudly; the knowledge base never guesses an offer. */
function extractOfferConstant(src, constantName, fileLabel) {
  const start = src.indexOf(`export const ${constantName}`);
  if (start < 0) throw new Error(`takeover offers: ${constantName} not found in ${fileLabel}`);
  const open = src.indexOf("{", start);
  const close = src.indexOf("} as const;", start);
  if (open < 0 || close < 0 || close < open) {
    throw new Error(`takeover offers: ${constantName} in ${fileLabel} is not a plain object literal ending "} as const;"`);
  }
  const body = src.slice(open, close);
  const strField = (key) => body.match(new RegExp(`${key}:\\s*"([^"]+)"`))?.[1] ?? null;
  const numField = (key) => {
    const v = body.match(new RegExp(`${key}:\\s*(\\d+)`))?.[1];
    return v ? Number(v) : null;
  };
  const arrField = (key) => {
    const m = body.match(new RegExp(`${key}:\\s*\\[([\\s\\S]*?)\\]`));
    return m ? [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]) : null;
  };
  const offer = {
    name: strField("name"),
    priceDollars: numField("priceDollars"),
    durationDays: numField("durationDays"),
    surfaces: arrField("surfaces"),
    specs: arrField("specs"),
  };
  if (!offer.name || offer.priceDollars == null || offer.durationDays == null || !offer.surfaces?.length || !offer.specs?.length) {
    throw new Error(`takeover offers: ${constantName} in ${fileLabel} did not parse completely (${JSON.stringify(offer)})`);
  }
  return offer;
}

/** The two takeover offers, end to end: constant facts from lib/db, the
    serving route verified to carry that constant at the offer + inquiry
    endpoints, and the booking door verified against the Charts page
    (For Brands tab still mounting the inquiry modal). Any drift throws —
    a stale takeover entry is worse than a failed generation. */
function extractTakeoverOffers() {
  const chartsSrc = read(path.join(REPO_ROOT, TAKEOVER_CHARTS_FILE));
  return TAKEOVER_OFFERS.map((spec) => {
    const offer = extractOfferConstant(read(path.join(REPO_ROOT, spec.schemaFile)), spec.constant, spec.schemaFile);
    const routeSrc = read(path.join(API_SRC, "routes", spec.routeFile));
    for (const needle of [spec.constant, `"${spec.offerRoute}"`, `"${spec.inquireRoute}"`]) {
      if (!routeSrc.includes(needle)) {
        throw new Error(`takeover offers: routes/${spec.routeFile} no longer serves ${spec.constant} at ${spec.offerRoute} (missing ${needle})`);
      }
    }
    for (const needle of [`components/${spec.modal}`, `data-testid="${spec.chartsTestid}"`]) {
      if (!chartsSrc.includes(needle)) {
        throw new Error(`takeover offers: the ${spec.doorLabel} door no longer mounts ${spec.modal} (missing ${needle} in ${TAKEOVER_CHARTS_FILE})`);
      }
    }
    return { spec, offer };
  });
}

/** A duration-tier price table exported from a server route file —
    the exact table the charging function derives from. Parses the
    literal's own rows ({ maxLengthMs, cost }); anything unparseable,
    incomplete, or non-ascending fails the whole generation loudly —
    the knowledge base never guesses a tier. Returns the tiers as
    [{ upToSeconds, vb }] ascending by length. */
function extractPriceTiers(src, constantName, fileLabel) {
  const start = src.indexOf(`export const ${constantName}`);
  if (start < 0) throw new Error(`tiered prices: ${constantName} not found in ${fileLabel}`);
  const open = src.indexOf("[", start);
  const close = src.indexOf("] as const;", start);
  if (open < 0 || close < 0 || close < open) {
    throw new Error(`tiered prices: ${constantName} in ${fileLabel} is not a plain array literal ending "] as const;"`);
  }
  const body = src.slice(open, close);
  const tiers = [...body.matchAll(/\{\s*maxLengthMs:\s*([\d_]+),\s*cost:\s*([\d_]+)\s*\}/g)].map((m) => ({
    upToSeconds: Number(m[1].replace(/_/g, "")) / 1000,
    vb: Number(m[2].replace(/_/g, "")),
  }));
  if (tiers.length < 2) {
    throw new Error(`tiered prices: ${constantName} in ${fileLabel} parsed only ${tiers.length} tier(s) — expected the full duration table`);
  }
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].upToSeconds <= tiers[i - 1].upToSeconds || tiers[i].vb <= tiers[i - 1].vb) {
      throw new Error(`tiered prices: ${constantName} in ${fileLabel} is not ascending in length and price`);
    }
  }
  return tiers;
}

/** Server-side *_COST / *_CREDITS constants (cross-check source). Two
    declaration forms are read: the plain literal (`= 400`) and the
    env-overridable default (`= Number(process.env["X"]) || 400`) —
    the value extracted is the DEFAULT the code charges with no env
    override, which is what the registry records. A constant declared
    any other way parses to nothing, its cross-check reads "no value",
    and the coverage test fails loudly rather than letting the link
    pass silently. */
function extractServerCostConstants() {
  const found = [];
  for (const file of walk(API_SRC, [".ts"])) {
    if (file.includes("__tests__") || file.endsWith(".test.ts")) continue;
    const src = read(file);
    const re = /(?:export\s+)?const\s+([A-Z][A-Z0-9_]*(?:_COST|_CREDITS))\s*(?::\s*number)?\s*=\s*(?:Number\(process\.env\[["'][A-Z0-9_]+["']\]\)\s*\|\|\s*)?(\d+)\b/g;
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

/* ─── Description deepening ──────────────────────────────────────────────
   Features the primary chain leaves description-less get one more pass
   over DESIGNATED prose only — text a page or registry explicitly wrote
   to describe the feature. Page JSX (error / loading / label strings) is
   never quoted: it is interface chrome, not a description, and quoting it
   as fact is how invented copy gets in. A feature with no designated
   source stays description-less, is reported by id in the run log, and
   is pinned by the coverage test's allowlist — never filled with
   plausible prose.

   Sources, in order:
     1. en.json namespaces over an expanded designated-field list. For
        tab-* entries the legacy slug's namespace goes first (a docked
        tab's own words), then the host path's namespace. Multi-segment
        paths get NO last-segment candidate: /store/dashboard must never
        inherit en.dashboard's command-center text.
        DESCRIPTION_NS_BLOCKLIST records reviewed misattributions
        (tab-guides is the Academy's legal-guides tab; en.guides is the
        standalone legal pages' namespace, so the tab falls through to
        its host's en.academy prose).
     2. The page's own usePageTitle(title, description) second argument —
        the hook writes it to the document meta description, so it IS the
        page's designated meta text. Only an argument yielding exactly
        one candidate (a plain literal, a no-interpolation template, or
        a single t() key resolved through en.json) is used; per-instance
        template text is stripped before counting, and an ambiguous
        argument refuses the page rather than guessing.
     3. data/features.ts SITE_FEATURES tagline for the exact route.
     4. A page-file const DESCRIPTION / META_DESCRIPTION literal.

   Every value must pass deepeningTextOk: 25–300 chars once normalized,
   no template braces, no URLs, and no money figure (digit or spelled
   out) — prices live only in the code-extracted prices array, and a
   prose figure can drift from it (en.randomizer's hero still quotes a
   pre-x100 "single Visual Buc" price; the filter refuses it and the
   tab falls through to its host desk's prose). */
const DEEPENING_PROSE_FIELDS = ["pageDescription", "description", "metaDescription", "pageSubtitle", "subheading", "subtitle", "tagline", "intro", "summary", "heroSubtitle", "heroSub", "heroDescription", "hero"];
const DESCRIPTION_NS_BLOCKLIST = { "tab-guides": ["guides"] };
const DESCRIPTION_MONEY_RE = /\d[\d,]*\s*(?:%|VB\b|Visual Bucs)|\$\s*\d|\d[\d,]*\s*credits?\b|\b(?:a\s+single|single|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+Visual Bucs?\b/i;

/** The one validation gate every deepened description passes. Returns
    the whitespace-normalized value, or null when it is not safe prose. */
function deepeningTextOk(v) {
  if (typeof v !== "string") return null;
  const n = v.replace(/\s+/g, " ").trim();
  if (n.length < 25 || n.length > 300) return null;
  if (n.includes("{") || n.includes("}") || n.includes("http")) return null;
  if (DESCRIPTION_MONEY_RE.test(n)) return null;
  return n;
}

/** Split a call's argument list at its top-level commas. startIdx sits
    just after the opening paren. A mode stack (code / ' / " / template
    with ${} nesting) keeps commas and parens inside strings and
    per-instance templates from corrupting the split. */
function splitCallArgs(text, startIdx) {
  const args = [];
  let cur = "";
  let depth = 1; // paren depth; the call's own paren is 1
  const stack = ["code"];
  let braceDepth = 0; // {} depth inside the current template expression
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i], prev = text[i - 1];
    const mode = stack[stack.length - 1];
    if (mode === "'" || mode === '"') {
      cur += ch;
      if (ch === mode && prev !== "\\") stack.pop();
      continue;
    }
    if (mode === "`") {
      cur += ch;
      if (ch === "`" && prev !== "\\") { stack.pop(); continue; }
      if (ch === "$" && text[i + 1] === "{") { cur += "{"; i++; stack.push("code"); braceDepth = 0; continue; }
      continue;
    }
    /* code mode */
    if (ch === "'" || ch === '"' || ch === "`") { stack.push(ch); cur += ch; continue; }
    if (ch === "{") {
      if (stack.length > 1) braceDepth++;
      cur += ch; continue;
    }
    if (ch === "}") {
      if (stack.length > 1) {
        if (braceDepth === 0) { stack.pop(); cur += ch; continue; } // closes ${ — back to template
        braceDepth--;
      }
      cur += ch; continue;
    }
    if (stack.length === 1) {
      if (ch === "(" || ch === "[") { depth++; cur += ch; continue; }
      if (ch === ")" || ch === "]") {
        depth--;
        if (depth === 0) { args.push(cur); return args; }
        cur += ch; continue;
      }
      if (ch === "," && depth === 1) { args.push(cur); cur = ""; continue; }
    }
    cur += ch;
  }
  return args;
}

/** Remove template-literal spans from an argument's text. A template
    containing ${} is per-instance text — dropped entirely. A template
    without interpolation is a plain literal — kept as a candidate. */
function stripTemplateSpans(arg) {
  let out = "";
  const literals = [];
  let i = 0;
  while (i < arg.length) {
    if (arg[i] !== "`") { out += arg[i]; i++; continue; }
    let j = i + 1, depth = 0, content = "", interpolated = false, closed = false;
    const stack = ["`"];
    for (; j < arg.length; j++) {
      const ch = arg[j], prev = arg[j - 1];
      const mode = stack[stack.length - 1];
      if (mode === "'" || mode === '"') { content += ch; if (ch === mode && prev !== "\\") stack.pop(); continue; }
      if (mode === "`") {
        if (ch === "`" && prev !== "\\") {
          stack.pop();
          if (stack.length === 0) { closed = true; j++; break; }
          content += ch; continue;
        }
        if (ch === "$" && arg[j + 1] === "{") { interpolated = true; content += "${"; j++; stack.push("code"); depth = 0; continue; }
        content += ch; continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") { stack.push(ch); content += ch; continue; }
      if (ch === "{") depth++;
      if (ch === "}") { if (depth === 0) { stack.pop(); content += ch; continue; } depth--; }
      content += ch;
    }
    if (closed && !interpolated) literals.push(content);
    out += " ";
    i = j;
  }
  return { text: out, literals };
}

/** A page's designated meta description: the second argument of its
    usePageTitle(title, description) call, when that argument designates
    exactly one text (see the deepening note above). */
function descriptionFromPageTitle(text, en) {
  let idx = 0;
  while ((idx = text.indexOf("usePageTitle(", idx)) >= 0) {
    const args = splitCallArgs(text, idx + "usePageTitle(".length);
    idx += "usePageTitle(".length;
    if (args.length < 2) continue;
    const { text: strippedArg, literals: tplLiterals } = stripTemplateSpans(args[1]);
    const candidates = [];
    const tRe = /\bt\(\s*"([^"]+)"/g;
    let m;
    while ((m = tRe.exec(strippedArg))) {
      let v = en;
      for (const p of m[1].split(".")) v = v?.[p];
      if (typeof v === "string") candidates.push(v);
    }
    const noT = strippedArg.replace(/\bt\(\s*"[^"]+"\s*\)/g, " ");
    const litRe = /"([^"\n]{1,400})"|'([^'\n]{1,400})'/g;
    while ((m = litRe.exec(noT))) candidates.push(m[1] ?? m[2]);
    for (const v of tplLiterals) candidates.push(v);
    if (candidates.length === 1) {
      const v = deepeningTextOk(candidates[0]);
      if (v) return v;
    }
    if (candidates.length > 1) return null; // ambiguous — refuse the page
  }
  return null;
}

/** data/features.ts SITE_FEATURES: the site's own feature registry
    carries a designed tagline per exact route. */
function extractSiteFeatureTaglines() {
  const file = path.join(FE_SRC, "data", "features.ts");
  const byRoute = new Map();
  if (!existsSync(file)) return byRoute;
  const src = read(file);
  for (const m of src.matchAll(/\{\s*key:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*tagline:\s*"([^"]+)",\s*route:\s*"([^"]+)"/g)) {
    byRoute.set(m[4], m[3]);
  }
  return byRoute;
}

/** A page file's own const DESCRIPTION / META_DESCRIPTION literal — the
    SEO index pages (src/pages/seo/*) designate their meta text this way. */
function descriptionFromMetaConst(text) {
  const m = text.match(/(?:^|\n)\s*const\s+(?:DESCRIPTION|META_DESCRIPTION)\s*=\s*\n?\s*"([^"]{25,300})"/);
  return m ? deepeningTextOk(m[1]) : null;
}

/** One description-less feature → its deepened description, or null when
    no designated source survives the gate. */
function deepenDescription(entry, en, siteFeatureTaglines) {
  /* 1 — en.json namespaces, expanded designated fields. */
  const candidates = [];
  if (entry.id.startsWith("tab-")) {
    const legacy = entry.id.slice("tab-".length);
    const blocked = new Set(DESCRIPTION_NS_BLOCKLIST[entry.id] ?? []);
    for (const c of [camel(legacy), legacy, camel(legacy.split("-")[0])]) {
      if (!blocked.has(c) && !candidates.includes(c)) candidates.push(c);
    }
  }
  const slug = entry.path.replace(/^\//, "").split("?")[0];
  candidates.push(camel(slug.replace(/\//g, "-")));
  if (!slug.includes("/")) candidates.push(slug);
  for (const ns of [...new Set(candidates)]) {
    const obj = en[ns];
    if (!obj || typeof obj !== "object") continue;
    for (const field of DEEPENING_PROSE_FIELDS) {
      const v = deepeningTextOk(obj[field]);
      if (v) {
        return { description: v, descriptionSource: `artifacts/bow-down-visuals/src/locales/en.json "${ns}.${field}"`, kind: "namespace" };
      }
    }
  }
  /* 2–4 read the page's own file. */
  let pageText = "";
  if (entry.pageFile) {
    const abs = path.join(REPO_ROOT, entry.pageFile);
    if (existsSync(abs)) pageText = read(abs);
  }
  if (pageText) {
    const fromTitle = descriptionFromPageTitle(pageText, en);
    if (fromTitle) {
      return { description: fromTitle, descriptionSource: `${entry.pageFile} usePageTitle meta description`, kind: "pageTitle" };
    }
  }
  const tagline = deepeningTextOk(siteFeatureTaglines.get(entry.path));
  if (tagline) {
    return { description: tagline, descriptionSource: "artifacts/bow-down-visuals/src/data/features.ts SITE_FEATURES tagline", kind: "siteFeatures" };
  }
  if (pageText) {
    const fromConst = descriptionFromMetaConst(pageText);
    if (fromConst) {
      return { description: fromConst, descriptionSource: `${entry.pageFile} DESCRIPTION constant`, kind: "metaConst" };
    }
  }
  return null;
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

/** Route-parameter segments compare equal whatever their name: the
    registry writes "/api/artist-vaults/:id/voice/clone" while page
    sources normalize templates to ":param" — without this, a priced
    endpoint whose parameter is named differently in the two sources
    silently never attaches (the vault's voice-clone price did not
    reach any entry until this normalization landed). */
function normParams(p) {
  return p.split("/").map((s) => (s.startsWith(":") ? ":param" : s)).join("/");
}

/** Longest-prefix price lookup, mirroring getCreditCost() in credit-costs.ts. */
function priceFor(endpoint, creditCosts) {
  let best = null;
  let bestLen = -1;
  const ep = normParams(endpoint);
  for (const [key, value] of creditCosts) {
    const keyPath = normParams(key.split("?")[0]);
    if (ep === keyPath || ep.startsWith(keyPath + "/") || ep.startsWith(keyPath + ":")) {
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
  { constant: "WEBSITE_BUILD_CREDITS", endpoint: "/api/website-builder/generate" },
  { constant: "WEBSITE_EDIT_CREDITS", endpoint: "/api/website-builder/edit" },
  { constant: "PLAYLIST_PITCH_CREDIT_COST", endpoint: "/api/playlist-pitch/kit" },
  { constant: "EXPORT_CREDIT_COST", endpoint: "/api/export-final-video" },
  { constant: "QUALITY_EXPORT_COST", endpoint: "/api/export-quality" },
];

/** Duration-tiered price rails. CLASSIFICATION only — which endpoint is
    priced by which exported table, and which feature entries front that
    rail without their page sources naming the endpoint. Every number is
    EXTRACTED: the tier rows come from the table the charging function
    derives from, the base figure from CREDIT_COSTS, and generation
    verifies the two agree at the first tier (and that the route file
    still serves the endpoint) — drift throws rather than emitting a
    flat price for a tiered rail.
    attachToFeatureIds: "Make a Song" fronts this rail through HumToSong
    (which calls the rail's /extend path) — two component hops from the
    Create page, past the generator's one-hop endpoint scan — so the
    desk entry is linked here and verified to exist at generation time. */
const TIERED_PRICE_LINKS = [
  {
    endpoint: "/api/generate-music-audio",
    tableConstant: "SONG_PRICE_TIERS",
    routeFile: "routes/generate/music-audio.ts",
    attachToFeatureIds: ["desk-song"],
  },
];

/** Registry-priced rails whose charging endpoint no page source names
    within the generator's one-hop scan. CLASSIFICATION only — which
    registry endpoint belongs to which feature entries; every number
    is extracted from CREDIT_COSTS, and the server constants behind
    these rails are cross-checked separately (SERVER_PRICE_LINKS).
    The final-video export rail is the case in point: the editor
    reaches components/FinalVideoExport.tsx through a section
    component (two hops), so the 400 VB standard export, the 150 VB
    quality-controlled export (the rail the Pro Finishing formats —
    ProRes / DNxHR / FCPXML — ride), and the free size estimate
    attached to NO feature until this link landed. */
const FEATURE_PRICE_LINKS = [
  {
    endpoint: "/api/export-final-video",
    attachToFeatureIds: ["video-editor", "desk-lyric-video", "desk-promo-clips", "desk-repurpose", "desk-translate", "desk-upscale"],
  },
  {
    endpoint: "/api/export-quality",
    attachToFeatureIds: ["video-editor", "desk-lyric-video", "desk-promo-clips", "desk-repurpose", "desk-translate", "desk-upscale"],
  },
  {
    endpoint: "/api/export-quality/estimate",
    attachToFeatureIds: ["video-editor", "desk-lyric-video", "desk-promo-clips", "desk-repurpose", "desk-translate", "desk-upscale"],
  },
];

/** Docked surfaces: real features that live as a tab, panel, or mode
    inside a host page and own no route of their own, so the route
    table never discovers them (the wave-3/4 surfaces are mostly
    these). CLASSIFICATION only — the surface's identity, its door,
    its host, and where its facts come from; facts themselves are
    extracted exactly like every other entry's:
      name ........ an en.json field (the surface's own label), or a
                    literal when the panel's heading is inline JSX
      description . en.json prose fields (gated by deepeningTextOk),
                    or a literal when the surface has NO designated
                    prose anywhere — its panel copy is inline JSX,
                    which the generator never quotes; the literal is
                    marked as reviewed classification in the entry's
                    descriptionSource, never dressed as extracted copy
      prices ...... pricesFor() over the entry's endpoints against
                    CREDIT_COSTS, like any route entry; every endpoint
                    in pricedEndpoints MUST yield a price or generation
                    throws — a docked surface's price fact cannot rot
    A missing host, a duplicate id, or an unusable description fails
    the whole generation — a stale docked entry is worse than none. */
const DOCKED_FEATURES = [
  {
    id: "tab-tutorials",
    name: { ns: "tutorials", field: "heading" },
    path: "/academy?tab=tutorials",
    hostPath: "/academy",
    description: { nsFields: [["tutorials", "sub"]] },
    endpoints: ["/api/tutorials", "/api/tutorials/:param/progress", "/api/tutorials/mine/progress"],
    pricedEndpoints: ["/api/tutorials"],
  },
  {
    id: "live-guests-backstage",
    name: { text: "Guests & Backstage" },
    path: "/go-live",
    hostPath: "/go-live",
    description: {
      text: "Bring guests onto your live stream without giving them an account: send a private invite link, they land in a backstage greenroom with its own chat, and you bring them on stage — or move them back — whenever you are ready. Invite links are shown once and can be revoked anytime.",
    },
    endpoints: ["/api/live-streams/:param/guest-invites", "/api/live-streams/:param/guests", "/api/live-streams/:param/backstage/messages", "/api/live-guest-invites/:param"],
    pricedEndpoints: ["/api/live-streams/:id/guest-invites"],
  },
  {
    id: "rtmp-ingest",
    name: { text: "Stream Key (RTMP Ingest)" },
    path: "/go-live",
    hostPath: "/go-live",
    description: {
      text: "Your stream key lets an outside streaming or DJ program send its picture into your Go Live studio. It is shown once when made — only a fingerprint is kept — and you can revoke or remake it anytime. On the current hosting, outside programs cannot reach it yet: ready and waiting, not live.",
    },
    endpoints: ["/api/live-streams/ingest-key", "/api/live-streams/ingest-key/regenerate", "/api/live-streams/ingest-key/reveal", "/api/live-streams/ingest-key/revoke"],
    pricedEndpoints: ["/api/live-streams/ingest-key"],
  },
  {
    id: "tab-dj-set-prep",
    name: { ns: "djSets", field: "title" },
    path: "/my-projects?tab=songs",
    hostPath: "/my-projects",
    description: { nsFields: [["djSets", "intro"], ["djSets", "freeNote"]] },
    endpoints: ["/api/dj/library", "/api/dj/analyze", "/api/dj/crates"],
    pricedEndpoints: ["/api/dj/analyze"],
  },
  {
    id: "mode-playlist-pitch",
    name: { text: "Playlist Pitch" },
    path: "/label-pitch?mode=playlists",
    hostPath: "/label-pitch",
    description: { nsFields: [["playlistPitch", "heroDescription"], ["playlistPitch", "deadlinesIntro"]] },
    endpoints: ["/api/playlist-pitch/kit", "/api/playlist-pitch/tracker", "/api/playlist-pitch/tracker/:param", "/api/playlist-pitch/deadlines", "/api/playlist-pitch/deadlines/:param", "/api/playlist-pitch/packet/:param", "/api/playlist-pitch/releases"],
    pricedEndpoints: ["/api/playlist-pitch/kit", "/api/playlist-pitch/tracker"],
  },
  {
    id: "paid-series",
    name: { text: "Paid Series" },
    path: "/store/buy/series/:id",
    pageFile: "artifacts/bow-down-visuals/src/pages/store-buy.tsx",
    stage: "money",
    access: "public",
    description: {
      text: "Sell a whole series as one unlock: price the series on its own page, and fans pay once to open every episode in it. Buyers watch from the series page the moment they unlock; anyone who has not paid sees a locked shelf. Setting a series up and pricing it costs nothing — the price is yours to set.",
    },
    endpoints: ["/api/store/item/:param/:param"],
    pricedEndpoints: [],
  },
  {
    id: "lead-magnets",
    name: { text: "Lead Magnets" },
    path: "/store/dashboard",
    hostPath: "/store/dashboard",
    description: {
      text: "Price a store product at zero and it becomes a lead magnet: instead of checking out, fans claim it with their email address, and the claim joins your audience list. It is the free-sample door into your store — set it up in the store dashboard on any digital product.",
    },
    endpoints: ["/api/storefront/claim"],
    pricedEndpoints: ["/api/storefront/claim"],
  },
  {
    id: "social-proof",
    name: { ns: "social-proof", field: "title" },
    path: "/settings",
    hostPath: "/settings",
    description: { nsFields: [["social-proof", "description"]] },
    endpoints: ["/api/social-proof/me", "/api/social-proof/refresh", "/api/social-proof/visibility"],
    pricedEndpoints: ["/api/social-proof/refresh"],
  },
  {
    id: "identity-sets",
    name: { ns: "artistVault", field: "identityTitle" },
    path: "/artist-vault",
    hostPath: "/artist-vault",
    description: { nsFields: [["artistVault", "identityBlurb"]] },
    endpoints: ["/api/artist-vaults/:param/identity-photos", "/api/artist-vaults/:param/identity-photos/:param"],
    pricedEndpoints: ["/api/artist-vaults/:id/identity-photos"],
  },
  {
    id: "pro-finishing-export",
    name: { text: "Pro Finishing Export" },
    path: "/video-editor",
    hostPath: "/video-editor",
    description: {
      text: "The editor's finishing door: export your final video in the pro finishing formats — ProRes and DNxHR in a MOV file, or an FCPXML timeline — with resolution, frame rate, and watermark control, instead of the standard web export.",
    },
    endpoints: ["/api/export-final-video", "/api/export-quality", "/api/export-quality/estimate"],
    pricedEndpoints: ["/api/export-final-video", "/api/export-quality", "/api/export-quality/estimate"],
  },
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

  /* Duration-tiered rails: extract each linked table and verify it
     against the registry and the serving route before anything is
     built on it (drift throws — see TIERED_PRICE_LINKS). */
  const tieredPrices = new Map(); // endpoint -> { tiers, tiersSource }
  for (const link of TIERED_PRICE_LINKS) {
    const fileLabel = `artifacts/api-server/src/${link.routeFile}`;
    const src = read(path.join(API_SRC, link.routeFile));
    if (!src.includes(`"${link.endpoint.replace("/api", "")}"`)) {
      throw new Error(`tiered prices: ${fileLabel} no longer serves ${link.endpoint}`);
    }
    const tiers = extractPriceTiers(src, link.tableConstant, fileLabel);
    const registry = creditCosts.get(link.endpoint);
    if (!registry) throw new Error(`tiered prices: CREDIT_COSTS has no entry for ${link.endpoint} to attach tiers to`);
    if (registry.cost !== tiers[0].vb) {
      throw new Error(`tiered prices: CREDIT_COSTS ${link.endpoint}=${registry.cost} disagrees with ${link.tableConstant} first tier=${tiers[0].vb} (${fileLabel})`);
    }
    tieredPrices.set(link.endpoint, {
      tiers,
      tiersSource: `${fileLabel} ${link.tableConstant} — the table the charging function derives from`,
    });
  }

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
        const tiered = tieredPrices.get(hit.key);
        byKey.set(hit.key, {
          feature: hit.feature,
          vb: hit.cost,
          endpoint: hit.key,
          source: CREDIT_COSTS_SOURCE,
          ...(tiered ? { tiers: tiered.tiers, tiersSource: tiered.tiersSource } : {}),
        });
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

  /* Description deepening pass (after the guide pass, so guide summaries
     keep outranking everything and the counts below are exact final
     attributions): features every earlier pass left bare get one more
     chance from designated prose only — see deepenDescription. Whatever
     stays bare is reported by id in the run log and pinned by the
     coverage test's allowlist. */
  const siteFeatureTaglines = extractSiteFeatureTaglines();
  const deepeningCounts = { namespace: 0, pageTitle: 0, siteFeatures: 0, metaConst: 0 };
  for (const entry of features) {
    if (entry.description) continue;
    const hit = deepenDescription(entry, en, siteFeatureTaglines);
    if (hit) {
      entry.description = hit.description;
      entry.descriptionSource = hit.descriptionSource;
      deepeningCounts[hit.kind]++;
    }
  }

  /* Tiered-price attach pass: features that front a tiered rail without
     their page sources naming its endpoint (see TIERED_PRICE_LINKS)
     gain the rail's full price entry — registry label + base figure,
     tiers attached — so their facts quote the tiers, not just the
     first tier's flat figure. A missing attach target throws: the
     link was reviewed against a real feature and must not rot. */
  for (const link of TIERED_PRICE_LINKS) {
    const tiered = tieredPrices.get(link.endpoint);
    const registry = creditCosts.get(link.endpoint);
    for (const id of link.attachToFeatureIds) {
      const entry = features.find((f) => f.id === id);
      if (!entry) {
        throw new Error(`tiered prices: attach target feature "${id}" for ${link.endpoint} is not in the knowledge base`);
      }
      if (!entry.prices.some((p) => p.endpoint === link.endpoint)) {
        // Copy-on-write: desk entries share their host page's prices
        // array by reference — never mutate it through one entry.
        entry.prices = [...entry.prices];
        entry.prices.push({
          feature: registry.feature,
          vb: registry.cost,
          endpoint: link.endpoint,
          source: CREDIT_COSTS_SOURCE,
          tiers: tiered.tiers,
          tiersSource: tiered.tiersSource,
        });
        entry.prices.sort((a, b) => a.endpoint.localeCompare(b.endpoint));
      }
    }
  }

  /* Takeover offers: first-class knowledge entries although they are not
     routed pages. Their path is the booking door (the Charts page, whose
     For Brands tab presents both offers and opens the inquiry modals);
     their price is a DOLLAR price carried on `offer`, never in the VB
     `prices` array — the two moneys never mix in one field. */
  const takeoverOffers = extractTakeoverOffers();
  for (const { spec, offer } of takeoverOffers) {
    const entry = {
      id: spec.id,
      name: offer.name,
      nameSource: `${spec.schemaFile} ${spec.constant}.name — served verbatim by GET /api${spec.offerRoute}`,
      path: spec.doorPath,
      stage: spec.stage,
      access: "public",
      pageFile: TAKEOVER_CHARTS_FILE,
      component: null,
      endpoints: [`/api${spec.inquireRoute}`, `/api${spec.offerRoute}`].sort(),
      prices: [],
      offer: {
        priceDollars: offer.priceDollars,
        durationDays: offer.durationDays,
        surfaces: offer.surfaces,
        inquiryEndpoint: `/api${spec.inquireRoute}`,
        doorLabel: spec.doorLabel,
        source: `${spec.schemaFile} ${spec.constant} — served verbatim by GET /api${spec.offerRoute} (artifacts/api-server/src/routes/${spec.routeFile})`,
      },
      description: `Paid advertising placement for ${offer.durationDays} days — ${offer.surfaces.join(" · ")}. ${offer.specs.join(". ")}.`,
      descriptionSource: `${spec.schemaFile} ${spec.constant} (surfaces + specs)`,
      nextSteps: [],
    };
    entry.nextSteps = nextStepsFor(entry, null);
    features.push(entry);
  }

  /* Feature price links: registry-priced rails the one-hop page scan
     cannot reach (see FEATURE_PRICE_LINKS) attach to their reviewed
     feature entries — copy-on-write, exactly like the tiered pass,
     because sibling entries share their host page's prices array. */
  for (const link of FEATURE_PRICE_LINKS) {
    const registry = creditCosts.get(link.endpoint);
    if (!registry) {
      throw new Error(`feature price links: CREDIT_COSTS has no entry for ${link.endpoint} to attach`);
    }
    for (const id of link.attachToFeatureIds) {
      const entry = features.find((f) => f.id === id);
      if (!entry) {
        throw new Error(`feature price links: attach target feature "${id}" for ${link.endpoint} is not in the knowledge base`);
      }
      if (!entry.prices.some((p) => p.endpoint === link.endpoint)) {
        entry.prices = [...entry.prices];
        entry.prices.push({
          feature: registry.feature,
          vb: registry.cost,
          endpoint: link.endpoint,
          source: CREDIT_COSTS_SOURCE,
        });
        entry.prices.sort((a, b) => a.endpoint.localeCompare(b.endpoint));
      }
    }
  }

  /* Docked surfaces (see DOCKED_FEATURES): first-class entries for
     the tab / panel / mode features the route table cannot discover.
     Host, name, and description resolve exactly like route entries —
     and every failure throws, so a docked entry can never go stale
     silently. */
  for (const spec of DOCKED_FEATURES) {
    if (features.some((f) => f.id === spec.id)) {
      throw new Error(`docked features: id "${spec.id}" already exists in the knowledge base`);
    }
    const host = spec.hostPath ? features.find((f) => f.path === spec.hostPath) : null;
    if (spec.hostPath && !host) {
      throw new Error(`docked features: host "${spec.hostPath}" for "${spec.id}" is not in the knowledge base`);
    }
    let name, nameSource;
    if (spec.name.ns) {
      const raw = en[spec.name.ns]?.[spec.name.field];
      if (typeof raw !== "string" || !raw.trim()) {
        throw new Error(`docked features: en.json "${spec.name.ns}.${spec.name.field}" (name for "${spec.id}") is missing`);
      }
      name = raw.replace(/^[^\p{L}\p{N}]+/u, "").trim();
      nameSource = `artifacts/bow-down-visuals/src/locales/en.json "${spec.name.ns}.${spec.name.field}"`;
    } else {
      name = spec.name.text;
      nameSource = "scripts/generate-operator-knowledge.mjs DOCKED_FEATURES (the surface's own panel heading)";
    }
    let description, descriptionSource;
    if (spec.description.nsFields) {
      const parts = spec.description.nsFields.map(([ns, field]) => {
        const v = en[ns]?.[field];
        if (typeof v !== "string") {
          throw new Error(`docked features: en.json "${ns}.${field}" (description for "${spec.id}") is missing`);
        }
        return v;
      });
      description = deepeningTextOk(parts.join(" "));
      descriptionSource = spec.description.nsFields
        .map(([ns, field]) => `artifacts/bow-down-visuals/src/locales/en.json "${ns}.${field}"`)
        .join(" + ");
    } else {
      description = deepeningTextOk(spec.description.text);
      descriptionSource = "scripts/generate-operator-knowledge.mjs DOCKED_FEATURES reviewed description (the surface's panel copy is inline JSX — no designated prose source exists to extract)";
    }
    if (!description) {
      throw new Error(`docked features: description for "${spec.id}" failed the prose gate (25–300 chars, no money figures)`);
    }
    const prices = pricesFor(spec.endpoints);
    for (const ep of spec.pricedEndpoints) {
      if (!prices.some((p) => p.endpoint === ep)) {
        throw new Error(`docked features: priced endpoint ${ep} for "${spec.id}" produced no price — is it in CREDIT_COSTS?`);
      }
    }
    const entry = {
      id: spec.id,
      name,
      nameSource,
      path: spec.path,
      stage: spec.stage ?? host?.stage ?? "studio",
      access: spec.access ?? host?.access ?? "members",
      pageFile: spec.pageFile ?? host?.pageFile ?? null,
      component: null,
      endpoints: [...spec.endpoints].sort(),
      prices,
      description,
      descriptionSource,
      nextSteps: [],
    };
    entry.nextSteps = nextStepsFor(entry, null);
    features.push(entry);
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
      takeoverOffers: takeoverOffers.length,
      withDescriptions: features.filter((f) => f.description).length,
      withoutDescriptions: features.filter((f) => !f.description).length,
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
  for (const [endpoint, t] of tieredPrices) {
    console.log(`tiered price: ${endpoint} — ${t.tiers.map((x) => `≤${x.upToSeconds}s ${x.vb} VB`).join(" · ")} (from ${t.tiersSource})`);
  }
  for (const { spec, offer } of takeoverOffers) {
    console.log(`takeover offer: ${offer.name} — $${offer.priceDollars} / ${offer.durationDays} days (from ${spec.schemaFile} ${spec.constant}, door ${spec.doorLabel} ${spec.doorPath})`);
  }
  const stages = {};
  for (const f of features) stages[f.stage] = (stages[f.stage] ?? 0) + 1;
  console.log("stages:", stages);
  const unreviewed = excluded.filter((e) => e.reason.includes("UNREVIEWED"));
  if (unreviewed.length) {
    console.log(`\nUNREVIEWED page-file exclusions (${unreviewed.length}):`);
    for (const e of unreviewed) console.log("  " + e.key);
  }
  const deepenedTotal = Object.values(deepeningCounts).reduce((a, b) => a + b, 0);
  console.log(`description deepening: +${deepenedTotal} (namespace ${deepeningCounts.namespace} · page-title meta ${deepeningCounts.pageTitle} · SITE_FEATURES ${deepeningCounts.siteFeatures} · DESCRIPTION const ${deepeningCounts.metaConst})`);
  const noDesc = features.filter((f) => !f.description);
  console.log(`features without a sourced description: ${noDesc.length}`);
  for (const f of noDesc) console.log(`  still description-less: ${f.id} (${f.path})`);
  const noPrice = features.filter((f) => f.prices.length === 0);
  console.log(`features without attached prices: ${noPrice.length} (of ${features.length})`);
  if (warnings.length) { console.log("\nWARNINGS:"); for (const w of warnings) console.log("  " + w); }
}

main();
