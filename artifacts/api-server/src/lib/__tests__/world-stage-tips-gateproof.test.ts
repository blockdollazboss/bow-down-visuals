/**
 * Gate #5 pre-proof — World STAGE TIPS (the balance-level proofs).
 *
 * The existing suites pin the transfer's call ORDER with fakes that
 * ignore amounts (world-stage-tips.test.ts), the room's gates with a
 * fake tipper (world-room-stage-tip.test.ts), and the bell wiring
 * (push-stage-tip-wiring.test.ts). What none of them proved — the
 * Gate #5 questions — is the money itself at balance level, and the
 * full room → real-tipper path:
 *
 *   1. A stage tip moves EXACTLY the stated amount tipper →
 *      performer, with NO fee: the performer's gain equals the
 *      tipper's loss equals the stated amount, and the total VB in
 *      the system is conserved (no house cut materialises anywhere).
 *   2. Exactly-once per the rail's own discipline: the room mints a
 *      fresh attemptKey per stage.tip frame, and every derived key
 *      (charge, ledger row, :credit entry, bell) hangs off it — a
 *      replayed call with the SAME attemptKey moves nothing twice.
 *   3. Insufficient balance fails clean at balance level: neither
 *      balance moves, no ledger row, no credit, no bell, no refund.
 *   4. The performer is told exactly once per landed tip through
 *      the one notification door (notifyUserEvent seam), addressed
 *      to the performer, money category, honest amount.
 *   5. A guest frame through the real room + real tipper is refused
 *      "guests" and the transfer never runs (no balance moves).
 *
 * The fake store below is faithful where it matters: charge dedupes
 * by key the way chargeCredits' idempotency key does, insertTip
 * throws on a duplicate key the way the world_stage_tips unique
 * index (world_stage_tips_key_uq) does, and credits move real
 * balances so amounts — not just call order — are asserted.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  __setStageTipEventNotifier,
  createStageTipper,
  type StageTipRow,
  type StageTipStore,
} from "../world-stage-tips";
import { OutOfCreditsError } from "../credits";
import { RoomHub, type WsClientSocket } from "../live-ws";
import { WorldRoom, type WorldIdentity } from "../world-room";
import type { UserEventInput } from "../push-events";

/* ── A balance-tracking StageTipStore ─────────────────────────── */
class BalanceTipStore implements StageTipStore {
  balances = new Map<string, number>();
  rows = new Map<string, StageTipRow>();
  chargedKeys = new Set<string>();
  creditedKeys = new Set<string>();
  charges: { userId: string; amountVb: number }[] = [];
  credits: { userId: string; amountVb: number }[] = [];
  refunds: { userId: string; amountVb: number }[] = [];
  creditFails = false;

  seed(userId: string, vb: number) {
    this.balances.set(userId, vb);
  }
  balance(userId: string) {
    return this.balances.get(userId) ?? 0;
  }
  totalVb() {
    return [...this.balances.values()].reduce((a, b) => a + b, 0);
  }

