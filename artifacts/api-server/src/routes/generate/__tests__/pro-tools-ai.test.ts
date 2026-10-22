import { readFileSync } from "node:fs";
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
  it("charges 100 credits per the money rules", () => {
    // PRO_TOOLS_AI_CREDITS defaults to 100 — the owner set the price on
    // Oct 22, 2026 (the original default of 1 was a pre-x100 leftover).
    // The env default and the || fallback are both pinned in the route
    // source; the live charge path against the real router is exercised
    // in pro-tools-ai-charge.test.ts.
    const src = readFileSync(new URL("../pro-tools-ai.ts", import.meta.url), "utf8");
    const m = src.match(
      /PRO_TOOLS_AI_CREDITS\s*=\s*Number\(process\.env\["PRO_TOOLS_AI_CREDITS"\] \?\? (\d+)\) \|\| (\d+)/,
    );
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBe(100);
    expect(Number(m![2])).toBe(100);
  });
});
