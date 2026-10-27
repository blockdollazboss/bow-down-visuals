/**
 * final-video-export-gating.test.ts — payfix lane 6, rung 2.
 *
 * Oct 26 Pass-3 defects (b) and (c), pinned by source (the established
 * pattern for this component — it cannot mount in the node harness):
 *  (b) the spend dialog truly gates: handleExport must NOT enter the
 *      exporting/stitching state before the confirmation resolves, and
 *      a pre-confirm Cancel must reset to idle (the old code returned
 *      with status stuck on "exporting" forever);
 *  (b2) a mid-job Cancel control exists and aborts the poll;
 *  (a) the dialog prices through exportPriceFor (branded = 0), passed
 *      as overrideCost — never the static 400 registry entry;
 *  (c) the reserve is visible: charge info from POST 202 + polls is
 *      stored, rendered in a panel, and the profile refreshes when the
 *      hold lands/changes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const component = readFileSync(join(__dirname, "FinalVideoExport.tsx"), "utf8");
const en = readFileSync(join(__dirname, "..", "locales", "en.json"), "utf8");

function handleExportBody(): string {
  const start = component.indexOf("async function handleExport");
  const end = component.indexOf("async function handleCancelExport");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return component.slice(start, end);
}

describe("FinalVideoExport — dialog gating (Pass-3 defect b)", () => {
  it("handleExport does not set exporting/stitching before the confirmation", () => {
    const body = handleExportBody();
    // The only setStatus("exporting") in handleExport lives inside the
    // onConfirmedStart callback that runExportRequest fires AFTER the
    // spend dialog resolves.
    expect(body).toContain("const startAfterConfirm = () => {");
    const callback = body.slice(body.indexOf("const startAfterConfirm"));
    expect(callback).toContain('setStatus("exporting")');
    expect(body.indexOf('setStatus("exporting")')).toBeGreaterThan(body.indexOf("const startAfterConfirm"));
    expect(body).toContain("setAwaitingConfirm(true)");
    expect(body).toContain("result = await runExportRequest(prepareId, qualityOpts, startAfterConfirm)");
  });

  it("pre-confirm cancel resets to idle — no stuck stitching UI", () => {
    const body = handleExportBody();
    const nullBranch = body.slice(body.indexOf("if (!result) {"));
    expect(nullBranch).toContain('setStatus("idle")');
    expect(nullBranch).toContain('setProgressStep("")');
    expect(nullBranch).toContain("setConfirmed(false)");
    expect(nullBranch).toContain("activeJobIdRef.current = null");
  });

  it("a cancelled job resets to idle in the catch, never to failed", () => {
    const body = handleExportBody();
    const cancelBranch = body.slice(body.indexOf("isExportCancelledError(err)"));
    expect(cancelBranch).toContain('setStatus("idle")');
    expect(cancelBranch.indexOf('setStatus("idle")')).toBeLessThan(cancelBranch.indexOf('setStatus("failed")'));
    expect(cancelBranch).toContain("refreshProfile()");
  });
});

describe("FinalVideoExport — dialog pricing (Pass-3 defect a)", () => {
  it("prices through exportPriceFor and passes overrideCost/Feature to confirmedFetch", () => {
    expect(component).toContain('from "@/lib/export-pricing"');
    expect(component).toContain("const price = exportPriceFor({");
    expect(component).toContain("overrideCost: price.cost");
    expect(component).toContain("overrideFeature: price.feature");
    // The watermark input to the price is the request's actual one:
    // the quality toggle on the quality door, addWatermark otherwise.
    expect(component).toContain("addWatermark: qualityOpts ? qualityOpts.watermark : addWatermark");
  });
});

describe("FinalVideoExport — reserve visibility + mid-job cancel (defect c / b2)", () => {
  it("stores charge info from the 202 and from polls, and renders the reserve panel", () => {
    expect(component).toContain("if (accepted.charge) setExportCharge(accepted.charge)");
    expect(component).toContain("onCharge: (charge) => {");
    expect(component).toContain('data-testid="export-charge-panel"');
    expect(component).toContain("videoExport.chargeReserved");
    expect(component).toContain("videoExport.chargeBrandedFree");
    expect(en).toContain("reserved while this renders");
    expect(en).toContain("Branded export — free (0 Visual Bucs)");
  });

  it("refreshes the profile when the job is accepted and when the hold changes", () => {
    const accepted = component.slice(component.indexOf("activeJobIdRef.current = accepted.jobId"));
    expect(accepted.slice(0, 400)).toContain("refreshProfile()");
    expect(component).toContain("lastChargeKeyRef.current = key");
  });

  it("has a mid-job Cancel control wired to the server cancel + poll abort", () => {
    expect(component).toContain('data-testid="btn-cancel-export"');
    expect(component).toContain("onClick={handleCancelExport}");
    expect(component).toContain("await cancelExportJob({ jobId, getAccessToken })");
    expect(component).toContain("cancelControllerRef.current?.abort()");
    expect(component).toContain("signal: cancelControllerRef.current?.signal");
  });

  it("shows an honest waiting-for-confirmation note while the dialog is open", () => {
    expect(component).toContain('data-testid="export-awaiting-confirm"');
    expect(en).toContain("the export has not started and nothing has been charged yet");
  });
});
