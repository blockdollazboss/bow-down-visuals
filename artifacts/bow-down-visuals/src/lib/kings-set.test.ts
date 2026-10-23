/**
 * kings-set.test.ts — the owner-approved house starter pack stays exactly
 * the set he approved: three subject-led King stills with the full logo
 * lockup whole at the approved emblem sizes, each with its 10-second
 * living loop, and every referenced file present in public/wallpapers/.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KINGS_SET } from "./kings-set";

describe("The King's Set — owner-approved starter pack", () => {
  it("is exactly three pieces: plaza + throne (phone) and stage (desktop)", () => {
    expect(KINGS_SET.map((p) => p.id)).toEqual(["plaza", "throne", "stage"]);
    expect(KINGS_SET.map((p) => p.presetKey)).toEqual([
      "phone-iphone",
      "phone-iphone",
      "desktop-fhd",
    ]);
    expect(KINGS_SET.map((p) => p.orientation)).toEqual([
      "portrait",
      "portrait",
      "landscape",
    ]);
  });

  it("stills carry the approved native dimensions", () => {
    for (const p of KINGS_SET) {
      if (p.orientation === "portrait") {
        expect([p.stillWidth, p.stillHeight]).toEqual([1152, 2048]);
      } else {
        expect([p.stillWidth, p.stillHeight]).toEqual([2048, 1152]);
      }
    }
  });

  it("every piece has a 10-second living loop in the matching orientation", () => {
    for (const p of KINGS_SET) {
      expect(p.loopSeconds).toBe(10);
      expect(p.loopUrl.endsWith(".mp4")).toBe(true);
      if (p.orientation === "portrait") {
        expect([p.loopWidth, p.loopHeight]).toEqual([704, 1248]);
      } else {
        expect([p.loopWidth, p.loopHeight]).toEqual([1248, 704]);
      }
    }
  });

  it("the baked-in logo lockup sits at the owner-approved emblem sizes", () => {
    expect(KINGS_SET.map((p) => p.logoWidthPct)).toEqual([34, 27, 13]);
  });

  it("every referenced file exists in public/wallpapers/", () => {
    for (const p of KINGS_SET) {
      for (const url of [p.stillUrl, p.loopUrl]) {
        const path = new URL(`../../public${url}`, import.meta.url);
        expect(existsSync(path), `${url} missing from public/`).toBe(true);
      }
    }
  });
});
