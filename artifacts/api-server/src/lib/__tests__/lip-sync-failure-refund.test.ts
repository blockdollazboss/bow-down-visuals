/**
 * lip-sync-failure-refund.test.ts — Gate #5 pre-proof (stack1200):
 * AI GENERATION FAILURE REFUNDS on the lip-sync rail.
 *
 * The defect this suite convicts: POST /lip-sync/preview (and every
 * run-all scene) charges 300 VB UP FRONT via chargeCredits, but when
 * the provider generation then failed in the background poller —
 * submit rejected, provider reported FAILED, poll budget exhausted,
 * deferral cap, boot-recovery give-up — the job was marked failed and
 * the member notified, and the 300 VB charge simply STOOD. No refund
 * path existed anywhere in the poller (only the enqueue-failure leg in
 * the route refunded). Every other async job rail refunds
 * job.creditsCharged on failure; lip-sync silently kept the money.
 *
 * What's pinned here, against the REAL charge/refund rails (credits.ts
 * unmocked, team-refund-seam-style fake profile/ledger) and the REAL
 * lip-sync job store + poller workers (pg-mem):
 *  1. Submit failure (permanent provider rejection): balance returns
 *     to the EXACT pre-charge total, temp/perm composition restored
 *     (temporary portion back in the live bonus pool).
 *  2. Poll failure (provider reports FAILED after accepting): same.
 *  3. Exactly-once: the failure path replayed refunds once — the
 *     second run is a no-op, balance and ledger refund rows unchanged.
 *  4. Z1 expiry rule: the bonus pool expired between charge and the
 *     failure refund — the temporary portion lands in PERMANENT, the
 *     total is preserved, nothing evaporates.
 *  5. Team pool: a lip-sync charge that drew from the team pool
 *     refunds back to the TEAM pool on failure; the member's personal
 *     balance is never touched.
 */
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

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
            Object.assign(h.profile, vals);
            return { eq: async () => ({ error: null }) };
          },
        };
        return table;
      },
    }),
    addCreditsToProfile: async (_userId: string, amt: number) => {
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
    /* Captures the record AND lands it in the fake ledger the pairing
       lookups read — the same relationship the real strict writer has
       to the real credit_usage table. */
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

vi.mock("../sync-labs", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../sync-labs")>();
  return {
    ...mod,
    syncLabsSubmit: (...args: unknown[]) => mockSubmit(...args),
    syncLabsStatus: (...args: unknown[]) => mockStatus(...args),
  };
});

import { SyncLabsError } from "../sync-labs";
import { chargeCredits } from "../credits";
import { __setLipSyncEventNotifier, __testHooks } from "../job-poller";
import {
  __setLipSyncJobsDb,
  claimQueuedJobs,
  createLipSyncJob,
  getLipSyncJob,
  markJobSubmitted,
  type LipSyncJob,
} from "../lip-sync-jobs";
import { __setJobNotificationsDb } from "../job-notifications";
import { createTestDb } from "./test-db";

const PARAMS = { clipUrl: "https://x/clip.mp4", audioUrl: "https://x/audio.mp3", sceneStartSec: 0, sceneEndSec: 5 };
const LIP_SYNC_COST = 300;
const future = () => new Date(Date.now() + 3_600_000).toISOString();
const past = () => new Date(Date.now() - 3_600_000).toISOString();

let chargeSeq = 0;

beforeEach(() => {
  const { db } = createTestDb();
  __setLipSyncJobsDb(db);
  __setJobNotificationsDb(db);
  __setLipSyncEventNotifier(async () => {});
  mockSubmit.mockReset();
  mockStatus.mockReset();
  h.profile = { credits: 1_000, bonus_credits: 300, bonus_credits_expires_at: future() };
  h.ledger = [];
  h.teams = new Map();
  h.activeTeamId = null;
  /* The Sync.so submit path, same as job-poller-submit.test.ts: the
     operator switch selects the premium route this suite simulates. */
  process.env["LIP_SYNC_PROVIDER"] = "sync";
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
    { idempotencyKey: `lip-sync-test-${chargeSeq}` },
  );
  await createLipSyncJob({ userId, params: PARAMS });
  const [job] = await claimQueuedJobs(1);
  return job;
}

