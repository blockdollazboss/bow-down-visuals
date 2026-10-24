/**
 * D5 G2 — the export rail's charge/refund bookkeeping.
 *
 * The rail charges through chargeCreditsForJob, whose exactly-once
 * gate is the export_jobs.credits_charged flag. Before the fix, when
 * the completion save (completeJob) threw AFTER a successful charge,
 * the job failed with the charge standing and no refund leg anywhere.
 * The worker now refunds the exact charged amount and calls
 * clearJobChargeFlag so the row stays honest and a recovery re-run
 * can charge again — exactly once.
 *
 * Part 1 drives the real lib against a fake pool: charge flips the
 * flag once, a second charge is refused, clearing the flag after a
 * refund re-arms exactly one more charge.
 * Part 2 pins the worker wiring in export-video.ts by source (the
 * worker module pulls the whole ffmpeg pipeline, so it is not
 * imported here — same precedent as chat-voice-wiring.test.ts).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const h = vi.hoisted(() => ({
  flag: false,
  profileCredits: 10_000,
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

vi.mock("pg", () => ({ Pool: class Pool {} }));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: () => ({
    execute: async (q: any) => {
      const text = sqlText(q);
      if (/SET credits_charged = true/.test(text)) {
        if (h.flag) return { rows: [] };
        h.flag = true;
        return { rows: [{ id: "job-1" }] };
      }
      if (/SET credits_charged = false/.test(text)) {
        h.flag = false;
        return { rows: [] };
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

import { chargeCreditsForJob, clearJobChargeFlag } from "../export-jobs";

beforeAll(() => {
  process.env["DATABASE_URL"] = "postgres://fake";
});

beforeEach(() => {
  h.flag = false;
  h.profileCredits = 10_000;
});

describe("export job charge flag — refund re-arms exactly one charge (G2)", () => {
  it("charges once, refuses a second charge while the flag stands", async () => {
    const first = await chargeCreditsForJob("job-1", "user-1", 400);
    expect(first).toEqual({ charged: true, creditsAfter: 9_600 });
    expect(h.profileCredits).toBe(9_600);

    const second = await chargeCreditsForJob("job-1", "user-1", 400);
    expect(second.charged).toBe(false);
    expect(h.profileCredits).toBe(9_600);
  });

  it("after a refund + flag clear, a recovery re-run charges exactly once more", async () => {
    await chargeCreditsForJob("job-1", "user-1", 400);
    // The worker's refund leg returns the money (lib/credits), then:
    h.profileCredits += 400;
    await clearJobChargeFlag("job-1");
    expect(h.flag).toBe(false);

    const rerun = await chargeCreditsForJob("job-1", "user-1", 400);
    expect(rerun).toEqual({ charged: true, creditsAfter: 9_600 });
    const third = await chargeCreditsForJob("job-1", "user-1", 400);
    expect(third.charged).toBe(false);
    expect(h.profileCredits).toBe(9_600);
  });
});

describe("worker wiring — completion-save failure refunds (source pins)", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../../routes/generate/export-video.ts", import.meta.url)),
    "utf8",
  );

  it("tracks this run's standing amount from the rail price it reserved/charged, not a re-derived figure", () => {
    // A-07 (Stack-100 #3): the standing amount is now set when the price is
    // reserved at job start (and on the charge-on-success fallback) — the
    // save-failure refund still returns exactly that standing amount.
    expect(src).toMatch(/exportChargedCost = railCost/);
    expect(src).toMatch(/refundCredits\(ctx\.userId, exportChargedCost/);
  });

  it("the refund + flag clear sit on the completeJob failure path", () => {
    const completeIdx = src.indexOf("await completeJob(jobId, result)");
    const refundIdx = src.indexOf("Refund (save failed)");
    const clearIdx = src.indexOf("await clearJobChargeFlag(jobId)");
    expect(completeIdx).toBeGreaterThan(-1);
    expect(refundIdx).toBeGreaterThan(completeIdx);
    expect(clearIdx).toBeGreaterThan(refundIdx);
  });
});
