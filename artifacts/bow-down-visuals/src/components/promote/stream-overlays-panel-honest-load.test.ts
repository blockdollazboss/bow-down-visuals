/**
 * StreamOverlaysPanel (stream overlay desk + alert token) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE DESK LOAD runs an explicit LoadState machine
 *   (loading | ready | error): non-ok throws into the error
 *   state, and the ready content — including any empty
 *   overlay list — renders only behind loadState gates, so
 *   a failed desk read can never present as a member with
 *   no overlays.
 * - THE TEST-ALERT AND TOKEN-RESET actions throw on non-ok
 *   into their own error surfaces: a test alert is never
 *   reported sent, and a token is never presented as reset,
 *   before the server proves it.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./StreamOverlaysPanel.tsx");

describe("the desk load earns its states", () => {
  it("non-ok throws into the error state; ready gates the content", () => {
    expect(src).toContain('type LoadState = "loading" | "ready" | "error";');
    expect(src).toContain('if (!res.ok) throw new Error("desk failed");');
    expect(src).toContain('setLoadState("error");');
    expect(src).toContain('setLoadState("ready");');
    expect(src).toContain('data-testid="overlays-loading"');
  });
});

describe("the actions claim nothing before an ok response", () => {
  it("test-alert and token-reset both throw on non-ok", () => {
    expect(src).toContain('if (!res.ok) throw new Error("test failed");');
    expect(src).toContain('if (!res.ok) throw new Error("reset failed");');
  });
});
