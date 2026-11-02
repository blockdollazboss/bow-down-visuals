/**
 * QC-200 PRE-PROOF Q164 residual (stack1200 qcproof-money-b) —
 * World stage tips: EVERY post-debit failure leg unwinds fully.
 *
 * Already pinned elsewhere (verified, not redone here):
 *  - gateproof (world-stage-tips-gateproof): exact move,
 *    conservation, replay, insufficient, guest refusal, no fee,
 *    and the house bounds moving exactly at 100 / 1,000,000 VB.
 *  - world-room-stage-tip: the bounds REFUSE — 99, a fraction and
 *    1,000,001 are denied; 100 and 1,000,000 land.
 *  - world-stage-tips: ledger failure refunds + voids; credit-
 *    record failure reverses + refunds + deletes + voids.
 *
 * The residual: the transfer's credit-failure leg (the performer's
 * credit throws BEFORE anything landed) was asserted for refund +
 * row deletion but never for the VOID — and the markCredited
 * failure leg (credit + ledger record landed, the stamp throws)
 * was never exercised at all. The ledger claim is that EVERY
 * failure leg refunds the tipper in full, voids the debit key and
 * deletes the tip row, so a fresh attempt with a new key starts
 * clean and the tipper loses nothing. Both legs are pinned here
 * against the same injectable store the transfer is built on.
 */
import { describe, it, expect } from "vitest";
import {
  createStageTipper,
  type StageTipStore,
  type StageTipRow,
} from "../world-stage-tips";

class FakeTipStore implements StageTipStore {
  calls: string[] = [];
  rows = new Map<string, StageTipRow>();
  creditedKeys = new Set<string>();
  creditFails = false;
  markFails = false;
  refunds: { userId: string; amountVb: number; action: string }[] = [];
  voided: string[] = [];
  deleted: string[] = [];
  reversed: { userId: string; amountVb: number }[] = [];
  charges: { userId: string; amountVb: number }[] = [];

  async findTipByKey(key: string) {
    this.calls.push("find");
    return this.rows.get(key) ?? null;
  }
  async charge(fromUserId: string, amountVb: number) {
    this.calls.push("charge");
    this.charges.push({ userId: fromUserId, amountVb });
  }
  async insertTip(input: { fromUserId: string; key: string }) {
    this.calls.push("insert");
    const row: StageTipRow = { id: `tip-${this.rows.size + 1}`, creatorCreditedAt: null };
    this.rows.set(input.key, row);
    return row;
  }
  async deleteTip(id: string) {
    this.calls.push("delete");
    this.deleted.push(id);
    for (const [k, v] of this.rows) if (v.id === id) this.rows.delete(k);
  }
  async markCredited(id: string) {
    this.calls.push("markCredited");
    if (this.markFails) throw new Error("stamp boom");
    for (const v of this.rows.values()) if (v.id === id) v.creatorCreditedAt = new Date();
  }
  async creditAlreadyRecorded(creditKey: string) {
    return this.creditedKeys.has(creditKey);
  }
  async creditPerformer() {
    this.calls.push("credit");
    if (this.creditFails) throw new Error("credit boom");
  }
  async recordCredit(_toUserId: string, _amountVb: number, creditKey: string) {
    this.calls.push("recordCredit");
    this.creditedKeys.add(creditKey);
  }
  async reverseCredit(toUserId: string, amountVb: number) {
    this.calls.push("reverse");
    this.reversed.push({ userId: toUserId, amountVb });
  }
  async refund(fromUserId: string, amountVb: number, action: string) {
    this.calls.push("refund");
    this.refunds.push({ userId: fromUserId, amountVb, action });
  }
  async voidKey(key: string) {
    this.calls.push("void");
    this.voided.push(key);
  }
}

const attempt = {
  fromUserId: "user-fan",
  toUserId: "user-star",
  amountVb: 250,
  roomId: "world:kings-hall",
  attemptKey: "attempt-q164-residual",
};

describe("QC-200 Q164 residual — every post-debit failure leg unwinds fully", () => {
  it("performer credit throws before landing: tipper refunded in full, debit key VOIDED, tip row deleted, nothing to reverse", async () => {
    const store = new FakeTipStore();
    store.creditFails = true;
    const tip = createStageTipper(store);
    await expect(tip(attempt)).resolves.toEqual({ ok: false, reason: "error" });
    expect(store.charges).toEqual([{ userId: "user-fan", amountVb: 250 }]);
    expect(store.refunds).toEqual([
      { userId: "user-fan", amountVb: 250, action: "World Stage Tip — Refund (credit failed)" },
    ]);
    expect(store.voided).toHaveLength(1);
    expect(store.deleted).toEqual(["tip-1"]);
    expect(store.rows.size).toBe(0);
    expect(store.reversed).toEqual([]);
  });

  it("the credited stamp throws after the credit landed: credit reversed, tipper refunded in full, key voided, row deleted", async () => {
    const store = new FakeTipStore();
    store.markFails = true;
    const tip = createStageTipper(store);
    await expect(tip(attempt)).resolves.toEqual({ ok: false, reason: "error" });
    expect(store.reversed).toEqual([{ userId: "user-star", amountVb: 250 }]);
    expect(store.refunds).toEqual([
      { userId: "user-fan", amountVb: 250, action: "World Stage Tip — Refund (credit failed)" },
    ]);
    expect(store.voided).toHaveLength(1);
    expect(store.deleted).toEqual(["tip-1"]);
    expect(store.rows.size).toBe(0);
  });

  it("after a fully-unwound failure the tipper can tip again cleanly (no stranded key, no stranded row)", async () => {
    const store = new FakeTipStore();
    store.creditFails = true;
    const tip = createStageTipper(store);
    await expect(tip(attempt)).resolves.toEqual({ ok: false, reason: "error" });
    store.creditFails = false;
    await expect(tip({ ...attempt, attemptKey: "attempt-q164-retry" })).resolves.toEqual({ ok: true });
    /* Two debits, one refund — the tipper is out exactly one tip. */
    expect(store.charges).toHaveLength(2);
    expect(store.refunds).toHaveLength(1);
    expect(store.rows.size).toBe(1);
  });
});
