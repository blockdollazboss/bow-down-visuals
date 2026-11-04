/* ── Beat sample library — durable user uploads for Beat Studio ────────
 * W2-L2 made a creator's own audio files loadable onto sequencer
 * tracks, but the bytes lived only in the browser session: the beat
 * project persisted the sound id + name, and after a reload the track
 * fell back to its built-in synth voice behind a "not loaded" notice.
 *
 * This module is the client half of the durable rail
 * (POST/GET/DELETE /api/beat-samples, migration 0322): a signed-in
 * creator's uploaded samples are stored server-side (R2, via presigned
 * PUT — the bytes never pass through the API server), listed back, and
 * registered into the sound registry through the manifest seam
 * (registerBeatSoundManifest in lib/beat-sounds.ts) so a saved project
 * resolves its own sounds after any reload. The durable registry id is
 * `upload:<sample row id>` — the same shape session uploads use, so
 * project files need no migration: an id either names a saved library
 * sample (rehydrated here) or an unsaved session upload (the honest
 * fallback notice still covers it).
 *
 * Honesty contract: persistence is best-effort ON TOP of the session
 * load, never instead of it. persistBeatSample throws on any failure
 * and the page keeps the session sound while saying plainly that it
 * wasn't saved — this module never reports a save that didn't happen.
 *
 * Pure UI = FREE. No charges, no provider calls.
 */
import { apiErrorMessage } from "@/lib/api-error";
import {
  registerBeatSoundManifest,
  type BeatSoundEntry,
  type BeatSoundKind,
  type BeatSoundManifestEntry,
} from "@/lib/beat-sounds";

/** One saved sample, as the rail's DTO returns it. */
export interface BeatSampleRecord {
  id: string;
  /** Registry id: "upload:<id>". */
  soundId: string;
  name: string;
  kind: BeatSoundKind;
  contentType: string;
  sizeBytes: number;
  url: string;
  createdAt?: string;
}

/** Hard size ceiling for one saved sample — mirrors the server rule
 *  (BEAT_SAMPLE_MAX_BYTES in lib/db/src/schema/beat-samples.ts). */
export const BEAT_SAMPLE_MAX_BYTES = 20 * 1024 * 1024;

/** Accepted content types — mirrors BEAT_SAMPLE_CONTENT_TYPES on the
 *  server. Keys are what browsers report for the picker's formats
 *  (audio/*,.wav,.mp3,.ogg,.m4a,.flac). */
const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "audio/aiff": "aiff",
  "audio/x-aiff": "aiff",
};

/** Extensions some browsers report with an empty/generic MIME type. */
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  webm: "audio/webm",
  aif: "audio/aiff",
  aiff: "audio/aiff",
};

/** The content type the rail will accept for this file, or null when
 *  the file isn't a saveable audio type. Uses the browser's reported
 *  type first, then the file extension (some browsers hand back an
 *  empty type for .flac/.m4a picks). */
export function beatSampleContentTypeForFile(file: { name: string; type: string }): string | null {
  const reported = (file.type ?? "").trim().toLowerCase();
  if (reported && CONTENT_TYPE_EXTENSIONS[reported]) return reported;
  const ext = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return EXTENSION_CONTENT_TYPES[ext] ?? null;
}

export type BeatSampleFileVerdict =
  | { ok: true; contentType: string }
  | { ok: false; reason: "too-large" | "unsupported-type" };

/** Client-side mirror of the server's door rules, checked before any
 *  bytes move: a file the rail would refuse is never uploaded, and the
 *  page can say exactly why the sound stays session-only. */
export function validateBeatSampleFile(file: { name: string; type: string; size: number }): BeatSampleFileVerdict {
  const contentType = beatSampleContentTypeForFile(file);
  if (!contentType) return { ok: false, reason: "unsupported-type" };
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > BEAT_SAMPLE_MAX_BYTES) {
    return { ok: false, reason: "too-large" };
  }
  return { ok: true, contentType };
}

/** "upload:<id>" for a saved sample row id. */
export function beatSampleSoundId(sampleId: string): string {
  return `upload:${sampleId}`;
}

const PERSISTED_SOUND_ID = /^upload:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The sample row id inside a durable registry id, or null when the id
 *  is not a saved-library id (session upload ids are timestamp-based
 *  and never match this shape). */
export function sampleIdFromBeatSoundId(soundId: string | null | undefined): string | null {
  if (typeof soundId !== "string") return null;
  const m = PERSISTED_SOUND_ID.exec(soundId.trim());
  return m ? m[1]! : null;
}

/** True when a registry sound id names a saved library sample. */
export function isPersistedBeatSoundId(soundId: string | null | undefined): boolean {
  return sampleIdFromBeatSoundId(soundId) != null;
}

type FetchImpl = typeof fetch;

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function readError(res: Response, fallback: string): Promise<Error> {
  const data = await res.json().catch(() => ({}));
  return new Error(apiErrorMessage(data, fallback));
}

