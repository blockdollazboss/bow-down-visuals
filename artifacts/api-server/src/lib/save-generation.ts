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
  /** The Creative Vault character the work was made as (0142, G8). */
  artistVaultId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate an untrusted artistVaultId from a request body: a UUID or
    nothing. A bad value must never break a generation — it just means
    "no character recorded". */
export function asVaultId(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
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
      artist_vault_id: asVaultId(params.artistVaultId),
    });
  } catch (err) {
    // Log but don't throw — history should never break the user's generation.
    console.error("[saveGeneration] failed:", err);
  }
}
