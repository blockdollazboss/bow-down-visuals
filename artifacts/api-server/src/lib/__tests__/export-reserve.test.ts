/**
 * A-07 + A-01 (Stack-100 #3) — the export rail's reserve-at-start bookkeeping.
 *
 * Before A-07 the rail charged only after a successful render, so a
 * mid-render balance drop discarded finished renders. The worker now
 * reserves the clean price when the job starts (reserveCreditsForJob),
 * settles the hold against the render's actual output, and releases it in
 * full when the output is branded (A-01: branded exports are free) or the
 * render fails (releaseJobReservation).
 *
 * Part 1 drives the real lib against a fake pool, same harness shape as
 * export-jobs-refund.test.ts: the reservation flips the job's
 * credits_charged flag exactly once, an insufficient balance rolls the
 * flag back, and a release refunds the exact held amount and re-arms.
 * Part 2 pins the worker wiring in export-video.ts by source (the worker
 * module pulls the whole ffmpeg pipeline — same precedent as
 * export-jobs-refund.test.ts Part 2).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const h = vi.hoisted(() => ({
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
} from "../export-jobs";
import { OutOfCreditsError } from "../credits";

beforeAll(() => {
  process.env["DATABASE_URL"] = "postgres://localhost:5432/test";
});

beforeEach(() => {
  h.flag = false;
  h.profileCredits = 10_000;
  h.refunds = [];
});

describe("reserveCreditsForJob — hold the clean price at job start (A-07)", () => {
  it("deducts the hold and flips the flag exactly once", async () => {
    const hold = await reserveCreditsForJob("job-1", "user-1", 400);
    expect(hold).toEqual({ reserved: true, creditsAfter: 9_600 });
    expect(h.profileCredits).toBe(9_600);
    expect(h.flag).toBe(true);
  });

  it("a second reserve while the hold stands moves no money (recovery re-run settles the same hold)", async () => {
    await reserveCreditsForJob("job-1", "user-1", 400);
    const again = await reserveCreditsForJob("job-1", "user-1", 400);
    expect(again.reserved).toBe(false);
    expect(h.profileCredits).toBe(9_600);
  });

  it("insufficient balance throws OutOfCreditsError and rolls the flag back — no phantom hold", async () => {
    h.profileCredits = 399;
    await expect(reserveCreditsForJob("job-1", "user-1", 400)).rejects.toBeInstanceOf(
      OutOfCreditsError,
    );
    expect(h.flag).toBe(false);
    expect(h.profileCredits).toBe(399);
    // And the job can reserve later once the user tops up.
    h.profileCredits = 500;
    const hold = await reserveCreditsForJob("job-1", "user-1", 400);
    expect(hold.reserved).toBe(true);
    expect(h.profileCredits).toBe(100);
  });
});

describe("releaseJobReservation — branded output / failed render refunds the hold in full (A-01 + A-07)", () => {
  it("refunds the exact held amount and clears the flag", async () => {
    await reserveCreditsForJob("job-1", "user-1", 400);
    expect(h.profileCredits).toBe(9_600);

    await releaseJobReservation("job-1", "user-1", 400, "Final Video Export — Refund (branded export is free)");
    expect(h.refunds).toEqual([
      { userId: "user-1", amount: 400, action: "Final Video Export — Refund (branded export is free)" },
    ]);
    expect(h.profileCredits).toBe(10_000);
    expect(h.flag).toBe(false);
  });

  it("after a release, a re-run can reserve again — exactly once", async () => {
    await reserveCreditsForJob("job-1", "user-1", 400);
    await releaseJobReservation("job-1", "user-1", 400, "Final Video Export — Refund (render failed)");
    const hold = await reserveCreditsForJob("job-1", "user-1", 400);
    expect(hold.reserved).toBe(true);
    expect(h.profileCredits).toBe(9_600);
  });
});

describe("worker wiring — reserve/settle in export-video.ts (source pins)", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../../routes/generate/export-video.ts", import.meta.url)),
    "utf8",
  );

  it("reserves BEFORE the render runs, and only for predicted-clean output", () => {
    const reserveIdx = src.indexOf("await reserveCreditsForJob(jobId, ctx.userId, railCost)");
    const renderIdx = src.indexOf("result = await executeExport(ctx)");
    expect(reserveIdx).toBeGreaterThan(-1);
    expect(renderIdx).toBeGreaterThan(reserveIdx);
    expect(src).toMatch(/!IS_DEV && !predictedBranded/);
  });

  it("settles from the render's ACTUAL watermark state, never the prediction", () => {
    expect(src).toMatch(/renderedBranded = \(result as \{ watermarked\?: unknown \}\)\.watermarked === true/);
    expect(src).toMatch(/watermarked: activeWmPath !== null/);
  });

  it("branded output releases the reservation in full", () => {
    expect(src).toMatch(/Refund \(branded export is free\)/);
  });

  it("a failed render releases the reservation in full", () => {
    expect(src).toMatch(/Refund \(render failed\)/);
  });

  it("both export routes gate on the prediction — a branded request is never 402'd on the clean price", () => {
    const gates = src.match(/!predictExportWatermarked\(body, req\.userPlan\)/g) ?? [];
    expect(gates.length).toBe(2);
  });
});
