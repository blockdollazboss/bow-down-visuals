/**
 * stems-player.ts — N14 Stems Player (fan-facing playback layer).
 *
 * The data source is the Stem Splitter's own output model
 * (routes/generate/stem-splitter.ts): a split job produces per-stem
 * files at `stems/<userId>/<jobId>/<key>.wav` in the private
 * generated-clips bucket, held on the job as `stemRefs` (stable
 * r2:// / supabase:// storage refs) and `stemUrls` (signed URLs minted
 * from those refs). Keys: vocals | drums | bass | other, plus the Pro
 * tier's guitar | piano. A track "carries stems" exactly when a
 * track_stems row (provisional migration 9999) holds those refs for it.
 *
 * PLAYBACK ONLY — the hard boundary:
 *  - Stored values are refs; refs are never sent to a client.
 *  - The only client-facing delivery is the playback endpoint, which
 *    mints fresh short-lived signed URLs per stem — the same delivery
 *    pattern the master track audio uses (audio_url is likewise
 *    re-signed on read via refreshSupabaseStorageUrl). No download
 *    endpoint, no export path, no Content-Disposition anywhere here.
 *  - If signing fails and the refresher hands back the raw ref, that
 *    stem is dropped from the playback payload rather than leaking
 *    an unplayable raw ref to the client.
 */
import { ALL_STEM_KEYS, ALL_STEM_LABELS, type AnyStemKey } from "../routes/generate/stem-splitter";
import { isMissingSchemaError } from "./pg-errors";

export type StemPlayerKey = AnyStemKey;

/** Canonical stem order (the splitter's own key order). */
export const STEM_PLAYER_KEYS: readonly StemPlayerKey[] = ALL_STEM_KEYS;

export const STEM_PLAYER_LABELS: Record<StemPlayerKey, string> = ALL_STEM_LABELS;

export interface StemDescriptor {
  key: StemPlayerKey;
  label: string;
}

/**
 * Normalize a stored stems value (jsonb — anything could be in there)
 * into the ordered list of stems that actually exist. Unknown keys,
 * non-string/empty refs and duplicates are dropped. Returns [] when
 * the track carries no usable stems — callers render NO controls.
 */
export function normalizeTrackStemRefs(raw: unknown): Array<StemDescriptor & { ref: string }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const rec = raw as Record<string, unknown>;
  const out: Array<StemDescriptor & { ref: string }> = [];
  for (const key of STEM_PLAYER_KEYS) {
    const ref = rec[key];
    if (typeof ref === "string" && ref.trim() !== "") {
      out.push({ key, label: STEM_PLAYER_LABELS[key], ref });
    }
  }
  return out;
}

/** Keys + labels only — the shape safe to put in a track DTO.
 *  Carries NO refs and NO URLs, so a track payload can advertise
 *  "this song has stems" without exposing any stem audio address. */
export function stemDescriptors(raw: unknown): StemDescriptor[] | null {
  const stems = normalizeTrackStemRefs(raw);
  if (stems.length === 0) return null;
  return stems.map(({ key, label }) => ({ key, label }));
}

/**
 * Normalize a completed Stem Splitter job's refs for attachment to a
 * track. Takes the job's stemRefs (stable refs) — never its stemUrls.
 * Returns null when the job carries no usable refs.
 */
export function stemRefsFromJob(job: { stemRefs: unknown } | null | undefined): Record<string, string> | null {
  const stems = normalizeTrackStemRefs(job?.stemRefs);
  if (stems.length === 0) return null;
  const out: Record<string, string> = {};
  for (const s of stems) out[s.key] = s.ref;
  return out;
}

/** A minted playback URL is only sendable when it is a real http(s)
 *  URL — a raw storage ref (supabase:// / r2://) means signing failed
 *  and the value must never reach a client. */
export function isSendablePlaybackUrl(url: unknown): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

/** Pre-migration guard: the track_stems table lands via provisional
 *  migration 9999. Reads degrade to "no stems"; writes answer 503. */
export function isMissingTrackStemsSchema(err: unknown): boolean {
  return isMissingSchemaError(err);
}
