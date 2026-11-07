/**
 * video-studio-desk — the seam behind the My Studio board's
 * native Video Studio desk (stack200 world parity lane B1,
 * census item 5; the census counted the hub surface ABSENT —
 * the Video Desk's motion bench is a different, settings-led
 * surface with no camera-movement picker and no hub spine).
 *
 * Source of truth: pages/video-studio.tsx. The page itself is
 * unrouted (App.tsx redirects /video-studio → /video-editor),
 * so its pickers' DATA lives in data/video-studio.ts (moved
 * verbatim) and this seam mirrors the page's rail behavior:
 *
 *   POST /api/generate-runway-clip — gen4.5, registry-priced
 *        400 VB ("Generate Video Clip"; the create-desks
 *        seam's videoClipCost reads the same registry row),
 *        charged server-side only when the clip succeeds.
 *        Body: the prompt with the picked camera movement's
 *        prompt folded in, the aspect's ratio (9:16 is the
 *        only portrait mapping — 1:1 rides the landscape
 *        ratio, exactly like the page), model "gen4.5", and
 *        the reference image in image mode.
 *   GET  /api/generate-runway-clip/:taskId — polled every 5s
 *        to a 5-minute deadline. Succeeded + a url = done;
 *        succeeded WITHOUT a url is an honest failure (the
 *        page's words: no Visual Bucs were charged); failed /
 *        cancelled = failure; past the deadline = timed out.
 *
 * The hub spine mirrors the page's: a project song's
 * music-video idea becomes the prompt (16:9), a script's hook
 * becomes the prompt, a thumbnail/image anchors image mode;
 * the Thumbnail desk's winning A/B pick is taken one-shot off
 * the shared handoff key; and every finished clip lands in
 * the hub project with the RAIL's reported duration — gen4.5
 * clips are a fixed 5s, so the picker duration never reaches
 * the record (the page's own honesty note).
 *
 * Copy: the page's strings were never cataloged (it renders
 * them via defaultValue fallbacks), so the desk's copy lives
 * in worldVideoStudio.* — en source, carrying the page's own
 * wording where the page has wording.
 */
import {
  CAMERA_MOVEMENTS,
  type CameraMovement,
} from "@/data/video-studio";
import type { HubAsset } from "@/lib/hub-project";
import { THUMBNAIL_WINNER_HANDOFF_KEY } from "./create-desks";

export const VIDEO_STUDIO_CLIP_PATH = "/api/generate-runway-clip";
export const VIDEO_STUDIO_POLL_MS = 5000;
export const VIDEO_STUDIO_POLL_DEADLINE_MS = 5 * 60_000;
export const VIDEO_STUDIO_REFERENCE_MAX_BYTES = 10 * 1024 * 1024;

export function videoStudioTaskPath(taskId: string): string {
  return `${VIDEO_STUDIO_CLIP_PATH}/${encodeURIComponent(taskId)}`;
}

export function cameraMovementOf(id: string): CameraMovement | null {
  return CAMERA_MOVEMENTS.find((c) => c.id === id) ?? null;
}

/** The page's ratio rule: 9:16 is portrait; everything else
 *  (16:9 and 1:1 alike) rides the landscape ratio. */
export function ratioForAspect(aspectId: string): string {
  return aspectId === "9:16" ? "720:1280" : "1280:720";
}

/** The submit body — the page's exact shape: the camera
 *  movement's prompt folded into the prompt text, gen4.5,
 *  and the reference image only in image mode. */
export function buildStudioClipBody(input: {
  prompt: string;
  cameraId: string;
  aspectId: string;
  referenceImageUrl?: string | null;
}): Record<string, unknown> {
  const cameraPrompt = cameraMovementOf(input.cameraId)?.prompt ?? "";
  return {
    promptText: `${input.prompt.trim()}, ${cameraPrompt}`,
    ratio: ratioForAspect(input.aspectId),
    referenceImageUrl: input.referenceImageUrl ?? undefined,
    model: "gen4.5",
  };
}

