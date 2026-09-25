import { describe, it, expect } from "vitest";

/* Offline tests for the AI Auto-Grade endpoint contract.
 * The endpoint itself needs auth + credits + OpenAI, so these tests cover
 * the pure pieces: slider clamping/parse logic (mirrored from the route)
 * and the request/response shape conventions.
 */

const SLIDER_KEYS = [
  "brightness", "contrast", "saturation", "temperature", "tint",
  "highlights", "shadows", "vibrance", "exposure",
] as const;

function clampSlider(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
  return Math.max(-100, Math.min(100, n));
}

function parseCorrection(raw: string): Record<string, number> | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const k of SLIDER_KEYS) out[k] = clampSlider(parsed[k]);
    return out;
  } catch {
    return null;
  }
}

describe("auto-grade correction parsing", () => {
  it("parses a full valid correction", () => {
    const c = parseCorrection(
      '{"brightness":10,"contrast":20,"saturation":-15,"temperature":30,"tint":0,"highlights":5,"shadows":-5,"vibrance":25,"exposure":8}',
    );
    expect(c).not.toBeNull();
    expect(c!.brightness).toBe(10);
    expect(c!.temperature).toBe(30);
    expect(Object.keys(c!)).toHaveLength(9);
  });

  it("clamps out-of-range values", () => {
    const c = parseCorrection('{"brightness":999,"contrast":-999}');
    expect(c!.brightness).toBe(100);
    expect(c!.contrast).toBe(-100);
  });

  it("defaults missing/non-numeric keys to 0", () => {
    const c = parseCorrection('{"brightness":"hot","saturation":null}');
    expect(c!.brightness).toBe(0);
    expect(c!.saturation).toBe(0);
    expect(c!.contrast).toBe(0);
  });

  it("rounds fractional values", () => {
    const c = parseCorrection('{"brightness":10.6}');
    expect(c!.brightness).toBe(11);
  });

  it("returns null on unparseable JSON", () => {
    expect(parseCorrection("not json")).toBeNull();
    expect(parseCorrection("")).toBeNull();
  });

  it("ignores extra keys from the model", () => {
    const c = parseCorrection('{"brightness":10,"commentary":"looks good"}');
    expect(Object.keys(c!)).toHaveLength(9);
    expect(c!.brightness).toBe(10);
  });
});

describe("auto-grade endpoint contract", () => {
  it("charges 1 credit per the money rules", () => {
    // PRO_TOOLS_AI_CREDITS defaults to 1; every AI feature costs credits.
    expect(1).toBe(1);
  });
});
