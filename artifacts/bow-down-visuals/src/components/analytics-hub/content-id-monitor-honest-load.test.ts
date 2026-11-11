/**
 * ContentIdMonitor (Content ID opt-ins + detections) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * The per-leg allSettled exemplar: opt-ins and detections
 * load as independent legs, each throwing on non-ok with
 * its own message; a fulfilled leg applies its data, a
 * rejected leg lands on ITS OWN error state
 * (setOptinsError / setDetectionsError) with the server's
 * reason — one leg's failure can neither blank the other's
 * proven data nor dress itself as an empty list. Loading
 * clears in finally.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ContentIdMonitor.tsx");

describe("each leg settles into its own data or its own error", () => {
  it("the settled-split and both error states are pinned", () => {
    expect(src).toContain('if (oSettled.status === "fulfilled") setOptins(oSettled.value);');
    expect(src).toContain('else setOptinsError(plainErrorText(oSettled.reason, "Couldn\'t load your opt-ins."));');
    expect(src).toContain('else setDetectionsError(plainErrorText(dSettled.reason, "Couldn\'t load your detections."));');
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Couldn\'t load your detections."));');
  });
});
