import { describe, expect, it } from "vitest";
import {
  MIC_BAND_STORAGE_KEY,
  nextMicBandIndex,
  parseMicBandPromos,
  readMicBandVisible,
  writeMicBandVisible,
} from "./mic-band";

describe("nextMicBandIndex", () => {
  it("advances and wraps", () => {
    expect(nextMicBandIndex(0, 3)).toBe(1);
    expect(nextMicBandIndex(2, 3)).toBe(0);
  });
  it("pins to 0 for empty/single lists", () => {
    expect(nextMicBandIndex(0, 0)).toBe(0);
    expect(nextMicBandIndex(5, 1)).toBe(0);
  });
});

describe("parseMicBandPromos", () => {
  it("accepts a well-formed payload", () => {
    const out = parseMicBandPromos({
      promos: [
        { id: "launch", kicker: "Grand opening", headline: "Jan 1, 2027", detail: "68 days away", href: "/signup" },
        { id: "jackpot", kicker: "Cheat Code Jackpot", headline: "10,000 VB", detail: "Unclaimed", href: null },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]?.headline).toBe("Jan 1, 2027");
    expect(out[1]?.href).toBeNull();
  });

  it("drops malformed entries and whole malformed payloads — no invented fallback", () => {
    expect(parseMicBandPromos(null)).toEqual([]);
    expect(parseMicBandPromos({})).toEqual([]);
    expect(parseMicBandPromos({ promos: "nope" })).toEqual([]);
    expect(
      parseMicBandPromos({
        promos: [
          { id: "x", kicker: "k", headline: "", detail: "d" },
          { id: 7, kicker: "k", headline: "h", detail: "d" },
          null,
          { id: "ok", kicker: "k", headline: "Real", detail: "d", href: 42 },
        ],
      }),
    ).toEqual([{ id: "ok", kicker: "k", headline: "Real", detail: "d", href: null }]);
  });
});

describe("mic band on/off preference", () => {
  const store = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
  };

  it("defaults ON and round-trips an explicit off/on under the bdv key", () => {
    const s = store();
    expect(readMicBandVisible(s)).toBe(true);
    writeMicBandVisible(false, s);
    expect(s.getItem(MIC_BAND_STORAGE_KEY)).toBe("0");
    expect(readMicBandVisible(s)).toBe(false);
    writeMicBandVisible(true, s);
    expect(readMicBandVisible(s)).toBe(true);
  });

  it("never throws on a hostile storage (private mode)", () => {
    const hostile = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readMicBandVisible(hostile)).toBe(true);
    expect(() => writeMicBandVisible(false, hostile)).not.toThrow();
    expect(readMicBandVisible(null)).toBe(true);
  });
});
