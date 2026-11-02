/**
 * lip-sync-duration-tier.test.ts — stack1400, owner ruled 2026-11-02.
 *
 * The duration tier for the lip-sync charge:
 *   clip ≤ 50s        → 300 Visual Bucs (the long-standing flat price)
 *   clip 50–60s       → 600 Visual Bucs (WaveSpeed ~$1.80/min; the flat
 *                       300 VB breaks even at exactly 50.0s)
 *   clip > 60s        → existing behaviour unchanged (base charge on
 *                       the preview rail, poller fails it over the
 *                       provider limit and refunds; run-all skips it)
 *
 * The charge must be honest and up-front: computed from the clip's
 * REAL duration (sceneEndSec − sceneStartSec on preview, the scene
 * window on run-all) BEFORE the job is enqueued, used for the balance
 * gate, the charge, and every refund — and recorded on the job so the
 * poller's failure refund restores the tiered amount, not the base.
 *
 * Unit pins run the real helper from lib/lip-sync-jobs.ts; wiring pins
 * are source-shape (the route module pulls the whole provider
 * pipeline — same precedent as lip-sync-decisions.test.ts).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  LIP_SYNC_JOB_CHARGE_CREDITS,
  LIP_SYNC_LONG_CLIP_CREDIT_COST,
  LIP_SYNC_LONG_CLIP_MAX_SEC,
  LIP_SYNC_LONG_CLIP_THRESHOLD_SEC,
  lipSyncChargeForDurationSec,
  lipSyncChargeForJob,
  type LipSyncJob,
} from "../../lib/lip-sync-jobs";

const lipSyncSrc = readFileSync(
  fileURLToPath(new URL("../lip-sync.ts", import.meta.url)),
  "utf8",
);
const pollerSrc = readFileSync(
  fileURLToPath(new URL("../../lib/job-poller.ts", import.meta.url)),
  "utf8",
);

describe("lipSyncChargeForDurationSec — the tier itself", () => {
  it("pins the tier constants", () => {
    expect(LIP_SYNC_JOB_CHARGE_CREDITS).toBe(300);
    expect(LIP_SYNC_LONG_CLIP_CREDIT_COST).toBe(600);
    expect(LIP_SYNC_LONG_CLIP_THRESHOLD_SEC).toBe(50);
    expect(LIP_SYNC_LONG_CLIP_MAX_SEC).toBe(60);
  });

  it("≤50s stays 300 VB", () => {
    for (const d of [0.5, 1, 5, 25, 49.999, 50]) {
      expect(lipSyncChargeForDurationSec(d)).toBe(300);
    }
  });

  it("50–60s costs 600 VB", () => {
    for (const d of [50.001, 50.5, 55, 59.999, 60]) {
      expect(lipSyncChargeForDurationSec(d)).toBe(600);
    }
  });

  it("over 60s keeps the existing behaviour (base 300 VB)", () => {
    for (const d of [60.001, 61, 90, 600]) {
      expect(lipSyncChargeForDurationSec(d)).toBe(300);
    }
  });

  it("invalid durations fall back to the base price (callers validate timing separately)", () => {
    for (const d of [Number.NaN, undefined, null, -5, 0]) {
      expect(lipSyncChargeForDurationSec(d)).toBe(300);
    }
  });
});

describe("lipSyncChargeForJob — the refund amount is the job's own charge", () => {
  const jobWith = (creditsCharged?: number | null): Pick<LipSyncJob, "params"> => ({
    params: {
      clipUrl: "https://example.com/clip.mp4",
      audioUrl: "https://example.com/song.mp3",
      sceneStartSec: 0,
      sceneEndSec: 55,
      ...(creditsCharged !== undefined ? { creditsCharged } : {}),
    },
  });

  it("a recorded 600 VB charge refunds 600", () => {
    expect(lipSyncChargeForJob(jobWith(600))).toBe(600);
  });

  it("a recorded 300 VB charge refunds 300", () => {
    expect(lipSyncChargeForJob(jobWith(300))).toBe(300);
  });

  it("a pre-tier job (no record) refunds the flat 300 it actually paid — never a re-computed tier", () => {
    // This job's window is 55s, which WOULD tier to 600 today — but it
    // was charged 300 before the tier existed, so 300 is the truth.
    expect(lipSyncChargeForJob(jobWith(undefined))).toBe(300);
    expect(lipSyncChargeForJob(jobWith(null))).toBe(300);
  });

  it("a corrupt record falls back to the base price", () => {
    expect(lipSyncChargeForJob(jobWith(0))).toBe(300);
    expect(lipSyncChargeForJob(jobWith(-600))).toBe(300);
    expect(lipSyncChargeForJob(jobWith(Number.NaN))).toBe(300);
  });
});

describe("preview rail — tiered, up-front, from the real window", () => {
  const start = lipSyncSrc.indexOf('router.post("/lip-sync/preview"');
  const preview = lipSyncSrc.slice(start, lipSyncSrc.indexOf('router.post(\n  "/lip-sync/upload-vocal-stem"'));

  it("keeps both price constants on the route", () => {
    expect(lipSyncSrc).toContain("const LIP_SYNC_PREVIEW_CREDIT_COST = 300;");
    expect(lipSyncSrc).toContain("const LIP_SYNC_LONG_CLIP_CREDIT_COST = 600;");
  });

  it("computes the charge from sceneEndSec − sceneStartSec", () => {
    expect(preview).toContain("const clipDurationSec = sceneEndSec - sceneStartSec;");
    expect(preview).toContain(
      "const previewChargeCredits = lipSyncChargeForDurationSec(clipDurationSec);",
    );
  });

  it("the balance gate and both 402 answers quote the tiered amount", () => {
    expect(preview).toContain("(req.userCredits ?? 0) < previewChargeCredits");
    expect(preview.match(/required: previewChargeCredits/g)?.length).toBe(2);
  });

  it("charges the tiered amount BEFORE enqueueing, and records it on the job", () => {
    const chargeIdx = preview.indexOf("chargeCredits(userId, previewChargeCredits");
    const enqueueIdx = preview.indexOf("createLipSyncJob({");
    expect(chargeIdx).toBeGreaterThan(-1);
    expect(enqueueIdx).toBeGreaterThan(chargeIdx);
    expect(preview).toContain("creditsCharged: previewChargeCredits");
  });

  it("an enqueue failure refunds the tiered amount, and the answer reports it", () => {
    expect(preview).toContain("refundCredits(userId, previewChargeCredits");
    expect(preview).toContain("creditsCharged: previewChargeCredits");
  });

  it("the client job shape reports the job's own refunded amount", () => {
    expect(lipSyncSrc).toContain(
      "...(job.chargeRefunded ? { refundedCredits: lipSyncChargeForJob(job) } : {})",
    );
  });
});

describe("run-all — the same tier per scene", () => {
  const runAllStart = lipSyncSrc.indexOf("async function processRunAll");
  const runAllEnd = lipSyncSrc.indexOf('router.post("/lip-sync/run-all"');
  const runAll = lipSyncSrc.slice(runAllStart, runAllEnd);
  const gate = lipSyncSrc.slice(runAllEnd);

  it("prices each scene from its real window", () => {
    expect(runAll).toContain("const sceneChargeCredits = lipSyncChargeForDurationSec(t.dur);");
    expect(runAll).toContain("chargeCredits(ctx.userId, sceneChargeCredits");
    expect(runAll).toContain("refundCredits(ctx.userId, sceneChargeCredits");
    expect(runAll).toContain("creditsCharged: sceneChargeCredits");
  });

  it("the out-of-credits scene error names that scene's tiered price", () => {
    expect(runAll).toContain("${sceneChargeCredits} Visual Bucs per scene");
  });

  it("the route gate sums the tiered per-scene prices (skipped scenes never counted)", () => {
    expect(gate).toContain("lipSyncChargeForDurationSec(t.dur)");
    expect(gate).toContain("lipSyncCreditsTotal +");
    expect(gate).toMatch(/exportBranded \? 0 : EXPORT_CREDIT_COST/);
  });
});

describe("poller — a failed 600 VB job refunds 600, and says so", () => {
  it("the failure refund restores the job's own recorded charge", () => {
    expect(pollerSrc).toContain("refundCredits(job.userId, lipSyncChargeForJob(job)");
  });

  it("every failure tell names the job's own amount", () => {
    const tells =
      pollerSrc.match(/lipSyncFailureNotice\([^;]*?lipSyncChargeForJob\(job\)\)/gs) ?? [];
    // Five live failure paths + the boot-recovery pass.
    expect(tells.length).toBe(6);
  });

  it("the run-all scene tell names the sub-job's own amount", () => {
    expect(lipSyncSrc).toContain(
      "` Your ${lipSyncChargeForJob(verdict)} Visual Bucs were refunded.`",
    );
  });
});
