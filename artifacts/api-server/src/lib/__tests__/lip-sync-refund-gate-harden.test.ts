/**
 * lip-sync-refund-gate-harden.test.ts — stack1200 hardening of the
 * Gate #5 failure-refund gate (migration 0311).
 *
 * The hole this suite convicts: claimLipSyncChargeRefund flipped
 * charge_refunded BEFORE refundCredits ran. If the refund write
 * threw after the flip — credit rail down, profile write failed —
 * the flip stood: the durable gate read "refunded" while no money
 * had moved, and GET /lip-sync/job/:id reports the gate verbatim,
 * so the member's own job record claimed a refund that never
 * happened. Worse, the stuck flip blocked every later attempt:
 * exactly-once had become exactly-never.
 *
 * The hardened discipline (the export rail's claim/re-arm pattern):
 * the flip is a claim; a refund that doesn't land RELEASES it, so
 * the gate reads true only for a completed refund. A poller sweep
 * (retryFailedLipSyncRefunds) retries unlanded refunds of recent
 * failures through the same atomic claim — race-safe against the
 * live failure paths and against itself.
 *
 * What's pinned here, against the REAL charge/refund rails and the
 * REAL job store + poller workers (pg-mem), same harness as
 * lip-sync-refund-tell.test.ts:
 *  1. Claim-then-throw ends truthful: gate back to false, balance
 *     untouched, tell claims nothing — then the sweep lands the
 *     refund exactly once, balance exact to the pre-charge state.
 *  2. Race arbitration: a held claim blocks the sweep; two
 *     concurrent sweeps over a released claim refund exactly once.
 *  3. A failure nobody attempted (process died between the failure
 *     write and the refund) is refunded by the sweep.
 *  4. The sweep is a retry, not a backfill: a stale failed job
 *     (outside the recency window) is left untouched.
 *  5. Boot recovery: a recovery-failed job now refunds AND records
 *     the failure tell with the verdict, exactly once across a
 *     replayed recovery pass.
 */
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const dialect = new PgDialect();

interface FakeProfile {
  credits: number;
  bonus_credits: number;
  bonus_credits_expires_at: string | null;
}
interface LedgerRow {
  userId: string;
  action: string;
  creditsUsed: number;
  teamId: string | null;
  bonusCreditsUsed: number | null;
  bonusExpiresAt: string | null;
}

const h = vi.hoisted(() => ({
  profile: null as unknown as FakeProfile,
  ledger: [] as LedgerRow[],
  teams: new Map<string, number>(),
  activeTeamId: null as string | null,
  failRestores: false,
}));

vi.mock("../logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

vi.mock("../supabase-admin", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    getSupabaseAdmin: () => ({
      from: () => {
        const table: Record<string, unknown> = {
          select: () => table,
          eq: () => table,
          single: async () => ({ data: { ...h.profile }, error: null }),
          update: (vals: Partial<FakeProfile>) => {
            if (h.failRestores) throw new Error("profile write failed (test)");
            Object.assign(h.profile, vals);
            return { eq: async () => ({ error: null }) };
          },
        };
        return table;
      },
    }),
    addCreditsToProfile: async (_userId: string, amt: number) => {
      if (h.failRestores) throw new Error("profile write failed (test)");
      const oldCredits = h.profile.credits;
      h.profile.credits += amt;
      return { oldCredits, newCredits: h.profile.credits, created: false };
    },
  };
});

vi.mock("../payment-record", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    recordCreditUsageStrict: async (rec: {
      userId: string;
      action: string;
      creditsUsed: number;
      teamId?: string | null;
      bonusCreditsUsed?: number | null;
      bonusExpiresAt?: string | null;
    }) => {
      h.ledger.push({
        userId: rec.userId,
        action: rec.action,
        creditsUsed: rec.creditsUsed,
        teamId: rec.teamId ?? null,
        bonusCreditsUsed: rec.bonusCreditsUsed ?? null,
        bonusExpiresAt: rec.bonusExpiresAt ?? null,
      });
    },
  };
});

