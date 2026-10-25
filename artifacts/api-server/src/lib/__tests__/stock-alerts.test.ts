/**
 * Back-in-stock alerts (Wave 4 #37) — the lib over a fake store.
 *
 * Pins the alert contract:
 *  - subscribe only lands on a live, sold-out product; a second tap is
 *    an idempotent "already"; a tap after consumption re-arms;
 *  - the restock fan-out claims waiting rows exactly once: every
 *    claimed fan gets ONE in-app notification, and the subscription is
 *    consumed — a second restock (after a second sell-out) fires
 *    NOTHING for fans who did not tap again;
 *  - email rides ONLY the existing subscriber relationship: a claimed
 *    fan whose account email is a confirmed subscriber of the seller's
 *    list gets the email; everyone else is in-app only — and an
 *    unsubscribed or other-seller subscriber is never emailed;
 *  - no fire while the product is still sold out or inactive, and the
 *    transition matrix refuses unrelated edits (price-only changes,
 *    in-stock inventory tweaks).
 */
import { describe, it, expect, vi } from "vitest";
import {
  subscribeStockAlert,
  unsubscribeStockAlert,
  isWaitingOnStockAlert,
  countWaitingStockAlerts,
  fireRestockAlerts,
  maybeFireRestockAlerts,
  isRestockTransition,
  buildRestockEmail,
  STOCK_ALERT_NOTIFICATION_KIND,
  type StockAlertProduct,
  type StockAlertStore,
  type SubscribeOutcome,
} from "../stock-alerts";
import type { SendEmailResult } from "../email";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const SELLER = "22222222-2222-4222-8222-222222222222";
const FAN_A = "33333333-3333-4333-8333-333333333333";
const FAN_B = "44444444-4444-4444-8444-444444444444";

function makeProduct(over: Partial<StockAlertProduct> = {}): StockAlertProduct {
  return {
    id: PRODUCT_ID,
    profileId: "55555555-5555-4555-8555-555555555555",
    sellerUserId: SELLER,
    title: "Midnight Pack",
    inventory: 0,
    isActive: true,
    creatorName: "Queen Creator",
    creatorSlug: "queen-creator",
    ...over,
  };
}

interface FakeRow { userId: string; status: "waiting" | "notified" }

function makeFakeStore(product: StockAlertProduct | null) {
  const rows = new Map<string, FakeRow>();
  const notifications: Array<{ userIds: string[]; kind: string; title: string; body: string; link: string }> = [];
  const emails = new Map<string, string>([
    [FAN_A, "fan-a@example.com"],
    [FAN_B, "fan-b@example.com"],
  ]);
  const subscribers = new Set<string>(); // "sellerUserId|email" lowercased
  const store: StockAlertStore = {
    async getProduct() { return product; },
    async subscribe(userId, productId) {
      const key = `${userId}|${productId}`;
      const row = rows.get(key);
      if (!row) { rows.set(key, { userId, status: "waiting" }); return "created" as SubscribeOutcome; }
      if (row.status === "notified") { row.status = "waiting"; return "rearmed"; }
      return "already";
    },
    async unsubscribe(userId, productId) {
      const key = `${userId}|${productId}`;
      const row = rows.get(key);
      if (row?.status === "waiting") { rows.delete(key); return true; }
      return false;
    },
    async getSubscriptionStatus(userId, productId) {
      return rows.get(`${userId}|${productId}`)?.status ?? null;
    },
    async countWaiting(productId) {
      return [...rows.values()].filter((r) => r.status === "waiting").length;
    },
    async countWaitingForProducts(productIds) {
      const m = new Map<string, number>();
      for (const id of productIds) m.set(id, await this.countWaiting(id));
      return m;
    },
    async claimWaiting(_productId) {
      const claimed: string[] = [];
      for (const row of rows.values()) {
        if (row.status === "waiting") { row.status = "notified"; claimed.push(row.userId); }
      }
      return claimed;
    },
    async insertNotifications(userIds, note) {
      notifications.push({ userIds: [...userIds], ...note });
    },
    async getUserEmail(userId) { return emails.get(userId) ?? null; },
    async isSellerListSubscriber(sellerUserId, email) {
      return subscribers.has(`${sellerUserId}|${email.toLowerCase()}`);
    },
  };
  return { store, rows, notifications, emails, subscribers };
}