function refundRows(): LedgerRow[] {
  return h.ledger.filter((r) => r.creditsUsed === -LIP_SYNC_COST);
}

describe("lip-sync generation failure refunds the up-front charge", () => {
  it("submit rejected permanently: exact total back, temporary portion back in the live pool", async () => {
    const userId = randomUUID();
    const job = await chargedJob(userId);
    /* Temp-first: the 300 came out of the bonus pool. */
    expect(h.profile.bonus_credits).toBe(0);
    expect(h.profile.credits).toBe(1_000);

    mockSubmit.mockRejectedValue(new SyncLabsError("Sync Labs submit failed: HTTP 422 — bad payload", 422));
    await __testHooks.runSubmitWorker(job, "test-key");

    const failed = (await getLipSyncJob(job.id))!;
    expect(failed.state).toBe("failed");
    /* Exact pre-charge state: 1,000 permanent + 300 temporary. */
    expect(h.profile.credits).toBe(1_000);
    expect(h.profile.bonus_credits).toBe(300);
    expect(refundRows()).toHaveLength(1);
    expect(refundRows()[0].action).toMatch(/^Lip Sync — Refund/);
  });

  it("exactly-once: replaying the failure path refunds nothing more", async () => {
    const userId = randomUUID();
    const job = await chargedJob(userId);
    mockSubmit.mockRejectedValue(new SyncLabsError("Sync Labs submit failed: HTTP 422 — bad payload", 422));

    await __testHooks.runSubmitWorker(job, "test-key");
    expect(h.profile.credits + h.profile.bonus_credits).toBe(1_300);

    /* Replay: a recovered/duplicated worker runs the same failure path
       for the same job again. */
    await __testHooks.runSubmitWorker(job, "test-key");

    expect(h.profile.credits).toBe(1_000);
    expect(h.profile.bonus_credits).toBe(300);
    expect(refundRows()).toHaveLength(1);
  });

  it("provider reports FAILED at poll time: the charge is refunded in full", async () => {
    const userId = randomUUID();
    const job = await chargedJob(userId);
    await markJobSubmitted(job.id, "provider-job-1", 0);
    const polling = (await getLipSyncJob(job.id))!;
    expect(polling.state).toBe("polling");

    mockStatus.mockResolvedValue({ status: "FAILED", error: "provider died" });
    await __testHooks.pollOneJob(polling, "test-key");

    const failed = (await getLipSyncJob(job.id))!;
    expect(failed.state).toBe("failed");
    expect(h.profile.credits).toBe(1_000);
    expect(h.profile.bonus_credits).toBe(300);
    expect(refundRows()).toHaveLength(1);
  });

  it("the pool expired before the failure landed: the temporary portion lands in permanent (Z1)", async () => {
    const userId = randomUUID();
    const job = await chargedJob(userId);
    /* Time passes: the pool the charge drew from reaches its expiry
       (the ledger keeps the expiry recorded at charge time). */
    h.ledger[0]!.bonusExpiresAt = past();

    mockSubmit.mockRejectedValue(new SyncLabsError("Sync Labs submit failed: HTTP 422 — bad payload", 422));
    await __testHooks.runSubmitWorker(job, "test-key");

    /* Total preserved — 1,300 all permanent, nothing in a dead pool. */
    expect(h.profile.credits).toBe(1_300);
    expect(h.profile.bonus_credits).toBe(0);
    expect(refundRows()).toHaveLength(1);
  });

  it("team-pool charge: failure restores the TEAM pool, personal balance untouched", async () => {
    const userId = randomUUID();
    h.teams = new Map([["team-1", 500]]);
    h.activeTeamId = "team-1";
    h.profile = { credits: 1_000, bonus_credits: 0, bonus_credits_expires_at: null };

    const job = await chargedJob(userId);
    expect(h.teams.get("team-1")).toBe(200);
    expect(h.profile.credits).toBe(1_000);

    mockSubmit.mockRejectedValue(new SyncLabsError("Sync Labs submit failed: HTTP 422 — bad payload", 422));
    await __testHooks.runSubmitWorker(job, "test-key");

    expect(h.teams.get("team-1")).toBe(500);
    expect(h.profile.credits).toBe(1_000);
    expect(refundRows()).toHaveLength(1);
    expect(refundRows()[0].teamId).toBe("team-1");
  });
});