/** The submit result — the rail's task id plus its reported
 *  duration (gen4.5 is a fixed 5s; the page defaults to 5
 *  when the rail doesn't say). Null without a task id: the
 *  submit failed, whatever else the body claims. */
export function studioSubmitOf(data: unknown): { taskId: string; durationSec: number } | null {
  if (typeof data !== "object" || data === null) return null;
  const rec = data as Record<string, unknown>;
  if (typeof rec["taskId"] !== "string" || !rec["taskId"]) return null;
  return {
    taskId: rec["taskId"],
    durationSec:
      typeof rec["durationSec"] === "number" && Number.isFinite(rec["durationSec"])
        ? rec["durationSec"]
        : 5,
  };
}

export type StudioPollVerdict =
  | { state: "working" }
  | { state: "done"; url: string }
  | { state: "empty" }
  | { state: "failed"; message: string | null };

/** One poll, read the page's way. */
export function interpretStudioPoll(data: unknown): StudioPollVerdict {
  if (typeof data !== "object" || data === null) return { state: "working" };
  const rec = data as Record<string, unknown>;
  const status = typeof rec["status"] === "string" ? rec["status"] : "";
  const url = typeof rec["url"] === "string" && rec["url"] ? rec["url"] : null;
  if (status === "succeeded") {
    return url ? { state: "done", url } : { state: "empty" };
  }
  if (status === "failed" || status === "cancelled") {
    return { state: "failed", message: typeof rec["error"] === "string" ? rec["error"] : null };
  }
  return { state: "working" };
}

/** The page's project-pick rules as a pure function: a song
 *  fills an EMPTY prompt with its music-video idea (or the
 *  page's fallback line) and sets 16:9; a script fills an
 *  empty prompt from its hook; a thumbnail/image anchors
 *  image mode. Anything else is not a studio pick. */
export function studioProjectPick(
  asset: Pick<HubAsset, "kind" | "label" | "url" | "meta">,
  currentPrompt: string,
): { prompt?: string; aspect?: string; referenceImage?: string } | null {
  const promptEmpty = !currentPrompt.trim();
  if (asset.kind === "song") {
    const idea = asset.meta?.["musicVideoIdea"];
    return {
      prompt: promptEmpty ? (idea ?? `${asset.label} — cinematic music video shot`) : undefined,
      aspect: "16:9",
    };
  }
  if (asset.kind === "script") {
    const hook = asset.meta?.["hook"];
    return { prompt: promptEmpty && hook ? `Cinematic visual for: ${hook}` : undefined };
  }
  if (asset.kind === "thumbnail" || asset.kind === "image") {
    return { referenceImage: asset.url };
  }
  return null;
}

/** The one-shot Thumbnail-winner pickup: read the shared
 *  handoff key and remove it, so the anchor applies once —
 *  the page's exact discipline. Storage may be unavailable;
 *  that reads as no winner, never a throw. */
export function takeThumbnailWinner(storage: {
  getItem: (k: string) => string | null;
  removeItem: (k: string) => void;
}): string | null {
  try {
    const winner = storage.getItem(THUMBNAIL_WINNER_HANDOFF_KEY);
    if (!winner) return null;
    storage.removeItem(THUMBNAIL_WINNER_HANDOFF_KEY);
    return winner;
  } catch {
    return null;
  }
}

/** The hub record for a finished clip — the page's addAsset
 *  shape, with the RAIL's duration, never the picker's. */
export function studioClipAsset(input: {
  url: string;
  prompt: string;
  cameraId: string;
  aspectId: string;
  durationSec: number;
}): Omit<HubAsset, "id" | "createdAt"> {
  const prompt = input.prompt.trim();
  return {
    kind: "video",
    url: input.url,
    label: prompt.slice(0, 80) || "AI video",
    detail: `${input.durationSec}s · ${input.aspectId} · ${input.cameraId}`,
    meta: {
      prompt: prompt.slice(0, 300),
      camera: input.cameraId,
      duration: String(input.durationSec),
      aspect: input.aspectId,
    },
  };
}
