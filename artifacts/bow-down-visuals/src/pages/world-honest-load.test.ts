/**
 * World (page-level loads) — honest load states (Stack 400 C-28).
 *
 * Scope: the World PAGE's own network loads only. The World desk
 * components' NativeStates wiring is census item C-29 (the
 * world-honesty lane), not this pin.
 *
 * The stage screen catalog — the page-level list a member picks a
 * watch-party video from — already carries the honest machine: a
 * failed load lands in the catalogFailed branch (with a retry wired
 * to the real loader) BEFORE the still-loading branch, and the
 * genuine empty line renders only for a loaded, empty catalog. The
 * rooms directory read is honest-by-keeping: a refresh failure
 * keeps the rooms already on screen instead of blanking the hall.
 * This file pins those shapes in source, like the sibling
 * honest-load pins (the FE suite runs in node, no DOM). The catalog
 * copy is hardcoded English in the page, so the literals are pinned
 * and there is no catalog block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./world.tsx");

describe("stage catalog — failure, loading, and genuine-empty stay distinct", () => {
  it("the failed branch renders before the still-loading branch and the empty line", () => {
    const failAt = page.indexOf("{catalog === null && catalogFailed ? (");
    const loadingAt = page.indexOf(") : catalog === null ? (", failAt);
    const emptyAt = page.indexOf(") : catalog.mine.length + catalog.public.length === 0 ? (", failAt);
    expect(failAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(failAt);
    expect(emptyAt).toBeGreaterThan(loadingAt);
  });

  it("the failure is worded as a failure, with a retry wired to the real loader", () => {
    expect(page).toContain("Couldn&apos;t load the catalog — your videos are safe, this just couldn&apos;t reach them.");
    expect(page).toContain('data-testid="btn-retry-world-catalog"');
    expect(page).toContain("onClick={() => void loadStageTools()}");
    expect(page).toContain("Nothing playable yet — publish a video on your profile or finish a stream with a replay, and it can play here.");
  });
});

describe("rooms directory — a failed refresh never blanks the hall", () => {
  it("the directory update keeps the rooms already on screen when the new read is empty", () => {
    expect(page).toContain("setDirectory((prev) => (prev.length > 0 ? prev : rooms))");
  });
});
