/**
 * store-buy-checkout-reachability.test.ts — stack600 checkout-mounts audit.
 *
 * Gate Pass 2 (Oct 28, live) proved the drawer trap in shop.tsx: the
 * embedded Stripe checkout sat in a NON-scrollable region of a
 * height-capped fixed drawer, so at short viewports the Pay button
 * was unreachable (fixed in stack600/checkout-drawer-scroll by making
 * the drawer ONE scroll region). This lane audited every remaining
 * EmbeddedSessionCheckout mount for the same trap.
 *
 * VERDICT for /store/buy/:kind/:id — SAFE, by structure. The mount is
 * NOT in a drawer, sheet or modal: it renders in plain document flow
 * on a `min-h-screen` page, inside an auto-height card. The document
 * itself is the scroll region, so the Stripe iframe (which renders
 * at its full content height, ~700–950 px) simply lengthens the
 * page and Pay is reachable at document-scroll bottom at ANY
 * viewport height (480 px and 600 px included — the guarantee is
 * structural and does not depend on the iframe's height at all).
 *
 * These pins freeze the audited shape. The trap returns if anyone:
 *  - caps this page's height (max-h-*, h-dvh, h-svh) without giving
 *    the checkout a scroll region of its own;
 *  - wraps the mount in an overflow-y-auto / overflow-y-hidden box
 *    that is not itself guaranteed to scroll to the iframe's bottom;
 *  - changes the app shell so the document stops scrolling
 *    (AuthedLayout's <main> must stay an unconstrained flex child,
 *    and index.css must never lock the vertical axis on html/body).
 * The single `overflow-hidden` in the page is the decorative product
 * card (rounded corners clip the artwork); its height is
 * content-driven, so it cannot clip the checkout below it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pageSrc = readFileSync(join(__dirname, "store-buy.tsx"), "utf8");
const appSrc = readFileSync(join(__dirname, "../App.tsx"), "utf8");
const cssSrc = readFileSync(join(__dirname, "../index.css"), "utf8");

describe("store-buy page — checkout reachability (stack600 audit)", () => {
  it("mounts the shared embedded checkout in plain page flow", () => {
    const mount = pageSrc.indexOf("<EmbeddedSessionCheckout clientSecret={embeddedSecret} />");
    expect(mount).toBeGreaterThan(-1);
    /* The mount's wrapper is a plain flow div — no positioning, no
       height, no overflow of its own. */
    const before = pageSrc.slice(Math.max(0, mount - 200), mount);
    expect(before).toContain('<div className="mt-6">');
  });

  it("the page root grows with its content (min-h-screen, never capped)", () => {
    expect(pageSrc).toContain('<div className="min-h-screen bg-black text-white">');
  });

  it("no height-capped or scroll-trapping container exists anywhere in the page", () => {
    /* A cap is half the trap; a non-scrolling capped region is the
       whole trap. None may appear on this page without re-auditing
       the mount against the drawer contract. */
    expect(pageSrc).not.toContain("max-h-");
    expect(pageSrc).not.toContain("h-dvh");
    expect(pageSrc).not.toContain("h-svh");
    expect(pageSrc).not.toContain("overflow-y-auto");
    expect(pageSrc).not.toContain("overflow-y-hidden");
    expect(pageSrc).not.toContain("overflow-y-scroll");
  });

  it("the only overflow-hidden is the decorative auto-height product card", () => {
    expect(pageSrc.split("overflow-hidden").length - 1).toBe(1);
    const card = pageSrc.slice(pageSrc.indexOf("overflow-hidden") - 40, pageSrc.indexOf("overflow-hidden") + 40);
    expect(card).toContain("rounded-2xl");
  });

  it("the app shell keeps the document as the scroll region", () => {
    /* StoreBuy renders inside AuthedLayout: a min-h-svh flex row and
       an unconstrained <main>. If either gains a height cap or an
       overflow lock, every in-flow page mount inherits the trap. */
    expect(appSrc).toContain('className="flex min-h-svh w-full"');
    expect(appSrc).toContain('<main className="min-w-0 flex-1 relative">');
    /* Global CSS locks only the horizontal axis (clip, so sticky
       keeps working); the vertical axis must stay free. */
    expect(cssSrc).toContain("overflow-x: clip");
    expect(cssSrc).not.toContain("overflow-y: hidden");
    expect(cssSrc).not.toContain("overflow-y: clip");
  });
});
