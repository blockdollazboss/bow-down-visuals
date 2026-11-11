/**
 * AutoAiEditSection (the AI edit-plan generator) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An editor section with no mount load:
 * - THE PLAN call throws the server's message on non-ok
 *   into BOTH the error state and a destructive toast — a
 *   failed plan never applies itself to the timeline.
 * - THE SUCCESS TOAST tells the provenance truth: it names
 *   the plan's actual source from the response ("Thy Cheat
 *   Code AI" vs "smart defaults") — a defaults-produced plan
 *   is never announced as AI work. Auto-applied transitions
 *   derive from the proven plan payload only.
 * - THE CALL carries a 60s abort timeout, so the section
 *   can never spin forever on a hung request.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./AutoAiEditSection.tsx");

describe("the plan applies only from an ok response, and names its real source", () => {
  it("the gate, the provenance toast, and the timeout are pinned", () => {
    expect(src).toContain('throw new Error(apiErrorMessage(j, "Edit failed."));');
    expect(src).toContain('data.source === "ai" ? "Thy Cheat Code AI" : "smart defaults"');
    expect(src).toContain("signal: AbortSignal.timeout(60_000),");
  });
});
