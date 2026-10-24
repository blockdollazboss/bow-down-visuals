import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/* ─── AI-disclosure metadata embedding (Stack-100 #3, feature lane F7) ────
   When the export disclosure toggle is ON, the disclosure rides INSIDE the
   exported file, in the metadata layer each format honestly supports:

   • Images — an XMP packet (dc:description + photoshop:Credit +
     xmp:CreatorTool) injected into JPEG (APP1), PNG (iTXt) and WebP
     (XMP chunk) by pure Buffer surgery below. No re-encode: pixels are
     byte-identical, only a metadata chunk is added.
   • Audio — ffmpeg `-metadata` on the export encode itself (ID3v2 for
     MP3, INFO for WAV): comment + a dedicated ai_disclosure tag on top of
     the attribution tags the mix export already writes.
   • Video — a post-encode stream-copy remux that writes MP4/MOV metadata
     (comment + description + ai_disclosure). No re-encode, no quality
     change; if the stamp fails the unstamped export still ships.

   This is metadata, not watermarking and NOT C2PA signing: it can be
   stripped by anyone, and the module never claims otherwise. It exists so
   honest files self-describe — which is what YouTube/TikTok/Meta
   disclosure flows and the EU AI Act transparency duties ask creators
   to do. */

export interface DisclosureStampInfo {
  /** e.g. "AI-generated content · Made with Make a Song (ElevenLabs…) on Bow Down Visuals — …" */
  text: string;
  /** The tool that made the work, for xmp:CreatorTool. */
  tool: string;
  /** The work's title, for dc:title. */
  title?: string;
  /** Creator display name, for dc:creator. */
  creator?: string | null;
}

