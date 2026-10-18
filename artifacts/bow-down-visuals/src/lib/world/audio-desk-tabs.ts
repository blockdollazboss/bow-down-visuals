import { resolveMedia } from "@/lib/streaming";
import type { ShelfPlayInput } from "./shelf";

/* ─── Audio Desk tabs (STACK-20 #18 — the Song Desk's tabs, docked) ──
   The Audio Desk was one flat panel: the quick bench + the full
   workbench. The website's sound toolkit — the Sample Pack builder
   (pages/ai-audio.tsx's Samples tab), the member's own library, and
   the stem splitter — never crossed over as tabs. This module is
   the pure seam for the three tabs the desk gains; every rail is
   the website's own, no parallel stores:
     Sound packs — GET /api/sample-pack/catalog (free, public),
       POST /api/sample-pack/generate (auth, charged up front,
       refunded on failure), POST /api/sample-pack/zip.
     Library — GET /api/world/my-music via lib/world/shelf's
       parseMyMusic / playInputFromMyMusic (the Booth's seams).
     Stem splitter — POST /api/stems + poll GET /api/stems/:jobId,
       driven through lib/world/audio-benches' registry entry.
   Pack sizes + prices come from lib/sample-pack (PACK_SIZE_OPTIONS
   / creditsForSize), the same constants the website tab renders. */

export type AudioDeskTabId = "benches" | "packs" | "library" | "stems";

export const AUDIO_DESK_TABS: ReadonlyArray<{ id: AudioDeskTabId; label: string }> = [
  { id: "benches", label: "Benches" },
  { id: "packs", label: "Sound packs" },
  { id: "library", label: "Library" },
  { id: "stems", label: "Stem splitter" },
];

export function isAudioDeskTabId(value: unknown): value is AudioDeskTabId {
  return value === "benches" || value === "packs" || value === "library" || value === "stems";
}

/* ─── The sample-pack catalog (GET /api/sample-pack/catalog) ────────
   The boundary normalizer reads defensively — both the catalog's
   camelCase and stray snake_case — because DTO drift is this repo's
   #1 bug family. A payload that isn't an object at all is not a
   catalog (null); missing pieces degrade to empty lists and the tab
   falls back to the site's standard set, exactly as the website tab
   treats its catalog (progressive enhancement, never a hard gate). */

export interface SamplePackCatalogType {
  key: string;
  label: string;
  origin: "synthesized" | "ai-generated";
  blurb: string;
}

export interface SamplePackCatalog {
  genres: string[];
  keys: string[];
  types: SamplePackCatalogType[];
  license: string;
}

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];

export function parseSamplePackCatalog(payload: unknown): SamplePackCatalog | null {
  if (!payload || typeof payload !== "object") return null;
  const r = payload as Record<string, unknown>;
  const types: SamplePackCatalogType[] = [];
  if (Array.isArray(r["types"])) {
    for (const raw of r["types"]) {
      if (!raw || typeof raw !== "object") continue;
      const t = raw as Record<string, unknown>;
      const key = typeof t["key"] === "string" ? t["key"] : "";
      const label = typeof t["label"] === "string" ? t["label"] : "";
      if (!key || !label) continue;
      types.push({
        key,
        label,
        origin: t["origin"] === "ai-generated" ? "ai-generated" : "synthesized",
        blurb: typeof t["blurb"] === "string" ? t["blurb"] : "",
      });
    }
  }
  return {
    genres: strList(r["genres"]),
    keys: strList(r["keys"]),
    types,
    license: typeof r["license"] === "string" ? r["license"] : "",
  };
}

/* ─── Building a pack (POST /api/sample-pack/generate) ──────────────
   The website posts { genre, bpm, musicalKey, packSize, types? } —
   types rides ONLY when the member picked some (an absent list is
   the server's "the full set" signal; an empty array is not). */

export interface SamplePackBuild {
  genre: string;
  bpm: number;
  musicalKey: string;
  packSize: number;
  types: readonly string[];
}

