/**
 * Unit tests for the Text-to-SFX frontend helpers (/sfx page).
 * Covers: library persistence, CRC32, ZIP structure, WAV encoding, slugify.
 */
import { describe, expect, it } from "vitest";

import {
  SFX_LIBRARY_LIMIT,
  loadSfxLibrary,
  saveSfxItem,
  removeSfxItem,
  crc32,
  createZip,
  encodeWav,
  sfxSlug,
  type SfxItem,
} from "./sfx";

function memStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem: (k: string) => (k in store ? store[k]! : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
}

const item = (id: string): SfxItem => ({
  id,
  prompt: "massive explosion",
  category: "impacts",
  durationSeconds: 3,
  url: "https://example.com/sfx.mp3",
  createdAt: new Date().toISOString(),
});

describe("sfx library", () => {
  it("loads an empty list when nothing is stored", () => {
    expect(loadSfxLibrary(memStorage())).toEqual([]);
  });

  it("saves newest-first and caps the list", () => {
    const s = memStorage();
    let list = saveSfxItem([], item("1"), s);
    list = saveSfxItem(list, item("2"), s);
    expect(list[0]!.id).toBe("2");
    expect(loadSfxLibrary(s).length).toBe(2);
    expect(SFX_LIBRARY_LIMIT).toBe(50);
  });

  it("dedupes by id", () => {
    const s = memStorage();
    let list = saveSfxItem([], item("1"), s);
    list = saveSfxItem(list, item("1"), s);
    expect(list.length).toBe(1);
  });

  it("removes by id", () => {
    const s = memStorage();
    let list = saveSfxItem(saveSfxItem([], item("1"), s), item("2"), s);
    list = removeSfxItem(list, "1", s);
    expect(list.map((i) => i.id)).toEqual(["2"]);
  });

  it("never throws on corrupt storage", () => {
    const s = memStorage({ "bdv-sfx-library": "not json{{{" });
    expect(loadSfxLibrary(s)).toEqual([]);
  });
});

describe("crc32", () => {
  it("matches the known check value", () => {
    // CRC32("123456789") is the standard check value 0xCBF43926.
    const data = new TextEncoder().encode("123456789");
    expect(crc32(data)).toBe(0xcbf43926);
  });
});

describe("createZip", () => {
  it("builds a parseable store-only zip with correct signatures", () => {
    const a = new TextEncoder().encode("hello");
    const b = new TextEncoder().encode("world!");
    const zip = createZip([
      { name: "a.txt", data: a },
      { name: "b.txt", data: b },
    ]);
    const view = new DataView(zip.buffer);
    // local file header signature
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    // end-of-central-directory signature at the tail
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    // entry count in EOCD (EOCD starts at length-22; count field at +10)
    expect(view.getUint16(zip.length - 12, true)).toBe(2);
    // file payloads are present verbatim (stored, not compressed)
    const text = new TextDecoder().decode(zip);
    expect(text).toContain("hello");
    expect(text).toContain("world!");
  });

  it("handles an empty entry list", () => {
    const zip = createZip([]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 12, true)).toBe(0);
  });
});

describe("encodeWav", () => {
  it("writes a valid RIFF/WAVE header", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1]);
    const wav = encodeWav([samples], 44100);
    const view = new DataView(wav.buffer);
    const str = (o: number, n: number) =>
      String.fromCharCode(...wav.slice(o, o + n));
    expect(str(0, 4)).toBe("RIFF");
    expect(str(8, 4)).toBe("WAVE");
    expect(str(12, 4)).toBe("fmt ");
    expect(str(36, 4)).toBe("data");
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(16); // 16-bit
    expect(wav.length).toBe(44 + 4 * 2);
  });

  it("clips out-of-range samples", () => {
    const samples = new Float32Array([2, -2]);
    const wav = encodeWav([samples], 8000);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32767);
  });
});

describe("sfxSlug", () => {
  it("slugifies prompts", () => {
    expect(sfxSlug("Massive Explosion!!")).toBe("massive-explosion");
  });

  it("falls back to sfx", () => {
    expect(sfxSlug("!!!")).toBe("sfx");
  });
});

describe("storage failure tolerance", () => {
  it("saveSfxItem still returns the list when setItem throws", () => {
    const s = memStorage();
    s.setItem = () => {
      throw new Error("full");
    };
    const list = saveSfxItem([], item("1"), s);
    expect(list.length).toBe(1);
  });

  it("loadSfxLibrary ignores a throwing getItem", () => {
    const s = memStorage();
    s.getItem = () => {
      throw new Error("denied");
    };
    expect(loadSfxLibrary(s)).toEqual([]);
  });
});
