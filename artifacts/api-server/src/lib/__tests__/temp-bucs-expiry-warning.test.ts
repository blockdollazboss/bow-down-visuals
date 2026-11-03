/**
 * Tests for the Temporary Bucs expiry warning sweep — stack1400
 * ruling #12 (Y6).
 *
 * The ruling: a member whose temporary (bonus) pool is inside its
 * final 3 days gets ONE warning email before the Bucs expire,
 * carrying the amount and the exact expiry date — exactly once per
 * pool expiry, suppression honored absolutely. Short pools (the
 * standard pool lives 48h) are therefore warned on the first sweep
 * after the grant; that is the honest reading of "3 days before"
 * for a pool that never exists 3 days before its expiry.
 *
 * The sweep's dependencies are injected (the module's deps seam):
 * an in-memory ledger store implementing the same claim contract
 * as the drizzle store (insert-first claim on (user, pool expiry),
 * status-guarded retry claim), fake pool source, fake address book,
 * and a recording sender. No DB, no Resend.
 */
import { describe, it, expect, vi } from "vitest";
import {
  sweepTempBucsExpiryWarnings,
  tempBucsWarningTarget,
  buildTempBucsExpiryEmail,
  type TempBucsExpiryWarningStore,
  type TempBucsPoolCandidate,
} from "../temp-bucs-expiry-warning";
import type { TempBucsExpiryWarning } from "@workspace/db";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

type Row = TempBucsExpiryWarning & { key: string };

function makeStore(suppressedEmails: string[] = []) {
  const rows = new Map<string, Row>();
  const suppressed = new Set(suppressedEmails.map((e) => e.toLowerCase()));
  let seq = 0;
  const store: TempBucsExpiryWarningStore = {
    async claimWarning(input) {
      const key = `${input.userId}|${input.poolExpiresAt.toISOString()}`;
      if (rows.has(key)) return null;
      const row: Row = {
        key,
        id: `w-${++seq}`,
        userId: input.userId,
        poolExpiresAt: input.poolExpiresAt,
        email: input.email,
        amountVb: input.amountVb,
        status: "pending",
        attempts: 0,
        providerId: null,
        lastError: null,
        sentAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      } as Row;
      rows.set(key, row);
      return row;
    },
    async getWarning(userId, poolExpiresAt) {
      return rows.get(`${userId}|${poolExpiresAt.toISOString()}`) ?? null;
    },
    async claimRetry(warningId, maxAttempts, stalePendingBefore, now) {
      for (const row of rows.values()) {
        if (row.id !== warningId) continue;
        const failedRetryable = row.status === "failed" && row.attempts < maxAttempts;
        const stalePending =
          row.status === "pending" && row.updatedAt < stalePendingBefore;
        if (!failedRetryable && !stalePending) return null;
        row.status = "pending";
        row.updatedAt = now;
        return row;
      }
      return null;
    },
    async markSent(warningId, providerId, now) {
      for (const row of rows.values()) {
        if (row.id !== warningId) continue;
        row.status = "sent";
        row.attempts += 1;
        row.providerId = providerId;
        row.sentAt = now;
        row.updatedAt = now;
      }
    },
    async markFailed(warningId, error, dead, now) {
      for (const row of rows.values()) {
        if (row.id !== warningId) continue;
        row.status = dead ? "dead" : "failed";
        row.attempts += 1;
        row.lastError = error;
        row.updatedAt = now;
      }
    },
    async markSuppressed(warningId, now) {
      for (const row of rows.values()) {
        if (row.id !== warningId) continue;
        row.status = "suppressed";
        row.updatedAt = now;
      }
    },
    async isSuppressed(email) {
      return suppressed.has(email.toLowerCase());
    },
  };
  return { store, rows };
}

function makeDeps(
  pools: TempBucsPoolCandidate[],
  opts: {
    emails?: Record<string, string | null>;
    suppressed?: string[];
    sendImpl?: (call: number) => { sent: boolean; id?: string; reason?: string };
  } = {},
) {
  const { store, rows } = makeStore(opts.suppressed ?? []);
  const sent: Array<{ to: string; subject: string; html: string; text?: string }> = [];
  let sendCalls = 0;
  const deps = {
    store,
    listPools: async () => pools,
    getEmail: async (userId: string) =>
      opts.emails && userId in opts.emails
        ? opts.emails[userId]
        : `${userId}@example.com`,
    send: async (msg: { to: string; subject: string; html: string; text?: string }) => {
      sendCalls += 1;
      const impl = opts.sendImpl?.(sendCalls);
      if (impl) {
        if (impl.sent) sent.push(msg);
        return impl as { sent: boolean; id?: string | null; reason?: string };
      }
      sent.push(msg);
      return { sent: true, id: `msg-${sendCalls}` };
    },
    now: NOW,
  };
  return { deps, sent, rows, sendCallCount: () => sendCalls };
}

const pool = (over: Partial<TempBucsPoolCandidate>): TempBucsPoolCandidate => ({
  userId: "user-1",
  credits: 50,
  bonusCredits: 300,
  bonusCreditsExpiresAt: new Date(NOW.getTime() + 2 * DAY).toISOString(),
  ...over,
});

