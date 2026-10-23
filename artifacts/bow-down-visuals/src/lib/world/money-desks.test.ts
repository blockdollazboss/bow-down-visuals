/**
 * money-desks — Money wave I (Stack-100 items 61–64). Pins:
 * (a) the packs table agrees with BOTH sources of truth — the
 *     server's PACK_MAP (stripe-payments.ts) and the pricing page's
 *     displayed prices (en.json pricing.creditPacks) — and the
 *     checkout body is the page's exact { pack } shape;
 * (b) payout state parses honestly (a payload without the money
 *     fields is no status), the cash-out gate is the dashboard's
 *     own (enabled AND ≥ minimum), and the success note is built
 *     from the payout response only;
 * (c) tier forms gate on the rail's own schema limits, the save
 *     body is the memberships page's exact shape with its clamps,
 *     the own-tiers parse keeps PAUSED tiers (management sees what
 *     fans can't), and list changes come only from server rows;
 * (d) the room catalog classifies every item onto the rail that
 *     actually sells it, the PWYW payload honors the minimum, and
 *     the room cart key IS the shop page's cart key when the room's
 *     creator runs that shop.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  CREDIT_PACKS,
  PACKS_TEST_MODE_NOTE,
  apiErrorLine,
  applyTierSave,
  buildTierPayload,
  canCashOut,
  creditPackByKey,
  emptyTierForm,
  packCheckoutPayload,
  packCheckoutUrl,
  parseConnectStatus,
  parseOwnTiers,
  parseRoomCatalog,
  payoutDeskState,
  payoutDollars,
  payoutSuccessNote,
  removeTier,
  roomCartKey,
  roomItemRail,
  roomMarketProducts,
  savedTierDto,
  storeCheckoutPayload,
  storefrontCheckoutPayload,
  tierActivePayload,
  tierFormFromDto,
  tierFormProblem,
  tierNetCents,
  type RoomStoreItem,
} from "./money-desks";
import type { MembershipTierDto } from "./shop-stands";

const tier = (over: Partial<MembershipTierDto> = {}): MembershipTierDto => ({
  id: "t1",
  creatorUserId: "u1",
  name: "Gold",
  priceDollars: 5,
  priceCents: 500,
  description: "",
  perks: [],
  isActive: true,
  trialEnabled: false,
  annualDiscountPct: 0,
  annualPriceCents: 6000,
  annualPriceDollars: 60,
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});

const roomItem = (over: Partial<RoomStoreItem> = {}): RoomStoreItem => ({
  id: "i1",
  kind: "product",
  productKind: "shop",
  title: "Thing",
  artworkUrl: null,
  priceCents: 1999,
  price: "$19.99",
  buyUrl: "/shop/x",
  pwyw: null,
  ...over,
});

describe("61 · credit packs", () => {
  it("the pack table matches the server's PACK_MAP and the page's prices", () => {
    const server = readFileSync(
      new URL("../../../../api-server/src/routes/stripe-payments.ts", import.meta.url),
      "utf8",
    );
    const en = JSON.parse(
      readFileSync(new URL("../../locales/en.json", import.meta.url), "utf8"),
    ) as { pricing: { creditPacks: { packs: Record<string, { credits: string; price: string }> } } };
    expect(CREDIT_PACKS.map((p) => p.key)).toEqual(["10", "50", "150", "500"]);
    for (const pack of CREDIT_PACKS) {
      // Server truth: the key maps to exactly these credits.
      expect(server, pack.key).toContain(`"${pack.key}":`);
      expect(server).toMatch(new RegExp(`"${pack.key}":\\s*\\{[^}]*credits: ${pack.credits}\\b`));
      // Page truth: the displayed credits line and price.
      const shown = en.pricing.creditPacks.packs[pack.key]!;
      expect(pack.creditsLabel).toBe(shown.credits);
      expect(pack.priceLabel).toBe(shown.price);
      expect(pack.creditsLabel).toBe(`${pack.credits.toLocaleString("en-US")} Visual Bucs`);
    }
  });

  it("the checkout body is exactly { pack } and the URL reads off { url } only", () => {
    expect(packCheckoutPayload(CREDIT_PACKS[0]!)).toEqual({ pack: "10" });
    expect(packCheckoutUrl({ url: "https://checkout.stripe.com/x" })).toBe("https://checkout.stripe.com/x");
    expect(packCheckoutUrl({ url: "notaurl" })).toBeNull();
    expect(packCheckoutUrl({})).toBeNull();
    expect(packCheckoutUrl(null)).toBeNull();
    expect(creditPackByKey("150")?.credits).toBe(15000);
    expect(creditPackByKey("999")).toBeNull();
    expect(PACKS_TEST_MODE_NOTE).toContain("test mode");
  });
});

describe("62 · payouts", () => {
  const status = (over: Record<string, unknown> = {}) => ({
    connected: true,
    accountId: "acct_1",
    onboarded: true,
    chargesEnabled: true,
    payoutsEnabled: true,
    pendingCents: 2500,
    minPayoutCents: 100,
    testMode: true,
    ...over,
  });

  it("parses the status DTO and refuses payloads without the money fields", () => {
    const s = parseConnectStatus(status());
    expect(s?.pendingCents).toBe(2500);
    expect(s?.testMode).toBe(true);
    expect(parseConnectStatus({ connected: true })).toBeNull();
    expect(parseConnectStatus(null)).toBeNull();
    expect(parseConnectStatus("junk")).toBeNull();
  });

  it("the desk state and cash-out gate are the dashboard's own", () => {
    expect(payoutDeskState(parseConnectStatus(status({ connected: false, accountId: null }))!)).toBe("connect");
    expect(payoutDeskState(parseConnectStatus(status({ payoutsEnabled: false }))!)).toBe("finish-setup");
    expect(payoutDeskState(parseConnectStatus(status())!)).toBe("ready");
    expect(canCashOut(parseConnectStatus(status())!)).toBe(true);
    expect(canCashOut(parseConnectStatus(status({ pendingCents: 99 }))!)).toBe(false);
    expect(canCashOut(parseConnectStatus(status({ payoutsEnabled: false }))!)).toBe(false);
    expect(canCashOut(null)).toBe(false);
  });

  it("the success note comes from the payout response, test-mode note included", () => {
    expect(payoutSuccessNote({ payout: { amountCents: 2500 }, note: "TEST MODE — no real money moved." }))
      .toBe("Cash out sent: $25.00 — TEST MODE — no real money moved.");
    expect(payoutSuccessNote({ payout: { amountCents: 100 } })).toBe("Cash out sent: $1.00");
    expect(payoutSuccessNote({})).toBeNull();
    expect(payoutSuccessNote({ payout: {} })).toBeNull();
    expect(payoutDollars(5)).toBe("$0.05");
  });

  it("the error line prefers the server's human message", () => {
    expect(apiErrorLine({ message: "Connect your bank first.", error: "NO_ACCOUNT" }, "fb")).toBe("Connect your bank first.");
    expect(apiErrorLine({ error: "NO_ACCOUNT" }, "fb")).toBe("NO_ACCOUNT");
    expect(apiErrorLine(null, "fb")).toBe("fb");
  });
});

describe("63 · membership tier management", () => {
  it("the form gates mirror the rail's schema", () => {
    expect(tierFormProblem(emptyTierForm())).toBe("Give the tier a name first.");
    const ok = { ...emptyTierForm(), name: "Gold" };
    expect(tierFormProblem(ok)).toBeNull();
    expect(tierFormProblem({ ...ok, price: "1000" })).toContain("$999.99");
    expect(tierFormProblem({ ...ok, price: "-1" })).toContain("$999.99");
    expect(tierFormProblem({ ...ok, price: "" })).toContain("$999.99");
    expect(tierFormProblem({ ...ok, description: "x".repeat(501) })).toContain("500");
    expect(tierFormProblem({ ...ok, perks: Array(21).fill("p") })).toContain("20 perks");
    expect(tierFormProblem({ ...ok, perks: ["x".repeat(141)] })).toContain("140");
    expect(tierFormProblem({ ...ok, annualDiscount: "91" })).toContain("0–90%");
    expect(tierFormProblem({ ...ok, name: "x".repeat(61) })).toContain("60 characters");
  });

  it("the save body is the page's exact shape, clamps included", () => {
    const body = buildTierPayload({
      name: "  Gold  ",
      price: "12.5",
      description: "  desc ",
      perks: [" a ", "", "b"],
      trialEnabled: true,
      annualDiscount: "10.6",
    });
    expect(body).toEqual({
      name: "Gold",
      priceDollars: 12.5,
      description: "desc",
      perks: ["a", "b"],
      trialEnabled: true,
      annualDiscountPct: 11,
    });
    expect(buildTierPayload(emptyTierForm())).toBeNull();
  });

  it("edit prefill and the pause body match the page", () => {
    const form = tierFormFromDto(tier({ priceDollars: 7.5, trialEnabled: true, annualDiscountPct: 20 }));
    expect(form.price).toBe("7.5");
    expect(form.trialEnabled).toBe(true);
    expect(form.annualDiscount).toBe("20");
    expect(tierActivePayload(tier({ isActive: true }))).toEqual({ is_active: "false" });
    expect(tierActivePayload(tier({ isActive: false }))).toEqual({ is_active: "true" });
  });

  it("own tiers parse keeps paused tiers and the rail's fee %", () => {
    const parsed = parseOwnTiers({
      tiers: [tier(), tier({ id: "t2", isActive: false }), { id: 5 }, null],
      platformFeePct: 10,
    });
    expect(parsed?.tiers.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(parsed?.tiers[1]?.isActive).toBe(false);
    expect(parsed?.platformFeePct).toBe(10);
    expect(parseOwnTiers({ tiers: "nope" })).toBeNull();
    expect(parseOwnTiers(null)).toBeNull();
  });

  it("list changes come only from server-confirmed rows; the net is the server's math", () => {
    const list = [tier(), tier({ id: "t2", name: "Silver" })];
    const edited = tier({ name: "Gold+" });
    expect(applyTierSave(list, edited, "t1").map((t) => t.name)).toEqual(["Gold+", "Silver"]);
    expect(applyTierSave(list, tier({ id: "t3", name: "New" }), null)).toHaveLength(3);
    expect(removeTier(list, "t1").map((t) => t.id)).toEqual(["t2"]);
    expect(savedTierDto({ tier: tier({ id: "t9" }) })?.id).toBe("t9");
    expect(savedTierDto({})).toBeNull();
    expect(tierNetCents(1000, 10)).toBe(900);
    expect(tierNetCents(999, 10)).toBe(899);
    expect(tierNetCents(500, 10)).toBe(450);
  });
});

describe("64 · the Creator Room store", () => {
  it("every catalog item lands on the rail that sells it", () => {
    expect(roomItemRail(roomItem())).toBe("market");
    expect(roomItemRail(roomItem({ kind: "track", productKind: null }))).toBe("store");
    expect(roomItemRail(roomItem({ kind: "video", productKind: null }))).toBe("store");
    expect(roomItemRail(roomItem({ kind: "product", productKind: "digital" }))).toBe("storefront");
    expect(roomItemRail(roomItem({ kind: "series", productKind: null }))).toBeNull();
  });

  it("the catalog parse drops unpriced/id-less rows and keeps pwyw minimums", () => {
    const items = parseRoomCatalog({
      items: [
        { id: "a", kind: "track", title: "Song", priceCents: 300, price: "$3.00", pwyw: { enabled: true, minCents: 100 } },
        { id: "", kind: "track", priceCents: 300 },
        { id: "b", kind: "track", priceCents: "300" },
        null,
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.pwyw).toEqual({ enabled: true, minCents: 100 });
    expect(parseRoomCatalog({})).toEqual([]);
    expect(parseRoomCatalog(null)).toEqual([]);
  });

  it("market products join the stand cart shape; non-market items never cart", () => {
    const products = roomMarketProducts([
      roomItem({ id: "m1" }),
      roomItem({ id: "s1", kind: "track", productKind: null }),
    ]);
    expect(products).toEqual([
      { id: "m1", name: "Thing", price_cents: 1999, description: null, image_url: null },
    ]);
  });

  it("the store payload honors name-your-price minimums, the page's rule", () => {
    const pwyw = roomItem({ kind: "track", productKind: null, pwyw: { enabled: true, minCents: 500 } });
    expect(storeCheckoutPayload(pwyw, "4.99").ok).toBe(false);
    expect(storeCheckoutPayload(pwyw, "5")).toEqual({ ok: true, body: { kind: "track", id: "i1", amountCents: 500 } });
    const fixed = roomItem({ kind: "video", productKind: null });
    expect(storeCheckoutPayload(fixed, "")).toEqual({ ok: true, body: { kind: "video", id: "i1" } });
  });

  it("the storefront payload clamps quantity like the rail does", () => {
    expect(storefrontCheckoutPayload(roomItem({ productKind: "digital" }), 3)).toEqual({ productId: "i1", quantity: 3 });
    expect(storefrontCheckoutPayload(roomItem({ productKind: "digital" }), 0).quantity).toBe(1);
    expect(storefrontCheckoutPayload(roomItem({ productKind: "digital" }), 500).quantity).toBe(99);
  });

  it("the room cart IS the shop cart when the creator runs that shop", () => {
    expect(roomCartKey("Gold-Shop", "some-slug")).toBe("bdv-cart-gold-shop");
    expect(roomCartKey(null, "some-slug")).toBe("bdv-cart-room-some-slug");
  });
});
