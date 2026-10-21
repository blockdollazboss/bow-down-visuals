/**
 * Drop spectacle claims — the payout rail itself (World Events 3.4).
 *
 * The room authority (world-events.test.ts) pins the in-room claim
 * semantics against an injected claimer. This suite pins the REAL
 * claimer, claimSpectacleDrop (lib/world-events), at its seams:
 * - a claim pays through the EXISTING drop rails: the amount is
 *   checked against the combined weekly drop spend (stream awards +
 *   regular shark-drop claims) under the ≤1,000 VB/week envelope,
 *   granted via addCreditsAtomic, and recorded as an already-claimed
 *   shark_drops ledger row — the exact row shape the Treasury claim
 *   history folds in as "shark-drop" (lib/retention getTreasuryHistory).
 *   No parallel store, no new issuance path.
 * - over the envelope the claim is refused as "budget" and nothing
 *   is granted or recorded; a failed grant records nothing either.
 * - a failed LEDGER row never un-pays a landed claim (the grant is
 *   the money truth; the row is caught and logged, per the code).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sharkDropsTable } from "@workspace/db";

const h = vi.hoisted(() => ({
  weekStart: new Date("2026-10-19T00:00:00.000Z"),
  spentVb: 0,
  spendWeekArgs: [] as Date[],
  grants: [] as Array<{ userId: string; amountVb: number }>,
  grantFails: false,
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  insertFails: false,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    db: {
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          h.inserts.push({ table, values });
          return h.insertFails
            ? Promise.reject(new Error("ledger down"))
            : Promise.resolve([]);
        },
      }),
    },
  };
});

vi.mock("../stream-drops", () => ({
  STREAM_DROP_WEEKLY_CAP_VB: 1_000,
  combinedDropWeekSpendVb: vi.fn(async (weekStart: Date) => {
    h.spendWeekArgs.push(weekStart);
    return h.spentVb;
  }),
}));

vi.mock("../retention", () => ({
  currentWeekStart: () => h.weekStart,
}));

vi.mock("../supabase-admin", () => ({
  addCreditsAtomic: vi.fn(async (userId: string, amountVb: number) => {
    if (h.grantFails) throw new Error("grant failed");
    h.grants.push({ userId, amountVb });
    return { oldCredits: 0, newCredits: amountVb, created: false };
  }),
}));

import { claimSpectacleDrop } from "../world-events";

beforeEach(() => {
  h.spentVb = 0;
  h.spendWeekArgs = [];
  h.grants = [];
  h.grantFails = false;
  h.inserts = [];
  h.insertFails = false;
});

describe("claimSpectacleDrop — the spectacle payout rail", () => {
  it("pays through the drop rails: grants the amount and writes the claimed shark_drops row the Treasury reads", async () => {
    const result = await claimSpectacleDrop("user-1", 200, "evt-drop");
    expect(result).toEqual({ ok: true });

    // The envelope is read for the CURRENT week.
    expect(h.spendWeekArgs).toEqual([h.weekStart]);
    // The grant rides the one credit rail.
    expect(h.grants).toEqual([{ userId: "user-1", amountVb: 200 }]);
    // The ledger row: an already-claimed shark drop — the row shape
    // getTreasuryHistory folds as kind "shark-drop".
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]!.table).toBe(sharkDropsTable);
    const row = h.inserts[0]!.values;
    expect(row.userId).toBe("user-1");
    expect(row.amount).toBe(200);
    expect(row.claimedAt).toBeInstanceOf(Date);
    expect(row.droppedAt).toBeInstanceOf(Date);
    expect((row.expiresAt as Date).getTime() - (row.droppedAt as Date).getTime()).toBe(48 * 3600_000);
  });

  it("a claim landing exactly ON the weekly cap still pays (the envelope is a ceiling, not a target)", async () => {
    h.spentVb = 800;
    const result = await claimSpectacleDrop("user-1", 200, "evt-drop");
    expect(result).toEqual({ ok: true });
    expect(h.grants).toHaveLength(1);
    expect(h.inserts).toHaveLength(1);
  });

  it("over the combined weekly envelope the claim is refused as budget — no grant, no row", async () => {
    h.spentVb = 900;
    const result = await claimSpectacleDrop("user-1", 200, "evt-drop");
    expect(result).toEqual({ ok: false, reason: "budget" });
    expect(h.grants).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  it("a failed grant pays nothing and records nothing", async () => {
    h.grantFails = true;
    const result = await claimSpectacleDrop("user-1", 200, "evt-drop");
    expect(result).toEqual({ ok: false, reason: "error" });
    expect(h.inserts).toHaveLength(0);
  });

  it("a failed ledger row never un-pays a landed claim — the grant stands", async () => {
    h.insertFails = true;
    const result = await claimSpectacleDrop("user-1", 200, "evt-drop");
    expect(result).toEqual({ ok: true });
    expect(h.grants).toEqual([{ userId: "user-1", amountVb: 200 }]);
  });
});
