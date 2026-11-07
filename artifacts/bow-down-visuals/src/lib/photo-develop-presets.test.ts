/**
 * photo-develop-presets (Stack 100, A12) — the Photo editor's built-in
 * develop looks.
 *
 * The desk's only preset source was GET /api/photo-presets (user rows
 * only), so a brand-new creator met "No presets saved yet" and zero
 * starting points. These pins hold the fix:
 *  - the registry carries the named starter looks, complete recipes;
 *  - every recipe sets ONLY the editor's real develop parameters, each
 *    value inside the range clampDevelop enforces — no invented
 *    sliders, no out-of-range promises;
 *  - a look never reframes: crop stays null, rotateDeg stays 0;
 *  - applying a preset lands EXACTLY its parameter set on the layer
 *    (the same clamp/patch path a user-saved preset takes), and the
 *    applied look is exactly what the save flow would store — a
 *    built-in is a valid base for a member's own preset;
 *  - the editor shelf renders from the registry, above the member's
 *    own section, whose load/save/failure/empty machinery is intact.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PHOTO_DEVELOP_PRESETS, photoDevelopPresetById, developFromPreset, developMatchesPreset,
} from "./photo-develop-presets";
import {
  createPhotoCanvasDoc, makeImageLayer, addLayer, updateLayer,
  clampDevelop, developIsIdentity, recipeFromDevelop, DEFAULT_DEVELOP,
  type DevelopSettings,
} from "./photo-canvas";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(here, rel), "utf8");

const DEVELOP_KEYS = [
  "exposure", "brightness", "contrast", "temperature",
  "hue", "saturation", "lightness", "crop", "rotateDeg",
] as const;

/* The real ranges, from lib/photo-canvas clampDevelop + the editor's
   DEVELOP_SLIDERS table. A preset value outside these would be silently
   clamped at apply time — a promise the shelf didn't keep. */
const RANGES: Record<Exclude<keyof DevelopSettings, "crop">, [number, number]> = {
  exposure: [-2, 2],
  brightness: [-100, 100],
  contrast: [-100, 100],
  temperature: [-100, 100],
  hue: [-180, 180],
  saturation: [-100, 100],
  lightness: [-100, 100],
  rotateDeg: [-45, 45],
};

