/**
 * FanSegmentsPanel (the email-list fan segments) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * The FanGraphTab twin doctrine: the segments loader throws
 * on non-ok with the server's message into the dedicated
 * error state (fan_seg_error), loading clears in finally,
 * and the secondary action leg applies its result only
 * inside `if (res.ok)` — segments and counts are never
 * painted from an error body.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./FanSegmentsPanel.tsx");

describe("segments load throws on failure; the action leg is ok-gated", () => {
  it("the throw, the error state, and the gate are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "load failed"));');
    expect(src).toContain('setError(t("email-list.fan_seg_error"));');
    expect(src).toContain("if (res.ok) {");
    expect(src).toContain("setLoading(false);");
  });
});
