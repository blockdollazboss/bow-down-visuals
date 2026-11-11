/**
 * SavedPanel (the library's saved/bookmarked items) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE LOAD's failure copy is the doctrine in one sentence:
 *   "Your saved items couldn't load just now — your
 *   bookmarks are safe, this page just couldn't reach
 *   them." A failed load says the DATA IS SAFE and the PAGE
 *   failed — it never reads as "you have nothing saved",
 *   and the loading state has its own testid branch ahead
 *   of the list.
 * - THE UNSAVE write throws on non-ok ("unsave failed")
 *   into its failure handling — an item is never shown
 *   removed on an unproven write.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SavedPanel.tsx");

describe("a failed load says the bookmarks are safe, never that there are none", () => {
  it("the failure copy and the unsave gate are pinned", () => {
    expect(src).toContain("Your saved items couldn't load just now — your bookmarks are safe, this page just couldn't reach them.");
    expect(src).toContain('data-testid="library-saved-loading"');
    expect(src).toContain('if (!res.ok) throw new Error("unsave failed");');
  });
});
