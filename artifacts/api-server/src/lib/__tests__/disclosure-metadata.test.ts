/* AI-disclosure metadata (Stack-100 #3 lane F7) — byte-level proof.
 * Image stamps are pure Buffer surgery: the tests parse the containers
 * back (JPEG APP1 scan, PNG chunk walk with CRC verification, WebP chunk
 * scan + RIFF size) instead of trusting the writers. Audio/video stamps
 * run REAL ffmpeg on tiny generated media and read the tags back with
 * ffprobe. The mix-export test pins the toggle default: no opt-out in the
 * call → the disclosure is IN the exported MP3; aiDisclosure:false → the
 * attribution is there but the AI disclosure is not. */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  audioDisclosureMetadataArgs,
  buildXmpPacket,
  crc32,
  detectImageFormat,
  injectXmpIntoJpeg,
  injectXmpIntoPng,
  injectXmpIntoWebp,
  stampImageWithDisclosure,
  stampVideoFileWithDisclosure,
  videoDisclosureMetadataArgs,
  type DisclosureStampInfo,
} from "../disclosure-metadata";
import { isFfmpegAvailable, runMixExport, type ExportStemInput } from "../audioExport";

const execFileAsync = promisify(execFile);

const INFO: DisclosureStampInfo = {
  text: "AI-generated content · Made with Make a Song · ElevenLabs Music (music_v2_5) on Bow Down Visuals — bowdownvisuals.com",
  tool: "Make a Song",
  title: "Midnight Crown",
  creator: "TRGDY TRBLZ",
};

/* ── synthetic containers ─────────────────────────────────────────────── */
function minimalJpeg(): Buffer {
  /* SOI + APP0(JFIF) + DQT-ish filler + SOS marker is enough for the
     segment-level surgery; the injector only needs SOI. */
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0, 0x00, 0x10]),
    Buffer.from("JFIF\0", "ascii"),
    Buffer.alloc(9),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function minimalPng(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0); // width
  ihdrData.writeUInt32BE(1, 4); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // colour type RGBA
  const ihdr = Buffer.alloc(12 + 13);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdrData.copy(ihdr, 8);
  ihdr.writeUInt32BE(crc32(ihdr.subarray(4, 21)), 21);
  const iend = Buffer.alloc(12);
  iend.writeUInt32BE(0, 0);
  iend.write("IEND", 4, "ascii");
  iend.writeUInt32BE(crc32(iend.subarray(4, 8)), 8);
  return Buffer.concat([sig, ihdr, iend]);
}

function minimalWebpVp8x(): Buffer {
  const vp8x = Buffer.alloc(10);
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), Buffer.from("VP8X", "ascii"), Buffer.from([10, 0, 0, 0]), vp8x]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "ascii");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

function walkPngChunks(buf: Buffer): { type: string; data: Buffer; crcOk: boolean }[] {
  const chunks: { type: string; data: Buffer; crcOk: boolean }[] = [];
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    const stored = buf.readUInt32BE(off + 8 + len);
    chunks.push({ type, data, crcOk: stored === crc32(buf.subarray(off + 4, off + 8 + len)) });
    off += 12 + len;
    if (type === "IEND") break;
  }
  return chunks;
}

describe("buildXmpPacket", () => {
  it("carries description, credit, tool, title and creator, XML-escaped", () => {
    const packet = buildXmpPacket({ ...INFO, title: 'A "quoted" <title> & more' });
    expect(packet).toContain("AI-generated content");
    expect(packet).toContain("<photoshop:Credit>Bow Down Visuals</photoshop:Credit>");
    expect(packet).toContain("<xmp:CreatorTool>Make a Song</xmp:CreatorTool>");
    expect(packet).toContain("A &quot;quoted&quot; &lt;title&gt; &amp; more");
    expect(packet).toContain("TRGDY TRBLZ");
  });
});

