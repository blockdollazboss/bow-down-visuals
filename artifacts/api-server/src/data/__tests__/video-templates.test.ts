/**
 * Tests for the video edit template library (src/data/video-templates.ts).
 *
 * The library is pure DATA interpreted by lib/video-template-engine.ts and
 * served by routes/generate/video-template.ts — there is no per-template
 * code, so every recipe must be schema-valid on its own and must build a
 * complete filtergraph through the engine's apply path. The key list is
 * pinned exactly: the frontend display metas (bow-down-visuals
 * src/data/video-templates.ts) mirror these keys, and its test pins the
 * same list, so the two files cannot drift apart silently.
 */
import { describe, it, expect } from "vitest";
import {
  VIDEO_TEMPLATES,
  TEMPLATE_TRANSITION_KEYS,
  getVideoTemplateRecipe,
  recipeOutputSeconds,
  type VideoTemplateRecipe,
} from "../video-templates";
import { buildFiltergraph, type SlotPlan } from "../../lib/video-template-engine";

/* The full library, in file order. Pinning the set (not just a count)
   keeps the server recipes and the frontend display metas in lockstep. */
const EXPECTED_KEYS = [
  "photo-dump-montage",
  "lyric-sync-cut",
  "product-promo-punch",
  "before-after-reveal",
  "travel-recap",
  "talking-head-polish",
  "hype-trailer",
  "podcast-highlight",
  "launch-announcement",
  "product-showcase",
  "sale-announcement",
  "seasonal-drop",
  "testimonial-spotlight",
  "quote-card",
  "event-recap",
  "tutorial-steps",
  "podcast-clip-vertical",
  "lyric-video-landscape",
];

const ASPECTS = ["9:16", "16:9", "1:1"];
const SLOT_KINDS = ["video", "photo", "any"];
const POSITIONS = ["top", "center", "bottom"];
const SIZES = ["sm", "md", "lg"];
const COLORS = ["white", "gold"];

function slotStarts(recipe: VideoTemplateRecipe): number[] {
  const starts: number[] = [];
  let acc = 0;
  for (let i = 0; i < recipe.slots.length; i++) {
    starts.push(acc);
    if (i < recipe.slots.length - 1) acc += recipe.slots[i]!.durationSec - recipe.transitionDurationSec;
  }
  return starts;
}

