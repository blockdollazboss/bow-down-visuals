import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Jackpot banner readability (stack700) — the banner is THEME-AWARE, not
 * data-dark-lock: it swaps art + ink per theme via useIsLightTheme().
 * The defect (owner, Oct 28, raised twice): the palace art sat at 40%
 * directly behind the pixel text with no scrim and no shadow — measured
 * on the shipped art, the light title fell to 2.84:1 worst-patch. These
 * pins hold the treatment: a base-ink gradient scrim between art and
 * content in BOTH themes, and the house pixel halo on title + sub.
 * Art and copy are pinned unchanged.
 */
const banner = readFileSync(
  new URL("../cheat-code-jackpot.tsx", import.meta.url),
  "utf8",
);

describe("jackpot banner readability treatment", () => {
  it("banner is theme-aware, never dark-locked", () => {
    expect(banner).toContain("useIsLightTheme");
    expect(banner).toContain('data-testid="jackpot-banner"');
    expect(banner).not.toContain("data-dark-lock");
  });

  it("scrim sits between the art and the content row", () => {
    const art = banner.indexOf("object-cover opacity-40");
    const scrim = banner.indexOf('data-testid="jackpot-banner-scrim"');
    const content = banner.indexOf("relative mx-auto flex max-w-7xl");
    expect(art).toBeGreaterThan(-1);
    expect(scrim).toBeGreaterThan(art);
    expect(content).toBeGreaterThan(scrim);
  });

  it("scrim grounds the text zone in each theme's own base ink", () => {
    /* Light: cream gradient, full at the text (left) edge, art keeps the right. */
    expect(banner).toContain(
      "bg-gradient-to-r from-[#F7F1E3] via-[#F7F1E3]/80 to-[#F7F1E3]/30",
    );
    /* Dark: black gradient, same shape. */
    expect(banner).toContain(
      "bg-gradient-to-r from-black via-black/75 to-black/30",
    );
  });

  it("pixel title and sub carry a halo in both themes", () => {
    expect(banner).toContain(
      "[text-shadow:0_1px_0_rgba(255,252,240,0.9),0_0_12px_rgba(247,241,227,0.65)]",
    );
    expect(banner).toContain(
      "[text-shadow:0_1px_2px_rgba(0,0,0,0.95),0_0_12px_rgba(0,0,0,0.6)]",
    );
    expect(banner).toContain("[text-shadow:0_1px_0_rgba(255,252,240,0.75)]");
    expect(banner).toContain("[text-shadow:0_1px_2px_rgba(0,0,0,0.85)]");
  });

  it("ink colors are unchanged — the fix is ground + halo, not new ink", () => {
    expect(banner).toContain('isLight ? "text-[#7A5A12]');
    expect(banner).toContain('"text-[#F5DE8E]');
    expect(banner).toContain("text-[#6B5310]");
    expect(banner).toContain("text-white/50");
  });

  it("art and copy are unchanged", () => {
    expect(banner).toContain("images/shark-king-final-banner-light-v1.webp");
    expect(banner).toContain("images/shark-king-final-banner-dark-v1.webp");
    expect(banner).toContain("object-cover opacity-40");
    expect(banner).toContain("CHEAT CODE JACKPOT");
    expect(banner).toContain("One code for the whole site");
    expect(banner).toContain("Enter code");
  });
});
