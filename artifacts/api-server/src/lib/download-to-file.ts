import { createWriteStream } from "fs";
import { unlink } from "fs/promises";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";

/** Stream a remote file straight to disk with a hard size cap — the file
 *  never accumulates in RAM. (2026-10-12 OOM follow-through: subtitle-
 *  styler, auto-captions and karaoke each downloaded up to 100 MB by
 *  concatenating every chunk into one Buffer, then wrote it out — a 100 MB
 *  spike plus a second full copy at concat time, on a 512 MB container.)
 *  Error wording matches the routes' historical messages exactly. */
export async function downloadToFileCapped(opts: {
  url: string;
  destPath: string;
  capBytes: number;
  /** "media" | "video" | "audio" — used in the failure message. */
  kindLabel: string;
  /** Used in the cap message: "<capLabel> is larger than the N MB limit." */
  capLabel: string;
  timeoutMs?: number;
}): Promise<void> {
  const { url, destPath, capBytes, kindLabel, capLabel, timeoutMs } = opts;
  const res = await fetch(url, timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : undefined);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${kindLabel} (HTTP ${res.status}).`);
  }
  let total = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.byteLength;
      if (total > capBytes) {
        cb(new Error(`${capLabel} is larger than the ${Math.round(capBytes / (1024 * 1024))} MB limit.`));
        return;
      }
      cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), cap, createWriteStream(destPath));
  } catch (err) {
    await unlink(destPath).catch(() => {});
    throw err;
  }
}
