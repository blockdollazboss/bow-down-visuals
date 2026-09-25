/**
 * Tests for the Logo-to-Luxury studio (jewelry + apparel).
 *
 * Covers: credit pricing constants, option key guards, AI prompt builders,
 * the deterministic estimate engines (jewelry + apparel), the PNG decoder,
 * silhouette extraction, and the pendant STL mesh builder (binary STL
 * layout, facet count, volume/weight math). No network, no credits spent.
 */
import { describe, expect, it } from "vitest";
import { deflateSync } from "zlib";
import {
  JEWELRY_PREVIEW_CREDIT_COST,
  JEWELRY_STL_CREDIT_COST,
  JEWELRY_CONSULT_CREDIT_COST,
  JEWELRY_PIECES,
  JEWELRY_METALS,
  JEWELRY_STONES,
  APPAREL_PRODUCTS,
  DEFAULT_JEWELRY_OPTIONS,
  DEFAULT_APPAREL_OPTIONS,
  buildJewelryPrompt,
  buildApparelPrompt,
  estimateStoneCount,
  estimateManufacturing,
  estimateApparel,
  isJewelryPieceKey,
  isMetalKey,
  isStoneKey,
  isJewelryStyleKey,
  isApparelProductKey,
  isDecoMethodKey,
  JEWELRY_GUIDE,
  JEWELRY_CONSULTANT_SYSTEM_PROMPT,
} from "../jewelry-pricing";
import {
  decodePNG,
  logoToMask,
  buildPendantSTL,
  stlWeightGrams,
} from "../jewelry-stl";

/* ─── Tiny PNG encoder (test-only) ────────────────────────────────────── */

function crc32(buf: Buffer): number {
  let table = (crc32 as any)._t as Int32Array | undefined;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    (crc32 as any)._t = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const td = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([td, data])));
  return Buffer.concat([len, td, data, crc]);
}