describe("video template library", () => {
  it("holds the full pinned library (18 recipes)", () => {
    expect(VIDEO_TEMPLATES.length).toBeGreaterThanOrEqual(16);
    expect(VIDEO_TEMPLATES.map((t) => t.key)).toEqual(EXPECTED_KEYS);
  });

  it("uses unique, kebab-case keys", () => {
    const keys = VIDEO_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key, `key ${key}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("round-trips every key through getVideoTemplateRecipe", () => {
    for (const recipe of VIDEO_TEMPLATES) {
      expect(getVideoTemplateRecipe(recipe.key)).toBe(recipe);
    }
    expect(getVideoTemplateRecipe("no-such-template")).toBeNull();
  });
});

describe("every recipe is schema-valid", () => {
  for (const recipe of VIDEO_TEMPLATES) {
    describe(recipe.key, () => {
      it("has complete display fields", () => {
        expect(recipe.name.trim().length).toBeGreaterThan(0);
        expect(recipe.tagline.trim().length).toBeGreaterThan(0);
        expect(recipe.description.trim().length).toBeGreaterThan(0);
        expect(ASPECTS).toContain(recipe.aspect);
        expect(["keep", "bed"]).toContain(recipe.audioMode);
        expect(["none", "luxury-gold"]).toContain(recipe.grade);
      });

      it("targets roughly the sum of its slots", () => {
        const sum = recipe.slots.reduce((s, slot) => s + slot.durationSec, 0);
        expect(recipe.durationTargetSec).toBeGreaterThan(0);
        expect(Math.abs(recipe.durationTargetSec - sum)).toBeLessThanOrEqual(2);
      });

      it("has 1–16 well-formed slots with unique keys", () => {
        expect(recipe.slots.length).toBeGreaterThanOrEqual(1);
        expect(recipe.slots.length).toBeLessThanOrEqual(16);
        const slotKeys = recipe.slots.map((s) => s.key);
        expect(new Set(slotKeys).size).toBe(slotKeys.length);
        for (const slot of recipe.slots) {
          expect(slot.label.trim().length).toBeGreaterThan(0);
          expect(SLOT_KINDS).toContain(slot.kind);
          expect(slot.durationSec).toBeGreaterThan(0);
        }
      });

      it("uses only real transition keys, sized to fit their junctions", () => {
        for (const key of recipe.transitions) {
          expect(TEMPLATE_TRANSITION_KEYS).toContain(key);
        }
        if (recipe.slots.length === 1) {
          expect(recipe.transitions).toEqual([]);
          expect(recipe.transitionDurationSec).toBe(0);
        } else {
          expect(recipe.transitionDurationSec).toBeGreaterThan(0);
          /* The engine clamps each junction to half the shorter neighbour
             (minus 0.05) — a recipe whose stated duration fits every
             junction renders exactly its stated timings. */
          for (let j = 0; j < recipe.slots.length - 1; j++) {
            const fit = Math.min(recipe.slots[j]!.durationSec, recipe.slots[j + 1]!.durationSec) / 2 - 0.05;
            expect(recipe.transitionDurationSec, `junction ${j}`).toBeLessThanOrEqual(fit + 1e-9);
          }
        }
      });

      it("has overlays that land inside the rendered timeline", () => {
        expect(recipe.overlays.length).toBeLessThanOrEqual(12);
        const starts = slotStarts(recipe);
        const output = recipeOutputSeconds(recipe);
        for (const ov of recipe.overlays) {
          expect(ov.text.trim().length).toBeGreaterThan(0);
          expect(ov.text.length).toBeLessThanOrEqual(140);
          expect(ov.slotIndex).toBeGreaterThanOrEqual(0);
          expect(ov.slotIndex).toBeLessThan(recipe.slots.length);
          expect(POSITIONS).toContain(ov.position);
          expect(SIZES).toContain(ov.size);
          expect(COLORS).toContain(ov.color);
          expect(ov.startSec).toBeGreaterThanOrEqual(0);
          expect(ov.durationSec).toBeGreaterThan(0);
          const end = starts[ov.slotIndex]! + ov.startSec + ov.durationSec;
          expect(end, `overlay "${ov.text}"`).toBeLessThanOrEqual(output + 0.06);
        }
      });

      it("produces a sane output length", () => {
        expect(recipeOutputSeconds(recipe)).toBeGreaterThanOrEqual(4);
      });
    });
  }
});

describe("every recipe applies through the engine", () => {
  for (const recipe of VIDEO_TEMPLATES) {
    it(`${recipe.key} builds a complete filtergraph from a slot fixture`, () => {
      const plans: SlotPlan[] = recipe.slots.map((slot, i) => ({
        inputIndex: i,
        isImage: slot.kind === "photo",
        duration: slot.durationSec,
        srcDuration: slot.kind === "photo" ? null : slot.durationSec,
        hasAudio: slot.kind === "video",
        label: slot.label,
      }));
      const overlayTexts = recipe.overlays.map((o) => o.text);

      const plain = buildFiltergraph(recipe, plans, overlayTexts, false);
      expect(plain.totalSec).toBeCloseTo(recipeOutputSeconds(recipe), 1);
      expect(plain.filter).not.toMatch(/NaN|undefined/);
      const xfades = plain.filter.match(/xfade=transition=/g) ?? [];
      expect(xfades.length).toBe(Math.max(0, recipe.slots.length - 1));
      expect(plain.maps).toContain("-map");

      /* The optional music bed must mix cleanly over every recipe too. */
      const bedded = buildFiltergraph(recipe, plans, overlayTexts, true, undefined, recipe.slots.length);
      expect(bedded.filter).toContain("amix");
      expect(bedded.filter).not.toMatch(/NaN|undefined/);
    });
  }
});
