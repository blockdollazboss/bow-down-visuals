#!/usr/bin/env node
/**
 * Generates the 4 built-in house LUTs for the LUT Import feature
 * (teal-orange, moody, vibrant, noir) as .cube files + presets.json
 * with UI swatches.
 *
 * Output: artifacts/api-server/data/luts/*.cube + presets.json
 * Run: node scripts/generate-house-luts.mjs
 */
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "artifacts", "api-server", "data", "luts");
mkdirSync(OUT_DIR, { recursive: true });

const SIZE = 32; // 32^3 lattice

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const lerp = (a, b, t) => a + (b - a) * t;
const toHex = (r, g, b) =>
  "#" +
  [r, g, b]
    .map((x) => Math.round(clamp01(x) * 255).toString(16).padStart(2, "0"))
    .join("");

/** [r,g,b] -> [r,g,b], inputs/outputs in 0..1 */
const TRANSFORMS = {
  "teal-orange": {
    name: "Teal & Orange",
    description: "Hollywood blockbuster grade — warm skin tones, teal shadows",
    transform: ([r, g, b]) => {
      const l = luma(r, g, b);
      const warm = Math.pow(l, 2); // highlights
      const cool = Math.pow(1 - l, 2); // shadows
      return [
        r + 0.07 * warm - 0.05 * cool,
        g - 0.02 * cool + 0.01 * warm,
        b + 0.09 * cool - 0.02 * warm,
      ];
    },
  },
  moody: {
    name: "Moody",
    description: "Faded film noir — lifted blacks, muted color, crushed highlights",
    transform: ([r, g, b]) => {
      const l = luma(r, g, b);
      return [
        lerp(l, r, 0.55) * 0.94 + 0.035,
        lerp(l, g, 0.55) * 0.94 + 0.035,
        lerp(l, b, 0.55) * 0.94 + 0.035,
      ];
    },
  },
  vibrant: {
    name: "Vibrant",
    description: "Punchy saturation and contrast — pops on every feed",
    transform: ([r, g, b]) => {
      const l = luma(r, g, b);
      const sat = ([x]) => lerp(l, x, 1.5);
      const scurve = (x) => 0.5 + (x - 0.5) * 1.14;
      return [sat([r]), sat([g]), sat([b])].map(scurve);
    },
  },
  noir: {
    name: "Noir",
    description: "High-contrast black & white — pure drama",
    transform: ([r, g, b]) => {
      const l = clamp01(0.5 + (luma(r, g, b) - 0.5) * 1.32 - 0.015);
      return [l, l, l];
    },
  },
};

const SWATCH_SAMPLES = [
  [1, 0, 0], [1, 0.5, 0], [1, 1, 0], [0, 1, 0],
  [0, 1, 1], [0, 0, 1], [1, 0, 1], [0.55, 0.42, 0.3],
];

const presets = [];

for (const [id, def] of Object.entries(TRANSFORMS)) {
  const lines = [];
  lines.push(`TITLE "${def.name} — Bow Down Visuals House LUT"`);
  lines.push(`LUT_3D_SIZE ${SIZE}`);
  lines.push(`DOMAIN_MIN 0.0 0.0 0.0`);
  lines.push(`DOMAIN_MAX 1.0 1.0 1.0`);
  lines.push(``);
  // .cube order: red varies fastest, then green, then blue.
  for (let bi = 0; bi < SIZE; bi++) {
    for (let gi = 0; gi < SIZE; gi++) {
      for (let ri = 0; ri < SIZE; ri++) {
        const r = ri / (SIZE - 1);
        const g = gi / (SIZE - 1);
        const b = bi / (SIZE - 1);
        const [or_, og, ob] = def.transform([r, g, b]);
        lines.push(
          `${clamp01(or_).toFixed(6)} ${clamp01(og).toFixed(6)} ${clamp01(ob).toFixed(6)}`
        );
      }
    }
  }
  const fileName = `${id}.cube`;
  writeFileSync(join(OUT_DIR, fileName), lines.join("\n") + "\n");
  presets.push({
    id,
    name: def.name,
    description: def.description,
    file: `/api/lut/presets/${fileName}`,
    swatches: SWATCH_SAMPLES.map((s) => {
      const [r, g, b] = def.transform(s);
      return toHex(r, g, b);
    }),
  });
  console.log(`wrote ${fileName} (${lines.length} lines)`);
}

writeFileSync(join(OUT_DIR, "presets.json"), JSON.stringify({ presets }, null, 2) + "\n");
console.log("wrote presets.json");