vi.mock("../teams", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    getUserActiveTeam: async () => {
      if (!h.activeTeamId) return null;
      const credits = h.teams.get(h.activeTeamId);
      if (credits === undefined) return null;
      return {
        team: { id: h.activeTeamId, credits, allowPersonalFallback: true },
        membership: { id: "membership-1", teamId: h.activeTeamId, userId: "user-1", status: "active" },
      };
    },
    deductTeamCredits: async (teamId: string, cost: number) => {
      const credits = h.teams.get(teamId);
      if (credits === undefined || credits < cost) {
        const err = new Error("out_of_credits") as Error & { status?: number };
        err.name = "OutOfCreditsError";
        err.status = 402;
        throw err;
      }
      const after = credits - cost;
      h.teams.set(teamId, after);
      return after;
    },
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const chain: Record<string, unknown> = {
    where: () => chain,
    orderBy: () => chain,
    limit: async () => [],
    then: (res: (v: unknown) => void, rej: (e: unknown) => void) =>
      Promise.resolve([]).then(res, rej),
  };
  return {
    ...mod,
    db: {
      execute: async (q: unknown) => {
        const { sql: text, params } = dialect.sqlToQuery(q as never);
        if (text.includes("SELECT team_id FROM credit_usage")) {
          const [userId, action, amount] = params as [string, string, number];
          const rows = h.ledger
            .filter((r) => r.userId === userId && r.action === action && r.creditsUsed === amount)
            .slice()
            .reverse()
            .map((r) => ({ team_id: r.teamId }));
          return { rows };
        }
        if (text.includes("bonus_credits_used IS NOT NULL")) {
          const [userId, action, amount] = params as [string, string, number];
          const rows = h.ledger
            .filter(
              (r) =>
                r.userId === userId &&
                r.action === action &&
                r.creditsUsed === amount &&
                r.bonusCreditsUsed !== null,
            )
            .slice()
            .reverse()
            .map((r) => ({ bonus_credits_used: r.bonusCreditsUsed, bonus_expires_at: r.bonusExpiresAt }));
          return { rows };
        }
        if (text.includes("starts_with")) {
          const [userId, negAmount, prefix] = params as [string, number, string];
          const n = h.ledger.filter(
            (r) => r.userId === userId && r.creditsUsed === negAmount && r.action.startsWith(prefix),
          ).length;
          return { rows: [{ n }] };
        }
        if (text.includes("UPDATE teams")) {
          const [amount, teamId] = params as [number, string];
          const credits = h.teams.get(teamId);
          if (credits === undefined) return { rows: [] };
          h.teams.set(teamId, credits + amount);
          return { rows: [{ id: teamId }] };
        }
        return { rows: [] };
      },
      select: () => ({ from: () => chain }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      insert: () => ({ values: async () => [] }),
    },
  };
});

const { mockSubmit, mockStatus } = vi.hoisted(() => ({
  mockSubmit: vi.fn(),
  mockStatus: vi.fn(),
}));

vi.mock("../wavespeed", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../wavespeed")>();
  return {
    ...mod,
    waveSpeedSubmit: (...args: unknown[]) => mockSubmit(...args),
    waveSpeedStatus: (...args: unknown[]) => mockStatus(...args),
  };
});

import { WaveSpeedError } from "../wavespeed";
import { chargeCredits } from "../credits";
import { __setLipSyncEventNotifier, __testHooks } from "../job-poller";
import {
  __setLipSyncJobsDb,
  claimLipSyncChargeRefund,
  claimQueuedJobs,
  createLipSyncJob,
  failLipSyncJob,
  getLipSyncJob,
  LIP_SYNC_JOB_CHARGE_CREDITS,
  releaseLipSyncChargeRefundClaim,
  type LipSyncJob,
} from "../lip-sync-jobs";
import { __setJobNotificationsDb, listPendingNotifications } from "../job-notifications";
import type { UserEventInput } from "../push-events";
import { createTestDb } from "./test-db";

const PARAMS = { clipUrl: "https://x/clip.mp4", audioUrl: "https://x/audio.mp3", sceneStartSec: 0, sceneEndSec: 5 };
const LIP_SYNC_COST = 300;
const future = () => new Date(Date.now() + 3_600_000).toISOString();
const REFUND_SENTENCE = `Your ${LIP_SYNC_JOB_CHARGE_CREDITS} Visual Bucs were refunded.`;

const events: UserEventInput[] = [];
let chargeSeq = 0;
let testDb: ReturnType<typeof createTestDb>["db"];

