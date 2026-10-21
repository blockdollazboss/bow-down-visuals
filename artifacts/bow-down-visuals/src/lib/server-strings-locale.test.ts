import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Server-strings locale path — the two pages whose copy is composed
 * on the server (Move Home step titles/blurbs + drafts; Catalog
 * Import honesty block, account notes, status/draft notes) pass the
 * creator's current language to the API on EVERY call, so the server
 * catalogs can answer in it. Pinned at the source:
 *   - both pages read i18n.language (react-i18next);
 *   - both append it as ?locale= inside their single call helper —
 *     the one door every API request goes through;
 *   - Move Home still renders the step title/blurb the API returns
 *     (server-owned), never a local copy.
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const moveHome = read("../pages/move-home.tsx");
const catalogImport = read("../pages/catalog-import.tsx");

describe("server-strings locale path — pages pass their language", () => {
  it("both pages read the current language from i18next", () => {
    for (const page of [moveHome, catalogImport]) {
      expect(page).toContain('import { useTranslation } from "react-i18next"');
      expect(page).toContain("const { i18n } = useTranslation()");
    }
  });

  it("both call helpers append ?locale= with the current language", () => {
    for (const page of [moveHome, catalogImport]) {
      expect(page).toContain("locale=${encodeURIComponent(i18n.language)}");
      expect(page).toContain('path.includes("?") ? "&" : "?"');
    }
  });

  it("Move Home still renders the server's step title + blurb", () => {
    expect(moveHome).toContain("{step.title}");
    expect(moveHome).toContain("{step.blurb}");
  });

  it("Catalog Import still renders the server's honesty block + notes", () => {
    expect(catalogImport).toContain("data.honesty.movesLine");
    expect(catalogImport).toContain("item.statusNote");
  });
});
