/**
 * AutoClipSection (batch clip export) — honest action
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * An editor section whose exports run as background jobs
 * through the SHARED house poller (lib/export-job-poll):
 * - THE ACCEPT call throws on non-ok before any job exists.
 * - EVERY JOB SETTLES: the poller's outcome becomes the
 *   job's done or error state — and the section keeps the
 *   poller's UNKNOWN-outcome doctrine distinct in its own
 *   source: a clip whose export outcome is unknown (the
 *   poller lost contact) is classified separately from a
 *   proven failure (isUnknownOutcomeCode splits the failed
 *   list), so the member is never told "failed" when the
 *   truth is "we don't know yet", nor charged twice over a
 *   maybe-delivered export.
 * - A MEMBER CANCEL marks pending jobs "Cancelled" — its
 *   own truthful state, excluded from the failure counts.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./AutoClipSection.tsx");

describe("exports settle honestly, with unknown kept distinct from failed", () => {
  it("the accept gate and the unknown-outcome doctrine are pinned", () => {
    expect(src).toContain("if (!res.ok) {");
    expect(src).toContain("/* True when a clip's export outcome is UNKNOWN (the poller lost contact,");
    expect(src).toContain("isUnknownOutcomeCode(j.errorCode)");
    expect(src).toContain('{ ...j, status: "error", error: "Cancelled" }');
  });
});
