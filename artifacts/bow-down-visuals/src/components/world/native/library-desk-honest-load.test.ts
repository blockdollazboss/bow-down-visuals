/**
 * LibraryDesk (the in-World library / wishlist desk) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE WISHLIST LOAD throws on non-ok and parses through
 *   its response validator (wishlistOfResponse) before any
 *   entry renders — the desk never paints a wishlist from
 *   an error body.
 * - THE REMOVE write throws on non-ok ("remove failed")
 *   into its own catch — an entry is never shown removed on
 *   an unproven delete; the row leaves the desk only from
 *   the proven response path.
 * - THE LOADING line is its own render (libWishLoading),
 *   ahead of any list or empty state.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LibraryDesk.tsx");

describe("the wishlist loads proven; a remove claims only on ok", () => {
  it("the load throw, the parser, and the remove throw are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error("load failed");');
    expect(src).toContain("const parsed = wishlistOfResponse(await res.json().catch(() => ({})));");
    expect(src).toContain('if (!res.ok) throw new Error("remove failed");');
  });
});
