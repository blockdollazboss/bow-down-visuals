/**
 * Payfix lane 6, rung 3 — mid-job cancel + exactly-once release +
 * charge/reserve visibility.
 *
 * Part 1 drives the real export-jobs lib against a fake pool whose
 * UPDATE semantics mirror the SQL WHERE clauses (state guards and the
 * credits_charged flip), same harness shape as export-reserve.test.ts:
 *  - cancel flips queued/active → cancelled atomically, never a
 *    terminal job;
 *  - failJob can no longer overwrite a cancelled job;
 *  - releaseJobReservation is claim-gated: two concurrent releasers
 *    (cancel endpoint + worker) refund EXACTLY ONCE.
 * Part 2 unit-tests buildExportChargeInfo (the POST 202 / GET payload)
 * and pins the route/worker wiring by source.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const h = vi.hoisted(() => ({
  state: "active" as string,
  flag: false,
  profileCredits: 10_000,
  refunds: [] as Array<{ userId: string; amount: number; action: string }>,
}));

function sqlText(q: any): string {
  const parts: string[] = [];
  const walk = (node: any): void => {
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (typeof node.value === "string") parts.push(node.value);
    if (Array.isArray(node.value)) node.value.forEach(walk);
    if (Array.isArray(node.queryChunks)) node.queryChunks.forEach(walk);
  };
  walk(q);
  return parts.join(" ");
}

function jobRow(): Record<string, unknown> {
  return {
    id: "job-1",
    user_id: "user-1",
    project_id: "proj-1",
    state: h.state,
    stage: "combining",
    progress: 0,
    params: { projectId: "proj-1", clipUrls: ["https://x/clip.mp4"], addWatermark: false },
    result: null,
    error: null,
    credits_charged: h.flag,
    attempts: 1,
    created_at: "2026-10-26T00:00:00.000Z",
    updated_at: "2026-10-26T00:00:00.000Z",
  };
}

vi.mock("pg", () => ({ Pool: class Pool {} }));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: () => ({
    execute: async (q: any) => {
      const text = sqlText(q);
      if (/SET state = 'cancelled'/.test(text)) {
        if (h.state !== "queued" && h.state !== "active") return { rows: [] };
        h.state = "cancelled";
        return { rows: [jobRow()] };
      }
      if (/SET state = 'failed'/.test(text)) {
        if (h.state === "queued" || h.state === "active") h.state = "failed";
        return { rows: [] };
      }
      if (/SET credits_charged = true/.test(text)) {
        if (h.flag) return { rows: [] };
        h.flag = true;
        return { rows: [{ id: "job-1" }] };
      }
      if (/SET credits_charged = false/.test(text)) {
        if (!h.flag) return { rows: [] };
        h.flag = false;
        return { rows: [{ id: "job-1" }] };
      }
      if (/FROM export_jobs/.test(text)) {
        return { rows: [jobRow()] };
      }
      return { rows: [] };
    },
  }),
}));

vi.mock("@workspace/db", () => ({ pgSslConfig: () => undefined }));

vi.mock("../logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

vi.mock("../credits", () => ({
  canUseCredits: async () => true,
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  CreditsDisabledError: class CreditsDisabledError extends Error {},
  refundCredits: async (userId: string, amount: number, record: { action: string }) => {
    h.refunds.push({ userId, amount, action: record.action });
    h.profileCredits += amount;
  },
}));

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { credits: h.profileCredits }, error: null }),
        }),
      }),
      update: (patch: { credits: number }) => ({
        eq: async () => {
          h.profileCredits = patch.credits;
          return { error: null };
        },
      }),
    }),
  }),
}));

import {
  reserveCreditsForJob,
  releaseJobReservation,
  claimChargeRelease,
  cancelExportJob,
  failJob,
  getExportJob,
} from "../export-jobs";
import { buildExportChargeInfo } from "../../routes/generate/export-video";

beforeAll(() => {
  process.env["DATABASE_URL"] = "postgres://localhost:5432/test";
});

beforeEach(() => {
  h.state = "active";
  h.flag = false;
  h.profileCredits = 10_000;
  h.refunds = [];
});

describe("cancelExportJob — atomic queued/active → cancelled", () => {
  it("cancels an active job; a second cancel finds no row (already terminal)", async () => {
    const cancelled = await cancelExportJob("job-1");
    expect(cancelled?.state).toBe("cancelled");
    expect(h.state).toBe("cancelled");
    expect(await cancelExportJob("job-1")).toBeUndefined();
  });

  it("cancels a queued job (it can then never be claimed or reserved)", async () => {
    h.state = "queued";
    const cancelled = await cancelExportJob("job-1");
    expect(cancelled?.state).toBe("cancelled");
  });

  it("never clobbers a done job", async () => {
    h.state = "done";
    expect(await cancelExportJob("job-1")).toBeUndefined();
    expect(h.state).toBe("done");
  });

  it("failJob cannot overwrite a cancelled job with a late worker error", async () => {
    await cancelExportJob("job-1");
    await failJob("job-1", { message: "late ffmpeg error" });
    const job = await getExportJob("job-1");
    expect(job?.state).toBe("cancelled");
  });
});

describe("cancel release — exactly once across endpoint + worker", () => {
  it("reserve → cancel release refunds the hold once; the worker's second release refunds nothing", async () => {
    await reserveCreditsForJob("job-1", "user-1", 400);
    expect(h.profileCredits).toBe(9_600);

    await cancelExportJob("job-1");
    // Cancel endpoint's release:
    await releaseJobReservation("job-1", "user-1", 400, "Final Video Export — Refund (export cancelled)");
    // Worker's cancel-path release for the same job:
    await releaseJobReservation("job-1", "user-1", 400, "Final Video Export — Refund (export cancelled)");

    expect(h.refunds).toEqual([
      { userId: "user-1", amount: 400, action: "Final Video Export — Refund (export cancelled)" },
    ]);
    expect(h.profileCredits).toBe(10_000);
    expect(h.flag).toBe(false);
  });

  it("claimChargeRelease flips exactly once", async () => {
    await reserveCreditsForJob("job-1", "user-1", 400);
    expect(await claimChargeRelease("job-1")).toBe(true);
    expect(await claimChargeRelease("job-1")).toBe(false);
  });
});

describe("buildExportChargeInfo — charge/reserve info on POST 202 + GET job", () => {
  const cleanParams = { projectId: "p", clipUrls: ["https://x/c.mp4"], addWatermark: false };
  const brandedParams = { projectId: "p", clipUrls: ["https://x/c.mp4"], addWatermark: true };

  it("branded is free in every state (A-01)", () => {
    for (const state of ["queued", "active", "done", "cancelled"] as const) {
      expect(
        buildExportChargeInfo({ state, creditsCharged: false, params: brandedParams, result: null }, "pro"),
      ).toMatchObject({ branded: true, cost: 0, reservedAmount: 0, chargedAmount: 0, chargeState: "free" });
    }
    // A non-subscriber is force-branded even with addWatermark off.
    expect(
      buildExportChargeInfo({ state: "active", creditsCharged: false, params: cleanParams, result: null }, "free"),
    ).toMatchObject({ branded: true, cost: 0, chargeState: "free" });
  });

  it("clean job: will-reserve before the hold, reserved while it stands (A-07)", () => {
    expect(
      buildExportChargeInfo({ state: "queued", creditsCharged: false, params: cleanParams, result: null }, "pro"),
    ).toEqual({ branded: false, cost: 400, reservedAmount: 0, chargedAmount: 0, chargeState: "will-reserve" });
    expect(
      buildExportChargeInfo({ state: "active", creditsCharged: true, params: cleanParams, result: null }, "pro"),
    ).toEqual({ branded: false, cost: 400, reservedAmount: 400, chargedAmount: 0, chargeState: "reserved" });
  });

  it("success settles exactly the reserved 400 — chargedAmount only on done", () => {
    expect(
      buildExportChargeInfo(
        { state: "done", creditsCharged: true, params: cleanParams, result: { url: "https://x/out.mp4", watermarked: false } },
        "pro",
      ),
    ).toEqual({ branded: false, cost: 400, reservedAmount: 0, chargedAmount: 400, chargeState: "settled" });
  });

  it("cancelled / failed jobs show the hold released and nothing charged", () => {
    expect(
      buildExportChargeInfo({ state: "cancelled", creditsCharged: false, params: cleanParams, result: null }, "pro"),
    ).toMatchObject({ reservedAmount: 0, chargedAmount: 0, chargeState: "released" });
    expect(
      buildExportChargeInfo({ state: "failed", creditsCharged: false, params: cleanParams, result: null }, "pro"),
    ).toMatchObject({ reservedAmount: 0, chargedAmount: 0, chargeState: "released" });
  });

  it("the render's ACTUAL watermark state wins on done — a branded result is free even if a hold stood", () => {
    expect(
      buildExportChargeInfo(
        { state: "done", creditsCharged: true, params: cleanParams, result: { url: "https://x/out.mp4", watermarked: true } },
        "pro",
      ),
    ).toMatchObject({ branded: true, cost: 0, chargedAmount: 0, chargeState: "free" });
  });

  it("quality-tier params price at the same 400 (A-02)", () => {
    expect(
      buildExportChargeInfo(
        { state: "active", creditsCharged: true, params: { ...cleanParams, quality: { enabled: true } }, result: null },
        "pro",
      ),
    ).toMatchObject({ cost: 400, reservedAmount: 400 });
  });
});

describe("route/worker wiring — cancel endpoint + never settle cancelled (source pins)", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../../routes/generate/export-video.ts", import.meta.url)),
    "utf8",
  );

  it("exposes POST /export-video-job/:jobId/cancel behind auth with an ownership check", () => {
    expect(src).toContain('router.post("/export-video-job/:jobId/cancel", requireAuth');
    const cancelRoute = src.slice(src.indexOf('router.post("/export-video-job/:jobId/cancel"'));
    expect(cancelRoute).toContain("job.userId !== req.userId");
    expect(cancelRoute).toContain("await cancelExportJob(jobId)");
    expect(cancelRoute).toContain("Refund (export cancelled)");
  });

  it("charge info rides the POST 202 and the GET job response", () => {
    expect(src).toContain("charge: buildExportChargeInfo(job, req.userPlan)");
    expect(src).toContain("charge: buildExportChargeInfo(fresh ?? job, req.userPlan)");
  });

  it("the worker re-reads the job after the render and discards a cancelled job before settling", () => {
    const cancelCheck = src.indexOf('jobAfterRender?.state === "cancelled"');
    const settle = src.indexOf("await completeJob(jobId, result)");
    expect(cancelCheck).toBeGreaterThan(-1);
    expect(settle).toBeGreaterThan(cancelCheck);
    // The cancel block itself ends where the settle block begins.
    const cancelBlock = src.slice(cancelCheck, src.indexOf("Settle on success", cancelCheck));
    expect(cancelBlock).toContain("releaseJobReservation");
    expect(cancelBlock).toContain("Refund (export cancelled)");
    expect(cancelBlock).not.toContain("recordCreditUsageStrict");
    expect(cancelBlock).not.toContain("chargeCreditsForJob");
  });
});