const okSend = (sent: Array<any>) =>
  async (opts: any): Promise<SendEmailResult> => { sent.push(opts); return { sent: true, id: "msg_1" }; };

describe("subscribeStockAlert", () => {
  it("lands a wait on a sold-out live product; a second tap is already-waiting", async () => {
    const f = makeFakeStore(makeProduct());
    const first = await subscribeStockAlert({ userId: FAN_A, productId: PRODUCT_ID }, { store: f.store });
    expect(first).toEqual({ ok: true, alreadyWaiting: false });
    const second = await subscribeStockAlert({ userId: FAN_A, productId: PRODUCT_ID }, { store: f.store });
    expect(second).toEqual({ ok: true, alreadyWaiting: true });
    expect(await countWaitingStockAlerts(PRODUCT_ID, { store: f.store })).toBe(1);
    expect(await isWaitingOnStockAlert({ userId: FAN_A, productId: PRODUCT_ID }, { store: f.store })).toBe(true);
  });

  it("refuses a product that is in stock (nothing to wait for) and unlimited products", async () => {
    const stocked = makeFakeStore(makeProduct({ inventory: 3 }));
    expect(await subscribeStockAlert({ userId: FAN_A, productId: PRODUCT_ID }, { store: stocked.store }))
      .toEqual({ ok: false, reason: "not_sold_out" });
    const unlimited = makeFakeStore(makeProduct({ inventory: -1 }));
    expect(await subscribeStockAlert({ userId: FAN_A, productId: PRODUCT_ID }, { store: unlimited.store }))
      .toEqual({ ok: false, reason: "not_sold_out" });
  });

  it("refuses missing and inactive products as not_found", async () => {
    const gone = makeFakeStore(null);
    expect(await subscribeStockAlert({ userId: FAN_A, productId: PRODUCT_ID }, { store: gone.store }))
      .toEqual({ ok: false, reason: "not_found" });
    const draft = makeFakeStore(makeProduct({ isActive: false }));
    expect(await subscribeStockAlert({ userId: FAN_A, productId: PRODUCT_ID }, { store: draft.store }))
      .toEqual({ ok: false, reason: "not_found" });
  });

  it("unsubscribe cancels a wait; cancelling twice is a no-op", async () => {
    const f = makeFakeStore(makeProduct());
    await subscribeStockAlert({ userId: FAN_A, productId: PRODUCT_ID }, { store: f.store });
    expect(await unsubscribeStockAlert({ userId: FAN_A, productId: PRODUCT_ID }, { store: f.store })).toEqual({ ok: true });
    expect(await isWaitingOnStockAlert({ userId: FAN_A, productId: PRODUCT_ID }, { store: f.store })).toBe(false);
    expect(await unsubscribeStockAlert({ userId: FAN_A, productId: PRODUCT_ID }, { store: f.store })).toEqual({ ok: false });
  });
});

