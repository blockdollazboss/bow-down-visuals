/**
 * Cloud Operator Phase 1 — knowledge base tests.
 *
 * The coverage half RE-DERIVES the site's surface from the frontend sources
 * (App.tsx route table, ROUTE_MATRIX, the pages directory) and fails if
 * anything is neither in the generated knowledge base nor on its explicit
 * exclusion list — the no-silent-gaps guarantee that keeps the operator's
 * knowledge current as features change. If this fails after a site change,
 * re-run: node scripts/generate-operator-knowledge.mjs (and review any
 * UNREVIEWED exclusions it reports).
 *
 * The grounding half pins the operator's honesty contract: real features
 * match with their code-sourced facts, made-up features match nothing,
 * and no VB figure exists in the guard's world unless the knowledge base
 * vouches for it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OPERATOR_KB,
  OPERATOR_FEATURES,
  findFeatures,
  buildGrounding,
  buildFeatureIndex,
  formatFeatureFacts,
  findInventedPrice,
  KNOWN_VB_FIGURES,
  KNOWN_DOLLAR_FIGURES,
} from "../operator-knowledge";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FE_SRC = path.resolve(HERE, "..", "..", "..", "..", "bow-down-visuals", "src");
const read = (p: string) => readFileSync(p, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** Independent re-derivation of the App.tsx route table. */
function deriveRoutes() {
  const src = read(path.join(FE_SRC, "App.tsx"));
  const routes: { path: string; redirectTo: string | null }[] = [];
  const re = /<Route\b([\s\S]*?)(?:<\/Route>|\/>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const block = m[1];
    const p = block.match(/path="([^"]+)"/)?.[1] ?? "*";
    const r = block.match(/(?:Redirect|CreateRedirect|QueryPreservingRedirect)[^>]*?to="([^"]+)"/)?.[1] ?? null;
    routes.push({ path: p, redirectTo: r });
  }
  return routes;
}