  async findTipByKey(key: string) {
    return this.rows.get(key) ?? null;
  }
  async charge(fromUserId: string, amountVb: number, key: string) {
    /* chargeCredits with an idempotency key: a replayed charge for
     * the same key is a no-op success, never a second debit. */
    if (this.chargedKeys.has(key)) return;
    if (this.balance(fromUserId) < amountVb) throw new OutOfCreditsError();
    this.chargedKeys.add(key);
    this.balances.set(fromUserId, this.balance(fromUserId) - amountVb);
    this.charges.push({ userId: fromUserId, amountVb });
  }
  async insertTip(input: { fromUserId: string; key: string }) {
    /* The unique index on world_stage_tips.idempotency_key. */
    if (this.rows.has(input.key)) throw new Error("unique violation: world_stage_tips_key_uq");
    const row: StageTipRow = { id: `tip-${this.rows.size + 1}`, creatorCreditedAt: null };
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
  async creditPerformer(toUserId: string, amountVb: number) {
    if (this.creditFails) throw new Error("credit boom");
    this.balances.set(toUserId, this.balance(toUserId) + amountVb);
    this.credits.push({ userId: toUserId, amountVb });
  }
  async recordCredit(_toUserId: string, _amountVb: number, creditKey: string) {
    this.creditedKeys.add(creditKey);
  }
  async reverseCredit(toUserId: string, amountVb: number) {
    this.balances.set(toUserId, this.balance(toUserId) - amountVb);
  }
  async refund(fromUserId: string, amountVb: number) {
    this.balances.set(fromUserId, this.balance(fromUserId) + amountVb);
    this.refunds.push({ userId: fromUserId, amountVb });
  }
  async voidKey(key: string) {
    this.chargedKeys.delete(key);
  }
}

const FAN = "user-fan";
const STAR = "user-star";
const ROOM = "world:kings-hall";
const attempt = (over: Partial<{ amountVb: number; attemptKey: string }> = {}) => ({
  fromUserId: FAN,
  toUserId: STAR,
  amountVb: 250,
  roomId: ROOM,
  attemptKey: "attempt-12345678",
  ...over,
});

let events: UserEventInput[] = [];
function captureEvents() {
  events = [];
  __setStageTipEventNotifier(async (input) => {
    events.push(input);
  });
}
afterEach(() => {
  __setStageTipEventNotifier(null);
});

describe("Gate #5: stage tip balances (real transfer, balance-level)", () => {
  it("moves EXACTLY the stated amount tipper → performer, no fee, total conserved", async () => {
    captureEvents();
    const store = new BalanceTipStore();
    store.seed(FAN, 1_000);
    store.seed(STAR, 40);
    const tip = createStageTipper(store);

    await expect(tip(attempt())).resolves.toEqual({ ok: true });

    expect(store.balance(FAN)).toBe(750);
    expect(store.balance(STAR)).toBe(290);
    /* No fee: performer gain === tipper loss === stated amount,
     * and no VB appeared or vanished anywhere else. */
    expect(store.balance(STAR) - 40).toBe(250);
    expect(store.totalVb()).toBe(1_040);
    expect(store.charges).toEqual([{ userId: FAN, amountVb: 250 }]);
    expect(store.credits).toEqual([{ userId: STAR, amountVb: 250 }]);
    expect(store.refunds).toEqual([]);
    expect(store.rows.size).toBe(1);
    expect([...store.rows.values()][0]!.creatorCreditedAt).not.toBeNull();
  });

  it("the house bounds move exactly too: 100 VB and 1,000,000 VB, no fee at either end", async () => {
    captureEvents();
    const store = new BalanceTipStore();
    store.seed(FAN, 1_000_100);
    store.seed(STAR, 0);
    const tip = createStageTipper(store);

    await expect(tip(attempt({ amountVb: 100, attemptKey: "attempt-min-0001" }))).resolves.toEqual({ ok: true });
    await expect(tip(attempt({ amountVb: 1_000_000, attemptKey: "attempt-max-0001" }))).resolves.toEqual({ ok: true });

    expect(store.balance(FAN)).toBe(0);
    expect(store.balance(STAR)).toBe(1_000_100);
    expect(store.totalVb()).toBe(1_000_100);
    expect(events).toHaveLength(2);
  });

  it("exactly-once: replaying the SAME attemptKey moves nothing twice — balances, ledger, credit, bell", async () => {
    captureEvents();
    const store = new BalanceTipStore();
    store.seed(FAN, 1_000);
    store.seed(STAR, 0);
    const tip = createStageTipper(store);

    await expect(tip(attempt())).resolves.toEqual({ ok: true });
    const afterFirst = { fan: store.balance(FAN), star: store.balance(STAR) };

    await expect(tip(attempt())).resolves.toEqual({ ok: true });
    await expect(tip(attempt())).resolves.toEqual({ ok: true });

    expect(store.balance(FAN)).toBe(afterFirst.fan);
    expect(store.balance(STAR)).toBe(afterFirst.star);
    expect(store.charges).toHaveLength(1);
    expect(store.credits).toHaveLength(1);
    expect(store.rows.size).toBe(1);
    expect(events).toHaveLength(1);
  });

  it("insufficient balance fails clean at balance level: nothing moves, no row, no credit, no bell, no refund", async () => {
    captureEvents();
    const store = new BalanceTipStore();
    store.seed(FAN, 100);
    store.seed(STAR, 40);
    const tip = createStageTipper(store);

    await expect(tip(attempt({ amountVb: 250 }))).resolves.toEqual({ ok: false, reason: "insufficient" });

    expect(store.balance(FAN)).toBe(100);
    expect(store.balance(STAR)).toBe(40);
    expect(store.totalVb()).toBe(140);
    expect(store.rows.size).toBe(0);
    expect(store.credits).toEqual([]);
    expect(store.refunds).toEqual([]);
    expect(events).toEqual([]);
  });

  it("the performer is told exactly once, through the one door, with the honest amount", async () => {
    captureEvents();
    const store = new BalanceTipStore();
    store.seed(FAN, 1_000);
    store.seed(STAR, 0);
    const tip = createStageTipper(store);

    await tip(attempt({ amountVb: 1_000 }));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      userId: STAR,
      category: "money",
      kind: "stage_tip",
      link: "/world",
    });
    expect(events[0]!.body).toContain("1,000 VB");
    /* The tipper is never the bell's addressee. */
    expect(events[0]!.userId).not.toBe(FAN);
  });

