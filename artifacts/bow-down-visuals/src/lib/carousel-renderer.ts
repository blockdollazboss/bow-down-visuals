/* ─── Carousel slide renderer ──────────────────────────────────────────────
   Client-side canvas → PNG. Renders carousel slides (1080×1080 square for
   Instagram/LinkedIn, 1080×1920 portrait for TikTok/Stories) in the
   gold/black luxury style. "Made with Bow Down Visuals" attribution baked
   into every slide footer.

   Templates are data-driven: each template defines a background style and
   text layout; the renderer draws them on canvas for pixel-perfect export. */

export type CarouselFormat = "square" | "portrait";

export interface CarouselSlide {
  id: string;
  title: string;
  body: string;
  /** per-slide background override (template default if null) */
  bg: string | null;
}

export interface CarouselTemplate {
  id: string;
  nameKey: string;
  descKey: string;
  /** canvas background painter id */
  bgStyle: "gold-glow" | "midnight" | "split" | "framed" | "gradient-wash" | "bold-band" | "paper" | "neon-edge";
  /** accent color used for titles/accents */
  accent: string;
  /** where the slide number appears */
  numberStyle: "pill" | "corner" | "none";
}

export const CAROUSEL_TEMPLATES: CarouselTemplate[] = [
  { id: "bold-statement", nameKey: "carouselMaker.tplBoldName", descKey: "carouselMaker.tplBoldDesc", bgStyle: "gold-glow", accent: "#d4af37", numberStyle: "pill" },
  { id: "listicle",       nameKey: "carouselMaker.tplListName", descKey: "carouselMaker.tplListDesc", bgStyle: "midnight", accent: "#f6d47c", numberStyle: "corner" },
  { id: "before-after",   nameKey: "carouselMaker.tplBeforeName", descKey: "carouselMaker.tplBeforeDesc", bgStyle: "split", accent: "#d4af37", numberStyle: "pill" },
  { id: "quote",          nameKey: "carouselMaker.tplQuoteName", descKey: "carouselMaker.tplQuoteDesc", bgStyle: "framed", accent: "#f6d47c", numberStyle: "none" },
  { id: "tutorial",       nameKey: "carouselMaker.tplTutorialName", descKey: "carouselMaker.tplTutorialDesc", bgStyle: "gradient-wash", accent: "#d4af37", numberStyle: "pill" },
  { id: "story",          nameKey: "carouselMaker.tplStoryName", descKey: "carouselMaker.tplStoryDesc", bgStyle: "midnight", accent: "#e8c468", numberStyle: "corner" },
  { id: "stats",          nameKey: "carouselMaker.tplStatsName", descKey: "carouselMaker.tplStatsDesc", bgStyle: "bold-band", accent: "#0a0a0a", numberStyle: "pill" },
  { id: "minimal-luxe",   nameKey: "carouselMaker.tplLuxeName", descKey: "carouselMaker.tplLuxeDesc", bgStyle: "paper", accent: "#9c7c1e", numberStyle: "none" },
];

export interface CarouselRenderOpts {
  slide: CarouselSlide;
  template: CarouselTemplate;
  slideIndex: number; // 0-based
  totalSlides: number;
  format: CarouselFormat;
  /** brand colors from Creative Vault, e.g. "#d4af37, #0a0a0a" */
  brandColors: string | null;
  artistName: string | null;
  fontFamily: "serif" | "sans" | "display";
}