describe("photo develop presets — registry completeness", () => {
  it("carries the named starter looks, each fully specified", () => {
    for (const id of ["royal-gold", "black-gold-mono", "warm-film", "clean-bright", "deep-contrast"]) {
      expect(photoDevelopPresetById(id), id).not.toBeNull();
    }
    expect(PHOTO_DEVELOP_PRESETS.length).toBeGreaterThanOrEqual(5);
    const ids = PHOTO_DEVELOP_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
    for (const p of PHOTO_DEVELOP_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.blurb.length).toBeGreaterThan(0);
      expect(p.swatch).toHaveLength(2);
      for (const stop of p.swatch) expect(stop).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("no two built-ins are the same look wearing two names", () => {
    const seen = new Set<string>();
    for (const p of PHOTO_DEVELOP_PRESETS) {
      const sig = JSON.stringify(p.develop);
      expect(seen.has(sig), p.id).toBe(false);
      seen.add(sig);
    }
  });

  it("every look actually changes the photo — none is the identity recipe", () => {
    for (const p of PHOTO_DEVELOP_PRESETS) {
      expect(developIsIdentity(p.develop), p.id).toBe(false);
    }
  });
});

describe("photo develop presets — real parameters, real ranges", () => {
  it("each recipe is a complete DevelopSettings and nothing else", () => {
    for (const p of PHOTO_DEVELOP_PRESETS) {
      expect(Object.keys(p.develop).sort(), p.id).toEqual([...DEVELOP_KEYS].sort());
    }
  });

  it("every value sits inside the editor's real clamp range", () => {
    for (const p of PHOTO_DEVELOP_PRESETS) {
      for (const [key, [lo, hi]] of Object.entries(RANGES)) {
        const v = p.develop[key as keyof typeof RANGES];
        expect(v, `${p.id}.${key}`).toBeGreaterThanOrEqual(lo);
        expect(v, `${p.id}.${key}`).toBeLessThanOrEqual(hi);
      }
      /* Stored pre-clamped: running the editor's own clamp over a
         recipe changes nothing — so what the chip promises is what
         apply delivers, digit for digit. */
      expect(clampDevelop(p.develop), p.id).toEqual(p.develop);
    }
  });

  it("a look never reframes or rotates the member's photo", () => {
    for (const p of PHOTO_DEVELOP_PRESETS) {
      expect(p.develop.crop, p.id).toBeNull();
      expect(p.develop.rotateDeg, p.id).toBe(0);
    }
  });

  it("Black & Gold Mono keeps its promise: fully desaturated", () => {
    expect(photoDevelopPresetById("black-gold-mono")!.develop.saturation).toBe(-100);
  });
});

describe("photo develop presets — Stack 200 U2: the cool grade and the neutral mono", () => {
  it("the shelf carries 8 looks, the two new ones included", () => {
    expect(PHOTO_DEVELOP_PRESETS).toHaveLength(8);
    expect(photoDevelopPresetById("teal-shadow")).not.toBeNull();
    expect(photoDevelopPresetById("silver-noir")).not.toBeNull();
  });

  it("teal-shadow is the registry's cool grade — the coldest temperature on the shelf", () => {
    const teal = photoDevelopPresetById("teal-shadow")!;
    expect(teal.develop.temperature).toBeLessThan(0);
    for (const p of PHOTO_DEVELOP_PRESETS) {
      if (p.id !== "teal-shadow") {
        expect(teal.develop.temperature, `${p.id} is colder`).toBeLessThan(p.develop.temperature);
      }
    }
    /* a shadow grade, not a daylight one: it darkens, never lifts */
    expect(teal.develop.exposure).toBeLessThan(0);
    expect(teal.develop.lightness).toBeLessThan(0);
  });

  it("silver-noir is the NEUTRAL mono: fully desaturated, zero temperature, harder crush than Black & Gold", () => {
    const silver = photoDevelopPresetById("silver-noir")!;
    const gold = photoDevelopPresetById("black-gold-mono")!;
    expect(silver.develop.saturation).toBe(-100);
    /* the gold tone is Black & Gold Mono's whole identity — silver has none */
    expect(silver.develop.temperature).toBe(0);
    expect(gold.develop.temperature).toBeGreaterThan(0);
    expect(silver.develop.contrast).toBeGreaterThan(gold.develop.contrast);
    expect(silver.develop).not.toEqual(gold.develop);
  });
});

describe("photo develop presets — applying lands exactly the recipe", () => {
  it("developFromPreset returns the preset's parameter set, untouched", () => {
    for (const p of PHOTO_DEVELOP_PRESETS) {
      expect(developFromPreset(p)).toEqual(p.develop);
    }
  });

  it("the editor's apply patch lands exactly the preset on the layer", () => {
    for (const p of PHOTO_DEVELOP_PRESETS) {
      let doc = createPhotoCanvasDoc(1280, 720);
      const layer = makeImageLayer("https://x/photo.jpg", doc, "Photo");
      doc = addLayer(doc, layer);
      /* The exact operation PhotoCanvasEditor.applyBuiltinPreset runs. */
      const next = updateLayer(doc, layer.id, { develop: clampDevelop(p.develop) });
      const applied = next.layers.find((l) => l.id === layer.id);
      expect(applied?.kind === "image" && applied.develop, p.id).toEqual(p.develop);
      expect(applied?.kind === "image" && developMatchesPreset(applied.develop, p), p.id).toBe(true);
    }
  });

  it("the applied look is exactly what the save flow would store as the member's own", () => {
    for (const p of PHOTO_DEVELOP_PRESETS) {
      expect(recipeFromDevelop(p.develop).develop, p.id).toEqual(p.develop);
    }
  });

  it("a fresh photo does not already 'match' any built-in by accident", () => {
    for (const p of PHOTO_DEVELOP_PRESETS) {
      expect(developMatchesPreset(DEFAULT_DEVELOP, p), p.id).toBe(false);
    }
  });
});

describe("photo develop presets — the editor shelf wiring", () => {
  const editor = read("../components/photo/PhotoCanvasEditor.tsx");
  const registry = read("./photo-develop-presets.ts");

  it("the shelf renders from the registry, never a page-local copy", () => {
    expect(editor).toContain('from "@/lib/photo-develop-presets"');
    expect(editor).toContain("PHOTO_DEVELOP_PRESETS.map");
    expect(editor).toContain('data-testid="builtin-looks"');
    expect(editor).toContain("builtin-look-${p.id}");
    expect(editor).toContain("applyBuiltinPreset");
  });

  it("applying a built-in runs the same clamped patch as a saved preset", () => {
    expect(editor).toContain("patch(activeImage, { develop: clampDevelop(p.develop) }");
    expect(editor).toContain("patch(activeImage, { develop: clampDevelop(p.recipe.develop) }");
  });

  it("built-ins come first; the member's own section keeps its machinery", () => {
    const shelfAt = editor.indexOf('data-testid="builtin-looks"');
    const ownAt = editor.indexOf("Your saved presets");
    const emptyAt = editor.indexOf("No presets saved yet.");
    expect(shelfAt).toBeGreaterThan(-1);
    expect(ownAt).toBeGreaterThan(shelfAt);
    expect(emptyAt).toBeGreaterThan(ownAt);
    /* load + failure-with-retry + save all survive, untouched */
    expect(editor).toContain('confirmedFetch("/api/photo-presets"');
    expect(editor).toContain('data-testid="btn-retry-presets"');
    expect(editor).toContain("async function savePreset()");
    expect(editor).toContain("function applyPreset(p: PresetDto)");
  });

  it("the registry is pure local data — no fetch, no charge path", () => {
    expect(registry).not.toContain("fetch(");
    expect(registry).not.toContain('"/api/'); // quoted path = code; the header's prose mention is documentation
    expect(editor).not.toMatch(/builtin[^)]*confirmedFetch/);
  });
});
