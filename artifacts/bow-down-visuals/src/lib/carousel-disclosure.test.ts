/* Carousel AI-disclosure PNG stamp (Stack-100 #3, more-provenance).
 * Slides render client-side, so the disclosure is stamped here, into the
 * PNG bytes: an XMP packet in an iTXt chunk after IHDR — the same format
 * the server stamper (api-server lib/disclosure-metadata.ts) writes.
 * Pins: the chunk is present with a valid CRC32, the disclosure text and
 * CreatorTool ride inside, the pixel chunks are byte-identical, and a
 * non-PNG input reports not-applied (caller ships it unstamped as
 * stamp_failed — never a failed export). */
import { describe, it, expect } from "vitest";
import {
  buildCarouselXmpPacket,
  crc32Bytes,
  injectXmpIntoPngBytes,
  stampPngBlobWithDisclosure,
  type CarouselDisclosure,
} from "./carousel-renderer";

/* 1x1 transparent PNG (same fixture style as the server suite). */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const INFO: CarouselDisclosure = {
  text: "AI-generated content · Made with Carousel Maker on Bow Down Visuals — bowdownvisuals.com",
  tool: "Carousel Maker",
  creator: "TRGDY TRBLZ",
};

interface PngChunk { type: string; data: Uint8Array; crcOk: boolean; offset: number }

function parseChunks(bytes: Uint8Array): PngChunk[] {
  const chunks: PngChunk[] = [];
  let off = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (off + 12 <= bytes.length) {
    const len = view.getUint32(off);
    const type = new TextDecoder().decode(bytes.subarray(off + 4, off + 8));
    const data = bytes.subarray(off + 8, off + 8 + len);
    const storedCrc = view.getUint32(off + 8 + len);
    const crcOk = crc32Bytes(bytes.subarray(off + 4, off + 8 + len)) === storedCrc;
    chunks.push({ type, data, crcOk, offset: off });
    off += 12 + len;
    if (type === "IEND") break;
  }
  return chunks;
}

describe("carousel PNG disclosure stamp", () => {
  it("builds an XMP packet carrying the disclosure text, tool and creator", () => {
    const xmp = buildCarouselXmpPacket(INFO);
    expect(xmp).toContain("AI-generated content");
    expect(xmp).toContain("<xmp:CreatorTool>Carousel Maker</xmp:CreatorTool>");
    expect(xmp).toContain("TRGDY TRBLZ");
    expect(xmp).toContain("<photoshop:Credit>Bow Down Visuals</photoshop:Credit>");
  });

  it("injects a CRC-valid iTXt chunk right after IHDR; pixels untouched", () => {
    const stamped = injectXmpIntoPngBytes(new Uint8Array(PNG_1X1), buildCarouselXmpPacket(INFO));
    expect(stamped).not.toBeNull();
    const chunks = parseChunks(stamped!);
    expect(chunks[0]!.type).toBe("IHDR");
    expect(chunks[1]!.type).toBe("iTXt");
    expect(chunks.every((c) => c.crcOk)).toBe(true);
    const itxt = new TextDecoder().decode(chunks[1]!.data);
    expect(itxt.startsWith("XML:com.adobe.xmp")).toBe(true);
    expect(itxt).toContain("AI-generated content");
    expect(itxt).toContain("Carousel Maker");
    /* Everything after IHDR in the original must survive byte-identical
       after the inserted chunk: pixels/metadata are never re-encoded. */
    const ihdrEnd = 8 + 12 + new DataView(PNG_1X1.buffer, PNG_1X1.byteOffset).getUint32(8);
    const tailOriginal = PNG_1X1.subarray(ihdrEnd);
    const tailStamped = stamped!.subarray(ihdrEnd + (stamped!.length - PNG_1X1.length));
    expect(Buffer.from(tailStamped).equals(tailOriginal)).toBe(true);
  });

  it("rejects non-PNG bytes instead of corrupting them", () => {
    expect(injectXmpIntoPngBytes(new Uint8Array([1, 2, 3, 4]), "<x/>")).toBeNull();
    const jpegish = new Uint8Array(64);
    jpegish[0] = 0xff; jpegish[1] = 0xd8; jpegish[2] = 0xff;
    expect(injectXmpIntoPngBytes(jpegish, "<x/>")).toBeNull();
  });

  it("stampPngBlobWithDisclosure applies to a PNG blob and reports honestly for others", async () => {
    const pngBlob = new Blob([PNG_1X1], { type: "image/png" });
    const ok = await stampPngBlobWithDisclosure(pngBlob, INFO);
    expect(ok.applied).toBe(true);
    const out = new Uint8Array(await ok.blob.arrayBuffer());
    expect(parseChunks(out)[1]!.type).toBe("iTXt");

    const notPng = new Blob([new Uint8Array([9, 9, 9])], { type: "image/png" });
    const failed = await stampPngBlobWithDisclosure(notPng, INFO);
    expect(failed.applied).toBe(false);
    expect(failed.blob).toBe(notPng); // original ships unstamped — stamp_failed, never a failed export
  });
});
