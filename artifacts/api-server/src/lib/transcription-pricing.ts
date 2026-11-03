/**
 * transcription-pricing.ts — length-based price for the transcription
 * rails (POST /api/transcribe and POST /api/transcribe-url in
 * routes/transcribe.ts).
 *
 * Owner ruling (2026-11-02, by delegation): transcription is
 * 100 Visual Bucs flat for up to 5 minutes of audio, then
 * +20 Visual Bucs per additional minute, rounded up. This replaces
 * the old flat 100 VB at any length (provider cost ~$0.006/min keeps
 * the margin >10x even at the worst credit rate). Examples pinned by
 * tests: 5 min = 100, 6 min = 120, 11 min = 220.
 *
 * Where the duration comes from — and what is NOT used:
 * The duration is measured SERVER-SIDE from the actual audio bytes
 * with ffprobe (shipped in the production image; the same tool the
 * export pipeline and stem separation already probe durations with)
 * BEFORE any charge, so the full length price is charged once, up
 * front, before the paid provider call — never a client-supplied
 * duration (a client can under-report its own file), and never a
 * post-hoc top-up charge after the transcript is produced.
 *
 * Honest fallback: if ffprobe cannot read a duration (missing binary,
 * corrupt header), the price falls back to the flat base 100 VB and
 * the caller logs the fallback. Such a file almost always fails the
 * provider call too (and is then refunded in full); the fallback is
 * a documented under-charge risk on that rare path, NOT a silently
 * invented duration.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

/** Flat price covering the first TRANSCRIBE_INCLUDED_MINUTES. */
export const TRANSCRIBE_BASE_CREDIT_COST = 100;
/** Minutes of audio included in the flat base price. */
export const TRANSCRIBE_INCLUDED_MINUTES = 5;
/** Price per additional minute (rounded up) beyond the included ones. */
export const TRANSCRIBE_EXTRA_MINUTE_CREDIT_COST = 20;

/**
 * The transcription price in Visual Bucs for an audio duration.
 * Pure — exported for tests.
 *
 * `durationSeconds` null/undefined/non-finite/<= 0 means the duration
 * could not be measured: the flat base price is returned (see the
 * fallback note in the file header).
 */
export function transcribeCreditCost(durationSeconds: number | null | undefined): number {
  if (
    durationSeconds === null ||
    durationSeconds === undefined ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return TRANSCRIBE_BASE_CREDIT_COST;
  }
  const minutes = Math.ceil(durationSeconds / 60);
  if (minutes <= TRANSCRIBE_INCLUDED_MINUTES) return TRANSCRIBE_BASE_CREDIT_COST;
  return (
    TRANSCRIBE_BASE_CREDIT_COST +
    (minutes - TRANSCRIBE_INCLUDED_MINUTES) * TRANSCRIBE_EXTRA_MINUTE_CREDIT_COST
  );
}

/** ffprobe on a ≤25 MB in-memory file is decode-free header work; 15 s is generous. */
const PROBE_TIMEOUT_MS = 15_000;

/**
 * Measure an in-memory audio file's duration in seconds by probing
 * the actual bytes with ffprobe (written to a scratch temp file —
 * the ffprobe/ffmpeg demuxers seek, so stdin does not work; the same
 * lesson lib/melody-analysis.ts records).
 *
 * Returns null on ANY failure (ffprobe missing, unparseable file,
 * non-positive duration) — callers price that case with
 * transcribeCreditCost(null), the documented flat-base fallback.
 * Never throws.
 */
export async function probeAudioDurationSeconds(
  buffer: Buffer,
  filename?: string,
): Promise<number | null> {
  const rawExt = filename ? extname(filename).toLowerCase() : "";
  const ext = /^\.[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : ".bin";
  const inPath = join(tmpdir(), `${randomUUID()}-transcribe-probe${ext}`);
  try {
    await writeFile(inPath, buffer);
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        inPath,
      ],
      { timeout: PROBE_TIMEOUT_MS },
    );
    const secs = Number(stdout.trim());
    if (!Number.isFinite(secs) || secs <= 0) return null;
    return secs;
  } catch {
    return null;
  } finally {
    await unlink(inPath).catch(() => {});
  }
}
