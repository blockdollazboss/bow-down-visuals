/**
 * HangingMic promo band — honest load states (Stack-400 C-28
 * components residual, deep-pins tranche 1). The hanging mic on the
 * homepage hero wears a promo band fed by GET /api/mic-band/promos.
 * Its honesty contract is quiet-by-design: a non-ok response maps to
 * null, a network failure is swallowed to the same place, and the
 * payload parser (lib/mic-band) yields NO promos for a malformed or
 * error payload. The band renders only when at least one real promo
 * was loaded — the mic is never left wearing invented copy, and a
 * failed load never dresses up as a promo or an empty-state message.
 *
 * The FE suite runs in node (no DOM), so — like the sibling
 * honest-load pins — these tests pin the state machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const mic = read("./HangingMic.tsx");
const lib = read("../lib/mic-band.ts");

describe("failure path — a failed promos load never invents band copy", () => {
  it("the fetch maps a non-ok response to null", () => {
    expect(mic).toContain('fetch("/api/mic-band/promos")');
    expect(mic).toContain(".then((r) => (r.ok ? r.json() : null))");
  });

  it("a network failure is swallowed, leaving the promos state empty", () => {
    expect(mic).toContain(".catch(() => {});");
    expect(mic).toContain("useState<MicBandPromo[]>([])");
  });

  it("loaded payloads pass through the runtime guard before they can render", () => {
    expect(mic).toContain("if (!cancelled) setPromos(parseMicBandPromos(d));");
  });

  it("the parser yields no promos for a null, malformed or error payload", () => {
    expect(lib).toContain("if (!payload || typeof payload !== \"object\") return [];");
    expect(lib).toContain("if (!Array.isArray(promos)) return [];");
  });
});

describe("the band renders only from a successful load", () => {
  it("the band is gated on the user's toggle AND at least one loaded promo", () => {
    expect(mic).toContain("{bandVisible && promos.length > 0 && (");
    expect(mic).toContain("<MicPromoBand promos={promos} isLight={isLight} />");
  });

  it("the empty and failure states are the same honest absence — no empty copy exists", () => {
    const gateAt = mic.indexOf("{bandVisible && promos.length > 0 && (");
    expect(gateAt).toBeGreaterThan(-1);
    // The band markup exists exactly once, behind the gate above.
    expect(mic.split("<MicPromoBand").length - 1).toBe(1);
  });
});