function deriveMatrixPaths() {
  const src = read(path.join(FE_SRC, "lib", "public-routes.ts"));
  const start = src.indexOf("export const ROUTE_MATRIX");
  const body = src.slice(start).match(/=\s*\[([\s\S]*?)\n\];/)?.[1] ?? "";
  return [...body.matchAll(/\{\s*path:\s*"([^"]+)"/g)].map((x) => x[1]);
}

const featurePaths = new Set(OPERATOR_FEATURES.map((f) => f.path));
const excludedRoutes = new Map(
  OPERATOR_KB.excluded.filter((e: any) => e.kind === "route").map((e: any) => [e.key, e.reason]),
);
const excludedPageFiles = new Map(
  OPERATOR_KB.excluded.filter((e: any) => e.kind === "pageFile").map((e: any) => [e.key, e.reason]),
);

describe("operator knowledge — coverage (no silent gaps)", () => {
  it("every App.tsx route is a feature, an exclusion, or a redirect to one", () => {
    const routes = deriveRoutes();
    expect(routes.length).toBeGreaterThan(150);
    expect(OPERATOR_KB.counts.routesInApp).toBe(routes.length);
    for (const r of routes) {
      if (featurePaths.has(r.path) || excludedRoutes.has(r.path)) continue;
      // A redirect the generator somehow didn't exclude must still land on a feature.
      expect(r.redirectTo, `route ${r.path} is neither feature nor exclusion`).not.toBeNull();
      expect(featurePaths.has(r.redirectTo!) || excludedRoutes.has(r.redirectTo!), `redirect ${r.path} -> ${r.redirectTo} lands nowhere`).toBe(true);
    }
  });

  it("every ROUTE_MATRIX path is covered", () => {
    const matrixPaths = deriveMatrixPaths();
    expect(matrixPaths.length).toBeGreaterThan(150);
    for (const p of matrixPaths) {
      expect(featurePaths.has(p) || excludedRoutes.has(p), `matrix path ${p} uncovered`).toBe(true);
    }
  });

  it("every page file is routed into a feature or excluded with a reviewed reason", () => {
    const files = walk(path.join(FE_SRC, "pages")).map((p) =>
      path.relative(path.resolve(HERE, "..", "..", "..", "..", ".."), p).split(path.sep).join("/"),
    );
    expect(OPERATOR_KB.counts.pageFiles).toBe(files.length);
    const routedFiles = new Set(OPERATOR_FEATURES.map((f) => f.pageFile).filter(Boolean));
    for (const file of files) {
      if (routedFiles.has(file)) continue;
      const reason = excludedPageFiles.get(file);
      expect(reason, `page file ${file} is neither routed nor excluded`).toBeTruthy();
      expect(reason).not.toContain("UNREVIEWED");
    }
  });

  it("counts in the artifact match the artifact itself", () => {
    expect(OPERATOR_KB.counts.features).toBe(OPERATOR_FEATURES.length);
    expect(OPERATOR_FEATURES.length).toBeGreaterThan(150);
    expect(OPERATOR_KB.packs.length).toBe(4);
  });
});

describe("operator knowledge — description coverage (no silent thinning)", () => {
  /* The deepening pass (generator: deepenDescription) covers every feature
     that has designated prose — an en.json namespace's prose fields, the
     page's own usePageTitle meta text, a SITE_FEATURES tagline, or a
     page-file DESCRIPTION constant. These nine features have NO designated
     source: their pages designate no meta description anywhere (variables,
     title-only calls, or no call at all) and no registry prose exists.
     The set is pinned in BOTH directions: a feature gaining a description
     leaves the list (update it — that's progress), and a feature LOSING
     one fails here instead of silently thinning the operator's answers. */
  const DESCRIPTION_LESS: [string, string][] = [
    ["challenge--slug-winners", "/challenge/:slug/winners"],
    ["earnings", "/earnings"],
    ["genre--genre", "/genre/:genre"],
    ["go-live-controller", "/go-live/controller"],
    ["photo-preset--slug", "/photo-preset/:slug"],
    // playlist--id joined the set at the Stack-20 integration: the
    // surface-wiring lane made the page's meta per-playlist dynamic
    // (pageDescWith / pageDescDefault), and the generator's ambiguity
    // rule refuses a two-candidate usePageTitle argument by design.
    ["playlist--id", "/playlist/:id"],
    ["search", "/search"],
    ["storefronts-builder", "/storefronts/builder"],
    ["vertical--vertical", "/vertical/:vertical"],
    ["winners", "/winners"],
  ];

  it("the description-less set is exactly the reviewed allowlist", () => {
    const less = OPERATOR_FEATURES.filter((f) => !f.description)
      .map((f) => [f.id, f.path] as [string, string])
      .sort((a, b) => a[0].localeCompare(b[0]));
    expect(less).toEqual([...DESCRIPTION_LESS].sort((a, b) => a[0].localeCompare(b[0])));
  });

  it("description counts in the artifact match the artifact and hold the floor", () => {
    const described = OPERATOR_FEATURES.filter((f) => f.description).length;
    expect(OPERATOR_KB.counts.withDescriptions).toBe(described);
    expect(OPERATOR_KB.counts.withoutDescriptions).toBe(OPERATOR_FEATURES.length - described);
    // 209 of 218 at the wave-2 deepening (was 85). The floor only moves up.
    expect(described).toBeGreaterThanOrEqual(209);
  });

  it("every description is provenance-carrying prose in the safe band", () => {
    for (const f of OPERATOR_FEATURES) {
      if (!f.description) continue;
      expect(f.descriptionSource, `${f.id} carries a description with no source`).toBeTruthy();
      expect(f.description.length, `${f.id} description out of band`).toBeGreaterThanOrEqual(25);
      expect(f.description.length, `${f.id} description out of band`).toBeLessThanOrEqual(300);
    }
  });

  it("no description quotes a money figure — prices live in the prices array only", () => {
    // A figure in prose would also seed the no-invention guard's known
    // figures (operator-knowledge.ts collects figures from descriptions),
    // laundering a stale copy string into a vouched price.
    const money = /\d[\d,]*\s*(?:%|VB\b|Visual Bucs)|\$\s*\d|\d[\d,]*\s*credits?\b|\b(?:a\s+single|single|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+Visual Bucs?\b/i;
    for (const f of OPERATOR_FEATURES) {
      if (!f.description) continue;
      expect(money.test(f.description), `${f.id} description quotes a money figure: ${f.description}`).toBe(false);
    }
  });

  it("deepened descriptions pin to their designated sources", () => {
    const byPath = (p: string) => OPERATOR_FEATURES.find((f) => f.path === p)!;
    // en.json namespace, expanded field (metaDescription is deepening-only).
    expect(byPath("/dashboard").description).toBe("Your creator command center — every AI tool in one place.");
    expect(byPath("/dashboard").descriptionSource).toContain('en.json "dashboard.metaDescription"');
    // The page's own usePageTitle meta text.
    expect(byPath("/beats").description).toBe("Buy and sell beats: producers list instrumentals, and artists preview and license them by tier.");
    expect(byPath("/beats").descriptionSource).toContain("usePageTitle meta description");
    // A page-file DESCRIPTION constant (SEO index page).
    expect(byPath("/tools").description).toBe("Every AI tool on Bow Down Visuals: thumbnail maker, hook generator, caption writer, music video maker, clip cutter, and song maker. Free to browse.");
    expect(byPath("/tools").descriptionSource).toContain("DESCRIPTION constant");
    // The Academy guides tab reads its host's prose — the en.guides legal
    // namespace is blocklisted (it describes the standalone legal pages).
    expect(byPath("/academy?tab=guides").description).toBe("Free courses and tutorials to grow as a content creator — video, music, and branding masterclasses.");
    // The randomizer's own hero quotes a stale pre-x100 price, so the tab
    // falls through to its host desk's prose instead.
    expect(byPath("/hooks?tab=dice").description).toBe("Your money is made in the first 3 seconds. Generate scroll-stopping openers — then run your post through the pre-flight before you ship it.");
    // Last-segment namespace fall-through must never hand a dashboard the
    // creator command-center text: both dashboards carry their OWN meta.
    expect(byPath("/store/dashboard").description).toBe("Your store earnings, orders, products, and discount codes. The Get Paid finale.");
    expect(byPath("/sponsors/dashboard").description).toBe("Your sponsorship dashboard — track deals, deliverables and earnings on Bow Down Visuals.");
  });

  it("a deepened feature's facts carry its description to the operator", () => {
    const beats = OPERATOR_FEATURES.find((f) => f.path === "/beats")!;
    expect(formatFeatureFacts(beats)).toContain("What it is: Buy and sell beats");
  });
});

/* Stack-25 accuracy audit history: the audit found six endpoints where
   the CREDIT_COSTS registry misrecorded the rail, and the knowledge base
   temporarily took those prices from the server rails via the
   generator's SERVER_PRICE_OVERRIDES. The follow-on price-registry
   correction fixed CREDIT_COSTS itself to match the rails, the
   overrides were retired (the generator's table stands empty), and the
   three constant cross-checks agree again. The Stack-25 describe block
   at the end of this file now pins registry == rail directly for all
   six endpoints, re-derived from both source files. */

describe("operator knowledge — sourced facts only", () => {
  it("every price names the registry as its source and is a whole VB figure", () => {
    let priced = 0;
    for (const f of OPERATOR_FEATURES) {
      for (const p of f.prices) {
        priced++;
        expect(p.source).toContain("credit-costs.ts");
        expect(Number.isInteger(p.vb)).toBe(true);
        expect(p.vb).toBeGreaterThanOrEqual(0);
        expect(p.endpoint.startsWith("/api/")).toBe(true);
        expect(KNOWN_VB_FIGURES.has(p.vb)).toBe(true);
      }
    }
    expect(priced).toBeGreaterThan(50);
  });

  it("registry vs server-constant cross-checks all agree", () => {
    expect(OPERATOR_KB.crossChecks.length).toBeGreaterThanOrEqual(3);
    for (const c of OPERATOR_KB.crossChecks) {
      expect(c.agree, `${c.constant} vs ${c.endpoint}`).toBe(true);
    }
  });

  it("every feature has a name, a real path, and a stage", () => {
    for (const f of OPERATOR_FEATURES) {
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.path.startsWith("/")).toBe(true);
      expect(f.stage.length).toBeGreaterThan(0);
    }
  });

  it("the feature index the operator reads covers the whole base", () => {
    const index = buildFeatureIndex();
    for (const f of OPERATOR_FEATURES) {
      expect(index).toContain(`${f.name} (${f.path})`);
    }
  });
});

describe("operator knowledge — matching and grounding", () => {
  it("matches the song panel for a make-a-song question, guide attached", () => {
    const hits = findFeatures("how do I make a song");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].path).toBe("/create?panel=song");
    expect(hits[0].guide?.pageName).toBe("Make a Song");
  });

  it("matches brand deals first for a brand-deals question", () => {
    const hits = findFeatures("how do brand deals work");
    expect(hits[0]?.path).toBe("/brand-deals");
  });

  /* Collection intent: a possessive locator question ("where is MY …")
     must match the member's own collection page first — the grounding
     facts lead with it, so the model's answer and the door under it
     name the same destination (the Oct 20 staging defect was the door
     disagreeing with the answer). Creation verbs and price questions
     are never locator questions. */
  it("matches My Music first for music-collection locators", () => {
    expect(findFeatures("Where is my music library?")[0]?.path).toBe("/my-music");
    expect(findFeatures("Where are my songs?")[0]?.path).toBe("/my-music");
    const g = buildGrounding("Where is my music library?");
    expect(g).toContain("▸ My Music — path /my-music");
  });

  it("matches My Clips first for video-collection locators", () => {
    expect(findFeatures("Where is my video library?")[0]?.path).toBe("/my-projects?tab=myclips");
    expect(findFeatures("Where are my videos?")[0]?.path).toBe("/my-projects?tab=myclips");
  });

  it("collection intent never hijacks a creation or pricing question", () => {
    expect(findFeatures("How do I make a music video?")[0]?.path).toBe("/tools/ai-music-video-maker");
    // Head-noun rule: "music video" names two domains; the bonus follows
    // the head noun (video), so the music collection cannot claim it and
    // the creation tool keeps the match it has always had.
    expect(findFeatures("Where is my music video?")[0]?.path).toBe("/tools/ai-music-video-maker");
    expect(findFeatures("How do I make a song, and what does it cost?")[0]?.path).toBe("/create?panel=song");
  });

  it("matches the bio publish price to the page that charges it", () => {
    const hits = findFeatures("how much does it cost to publish my link in bio page");
    const carrier = hits.find((f) => f.prices.some((p) => p.endpoint === "/api/bio-publish"));
    expect(carrier).toBeTruthy();
    expect(carrier!.prices.find((p) => p.endpoint === "/api/bio-publish")!.vb).toBe(100);
  });

  it("a made-up feature matches nothing", () => {
    expect(findFeatures("do you have a quantum flux capacitor")).toEqual([]);
    expect(buildGrounding("do you have a quantum flux capacitor")).toContain(
      "no feature in the index matches",
    );
  });

  it("grounding for a priced feature carries its path and its code-sourced price", () => {
    const g = buildGrounding("how do brand deals work");
    expect(g).toContain("VERIFIED FACTS");
    expect(g).toContain("/brand-deals");
    expect(g).toContain("Brand Deal Finder — 200 Visual Bucs");
  });

  it("an unpriced feature's facts contain no price line and no VB figure", () => {
    const world = OPERATOR_FEATURES.find((f) => f.path === "/world")!;
    const facts = formatFeatureFacts(world);
    expect(facts).not.toContain("Price:");
    expect(facts).not.toMatch(/\d+\s*(VB|Visual Bucs)/);
    expect(facts).toContain("open to everyone");
  });

  it("the song panel's facts carry the journey handoff to Branding Kit", () => {
    const song = OPERATOR_FEATURES.find((f) => f.path === "/create?panel=song")!;
    const facts = formatFeatureFacts(song);
    expect(facts).toContain("Branding Kit (/branding-kit)");
    expect(facts).toContain("Walk me through it");
  });
});