  it("a performer-credit failure restores BOTH balances (no paid-and-refunded duplication)", async () => {
    captureEvents();
    const store = new BalanceTipStore();
    store.seed(FAN, 1_000);
    store.seed(STAR, 40);
    store.creditFails = true;
    const tip = createStageTipper(store);

    await expect(tip(attempt())).resolves.toEqual({ ok: false, reason: "error" });

    expect(store.balance(FAN)).toBe(1_000);
    expect(store.balance(STAR)).toBe(40);
    expect(store.totalVb()).toBe(1_040);
    expect(store.rows.size).toBe(0);
    expect(events).toEqual([]);
  });
});

/* ── Room → real tipper (the path a live frame actually takes) ── */
interface FakeSocket extends WsClientSocket {
  sent: any[];
  closedWith: { code?: number; reason?: string } | null;
}
function fakeSocket(): FakeSocket {
  const s: FakeSocket = {
    readyState: 1,
    sent: [],
    closedWith: null,
    send(data: string) {
      s.sent.push(JSON.parse(data));
    },
    close(code?: number, reason?: string) {
      s.closedWith = { code, reason };
      s.readyState = 3;
    },
    terminate() {
      s.readyState = 3;
    },
    ping() {},
    on() {
      return s;
    },
  };
  return s;
}
const member = (name: string): WorldIdentity => ({
  userId: `user-${name}`,
  displayName: name,
  avatarUrl: null,
  profileSlug: name.toLowerCase(),
});
const guest = (): WorldIdentity => ({
  userId: null,
  displayName: "Guest",
  avatarUrl: null,
  profileSlug: null,
});
const flush = () => new Promise<void>((r) => setImmediate(r));
const T0 = 5_000_000;

describe("Gate #5: room → real tipper integration", () => {
  it("a member's stage.tip frame moves real balances, is witnessed, and bells the performer once", async () => {
    captureEvents();
    const store = new BalanceTipStore();
    store.seed("user-Fan", 1_000);
    store.seed("user-Star", 0);
    const room = new WorldRoom(new RoomHub(), {
      tipStagePerformer: createStageTipper(store),
      resolveStageStream: async (userId, streamId) =>
        streamId === "stream-1"
          ? {
              streamId,
              title: "Friday Set",
              performerName: userId.replace("user-", ""),
              performerSlug: userId.replace("user-", "").toLowerCase(),
            }
          : null,
    });
    const star = fakeSocket();
    const fan = fakeSocket();
    room.attach(star, member("Star"));
    room.attach(fan, member("Fan"));
    room.handleFrame(star, JSON.stringify({ type: "stage.live", streamId: "stream-1" }), T0);
    await flush();
    star.sent = [];
    fan.sent = [];

    room.handleFrame(fan, JSON.stringify({ type: "stage.tip", amountVb: 250 }), T0 + 100);
    /* The real tipper resolves after its (best-effort, failing in
     * tests) overlay lookup — wait for the room's witness frame
     * instead of counting flushes. */
    await vi.waitFor(
      () => expect(star.sent.find((m) => m.type === "stage.tipped")).toBeTruthy(),
      { timeout: 10_000, interval: 50 },
    );

    expect(store.balance("user-Fan")).toBe(750);
    expect(store.balance("user-Star")).toBe(250);
    expect(store.rows.size).toBe(1);
    expect(star.sent.find((m) => m.type === "stage.tipped")?.tip).toEqual({
      name: "Fan",
      performerName: "Star",
      amountVb: 250,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: "user-Star", kind: "stage_tip" });
  });

  it("a guest's stage.tip frame is refused and the real transfer never runs — no balance moves, no bell", async () => {
    captureEvents();
    const store = new BalanceTipStore();
    store.seed("user-Star", 0);
    const tipper = vi.fn(createStageTipper(store));
    const room = new WorldRoom(new RoomHub(), {
      tipStagePerformer: tipper,
      resolveStageStream: async (userId, streamId) =>
        streamId === "stream-1"
          ? {
              streamId,
              title: "Friday Set",
              performerName: userId.replace("user-", ""),
              performerSlug: userId.replace("user-", "").toLowerCase(),
            }
          : null,
    });
    const star = fakeSocket();
    room.attach(star, member("Star"));
    room.handleFrame(star, JSON.stringify({ type: "stage.live", streamId: "stream-1" }), T0);
    await flush();
    const g = fakeSocket();
    room.attach(g, guest());
    g.sent = [];

    room.handleFrame(g, JSON.stringify({ type: "stage.tip", amountVb: 250 }), T0 + 100);
    await flush();

    expect(g.sent.find((m) => m.type === "stage.tip.denied")?.reason).toBe("guests");
    expect(tipper).not.toHaveBeenCalled();
    expect(store.balance("user-Star")).toBe(0);
    expect(store.rows.size).toBe(0);
    expect(events).toEqual([]);
  });
});
