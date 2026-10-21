/**
 * Stage tips — the transfer (lib/world-stage-tips, Ring 3, 3.3).
 *
 * Pinned contract (the live-stream tips' discipline, mirrored):
 * - Order is debit → ledger row → performer credit, and the full
 *   amount moves: NO fee is taken (no house rule prices a cut of
 *   VB tips).
 * - An insufficient balance refuses cleanly (nothing else runs);
 *   a disabled account reads "disabled", not a generic error.
 * - A ledger failure after the debit refunds the tipper in full
 *   and voids the charge key; a performer-credit failure reverses
 *   any landed credit, refunds, deletes the row and voids the key
 *   — the performer-paid-AND-tipper-refunded duplication is
 *   designed out.
 * - A resumed transfer (a row already stands for the key) never
 *   re-debits and never double-credits: the `:credit` ledger check
 *   and the row's credited stamp gate the credit.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createStageTipper,
  type StageTipStore,
  type StageTipRow,
} from "../world-stage-tips";
import { OutOfCreditsError, CreditsDisabledError } from "../credits";

class FakeTipStore implements StageTipStore {
  calls: string[] = [];
  rows = new Map<string, StageTipRow>();
  creditedKeys = new Set<string>();
  chargeError: Error | null = null;
  insertFails = false;
  creditFails = false;
  recordFails = false;
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
    if (this.chargeError) throw this.chargeError;
    this.charges.push({ userId: fromUserId, amountVb });
  }
  async insertTip(input: { fromUserId: string; key: string }) {
    this.calls.push("insert");
    if (this.insertFails) throw new Error("insert boom");
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
    if (this.recordFails) throw new Error("record boom");
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
  attemptKey: "attempt-12345678",
};

describe("the stage tip transfer", () => {
  it("moves the full amount: charge → ledger → credit → stamp, in that order", async () => {
    const store = new FakeTipStore();
    const tip = createStageTipper(store);
    await expect(tip(attempt)).resolves.toEqual({ ok: true });
    expect(store.calls).toEqual(["find", "charge", "insert", "credit", "recordCredit", "markCredited"]);
    expect(store.charges).toEqual([{ userId: "user-fan", amountVb: 250 }]);
    expect(store.refunds).toEqual([]);
  });

  it("an insufficient balance refuses as insufficient — nothing else runs", async () => {
    const store = new FakeTipStore();
    store.chargeError = new OutOfCreditsError();
    const tip = createStageTipper(store);
    await expect(tip(attempt)).resolves.toEqual({ ok: false, reason: "insufficient" });
    expect(store.calls).toEqual(["find", "charge"]);
  });

  it("a disabled account reads disabled, not a generic error", async () => {
    const store = new FakeTipStore();
    store.chargeError = new CreditsDisabledError("nope");
    const tip = createStageTipper(store);
    await expect(tip(attempt)).resolves.toEqual({ ok: false, reason: "disabled" });
    expect(store.calls).toEqual(["find", "charge"]);
  });

  it("a ledger failure after the debit refunds in full and voids the key — no credit runs", async () => {
    const store = new FakeTipStore();
    store.insertFails = true;
    const tip = createStageTipper(store);
    await expect(tip(attempt)).resolves.toEqual({ ok: false, reason: "error" });
    expect(store.refunds).toEqual([
      { userId: "user-fan", amountVb: 250, action: "World Stage Tip — Refund (record failed)" },
    ]);
    expect(store.voided).toHaveLength(1);
    expect(store.calls).not.toContain("credit");
  });

  it("a credit-record failure after the credit landed reverses it, refunds, deletes the row, voids the key", async () => {
    const store = new FakeTipStore();
    store.recordFails = true;
    const tip = createStageTipper(store);
    await expect(tip(attempt)).resolves.toEqual({ ok: false, reason: "error" });
    expect(store.reversed).toEqual([{ userId: "user-star", amountVb: 250 }]);
    expect(store.refunds).toEqual([
      { userId: "user-fan", amountVb: 250, action: "World Stage Tip — Refund (credit failed)" },
    ]);
    expect(store.deleted).toEqual(["tip-1"]);
    expect(store.voided).toHaveLength(1);
    expect(store.rows.size).toBe(0);
  });

  it("a credit failure before anything landed refunds without a reversal", async () => {
    const store = new FakeTipStore();
    store.creditFails = true;
    const tip = createStageTipper(store);
    await expect(tip(attempt)).resolves.toEqual({ ok: false, reason: "error" });
    expect(store.reversed).toEqual([]);
    expect(store.refunds).toHaveLength(1);
    expect(store.deleted).toEqual(["tip-1"]);
  });

  it("a resumed transfer never re-debits: an uncredited row just completes its credit", async () => {
    const store = new FakeTipStore();
    /* Seed the row the way insertTip would, under the derived key:
     * findTipByKey is keyed by the scoped key — emulate by running
     * one full attempt first, then resetting the credited stamp. */
    const tip = createStageTipper(store);
    await tip(attempt);
    const row = [...store.rows.values()][0]!;
    row.creatorCreditedAt = null;
    store.creditedKeys.clear();
    store.calls = [];
    store.charges = [];
    await expect(tip(attempt)).resolves.toEqual({ ok: true });
    expect(store.charges).toEqual([]);
    expect(store.calls).toEqual(["find", "credit", "recordCredit", "markCredited"]);
  });

  it("a fully-credited row is a no-op success (the credit ledger key gates a second pay)", async () => {
    const store = new FakeTipStore();
    const tip = createStageTipper(store);
    await tip(attempt);
    store.calls = [];
    await expect(tip(attempt)).resolves.toEqual({ ok: true });
    expect(store.calls).toEqual(["find"]);
  });
});
