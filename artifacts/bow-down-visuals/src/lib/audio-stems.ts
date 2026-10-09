import {
  defaultStemEffects, STEM_MAX_MB,
  type AudioStem,
} from "@/lib/editor-settings";

export interface StemUploadResult {
  url: string;
  storagePath: string;
}

/** Upload a stem audio file to R2 via a presigned PUT URL from the backend. */
export async function uploadStemFile(userId: string, file: File): Promise<StemUploadResult> {
  if (file.size > STEM_MAX_MB * 1024 * 1024) {
    throw new Error(`File must be under ${STEM_MAX_MB}MB`);
  }
  const ext = file.name.split(".").pop() ?? "wav";
  const storagePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const key = `audio-stems/${storagePath}`;

  // Get a presigned PUT URL from the backend (auth required).
  const presignRes = await fetch("/api/r2/presign-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, contentType: file.type || "audio/wav" }),
  });
  if (!presignRes.ok) {
    throw new Error("Could not start the upload. Please try again.");
  }
  const { uploadUrl, publicUrl } = await presignRes.json();

  // Upload directly to R2.
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "audio/wav" },
    body: file,
  });
  if (!putRes.ok) {
    throw new Error("Upload failed. Please try again.");
  }
  return { url: publicUrl, storagePath };
}

/** Best-effort delete of a stem file from R2. */
export async function removeStemFile(storagePath: string): Promise<void> {
  if (!storagePath) return;
  try {
    const key = storagePath.startsWith("audio-stems/")
      ? storagePath
      : `audio-stems/${storagePath}`;
    await fetch("/api/r2/object", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
  } catch {
    /* best-effort */
  }
}

/** Best-effort decode of an audio file's duration (seconds) in the browser. */
export function readAudioDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const audio = document.createElement("audio");
      audio.preload = "metadata";
      const done = (value: number | undefined) => {
        URL.revokeObjectURL(url);
        resolve(value);
      };
      audio.onloadedmetadata = () =>
        done(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined);
      audio.onerror = () => done(undefined);
      audio.src = url;
    } catch {
      resolve(undefined);
    }
  });
}

/** Build a new AudioStem record from an uploaded file. */
export function makeStem(
  file: File,
  upload: StemUploadResult,
  type: string,
  durationSec?: number,
): AudioStem {
  const baseName = file.name.replace(/\.[^.]+$/, "");
  return {
    id: `stem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: baseName || type,
    type,
    url: upload.url,
    storagePath: upload.storagePath,
    fileType: file.type || "audio",
    fileSize: file.size,
    uploadedAt: new Date().toISOString(),
    durationSec,
    muted: false,
    solo: false,
    locked: false,
    volume: 100,
    pan: 0,
    trimStart: 0,
    trimEnd: 0,
    startTime: 0,
    effects: defaultStemEffects(),
  };
}
