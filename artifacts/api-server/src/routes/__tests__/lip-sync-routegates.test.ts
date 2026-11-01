/**
 * Stack-200 (LatentSync route) — route-gate source pins.
 *
 * The money law for the switch: when the SELECTED lip-sync route is not
 * configured, the preview and run-all routes must refuse BEFORE any
 * charge is attempted (fail closed — a charge must never land for a job
 * no provider can run). The route module pulls the whole provider
 * pipeline, so — same precedent as lip-sync-decisions.test.ts — these
 * are source pins over the handler bodies.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lipSyncSrc = readFileSync(
  fileURLToPath(new URL("../lip-sync.ts", import.meta.url)),
  "utf8",
);

describe("LatentSync switch — gates fail closed before charging", () => {
  it("preview checks the selected route's configuration before the charge", () => {
    const start = lipSyncSrc.indexOf('router.post("/lip-sync/preview"');
    const slice = lipSyncSrc.slice(start, lipSyncSrc.indexOf("createLipSyncJob({", start));
    const gateIdx = slice.indexOf("isLipSyncProviderConfigured(provider)");
    const chargeIdx = slice.indexOf("chargeCredits(userId, LIP_SYNC_PREVIEW_CREDIT_COST");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(chargeIdx).toBeGreaterThan(gateIdx);
  });

  it("run-all gates on the effective provider, not the Sync.so key alone", () => {
    const start = lipSyncSrc.indexOf('router.post("/lip-sync/run-all"');
    const slice = lipSyncSrc.slice(start, start + 1500);
    expect(slice).toMatch(/isLipSyncProviderConfigured\(getLipSyncProviderName\(\)\)/);
    expect(lipSyncSrc).not.toMatch(/isLipSyncServerKeyFound/);
  });

  it("the client job shape carries the result metadata", () => {
    expect(lipSyncSrc).toMatch(/resultMeta: job\.resultMeta \?\? undefined/);
  });

  it("jobs are stamped with the effective provider at enqueue", () => {
    expect(lipSyncSrc).toMatch(/provider: getLipSyncProviderName\(\)/);
  });
});

describe("Owner's ruling (2026-10-26) — run-all rides the same switch as the single-clip rail", () => {
  it("the run-all orchestrator stamps each scene sub-job with the effective provider", () => {
    const runAllStart = lipSyncSrc.indexOf("async function processRunAll");
    const runAllEnd = lipSyncSrc.indexOf('router.post("/lip-sync/run-all"');
    const runAll = lipSyncSrc.slice(runAllStart, runAllEnd);
    // Same stamp as POST /lip-sync/preview: whatever the switch resolves
    // (LatentSync by default; sync-3 only when explicitly selected) is
    // what every scene of a run is created for — run-all can never drift
    // onto a different route than the single-clip path.
    expect(runAll).toMatch(/provider: getLipSyncProviderName\(\)/);
  });
});