describe("image format detection + stamping", () => {
  it("detects jpeg/png/webp and rejects strangers", () => {
    expect(detectImageFormat(minimalJpeg())).toBe("jpeg");
    expect(detectImageFormat(minimalPng())).toBe("png");
    expect(detectImageFormat(minimalWebpVp8x())).toBe("webp");
    expect(detectImageFormat(Buffer.from("GIF89a......"))).toBeNull();
    const res = stampImageWithDisclosure(Buffer.from("GIF89a......"), INFO);
    expect(res.applied).toBe(false);
    expect(res.buffer.toString("ascii")).toContain("GIF89a");
  });

  it("JPEG: an APP1 XMP segment lands right after SOI and scans back", () => {
    const stamped = injectXmpIntoJpeg(minimalJpeg(), buildXmpPacket(INFO));
    expect(stamped[0]).toBe(0xff);
    expect(stamped[1]).toBe(0xd8);
    expect(stamped[2]).toBe(0xff);
    expect(stamped[3]).toBe(0xe1); // APP1
    const len = stamped.readUInt16BE(4);
    const payload = stamped.subarray(6, 4 + len).toString("utf8");
    expect(payload.startsWith("http://ns.adobe.com/xap/1.0/\0")).toBe(true);
    expect(payload).toContain("AI-generated content");
    /* the original APP0 survives right after the inserted segment */
    expect(stamped[4 + len]).toBe(0xff);
    expect(stamped[4 + len + 1]).toBe(0xe0);
  });

  it("PNG: an iTXt XMP chunk lands after IHDR with a valid CRC", () => {
    const stamped = injectXmpIntoPng(minimalPng(), buildXmpPacket(INFO));
    const chunks = walkPngChunks(stamped);
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "iTXt", "IEND"]);
    expect(chunks.every((c) => c.crcOk)).toBe(true);
    const itxt = chunks[1]!.data;
    expect(itxt.toString("ascii", 0, 17)).toBe("XML:com.adobe.xmp");
    expect(itxt.toString("utf8")).toContain("AI-generated content");
  });

  it("WebP: an XMP chunk is appended, the VP8X flag is set, RIFF size is exact", () => {
    const stamped = injectXmpIntoWebp(minimalWebpVp8x(), buildXmpPacket(INFO));
    expect(stamped.indexOf("XMP ")).toBeGreaterThan(0);
    expect(stamped.toString("utf8")).toContain("AI-generated content");
    expect(stamped.readUInt32LE(4)).toBe(stamped.length - 8);
    expect(stamped[20]! & 0x04).toBe(0x04); // VP8X XMP feature flag
  });

  it("dispatcher stamps all three formats", () => {
    for (const buf of [minimalJpeg(), minimalPng(), minimalWebpVp8x()]) {
      const res = stampImageWithDisclosure(buf, INFO);
      expect(res.applied).toBe(true);
      expect(res.buffer.toString("utf8")).toContain("AI-generated content");
      expect(res.buffer.length).toBeGreaterThan(buf.length);
    }
  });
});

describe("ffmpeg metadata args", () => {
  it("audio args carry comment + ai_disclosure + the standing attribution", () => {
    const args = audioDisclosureMetadataArgs(INFO);
    const joined = args.join(" ");
    expect(joined).toContain(`comment=${INFO.text}`);
    expect(joined).toContain(`ai_disclosure=${INFO.text}`);
    expect(joined).toContain("publisher=Bow Down Visuals");
  });

  it("video args carry comment, description and title — no ai_disclosure (the MP4 muxer drops unknown keys)", () => {
    const args = videoDisclosureMetadataArgs(INFO);
    const joined = args.join(" ");
    expect(joined).toContain(`comment=${INFO.text}`);
    expect(joined).toContain(`description=${INFO.text}`);
    expect(joined).toContain(`title=${INFO.title}`);
    expect(joined).not.toContain("ai_disclosure");
  });
});