describe("operator knowledge — the no-invention price guard", () => {
  it("passes figures the knowledge base vouches for", () => {
    expect(findInventedPrice("Making the song is 400 Visual Bucs.")).toBeNull();
    expect(findInventedPrice("Packs go up to 50,000 Visual Bucs.")).toBeNull();
    expect(findInventedPrice("Publishing your bio page is 100 VB.")).toBeNull();
    expect(findInventedPrice("No prices in this answer at all.")).toBeNull();
  });

  it("catches figures that exist nowhere in the knowledge base", () => {
    expect(findInventedPrice("That costs 999 VB.")).toBe(999);
    expect(findInventedPrice("Only 37 credits, friend.")).toBe(37);
    expect(findInventedPrice("A steal at 12,345 Visual Bucs.")).toBe(12345);
  });

  it("vouches for the takeover offers' dollar prices — and only those dollars", () => {
    expect(KNOWN_DOLLAR_FIGURES.has(1000)).toBe(true);
    expect(KNOWN_DOLLAR_FIGURES.has(2500)).toBe(true);
    expect(findInventedPrice("The Spotlight Takeover is $1,000 for 7 days.")).toBeNull();
    expect(findInventedPrice("Taking over the loading screen runs 2,500 dollars.")).toBeNull();
    // Invented dollar prices trip the guard exactly like invented VB ones:
    expect(findInventedPrice("The Spotlight Takeover is only $1,500.")).toBe(1500);
    expect(findInventedPrice("Yours for 750 dollars.")).toBe(750);
    // Pack dollar prices are NOT knowledge (checkout sets them) — quoting
    // one is invention, per the operator's standing rule:
    expect(findInventedPrice("That pack is $39.")).toBe(39);
  });
});

describe("operator knowledge — song duration tiers (live defect, Oct 20)", () => {
  const API_SRC = path.resolve(HERE, "..", "..");

  /** Independent re-derivation of SONG_PRICE_TIERS from music-audio.ts —
      the test parses the route source itself rather than trusting the
      generator's parser, so a generator drift fails here. */
  function deriveSongTiers() {
    const src = read(path.join(API_SRC, "routes", "generate", "music-audio.ts"));
    const start = src.indexOf("export const SONG_PRICE_TIERS");
    expect(start, "SONG_PRICE_TIERS in music-audio.ts").toBeGreaterThanOrEqual(0);
    const body = src.slice(start, src.indexOf("] as const;", start));
    return [...body.matchAll(/\{\s*maxLengthMs:\s*([\d_]+),\s*cost:\s*([\d_]+)\s*\}/g)].map((m) => ({
      upToSeconds: Number(m[1].replace(/_/g, "")) / 1000,
      vb: Number(m[2].replace(/_/g, "")),
    }));
  }

  it("the tiers are the ratified 400 / 800 / 1,200 table, and the charging function derives from it", () => {
    expect(deriveSongTiers()).toEqual([
      { upToSeconds: 60, vb: 400 },
      { upToSeconds: 180, vb: 800 },
      { upToSeconds: 300, vb: 1200 },
    ]);
    const src = read(path.join(API_SRC, "routes", "generate", "music-audio.ts"));
    const fnStart = src.indexOf("export function creditCostForLength");
    expect(fnStart).toBeGreaterThanOrEqual(0);
    expect(src.slice(fnStart, fnStart + 400)).toContain("SONG_PRICE_TIERS");
  });

  it("every knowledge entry for the music-audio rail carries the full tier table", () => {
    const derived = deriveSongTiers();
    let carriers = 0;
    for (const f of OPERATOR_FEATURES) {
      for (const p of f.prices) {
        if (p.endpoint !== "/api/generate-music-audio") continue;
        carriers++;
        expect(p.tiers, `${f.id} music-audio tiers`).toEqual(derived);
        expect(p.tiersSource).toContain("music-audio.ts");
        expect(p.tiersSource).toContain("SONG_PRICE_TIERS");
        // The registry's flat base figure is the first tier's price:
        expect(p.vb).toBe(derived[0]!.vb);
      }
    }
    expect(carriers).toBeGreaterThan(10);
  });

  it("the Make a Song entry itself carries the tiered song price", () => {
    const song = OPERATOR_FEATURES.find((f) => f.path === "/create?panel=song")!;
    const p = song.prices.find((x) => x.endpoint === "/api/generate-music-audio");
    expect(p).toBeTruthy();
    expect(p!.tiers).toEqual(deriveSongTiers());
  });

  it("grounding for a 3-minute song question carries the 800 VB tier", () => {
    const g = buildGrounding("How much is a song up to 3 minutes?");
    expect(g).toContain("VERIFIED FACTS");
    expect(g).toContain("priced by length");
    expect(g).toContain("up to 3 minutes — 800 Visual Bucs");
    expect(g).toContain("up to 5 minutes — 1,200 Visual Bucs");
  });

  it("the guard vouches the tier figures — and still catches an invented song price", () => {
    expect(KNOWN_VB_FIGURES.has(800)).toBe(true);
    expect(KNOWN_VB_FIGURES.has(1200)).toBe(true);
    expect(findInventedPrice("A song up to 3 minutes is 800 Visual Bucs.")).toBeNull();
    expect(findInventedPrice("A full 5-minute song runs 1,200 Visual Bucs.")).toBeNull();
    expect(findInventedPrice("A song costs 999 VB.")).toBe(999);
  });
});