/** 8-bit RGBA non-interlaced PNG, filter type 0 on every row. */
function makePNG(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    Buffer.from(rgba.subarray(y * width * 4, (y + 1) * width * 4)).copy(
      raw,
      y * (1 + width * 4) + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ─── Pricing constants ───────────────────────────────────────────────── */

describe("jewelry credit pricing", () => {
  it("preview costs 2 credits", () => {
    expect(JEWELRY_PREVIEW_CREDIT_COST).toBe(2);
  });
  it("STL export costs 4 credits", () => {
    expect(JEWELRY_STL_CREDIT_COST).toBe(4);
  });
  it("consultant costs 1 credit per message", () => {
    expect(JEWELRY_CONSULT_CREDIT_COST).toBe(1);
  });
});

/* ─── Option guards ───────────────────────────────────────────────────── */

describe("option key guards", () => {
  it("accepts every catalogued piece/metal/stone/style", () => {
    for (const k of Object.keys(JEWELRY_PIECES)) expect(isJewelryPieceKey(k)).toBe(true);
    for (const k of Object.keys(JEWELRY_METALS)) expect(isMetalKey(k)).toBe(true);
    for (const k of Object.keys(JEWELRY_STONES)) expect(isStoneKey(k)).toBe(true);
    for (const k of ["iced-out", "minimal", "vintage"]) expect(isJewelryStyleKey(k)).toBe(true);
    for (const k of Object.keys(APPAREL_PRODUCTS)) expect(isApparelProductKey(k)).toBe(true);
    for (const k of ["print", "embroidery"]) expect(isDecoMethodKey(k)).toBe(true);
  });
  it("rejects unknown keys", () => {
    expect(isJewelryPieceKey("spaceship")).toBe(false);
    expect(isMetalKey("unobtainium")).toBe(false);
    expect(isStoneKey("kryptonite")).toBe(false);
    expect(isJewelryStyleKey("yolo")).toBe(false);
    expect(isApparelProductKey("tuxedo")).toBe(false);
    expect(isDecoMethodKey("tattoo")).toBe(false);
  });
  it("covers the full jewelry range (9 pieces)", () => {
    expect(Object.keys(JEWELRY_PIECES)).toHaveLength(9);
    for (const k of ["ring", "bracelet", "earrings", "chain", "watch", "cufflinks", "brooch"]) {
      expect(isJewelryPieceKey(k)).toBe(true);
    }
  });
  it("covers the full apparel line (9 products)", () => {
    expect(Object.keys(APPAREL_PRODUCTS)).toHaveLength(9);
    for (const k of ["hoodie", "jacket", "pants", "beanie", "sweatshirt", "shorts", "socks"]) {
      expect(isApparelProductKey(k)).toBe(true);
    }
  });
});

/* ─── Prompt builders ─────────────────────────────────────────────────── */

describe("AI prompt builders", () => {
  it("jewelry prompt names piece, metal, stone, style", () => {
    const p = buildJewelryPrompt({
      ...DEFAULT_JEWELRY_OPTIONS,
      piece: "watch",
      metal: "white-18k",
      stone: "moissanite",
      style: "minimal",
    });
    expect(p).toContain("Watch");
    expect(p).toContain("18K White Gold");
    expect(p).toContain("Moissanite");
    expect(p).toContain("NFC");
  });
  it("jewelry prompt handles no-stone pieces", () => {
    const p = buildJewelryPrompt({ ...DEFAULT_JEWELRY_OPTIONS, stone: "none" });
    expect(p).toContain("no gemstones");
  });
  it("apparel prompt names product, deco, color", () => {
    const p = buildApparelPrompt({
      ...DEFAULT_APPAREL_OPTIONS,
      product: "beanie",
      deco: "embroidery",
      color: "Navy",
      notes: "",
    });
    expect(p).toContain("Beanie");
    expect(p).toContain("embroidered");
    expect(p).toContain("navy");
  });
});

/* ─── Estimate engines ────────────────────────────────────────────────── */

describe("estimateManufacturing", () => {
  it("sums line items into the totals", () => {
    const e = estimateManufacturing(DEFAULT_JEWELRY_OPTIONS, 20);
    const sumLow = e.lines.reduce((s, l) => s + l.lowUSD, 0);
    expect(e.totalLowUSD).toBeLessThanOrEqual(sumLow + 10);
    expect(e.totalHighUSD).toBeGreaterThan(e.totalLowUSD);
  });
  it("includes an NFC line when nfc is on, omits when off", () => {
    const withNfc = estimateManufacturing({ ...DEFAULT_JEWELRY_OPTIONS, nfc: true }, 20);
    const without = estimateManufacturing({ ...DEFAULT_JEWELRY_OPTIONS, nfc: false }, 20);
    expect(withNfc.lines.some((l) => l.label.includes("NFC"))).toBe(true);
    expect(without.lines.some((l) => l.label.includes("NFC"))).toBe(false);
  });
  it("scales metal cost with weight", () => {
    const light = estimateManufacturing(DEFAULT_JEWELRY_OPTIONS, 10);
    const heavy = estimateManufacturing(DEFAULT_JEWELRY_OPTIONS, 40);
    const metalOf = (e: typeof light) =>
      e.lines.find((l) => l.label.startsWith("Metal"))!.lowUSD;
    expect(metalOf(heavy)).toBeGreaterThan(metalOf(light));
  });
  it("labels everything as estimates", () => {
    const e = estimateManufacturing(DEFAULT_JEWELRY_OPTIONS, 20);
    expect(e.disclaimer).toContain("ESTIMATES ONLY");
  });
  it("stone counts: iced-out > minimal, none = 0", () => {
    const iced = estimateStoneCount({ ...DEFAULT_JEWELRY_OPTIONS, style: "iced-out" });
    const minimal = estimateStoneCount({ ...DEFAULT_JEWELRY_OPTIONS, style: "minimal" });
    const none = estimateStoneCount({ ...DEFAULT_JEWELRY_OPTIONS, stone: "none" });
    expect(iced).toBeGreaterThan(minimal);
    expect(minimal).toBeGreaterThan(0);
    expect(none).toBe(0);
  });
});

describe("estimateApparel", () => {
  it("scales with quantity and labels estimates", () => {
    const one = estimateApparel({ ...DEFAULT_APPAREL_OPTIONS, product: "hoodie", deco: "print", color: "Black", notes: "" }, 1);
    const bulk = estimateApparel({ ...DEFAULT_APPAREL_OPTIONS, product: "hoodie", deco: "print", color: "Black", notes: "" }, 100);
    expect(bulk.totalLowUSD).toBeGreaterThan(one.totalLowUSD * 50);
    expect(one.disclaimer).toContain("ESTIMATES ONLY");
  });
});

/* ─── PNG decoder ─────────────────────────────────────────────────────── */

describe("decodePNG", () => {
  it("decodes a 2x2 RGBA PNG exactly", () => {
    const rgba = Uint8Array.from([
      255, 0, 0, 255, 0, 255, 0, 128,
      0, 0, 255, 255, 255, 255, 255, 0,
    ]);
    const img = decodePNG(makePNG(2, 2, rgba));
    expect(img.width).toBe(2);
    expect(img.height).toBe(2);
    expect(Array.from(img.rgba)).toEqual(Array.from(rgba));
  });
  it("rejects non-PNG input", () => {
    expect(() => decodePNG(Buffer.from("hello world"))).toThrow();
  });
});

/* ─── Silhouette + STL ────────────────────────────────────────────────── */

describe("logoToMask", () => {
  it("extracts an alpha silhouette", () => {
    // 32x32: opaque 16x16 square in the middle, transparent elsewhere
    const W = 32;
    const rgba = new Uint8Array(W * W * 4);
    for (let y = 8; y < 24; y++) {
      for (let x = 8; x < 24; x++) {
        const o = (y * W + x) * 4;
        rgba[o + 3] = 255;
      }
    }
    const mask = logoToMask({ width: W, height: W, rgba }, 16);
    expect(mask.length).toBe(256);
    const fg = mask.reduce((s, v) => s + v, 0);
    expect(fg).toBeGreaterThan(0);
    expect(fg).toBeLessThan(256);
  });
  it("falls back to a full disc on a blank logo", () => {
    const rgba = new Uint8Array(4 * 4 * 4).fill(255);
    const mask = logoToMask({ width: 4, height: 4, rgba }, 8);
    expect(mask.every((v) => v === 1)).toBe(true);
  });
});

describe("buildPendantSTL", () => {
  const fullMask = new Uint8Array(128 * 128).fill(1);

  it("writes a valid binary STL (84-byte header + 50 bytes/facet)", () => {
    const b = buildPendantSTL(fullMask, { nfcPocket: false });
    expect(b.facetCount).toBeGreaterThan(1000);
    expect(b.stl.length).toBe(84 + b.facetCount * 50);
    expect(b.stl.readUInt32LE(80)).toBe(b.facetCount);
  });
  it("produces positive volume and sane dimensions", () => {
    const b = buildPendantSTL(fullMask, { nfcPocket: true });
    expect(b.volumeMm3).toBeGreaterThan(0);
    expect(b.widthMm).toBeCloseTo(35, 5);
    expect(b.heightMm).toBeGreaterThan(35);
  });
  it("NFC pocket removes material (less volume than solid)", () => {
    const solid = buildPendantSTL(fullMask, { nfcPocket: false });
    const pocket = buildPendantSTL(fullMask, { nfcPocket: true });
    expect(pocket.volumeMm3).toBeLessThan(solid.volumeMm3);
  });
  it("weight math: 14k gold pendant is tens of grams", () => {
    const b = buildPendantSTL(fullMask, { nfcPocket: true });
    const g = stlWeightGrams(b.volumeMm3, JEWELRY_METALS["yellow-14k"].densityGPerCm3);
    expect(g).toBeGreaterThan(5);
    expect(g).toBeLessThan(120);
  });
});

/* ─── Guide + consultant ──────────────────────────────────────────────── */

describe("guide and consultant content", () => {
  it("guide covers jewelry process, jewelers, NFC, and apparel", () => {
    const titles = JEWELRY_GUIDE.map((s) => s.title);
    expect(titles.some((t) => t.includes("NFC"))).toBe(true);
    expect(titles.some((t) => t.includes("Apparel"))).toBe(true);
    expect(titles.some((t) => t.includes("jeweler"))).toBe(true);
    for (const s of JEWELRY_GUIDE) expect(s.body.length).toBeGreaterThan(0);
  });
  it("consultant prompt covers NFC + apparel + estimates honesty", () => {
    expect(JEWELRY_CONSULTANT_SYSTEM_PROMPT).toContain("NFC");
    expect(JEWELRY_CONSULTANT_SYSTEM_PROMPT).toContain("Apparel");
    expect(JEWELRY_CONSULTANT_SYSTEM_PROMPT).toContain("ESTIMATES");
  });
});
