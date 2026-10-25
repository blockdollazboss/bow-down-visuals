/**
 * library-tab-param.test.ts — Stack-200 lane 2, board item 8.
 *
 * /library?tab=wishlist did not auto-select the Wishlist tab on first
 * load. Root cause: the page parsed its params from wouter's
 * useLocation(), which returns the pathname ONLY — the query string
 * never reached it, so ?tab= was always invisible and the page always
 * opened on Templates. The page now reads wouter's useSearch() (the
 * house pattern from settings.tsx / create.tsx) and resolves the tab
 * through libraryTabFromParams, on mount and on search changes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { libraryTabFromParams } from "../lib/library-tab";

const source = readFileSync(join(__dirname, "library.tsx"), "utf8");

describe("libraryTabFromParams — every tab is honored", () => {
  it("selects each valid ?tab= value", () => {
    for (const tab of ["templates", "presets", "fonts", "wishlist"] as const) {
      expect(libraryTabFromParams(new URLSearchParams(`tab=${tab}`))).toBe(tab);
    }
  });

  it("the reported case: ?tab=wishlist selects wishlist", () => {
    expect(libraryTabFromParams(new URLSearchParams("tab=wishlist"))).toBe("wishlist");
  });

  it("an invalid or absent tab asks for nothing (caller defaults to templates)", () => {
    expect(libraryTabFromParams(new URLSearchParams("tab=nope"))).toBeNull();
    expect(libraryTabFromParams(new URLSearchParams(""))).toBeNull();
  });

  it("the ?tool=video context hint still falls back to presets, and ?tab= beats it", () => {
    expect(libraryTabFromParams(new URLSearchParams("tool=video"))).toBe("presets");
    expect(libraryTabFromParams(new URLSearchParams("tool=video&tab=fonts"))).toBe("fonts");
  });
});

describe("library.tsx wiring", () => {
  it("reads the query string via useSearch, not the pathname-only useLocation", () => {
    expect(source).toContain('import { Link, useSearch } from "wouter";');
    expect(source).toContain("const search = useSearch();");
    expect(source).not.toContain("loc.split(\"?\")");
  });

  it("initializes the tab state from the params and re-applies on search changes", () => {
    expect(source).toContain('useState<LibraryTab>(() => libraryTabFromParams(params) ?? "templates")');
    expect(source).toContain("const wanted = libraryTabFromParams(params);");
    expect(source).toContain("if (wanted) setTab(wanted);");
  });
});
