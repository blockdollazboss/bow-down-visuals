/**
 * kings-set.test.ts — the owner-approved house starter pack stays exactly
 * the set he approved: three subject-led King stills with the full logo
 * lockup whole at the approved emblem sizes, each with its 10-second
 * living loop, and every referenced file present in public/wallpapers/.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KINGS_SET, absoluteKingsSetUrl } from "./kings-set";

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

/* Stack-28 item 13 — the set's paths are site-relative, and both
   wallpaper rails reject non-http(s) URLs with 400 before any render
   (routes/wallpapers.ts httpUrlSchema). The desk absolutifies at
   selection time via absoluteKingsSetUrl; these pins hold the helper
   to producing exactly the desk-shaped absolute URLs the API suite
   proves the rail schemas accept. */
describe("absoluteKingsSetUrl — desk-shaped URLs for the http(s)-only rails", () => {
  const ORIGIN = "https://bowdownvisuals.com";

  it("absolutifies every still and loop against the page origin", () => {
    for (const p of KINGS_SET) {
      expect(absoluteKingsSetUrl(p.stillUrl, ORIGIN)).toBe(`${ORIGIN}${p.stillUrl}`);
      expect(absoluteKingsSetUrl(p.loopUrl, ORIGIN)).toBe(`${ORIGIN}${p.loopUrl}`);
    }
  });

  it("the results parse as http(s) URLs with the set's exact paths", () => {
    for (const p of KINGS_SET) {
      for (const raw of [p.stillUrl, p.loopUrl]) {
        const abs = absoluteKingsSetUrl(raw, ORIGIN);
        const u = new URL(abs);
        expect(u.protocol).toBe("https:");
        expect(u.pathname).toBe(raw);
      }
    }
  });

  it("leaves an already-absolute URL untouched and tolerates a trailing-slash origin", () => {
    expect(absoluteKingsSetUrl("https://cdn.example/x.webp", ORIGIN)).toBe("https://cdn.example/x.webp");
    expect(absoluteKingsSetUrl("/wallpapers/a.webp", `${ORIGIN}/`)).toBe(`${ORIGIN}/wallpapers/a.webp`);
  });
});
