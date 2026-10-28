/**
 * final-video-export-prepare-lifecycle.test.ts — stack500 lane E.
 *
 * Pass 3(a) client half, pinned by source (the established pattern for
 * this component — it cannot mount in the node harness):
 *
 * Prepare sessions are SINGLE-USE server-side: executeExport's finally
 * deletes the session after every run. The gate failure was two branded
 * attempts sharing one spent prepareId — both died. The dialog must
 * therefore:
 *  (a) invalidate its prepareId/prepareAllReady the moment a job
 *      reaches a terminal state (done OR failed/cancelled), so the
 *      next export prepares fresh;
 *  (b) NOT invalidate when no job ever ran (a spend-dialog cancel
 *      leaves the session untouched and reusable);
 *  (c) keep the PREPARE_STALE auto-recovery wired: a job failure
 *      carrying that code re-prepares once and retries with the fresh
 *      id (the server now actually persists the code — lane E rung 1);
 *  (d) never show fake telemetry: the prepare summary's hardcoded
 *      "FFmpeg started: no" literal is gone (it read "no" for every
 *      export ever run, including successful ones).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const component = readFileSync(join(__dirname, "FinalVideoExport.tsx"), "utf8");

function handleExportBody(): string {
  const start = component.indexOf("async function handleExport");
  const end = component.indexOf("async function handleCancelExport");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return component.slice(start, end);
}

describe("FinalVideoExport — prepare lifecycle (lane E)", () => {
  it("defines invalidatePrepare: drops the id, the ready flag, and the expiry", () => {
    expect(component).toContain("function invalidatePrepare()");
    const start = component.indexOf("function invalidatePrepare()");
    const body = component.slice(start, start + 500);
    expect(body).toContain("setPrepareId(null)");
    expect(body).toContain("setPrepareAllReady(false)");
    expect(body).toContain("setPrepareExpiresAt(null)");
    expect(body).toContain('setPrepareState("idle")');
  });

  it("invalidates on terminal success (job done = session consumed)", () => {
    const body = handleExportBody();
    const completedAt = body.indexOf('setStatus("completed")');
    expect(completedAt).toBeGreaterThan(-1);
    expect(body.slice(completedAt, completedAt + 300)).toContain("invalidatePrepare()");
  });

  it("invalidates in the failure catch when a job actually ran", () => {
    const body = handleExportBody();
    // The gate sits on the job ref: errors thrown before any job
    // existed must not burn a still-valid prepare session.
    expect(body).toContain("if (activeJobIdRef.current !== null) invalidatePrepare();");
    const gateAt = body.indexOf("if (activeJobIdRef.current !== null) invalidatePrepare();");
    const cancelBranchAt = body.indexOf("isExportCancelledError(err)");
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(cancelBranchAt);
  });

  it("a pre-confirm cancel (no job, no charge) does NOT invalidate the session", () => {
    const body = handleExportBody();
    const nullBranch = body.slice(body.indexOf("if (!result) {"), body.indexOf("if (!result) {") + 700);
    expect(nullBranch).toContain('setStatus("idle")');
    expect(nullBranch).not.toContain("invalidatePrepare()");
  });

  it("the PREPARE_STALE auto-recovery stays wired: re-prepare once, retry with the fresh id", () => {
    const body = handleExportBody();
    expect(body).toContain('if (code === "PREPARE_STALE")');
    const recovery = body.slice(body.indexOf('if (code === "PREPARE_STALE")'));
    expect(recovery).toContain("await handlePrepare()");
    expect(recovery).toContain("result = await runExportRequest(freshPrepareId, qualityOpts, startAfterConfirm)");
  });

  it("no fake telemetry: the hardcoded 'FFmpeg started: no' prepare-summary line is gone", () => {
    expect(component).not.toContain("ffmpegStartedLabel");
  });
});