describe("tempBucsWarningTarget — the display composition decides", () => {
  it("names the pool amount and its expiry for a live dated pool", () => {
    const target = tempBucsWarningTarget(pool({}), NOW.getTime());
    expect(target?.amount).toBe(300);
    expect(target?.expiresAt).toBe(
      new Date(NOW.getTime() + 2 * DAY).toISOString(),
    );
  });

  it("an expired pool has no target (the composition drops it)", () => {
    const target = tempBucsWarningTarget(
      pool({
        bonusCreditsExpiresAt: new Date(NOW.getTime() - DAY).toISOString(),
      }),
      NOW.getTime(),
    );
    expect(target).toBeNull();
  });

  it("an undated or empty pool has no target", () => {
    expect(
      tempBucsWarningTarget(pool({ bonusCreditsExpiresAt: null }), NOW.getTime()),
    ).toBeNull();
    expect(
      tempBucsWarningTarget(pool({ bonusCredits: 0 }), NOW.getTime()),
    ).toBeNull();
  });
});

describe("the warning email", () => {
  it("carries the amount and the exact expiry date", () => {
    const mail = buildTempBucsExpiryEmail({
      email: "member@example.com",
      amount: 1250,
      expiresAt: new Date(NOW.getTime() + 2 * DAY).toISOString(),
    });
    expect(mail.to).toBe("member@example.com");
    expect(mail.subject).toContain("1,250");
    expect(mail.html).toContain("1,250");
    expect(mail.html).toContain("November 12, 2026");
    expect(mail.text).toContain("November 12, 2026");
  });
});

describe("sweepTempBucsExpiryWarnings", () => {
  it("a pool inside its final 3 days is warned — once", async () => {
    const { deps, sent, rows } = makeDeps([pool({})]);
    const result = await sweepTempBucsExpiryWarnings(deps);
    expect(result.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("user-1@example.com");
    expect(sent[0]!.html).toContain("300");
    expect([...rows.values()][0]!.status).toBe("sent");
  });

  it("a second sweep for the same pool sends nothing (exactly-once)", async () => {
    const { deps, sent, sendCallCount } = makeDeps([pool({})]);
    await sweepTempBucsExpiryWarnings(deps);
    const second = await sweepTempBucsExpiryWarnings(deps);
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sendCallCount()).toBe(1);
  });

  it("an expired pool sends nothing and claims nothing", async () => {
    const { deps, sent, rows } = makeDeps([
      pool({
        bonusCreditsExpiresAt: new Date(NOW.getTime() - 60_000).toISOString(),
      }),
    ]);
    const result = await sweepTempBucsExpiryWarnings(deps);
    expect(result.sent).toBe(0);
    expect(sent).toHaveLength(0);
    expect(rows.size).toBe(0);
  });

  it("a pool more than 3 days out sends nothing yet", async () => {
    const { deps, sent } = makeDeps([
      pool({
        bonusCreditsExpiresAt: new Date(NOW.getTime() + 10 * DAY).toISOString(),
      }),
    ]);
    const result = await sweepTempBucsExpiryWarnings(deps);
    expect(result.sent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("a suppressed address is never mailed and the claim settles suppressed", async () => {
    const { deps, sent, rows } = makeDeps([pool({})], {
      suppressed: ["user-1@example.com"],
    });
    const result = await sweepTempBucsExpiryWarnings(deps);
    expect(result.suppressed).toBe(1);
    expect(result.sent).toBe(0);
    expect(sent).toHaveLength(0);
    expect([...rows.values()][0]!.status).toBe("suppressed");
    // And it stays settled on later sweeps.
    const again = await sweepTempBucsExpiryWarnings(deps);
    expect(again.sent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("a member with no reachable address is skipped without a claim", async () => {
    const { deps, sent, rows } = makeDeps([pool({})], {
      emails: { "user-1": null },
    });
    const result = await sweepTempBucsExpiryWarnings(deps);
    expect(result.skipped).toBe(1);
    expect(sent).toHaveLength(0);
    expect(rows.size).toBe(0);
  });

  it("a failed send is ledgered and retried on the next sweep, then sends", async () => {
    const { deps, sent, rows } = makeDeps([pool({})], {
      sendImpl: (call) =>
        call === 1
          ? { sent: false, reason: "no-provider" }
          : { sent: true, id: "msg-retry" },
    });
    const first = await sweepTempBucsExpiryWarnings(deps);
    expect(first.failed).toBe(1);
    expect([...rows.values()][0]!.status).toBe("failed");
    const second = await sweepTempBucsExpiryWarnings(deps);
    expect(second.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect([...rows.values()][0]!.status).toBe("sent");
    expect([...rows.values()][0]!.attempts).toBe(2);
  });

  it("one bad pool never blocks the rest of the sweep", async () => {
    const good = pool({ userId: "user-2" });
    const { deps, sent } = makeDeps([pool({}), good], {
      getEmail: undefined,
      emails: {},
    });
    // user-1's address lookup explodes; user-2 must still be warned.
    const exploding = {
      ...deps,
      getEmail: async (userId: string) => {
        if (userId === "user-1") throw new Error("address book down");
        return `${userId}@example.com`;
      },
    };
    const result = await sweepTempBucsExpiryWarnings(exploding);
    expect(result.sent).toBe(1);
    expect(sent[0]!.to).toBe("user-2@example.com");
  });
});
