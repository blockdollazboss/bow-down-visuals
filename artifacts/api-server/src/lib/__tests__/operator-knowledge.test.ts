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
});
