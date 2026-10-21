/**
 * portrait-mouth.ts — locate the mouth on a vault character's
 * portrait, ONCE, so the hall can move its lips with the speaker's
 * voice (lips.ts does the math; hall-scene.ts does the drawing).
 *
 * Uses the same vendored Face Landmarker runtime as the Avatar
 * stream source (avatar-face-engine.ts owns the URLs and the VIDEO-
 * mode engine) — but a portrait is a still, so this builds a
 * short-lived IMAGE-mode landmarker, detects once, and closes it.
 * The heavy bundle loads lazily, only when a character figure first
 * appears in the hall.
 *
 * Honesty contract: ANY failure — engine won't load, image is
 * cross-origin-tainted, no face in the portrait (a mascot, an
 * animal, an abstract emblem) — resolves to null, and the character
 * simply stands in the hall without lip animation. A mouth is never
 * drawn anywhere the landmarks didn't put one.
 */
import {
  visionBundleUrls,
  visionWasmBases,
  faceModelUrls,
} from "../stream-kit/avatar-face-engine";
import { mouthBoxFromLandmarks, type LandmarkPoint, type MouthBox } from "./lips";

interface ImageLandmarkerLike {
  detect(image: unknown): { faceLandmarks?: LandmarkPoint[][] };
  close(): void;
}

interface VisionModuleLike {
  FilesetResolver: { forVisionTasks(wasmPath: string): Promise<unknown> };
  FaceLandmarker: {
    createFromOptions(fileset: unknown, options: Record<string, unknown>): Promise<ImageLandmarkerLike>;
  };
}

async function importVision(url: string): Promise<VisionModuleLike> {
  // Runtime URL (vendored first, CDN fallback) — never a build-time
  // specifier; Vite must leave it alone, same as the face engine.
  const mod: unknown = await import(/* @vite-ignore */ url);
  return mod as VisionModuleLike;
}

let modulePromise: Promise<{ mod: VisionModuleLike; baseIndex: number }> | null = null;

function loadVisionModule(): Promise<{ mod: VisionModuleLike; baseIndex: number }> {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    const urls = visionBundleUrls();
    let lastErr: unknown = null;
    for (let i = 0; i < urls.length; i++) {
      try {
        const mod = await importVision(urls[i]!);
        if (mod && mod.FilesetResolver && mod.FaceLandmarker) return { mod, baseIndex: i };
        lastErr = new Error("vision bundle missing its exports");
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("vision bundle failed to load");
  })();
  modulePromise.catch(() => {
    modulePromise = null; // a failed load must not poison later portraits
  });
  return modulePromise;
}

/** Build an IMAGE-mode landmarker, run it once, close it. GPU first,
 *  CPU second — a still detection tolerates either. */
async function detectFaceLandmarks(image: HTMLImageElement): Promise<LandmarkPoint[] | null> {
  const { mod, baseIndex } = await loadVisionModule();
  const wasmBases = visionWasmBases();
  const fileset = await mod.FilesetResolver.forVisionTasks(wasmBases[baseIndex] ?? wasmBases[0]!);
  let lastErr: unknown = null;
  for (const delegate of ["GPU", "CPU"] as const) {
    for (const modelAssetPath of faceModelUrls()) {
      let landmarker: ImageLandmarkerLike | null = null;
      try {
        landmarker = await mod.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath, delegate },
          runningMode: "IMAGE",
          numFaces: 1,
        });
        const result = landmarker.detect(image);
        return result.faceLandmarks?.[0] ?? null;
      } catch (err) {
        lastErr = err;
      } finally {
        try {
          landmarker?.close();
        } catch {
          /* already closed */
        }
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("face detection failed");
}

const mouthCache = new Map<string, Promise<MouthBox | null>>();

/** The mouth on this portrait (by image URL), or null when there is
 *  honestly no face to find one on. Cached per URL — a character's
 *  mouth is located once per session, not per frame or per room. */
export function locatePortraitMouth(image: HTMLImageElement): Promise<MouthBox | null> {
  const key = image.currentSrc || image.src;
  const hit = mouthCache.get(key);
  if (hit) return hit;
  const pending = (async (): Promise<MouthBox | null> => {
    try {
      const landmarks = await detectFaceLandmarks(image);
      return mouthBoxFromLandmarks(landmarks);
    } catch {
      return null;
    }
  })();
  mouthCache.set(key, pending);
  return pending;
}
