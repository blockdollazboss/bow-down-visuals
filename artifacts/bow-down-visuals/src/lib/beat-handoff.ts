/* ─── Beat → Visual Vibes handoff ──────────────────────────────────────────
   The original desk-to-desk handoff, now a typed intent ("beat-to-video")
   on the generalized mechanism in lib/asset-handoff.ts. The beat maker
   renders an audio blob (WAV by default, MP3 when picked) and stashes
   it here (module-level, so it survives SPA
   navigation), then routes to /video-editor?beathandoff=<id>. The editor
   picks it up one-shot and adds it as a timeline audio stem. This module
   keeps the original API so existing callers don't change. */

import { stashAssetHandoff, takeAssetHandoff } from "@/lib/asset-handoff";

interface BeatHandoff {
  id: string;
  blob: Blob;
  url: string;
  title: string;
  bpm: number;
  durationSec: number;
  createdAt: number;
  /** Optional per-track stems (W2-L3 export pack). Additive: consumers
   *  that only know the mix ignore this; the editor adds each stem as
   *  its own timeline audio stem when present. */
  stems?: BeatStemHandoff[];
}

export interface BeatStemHandoff {
  blob: Blob;
  url: string;
  title: string;
}

/* The generalized handoff cache carries ONE blob per entry, so the
 * stems ride in a side cache keyed by the handoff id — same one-shot,
 * same-session lifecycle as the mix entry it belongs to. */
const stemCache = new Map<string, BeatStemHandoff[]>();

export function stashBeatHandoff(entry: Omit<BeatHandoff, "id" | "createdAt">): string {
  const id = stashAssetHandoff({
    intentId: "beat-to-video",
    asset: {
      kind: "beat",
      url: entry.url,
      label: entry.title,
      meta: { bpm: String(entry.bpm), durationSec: String(entry.durationSec) },
    },
    blob: entry.blob,
  });
  if (entry.stems && entry.stems.length > 0) stemCache.set(id, entry.stems);
  return id;
}

/** One-shot pickup — removes the entry from the cache. */
export function takeBeatHandoff(id: string): BeatHandoff | null {
  const entry = takeAssetHandoff(id);
  if (!entry || entry.intentId !== "beat-to-video" || !entry.blob) {
    stemCache.delete(id);
    return null;
  }
  const stems = stemCache.get(id);
  stemCache.delete(id);
  return {
    id: entry.id,
    blob: entry.blob,
    url: entry.asset.url,
    title: entry.asset.label,
    bpm: Number(entry.asset.meta?.bpm ?? 0),
    durationSec: Number(entry.asset.meta?.durationSec ?? 0),
    createdAt: entry.createdAt,
    ...(stems && stems.length > 0 ? { stems } : {}),
  };
}