beforeEach(() => {
  const built = createTestDb();
  testDb = built.db;
  __setLipSyncJobsDb(testDb);
  __setJobNotificationsDb(testDb);
  events.length = 0;
  __setLipSyncEventNotifier(async (input) => {
    events.push(input);
  });
  mockSubmit.mockReset();
  mockStatus.mockReset();
  h.profile = { credits: 1_000, bonus_credits: 300, bonus_credits_expires_at: future() };
  h.ledger = [];
  h.teams = new Map();
  h.activeTeamId = null;
  h.failRestores = false;
  process.env["LIP_SYNC_PROVIDER"] = "latentsync";
  __testHooks.__setPrepareSubmitMedia(async () => ({
    segmentUrl: "https://x/seg.mp3",
    providerClipUrl: "https://x/clip.mp4",
    durationSec: 5,
  }));
});

afterEach(() => {
  __setLipSyncJobsDb(null);
  __setJobNotificationsDb(null);
  __setLipSyncEventNotifier(null);
  delete process.env["LIP_SYNC_PROVIDER"];
});

/** Charge exactly as POST /lip-sync/preview does, then queue + claim the job. */
async function chargedJob(userId: string): Promise<LipSyncJob> {
  chargeSeq += 1;
  await chargeCredits(
    userId,
    LIP_SYNC_COST,
    { action: "Lip Sync" },
    { idempotencyKey: `lip-sync-harden-test-${chargeSeq}` },
  );
  await createLipSyncJob({ userId, params: PARAMS });
  const [job] = await claimQueuedJobs(1);
  return job;
}

function refundRows(): LedgerRow[] {
  return h.ledger.filter((r) => r.creditsUsed === -LIP_SYNC_COST);
}

function totalBalance(): number {
  return h.profile.credits + h.profile.bonus_credits;
}

describe("the claim/re-arm discipline", () => {
  it("release flips a claimed gate back, exactly once, and only on a failed job", async () => {
    const userId = randomUUID();
    await createLipSyncJob({ userId, params: PARAMS });
    const [job] = await claimQueuedJobs(1);
    /* Not failed, not claimed — nothing to release. */
    expect(await releaseLipSyncChargeRefundClaim(job.id)).toBe(false);
    await failLipSyncJob(job.id, { message: "boom", code: "test" });
    /* Failed but unclaimed — still nothing to release. */
    expect(await releaseLipSyncChargeRefundClaim(job.id)).toBe(false);
    expect(await claimLipSyncChargeRefund(job.id)).toBe(true);
    expect(await releaseLipSyncChargeRefundClaim(job.id)).toBe(true);
    expect(await releaseLipSyncChargeRefundClaim(job.id)).toBe(false);
    const after = (await getLipSyncJob(job.id))!;
    expect(after.chargeRefunded).toBe(false);
    /* And the job is claimable again — the retry door the sweep uses. */
    expect(await claimLipSyncChargeRefund(job.id)).toBe(true);
  });

  it("claim-then-throw: gate released, balance untouched, tell truthful — sweep then lands it exactly once", async () => {
    const userId = randomUUID();
    const job = await chargedJob(userId);
    /* Temp-first: the 300 came out of the bonus pool. */
    expect(h.profile.bonus_credits).toBe(0);
    expect(totalBalance()).toBe(1_000);

    /* The refund's restore cannot land — every profile write throws. */
    h.failRestores = true;
    mockSubmit.mockRejectedValue(new WaveSpeedError("WaveSpeed submit failed: HTTP 422 — bad payload", 422));
    await __testHooks.runSubmitWorker(job, "test-key");

    const failed = (await getLipSyncJob(job.id))!;
    expect(failed.state).toBe("failed");
    /* THE PIN: the durable gate does NOT claim the unlanded refund. */
    expect(failed.chargeRefunded).toBe(false);
    expect(totalBalance()).toBe(1_000);
    expect(refundRows()).toHaveLength(0);
    /* The tell recorded at failure time claims nothing either. */
    const notes = await listPendingNotifications();
    expect(notes).toHaveLength(1);
    expect(notes[0].message).not.toContain("refunded");

    /* The rail recovers; the sweep retries through the same claim. */
    h.failRestores = false;
    await __testHooks.retryFailedLipSyncRefunds();

    const healed = (await getLipSyncJob(job.id))!;
    expect(healed.chargeRefunded).toBe(true);
    /* Balance exact to the pre-charge state, composition included. */
    expect(h.profile.credits).toBe(1_000);
    expect(h.profile.bonus_credits).toBe(300);
    expect(refundRows()).toHaveLength(1);
    expect(refundRows()[0].action).toMatch(/^Lip Sync — Refund/);

    /* Exactly-once across further sweeps. */
    await __testHooks.retryFailedLipSyncRefunds();
    expect(refundRows()).toHaveLength(1);
    expect(totalBalance()).toBe(1_300);
  });
});

