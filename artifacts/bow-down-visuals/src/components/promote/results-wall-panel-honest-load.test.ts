/**
 * ResultsWallPanel (my results wall + the public wall) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * Both panels run an explicit LoadState machine —
 * loading | ready | error | not-ready — and every state is
 * earned:
 * - a 503 lands on the dedicated NOT-READY state (the wall
 *   isn't switched on yet — stated plainly, neither an error
 *   nor an empty wall);
 * - any other non-ok throws into the ERROR state; ready (and
 *   with it the genuine empty copy, gated on state ===
 *   "ready") is reachable only from a proven ok response;
 * - the save and scan actions throw on non-ok into their own
 *   error surfaces — nothing is marked saved or scanned
 *   before the response proves it.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ResultsWallPanel.tsx");

describe("both walls earn their states the same way", () => {
  it("503 is not-ready, other failures are error, ready only follows ok", () => {
    expect(src).toContain('type LoadState = "loading" | "ready" | "error" | "not-ready";');
    const notReady = src.split('if (res.status === 503)').length - 1;
    expect(notReady).toBe(2);
    expect(src).toContain('setState("error");');
    expect(src).toContain('setState("ready");');
  });

  it("the public wall's empty copy is gated on the ready state", () => {
    expect(src).toContain("{state === \"ready\" && events.length === 0 && (");
    expect(src).toContain("{state === \"loading\" && (");
  });

  it("save and scan throw on non-ok", () => {
    expect(src).toContain('if (!res.ok) throw new Error("save failed");');
    expect(src).toContain('if (!res.ok) throw new Error("scan failed");');
  });
});
