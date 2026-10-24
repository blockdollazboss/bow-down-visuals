/**
 * A-06 + A-09 (Stack-100 #3) — lip-sync money + control wiring pins.
 *
 * A-06: run-all used to enqueue paid Sync.so jobs at 0 VB per scene.
 * processRunAll now charges LIP_SYNC_PREVIEW_CREDIT_COST per submitted
 * scene BEFORE the enqueue (same chargeCredits rail + idempotency as
 * the single-clip preview), refunds only when the enqueue itself fails,
 * and the route gate totals scenes × 300 + the export's real price
 * (branded free / clean 400).
 *
 * A-09: the preview route no longer voids the four editor controls —
 * they are persisted into the durable job params, and the poller hands
 * the job's strength to the provider submit.
 *
 * Source pins (the route module pulls the whole provider pipeline —
 * same precedent as export-jobs-refund.test.ts Part 2).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lipSyncSrc = readFileSync(
  fileURLToPath(new URL("../lip-sync.ts", import.meta.url)),
  "utf8",
);
const pollerSrc = readFileSync(
  fileURLToPath(new URL("../../lib/job-poller.ts", import.meta.url)),
  "utf8",
);

describe("A-06 — run-all charges like the preview", () => {
  const runAllStart = lipSyncSrc.indexOf("async function processRunAll");
  const runAllEnd = lipSyncSrc.indexOf("router.post(\"/lip-sync/run-all\"");
  const runAll = lipSyncSrc.slice(runAllStart, runAllEnd);

  it("charges the preview price per scene BEFORE enqueueing the sub-job", () => {
    const chargeIdx = runAll.indexOf("chargeCredits(ctx.userId, LIP_SYNC_PREVIEW_CREDIT_COST");
    const enqueueIdx = runAll.indexOf("createLipSyncJob({");
    expect(chargeIdx).toBeGreaterThan(-1);
    expect(enqueueIdx).toBeGreaterThan(chargeIdx);
  });

  it("the scene charge is idempotent per (user, run, scene)", () => {
    expect(runAll).toMatch(/buildChargeIdempotencyKey\(\s*"lip-sync-run-all"/);
    expect(runAll).toMatch(/action: "Lip Sync — Run All"/);
  });

  it("an enqueue failure refunds the scene charge (and only that path refunds)", () => {
    expect(runAll).toMatch(/refundCredits\(ctx\.userId, LIP_SYNC_PREVIEW_CREDIT_COST/);
    expect(runAll).toMatch(/Lip Sync — Refund \(enqueue failed\)/);
    // Exactly one refund site in the orchestrator: the enqueue-failure leg.
    expect(runAll.match(/refundCredits\(/g)?.length).toBe(1);
  });

  it("over-limit scenes are skipped before any charge is attempted", () => {
    const skipIdx = runAll.indexOf("t.dur > PROVIDER_LIMIT_SEC");
    const chargeIdx = runAll.indexOf("chargeCredits(ctx.userId, LIP_SYNC_PREVIEW_CREDIT_COST");
    expect(skipIdx).toBeGreaterThan(-1);
    expect(chargeIdx).toBeGreaterThan(skipIdx);
  });

  it("the route gate totals submittable scenes x 300 + the export's real price", () => {
    const gate = lipSyncSrc.slice(runAllEnd);
    expect(gate).toMatch(/submittableScenes \* LIP_SYNC_PREVIEW_CREDIT_COST/);
    expect(gate).toMatch(/exportBranded \? 0 : EXPORT_CREDIT_COST/);
    expect(gate).toMatch(/predictExportWatermarked\(/);
  });
});

describe("A-09 — the four controls are wired, not voided", () => {
  it("the preview route no longer discards the controls", () => {
    expect(lipSyncSrc).not.toMatch(/void audioSourceType;/);
    expect(lipSyncSrc).not.toMatch(/void strength;/);
    expect(lipSyncSrc).not.toMatch(/void preserveFaceIdentity;/);
    expect(lipSyncSrc).not.toMatch(/void preserveArtistLook;/);
  });

  it("all four are persisted into the durable job params at enqueue", () => {
    expect(lipSyncSrc).toMatch(/audioSourceType: audioSourceType \?\? null/);
    expect(lipSyncSrc).toMatch(/strength: strength \?\? null/);
    expect(lipSyncSrc).toMatch(/preserveFaceIdentity: preserveFaceIdentity \?\? null/);
    expect(lipSyncSrc).toMatch(/preserveArtistLook: preserveArtistLook \?\? null/);
  });

  it("the poller hands the job's strength to the provider submit", () => {
    expect(pollerSrc).toMatch(
      /syncLabsSubmit\(providerClipUrl, segmentUrl, apiKey, job\.params\.strength\)/,
    );
  });
});