export function buildSamplePackPayload(build: SamplePackBuild): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    genre: build.genre,
    bpm: build.bpm,
    musicalKey: build.musicalKey,
    packSize: build.packSize,
  };
  if (build.types.length > 0) payload["types"] = [...build.types];
  return payload;
}

/** The website's pack name for a build — the zip's filename and the
 *  pack's label everywhere: "<genre>-<bpm>bpm-<key>", slug-safe. */
export function samplePackName(build: Pick<SamplePackBuild, "genre" | "bpm" | "musicalKey">): string {
  return `${build.genre}-${build.bpm}bpm-${build.musicalKey}`.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

/* ─── A generated pack's samples ────────────────────────────────────
   Rows without a playable URL are dropped: a sample that cannot be
   auditioned is never shown as auditionable. Ids fall back to the
   row's URL (stable within the pack) so the list always has a key. */

export interface PackSample {
  id: string;
  name: string;
  type: string;
  typeLabel: string;
  origin: "synthesized" | "ai-generated";
  url: string;
  durationSec: number;
  bpm: number;
  musicalKey: string;
  genre: string;
}

export function parseGeneratedSamples(payload: unknown): PackSample[] {
  if (!payload || typeof payload !== "object") return [];
  const list = (payload as { samples?: unknown }).samples;
  if (!Array.isArray(list)) return [];
  const out: PackSample[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const url = typeof r["url"] === "string" ? r["url"].trim() : "";
    if (!url) continue;
    const numOr = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    out.push({
      id: typeof r["id"] === "string" && r["id"] ? r["id"] : url,
      name: typeof r["name"] === "string" && r["name"] ? r["name"] : "Sample",
      type: typeof r["type"] === "string" ? r["type"] : "",
      typeLabel: typeof r["typeLabel"] === "string" && r["typeLabel"] ? r["typeLabel"] : "Sample",
      origin: r["origin"] === "ai-generated" ? "ai-generated" : "synthesized",
      url,
      durationSec: numOr(r["durationSec"]),
      bpm: numOr(r["bpm"]),
      musicalKey: typeof r["musicalKey"] === "string" ? r["musicalKey"] : "",
      genre: typeof r["genre"] === "string" ? r["genre"] : "",
    });
  }
  return out;
}

/** A pack sample on the Shelf player: the sample's URL is already a
 *  persistent media URL (the generate response's own contract),
 *  resolved through the same resolveMedia every rail uses. Its
 *  website home is the pack builder itself, so the Now Playing
 *  card's transfer lands back on the Samples tab. */
export function samplePlayInput(sample: PackSample): ShelfPlayInput | null {
  const src = resolveMedia(sample.url.trim());
  if (!src) return null;
  return {
    kind: "track",
    id: sample.id,
    title: sample.name,
    artistName: "Sound library",
    artworkUrl: null,
    src,
    pagePath: "/audio-studio?tab=aiaudio&sub=samples",
    likeCount: 0,
    commentCount: 0,
  };
}

/** The zip rail's body (POST /api/sample-pack/zip) — the website's
 *  download shape: the pack's sample URLs + the pack's name. */
export function buildSamplePackZipPayload(
  samples: readonly PackSample[],
  packName: string,
): { urls: string[]; packName: string } {
  return { urls: samples.map((s) => s.url), packName: packName || "sample-pack" };
}

/* ─── Stem splitter source file ─────────────────────────────────────
   POST /api/stems takes the audio as a FILE (the site's upload
   shape), so an owned track's hosted audio is fetched into one —
   the same move the desk's library picker makes for its benches.
   The filename keeps the track's title, slugged, with the
   extension the blob's type implies. */

export function stemSourceFileName(title: string, mimeType: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const ext = mimeType.includes("wav") ? ".wav" : mimeType.includes("ogg") ? ".ogg" : mimeType.includes("mp4") || mimeType.includes("m4a") ? ".m4a" : ".mp3";
  return `${slug || "track"}${ext}`;
}
