/**
 * A-06 + A-09 (Stack-100 #3) — lip-sync money + control wiring pins.
 *
 * A-06: run-all used to enqueue paid Sync.so jobs at 0 VB per scene.
 * processRunAll now charges the per-scene price BEFORE the enqueue
 * (same chargeCredits rail + idempotency as the single-clip preview),
 * refunds only when the enqueue itself fails, and the route gate
 * totals the per-scene prices + the export's real price (branded
 * free / clean 400). Since stack1400 the per-scene price is the
 * duration tier (lipSyncChargeForDurationSec on the scene's real
 * window: ≤50s → 300 VB, 50–60s → 600 VB) — see
 * lip-sync-duration-tier.test.ts for the tier pins themselves.
 *
 * A-09: the preview route no longer voids the four editor controls —
 * they are persisted into the durable job params. (Stack1400: strength
 * stays recorded-only — the live model exposes no strength dial, and
 * the former route's temperature mapping was removed with that route.)
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
    const chargeIdx = runAll.indexOf("chargeCredits(ctx.userId, sceneChargeCredits");
    const enqueueIdx = runAll.indexOf("createLipSyncJob({");
    expect(chargeIdx).toBeGreaterThan(-1);
    expect(enqueueIdx).toBeGreaterThan(chargeIdx);
    expect(runAll).toContain("const sceneChargeCredits = lipSyncChargeForDurationSec(t.dur);");
  });

  it("the scene charge is idempotent per (user, run, scene)", () => {
    expect(runAll).toMatch(/buildChargeIdempotencyKey\(\s*"lip-sync-run-all"/);
    expect(runAll).toMatch(/action: "Lip Sync — Run All"/);
  });

  it("an enqueue failure refunds the scene charge (and only that path refunds)", () => {
    expect(runAll).toMatch(/refundCredits\(ctx\.userId, sceneChargeCredits/);
    expect(runAll).toMatch(/Lip Sync — Refund \(enqueue failed\)/);
    // Exactly one refund site in the orchestrator: the enqueue-failure leg.
    expect(runAll.match(/refundCredits\(/g)?.length).toBe(1);
  });

  it("over-limit scenes are skipped before any charge is attempted", () => {
    const skipIdx = runAll.indexOf("t.dur > PROVIDER_LIMIT_SEC");
    const chargeIdx = runAll.indexOf("chargeCredits(ctx.userId, sceneChargeCredits");
    expect(skipIdx).toBeGreaterThan(-1);
    expect(chargeIdx).toBeGreaterThan(skipIdx);
  });

  it("the route gate totals the tiered per-scene prices + the export's real price", () => {
    const gate = lipSyncSrc.slice(runAllEnd);
    expect(gate).toMatch(/lipSyncChargeForDurationSec\(t\.dur\)/);
    expect(gate).toMatch(/lipSyncCreditsTotal \+/);
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

  it("the poller submits on the live route with no strength argument (the live model has no such dial)", () => {
    expect(pollerSrc).toMatch(
      /waveSpeedSubmit\(providerClipUrl, segmentUrl, apiKey\)/,
    );
    expect(pollerSrc).not.toMatch(/job\.params\.strength/);
  });
});
