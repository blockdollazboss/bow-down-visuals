import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Bring Your Catalog Home (0198) — the page's honesty contract, pinned
 * at the source:
 *   - the moves/followers line renders from the API's honesty block —
 *     the page never claims an audience transfers, in any wording;
 *   - provider-blocked and link-only accounts render the server's plain
 *     reason and offer NO scan button (a fake door would be a lie);
 *   - approve is per-piece and nothing on the page publishes by itself:
 *     the only write doors are the catalog-import endpoints + the R2
 *     presign rail the uploads ride;
 *   - the route is classified locked (members-only) in ROUTE_MATRIX and
 *     mounted behind ProtectedRoute;
 *   - Move Home (the sibling) links here — the flow docks in the move,
 *     it is not a standalone island.
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("../pages/catalog-import.tsx");
const moveHome = read("../pages/move-home.tsx");
const app = read("../App.tsx");
const routes = read("./public-routes.ts");

describe("catalog-import page honesty", () => {
  it("renders the API honesty line and the free line; never claims followers move", () => {
    expect(page).toContain("data.honesty.movesLine");
    expect(page).toContain("Free — bringing your work home never costs credits.");
    const lower = page.toLowerCase();
    for (const claim of ["import your followers", "bring your followers", "transfer your audience", "move your followers", "followers come with"]) {
      expect(lower).not.toContain(claim);
    }
  });

  it("blocked and link-only accounts show the server's reason and no scan door", () => {
    expect(page).toContain("a.state !== \"ready\" && a.note");
    expect(page).toContain("Can't read a catalog");
    expect(page).toContain("Display link only");
    /* The scan button exists exactly once, inside the ready branch. */
    expect(page.match(/Scan my posts/g)).toHaveLength(1);
    expect(page).toContain("a.state === \"ready\"");
    /* Not-connected state routes to the real connect surface. */
    expect(page).toContain('href="/settings"');
    expect(page).toContain("Connect an account in Settings");
  });

  it("every status has a plain label, and blocked/failed items show their reason", () => {
    for (const s of ["listed", "fetching", "here", "ready", "approved", "blocked", "failed", "dismissed"]) {
      expect(page).toContain(`${s}:`);
    }
    expect(page).toContain("Platform won't hand it over");
    expect(page).toContain("item.statusNote");
  });

  it("the draft panel states provenance and every skipped part keeps its reason", () => {
    expect(page).toContain('item.draft.source === "ai"');
    expect(page).toContain("your facts only, nothing invented");
    expect(page).toContain("nothing was dressed up as more than it is");
    expect(page).toContain("n.state === \"skipped\" && n.reason");
  });

  it("the only write doors are the catalog-import rail and the R2 presign rail", () => {
    const calls = [...page.matchAll(/call\(\"(?:POST|PUT|PATCH|DELETE)\",\s*`?\"?([^\"`]+)/g)].map((m) => m[1]!);
    expect(calls.length).toBeGreaterThan(0);
    for (const path of calls) {
      expect(path.startsWith("/api/catalog-import") || path.startsWith("/api/r2/presign-upload")).toBe(true);
    }
    /* Uploads ride presigned PUTs straight to storage under the caller's
       own prefix — never through a scrape or a third-party fetcher. */
    expect(page).toContain("${user.id}/catalog-import/");
    /* No price anywhere: the only credits-shaped sentence on the page is
       the free line itself. */
    expect(page).not.toMatch(/\d[\d,]*\s*(VB|Visual Bucs)/);
    expect(page).not.toContain("Visual Bucs");
  });

  it("the route is locked in the matrix, protected in the app, and docked from Move Home", () => {
    expect(routes).toContain('{ path: "/catalog-import", disposition: "locked" }');
    expect(app).toContain('<Route path="/catalog-import"><ProtectedRoute><CatalogImport /></ProtectedRoute></Route>');
    expect(moveHome).toContain('href="/catalog-import"');
    expect(moveHome).toContain("Bring your catalog home");
  });
});
