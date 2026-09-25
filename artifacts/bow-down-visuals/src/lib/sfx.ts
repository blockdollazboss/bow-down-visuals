/* Pure helpers for Text-to-SFX (/sfx).
   Kept in a lib module so they are unit-testable without React.

   - Store-only ZIP builder (no dependency): WAV/MP3 files barely compress,
     so STORED entries are honest and fast.
   - 16-bit PCM → WAV byte encoder: the WAV container is built from raw
     samples here; decoding MP3 bytes into samples happens in the page via
     the Web Audio API (needs a real AudioContext). */

export const SFX_LIBRARY_KEY = "bdv-sfx-library";
export const SFX_LIBRARY_LIMIT = 50;

export interface SfxItem {
  id: string;
  prompt: string;
  category: string;
  durationSeconds: number;
  url: string;
  createdAt: string;
}

/* ─── Library (localStorage) ───────────────────────────────────────────── */

export function loadSfxLibrary(
  storage: Pick<Storage, "getItem"> = localStorage,
): SfxItem[] {
  try {
    const raw = storage.getItem(SFX_LIBRARY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? (parsed as SfxItem[]).slice(0, SFX_LIBRARY_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function saveSfxItem(
  prev: SfxItem[],
  item: SfxItem,
  storage: Pick<Storage, "setItem"> = localStorage,
): SfxItem[] {
  const next = [item, ...prev.filter((i) => i.id !== item.id)].slice(
    0,
    SFX_LIBRARY_LIMIT,
  );
  try {
    storage.setItem(SFX_LIBRARY_KEY, JSON.stringify(next));
  } catch {
    /* storage full — library is a nicety, not a blocker */
  }
  return next;
}

export function removeSfxItem(
  prev: SfxItem[],
  id: string,
  storage: Pick<Storage, "setItem"> = localStorage,
): SfxItem[] {
  const next = prev.filter((i) => i.id !== id);
  try {
    storage.setItem(SFX_LIBRARY_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

/* ─── CRC32 (needed for valid ZIP entries) ─────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* ─── Store-only ZIP builder ─────────────────────────────────────────────
   Builds a valid .zip with STORED (uncompressed) entries. Enough for a
   sound-pack export; every major unzipper accepts it. */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}
function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

export function createZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const nameBytes = entries.map((e) => encoder.encode(e.name));

  let localSize = 0;
  let centralSize = 0;
  for (let i = 0; i < entries.length; i++) {
    localSize += 30 + nameBytes[i]!.length + entries[i]!.data.length;
    centralSize += 46 + nameBytes[i]!.length;
  }
  const total = localSize + centralSize + 22;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  let p = 0;
  const centralOffsets: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const nb = nameBytes[i]!;
    const crc = crc32(entry.data);
    centralOffsets.push(p);
    /* local file header */
    writeU32(view, p, 0x04034b50); p += 4;
    writeU16(view, p, 20); p += 2; // version needed
    writeU16(view, p, 0x0800); p += 2; // UTF-8 flag
    writeU16(view, p, 0); p += 2; // method: stored
    writeU16(view, p, 0); p += 2; // mod time
    writeU16(view, p, 0); p += 2; // mod date
    writeU32(view, p, crc); p += 4;
    writeU32(view, p, entry.data.length); p += 4;
    writeU32(view, p, entry.data.length); p += 4;
    writeU16(view, p, nb.length); p += 2;
    writeU16(view, p, 0); p += 2; // extra len
    out.set(nb, p); p += nb.length;
    out.set(entry.data, p); p += entry.data.length;
  }

  const centralStart = p;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const nb = nameBytes[i]!;
    const crc = crc32(entry.data);
    writeU32(view, p, 0x02014b50); p += 4; // central header sig
    writeU16(view, p, 20); p += 2; // version made by
    writeU16(view, p, 20); p += 2; // version needed
    writeU16(view, p, 0x0800); p += 2; // UTF-8 flag
    writeU16(view, p, 0); p += 2; // method: stored
    writeU16(view, p, 0); p += 2;
    writeU16(view, p, 0); p += 2;
    writeU32(view, p, crc); p += 4;
    writeU32(view, p, entry.data.length); p += 4;
    writeU32(view, p, entry.data.length); p += 4;
    writeU16(view, p, nb.length); p += 2;
    writeU16(view, p, 0); p += 2; // extra
    writeU16(view, p, 0); p += 2; // comment
    writeU16(view, p, 0); p += 2; // disk
    writeU16(view, p, 0); p += 2; // int attrs
    writeU32(view, p, 0); p += 4; // ext attrs
    writeU32(view, p, centralOffsets[i]!); p += 4;
    out.set(nb, p); p += nb.length;
  }

  /* end of central directory */
  writeU32(view, p, 0x06054b50); p += 4;
  writeU16(view, p, 0); p += 2;
  writeU16(view, p, 0); p += 2;
  writeU16(view, p, entries.length); p += 2;
  writeU16(view, p, entries.length); p += 2;
  writeU32(view, p, centralSize); p += 4;
  writeU32(view, p, centralStart); p += 4;
  writeU16(view, p, 0); p += 2;

  return out;
}

/* ─── PCM → WAV (16-bit) ─────────────────────────────────────────────────
   Takes mono or multi-channel float samples (-1..1) + sample rate and
   returns a complete .wav file's bytes. */

export function encodeWav(
  channels: Float32Array[],
  sampleRate: number,
): Uint8Array {
  const numChannels = channels.length;
  const numSamples = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataBytes = numSamples * blockAlign;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  writeU32(view, 4, 36 + dataBytes);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  writeU32(view, 16, 16);
  writeU16(view, 20, 1); // PCM
  writeU16(view, 22, numChannels);
  writeU32(view, 24, sampleRate);
  writeU32(view, 28, sampleRate * blockAlign);
  writeU16(view, 32, blockAlign);
  writeU16(view, 34, 16); // bits per sample
  writeStr(36, "data");
  writeU32(view, 40, dataBytes);

  let p = 44;
  for (let s = 0; s < numSamples; s++) {
    for (let c = 0; c < numChannels; c++) {
      const v = Math.max(-1, Math.min(1, channels[c]![s]!));
      view.setInt16(p, Math.round(v * 32767), true);
      p += 2;
    }
  }
  return out;
}

/** Slugify a prompt for download filenames. */
export function sfxSlug(prompt: string): string {
  return (
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "sfx"
  );
}
