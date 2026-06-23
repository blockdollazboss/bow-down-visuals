import { getSupabase } from "@/lib/supabase";
import {
  defaultStemEffects, STEM_MAX_MB,
  type AudioStem,
} from "@/lib/editor-settings";

const BUCKET = "audio-stems";

export interface StemUploadResult {
  url: string;
  storagePath: string;
}

/** Upload a stem audio file to the audio-stems bucket under the user's folder. */
export async function uploadStemFile(userId: string, file: File): Promise<StemUploadResult> {
  if (file.size > STEM_MAX_MB * 1024 * 1024) {
    throw new Error(`File must be under ${STEM_MAX_MB}MB`);
  }
  const sb = getSupabase();
  const ext = file.name.split(".").pop() ?? "wav";
  const storagePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(storagePath, file, { upsert: true });
  if (error) throw error;
  const { data } = sb.storage.from(BUCKET).getPublicUrl(storagePath);
  return { url: data.publicUrl, storagePath };
}

/** Best-effort delete of a stem file from storage. */
export async function removeStemFile(storagePath: string): Promise<void> {
  if (!storagePath) return;
  try {
    const sb = getSupabase();
    await sb.storage.from(BUCKET).remove([storagePath]);
  } catch {
    /* best-effort */
  }
}

/** Build a new AudioStem record from an uploaded file. */
export function makeStem(
  file: File,
  upload: StemUploadResult,
  type: string,
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
