/**
 * lip-sync-refund-tell.test.ts — stack1200 completion of the Gate #5
 * failure-refund fix: the member-facing TELL must carry the verdict.
 *
 * The refunds branch made a terminally failed lip-sync job refund its
 * up-front 300 VB exactly once — but the failure notification still
 * read as a bare failure, so the member reasonably believed the money
 * was gone. What's pinned here, against the REAL charge/refund rails
 * and the REAL job store + poller workers (pg-mem), same harness as
 * lip-sync-failure-refund.test.ts:
 *
 *  1. Submit failure with the refund landed: the recorded notification
 *     AND the door event both say the money was refunded, naming the
 *     amount from the job's charge record (LIP_SYNC_JOB_CHARGE_CREDITS).
 *  2. Poll failure (provider FAILED): same verdict in the tell.
 *  3. Exactly-once still holds for the tell: replaying the failure
 *     path produces one notification, one event, one refund.
 *  4. NEGATIVE — the refund gate was already claimed but no refund was
 *     performed by this path (the claim-then-crash hole): the failure
 *     is recorded WITHOUT any refund claim in the copy.
 *  5. NEGATIVE — the refund write itself fails after the claim: the
 *     copy still claims nothing (the CRITICAL log is the operator's
 *     signal; the member is never told money came back when it didn't).
 *  6. Wiring pin: every failure tell the poller records is composed
 *     through lipSyncFailureNotice — no bare failure message remains.
 */
import { randomUUID } from "crypto";
import { readFileSync } from "node:fs";
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
import {
  __setLipSyncEventNotifier,
  __testHooks,
  lipSyncFailureNotice,
} from "../job-poller";
import {
  __setLipSyncJobsDb,
  claimLipSyncChargeRefund,
  claimQueuedJobs,
  createLipSyncJob,
  failLipSyncJob,
  getLipSyncJob,
  LIP_SYNC_JOB_CHARGE_CREDITS,
  markJobSubmitted,
  type LipSyncJob,
} from "../lip-sync-jobs";
import { __setJobNotificationsDb, listPendingNotifications } from "../job-notifications";
import type { UserEventInput } from "../push-events";
import { createTestDb } from "./test-db";

const PARAMS = { clipUrl: "https://x/clip.mp4", audioUrl: "https://x/audio.mp3", sceneStartSec: 0, sceneEndSec: 5 };
const LIP_SYNC_COST = 300;
const future = () => new Date(Date.now() + 3_600_000).toISOString();

const events: UserEventInput[] = [];
let chargeSeq = 0;

beforeEach(() => {
  const { db } = createTestDb();
  __setLipSyncJobsDb(db);
  __setJobNotificationsDb(db);
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
    { idempotencyKey: `lip-sync-tell-test-${chargeSeq}` },
  );
  await createLipSyncJob({ userId, params: PARAMS });
  const [job] = await claimQueuedJobs(1);
  return job;
}

function refundRows(): LedgerRow[] {
  return h.ledger.filter((r) => r.creditsUsed === -LIP_SYNC_COST);
}

const REFUND_SENTENCE = `Your ${LIP_SYNC_JOB_CHARGE_CREDITS} Visual Bucs were refunded.`;

describe("lipSyncFailureNotice — the verdict sentence itself", () => {
  it("names the amount from the job's charge record when the refund fired", () => {
    expect(LIP_SYNC_JOB_CHARGE_CREDITS).toBe(LIP_SYNC_COST);
    expect(lipSyncFailureNotice("Provider said no.", true)).toBe(
      `Provider said no. ${REFUND_SENTENCE}`,
    );
  });

  it("adds nothing when no refund fired", () => {
    expect(lipSyncFailureNotice("Provider said no.", false)).toBe("Provider said no.");
  });
});