function parseBrandColors(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(/[,;|]/).map((s) => s.trim()).filter((s) => /^#[0-9a-fA-F]{3,8}$/.test(s)).slice(0, 3);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (ctx.measureText(trial).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = trial;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function fontFor(family: "serif" | "sans" | "display", weight: number, size: number): string {
  const fam = family === "serif" ? "Georgia, 'Times New Roman', serif"
    : family === "display" ? "Arial Black, Arial, sans-serif"
    : "Arial, Helvetica, sans-serif";
  return `${weight} ${size}px ${fam}`;
}

function paintBackground(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  style: CarouselTemplate["bgStyle"], accent: string, brand: string[],
): void {
  const primary = brand[0] ?? accent;
  switch (style) {
    case "gold-glow": {
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, W, H);
      const g = ctx.createRadialGradient(W / 2, H * 0.32, 40, W / 2, H * 0.32, W * 0.75);
      g.addColorStop(0, hexA(primary, 0.28));
      g.addColorStop(1, hexA(primary, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case "midnight": {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#101010");
      g.addColorStop(1, "#050505");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = hexA(primary, 0.5);
      ctx.lineWidth = 3;
      roundRect(ctx, 28, 28, W - 56, H - 56, 28);
      ctx.stroke();
      break;
    }
    case "split": {
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, W, H / 2);
      const g = ctx.createLinearGradient(0, H / 2, 0, H);
      g.addColorStop(0, hexA(primary, 0.25));
      g.addColorStop(1, "#0a0a0a");
      ctx.fillStyle = g;
      ctx.fillRect(0, H / 2, W, H / 2);
      ctx.fillStyle = primary;
      ctx.fillRect(0, H / 2 - 3, W, 6);
      break;
    }
    case "framed": {
      ctx.fillStyle = "#0c0c0c";
      ctx.fillRect(0, 0, W, H);
      const fg = ctx.createLinearGradient(0, 0, W, H);
      fg.addColorStop(0, "#f6d47c");
      fg.addColorStop(0.5, primary);
      fg.addColorStop(1, "#9c7c1e");
      ctx.strokeStyle = fg;
      ctx.lineWidth = 8;
      roundRect(ctx, 40, 40, W - 80, H - 80, 32);
      ctx.stroke();
      ctx.strokeStyle = hexA(primary, 0.3);
      ctx.lineWidth = 2;
      roundRect(ctx, 62, 62, W - 124, H - 124, 22);
      ctx.stroke();
      break;
    }
    case "gradient-wash": {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#141414");
      g.addColorStop(0.5, hexA(primary, 0.12));
      g.addColorStop(1, "#0a0a0a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case "bold-band": {
      ctx.fillStyle = primary;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(0,0,0,0.82)";
      roundRect(ctx, 60, 60, W - 120, H - 120, 36);
      ctx.fill();
      break;
    }
    case "paper": {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#f5f0e6");
      g.addColorStop(1, "#e8e0cf");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case "neon-edge": {
      ctx.fillStyle = "#080808";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = primary;
      ctx.lineWidth = 10;
      ctx.shadowColor = primary;
      ctx.shadowBlur = 40;
      roundRect(ctx, 36, 36, W - 72, H - 72, 30);
      ctx.stroke();
      ctx.shadowBlur = 0;
      break;
    }
  }
}

function hexA(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Render one slide. Returns the canvas (caller converts to PNG/download). */
export function renderCarouselSlide(opts: CarouselRenderOpts): HTMLCanvasElement {
  const { slide, template, slideIndex, totalSlides, format, fontFamily } = opts;
  const W = 1080;
  const H = format === "portrait" ? 1920 : 1080;
  const brand = parseBrandColors(opts.brandColors);
  const accent = brand[0] ?? template.accent;
  const isPaper = template.bgStyle === "paper";
  const isBand = template.bgStyle === "bold-band";
  const ink = isPaper ? "#1a1a1a" : isBand ? "#f6d47c" : "#ffffff";
  const sub = isPaper ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.72)";

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not available");

  paintBackground(ctx, W, H, template.bgStyle, accent, brand);

  const cx = W / 2;
  const padX = 120;
  const maxW = W - padX * 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  /* — slide number — */
  if (template.numberStyle === "pill") {
    const label = `${slideIndex + 1} / ${totalSlides}`;
    ctx.font = fontFor("sans", 700, 30);
    const pw = ctx.measureText(label).width + 56;
    ctx.fillStyle = isPaper ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.5)";
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    roundRect(ctx, cx - pw / 2, 96, pw, 58, 29);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.fillText(label, cx, 126);
  } else if (template.numberStyle === "corner") {
    ctx.textAlign = "right";
    ctx.font = fontFor("serif", 700, 44);
    ctx.fillStyle = hexA(isPaper ? "#000000" : accent, isPaper ? 0.35 : 0.8);
    ctx.fillText(`${String(slideIndex + 1).padStart(2, "0")}`, W - 100, 130);
    ctx.textAlign = "center";
  }

  /* — title — */
  const titleTop = template.numberStyle === "none" ? H * 0.3 : H * 0.34;
  let size = format === "portrait" ? 96 : 88;
  ctx.font = fontFor(fontFamily, 900, size);
  let titleLines = wrapLines(ctx, slide.title || " ", maxW, 4);
  while (titleLines.length > 3 && size > 48) {
    size -= 6;
    ctx.font = fontFor(fontFamily, 900, size);
    titleLines = wrapLines(ctx, slide.title || " ", maxW, 4);
  }
  // shrink to fit width
  while (titleLines.some((l) => ctx.measureText(l).width > maxW) && size > 40) {
    size -= 4;
    ctx.font = fontFor(fontFamily, 900, size);
  }
  ctx.fillStyle = isBand ? "#f6d47c" : ink;
  let y = titleTop;
  const lh = size * 1.18;
  for (const line of titleLines) {
    ctx.fillText(line, cx, y);
    y += lh;
  }

  /* — divider — */
  y += 26;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx - 90, y);
  ctx.lineTo(cx + 90, y);
  ctx.stroke();
  y += 56;

  /* — body — */
  const bodySize = format === "portrait" ? 44 : 40;
  ctx.font = fontFor("sans", 400, bodySize);
  const bodyLines = wrapLines(ctx, slide.body || "", maxW, 8);
  ctx.fillStyle = sub;
  const blh = bodySize * 1.5;
  for (const line of bodyLines) {
    ctx.fillText(line, cx, y);
    y += blh;
  }

  /* — footer: attribution baked in — */
  ctx.font = fontFor("sans", 700, 26);
  ctx.fillStyle = hexA(isPaper ? "#000000" : accent, isPaper ? 0.5 : 0.85);
  const footY = H - 84;
  const foot = opts.artistName
    ? `${opts.artistName.toUpperCase()} · MADE WITH BOW DOWN VISUALS`
    : "MADE WITH BOW DOWN VISUALS";
  ctx.fillText(foot.length > 52 ? "MADE WITH BOW DOWN VISUALS" : foot, cx, footY);

  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Render failed"))), "image/png"),
  );
}

export async function downloadCanvas(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  const blob = await canvasToBlob(canvas);
  downloadBlob(blob, filename);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ─── AI-disclosure PNG stamp (Stack-100 #3 lane F7 kit, more-provenance) ──
   Carousel slides are rendered HERE (canvas → PNG in the browser); the PNG
   bytes never pass through the server, so this is where the disclosure is
   stamped. The format is the kit's format — the same XMP packet the
   server stamper (api-server lib/disclosure-metadata.ts) writes, carried
   in a PNG iTXt chunk ("XML:com.adobe.xmp") right after IHDR, with the
   chunk CRC32 the PNG spec requires. Metadata only: pixels are untouched.
   The disclosure text/tool come from the server's /carousel/export
   response, so the words are stated in exactly one place. */
export interface CarouselDisclosure {
  text: string;
  tool: string;
  title?: string;
  creator?: string | null;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildCarouselXmpPacket(info: CarouselDisclosure): string {
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

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32Bytes(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Inject the disclosure XMP into PNG bytes as an iTXt chunk after IHDR.
    Returns null when the bytes are not a PNG (the caller then ships the
    original and reports stamp_failed — a failed stamp never blocks the
    export). */
export function injectXmpIntoPngBytes(bytes: Uint8Array, xmp: string): Uint8Array | null {
  if (bytes.length < 33 || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdrLen = view.getUint32(8);
  const ihdrEnd = 8 + 12 + ihdrLen;
  if (ihdrEnd > bytes.length) return null;
  const keyword = new TextEncoder().encode("XML:com.adobe.xmp");
  const xmpBytes = new TextEncoder().encode(xmp);
  const data = new Uint8Array(keyword.length + 3 + 1 + 1 + xmpBytes.length);
  data.set(keyword, 0);
  /* null separator, compression flag 0, method 0; empty language tag + null;
     empty translated keyword + null — same layout as the server stamper. */
  data.set(xmpBytes, keyword.length + 5);
  const chunk = new Uint8Array(12 + data.length);
  const chunkView = new DataView(chunk.buffer);
  chunkView.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode("iTXt"), 4);
  chunk.set(data, 8);
  chunkView.setUint32(8 + data.length, crc32Bytes(chunk.subarray(4, 8 + data.length)));
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(bytes.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

export async function stampPngBlobWithDisclosure(
  blob: Blob,
  info: CarouselDisclosure,
): Promise<{ blob: Blob; applied: boolean }> {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const stamped = injectXmpIntoPngBytes(bytes, buildCarouselXmpPacket(info));
    if (!stamped) return { blob, applied: false };
    return { blob: new Blob([stamped.buffer as ArrayBuffer], { type: "image/png" }), applied: true };
  } catch {
    return { blob, applied: false };
  }
}

export type CarouselDownloadDisclosureState = "embedded" | "off" | "stamp_failed";

/** Render → (stamp) → download one slide. Returns the honest disclosure
    state: "off" when no disclosure was requested, "stamp_failed" when the
    stamp could not be applied (the unstamped slide still downloads — a
    failed stamp never fails the export). */
export async function downloadCarouselSlide(
  canvas: HTMLCanvasElement,
  filename: string,
  disclosure: CarouselDisclosure | null,
): Promise<CarouselDownloadDisclosureState> {
  const raw = await canvasToBlob(canvas);
  if (!disclosure) {
    downloadBlob(raw, filename);
    return "off";
  }
  const { blob, applied } = await stampPngBlobWithDisclosure(raw, disclosure);
  downloadBlob(blob, filename);
  return applied ? "embedded" : "stamp_failed";
}
