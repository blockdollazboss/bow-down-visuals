/**
 * DreamCollabPanel (the dream-collaboration concept tool) —
 * honest action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An action panel with no mount load, the create-family
 * standard shape: both inputs are required before the call
 * can run (the handler returns early and the button disables
 * on the same conditions), and the concept renders only
 * from an ok response carrying the concept's logline
 * (`!res.ok || !data.logline`) — a failure body never
 * renders as a concept. The busy flag clears in finally.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./DreamCollabPanel.tsx");

describe("the concept applies only from an ok response carrying the logline", () => {
  it("the gate and the busy release are pinned", () => {
    expect(src).toContain('if (!res.ok || !data.logline) throw new Error(apiErrorMessage(data, "Concept failed."));');
    expect(src).toContain('setError(plainErrorText(e, "Concept failed."));');
    expect(src).toContain("setLoading(false);");
  });
});
