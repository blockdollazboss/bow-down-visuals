/**
 * guide-snap-position.test.ts — stack500 small-fixes lane, fix 1;
 * extended by stack700/playlist-clip.
 *
 * Oct 28 owner screenshot (vault-guards diagnosis §3): the Bow Down
 * Playlist widget (BowDownAIGuide) defaults to the TL snap — the same
 * top-left corner the shell's floating chrome owns. stack500 dropped
 * TL +56 (y=76) to clear the theme-toggle row (fixed, z-[9999],
 * top:16, 44 tall, bottom 60 — ABOVE the guide's z-9990), but the
 * "Enter the World" pill hangs lower: fixed left-4, top-[4.25rem]=68,
 * 46 tall, z-[9998], bottom 114, right edge ≈186. At y=76 the pill
 * still painted over the open panel's grip + header — the clip the
 * owner screenshotted at 16:17. TC/TR at phone widths reach into the
 * same column at the plain margin and clip the same way.
 *
 * The model now: every top snap routes through topSnapY() — a span
 * reaching into the chrome column (x < 190) seats at y=122 (pill
 * bottom 114 + 8 gap); wider spans keep the plain margin. Pinned by
 * source, the pattern mobile-touch-targets.test.ts established
 * (vitest runs in node, so components are pinned by source), plus
 * numeric extraction of the clearance constants so the arithmetic
 * itself is asserted, and a cross-pin on the pill geometry in
 * lib/world-entry.ts so the clearance cannot silently go stale if
 * the pill ever moves.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const guideSource = readFileSync(new URL("./BowDownAIGuide.tsx", import.meta.url), "utf8");
const worldEntrySource = readFileSync(new URL("../lib/world-entry.ts", import.meta.url), "utf8");

function numConst(source: string, name: string): number {
  const m = source.match(new RegExp(`const ${name}\\s*=\\s*([A-Z0-9_+\\s]+);`));
  if (!m) throw new Error(`constant ${name} not found`);
  return m[1]
    .split("+")
    .map((s) => s.trim())
    .map((tok) => (/^\d+$/.test(tok) ? parseInt(tok, 10) : numConst(source, tok)))
    .reduce((a, b) => a + b, 0);
}

describe("BowDownAIGuide — top snaps clear the full top-left chrome column", () => {
  it("routes all three top snaps through the chrome keep-out", () => {
    expect(guideSource).toMatch(/TL:\s*\{\s*x: m,\s*y: topSnapY\(m, m\)\s*\}/);
    expect(guideSource).toMatch(/TC:\s*\{\s*x: cx,\s*y: topSnapY\(cx, m\)\s*\}/);
    expect(guideSource).toMatch(/TR:\s*\{\s*x: vw - w - m,\s*y: topSnapY\(vw - w - m, m\)\s*\}/);
    expect(guideSource).toContain("return x < TOP_CHROME_RIGHT ? TOP_CHROME_CLEAR_Y : m;");
  });

  it("no longer uses the toggle-row-only +56 drop (it stopped 38px short of the pill)", () => {
    expect(guideSource).not.toContain("y: m + 56");
  });

  it("clearance arithmetic: the seat sits below the pill's bottom edge, with a gap", () => {
    const pillBottom = numConst(guideSource, "TOP_CHROME_PILL_BOTTOM");
    const clearY = numConst(guideSource, "TOP_CHROME_CLEAR_Y");
    const right = numConst(guideSource, "TOP_CHROME_RIGHT");
    expect(pillBottom).toBe(68 + 46); // pill top-[4.25rem] + its height
    expect(pillBottom).toBeGreaterThan(60); // lower than the toggle row's bottom
    expect(clearY).toBe(pillBottom + 8);
    expect(clearY).toBeGreaterThan(pillBottom);
    expect(right).toBeGreaterThanOrEqual(186); // pill right edge ≈186
  });

  it("the pill geometry the clearance is measured from still holds", () => {
    // If the pill moves or grows, this pin fails first — re-measure
    // TOP_CHROME_* in BowDownAIGuide.tsx against the new geometry.
    expect(worldEntrySource).toContain("fixed left-4 top-[4.25rem] z-[9998]");
    expect(worldEntrySource).toContain("px-4 py-3 text-sm");
  });

  it("leaves the mid and bottom snaps on their existing geometry (no overreach)", () => {
    expect(guideSource).toMatch(/RC:\s*\{\s*x: vw - w - m, y: cy\s*\}/);
    expect(guideSource).toMatch(/BR:\s*\{\s*x: vw - w - m, y: vh - h - m \}/);
    expect(guideSource).toMatch(/BC:\s*\{\s*x: cx,\s*y: vh - h - m \}/);
    expect(guideSource).toMatch(/BL:\s*\{\s*x: m,\s*y: vh - h - m \}/);
    expect(guideSource).toMatch(/LC:\s*\{\s*x: m,\s*y: cy\s*\}/);
  });
});