describe("operator knowledge — takeover offers (wave 2 #2)", () => {
  const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..", "..");

  /** Independent re-derivation of an *_OFFER constant from lib/db — the
      test parses the schema file itself rather than trusting the
      generator's parser, so a generator drift fails here. */
  function deriveOffer(schemaRel: string, constant: string) {
    const src = read(path.join(REPO_ROOT, schemaRel));
    const start = src.indexOf(`export const ${constant}`);
    expect(start, `${constant} in ${schemaRel}`).toBeGreaterThanOrEqual(0);
    const body = src.slice(start, src.indexOf("} as const;", start));
    return {
      name: body.match(/name:\s*"([^"]+)"/)?.[1],
      priceDollars: Number(body.match(/priceDollars:\s*(\d+)/)?.[1]),
      durationDays: Number(body.match(/durationDays:\s*(\d+)/)?.[1]),
    };
  }

  const CASES = [
    {
      id: "spotlight-takeover",
      schema: "lib/db/src/schema/spotlight.ts",
      constant: "SPOTLIGHT_OFFER",
      routeFile: "spotlight.ts",
      offerEndpoint: "/api/spotlight/offer",
      inquireEndpoint: "/api/spotlight/inquire",
    },
    {
      id: "loading-screen-takeover",
      schema: "lib/db/src/schema/loading-screen.ts",
      constant: "LOADING_SCREEN_OFFER",
      routeFile: "loading-screen.ts",
      offerEndpoint: "/api/loading-screen/offer",
      inquireEndpoint: "/api/loading-screen/inquire",
    },
  ] as const;

  it("both offers are first-class entries priced from the served constants", () => {
    expect(OPERATOR_KB.counts.takeoverOffers).toBe(2);
    expect(OPERATOR_FEATURES.filter((f) => f.offer).length).toBe(2);
    for (const c of CASES) {
      const derived = deriveOffer(c.schema, c.constant);
      const f = OPERATOR_FEATURES.find((x) => x.id === c.id);
      expect(f, c.id).toBeTruthy();
      expect(f!.name).toBe(derived.name);
      expect(f!.offer!.priceDollars).toBe(derived.priceDollars);
      expect(f!.offer!.durationDays).toBe(derived.durationDays);
      expect(f!.offer!.source).toContain(c.schema);
      expect(f!.offer!.inquiryEndpoint).toBe(c.inquireEndpoint);
      expect(f!.endpoints).toContain(c.offerEndpoint);
      expect(f!.endpoints).toContain(c.inquireEndpoint);
      // Dollars never ride the Visual Bucs price array:
      expect(f!.prices).toEqual([]);
      expect(KNOWN_DOLLAR_FIGURES.has(derived.priceDollars)).toBe(true);
    }
  });

  it("the offer endpoints still serve the constants the entries came from", () => {
    for (const c of CASES) {
      const routeSrc = read(path.join(HERE, "..", "..", "routes", c.routeFile));
      expect(routeSrc).toContain(c.constant);
      expect(routeSrc).toContain(`"${c.offerEndpoint.replace("/api", "")}"`);
      expect(routeSrc).toContain(`"${c.inquireEndpoint.replace("/api", "")}"`);
    }
  });

  it("the takeover questions match their offers first, with the door attached", () => {
    const spot = findFeatures("How much is a Spotlight takeover?");
    expect(spot[0]?.id).toBe("spotlight-takeover");
    const load = findFeatures("How much to take over the loading screen?");
    expect(load[0]?.id).toBe("loading-screen-takeover");

    const gSpot = buildGrounding("How much is a Spotlight takeover?");
    expect(gSpot).toContain("$1,000");
    expect(gSpot).toContain("For Brands");
    expect(gSpot).toContain("/charts");
    const gLoad = buildGrounding("How much to take over the loading screen?");
    expect(gLoad).toContain("$2,500");
    expect(gLoad).toContain("/charts");

    const facts = formatFeatureFacts(OPERATOR_FEATURES.find((f) => f.id === "spotlight-takeover")!);
    expect(facts).toContain("$1,000 for 7 days");
    expect(facts).toContain("not Visual Bucs");
    expect(facts).toContain("Charts — For Brands tab (/charts)");
  });
});

describe("operator knowledge — Stack-20 surfaces", () => {
  const byId = (id: string) => OPERATOR_FEATURES.find((f) => f.id === id);

  /* Smart Reframe arrived as a card docked in the editor's Export tab
     with no route of its own — the base had NO reframe entry at all,
     so the operator could neither describe it nor quote its 200 VB
     rail. The entry's prose is the card's own en.json copy, including
     the centre-crop fallback honesty. */
  it("smart reframe is a first-class entry at the code price, fallback stated", () => {
    const f = byId("smart-reframe")!;
    expect(f).toBeTruthy();
    expect(f.path).toBe("/video-editor");
    expect(f.prices).toEqual([
      expect.objectContaining({ endpoint: "/api/auto-reframe", vb: 200 }),
    ]);
    expect(f.description).toContain("centre crop");
    expect(f.description).toContain("says so honestly");
    expect(f.descriptionSource).toContain("videoEditor.subjectReframe");
    expect(formatFeatureFacts(f)).toContain("Smart Reframe — Subject Tracking — 200 Visual Bucs");
    const hits = findFeatures("how much does smart reframe cost");
    const carrier = hits.find((h) => h.prices.some((p) => p.endpoint === "/api/auto-reframe"));
    expect(carrier).toBeTruthy();
    expect(carrier!.prices.find((p) => p.endpoint === "/api/auto-reframe")!.vb).toBe(200);
  });

  /* The template gallery never calls the apply rail (it hands off to
     the editor), so the scan left its entry priceless — and its page
     copy called the templates free. The price link + the corrected
     copy pin the truth: browsing is free, applying is 250 VB. */
  it("video templates carry the 250 VB apply price and no longer read as free", () => {
    const f = byId("templates-videos")!;
    expect(f.prices).toEqual([
      expect.objectContaining({ endpoint: "/api/video-template/apply", vb: 250 }),
    ]);
    expect(f.description).not.toContain("Free video edit templates");
    expect(f.description).toContain("18 ready-made cuts");
    const editor = byId("video-editor")!;
    expect(editor.prices.some((p) => p.endpoint === "/api/video-template/apply" && p.vb === 250)).toBe(true);
  });

  it("the template and reframe server constants cross-check against the registry", () => {
    const tpl = OPERATOR_KB.crossChecks.find((c: any) => c.constant === "TEMPLATE_COST");
    expect(tpl).toMatchObject({ endpoint: "/api/video-template/apply", serverValue: 250, registryValue: 250, agree: true });
    const ref = OPERATOR_KB.crossChecks.find((c: any) => c.constant === "REFRAME_COST");
    expect(ref).toMatchObject({ endpoint: "/api/auto-reframe", serverValue: 200, registryValue: 200, agree: true });
  });

  /* The RTMP honesty gate (Stack-20): while the deployment hasn't
     opened ingest, the mint doors refuse — the entry must never
     describe a stream key as something you can make today. */
  it("rtmp ingest is described as not open yet, never as working", () => {
    const f = byId("rtmp-ingest")!;
    expect(f.description).toContain("isn't open yet");
    expect(f.description).toContain("arrives with the launch setup");
    expect(f.description).toContain("built-in Go Live studio works today");
    expect(f.description).not.toContain("shown once when made");
    expect(f.description).not.toContain("revoke or remake it anytime");
  });

  /* Morning brief fallback (Stack-20): when the written narrative
     can't be produced, the panel serves the real numbers digest.
     The entry's prose is the panel's own fallback copy, and the
     brief is free — no price line may appear in its facts. */
  it("the morning brief entry carries the digest fallback and no price", () => {
    const f = byId("morning-brief")!;
    expect(f).toBeTruthy();
    expect(f.path).toBe("/dashboard");
    expect(f.endpoints).toContain("/api/command/brief");
    expect(f.prices).toEqual([]);
    expect(f.description).toContain("here are your numbers, straight from your business");
    expect(f.description).toContain("Nothing goes out on its own");
    expect(formatFeatureFacts(f)).not.toContain("Price:");
  });

  /* Email automations (wave 3 + the Stack-20 abandoned-checkout
     trigger): one entry whose own intro names all three triggers and
     the off-by-default law. The rail charges nothing. */
  it("email automations name every trigger and the off-by-default law", () => {
    const f = byId("email-automations")!;
    expect(f).toBeTruthy();
    expect(f.path).toBe("/email-list");
    expect(f.prices).toEqual([]);
    expect(f.description).toContain("buys");
    expect(f.description).toContain("leaves a checkout unfinished");
    expect(f.description).toContain("lets a membership end");
    expect(f.description).toContain("stays off until you switch it on");
    expect(f.description).toContain("Fans who unsubscribed are never emailed");
  });

  /* The pitch packet builds from the release record — its links are
     the record's real presave / smartlink, never fabricated — and
     building one is free; the mode's 200 VB rail is the kit alone. */
  it("the pitch packet is its own free entry, and the kit stays 200 VB", () => {
    const f = byId("playlist-pitch-packet")!;
    expect(f).toBeTruthy();
    expect(f.endpoints).toContain("/api/playlist-pitch/packet/:param");
    expect(f.prices).toEqual([]);
    expect(f.description).toContain("real data only");
    expect(f.description).toContain("never made up");
    const mode = byId("mode-playlist-pitch")!;
    expect(mode.prices.find((p) => p.endpoint === "/api/playlist-pitch/kit")!.vb).toBe(200);
    expect(mode.prices.some((p) => p.endpoint.includes("packet"))).toBe(false);
  });
});

