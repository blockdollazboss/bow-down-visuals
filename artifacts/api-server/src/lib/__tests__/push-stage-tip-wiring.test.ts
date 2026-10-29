/**
 * Stage tip landed → performer device-push wiring (push families #10).
 *
 * The authoritative moment is the performer's credit landing inside
 * tipStagePerformer. The ping fires only when THIS call lands the
 * credit: a resumed attempt whose credit already landed (the
 * creditAlreadyRecorded gate / an already-credited tip row) never
 * re-pings, a failed credit never pings, and a self-tip never pings.
 * Category money, deep link /world. The rest of family #10 (room
 * invites — no invite mechanism exists; King's moment — an in-World
 * self-claim with no bell moment) is reported PARTIAL in the lane
 * report rather than wired against invented hooks.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  __setStageTipEventNotifier,
  buildStageTipEvent,
  createStageTipper,
  type StageTipRow,
} from "../world-stage-tips";
import type { UserEventInput } from "../push-events";

class FakeTipStore {
  rows = new Map<string, StageTipRow & { key: string }>();
  creditedKeys = new Set<string>();
  creditFails = false;

  async findTipByKey(key: string) {
    return this.rows.get(key) ?? null;
  }
  async charge() {}
  async insertTip(input: { fromUserId: string; key: string }) {
    const row: StageTipRow & { key: string } = { id: `tip-${this.rows.size + 1}`, creatorCreditedAt: null, key: input.key };
    this.rows.set(input.key, row);
    return row;
  }
  async deleteTip(id: string) {
    for (const [k, v] of this.rows) if (v.id === id) this.rows.delete(k);
  }
  async markCredited(id: string) {
    for (const v of this.rows.values()) if (v.id === id) v.creatorCreditedAt = new Date();
  }
  async creditAlreadyRecorded(creditKey: string) {
    return this.creditedKeys.has(creditKey);
  }
  async creditPerformer() {
    if (this.creditFails) throw new Error("credit boom");
  }
  async recordCredit(_toUserId: string, _amountVb: number, creditKey: string) {
    this.creditedKeys.add(creditKey);
  }
  async reverseCredit() {}
  async refund() {}
  async voidKey() {}
}

const attempt = {
  fromUserId: "user-fan",
  toUserId: "user-star",
  amountVb: 250,
  roomId: "world:kings-hall",
  attemptKey: "attempt-12345678",
};

afterEach(() => {
  __setStageTipEventNotifier(null);
});

describe("buildStageTipEvent", () => {
  it("addresses the performer, money category, /world link, honest amount", () => {
    const ev = buildStageTipEvent({ toUserId: "user-star", amountVb: 1000 });
    expect(ev).toMatchObject({ userId: "user-star", category: "money", kind: "stage_tip", link: "/world" });
    expect(ev.body).toContain("1,000 VB");
  });
});

describe("tipStagePerformer push wiring", () => {
  it("a landed tip pings the performer exactly once", async () => {
    const store = new FakeTipStore();
    const events: UserEventInput[] = [];
    __setStageTipEventNotifier(async (input) => {
      events.push(input);
    });
    const tip = createStageTipper(store as never);
    const out = await tip(attempt);
    expect(out).toEqual({ ok: true });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: "user-star", kind: "stage_tip" });
  });

  it("a resumed attempt (tip already credited) never re-pings", async () => {
    const store = new FakeTipStore();
    const events: UserEventInput[] = [];
    __setStageTipEventNotifier(async (input) => {
      events.push(input);
    });
    const tip = createStageTipper(store as never);
    await tip(attempt);
    const again = await tip(attempt);
    expect(again).toEqual({ ok: true });
    expect(events).toHaveLength(1);
  });

  it("a failed performer credit pings nobody", async () => {
    const store = new FakeTipStore();
    store.creditFails = true;
    const events: UserEventInput[] = [];
    __setStageTipEventNotifier(async (input) => {
      events.push(input);
    });
    const tip = createStageTipper(store as never);
    const out = await tip(attempt);
    expect(out.ok).toBe(false);
    expect(events).toHaveLength(0);
  });

  it("a throwing notifier cannot unwind a landed tip", async () => {
    const store = new FakeTipStore();
    __setStageTipEventNotifier(async () => {
      throw new Error("push down");
    });
    const tip = createStageTipper(store as never);
    const out = await tip(attempt);
    expect(out).toEqual({ ok: true });
    expect(store.creditedKeys.size).toBe(1);
  });
});
