import { db, generationsTable } from "@workspace/db";

interface SaveGenerationParams {
  userId: string;
  type: "image" | "video" | "song" | "voice" | string;
  title?: string | null;
  fileUrl?: string | null;
  thumbnailUrl?: string | null;
  prompt?: string | null;
  creditsSpent?: number;
  metadata?: Record<string, unknown> | null;
}

/**
 * Save a completed generation to the user's history.
 * Fire-and-forget: never throws, so a history-save failure can't break generation.
 */
export async function saveGeneration(params: SaveGenerationParams): Promise<void> {
  try {
    await db.insert(generationsTable).values({
      user_id: params.userId,
      type: params.type,
      title: params.title ?? null,
      file_url: params.fileUrl ?? null,
      thumbnail_url: params.thumbnailUrl ?? null,
      prompt: params.prompt ?? null,
      credits_spent: params.creditsSpent ?? 0,
      metadata: params.metadata ?? null,
    });
  } catch (err) {
    // Log but don't throw — history should never break the user's generation.
    console.error("[saveGeneration] failed:", err);
  }
}
