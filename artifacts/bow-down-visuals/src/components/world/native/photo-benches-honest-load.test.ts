/**
 * PhotoBenches (the World photo benches: backdrop, background
 * generate, enhance, headshot, product photo, remove-background)
 * — honest load classification (Stack-400 C-28 components
 * residual, deep-pins tranche 2). The benches are generation
 * surfaces; their only "loads" are the capability gates read
 * before a bench opens, and those gates are four-state machines:
 *
 * - THE BACKDROP GATE: loading → ready / closed / error. Ready
 *   requires a proven chain: an ok status response that parses
 *   AND says configured AND names a usable default provider —
 *   the provider list records only from that proven status. A
 *   non-ok, unparseable, or unconfigured answer lands on
 *   "closed" (the honest not-set-up state); a declined
 *   confirmation or a thrown read lands on "error". The bench
 *   can never open on an assumed capability.
 * - THE BACKGROUND-GENERATE GATE rides the same status-path
 *   discipline (its own status read before the priced run).
 *
 * NO FIX in this lane — the gates already meet the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const benches = read("./PhotoBenches.tsx");

const gateStart = benches.indexOf("async function loadGate()");
const gate = benches.slice(gateStart, benches.indexOf("async function run()", gateStart));

describe("the backdrop gate: the bench opens only on a proven capability", () => {
  it("a declined confirmation lands on the error gate, not on ready", () => {
    expect(gate).toContain("const res = await confirmedFetch(PHOTO_BACKDROP_STATUS_PATH, { skipConfirm: true });");
    expect(gate).toContain("if (!res) {");
    expect(gate).toContain('setGate("error");');
  });

  it("non-ok, unparseable, or unconfigured all land on closed — the honest not-set-up", () => {
    expect(gate).toContain("if (!res.ok || !status || !status.configured) {");
    expect(gate).toContain('setGate("closed");');
  });

  it("providers record only from the proven status, before ready is set", () => {
    expect(gate).toContain("setProviders(BACKDROP_PROVIDERS.filter((p) => (p === \"nano-banana-2.1\" ? status.nanoConfigured : status.ideogramConfigured)));");
    expect(gate).toContain('setGate("ready");');
    expect(gate.indexOf("setProviders(BACKDROP_PROVIDERS.filter")).toBeLessThan(gate.indexOf('setGate("ready");'));
  });

  it("a thrown read lands on the error gate", () => {
    expect(gate).toContain("} catch {");
    expect(gate).toContain('setGate("loading");');
  });
});
