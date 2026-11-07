import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  COVER_ART_LAYOUTS,
  COVER_ART_TIERS,
  findCoverArtLayout,
  coverArtLayoutDiagram,
  type CoverArtLayout,
} from "./cover-art";

/* ─── Cover-art layout templates (manifest item 10) ───────────────────────
   The registry is the composition layer on top of styles + ratios. These
   pins keep every layout complete (a full placement spec, not a label
   with vibes), keep the picker honest (it renders THIS registry and the
   schematic derives from the same spec), and keep freeform freeform —
   no layout chosen means no `layout` field on the request, ever. */

const read = (rel: string) => readFileSync(path.resolve(import.meta.dirname, rel), "utf8");

describe("cover art layout registry", () => {
  it("exposes exactly the ten documented layouts, in picker order", () => {
    expect(COVER_ART_LAYOUTS.map((l) => l.key)).toEqual([
      "center-stage",
      "headline-top",
      "bottom-band",
      "split-frame",
      "corner-mark",
      "corner-seal",
      "pure-art",
      "tracklist-back",
      "frame-in-frame",
      "magazine-cover",
    ]);
  });

  it("keys are unique and url-safe", () => {
    const keys = COVER_ART_LAYOUTS.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9-]+$/);
  });

  it("every layout carries its full placement spec", () => {
    for (const l of COVER_ART_LAYOUTS) {
      expect(l.label.length).toBeGreaterThan(0);
      expect(l.blurb.length).toBeGreaterThan(0);
      expect(l.formats.length).toBeGreaterThan(0);
      for (const f of l.formats) expect(["single", "ep", "album"]).toContain(f);
      expect(["top", "center", "bottom", "corner", "side", "none"]).toContain(l.titleZone);
      expect(["hero", "large", "medium", "small", "none"]).toContain(l.titleScale);
      expect(["above-title", "below-title", "top", "bottom", "none"]).toContain(l.artistZone);
      expect(["medium", "small", "none"]).toContain(l.artistScale);
      expect(["left", "center", "right"]).toContain(l.align);
      expect(["full-bleed", "behind-title", "upper", "lower", "right"]).toContain(l.subjectZone);
      expect([null, "bottom-right"]).toContain(l.badgeZone);
    }
  });

  it("text zones and scales agree — a placed title is sized, a none title is unsized", () => {
    for (const l of COVER_ART_LAYOUTS) {
      expect(l.titleZone === "none").toBe(l.titleScale === "none");
      expect(l.artistZone === "none").toBe(l.artistScale === "none");
    }
  });

  it("pure-art is the one layout with no text at all", () => {
    const textless = COVER_ART_LAYOUTS.filter((l) => l.titleZone === "none");
    expect(textless.map((l) => l.key)).toEqual(["pure-art"]);
    const pure = findCoverArtLayout("pure-art")!;
    expect(pure.artistZone).toBe("none");
    expect(pure.subjectZone).toBe("full-bleed");
  });

  it("every release format has at least three layouts designed for it", () => {
    for (const f of ["single", "ep", "album"] as const) {
      expect(COVER_ART_LAYOUTS.filter((l) => l.formats.includes(f)).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("layouts never touch pricing — the tier table is unchanged", () => {
    expect(COVER_ART_TIERS.map((t) => [t.key, t.credits])).toEqual([
      ["standard", 200],
      ["premium", 300],
    ]);
  });
});

describe("findCoverArtLayout", () => {
  it("resolves every registered key", () => {
    for (const l of COVER_ART_LAYOUTS) expect(findCoverArtLayout(l.key)?.key).toBe(l.key);
  });

  it("returns undefined for freeform and unknown keys — no silent fallback", () => {
    expect(findCoverArtLayout("")).toBeUndefined();
    expect(findCoverArtLayout("spiral")).toBeUndefined();
  });
});

describe("coverArtLayoutDiagram", () => {
  const pct = (v: string) => parseFloat(v);

  it("pure-art draws subject only — no text bars, no badge", () => {
    const d = coverArtLayoutDiagram(findCoverArtLayout("pure-art")!);
    expect(d.title).toBeNull();
    expect(d.artist).toBeNull();
    expect(d.badge).toBeNull();
    expect(d.subject).toEqual({ top: "0%", left: "0%", width: "100%", height: "100%" });
  });

  it("center-stage centers a hero title with the artist beneath it", () => {
    const d = coverArtLayoutDiagram(findCoverArtLayout("center-stage")!);
    expect(d.title).not.toBeNull();
    expect(pct(d.title!.width)).toBe(84);
    expect(pct(d.title!.left)).toBe(8); // (100-84)/2 — centered
    expect(pct(d.title!.top)).toBe(42);
    expect(pct(d.artist!.top)).toBeGreaterThan(pct(d.title!.top));
  });

  it("bottom-band keeps the subject up top and the text low", () => {
    const d = coverArtLayoutDiagram(findCoverArtLayout("bottom-band")!);
    expect(pct(d.subject.top)).toBe(0);
    expect(pct(d.subject.height)).toBe(60);
    expect(pct(d.title!.top)).toBe(74);
    expect(pct(d.artist!.top)).toBeGreaterThan(pct(d.title!.top));
  });

  it("split-frame puts the subject on the right and the text clear of it", () => {
    const d = coverArtLayoutDiagram(findCoverArtLayout("split-frame")!);
    expect(pct(d.subject.left)).toBe(48);
    expect(pct(d.title!.left) + pct(d.title!.width)).toBeLessThanOrEqual(48);
  });

  it("corner-seal reserves the bottom-right badge corner, clear of the artist bar", () => {
    const d = coverArtLayoutDiagram(findCoverArtLayout("corner-seal")!);
    expect(d.badge).toEqual({ bottom: "5%", right: "5%" });
    expect(pct(d.artist!.left) + pct(d.artist!.width)).toBeLessThanOrEqual(81);
  });

  it("every bar of every layout stays inside the frame", () => {
    for (const l of COVER_ART_LAYOUTS) {
      const d = coverArtLayoutDiagram(l);
      for (const bar of [d.title, d.artist]) {
        if (!bar) continue;
        expect(pct(bar.top)).toBeGreaterThanOrEqual(0);
        expect(pct(bar.top)).toBeLessThan(100);
        expect(pct(bar.left)).toBeGreaterThanOrEqual(0);
        expect(pct(bar.left) + pct(bar.width)).toBeLessThanOrEqual(100);
      }
      expect(pct(d.subject.left) + pct(d.subject.width)).toBeLessThanOrEqual(100);
      expect(pct(d.subject.top) + pct(d.subject.height)).toBeLessThanOrEqual(100);
    }
  });
});

describe("cover-art page wiring", () => {
  const page = read("../pages/cover-art.tsx");

  it("the picker renders the registry — no page-local layout list", () => {
    expect(page).toContain("COVER_ART_LAYOUTS");
    expect(page).toContain("COVER_ART_LAYOUTS.map");
    expect(page).toContain("coverArtLayoutDiagram");
  });

  it("a chosen layout reaches the request payload — and only when chosen", () => {
    expect(page).toContain("...(layout ? { layout } : {})");
    expect(page).toContain('useState("")'); // freeform is the default state
  });

  it("the layout chosen is the one the rail validates (same key space)", () => {
    const l: CoverArtLayout = findCoverArtLayout("center-stage")!;
    expect(l.key).toBe("center-stage");
    expect(page).toContain("setLayout(l.key)");
  });
});
