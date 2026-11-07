/**
 * remix-desk — the seam behind the Create Wing's native Remix
 * Trends desk (stack200 world parity lane B1, census item 2;
 * the Nov 2 census counted the feature ABSENT — the World's
 * only "remix" hits were the stems mixdown and an admin bench).
 *
 * Source of truth: pages/remix.tsx over data/trending-presets.ts.
 * The desk renders the page's OWN catalog module — imported,
 * never copied (the LibraryDesk precedent) — with the page's
 * own category filter and trend-score sort, so the feed in
 * the room is the feed on the page, row for row.
 *
 * THE HANDOFF, HONESTLY: the page's Remix button deep-links
 * into /video-editor with the preset's own remixParams. The
 * desk carries the preset through the panel-payload channel
 * into the Visual Vibes editor step-through, mirroring each
 * preset's OWN params — never a translation of them:
 *   { fx: slug }         → the library-preset kind (the
 *                          editor's fx reader applies it)
 *   { transition: slug } → the library-preset kind (the
 *                          editor's transition reader)
 *   { remix: slug }      → the remix-preset kind (the
 *                          editor's remix deep-link reader)
 * Every preset in the catalog carries exactly one param, so
 * the payload the desk sends reproduces the preset's 2D deep
 * link exactly — the tests pin that against the real catalog.
 *
 * No rails, no provider keys, no charge: the feed is a static
 * catalog and the handoff is a reference, not a purchase.
 * Preset names/descriptions are catalog DATA (the TREND_NICHES
 * precedent — data, not extracted copy); the desk's framing
 * copy lives in worldRemixDesk.*.
 */
import {
  TRENDING_PRESETS,
  type TrendingPreset,
} from "@/data/trending-presets";
import {
  libraryPresetPayload,
  remixPresetPayload,
  type PanelPayload,
} from "./panel-payload";
import type { EditorPresetSeed } from "./station-panel";

export const REMIX_EDITOR_STATION_ID = "visual-vibes-editor";

/** The page's own category list, in the page's order. */
export const REMIX_CATEGORIES = ["All", "Motion", "Style", "Transition", "Effect"] as const;
export type RemixCategory = (typeof REMIX_CATEGORIES)[number];

/** The page's feed logic, verbatim: filter by category, then
 *  sort by trend score, hottest first — on a copy, so the
 *  catalog module's own order is never mutated. */
export function remixPresetsFor(category: RemixCategory): TrendingPreset[] {
  const list =
    category === "All"
      ? [...TRENDING_PRESETS]
      : TRENDING_PRESETS.filter((p) => p.category === category);
  return list.sort((a, b) => b.trendScore - a.trendScore);
}

/** The one editor param a preset's deep link carries. Every
 *  catalog preset carries exactly one; a preset with none (or
 *  an unrecognized one) maps to null and its card offers no
 *  handoff rather than a guessed one. */
export function remixParamFor(
  preset: TrendingPreset,
): { param: "fx" | "transition" | "remix"; slug: string } | null {
  const params = preset.remixParams;
  if (typeof params["fx"] === "string" && params["fx"]) {
    return { param: "fx", slug: params["fx"] };
  }
  if (typeof params["transition"] === "string" && params["transition"]) {
    return { param: "transition", slug: params["transition"] };
  }
  if (typeof params["remix"] === "string" && params["remix"]) {
    return { param: "remix", slug: params["remix"] };
  }
  return null;
}

/** The panel payload the desk hands to the editor station —
 *  the preset's own deep-link param, carried by the channel
 *  kind that speaks it. */
export function remixPayloadFor(preset: TrendingPreset): PanelPayload | null {
  const mapped = remixParamFor(preset);
  if (!mapped) return null;
  if (mapped.param === "remix") return remixPresetPayload(mapped.slug);
  return libraryPresetPayload(mapped.param, mapped.slug);
}

/** The step-through seed the payload resolves to — the exact
 *  search the editor's own readers will consume. */
export function remixSeedFor(preset: TrendingPreset): EditorPresetSeed | null {
  const mapped = remixParamFor(preset);
  if (!mapped) return null;
  return { param: mapped.param, slug: mapped.slug };
}
