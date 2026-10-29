/**
 * embedded-payment-form-reachability.test.ts — stack600 JOIN rung C,
 * extending the checkout-mounts audit (stack600/checkout-mounts-audit)
 * to the mounts it flagged but did not pin.
 *
 * The drawer trap (Gate Pass 2, live, fixed in
 * stack600/checkout-drawer-scroll): a checkout sat in a NON-scrollable
 * region of a height-capped container, so at short viewports Pay was
 * unreachable. Ingredients: (1) a height-capped visible region,
 * (2) the checkout outside that region's scroller.
 *
 * EmbeddedPaymentForm differs from EmbeddedSessionCheckout: the
 * Stripe Payment Element renders in flow and the submit button is
 * OUR OWN button inside the same <form>, directly after the element.
 * The trap for this component = any capped/hidden-overflow ancestor
 * between the mount and its scroll root that could strand the form's
 * own submit button. All four mounts audited on the joined tree:
 *
 *  1. pages/pricing.tsx (credit packs) — SAFE, document scroll.
 *     Root `min-h-screen`; the mount sits in a pack card in page
 *     flow. Zero max-h / overflow-y in the file; the only two
 *     overflow-hidden are a fixed decorative background layer
 *     (pointer-events-none, not an ancestor) and an avatar image
 *     crop — neither wraps the form.
 *  2. pages/creator-pricing.tsx (plan subscribe) — SAFE, document
 *     scroll. Root `min-h-screen`; mount in a plain centred wrapper;
 *     the whole page carries ZERO overflow / max-h classes.
 *  3. world/native/PacksDesk.tsx — SAFE, station-sheet scroll.
 *     Zero overflow / max-h in the desk; StationPanel dispatches it
 *     inside the sheet whose root is the one scroll region
 *     (max-h-[86dvh] + overflow-y-auto + overscroll-contain) — the
 *     same contract the mounts audit pinned for ShopStands.
 *  4. world/native/PlansDesk.tsx — SAFE, station-sheet scroll.
 *     Zero overflow / max-h in the desk; it renders inside
 *     EarningsBoard (also zero overflow / max-h), which StationPanel
 *     renders inside the same sheet.
 *
 * The shared component itself is innocent: a plain
 * `w-full rounded-2xl border p-4` panel, no height cap, no overflow
 * anywhere in EmbeddedCheckout.tsx. These pins freeze the audited
 * shapes — if a mount is ever moved into a capped container, the
 * mount must be re-audited against the drawer contract (one scroll
 * region containing the whole form, submit button included).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const checkoutSrc = readFileSync(join(__dirname, "EmbeddedCheckout.tsx"), "utf8");
const pricingSrc = readFileSync(join(__dirname, "../../pages/pricing.tsx"), "utf8");
const creatorPricingSrc = readFileSync(join(__dirname, "../../pages/creator-pricing.tsx"), "utf8");
const packsDeskSrc = readFileSync(join(__dirname, "../world/native/PacksDesk.tsx"), "utf8");
const plansDeskSrc = readFileSync(join(__dirname, "../world/native/PlansDesk.tsx"), "utf8");
const earningsBoardSrc = readFileSync(
  join(__dirname, "../world/native/boards/EarningsBoard.tsx"),
  "utf8",
);
const stationPanelSrc = readFileSync(join(__dirname, "../world/StationPanel.tsx"), "utf8");

describe("EmbeddedPaymentForm — shared component shape", () => {
  it("mounts in a plain uncapped panel; the file carries no overflow or height cap at all", () => {
    expect(checkoutSrc).toContain('data-testid="embedded-payment-panel"');
    expect(checkoutSrc).not.toContain("overflow");
    expect(checkoutSrc).not.toContain("max-h");
  });

  it("renders the submit button inside the same in-flow form, after the PaymentElement", () => {
    const form = checkoutSrc.indexOf('data-testid="embedded-payment-form"');
    const element = checkoutSrc.indexOf("<PaymentElement");
    const submit = checkoutSrc.indexOf('type="submit"', element);
    expect(form).toBeGreaterThan(-1);
    expect(element).toBeGreaterThan(form);
    expect(submit).toBeGreaterThan(element);
  });
});

describe("EmbeddedPaymentForm — pricing.tsx credit packs (document scroll)", () => {
  it("mounts the form and the page root is an uncapped min-h-screen", () => {
    expect(pricingSrc).toContain("<EmbeddedPaymentForm");
    expect(pricingSrc).toContain('<div className="min-h-screen text-white lux-page">');
  });

  it("has no height cap and no vertical-overflow control anywhere (audited zeros)", () => {
    expect(pricingSrc).not.toContain("max-h");
    expect(pricingSrc).not.toContain("overflow-y");
  });

  it("the only overflow-hidden in the file are the two known non-ancestors", () => {
    /* The fixed decorative background layer (pointer-events-none,
       a sibling behind the content) and the round avatar crop.
       Neither wraps the pack cards; pin both so a third
       overflow-hidden cannot arrive unreviewed. */
    expect(pricingSrc.match(/overflow-hidden/g)).toHaveLength(2);
    expect(pricingSrc).toContain("fixed inset-0 pointer-events-none z-0 overflow-hidden");
    expect(pricingSrc).toContain("h-28 w-28 overflow-hidden rounded-full");
  });
});

