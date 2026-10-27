import { describe, it, expect } from "vitest";
import { assessRasterOnlyDesign, buildBrandSheetSvg } from "./design-vector-export";
import type { BrandKit } from "./brand-kit";

function kitFull(): BrandKit {
  return {
    brandName: "Bow Down Visuals",
    vibe: "royal gold",
    industry: "Creator studio",
    colors: [
      { hex: "#C9A84C", name: "Royal Gold", role: "primary" },
      { hex: "#7C3AED", name: "Stage Violet", role: "secondary" },
      { hex: "#F5EFE0", name: "Marble Cream", role: "accent" },
      { hex: "#0B0B0B", name: "Palace Black", role: "background" },
    ],
    fonts: [{ heading: "Cinzel", body: "Manrope", usage: "Titles and everyday words" }],
    logoPrompt: "A crown over a shark fin",
    taglines: ["The content creator's cheat code", "Make it undeniable"],
    selectedTagline: "Make it undeniable",
    logoUrl: "https://cdn.example/my-logo.png",
    bioLines: [],
    pressFacts: [],
    generatedAt: null,
    updatedAt: null,
  };
}

function kitEmpty(): BrandKit {
  return {
    ...kitFull(),
    brandName: "  ",
    colors: [],
    fonts: [],
    taglines: [],
    selectedTagline: null,
    logoUrl: null,
  };
}

describe("buildBrandSheetSvg — valid SVG serialization", () => {
  it("produces a well-formed SVG document with matching viewBox", () => {
    const { svg } = buildBrandSheetSvg(kitFull());
    expect(svg).not.toBeNull();
    expect(svg!.startsWith(`<?xml version="1.0" encoding="UTF-8"?>`)).toBe(true);
    expect(svg).toContain(`<svg xmlns="http://www.w3.org/2000/svg" width="1200"`);
    expect(svg).toMatch(/viewBox="0 0 1200 \d+"/);
    expect(svg!.trimEnd().endsWith("</svg>")).toBe(true);
    /* balanced element counts — a cheap well-formedness pin:
       background + 4 swatches = 5 self-closed rects, texts all closed */
    expect((svg!.match(/<rect /g) ?? []).length).toBe(5);
    expect((svg!.match(/<text /g) ?? []).length).toBe((svg!.match(/<\/text>/g) ?? []).length);
  });

  it("contains NO raster machinery at all — no image element, no data URL, no href to the logo", () => {
    const { svg } = buildBrandSheetSvg(kitFull());
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("data:");
    expect(svg).not.toContain("my-logo.png");
    expect(svg).not.toContain("cdn.example");
  });
});

describe("buildBrandSheetSvg — text and shape fidelity", () => {
  it("carries the brand name and the SELECTED tagline as real text", () => {
    const { svg, included } = buildBrandSheetSvg(kitFull());
    expect(svg).toContain(">Bow Down Visuals</text>");
    expect(svg).toContain(">Make it undeniable</text>");
    expect(svg).not.toContain("cheat code</text>");
    expect(included).toEqual(["brand name", "tagline", "palette (4 colors)", "font pairings (1)"]);
  });

  it("falls back to the first tagline when none is selected", () => {
    const kit = { ...kitFull(), selectedTagline: null };
    const { svg } = buildBrandSheetSvg(kit);
    expect(svg).toContain(">The content creator's cheat code</text>");
  });

  it("serializes one swatch rect per palette color, filled with the kit's own hexes", () => {
    const { svg, vectorElementCount } = buildBrandSheetSvg(kitFull());
    const swatches = svg!.match(/data-part="swatch"/g) ?? [];
    expect(swatches.length).toBe(4);
    for (const hex of ["#C9A84C", "#7C3AED", "#F5EFE0", "#0B0B0B"]) {
      expect(svg).toContain(`fill="${hex}"`);
    }
    /* each swatch is labeled with name, role and hex as text */
    expect(svg).toContain(">Royal Gold</text>");
    expect(svg).toContain(">primary · #C9A84C</text>");
    expect(svg).toContain(">background · #0B0B0B</text>");
    /* background rect paints the background-role color */
    expect(svg).toContain('data-part="background" x="0" y="0" width="1200"');
    expect(vectorElementCount).toBeGreaterThan(4);
  });

  it("names the font pairings and sets samples in those fonts", () => {
    const { svg } = buildBrandSheetSvg(kitFull());
    expect(svg).toContain('font-family="Cinzel, serif"');
    expect(svg).toContain('font-family="Manrope, sans-serif"');
    expect(svg).toContain(">Cinzel</text>");
    expect(svg).toContain(">Titles and everyday words</text>");
  });

  it("escapes XML in brand words so the file stays valid", () => {
    const kit = { ...kitFull(), brandName: `Rock & "Roll" <Live>`, selectedTagline: "A & B > C" };
    const { svg } = buildBrandSheetSvg(kit);
    expect(svg).toContain(`>Rock &amp; "Roll" &lt;Live&gt;</text>`);
    expect(svg).toContain(">A &amp; B &gt; C</text>");
    expect(svg).not.toContain("<Live>");
  });

  it("leaves colors with invalid hexes out instead of painting a lie", () => {
    const kit = kitFull();
    kit.colors = [
      { hex: "#C9A84C", name: "Royal Gold", role: "primary" },
      { hex: "gold-ish", name: "Mystery", role: "accent" },
    ];
    const { svg, included } = buildBrandSheetSvg(kit);
    expect(svg!.match(/data-part="swatch"/g) ?? []).toHaveLength(1);
    expect(svg).not.toContain("Mystery");
    expect(svg).toContain("not a valid #RRGGBB");
    expect(included).toContain("palette (1 color)");
  });
});

