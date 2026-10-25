/**
 * Commerce tracking pixels (wave-4 #41).
 *
 * Pins the consent-honesty rule end to end on the client: the ONLY
 * pixels that can fire are the seller's own configured, well-shaped
 * IDs (the same gate the release smartlink rail uses). No IDs → no
 * library loads, no globals, no events. Bent IDs → treated as
 * unconfigured. View fires the PageView-equivalent; Purchase fires
 * only through fireCommercePurchase (called by the checkout-success
 * paths after server verification) and at most once per order.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  fireCommercePageView,
  fireCommercePurchase,
  __resetCommercePixelsForTests,
} from "./commerce-pixels";
import { __resetSmartlinkPixelsForTests } from "./smartlink-pixels";

const NONE = { metaPixelId: null, tiktokPixelId: null, googleTagId: null };
const ALL = {
  metaPixelId: "123456789012345",
  tiktokPixelId: "C9ABCDEFGHIJKLMN12",
  googleTagId: "G-ABC123XYZ9",
};

function installFakeDom() {
  const scripts: Array<{ src: string; async: boolean }> = [];
  const fakeWindow: Record<string, unknown> = {};
  const fakeDocument = {
    head: {
      appendChild(el: { src: string; async: boolean }) {
        scripts.push(el);
      },
    },
    createElement(_tag: string) {
      return { src: "", async: false };
    },
  };
  (globalThis as any).window = fakeWindow;
  (globalThis as any).document = fakeDocument;
  return { scripts, fakeWindow };
}

describe("commerce pixels — consent gating", () => {
  let env: ReturnType<typeof installFakeDom>;

  beforeEach(() => {
    __resetSmartlinkPixelsForTests();
    __resetCommercePixelsForTests();
    env = installFakeDom();
  });

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  });

  it("no IDs configured → view and purchase both fire nothing, load nothing", () => {
    expect(fireCommercePageView(NONE)).toEqual([]);
    expect(fireCommercePurchase(NONE, { orderId: "ord_1", valueCents: 2000 })).toEqual([]);
    expect(fireCommercePageView(null)).toEqual([]);
    expect(env.scripts).toHaveLength(0);
    expect(env.fakeWindow.fbq).toBeUndefined();
    expect(env.fakeWindow.gtag).toBeUndefined();
    expect(env.fakeWindow.ttq).toBeUndefined();
  });

  it("bent IDs are treated as unconfigured — they never arm", () => {
    const bent = { metaPixelId: "junk!!", tiktokPixelId: "has spaces", googleTagId: "XX-1" };
    expect(fireCommercePageView(bent)).toEqual([]);
    expect(fireCommercePurchase(bent, { orderId: "ord_1", valueCents: 2000 })).toEqual([]);
    expect(env.scripts).toHaveLength(0);
  });
});

describe("commerce pixels — view + purchase events", () => {
  let env: ReturnType<typeof installFakeDom>;

  beforeEach(() => {
    __resetSmartlinkPixelsForTests();
    __resetCommercePixelsForTests();
    env = installFakeDom();
  });

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  });

  it("view arms all three libraries once and fires PageView-equivalents", () => {
    expect(fireCommercePageView(ALL)).toEqual(["meta", "tiktok", "google"]);
    expect(env.scripts).toHaveLength(3);
    const fbq = env.fakeWindow.fbq as any;
    expect(fbq.q).toEqual([["init", "123456789012345"], ["track", "PageView"]]);
    /* Re-render does not double-fire. */
    expect(fireCommercePageView(ALL)).toEqual([]);
    expect(env.scripts).toHaveLength(3);
  });

  it("purchase fires Purchase / CompletePayment / purchase with dollars + order id", () => {
    const fired = fireCommercePurchase(ALL, { orderId: "ord_42", valueCents: 2599 });
    expect(fired).toEqual(["meta", "tiktok", "google"]);

    const fbq = env.fakeWindow.fbq as any;
    expect(fbq.q).toContainEqual(["track", "Purchase", { value: 25.99, currency: "USD" }]);

    const ttq = env.fakeWindow.ttq as any;
    expect(
      ttq.some((e: unknown[]) => e[0] === "track" && e[1] === "CompletePayment" && (e[2] as any).value === 25.99),
    ).toBe(true);

    const dataLayer = env.fakeWindow.dataLayer as unknown[][];
    expect(
      dataLayer.some(
        (a) => a[0] === "event" && a[1] === "purchase" && (a[2] as any).transaction_id === "ord_42" && (a[2] as any).value === 25.99,
      ),
    ).toBe(true);
  });

  it("the same order can never fire Purchase twice; a new order can", () => {
    expect(fireCommercePurchase(ALL, { orderId: "ord_1", valueCents: 1000 })).toEqual(["meta", "tiktok", "google"]);
    expect(fireCommercePurchase(ALL, { orderId: "ord_1", valueCents: 1000 })).toEqual([]);
    const fbq = env.fakeWindow.fbq as any;
    const purchases = (fbq.q as unknown[][]).filter((a) => a[0] === "track" && a[1] === "Purchase");
    expect(purchases).toHaveLength(1);
    expect(fireCommercePurchase(ALL, { orderId: "ord_2", valueCents: 1000 })).toEqual(["meta", "tiktok", "google"]);
  });

  it("a single configured network fires only that network's purchase", () => {
    const fired = fireCommercePurchase(
      { ...NONE, googleTagId: "G-ABC123XYZ9" },
      { orderId: "ord_9", valueCents: 500 },
    );
    expect(fired).toEqual(["google"]);
    expect(env.fakeWindow.fbq).toBeUndefined();
    expect(env.fakeWindow.ttq).toBeUndefined();
    expect(env.scripts).toHaveLength(1);
  });
});