describe("operator knowledge — Stack-25 accuracy corrections", () => {
  const API_SRC = path.resolve(HERE, "..", "..");

  /** Independent re-derivation of a server cost constant — plain literal,
      env-overridable default, and nullish-env forms — parsed from the
      named server file itself, never from the generated base. */
  function deriveServerConstant(rel: string, constant: string): number {
    const src = read(path.join(API_SRC, rel));
    const re = new RegExp(
      `(?:export\\s+)?const\\s+${constant}\\s*(?::\\s*number)?\\s*=\\s*(?:Number\\(process\\.env\\[["'][A-Z0-9_]+["']\\](?:\\s*\\?\\?\\s*\\d+)?\\)\\s*\\|\\|\\s*)?(\\d+)\\b`,
    );
    const m = src.match(re);
    expect(m, `${constant} in ${rel}`).toBeTruthy();
    return Number(m![1]);
  }

  function kbPrices(endpoint: string) {
    return OPERATOR_FEATURES.flatMap((f) => f.prices).filter((p) => p.endpoint === endpoint);
  }

  /** The displayed price: the CREDIT_COSTS registry entry in the
      frontend's credit-costs.ts, parsed from the file itself. (Since the
      Stack-25 price-registry correction the registry is the knowledge
      base's only price source again — these pins assert it still agrees
      with the rail it displays, in both directions.) */
  function deriveRegistryCost(endpoint: string): number {
    const registryFile = path.resolve(API_SRC, "..", "..", "bow-down-visuals", "src", "lib", "credit-costs.ts");
    const src = read(registryFile);
    const escaped = endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = src.match(new RegExp(`"${escaped}":\\s*\\{\\s*cost:\\s*(\\d+)`));
    expect(m, `CREDIT_COSTS entry for ${endpoint}`).toBeTruthy();
    return Number(m![1]);
  }

  /* The audit found the registry at 200 VB against the rail's
     JEWELRY_STL_CREDIT_COST = 400. The registry correction moved the
     DISPLAY to the charge; this pin holds registry == rail so the two
     can never drift apart silently again. */
  it("jewelry STL export: the displayed registry price equals the server charge", () => {
    const serverValue = deriveServerConstant("routes/generate/jewelry-pricing.ts", "JEWELRY_STL_CREDIT_COST");
    expect(serverValue).toBe(400);
    expect(deriveRegistryCost("/api/jewelry/export-stl")).toBe(serverValue);
    const entries = kbPrices("/api/jewelry/export-stl");
    expect(entries.length).toBeGreaterThan(0);
    for (const p of entries) {
      expect(p.vb).toBe(serverValue);
      expect(p.source).toContain("credit-costs.ts");
    }
    // The sibling jewelry rails the registry records correctly stay pinned too.
    expect(deriveServerConstant("routes/generate/jewelry-pricing.ts", "JEWELRY_PREVIEW_CREDIT_COST")).toBe(200);
    expect(deriveServerConstant("routes/generate/jewelry-pricing.ts", "JEWELRY_CONSULT_CREDIT_COST")).toBe(100);
    for (const p of kbPrices("/api/jewelry/design")) expect(p.vb).toBe(200);
    for (const p of kbPrices("/api/jewelry/consult")) expect(p.vb).toBe(100);
  });

  /* The audit found the registry at 200 VB against a rail charge of
     1 VB — PRO_TOOLS_AI_CREDITS still carried its pre-x100 default.
     The registry correction first moved the DISPLAY to the charge;
     the owner then ruled the price itself (Oct 22, 2026): the rail
     default is now 100, the one-click AI-assist tier, and the display
     moved with it. This pin holds registry == rail at the ruled
     price. */
  it("auto grade: the displayed registry price equals the server charge", () => {
    const serverValue = deriveServerConstant("routes/generate/pro-tools-ai.ts", "PRO_TOOLS_AI_CREDITS");
    expect(serverValue).toBe(100);
    expect(deriveRegistryCost("/api/pro-tools/auto-grade")).toBe(serverValue);
    const entries = kbPrices("/api/pro-tools/auto-grade");
    expect(entries.length).toBeGreaterThan(0);
    for (const p of entries) {
      expect(p.vb).toBe(serverValue);
      expect(p.source).toContain("credit-costs.ts");
    }
    expect(KNOWN_VB_FIGURES.has(serverValue)).toBe(true);
  });

  /* The audit found the registry at 100 VB flat; the rail prices sample
     packs by size (10/25/50 samples). The registry records the smallest
     pack's price — its own base-price convention — now corrected to the
     rail's 500, and the larger tiers are re-derived here so the table
     can't drift silently. */
  it("sample packs: the displayed registry base equals the smallest pack's server price", () => {
    const base = deriveServerConstant("routes/generate/sample-pack-pricing.ts", "SAMPLE_PACK_10_CREDITS");
    expect(base).toBe(500);
    expect(deriveServerConstant("routes/generate/sample-pack-pricing.ts", "SAMPLE_PACK_25_CREDITS")).toBe(1200);
    expect(deriveServerConstant("routes/generate/sample-pack-pricing.ts", "SAMPLE_PACK_50_CREDITS")).toBe(2000);
    expect(deriveRegistryCost("/api/sample-pack/generate")).toBe(base);
    const entries = kbPrices("/api/sample-pack/generate");
    expect(entries.length).toBeGreaterThan(0);
    for (const p of entries) {
      expect(p.vb).toBe(base);
      expect(p.source).toContain("credit-costs.ts");
    }
  });

  /* Free rails the registry once priced anyway: the named handlers
     perform no credit charge at all, re-derived by slicing each handler
     out of its route file and scanning the slice for a charge call —
     and the registry now records them at 0 to match. */
  const FREE_RAILS = [
    { endpoint: "/api/jewelry/estimate", file: "routes/generate/jewelry.ts", handler: "/jewelry/estimate" },
    { endpoint: "/api/music/export", file: "routes/music-export.ts", handler: "/music/export" },
    { endpoint: "/api/music/preview-render", file: "routes/music-export.ts", handler: "/music/preview-render" },
  ];
  for (const spec of FREE_RAILS) {
    it(`${spec.endpoint} is free — its handler charges nothing and the registry says so`, () => {
      const src = read(path.join(API_SRC, spec.file));
      const start = src.indexOf(`router.post("${spec.handler}"`);
      expect(start, `${spec.handler} in ${spec.file}`).toBeGreaterThanOrEqual(0);
      const rest = src.slice(start);
      const next = rest.slice(1).search(/\n\s*router\.(get|post|put|patch|delete)\(/);
      const slice = next < 0 ? rest : rest.slice(0, next + 1);
      expect(slice).not.toMatch(/chargeCredits\s*\(|deductCredits\s*\(/);
      expect(deriveRegistryCost(spec.endpoint)).toBe(0);
      const entries = kbPrices(spec.endpoint);
      expect(entries.length).toBeGreaterThan(0);
      for (const p of entries) {
        expect(p.vb).toBe(0);
        expect(p.source).toContain("credit-costs.ts");
      }
    });
  }

  /* The pricing entry named VIP and MVP tiers; no such products exist.
     The purchasable tiers are the platform-fees TIER_PLANS — re-derived
     here — and the entry must name them instead. */
  it("the pricing entry names the real purchasable tiers", () => {
    const fees = read(path.join(API_SRC, "lib", "platform-fees.ts"));
    expect(fees).toMatch(/name:\s*"Pro"[\s\S]{0,160}?priceUsdPerMonth:\s*12/);
    expect(fees).toMatch(/name:\s*"Elite"[\s\S]{0,160}?priceUsdPerMonth:\s*29/);
    const f = OPERATOR_FEATURES.find((x) => x.id === "pricing")!;
    expect(f.description).toContain("Creator Pro");
    expect(f.description).toContain("Creator Elite");
    expect(f.description).not.toContain("VIP");
    expect(f.description).not.toContain("MVP");
  });

  /* The templates hub called the templates free while applying a video
     template costs 250 VB (pinned above). Browsing is free; generating
     is not — the entry must carry the same honesty the caption packs
     page states in its own body copy. */
  it("the templates hub no longer calls generation free", () => {
    const f = OPERATOR_FEATURES.find((x) => x.id === "templates")!;
    expect(f.description).not.toContain("Free templates");
    expect(f.description).toContain("Free to browse");
    expect(f.description).toContain("credits apply when you generate");
  });
});

/* Stack-26 — the World after Open World Phase 1 (shipped to the gated
   site Oct 22, 2026). Arrival moved out of the King's Hall: visitors
   now spawn on The King's Plaza, the palace's open-air front square,
   and walk through the hall's open doors. The World page's own meta
   moved with the build, but the generated base was not regenerated
   after the merge that carried the open world in, so the operator
   kept greeting people at the hall door ("Step into the King's Hall:
   one shared hall…"). Regeneration from the designated source — the
   page's usePageTitle meta — is the correction; the audit behind it
   verified every World fact the base touches against the shipped
   world code, and these pins hold them: spawn, board locations,
   caps, guest rules, and the honesty line on the districts. (The
   district pin below was deliberately revisited after the owner's
   Stack-100 order built all six districts open, and Stack-28's
   A6-K2 pass completed that revisit by naming them — see its
   comment.) */
describe("operator knowledge — Stack-26 open-world corrections", () => {
  const API_SRC = path.resolve(HERE, "..", "..");

  const worldEntry = () => OPERATOR_FEATURES.find((f) => f.path === "/world")!;

  /** A plain numeric constant, parsed from the named source text. */
  function deriveConst(src: string, constant: string): number {
    const m = src.match(new RegExp(`(?:export\\s+)?const\\s+${constant}\\s*=\\s*(\\d+)`));
    expect(m, constant).toBeTruthy();
    return Number(m![1]);
  }

  /* The description is the page's designated meta (deepening source:
     usePageTitle's second argument), re-derived from world.tsx itself
     so the base and the page can never drift apart silently again. */
  it("the World description is the page's own plaza meta — arrival is the plaza, not the hall", () => {
    const page = read(path.join(FE_SRC, "pages", "world.tsx"));
    const meta = page.match(/usePageTitle\(\s*"[^"]*",\s*"([^"]+)"\)/)?.[1];
    expect(meta).toBeTruthy();
    const f = worldEntry();
    expect(f.descriptionSource).toContain("world.tsx usePageTitle meta description");
    expect(f.description).toBe(meta);
    expect(f.description).toContain("King's Plaza");
    expect(f.description).not.toContain("Step into the King's Hall");
    expect(f.description).not.toContain("one shared hall");
  });

  /* Spawn, re-derived on both sides of the wire: the client's floor
     plan names the courtyard room The King's Plaza and puts its spawn
     on the promenade's head (0, 31.5), facing the palace; the server's
     front door (enterPalace) attaches arrivals to that same room. */
  it("visitors spawn on the King's Plaza — layout, spawn point and the server's front door agree", () => {
    const layout = read(path.join(FE_SRC, "lib", "world", "palace-layout.ts"));
    const courtyardId = layout.match(/export const COURTYARD_ID = "([^"]+)"/)?.[1];
    expect(courtyardId).toBe("world:courtyard");
    const start = layout.indexOf("[COURTYARD_ID]:");
    expect(start).toBeGreaterThan(-1);
    /* The overhaul's item-36 restructure grew the courtyard block
       well past the old 800-char window — its grounds commentary
       alone runs longer — and pushed the spawn line outside it.
       The assertions below are unchanged; the window now covers
       the whole block, sliced to the next top-level room entry. */
    const nextRoom = layout.indexOf("\n  [", start + 1);
    expect(nextRoom).toBeGreaterThan(start);
    const block = layout.slice(start, nextRoom);
    expect(block).toMatch(/name:\s*"The King's Plaza"/);
    expect(block).toMatch(/spawn:\s*\{\s*x:\s*0,\s*z:\s*31\.5\s*\}/);

    const palace = read(path.join(API_SRC, "lib", "world-palace.ts"));
    const plazaId = palace.match(/export const WORLD_PLAZA_ROOM_ID = "([^"]+)"/)?.[1];
    expect(plazaId).toBe(courtyardId);
    expect(palace).toMatch(/enterPalace\(socket[\s\S]{0,400}?plazaRoom\.attach/);

    expect(worldEntry().description).toContain("King's Plaza");
  });

  /* The board's two stands, re-derived from the station registry:
     the hall's own and the plaza monument — the same live board on
     the same panel id, and both open to guests (membersOnly false),
     exactly as the plaza comment in stations.ts states. */
  it("the Kingdom Board stands in the hall and on the plaza — same board, open to guests", () => {
    const stations = read(path.join(FE_SRC, "lib", "world", "stations.ts"));
    const stationWindow = (id: string): string => {
      const i = stations.indexOf(`id: "${id}"`);
      expect(i, `station ${id}`).toBeGreaterThan(-1);
      return stations.slice(i, i + 500);
    };
    const hallBoard = stationWindow("kingdom-board");
    expect(hallBoard).toContain("roomId: HALL_ROOM_ID");
    expect(hallBoard).toContain("membersOnly: false");
    expect(hallBoard).toContain('panel: { kind: "custom", id: "kingdom-board" }');
    const plazaBoard = stationWindow("kingdom-board-plaza");
    expect(plazaBoard).toContain("roomId: COURTYARD_ID");
    expect(plazaBoard).toContain("membersOnly: false");
    expect(plazaBoard).toContain('panel: { kind: "custom", id: "kingdom-board" }');
  });

  /* Per-room caps, re-derived from the room server's own constants:
     30 present, 12 on the voice mesh — the stitched zone did not
     merge or raise them. */
  it("per-room caps stay 30 present / 12 voice, re-derived from the room server", () => {
    const room = read(path.join(API_SRC, "lib", "world-room.ts"));
    expect(deriveConst(room, "WORLD_PRESENCE_CAP")).toBe(30);
    expect(deriveConst(room, "WORLD_VOICE_CAP")).toBe(12);
  });

  /* Guests enter and look — the room server refuses their say frames
     outright and denies voice joins; the base's "public / open to
     everyone" line for the World is the whole claim, and it holds. */
  it("guests are look-only in the room server — no say, no voice", () => {
    const room = read(path.join(API_SRC, "lib", "world-room.ts"));
    expect(room).toMatch(/case "say":[\s\S]{0,400}?if \(peer\.guest\) return;/);
    expect(room).toMatch(/case "voice\.join":[\s\S]{0,300}?voice\.denied", reason: "guests"/);
    expect(worldEntry().access).toBe("public");
  });

  /* DELIBERATELY REVISITED — twice. The original pin said, in its own
     words: "If a district ever opens, this pin is the one that
     should be revisited — deliberately." The owner ordered all six
     districts built and open (Stack-100 order, Oct 22, 2026;
     overhaul items 31–36 delivered them), and the first revisit held
     the delivered reality in code — real layout rooms, open gates,
     the closed districtGate( kit gone — while the base still named
     none of them. Stack-28 (A6-K2) completes the revisit the audit
     ordered: naming the districts is now the owner-ordered,
     code-proven truth, so the honesty half of this pin is DELIBERATELY
     REVERSED — the world description (the page's own meta, moved
     first) must now CONTAIN all six district names and say their
     gates stand open, and it must still never say "closed". This is
     a correction toward newer truth, not a weakening: the code-truth
     half below is unchanged and still re-derived from the layout,
     the gates file, and the scene builder. The description also
     carries the A6-K7 minimum line — the palace desks mirror the
     site's Create / Brand / Promote / Money features. */
  it("the six districts are built and open, and the base now names them as open", () => {
    const layout = read(path.join(FE_SRC, "lib", "world", "palace-layout.ts"));
    for (const name of ["Stage Grounds", "Listening Gardens", "Creation Row", "The Ateliers", "The Boardwalk", "Creator Heights"]) {
      expect(layout).toContain(`name: "${name}"`);
    }

    const gatesFile = read(path.join(FE_SRC, "lib", "world", "district-gates.ts"));
    const openGates = [...gatesFile.matchAll(/\{\s*name: "([^"]+)", kind: "gate",[^\n]*open: true/g)].map((m) => m[1]);
    expect(openGates).toEqual([
      "STAGE GROUNDS",
      "THE BOARDWALK",
      "CREATION ROW",
      "THE ATELIERS",
      "LISTENING GARDENS",
      "CREATOR HEIGHTS",
    ]);
    expect(gatesFile).not.toMatch(/\{\s*name: "[^"]+", kind: "marker"/);

    const scene = read(path.join(FE_SRC, "lib", "world", "hall-scene.ts"));
    expect(scene).toContain("DISTRICT_THRESHOLDS");
    expect(scene).not.toContain("districtGate(");
    expect(scene).not.toContain("closed-for-now");

    const desc = worldEntry().description ?? "";
    // DELIBERATE REVERSAL (Stack-28, A6-K2 — see the comment above):
    // the description must now name every district it could not name
    // before, state that they stand open, and still never say closed.
    for (const name of ["Stage Grounds", "The Boardwalk", "Listening Gardens", "Creation Row", "The Ateliers", "Creator Heights"]) {
      expect(desc).toContain(name);
    }
    expect(desc).toContain("stand open");
    expect(desc.toLowerCase()).not.toContain("closed");
    // The K7 minimum line: the in-world desks mirror the site's desks.
    expect(desc).toContain("palace desks mirror the site's Create, Brand, Promote and Money features");
  });
});

/* Stack-28 — the KB integration pass (A6-K1/K3/K4/K5/K6). The grand
   push's surfaces were component-level (a desk docked into /create +
   /branding-kit, an admin panel inside world.tsx), so the generator's
   route/page coverage never saw them: the operator had no Wallpapers &
   Themes entry at all and no knowledge of World locks, while two
   regen-only corrections (the stale background-removal endpoint name,
   the unattributed social-publish prices) waited on the same pass.
   These pins hold the integrated truth. */
describe("operator knowledge — Stack-28 KB integration", () => {
  const API_SRC = path.resolve(HERE, "..", "..");
  const byId = (id: string) => OPERATOR_FEATURES.find((f) => f.id === id);

  /* A6-K1: the Wallpapers & Themes desk is a first-class docked entry.
     Its two registry prices ride the entry (branded render 0 / free,
     screensaver loop render 400); the clean (unbranded) render's 400
     is NOT a registry price for the endpoint — it is the override
     variant, carried on the render price and sourced from the server
     constant the rail charges. */
  it("wallpapers & themes is a first-class entry at the registry prices, clean render as the override variant", () => {
    const f = byId("wallpapers-desk")!;
    expect(f).toBeTruthy();
    expect(f.name).toBe("Wallpapers & Themes");
    expect(f.path).toBe("/create?panel=wallpapers");
    expect(f.description).toContain("King's Set starter pack");
    expect(f.description).toContain("Branded renders are free");
    const render = f.prices.find((p) => p.endpoint === "/api/wallpapers/render")!;
    expect(render).toBeTruthy();
    expect(render.vb).toBe(0);
    expect(render.source).toContain("credit-costs.ts");
    expect(render.variants).toEqual([
      expect.objectContaining({ feature: "Wallpaper Render (clean — unbranded)", vb: 400 }),
    ]);
    expect(render.variants![0]!.source).toContain("CLEAN_RENDER_COST");
    expect(render.variants![0]!.source).toContain("routes/wallpapers.ts");
    const saver = f.prices.find((p) => p.endpoint === "/api/wallpapers/screensaver-render")!;
    expect(saver).toBeTruthy();
    expect(saver.vb).toBe(400);
    // The facts the operator reads carry BOTH render prices, labelled:
    const facts = formatFeatureFacts(f);
    expect(facts).toContain("Wallpaper Render (branded — free) — free");
    expect(facts).toContain("Wallpaper Render (clean — unbranded) — 400 Visual Bucs");
    expect(facts).toContain("Screensaver Loop Render — 400 Visual Bucs");
    // And the desk is the first match for its own name:
    expect(findFeatures("wallpapers")[0]?.id).toBe("wallpapers-desk");
  });

  /* The screensaver constant cross-check is the SAFE pair (400 == 400).
     CLEAN_RENDER_COST must never be cross-checked against the render
     endpoint's 0-cost branded registry entry — that disagreement is
     the variant's whole point, recorded on the entry above. */
  it("the screensaver constant cross-checks, and the clean constant is not naively cross-checked", () => {
    const saver = OPERATOR_KB.crossChecks.find((c: any) => c.constant === "SCREENSAVER_RENDER_COST");
    expect(saver).toMatchObject({ endpoint: "/api/wallpapers/screensaver-render", serverValue: 400, registryValue: 400, agree: true });
    expect(OPERATOR_KB.crossChecks.some((c: any) => c.constant === "CLEAN_RENDER_COST")).toBe(false);
  });

  /* A6-K3: World locks — the grounding entry. Door lock vs person
     lock, the durations re-derived from the route file's own
     constants (default 60 minutes = 1 hour; max 7 * 24 * 60 = 7
     days), the "not a glitch" card, and all five lock rails on both
     the docked entry and the World entry itself. Locks are free —
     no price may ride either entry for them. */
  it("world locks are known: door vs person, 1 hour default, 7 days max, not a glitch", () => {
    const routes = read(path.join(API_SRC, "routes", "world.ts"));
    expect(routes).toMatch(/WORLD_LOCK_DEFAULT_MINUTES\s*=\s*60\b/);
    expect(routes).toMatch(/WORLD_LOCK_MAX_MINUTES\s*=\s*7\s*\*\s*24\s*\*\s*60\b/);

    const f = byId("world-locks")!;
    expect(f).toBeTruthy();
    expect(f.path).toBe("/world");
    expect(f.prices).toEqual([]);
    expect(f.endpoints).toEqual([
      "/api/world/locks",
      "/api/world/locks/door/lock",
      "/api/world/locks/door/unlock",
      "/api/world/locks/person/lock",
      "/api/world/locks/person/unlock",
    ]);
    expect(f.description).toContain("lock a room's door");
    expect(f.description).toContain("people inside stay");
    expect(f.description).toContain("lock one person out");
    expect(f.description).toContain("1 hour by default");
    expect(f.description).toContain("up to 7 days");
    expect(f.description).toContain("not a glitch");

    const world = OPERATOR_FEATURES.find((x) => x.path === "/world")!;
    for (const ep of f.endpoints) expect(world.endpoints).toContain(ep);
    expect(world.prices).toEqual([]);
  });

  /* A6-K4: the stale endpoint name is gone from every entry — the
     rail is /api/remove-video-background, and the editor family that
     calls it names the real one. */
  it("no entry lists the stale /api/video-background-removal endpoint", () => {
    for (const f of OPERATOR_FEATURES) {
      expect(f.endpoints, f.id).not.toContain("/api/video-background-removal");
      for (const p of f.prices) expect(p.endpoint).not.toBe("/api/video-background-removal");
    }
    const editor = byId("video-editor")!;
    expect(editor.endpoints).toContain("/api/remove-video-background");
  });

  /* Lane D A-03 remainder (Stack-200 editor lane): the video-editor
     entry must name its WHOLE export story — the priced rails behind
     nested sections (multi-ratio, lip-sync run-all, the Export
     Doctor's free rails) and the unpriced sub-steps (prepare + job
     poll). Before the generator's link tables landed, its endpoint
     list omitted every one of these, so the operator could not
     truthfully describe how the editor exports. */
  it("the video-editor entry names the full export rail set (A-03)", () => {
    const editor = byId("video-editor")!;
    for (const ep of [
      "/api/export-final-video",
      "/api/export-video-job/:param",
      "/api/export-quality",
      "/api/export-multi-ratio",
      "/api/prepare-export-files",
      "/api/lip-sync/run-all",
      "/api/export-doctor/export",
      "/api/export-doctor/export-all-captions",
      "/api/export-doctor/repair-clip",
    ]) {
      expect(editor.endpoints, ep).toContain(ep);
    }
    expect(editor.prices.find((p) => p.endpoint === "/api/export-multi-ratio")!.vb).toBe(100);
    expect(editor.prices.find((p) => p.endpoint === "/api/lip-sync/run-all")!.vb).toBe(300);
    expect(editor.prices.find((p) => p.endpoint === "/api/export-doctor/export")!.vb).toBe(0);
  });

  /* A6-K5: the social-publish rails (100 VB each in the registry)
     are attributed — the scheduler family that calls them carries
     all three — and the Templates Hub entry now carries the 250 VB
     template-apply price its gallery sibling always had. */
  it("social publish prices are attributed at 100 VB, and the templates hub carries the 250", () => {
    for (const ep of ["/api/social/facebook/publish", "/api/social/instagram/publish", "/api/social/tiktok/publish"]) {
      const carriers = OPERATOR_FEATURES.filter((f) => f.prices.some((p) => p.endpoint === ep && p.vb === 100));
      expect(carriers.length, ep).toBeGreaterThan(0);
    }
    const scheduler = byId("scheduler")!;
    for (const ep of ["/api/social/facebook/publish", "/api/social/instagram/publish", "/api/social/tiktok/publish"]) {
      expect(scheduler.prices.find((p) => p.endpoint === ep)!.vb).toBe(100);
    }
    const hub = byId("templates")!;
    expect(hub.prices.find((p) => p.endpoint === "/api/video-template/apply")!.vb).toBe(250);
  });

  /* A6-K6: the Create entry counts the lanes that exist — ten, since
     the Wallpapers panel joined — sourced from en.json, not the KB. */
  it("the create entry counts ten ways to start, not nine", () => {
    const create = byId("create")!;
    expect(create.description).toContain("ten ways to start");
    expect(create.description).not.toContain("nine ways");
    const en = JSON.parse(read(path.join(FE_SRC, "locales", "en.json")));
    expect(en.create.subtitle).toContain("ten ways to start");
  });
});
