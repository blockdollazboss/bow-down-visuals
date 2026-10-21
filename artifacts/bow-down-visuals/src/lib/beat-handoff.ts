/* ─── Beat → Visual Vibes handoff ──────────────────────────────────────────
   The original desk-to-desk handoff, now a typed intent ("beat-to-video")
   on the generalized mechanism in lib/asset-handoff.ts. The beat maker
   renders a WAV blob and stashes it here (module-level, so it survives SPA
   navigation), then routes to /video-editor?beathandoff=<id>. The editor
   picks it up one-shot and adds it as a timeline audio stem. This module
   keeps the original API so existing callers don't change. */

import { stashAssetHandoff, takeAssetHandoff } from "@/lib/asset-handoff";

export interface BeatHandoff {
  id: string;
  blob: Blob;
  url: string;
  title: string;
  bpm: number;
  durationSec: number;
  createdAt: number;
}

export function stashBeatHandoff(entry: Omit<BeatHandoff, "id" | "createdAt">): string {
  return stashAssetHandoff({
    intentId: "beat-to-video",
    asset: {
      kind: "beat",
      url: entry.url,
      label: entry.title,
      meta: { bpm: String(entry.bpm), durationSec: String(entry.durationSec) },
    },
    blob: entry.blob,
  });
}

/** One-shot pickup — removes the entry from the cache. */
export function takeBeatHandoff(id: string): BeatHandoff | null {
  const entry = takeAssetHandoff(id);
  if (!entry || entry.intentId !== "beat-to-video" || !entry.blob) return null;
  return {
    id: entry.id,
    blob: entry.blob,
    url: entry.asset.url,
    title: entry.asset.label,
    bpm: Number(entry.asset.meta?.bpm ?? 0),
    durationSec: Number(entry.asset.meta?.durationSec ?? 0),
    createdAt: entry.createdAt,
  };
}