/* ── real-ffmpeg proofs ───────────────────────────────────────────────── */
describe("real ffmpeg stamps (byte/tag readback)", () => {
  let ffmpegOk = false;
  let work = "";

  beforeAll(async () => {
    ffmpegOk = await isFfmpegAvailable();
    work = await mkdtemp(join(tmpdir(), "bdv-disclosure-"));
  });

  async function probeFormatTags(file: string): Promise<Record<string, string>> {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet", "-print_format", "json", "-show_format", file,
    ]);
    return (JSON.parse(stdout) as { format?: { tags?: Record<string, string> } }).format?.tags ?? {};
  }

  it("video: a stamped MP4 reads its disclosure tags back via ffprobe", async () => {
    if (!ffmpegOk) return;
    const src = join(work, "clip.mp4");
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.5:r=10",
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", src,
    ]);
    const out = join(work, "clip-stamped.mp4");
    const ok = await stampVideoFileWithDisclosure(src, out, INFO);
    expect(ok).toBe(true);
    const tags = await probeFormatTags(out);
    expect(tags["comment"]).toContain("AI-generated content");
    expect(tags["description"]).toContain("AI-generated content");
    expect(tags["title"]).toBe("Midnight Crown");
    /* stream copy: the stamped file is still a playable MP4 of the same length */
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet", "-print_format", "json", "-show_format", out,
    ]);
    expect(Number((JSON.parse(stdout) as { format: { duration: string } }).format.duration)).toBeGreaterThan(0.3);
  }, 60000);

  it("video: a missing input resolves false instead of throwing", async () => {
    if (!ffmpegOk) return;
    const ok = await stampVideoFileWithDisclosure(join(work, "nope.mp4"), join(work, "out.mp4"), INFO);
    expect(ok).toBe(false);
  }, 60000);
});

/* ── the mix-export toggle, proven in exported bytes ──────────────────── */
function sineWav(seconds: number, freq: number): Buffer {
  const rate = 48000;
  const n = Math.floor(rate * seconds);
  const data = Buffer.alloc(44 + n * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + n * 2, 4);
  data.write("WAVE", 8);
  data.write("fmt ", 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 12000), 44 + i * 2);
  }
  return data;
}

describe("runMixExport — AI-disclosure toggle in the exported MP3", () => {
  let ffmpegOk = false;
  const prevEnv = process.env["SUPABASE_URL"];

  beforeAll(async () => {
    ffmpegOk = await isFfmpegAvailable();
    process.env["SUPABASE_URL"] = "https://stems.example.test";
    const body = sineWav(1, 330);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(body, { status: 200, headers: { "content-length": String(body.length) } }),
      ),
    );
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    if (prevEnv === undefined) delete process.env["SUPABASE_URL"];
    else process.env["SUPABASE_URL"] = prevEnv;
  });

  const stems: ExportStemInput[] = [
    {
      id: "s1",
      name: "Beat",
      type: "Beat",
      url: "https://stems.example.test/beat.wav",
      volume: 100,
      muted: false,
      trimStart: 0,
      trimEnd: 0,
      durationSec: 1,
    },
  ];

  async function exportTags(opts: { aiDisclosure?: boolean }): Promise<Record<string, string>> {
    const result = await runMixExport({ stems, masterVolume: 100, format: "mp3", ...opts });
    const file = join(await mkdtemp(join(tmpdir(), "bdv-mix-")), "mix.mp3");
    await writeFile(file, result.buffer);
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet", "-print_format", "json", "-show_format", file,
    ]);
    return (JSON.parse(stdout) as { format?: { tags?: Record<string, string> } }).format?.tags ?? {};
  }

  it("DEFAULT (no opt-out passed): the MP3 carries the AI disclosure", async () => {
    if (!ffmpegOk) return;
    const tags = await exportTags({});
    const all = Object.values(tags).join(" ");
    expect(all).toContain("AI-generated content");
    expect(all).toContain("Bow Down Visuals");
  }, 60000);

  it("aiDisclosure:false: attribution stays, the AI disclosure goes", async () => {
    if (!ffmpegOk) return;
    const tags = await exportTags({ aiDisclosure: false });
    const all = Object.values(tags).join(" ");
    expect(all).toContain("Created with Bow Down Visuals");
    expect(all).not.toContain("AI-generated content");
    expect(tags["ai_disclosure"]).toBeUndefined();
  }, 60000);
});