describe("EmbeddedPaymentForm — creator-pricing.tsx plan subscribe (document scroll)", () => {
  it("mounts the form in a plain centred flow wrapper under a min-h-screen root", () => {
    const mount = creatorPricingSrc.indexOf("<EmbeddedPaymentForm");
    expect(mount).toBeGreaterThan(-1);
    const before = creatorPricingSrc.slice(Math.max(0, mount - 400), mount);
    expect(before).toContain('<div className="mx-auto mt-6 max-w-md">');
    expect(creatorPricingSrc).toContain('<div className="min-h-screen bg-black text-white">');
  });

  it("the whole page carries no overflow or height-cap classes (audited zeros)", () => {
    expect(creatorPricingSrc).not.toContain("overflow");
    expect(creatorPricingSrc).not.toContain("max-h-");
  });
});

describe("EmbeddedPaymentForm — World PacksDesk (station-sheet scroll)", () => {
  it("mounts the form in its labelled in-desk wrapper", () => {
    const mount = packsDeskSrc.indexOf("<EmbeddedPaymentForm");
    expect(mount).toBeGreaterThan(-1);
    const before = packsDeskSrc.slice(Math.max(0, mount - 400), mount);
    expect(before).toContain('data-testid="world-packs-embedded"');
  });

  it("the desk carries no overflow or height cap of its own (audited zeros)", () => {
    expect(packsDeskSrc).not.toContain("overflow");
    expect(packsDeskSrc).not.toContain("max-h");
  });

  it("StationPanel dispatches the desk inside the one-scroll-region sheet", () => {
    expect(stationPanelSrc).toContain("return <PacksDesk isLight={isLight} />;");
    expect(stationPanelSrc).toContain("max-h-[86dvh]");
    expect(stationPanelSrc).toContain("overflow-y-auto");
    expect(stationPanelSrc).toContain("overscroll-contain");
  });
});

describe("EmbeddedPaymentForm — World PlansDesk (station-sheet scroll)", () => {
  it("mounts the form in its labelled in-desk wrapper", () => {
    const mount = plansDeskSrc.indexOf("<EmbeddedPaymentForm");
    expect(mount).toBeGreaterThan(-1);
    const before = plansDeskSrc.slice(Math.max(0, mount - 400), mount);
    expect(before).toContain('data-testid="world-plans-embedded"');
  });

  it("the desk carries no overflow or height cap of its own (audited zeros)", () => {
    expect(plansDeskSrc).not.toContain("overflow");
    expect(plansDeskSrc).not.toContain("max-h");
  });

  it("rides to the sheet through EarningsBoard, which is also trap-free", () => {
    expect(earningsBoardSrc).toContain("<PlansDesk isLight={isLight} />");
    expect(earningsBoardSrc).not.toContain("overflow");
    expect(earningsBoardSrc).not.toContain("max-h");
    expect(stationPanelSrc).toContain("<EarningsBoard isLight={isLight} isGuest={isGuest} />");
  });
});
