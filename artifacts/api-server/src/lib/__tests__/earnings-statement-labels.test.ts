import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EARNINGS_STATEMENT_LINES } from "../earnings-statement-labels";

/* ── The PDF's labels ARE the statement's labels ─────────────────────
 * The canonical list lives in the web app: STATEMENT_SOURCE_LINES in
 * artifacts/bow-down-visuals/src/lib/earnings-statement.ts, whose
 * strings are the earnings.stmt* values of the web app's en catalog
 * (statementStringsFrom names the key for each source). The PDF
 * route is server-side in a different package and cannot import the
 * web app's module, so lib/earnings-statement-labels.ts MIRRORS the
 * strings — and this pin reads BOTH canonical sources from the repo
 * tree and fails if the mirror drifts a single character, or if a
 * source is added on one side without the other. */

const repoFile = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../../../../${rel}`, import.meta.url)), "utf8");

/** key → catalog key, exactly as the web app's statementStringsFrom
 *  names them (shopSales reads the FULLER card-matching label,
 *  earnings.stmtShopSalesFull — never the short stmtShopSales). */
const CATALOG_KEY_BY_SOURCE: Record<string, string> = {
  storeSales: "stmtStoreSales",
  digitalSales: "stmtDigitalSales",
  shopSales: "stmtShopSalesFull",
  beats: "stmtBeats",
  memberships: "stmtMemberships",
  shoutouts: "stmtShoutouts",
  tipJar: "stmtTipJar",
  brandDeals: "stmtBrandDeals",
  ugcBriefs: "stmtUgcBriefs",
  bookings: "stmtBookings",
  royalties: "stmtRoyalties",
};

describe("earnings statement labels — the PDF mirror cannot drift from the statement", () => {
  const en = JSON.parse(
    repoFile("artifacts/bow-down-visuals/src/locales/en.json"),
  ) as { earnings: Record<string, string> };

  it("every mirrored label equals the en catalog's statement string for its source", () => {
    expect(EARNINGS_STATEMENT_LINES).toHaveLength(11);
    for (const { key, label } of EARNINGS_STATEMENT_LINES) {
      const catalogKey = CATALOG_KEY_BY_SOURCE[key];
      expect(catalogKey, `catalog key mapped for ${key}`).toBeTruthy();
      expect(en.earnings[catalogKey!], `${key} vs earnings.${catalogKey}`).toBe(label);
    }
    /* And the mapping covers exactly the canonical sources — a source
       added to the statement without a catalog key (or vice versa)
       fails here instead of drifting silently. */
    expect(Object.keys(CATALOG_KEY_BY_SOURCE).sort()).toEqual(
      EARNINGS_STATEMENT_LINES.map((l) => l.key).sort(),
    );
  });

  it("every mirrored label equals the web app statement module's own line list, in order", () => {
    const feModule = repoFile("artifacts/bow-down-visuals/src/lib/earnings-statement.ts");
    const block = feModule.match(/STATEMENT_SOURCE_LINES[^=]*=\s*\[([\s\S]*?)\];/);
    expect(block, "STATEMENT_SOURCE_LINES block found in the web app module").toBeTruthy();
    const pairs = [...block![1].matchAll(/\{\s*key:\s*"([^"]+)",\s*label:\s*"([^"]+)"\s*\}/g)].map(
      (m) => ({ key: m[1], label: m[2] }),
    );
    expect(pairs).toHaveLength(11);
    expect(EARNINGS_STATEMENT_LINES).toEqual(pairs);
  });

  it("the PDF route renders the mirrored list — no hand-written label list remains in trust.ts", () => {
    const route = repoFile("artifacts/api-server/src/routes/trust.ts");
    expect(route).toContain("EARNINGS_STATEMENT_LINES");
    /* The pre-single-source short labels, as quoted PDF line strings,
       are gone from the route (prose mentions in comments are fine —
       these patterns are the quoted literals the route used to print). */
    for (const stale of ['"Beat licenses"', '"Shop sales",', '"Brand deals",', '"Performance bookings",']) {
      expect(route).not.toContain(stale);
    }
  });
});