describe("the refund sweep", () => {
  it("a failure nobody attempted (death between the failure write and the refund) is refunded by the sweep", async () => {
    const userId = randomUUID();
    const job = await chargedJob(userId);
    /* The job fails durably; the process dies before any refund path
       runs — no claim, no refund, charge standing. */
    await failLipSyncJob(job.id, { message: "provider died", code: "provider_failed" });
    expect(refundRows()).toHaveLength(0);

    await __testHooks.retryFailedLipSyncRefunds();

    const after = (await getLipSyncJob(job.id))!;
    expect(after.chargeRefunded).toBe(true);
    expect(h.profile.credits).toBe(1_000);
    expect(h.profile.bonus_credits).toBe(300);
    expect(refundRows()).toHaveLength(1);
  });

  it("race: a held claim blocks the sweep, and concurrent sweeps over a released claim refund exactly once", async () => {
    const userId = randomUUID();
    const job = await chargedJob(userId);
    await failLipSyncJob(job.id, { message: "boom", code: "test" });

    /* A poller worker holds the claim (its refund is in flight): the
       sweep must not refund underneath it. */
    expect(await claimLipSyncChargeRefund(job.id)).toBe(true);
    await __testHooks.retryFailedLipSyncRefunds();
    expect(refundRows()).toHaveLength(0);
    expect(totalBalance()).toBe(1_000);

    /* The worker's refund failed and released; two sweeps (two
       pollers / poller + recovery) race the retry — one refund. */
    expect(await releaseLipSyncChargeRefundClaim(job.id)).toBe(true);
    await Promise.all([
      __testHooks.retryFailedLipSyncRefunds(),
      __testHooks.retryFailedLipSyncRefunds(),
    ]);
    expect(refundRows()).toHaveLength(1);
    expect(h.profile.credits).toBe(1_000);
    expect(h.profile.bonus_credits).toBe(300);
    const after = (await getLipSyncJob(job.id))!;
    expect(after.chargeRefunded).toBe(true);
  });

  it("the sweep is a retry, not a backfill: a stale failed job is left untouched", async () => {
    const userId = randomUUID();
    const job = await chargedJob(userId);
    await failLipSyncJob(job.id, { message: "old failure", code: "test" });
    /* Age the row beyond the retry window — the shape of the
       pre-refund-fix history, whose backfill is a separate call. */
    const stale = new Date(Date.now() - 3 * 3_600_000).toISOString();
    await testDb.execute(
      sql`UPDATE lip_sync_jobs SET updated_at = ${stale}::timestamptz WHERE id = ${job.id}`,
    );

    await __testHooks.retryFailedLipSyncRefunds();

    const after = (await getLipSyncJob(job.id))!;
    expect(after.chargeRefunded).toBe(false);
    expect(refundRows()).toHaveLength(0);
    expect(totalBalance()).toBe(1_000);
  });
});

describe("boot recovery tells", () => {
  it("a recovery-failed job refunds AND records the failure tell with the verdict, exactly once", async () => {
    const userId = randomUUID();
    const job = await chargedJob(userId);
    /* Recovery's own write: the interrupted-submit give-up. */
    const message = "This lip-sync job was interrupted by a server restart and could not be recovered.";
    await failLipSyncJob(job.id, { message, code: "interrupted" });

    await __testHooks.refundRecoveredFailures([job]);

    expect(refundRows()).toHaveLength(1);
    expect(h.profile.credits).toBe(1_000);
    expect(h.profile.bonus_credits).toBe(300);
    const notes = await listPendingNotifications();
    expect(notes).toHaveLength(1);
    expect(notes[0].status).toBe("failed");
    expect(notes[0].title).toBe("Lip sync failed");
    expect(notes[0].message).toContain("interrupted by a server restart");
    expect(notes[0].message).toContain(REFUND_SENTENCE);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "lip_sync_failed", category: "money" });
    expect(events[0].body).toContain(REFUND_SENTENCE);

    /* A replayed recovery pass tells nothing twice, refunds nothing twice. */
    await __testHooks.refundRecoveredFailures([job]);
    expect(await listPendingNotifications()).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(refundRows()).toHaveLength(1);
  });
});