function normalizeRecord(raw: unknown): BeatSampleRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<BeatSampleRecord>;
  if (typeof r.id !== "string" || r.id === "") return null;
  if (typeof r.name !== "string" || r.name.trim() === "") return null;
  if (typeof r.url !== "string" || r.url.trim() === "") return null;
  return {
    id: r.id,
    soundId: typeof r.soundId === "string" && r.soundId !== "" ? r.soundId : beatSampleSoundId(r.id),
    name: r.name,
    kind: (typeof r.kind === "string" ? r.kind : "perc") as BeatSoundKind,
    contentType: typeof r.contentType === "string" ? r.contentType : "",
    sizeBytes: typeof r.sizeBytes === "number" ? r.sizeBytes : 0,
    url: r.url,
    ...(typeof r.createdAt === "string" ? { createdAt: r.createdAt } : {}),
  };
}

/**
 * Save one sound file to the creator's library: declare it, PUT the
 * bytes to the presigned URL, then confirm — the returned record is
 * ready only because the server verified the landed object. Throws
 * (with the server's plain words where it gave them) on ANY failure,
 * including a file the door rules refuse — callers keep the session
 * sound and say it wasn't saved.
 */
export async function persistBeatSample(args: {
  token: string;
  file: File;
  name: string;
  kind: BeatSoundKind;
  fetcher?: FetchImpl;
}): Promise<BeatSampleRecord> {
  const fetcher = args.fetcher ?? fetch;
  const verdict = validateBeatSampleFile(args.file);
  if (!verdict.ok) {
    throw new Error(
      verdict.reason === "too-large"
        ? "That sound is over the 20 MB library limit."
        : "That file type can't be saved to your library.",
    );
  }
  const createRes = await fetcher("/api/beat-samples", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(args.token) },
    body: JSON.stringify({
      name: args.name,
      kind: args.kind,
      contentType: verdict.contentType,
      sizeBytes: args.file.size,
    }),
  });
  if (!createRes.ok) throw await readError(createRes, "Couldn't start saving that sound.");
  const created = (await createRes.json()) as { sample?: { id?: string }; uploadUrl?: string };
  const sampleId = created.sample?.id;
  const uploadUrl = created.uploadUrl;
  if (!sampleId || !uploadUrl) throw new Error("Couldn't start saving that sound.");

  const put = await fetcher(uploadUrl, {
    method: "PUT",
    body: args.file,
    headers: { "Content-Type": verdict.contentType },
  });
  if (!put.ok) throw new Error("The sound file couldn't be uploaded — check your connection and try again.");

  const completeRes = await fetcher(`/api/beat-samples/${sampleId}/complete`, {
    method: "POST",
    headers: authHeaders(args.token),
  });
  if (!completeRes.ok) throw await readError(completeRes, "Couldn't finish saving that sound.");
  const done = (await completeRes.json()) as { sample?: unknown };
  const record = normalizeRecord(done.sample);
  if (!record) throw new Error("Couldn't finish saving that sound.");
  return record;
}

/** The signed-in creator's saved samples (ready only — the rail never
 *  lists pending rows). Throws on failure so the caller can choose its
 *  honest degraded state; a signed-out caller gets an empty library. */
export async function fetchBeatSamples(
  token: string | null,
  fetcher: FetchImpl = fetch,
): Promise<BeatSampleRecord[]> {
  if (!token) return [];
  const res = await fetcher("/api/beat-samples", { headers: authHeaders(token) });
  if (!res.ok) throw await readError(res, "Couldn't load your sound library.");
  const data = (await res.json()) as { samples?: unknown[] };
  return (data.samples ?? [])
    .map(normalizeRecord)
    .filter((r): r is BeatSampleRecord => r != null);
}

/** Remove one saved sample (row + stored object, server-side). */
export async function deleteBeatSample(
  token: string,
  sampleId: string,
  fetcher: FetchImpl = fetch,
): Promise<void> {
  const res = await fetcher(`/api/beat-samples/${sampleId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw await readError(res, "Couldn't remove that sound from your library.");
}

/** Registry entries for saved samples — the manifest shape the bank
 *  seam consumes, with source "upload" and the durable URL. */
export function beatSampleManifestEntries(records: readonly BeatSampleRecord[]): BeatSoundManifestEntry[] {
  return records.map((r) => ({
    id: r.soundId,
    name: r.name,
    kind: r.kind,
    source: "upload" as const,
    url: r.url,
  }));
}

/** Picker-ready registry entries for saved samples. */
export function beatSampleEntries(records: readonly BeatSampleRecord[]): BeatSoundEntry[] {
  return records.map((r) => ({
    id: r.soundId,
    name: r.name,
    kind: r.kind,
    source: "upload" as const,
    url: r.url,
    defaultVolume: 1,
  }));
}

/** Rehydrate the library into the sound registry through the manifest
 *  seam — after this call a saved project's `upload:<id>` assignments
 *  resolve to real entries (buffers load on demand via
 *  ensureBeatSampleBuffer). Returns how many were registered. */
export function registerBeatSampleLibrary(records: readonly BeatSampleRecord[]): number {
  return registerBeatSoundManifest(beatSampleManifestEntries(records));
}
