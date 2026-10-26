/**
 * Hero mic promo band — wiring pins (owner, 2026-10-25).
 *
 * The band must (1) live INSIDE the mic's pendulum so it swings WITH
 * the mic and never animates separately, (2) take its content only
 * from GET /api/mic-band/promos (data-driven — hard-coded promo copy
 * in the component fails this item), (3) ship a user-facing on/off,
 * and (4) exist in the light hero treatment as well as dark.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const hangingMic = read("./HangingMic.tsx");
const band = read("./MicPromoBand.tsx");

describe("mic promo band wiring", () => {
  it("renders the band inside the pendulum element (rides the mic's swing)", () => {
    const pendulumAt = hangingMic.indexOf('data-mic="pendulum"');
    const bandAt = hangingMic.indexOf("<MicPromoBand");
    expect(pendulumAt).toBeGreaterThan(-1);
    expect(bandAt).toBeGreaterThan(pendulumAt);
    expect(band).toContain('data-mic="promo-band"');
  });

  it("fetches promos from the aggregating endpoint and guards the payload", () => {
    expect(hangingMic).toContain('fetch("/api/mic-band/promos")');
    expect(hangingMic).toContain("parseMicBandPromos");
  });

  it("contains NO hard-coded promo copy in the band component", () => {
    for (const forbidden of [
      "Spotlight Takeover",
      "Loading Screen Takeover",
      "Jan 1, 2027",
      "10,000",
      "$1,000",
      "$2,500",
      "Grand opening",
    ]) {
      expect(band).not.toContain(forbidden);
      expect(hangingMic).not.toContain(forbidden);
    }
  });

  it("ships a user-facing on/off toggle persisted under the bdv key", () => {
    expect(hangingMic).toContain('data-mic="promo-toggle"');
    expect(hangingMic).toContain("aria-pressed={bandVisible}");
    expect(hangingMic).toContain("writeMicBandVisible");
    const lib = read("../lib/mic-band.ts");
    expect(lib).toContain('"bdv:mic-band-visible"');
  });

  it("the toggle is outside the pendulum so the control stays steady", () => {
    const toggleAt = hangingMic.indexOf('data-mic="promo-toggle"');
    const pendulumAt = hangingMic.indexOf('data-mic="pendulum"');
    expect(toggleAt).toBeGreaterThan(-1);
    expect(toggleAt).toBeLessThan(pendulumAt);
    expect(hangingMic).toContain("pointer-events-auto");
  });

  it("exists in both hero treatments (light ivory/bronze + dark black/gold)", () => {
    expect(band).toContain("isLight");
    expect(band).toContain("#FBF6E9"); // light ivory flag
    expect(band).toContain("#0D0701"); // dark flag
    expect(hangingMic).toContain("useIsLightTheme");
  });

  it("the band has no motion of its own — rotation is content-only", () => {
    expect(band).not.toContain("requestAnimationFrame");
    expect(band).not.toContain("transform: rotate");
    expect(band).toContain("MIC_BAND_ROTATE_MS");
  });
});
