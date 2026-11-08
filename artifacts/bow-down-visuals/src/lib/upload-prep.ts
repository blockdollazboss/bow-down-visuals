/**
 * upload-prep.ts — client-side preparation for POST /api/publish/upload
 * (stack300 #69).
 *
 * The publish door caps images at 10 MB and audio/video at 80 MB, but it
 * could only say so AFTER multer had received the whole file: a 25 MB
 * phone photo cost a full upload to earn its 413. This module moves the
 * size story to before the bytes move:
 *
 *  - Oversize images are canvas-downscaled (dimension cap + re-encode
 *    ladder) until they fit under the cap with headroom. An image that
 *    already fits is NEVER touched — the uploaded photo is the
 *    deliverable, so re-encoding is a rescue for files that would be
 *    rejected outright, not a tax on every photo.
 *  - A non-image file over the media cap, or an image still over the
 *    image cap after downscaling, is rejected on the client with the
 *    server's own 413 wording — same honest answer, zero wasted upload.
 *
 * The limits below MIRROR the server (artifacts/api-server
 * src/routes/publish.ts: ARTWORK_MAX_BYTES / PUBLISH_UPLOAD_MAX_BYTES).
 * They are a pre-check, not a second policy: the server still enforces
 * its own caps on everything that arrives.
 */
export const PUBLISH_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PUBLISH_MEDIA_MAX_BYTES = 80 * 1024 * 1024;

/** Aim under the image cap, not at it — re-encode estimates drift. */
export const IMAGE_DOWNSCALE_TARGET_BYTES = 9 * 1024 * 1024;
export const IMAGE_MAX_DIMENSION = 2560;

export function isImageFile(file: { type: string }): boolean {
  return file.type.startsWith("image/");
}

/** Only files that would bust (or nearly bust) the image cap get touched. */
export function needsImageDownscale(file: { type: string; size: number }): boolean {
  return isImageFile(file) && file.size > IMAGE_DOWNSCALE_TARGET_BYTES;
}

/**
 * The server's own over-cap message for a non-image file, or null when
 * the file may proceed. Images return null here — their size story is
 * the downscale path below, judged on the downscaled bytes.
 */
export function mediaOversizeMessage(file: { type: string; size: number }): string | null {
  if (isImageFile(file)) return null;
  if (file.size > PUBLISH_MEDIA_MAX_BYTES) {
    return "This file exceeds the 80 MB upload limit. Please use a smaller file.";
  }
  return null;
}

/** The server's own over-cap message for artwork images. */
export const IMAGE_OVERSIZE_MESSAGE = "Artwork images must be 10 MB or smaller.";

/** Fit (w,h) inside maxDim on the longest side; never upscale. */
export function scaledDimensions(
  width: number,
  height: number,
  maxDim: number = IMAGE_MAX_DIMENSION,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxDim || longest === 0) return { width, height };
  const scale = maxDim / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface ImageEncodeAttempt {
  maxDimension: number;
  quality: number;
}

/** Re-encode ladder: gentlest first, each step smaller than the last. */
export const IMAGE_ENCODE_ATTEMPTS: readonly ImageEncodeAttempt[] = [
  { maxDimension: 2560, quality: 0.85 },
  { maxDimension: 2560, quality: 0.7 },
  { maxDimension: 1920, quality: 0.7 },
  { maxDimension: 1600, quality: 0.6 },
  { maxDimension: 1280, quality: 0.55 },
];

const MIME_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Keep the stored extension truthful when a re-encode changed the type. */
export function downscaledFileName(originalName: string, mime: string): string {
  const ext = MIME_EXTENSION[mime];
  if (!ext) return originalName;
  const dot = originalName.lastIndexOf(".");
  const base = dot > 0 ? originalName.slice(0, dot) : originalName || "image";
  return `${base}.${ext}`;
}

async function decodeImage(file: Blob): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
      close: () => bitmap.close(),
    };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode image"));
      el.src = url;
    });
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      close: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Image encode failed"))),
      mime,
      quality,
    );
  });
}

/**
 * Downscale + re-encode an oversize image toward IMAGE_DOWNSCALE_TARGET.
 * PNG inputs keep PNG on the first attempt (transparency-safe); if that
 * still busts the target the ladder falls back to JPEG on a white ground.
 * Returns the smallest encode produced — the caller compares it against
 * PUBLISH_IMAGE_MAX_BYTES and decides. Throws when the image cannot be
 * decoded/encoded at all (callers fall back to the original file, which
 * preserves the pre-#69 behavior for formats canvas can't handle, e.g.
 * HEIC in some browsers).
 */
export async function downscaleImageFile(file: File): Promise<Blob> {
  const decoded = await decodeImage(file);
  try {
    let smallest: Blob | null = null;
    for (let i = 0; i < IMAGE_ENCODE_ATTEMPTS.length; i += 1) {
      const attempt = IMAGE_ENCODE_ATTEMPTS[i] as ImageEncodeAttempt;
      const { width, height } = scaledDimensions(decoded.width, decoded.height, attempt.maxDimension);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is not available");
      const keepPng = file.type === "image/png" && i === 0;
      const mime = keepPng ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg";
      if (mime === "image/jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
      }
      decoded.draw(ctx, width, height);
      const blob = await canvasToBlob(canvas, mime, attempt.quality);
      if (!smallest || blob.size < smallest.size) smallest = blob;
      if (blob.size <= IMAGE_DOWNSCALE_TARGET_BYTES) return blob;
    }
    return smallest as Blob;
  } finally {
    decoded.close();
  }
}
