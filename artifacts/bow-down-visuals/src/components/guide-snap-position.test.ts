/**
 * guide-snap-position.test.ts — stack500 small-fixes lane, fix 1.
 *
 * Oct 28 owner screenshot (vault-guards diagnosis §3): the Bow Down
 * Playlist widget (BowDownAIGuide) defaults to the TL snap at
 * { x: m, y: m } — the same top-left corner the floating theme toggles
 * own (fixed, z-[9999], 44 tall, ABOVE the guide's z-9990).
 * The open panel's header row sat underneath the toggle buttons and
 * its title was covered. The TL slot drops below the toggle row so the
 * panel (and the collapsed pill) clear it; every other snap keeps
 * the plain margin. Pinned by source, the pattern
 * mobile-touch-targets.test.ts established (vitest runs in node, so
 * components are pinned by source).
 *
 * Offset history: +56 when the toggle row sat at top:16 (floor 60,
 * TL y = 20 + 56 = 76 = floor + 16). Stack700 moved the row's default
 * to top:68 to clear the jackpot banner band (floor 112), so the TL
 * drop is now +108 (y = 128 = floor + 16 — the same clearance).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const guideSource = readFileSync(new URL("./BowDownAIGuide.tsx", import.meta.url), "utf8");

describe("BowDownAIGuide — TL snap clears the floating theme toggles", () => {
  it("drops the TL slot +108 below the plain margin", () => {
    expect(guideSource).toMatch(/TL:\s*\{\s*x: m,\s*y: m \+ 108\s*\}/);
  });

  it("leaves the other top snaps on the plain margin (no overreach)", () => {
    expect(guideSource).toMatch(/TC:\s*\{\s*x: cx,\s*y: m\s*\}/);
    expect(guideSource).toMatch(/TR:\s*\{\s*x: vw - w - m,\s*y: m\s*\}/);
  });
});
