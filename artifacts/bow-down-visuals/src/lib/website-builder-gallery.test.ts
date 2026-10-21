/**
 * Website Builder gallery — client logic.
 *
 * Pins the remix contract: the gallery only accepts complete real
 * builds (file map with index.html + styles.css, a known gallery key,
 * plain-language metadata), remix seeds a build from the template's
 * real files without aliasing the gallery data, and the starter brief
 * is extracted intact for the brief form.
 */
import { describe, it, expect } from "vitest";
import {
  parseGalleryTemplates,
  isValidGalleryTemplate,
  cloneTemplateFiles,
  starterBrief,
  type GalleryTemplate,
} from "./website-builder-gallery";

function fixture(overrides: Partial<GalleryTemplate> = {}): GalleryTemplate {
  return {
    id: "podcast-home",
    name: "Podcast Home",
    vertical: "podcast",
    verticalLabel: "For podcasters",
    bestFor: "Best for podcasters who want episodes and subscribe links in one place.",
    description: "Podcast homepage with episodes, subscribe row, and guest contact.",
    sections: ["Show hero", "Latest episodes", "Subscribe", "Be a guest"],
    brief: {
      description: "A complete podcast site from the template.",
      style: "Midnight tones, warm amber accents",
      colorScheme: "Midnight blue-black with amber",
    },
    files: {
      "index.html": "<!DOCTYPE html><html><head><link rel=\"stylesheet\" href=\"styles.css\"></head><body>[Your Podcast Name]<script src=\"script.js\"></script></body></html>",
      "about.html": "<!DOCTYPE html><html><body>About</body></html>",
      "styles.css": "body { background: #0d0f16; }",
      "script.js": "// nav",
      "README.md": "# Podcast Home",
    },
    ...overrides,
  };
}

describe("parseGalleryTemplates", () => {
  it("returns the valid templates from a well-formed payload", () => {
    const out = parseGalleryTemplates({ templates: [fixture()] });
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("podcast-home");
    expect(out[0]!.files["index.html"]).toContain("[Your Podcast Name]");
  });

  it("drops a template whose file map is not a complete build", () => {
    const noCss = fixture();
    delete (noCss.files as any)["styles.css"];
    const noIndex = fixture({ id: "artist-site" });
    delete (noIndex.files as any)["index.html"];
    const out = parseGalleryTemplates({ templates: [noCss, noIndex, fixture()] });
    expect(out.map((t) => t.id)).toEqual(["podcast-home"]);
  });

  it("drops unknown template keys and malformed entries", () => {
    const out = parseGalleryTemplates({
      templates: [
        fixture({ id: "not-a-template" }),
        null,
        "nope",
        { id: "artist-site" },
        fixture({ id: "streamer-hub", name: "Streamer Hub", vertical: "gaming" }),
      ],
    });
    expect(out.map((t) => t.id)).toEqual(["streamer-hub"]);
  });

  it("returns [] for non-gallery payloads", () => {
    expect(parseGalleryTemplates(null)).toEqual([]);
    expect(parseGalleryTemplates(undefined)).toEqual([]);
    expect(parseGalleryTemplates({})).toEqual([]);
    expect(parseGalleryTemplates({ templates: "nope" })).toEqual([]);
    expect(parseGalleryTemplates([fixture()])).toEqual([]);
  });
});

describe("isValidGalleryTemplate", () => {
  it("requires plain-language metadata and at least one section", () => {
    expect(isValidGalleryTemplate(fixture())).toBe(true);
    expect(isValidGalleryTemplate(fixture({ bestFor: "" }))).toBe(false);
    expect(isValidGalleryTemplate(fixture({ sections: [] }))).toBe(false);
    expect(isValidGalleryTemplate(fixture({ verticalLabel: " " }))).toBe(false);
  });

  it("allows empty style/colorScheme starter tokens but not an empty brief", () => {
    const t = fixture();
    t.brief = { description: "A real starter brief.", style: "", colorScheme: "" };
    expect(isValidGalleryTemplate(t)).toBe(true);
    t.brief = { description: "", style: "", colorScheme: "" };
    expect(isValidGalleryTemplate(t)).toBe(false);
  });
});

describe("remix seeding", () => {
  it("cloneTemplateFiles returns the template's real files as a fresh map", () => {
    const t = fixture();
    const files = cloneTemplateFiles(t);
    expect(files).toEqual(t.files);
    expect(files).not.toBe(t.files);
    files["index.html"] = "EDITED";
    expect(t.files["index.html"]).toContain("[Your Podcast Name]");
  });

  it("starterBrief returns the template's brief tokens as a copy", () => {
    const t = fixture();
    const brief = starterBrief(t);
    expect(brief).toEqual(t.brief);
    expect(brief).not.toBe(t.brief);
    brief.description = "changed";
    expect(t.brief.description).toBe("A complete podcast site from the template.");
  });
});