describe("the failure tell carries the refund verdict", () => {
  it("submit rejected permanently: notification + door event both state the refund and its amount", async () => {
    const userId = randomUUID();
    const job = await chargedJob(userId);
    mockSubmit.mockRejectedValue(new WaveSpeedError("WaveSpeed submit failed: HTTP 422 — bad payload", 422));

    await __testHooks.runSubmitWorker(job, "test-key");

    expect(refundRows()).toHaveLength(1);
    const notes = await listPendingNotifications();
    expect(notes).toHaveLength(1);
    expect(notes[0].status).toBe("failed");
    expect(notes[0].title).toBe("Lip sync failed");
    expect(notes[0].message).toContain("HTTP 422");
    expect(notes[0].message).toContain(REFUND_SENTENCE);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "lip_sync_failed", category: "money" });
    expect(events[0].body).toContain(REFUND_SENTENCE);
  });

  it("provider reports FAILED at poll time: the tell states the refund", async () => {
    const userId = randomUUID();
    const job = await chargedJob(userId);
    await markJobSubmitted(job.id, "provider-job-1", 0);
    const polling = (await getLipSyncJob(job.id))!;

    mockStatus.mockResolvedValue({ status: "FAILED", error: "provider died" });
    await __testHooks.pollOneJob(polling, "test-key");

    expect(refundRows()).toHaveLength(1);
    const notes = await listPendingNotifications();
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toContain("provider died");
    expect(notes[0].message).toContain(REFUND_SENTENCE);
    expect(events).toHaveLength(1);
    expect(events[0].body).toContain(REFUND_SENTENCE);
  });

  it("exactly-once: replaying the failure path adds no second tell and no second refund", async () => {
    const userId = randomUUID();
    const job = await chargedJob(userId);
    mockSubmit.mockRejectedValue(new WaveSpeedError("WaveSpeed submit failed: HTTP 422 — bad payload", 422));

    await __testHooks.runSubmitWorker(job, "test-key");
    await __testHooks.runSubmitWorker(job, "test-key");

    expect(refundRows()).toHaveLength(1);
    expect(await listPendingNotifications()).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it("NEGATIVE — gate already claimed, no refund performed by this path: the copy claims no refund", async () => {
    const userId = randomUUID();
    const job = await chargedJob(userId);
    /* Simulate the claim-then-crash hole: an earlier path flipped the
       gate but its refund never landed. This path must not inherit a
       refund claim it didn't perform. */
    await failLipSyncJob(job.id, { message: "earlier failure", code: "test" });
    expect(await claimLipSyncChargeRefund(job.id)).toBe(true);
    expect(refundRows()).toHaveLength(0);

    mockSubmit.mockRejectedValue(new WaveSpeedError("WaveSpeed submit failed: HTTP 422 — bad payload", 422));
    await __testHooks.runSubmitWorker(job, "test-key");

    const notes = await listPendingNotifications();
    expect(notes).toHaveLength(1);
    expect(notes[0].message).not.toContain("refunded");
    expect(events).toHaveLength(1);
    expect(events[0].body).not.toContain("refunded");
    /* And still no refund was performed by anyone. */
    expect(refundRows()).toHaveLength(0);
  });

  it("NEGATIVE — the refund write fails after the claim: the copy claims no refund", async () => {
    const userId = randomUUID();
    const job = await chargedJob(userId);
    /* Every profile write from here on throws — the refund's restore
       cannot land, so refundCredits rejects and the tell must stay
       silent about a refund that didn't happen. */
    h.failRestores = true;
    mockSubmit.mockRejectedValue(new WaveSpeedError("WaveSpeed submit failed: HTTP 422 — bad payload", 422));

    await __testHooks.runSubmitWorker(job, "test-key");

    const notes = await listPendingNotifications();
    expect(notes).toHaveLength(1);
    expect(notes[0].message).not.toContain("refunded");
    expect(events).toHaveLength(1);
    expect(events[0].body).not.toContain("refunded");
    expect(refundRows()).toHaveLength(0);
    expect(h.profile.credits + h.profile.bonus_credits).toBe(1_000);
  });
});

describe("client job shape + wiring pins", () => {
  const routeSrc = readFileSync(new URL("../../routes/lip-sync.ts", import.meta.url), "utf8");
  const pollerSrc = readFileSync(new URL("../job-poller.ts", import.meta.url), "utf8");

  it("the client job shape carries the gate, and the amount only when the refund fired", () => {
    expect(routeSrc).toContain("chargeRefunded: job.chargeRefunded");
    // stack1400: the amount is the job's OWN recorded charge
    // (lipSyncChargeForJob — 300, or 600 for a 50–60s clip), not the
    // flat base constant, so a tiered job's tell matches its refund.
    expect(routeSrc).toContain(
      "...(job.chargeRefunded ? { refundedCredits: lipSyncChargeForJob(job) } : {})",
    );
  });

  it("the run-all scene tell names the same verdict off the sub-job's gate", () => {
    expect(routeSrc).toContain("verdict.chargeRefunded");
    expect(routeSrc).toContain("Your ${lipSyncChargeForJob(verdict)} Visual Bucs were refunded.");
  });

  it("every failure tell the poller records is composed through lipSyncFailureNotice", () => {
    const tells = pollerSrc.match(/recordLipSyncOutcome\(job, "failed", "Lip sync failed", [^;]*?\)\)/gs) ?? [];
    /* Three live failure paths + the boot-recovery pass
       (refundRecoveredFailures) — every one composes through the
       helper, so no bare failure message can creep back in.
       (Stack1400: the removed premium route's two extra failure
       tells were deleted with that route.) */
    expect(tells.length).toBe(4);
    for (const tell of tells) {
      expect(tell).toContain("lipSyncFailureNotice(");
    }
  });
});