/* ─── XMP packet ────────────────────────────────────────────────────────── */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildXmpPacket(info: DisclosureStampInfo): string {
  const title = info.title ? xmlEscape(info.title) : "";
  const creator = info.creator ? xmlEscape(info.creator) : "";
  return (
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Bow Down Visuals">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">` +
    (title ? `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>` : "") +
    (creator ? `<dc:creator><rdf:Seq><rdf:li>${creator}</rdf:li></rdf:Seq></dc:creator>` : "") +
    `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(info.text)}</rdf:li></rdf:Alt></dc:description>` +
    `<photoshop:Credit>Bow Down Visuals</photoshop:Credit>` +
    `<xmp:CreatorTool>${xmlEscape(info.tool)}</xmp:CreatorTool>` +
    `</rdf:Description></rdf:RDF></x:xmpmeta>`
  );
}

/* ─── CRC32 (PNG) ───────────────────────────────────────────────────────── */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ─── Format detection ──────────────────────────────────────────────────── */
export type ImageFormat = "jpeg" | "png" | "webp";

export function detectImageFormat(buf: Buffer): ImageFormat | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

/* ─── JPEG: XMP APP1 segment right after SOI ────────────────────────────── */
const XMP_HEADER = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "ascii");

export function injectXmpIntoJpeg(buf: Buffer, xmp: string): Buffer {
  const payload = Buffer.concat([XMP_HEADER, Buffer.from(xmp, "utf8")]);
  const segment = Buffer.alloc(4);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([buf.subarray(0, 2), segment, payload, buf.subarray(2)]);
}

/* ─── PNG: iTXt chunk (keyword "XML:com.adobe.xmp") after IHDR ──────────── */
function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function injectXmpIntoPng(buf: Buffer, xmp: string): Buffer {
  const keyword = Buffer.from("XML:com.adobe.xmp", "ascii");
  const data = Buffer.concat([
    keyword,
    Buffer.from([0x00, 0x00, 0x00]), // null sep, compression flag 0, method 0
    Buffer.from([0x00]), // empty language tag + null
    Buffer.from([0x00]), // empty translated keyword + null
    Buffer.from(xmp, "utf8"),
  ]);
  const chunk = pngChunk("iTXt", data);
  /* IHDR is always the first chunk: 8-byte signature + 4 len + 4 type + 13 data + 4 crc = 33. */
  const ihdrEnd = 8 + 12 + buf.readUInt32BE(8);
  return Buffer.concat([buf.subarray(0, ihdrEnd), chunk, buf.subarray(ihdrEnd)]);
}

/* ─── WebP: XMP chunk + VP8X flag ───────────────────────────────────────── */
export function injectXmpIntoWebp(buf: Buffer, xmp: string): Buffer {
  const xmpData = Buffer.from(xmp, "utf8");
  const chunk = Buffer.alloc(8 + xmpData.length + (xmpData.length % 2));
  chunk.write("XMP ", 0, "ascii");
  chunk.writeUInt32LE(xmpData.length, 4);
  xmpData.copy(chunk, 8);

  let out = Buffer.concat([buf, chunk]);
  /* If a VP8X header chunk exists, set its XMP flag (feature bits byte,
     offset 4 within the VP8X data; XMP = bit 2 → 0x04) so strict readers
     honour the chunk. Without VP8X (simple VP8/VP8L) the trailing chunk
     is still written — readers that scan chunks will find it. */
  if (out.toString("ascii", 12, 16) === "VP8X" && out.length >= 30) {
    const patched = Buffer.from(out);
    patched[20] = patched[20]! | 0x04;
    out = patched;
  }
  const sized = Buffer.from(out);
  sized.writeUInt32LE(out.length - 8, 4);
  return sized;
}

/* ─── Image dispatcher ──────────────────────────────────────────────────── */
export interface StampResult {
  buffer: Buffer;
  applied: boolean;
  format: ImageFormat | null;
  reason?: string;
}

export function stampImageWithDisclosure(buf: Buffer, info: DisclosureStampInfo): StampResult {
  const format = detectImageFormat(buf);
  if (!format) return { buffer: buf, applied: false, format: null, reason: "unrecognized image format" };
  const xmp = buildXmpPacket(info);
  try {
    const stamped =
      format === "jpeg" ? injectXmpIntoJpeg(buf, xmp) : format === "png" ? injectXmpIntoPng(buf, xmp) : injectXmpIntoWebp(buf, xmp);
    return { buffer: stamped, applied: true, format };
  } catch (err) {
    return { buffer: buf, applied: false, format, reason: err instanceof Error ? err.message : "stamp failed" };
  }
}

/* ─── ffmpeg metadata args (audio + video) ──────────────────────────────── */
export function audioDisclosureMetadataArgs(info: DisclosureStampInfo): string[] {
  return [
    "-metadata", `comment=${info.text}`,
    "-metadata", `ai_disclosure=${info.text}`,
    "-metadata", "publisher=Bow Down Visuals",
    "-metadata", "website=https://bowdownvisuals.com",
  ];
}

export function videoDisclosureMetadataArgs(info: DisclosureStampInfo): string[] {
  /* No ai_disclosure key here: the MP4/MOV muxer silently DROPS unknown
     metadata keys (proven by ffprobe readback in the lane tests), so a tag
     that never reaches the file would be a false promise. The disclosure
     rides in comment + description, which the container honestly keeps.
     (Audio is different: ID3 keeps a custom ai_disclosure frame — see
     audioDisclosureMetadataArgs.) */
  const args = [
    "-metadata", `comment=${info.text}`,
    "-metadata", `description=${info.text}`,
  ];
  if (info.title) args.push("-metadata", `title=${info.title}`);
  return args;
}

/* ─── File stamping via an ffmpeg stream-copy remux (video) ───────────────
   Returns true when the stamped file was written. Never throws — a failed
   stamp must never fail the export it rides on. */
export async function stampVideoFileWithDisclosure(
  inputPath: string,
  outputPath: string,
  info: DisclosureStampInfo,
  timeoutMs = 120_000,
): Promise<boolean> {
  try {
    await execFileAsync(
      "ffmpeg",
      ["-y", "-i", inputPath, "-c", "copy", ...videoDisclosureMetadataArgs(info), "-movflags", "+faststart", outputPath],
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    return false;
  }
}
