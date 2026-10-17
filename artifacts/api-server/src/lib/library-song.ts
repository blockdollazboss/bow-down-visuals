/**
 * library-song.ts — record a finished audio output as a row in the
 * caller's song library (the `songs` table behind GET /api/songs).
 *
 * Linkage fix (audit DE-6): Audio Studio was upload-only both ways — its
 * outputs (cleanup, masters, mixes, finished songs) never came back as
 * library songs, so nothing downstream (distribute's picker, remix-by-id,
 * the editor) could ever see them, and every studio pass broke the id
 * chain. Every studio completion now records its output here, with
 * `parentSongId` pointing at the library song the job started from when
 * the input itself came from the library.
 *
 * CONVERGENCE POINT: the linkage-core lane adds the same insert for music
 * generations (source "generated") directly in music-audio.ts. Both write
 * the identical row shape ({user_id, title, audio_url, audio_path,
 * source, parent_song_id, artist_vault_id, duration_sec}); when that
 * lane's insert is next touched, it should call this helper so the shape
 * lives in exactly one place.
 *
 * Failure posture: the caller already holds a finished, paid-for output
 * URL. A library-write failure must not fail the job or trigger a refund
 * for work that was delivered — it logs loudly and returns null, and the
 * job's `librarySongId` simply stays null.
 */
import { db, songsTable } from "@workspace/db";
import { logger } from "./logger";

export interface LibrarySongInput {
  userId: string;
  title: string;
  audioUrl: string;
  /** Storage reference (Supabase ref / R2 key) when one exists. */
  audioPath?: string | null;
  /** Row provenance: "cleanup" | "master" | "mix" | "finish" | "generated" | … */
  source: string;
  /** The library song this output was made from, when it was one. */
  parentSongId?: string | null;
  artistVaultId?: string | null;
  durationSec?: number | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** FK columns only accept real uuids — a malformed id becomes null, never
 *  a failed insert that costs the user their library row. */
export function uuidOrNull(v: string | null | undefined): string | null {
  return typeof v === "string" && UUID_RE.test(v) ? v : null;
}

/** "My Song (rough).mp3" + "Master" → "My Song (rough) (Master)". */
export function librarySongTitle(sourceName: string, suffix: string): string {
  const base = (sourceName || "").replace(/\.[a-z0-9]+$/i, "").trim() || "Untitled";
  return `${base} (${suffix})`.slice(0, 200);
}

/** Insert the songs row; returns the new song id, or null on failure. */
export async function recordLibrarySong(input: LibrarySongInput): Promise<string | null> {
  try {
    const [row] = await db
      .insert(songsTable)
      .values({
        user_id: input.userId,
        title: input.title.slice(0, 200),
        audio_url: input.audioUrl,
        audio_path: input.audioPath ?? null,
        source: input.source,
        parent_song_id: uuidOrNull(input.parentSongId),
        artist_vault_id: uuidOrNull(input.artistVaultId),
        duration_sec:
          typeof input.durationSec === "number" && Number.isFinite(input.durationSec)
            ? String(Math.round(input.durationSec))
            : null,
      })
      .returning({ id: songsTable.id });
    return row?.id ?? null;
  } catch (err) {
    logger.error(
      { err, userId: input.userId, source: input.source },
      "[library-song] finished output was not recorded in the song library",
    );
    return null;
  }
}
