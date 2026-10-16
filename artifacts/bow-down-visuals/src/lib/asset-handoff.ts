import type { HubAsset, HubAssetKind } from "@/lib/hub-project";
import { moduleByKey, type DeskKey } from "@/lib/desks";

/* ─── Generalized asset handoffs (Stack 4 #3) ────────────────────────────────
   The beat→editor handoff (lib/beat-handoff.ts) generalized: any desk's
   output asset can be handed to any other desk as an input. A handoff is a
   TYPED INTENT (table below): it names the asset kinds it carries, the
   receiving module (from the desk registry), and the input role the asset
   plays there. Intents are explicit — no free-form "send anywhere".

   Ownership validation: a handoff may only carry an asset that belongs to
   the caller — either an asset already in the caller's active hub project
   (pass `projectAssets` to stashAssetHandoff and the asset id must match),
   or a fresh local output carrying its Blob (the beat pattern: rendered in
   this session, not yet saved). Anything else is rejected.

   Transport is the same one-shot module cache as the beat handoff (SPA
   session only, 30-minute prune); the receiver consumes on open via the
   `?handoff=<id>` query param and strips it. Server-persisted movement
   between desks goes through the hub project itself (addAsset →
   ProjectFlowBar) — handoffs are for "take THIS asset THERE now". */

export interface HandoffIntent {
  id: string;
  /** Asset kinds this intent can carry. */
  kinds: HubAssetKind[];
  /** Receiving module key in the desk registry. */
  targetModule: string;
  targetDesk: DeskKey;
  /** The role the asset plays on arrival (timeline-audio, scene, …). */
  inputRole: string;
  /** House label for the action, e.g. "Send to Video Editor". */
  label: string;
}

export const HANDOFF_INTENTS: HandoffIntent[] = [
  { id: "beat-to-video", kinds: ["beat"], targetModule: "editor", targetDesk: "video", inputRole: "timeline-audio", label: "Send to Video Editor" },
  { id: "song-to-video", kinds: ["song"], targetModule: "editor", targetDesk: "video", inputRole: "timeline-audio", label: "Send to Video Editor" },
  { id: "stems-to-video", kinds: ["stems"], targetModule: "editor", targetDesk: "video", inputRole: "timeline-audio", label: "Send to Video Editor" },
  { id: "cover-to-video", kinds: ["image", "thumbnail"], targetModule: "editor", targetDesk: "video", inputRole: "scene", label: "Send to Video Editor" },
  { id: "video-to-photo", kinds: ["video", "clip"], targetModule: "thumbnail-generate", targetDesk: "photo", inputRole: "frame-source", label: "Send to Thumbnail Studio" },
  { id: "image-to-photo", kinds: ["image"], targetModule: "thumbnail-generate", targetDesk: "photo", inputRole: "base-image", label: "Send to Thumbnail Studio" },
  { id: "stems-to-audio", kinds: ["stems"], targetModule: "master", targetDesk: "audio", inputRole: "mix-input", label: "Send to Audio Studio" },
  { id: "song-to-audio", kinds: ["song", "beat"], targetModule: "cleanup", targetDesk: "audio", inputRole: "track-input", label: "Send to Audio Studio" },
  { id: "script-to-audio", kinds: ["script"], targetModule: "voiceover", targetDesk: "audio", inputRole: "script", label: "Send to Voiceover" },
  { id: "song-to-lyric-video", kinds: ["song"], targetModule: "lyric-video", targetDesk: "video", inputRole: "track", label: "Send to Lyric Video" },
];

export function handoffIntent(id: string): HandoffIntent | undefined {
  return HANDOFF_INTENTS.find((i) => i.id === id);
}

/** Intents that can carry this asset kind (for "Send to…" menus). */
export function intentsForKind(kind: HubAssetKind): HandoffIntent[] {
  return HANDOFF_INTENTS.filter((i) => i.kinds.includes(kind));
}

export interface AssetHandoff {
  id: string;
  intentId: string;
  asset: {
    /** Hub project asset id when the asset is already in the project. */
    hubAssetId?: string;
    kind: HubAssetKind;
    url: string;
    label: string;
    detail?: string;
    meta?: Record<string, string>;
  };
  /** Fresh local output (beat pattern) — present only pre-save. */
  blob?: Blob;
  createdAt: number;
}

const cache = new Map<string, AssetHandoff>();
const MAX_AGE_MS = 30 * 60 * 1000;

function prune() {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [k, v] of cache) {
    if (v.createdAt < cutoff) cache.delete(k);
  }
}

export class HandoffValidationError extends Error {}

/** Stash a validated handoff and return its id. Throws
    HandoffValidationError when the intent doesn't exist, the asset kind
    doesn't fit the intent, or the asset isn't the caller's (not in
    `projectAssets` and carrying no fresh blob). */
export function stashAssetHandoff(args: {
  intentId: string;
  asset: AssetHandoff["asset"];
  blob?: Blob;
  projectAssets?: HubAsset[];
}): string {
  const intent = handoffIntent(args.intentId);
  if (!intent) throw new HandoffValidationError(`unknown handoff intent: ${args.intentId}`);
  if (!intent.kinds.includes(args.asset.kind)) {
    throw new HandoffValidationError(`intent ${intent.id} cannot carry kind ${args.asset.kind}`);
  }
  const inProject = args.asset.hubAssetId
    ? (args.projectAssets ?? []).some((a) => a.id === args.asset.hubAssetId)
    : false;
  if (!inProject && !args.blob) {
    throw new HandoffValidationError("handoff asset must belong to the caller (hub project asset or fresh local output)");
  }
  prune();
  const id = `handoff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  cache.set(id, {
    id,
    intentId: intent.id,
    asset: args.asset,
    ...(args.blob ? { blob: args.blob } : {}),
    createdAt: Date.now(),
  });
  return id;
}

/** One-shot pickup — removes the entry from the cache. */
export function takeAssetHandoff(id: string): AssetHandoff | null {
  const entry = cache.get(id) ?? null;
  if (entry) cache.delete(id);
  return entry;
}

/** Route the receiver opens to consume the handoff: the target module's
    registry route carrying ?handoff=<id>. */
export function handoffRoute(intentId: string, handoffId: string): string {
  const intent = handoffIntent(intentId);
  const mod = intent ? moduleByKey(intent.targetModule) : undefined;
  if (!mod) throw new HandoffValidationError(`unknown handoff intent: ${intentId}`);
  const sep = mod.route.includes("?") ? "&" : "?";
  return `${mod.route}${sep}handoff=${encodeURIComponent(handoffId)}`;
}

/** Convenience: stash + route in one call (what a "Send to…" button does). */
export function sendAssetToDesk(args: Parameters<typeof stashAssetHandoff>[0]): string {
  const id = stashAssetHandoff(args);
  return handoffRoute(args.intentId, id);
}
