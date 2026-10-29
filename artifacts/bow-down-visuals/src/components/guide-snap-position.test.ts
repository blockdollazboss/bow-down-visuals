/**
 * guide-snap-position.test.ts — stack500 small-fixes lane, fix 1;
 * extended by stack700/playlist-clip; corner budget composed at the
 * stack700 join (jackpot-banner × playlist-clip reconciliation).
 *
 * Oct 28 owner screenshot (vault-guards diagnosis §3): the Bow Down
 * Playlist widget (BowDownAIGuide) defaults to the TL snap — the same
 * top-left corner the shell's floating chrome owns, all of it ABOVE
 * the guide's z-9990. History of the seat:
 * - stack500 dropped TL +56 (y=76) to clear the theme-toggle row
 *   (top:16, 44 tall, bottom 60) — but the "Enter the World" pill
 *   hung lower (top-[4.25rem]=68, 46 tall, bottom 114, right edge
 *   ≈186) and still painted over the open panel's grip + header.
 * - stack700/playlist-clip generalised the model: every top snap
 *   routes through topSnapY() — a span reaching into the chrome
 *   column (x < 190) seats below the pill; wider spans keep the
 *   plain margin.
 * - stack700/jackpot-banner moved the chrome itself, to clear the
 *   ~57px jackpot banner band: the T1 row (language / toggle / pack
 *   picker) dropped to top:68 (floor 112) and the pill to
 *   top-[7.5rem]=120 (bottom 166).
 * - The join composed the two: the keep-out constants are measured
 *   from the MOVED chrome — pill bottom 166, seat y=174 (bottom + 8
 *   gap), which also clears the T1 floor (112). Neither lane's
 *   intermediate seat (122 against the old pill, TL +108 = y=128
 *   against the row alone) survives: 128 would sit under the moved
 *   pill, 122 under both.
 *
 * Pinned by source, the pattern mobile-touch-targets.test.ts
 * established (vitest runs in node, so components are pinned by
 * source), plus numeric extraction of the clearance constants so
 * the arithmetic itself is asserted, and a cross-pin on the pill
 * geometry in lib/world-entry.ts so the clearance cannot silently
 * go stale if the pill ever moves.
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

  it("no longer uses either lane's intermediate seat (toggle-row-only +56, or TL +108)", () => {
    expect(guideSource).not.toContain("y: m + 56");
    expect(guideSource).not.toContain("y: m + 108");
  });

  it("clearance arithmetic: the seat sits below the pill's bottom edge, with a gap", () => {
    const pillBottom = numConst(guideSource, "TOP_CHROME_PILL_BOTTOM");
    const clearY = numConst(guideSource, "TOP_CHROME_CLEAR_Y");
    const right = numConst(guideSource, "TOP_CHROME_RIGHT");
    expect(pillBottom).toBe(120 + 46); // pill top-[7.5rem] + its height
    expect(pillBottom).toBeGreaterThan(112); // lower than the T1 row's floor (top 68 + 44)
    expect(clearY).toBe(pillBottom + 8);
    expect(clearY).toBe(174);
    expect(clearY).toBeGreaterThan(112); // the seat clears the whole column, row included
    expect(right).toBeGreaterThanOrEqual(186); // pill right edge ≈186
  });

  it("cross-pin: the pill geometry the clearance is measured from still holds", () => {
    // If the pill moves or grows, this pin fails first — re-measure
    // TOP_CHROME_* in BowDownAIGuide.tsx against the new geometry.
    expect(worldEntrySource).toContain("fixed left-4 top-[7.5rem] z-[9998]");
    expect(worldEntrySource).toContain("px-4 py-3 text-sm");
    // The seat's pill-top addend must equal the pill's actual class:
    // top-[7.5rem] at 16px/rem = 120px.
    const rem = worldEntrySource.match(/top-\[(\d+(?:\.\d+)?)rem\]/);
    if (!rem) throw new Error("pill top-[…rem] class not found in world-entry.ts");
    expect(parseFloat(rem[1]) * 16).toBe(120);
    expect(numConst(guideSource, "TOP_CHROME_PILL_BOTTOM")).toBe(120 + 46);
  });

  it("leaves the mid and bottom snaps on their existing geometry (no overreach)", () => {
    expect(guideSource).toMatch(/RC:\s*\{\s*x: vw - w - m, y: cy\s*\}/);
    expect(guideSource).toMatch(/BR:\s*\{\s*x: vw - w - m, y: vh - h - m \}/);
    expect(guideSource).toMatch(/BC:\s*\{\s*x: cx,\s*y: vh - h - m \}/);
    expect(guideSource).toMatch(/BL:\s*\{\s*x: m,\s*y: vh - h - m \}/);
    expect(guideSource).toMatch(/LC:\s*\{\s*x: m,\s*y: cy\s*\}/);
  });
});