describe("fireRestockAlerts", () => {
  it("claims every waiting fan once: one in-app ping each, email only for the seller's list subscribers", async () => {
    const product = makeProduct({ inventory: 0 });
    const f = makeFakeStore(product);
    const sent: any[] = [];
    await subscribeStockAlert({ userId: FAN_A, productId: PRODUCT_ID }, { store: f.store });
    await subscribeStockAlert({ userId: FAN_B, productId: PRODUCT_ID }, { store: f.store });
    /* FAN_A is on the seller's email list; FAN_B is not. */
    f.subscribers.add(`${SELLER}|fan-a@example.com`);

    product.inventory = 4; // the restock lands
    const r = await fireRestockAlerts(PRODUCT_ID, { store: f.store, send: okSend(sent) });
    expect(r).toEqual({ claimed: 2, notified: 2, emailed: 1, emailSkipped: 1 });

    expect(f.notifications).toHaveLength(1);
    expect(f.notifications[0]!.kind).toBe(STOCK_ALERT_NOTIFICATION_KIND);
    expect(f.notifications[0]!.userIds.sort()).toEqual([FAN_A, FAN_B].sort());
    expect(f.notifications[0]!.link).toBe(`/storefront/product/${PRODUCT_ID}`);
    expect(f.notifications[0]!.body).toContain("while it lasts");

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("fan-a@example.com");
    expect(sent[0].subject).toContain("Midnight Pack");

    /* Consumed: both rows are history now. */
    expect(await countWaitingStockAlerts(PRODUCT_ID, { store: f.store })).toBe(0);
  });

  it("a second sell-out + restock fires NOTHING for fans who did not tap again; a fresh tap re-arms", async () => {
    const product = makeProduct({ inventory: 0 });
    const f = makeFakeStore(product);
    const sent: any[] = [];
    await subscribeStockAlert({ userId: FAN_A, productId: PRODUCT_ID }, { store: f.store });

    product.inventory = 2;
    const first = await fireRestockAlerts(PRODUCT_ID, { store: f.store, send: okSend(sent) });
    expect(first.claimed).toBe(1);

    /* Sells out again, restocks again — FAN_A never tapped again. */
    product.inventory = 0;
    product.inventory = 5;
    const second = await fireRestockAlerts(PRODUCT_ID, { store: f.store, send: okSend(sent) });
    expect(second).toEqual({ claimed: 0, notified: 0, emailed: 0, emailSkipped: 0 });
    expect(f.notifications).toHaveLength(1);

    /* FAN_A taps again while sold out → re-armed → next restock fires. */
    product.inventory = 0;
    const re = await subscribeStockAlert({ userId: FAN_A, productId: PRODUCT_ID }, { store: f.store });
    expect(re).toEqual({ ok: true, alreadyWaiting: false });
    product.inventory = 1;
    const third = await fireRestockAlerts(PRODUCT_ID, { store: f.store, send: okSend(sent) });
    expect(third.claimed).toBe(1);
    expect(f.notifications).toHaveLength(2);
  });

  it("never fires while the product is still sold out or inactive — and does not consume the waits", async () => {
    const product = makeProduct({ inventory: 0 });
    const f = makeFakeStore(product);
    const sent: any[] = [];
    await subscribeStockAlert({ userId: FAN_A, productId: PRODUCT_ID }, { store: f.store });

    const stillOut = await fireRestockAlerts(PRODUCT_ID, { store: f.store, send: okSend(sent) });
    expect(stillOut.claimed).toBe(0);

    product.inventory = 3;
    product.isActive = false;
    const draft = await fireRestockAlerts(PRODUCT_ID, { store: f.store, send: okSend(sent) });
    expect(draft.claimed).toBe(0);
    expect(await countWaitingStockAlerts(PRODUCT_ID, { store: f.store })).toBe(1);

    product.isActive = true;
    const live = await fireRestockAlerts(PRODUCT_ID, { store: f.store, send: okSend(sent) });
    expect(live.claimed).toBe(1);
  });

  it("an unsubscribed-from-the-list fan and a fan of ANOTHER seller's list get no email", async () => {
    const product = makeProduct({ inventory: 0 });
    const f = makeFakeStore(product);
    const sent: any[] = [];
    await subscribeStockAlert({ userId: FAN_A, productId: PRODUCT_ID }, { store: f.store });
    await subscribeStockAlert({ userId: FAN_B, productId: PRODUCT_ID }, { store: f.store });
    /* FAN_B subscribes only to a DIFFERENT seller's list. */
    f.subscribers.add(`99999999-9999-4999-8999-999999999999|fan-b@example.com`);

    product.inventory = 2;
    const r = await fireRestockAlerts(PRODUCT_ID, { store: f.store, send: okSend(sent) });
    expect(r.emailed).toBe(0);
    expect(r.notified).toBe(2);
    expect(sent).toHaveLength(0);
  });

  it("a failed email send never blocks the in-app ping or the other fans", async () => {
    const product = makeProduct({ inventory: 0 });
    const f = makeFakeStore(product);
    f.subscribers.add(`${SELLER}|fan-a@example.com`);
    f.subscribers.add(`${SELLER}|fan-b@example.com`);
    await subscribeStockAlert({ userId: FAN_A, productId: PRODUCT_ID }, { store: f.store });
    await subscribeStockAlert({ userId: FAN_B, productId: PRODUCT_ID }, { store: f.store });
    const flaky = vi.fn(async (opts: any): Promise<SendEmailResult> => {
      if (opts.to === "fan-a@example.com") return { sent: false, reason: "no-provider" };
      return { sent: true, id: "msg_2" };
    });
    product.inventory = 2;
    const r = await fireRestockAlerts(PRODUCT_ID, { store: f.store, send: flaky });
    expect(r).toEqual({ claimed: 2, notified: 2, emailed: 1, emailSkipped: 1 });
  });
});