describe("buildBrandSheetSvg — the logo is raster, excluded and named", () => {
  it("excludes the logo, names it, and offers the PNG raster option", () => {
    const { excludedRaster, rasterOptions } = buildBrandSheetSvg(kitFull());
    expect(excludedRaster).toHaveLength(1);
    expect(excludedRaster[0]!.name).toBe("Your logo");
    expect(excludedRaster[0]!.reason).toContain("raster");
    expect(rasterOptions).toEqual([
      expect.objectContaining({ format: "png", label: "Download logo (PNG)" }),
    ]);
  });

  it("states the exclusion inside the SVG itself (desc), never silently", () => {
    const { svg } = buildBrandSheetSvg(kitFull());
    expect(svg).toContain("The kit's logo is NOT in this file");
  });

  it("a kit with NO logo reports no exclusions and no raster options", () => {
    const kit = { ...kitFull(), logoUrl: null };
    const { excludedRaster, rasterOptions, svg } = buildBrandSheetSvg(kit);
    expect(excludedRaster).toEqual([]);
    expect(rasterOptions).toEqual([]);
    expect(svg).toContain("Every part of this sheet is a true vector");
  });
});

describe("buildBrandSheetSvg — honest refusal", () => {
  it("an empty kit yields no SVG and says why", () => {
    const { svg, reason, vectorElementCount } = buildBrandSheetSvg(kitEmpty());
    expect(svg).toBeNull();
    expect(reason).toContain("nothing an SVG can honestly carry");
    expect(vectorElementCount).toBe(0);
  });

  it("a logo-ONLY kit still refuses — a picture alone is not a brand sheet", () => {
    const kit = { ...kitEmpty(), logoUrl: "https://cdn.example/only-logo.png" };
    const { svg, reason, excludedRaster, rasterOptions } = buildBrandSheetSvg(kit);
    expect(svg).toBeNull();
    expect(reason).toContain("never as a fake vector");
    expect(excludedRaster).toHaveLength(1);
    expect(rasterOptions[0]).toEqual(expect.objectContaining({ format: "png" }));
  });
});

describe("assessRasterOnlyDesign — honest raster refusal", () => {
  it("refuses vector export for a generated logo, with the PNG option named", () => {
    const a = assessRasterOnlyDesign({ kindLabel: "logo" });
    expect(a.vectorAvailable).toBe(false);
    expect(a.reason).toContain("single picture (pixels)");
    expect(a.reason).toContain("would not make it a vector");
    expect(a.rasterOptions).toEqual([
      expect.objectContaining({ format: "png", label: "Download logo (PNG)" }),
    ]);
  });

  it("refuses vector export for a generated thumbnail the same way", () => {
    const a = assessRasterOnlyDesign({ kindLabel: "thumbnail" });
    expect(a.vectorAvailable).toBe(false);
    expect(a.reason).toContain("This thumbnail was generated");
    expect(a.rasterOptions[0]!.label).toBe("Download thumbnail (PNG)");
  });

  it("the refusal never contains anything resembling an SVG payload", () => {
    const a = assessRasterOnlyDesign({ kindLabel: "logo" });
    expect(JSON.stringify(a)).not.toContain("<svg");
    expect(JSON.stringify(a)).not.toContain("<image");
  });
});
