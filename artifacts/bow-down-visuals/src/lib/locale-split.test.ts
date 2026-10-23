import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stack-28 #48 (A5-P2) — locale catalogs outside the entry path.
 * All non-en catalogs must be dynamic-import loaders only; en is the sole
 * static catalog, kept inline under the documented en-fallback requirement
 * in i18n.ts (synchronous fallbackLng + first-visit-is-English paint).
 */
const src = readFileSync(new URL("./i18n.ts", import.meta.url), "utf8");

describe("locale split (Stack-28 #48)", () => {
  it("only en is statically imported; the other nine are dynamic loaders", () => {
    const staticImports = src.match(/import \w+ from "\.\.\/locales\/\w+\.json"/g) ?? [];
    expect(staticImports).toEqual(['import en from "../locales/en.json"']);
    for (const lng of ["es", "fr", "pt", "de", "it", "hi", "ar", "ja", "ko"]) {
      expect(src).toContain(`import("../locales/${lng}.json")`);
    }
  });
  it("en fallback requirement is documented and en is the fallbackLng", () => {
    expect(src).toContain("EN-FALLBACK REQUIREMENT");
    expect(src).toContain('fallbackLng: "en"');
  });
});
