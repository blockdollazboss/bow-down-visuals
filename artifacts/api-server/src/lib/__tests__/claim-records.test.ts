/**
 * claim-records.test.ts — recordRetentionClaim, the per-claim
 * record write for Daily Drop claims + streak milestones
 * (migration 0165).
 *
 * Contract pinned here:
 *   - the insert carries the claim's stamped values verbatim
 *     (user, kind, ref, amount) into retention_claim_records;
 *   - it goes through ON CONFLICT DO NOTHING — the (user, kind,
 *     ref) unique index is the claim's own identity, so a replayed
 *     write is a no-op in Postgres (the claim-path fakes in
 *     bonus-claims / retention-claims emulate that dedupe against
 *     this chain shape);
 *   - a failed record NEVER throws: the award already paid, and
 *     failing the claim would strand the member with an error for
 *     a claim its guard now refuses to repeat. The failure is
 *     logged, not surfaced.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    inserts: [] as Array<{ table: unknown; values: Record<string, unknown>; conflictGuard: boolean }>,
    insertFails: false,
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const fakeDb = {
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: async () => {
          if (state.insertFails) throw new Error("db unavailable");
          state.inserts.push({ table, values: v, conflictGuard: true });
        },
      }),
    }),
  };
  return { ...actual, db: fakeDb };
});

import { recordRetentionClaim } from "../claim-records";
import { retentionClaimRecordsTable } from "@workspace/db";

const USER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.state.inserts = [];
  h.state.insertFails = false;
});

describe("recordRetentionClaim", () => {
  it("writes the claim's stamped values into retention_claim_records, conflict-guarded", async () => {
    await recordRetentionClaim({ userId: USER, kind: "daily_drop", refKey: "2026-10-19", amountVb: 200 });
    expect(h.state.inserts).toEqual([
      {
        table: retentionClaimRecordsTable,
        values: { userId: USER, kind: "daily_drop", refKey: "2026-10-19", amountVb: 200 },
        conflictGuard: true,
      },
    ]);
  });

  it("stamps a streak milestone with its day-count ref and the reward paid", async () => {
    await recordRetentionClaim({ userId: USER, kind: "streak_milestone", refKey: "30", amountVb: 1000 });
    expect(h.state.inserts[0]!.values).toEqual({
      userId: USER,
      kind: "streak_milestone",
      refKey: "30",
      amountVb: 1000,
    });
  });

  it("a failed record write resolves instead of throwing — the paid claim is never failed by its ledger row", async () => {
    h.state.insertFails = true;
    await expect(
      recordRetentionClaim({ userId: USER, kind: "daily_drop", refKey: "2026-10-19", amountVb: 200 }),
    ).resolves.toBeUndefined();
    expect(h.state.inserts).toEqual([]);
  });
});