describe("isRestockTransition / maybeFireRestockAlerts", () => {
  it("the matrix: only sold-out→buyable on a live product, or a stocked draft going live", () => {
    const T = isRestockTransition;
    expect(T({ inventory: 0, isActive: true }, { inventory: 3, isActive: true })).toBe(true);
    expect(T({ inventory: 0, isActive: true }, { inventory: -1, isActive: true })).toBe(true); // → unlimited
    expect(T({ inventory: 0, isActive: false }, { inventory: 3, isActive: true })).toBe(true);
    expect(T({ inventory: 3, isActive: false }, { inventory: 3, isActive: true })).toBe(true); // stocked draft goes live
    /* Unrelated edits and non-events: */
    expect(T({ inventory: 0, isActive: true }, { inventory: 0, isActive: true })).toBe(false); // price-only edit
    expect(T({ inventory: 5, isActive: true }, { inventory: 3, isActive: true })).toBe(false); // in-stock tweak
    expect(T({ inventory: 5, isActive: true }, { inventory: 0, isActive: true })).toBe(false); // selling out is not a restock
    expect(T({ inventory: 0, isActive: true }, { inventory: 3, isActive: false })).toBe(false); // restocked but taken offline
    expect(T({ inventory: 0, isActive: false }, { inventory: 0, isActive: true })).toBe(false); // live but still sold out
  });

  it("maybeFire skips non-transitions entirely (store claim never runs)", async () => {
    const product = makeProduct({ inventory: 0 });
    const f = makeFakeStore(product);
    await subscribeStockAlert({ userId: FAN_A, productId: PRODUCT_ID }, { store: f.store });
    const claimSpy = vi.spyOn(f.store, "claimWaiting");
    const r = await maybeFireRestockAlerts(
      { productId: PRODUCT_ID, prev: { inventory: 0, isActive: true }, next: { inventory: 0, isActive: true } },
      { store: f.store, send: okSend([]) },
    );
    expect(r).toBeNull();
    expect(claimSpy).not.toHaveBeenCalled();
  });
});

describe("buildRestockEmail", () => {
  it("carries the claim-window honesty line and the product link", () => {
    const mail = buildRestockEmail(makeProduct({ inventory: 2 }));
    expect(mail.subject).toContain("Midnight Pack");
    expect(mail.html).toContain(`/storefront/product/${PRODUCT_ID}`);
    expect(mail.text).toContain("while it lasts");
    expect(mail.html).toContain("when it's gone, it's gone");
  });
});
