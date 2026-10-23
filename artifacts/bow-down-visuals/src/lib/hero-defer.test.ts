import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stack-28 #47 (A5-P1) — hero media loads AFTER first paint/visibility.
 * Load timing only: hero layer stack in home.tsx is owner-protected and
 * must remain fog z-[2], set z-20, King z-[4], mic z-[6], copy z-10.
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const hero = read("../components/CinematicHero.tsx");
const fog = read("../components/fog-lab/FogCanvas.tsx");
const home = read("../pages/home.tsx");
const html = read("../../index.html");

describe("hero deferral (Stack-28 #47)", () => {
  it("sprite sheets load via deferAfterFirstPaint, not at mount", () => {
    expect(hero).toContain("deferAfterFirstPaint(slot");
    expect(html).not.toContain("hero-bow-sheet-0.webp");
    expect(html).toContain("hero-bow-poster.webp");
  });
  it("fog textures load via deferAfterFirstPaint", () => {
    expect(fog).toContain("deferAfterFirstPaint(box");
  });
  it("protected hero layer stack is untouched", () => {
    expect(home).toContain('className="absolute inset-x-0 top-0 z-[2] h-[92%]"');
    expect(home).toContain("relative z-[4] flex min-w-0 justify-center");
    expect(home).toContain('className="absolute inset-x-0 top-0 z-[6] h-full"');
    expect(home).toContain("relative z-10 min-w-0");
    expect(home).toContain("z-[2]");
  });
});
