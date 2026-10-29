/**
 * world-parity-lane06 — stack800 Lane 6 source-contract pins:
 * no new tabs at the money moment.
 *
 * - CreatorRooms' room store: all three buy rails (Marketplace
 *   cart, profile-store tracks/videos, storefront products) ask
 *   their checkout endpoints for the embedded presentation and
 *   mount the shared EmbeddedSessionCheckout INSIDE the panel
 *   when the server answers a clientSecret. The hosted new tab
 *   survives ONLY as the no-publishable-key / hosted-answer
 *   fallback, behind the clientSecret branch in every function.
 * - The World notifications bell: a website target now navigates
 *   in-app through the site's own router — window.open is gone
 *   from the file entirely. In-world targets (groups desk, Post
 *   Office) still open their stations in-world.
 * - ShopStands' Marketplace cart: PINNED as the already-landed
 *   reference state (JOIN2) so it cannot silently regress to
 *   tab-first.
 *
 * Deliberately NOT pinned here: BeatsDesk licensing,
 * PortraitTip tipping, and ShopStands' Branding + Crowns stands.
 * Their server rails cannot issue an embedded clientSecret
 * today (beats + memberships ride the hosted-only shared
 * createPaymentCheckout; branding-shop and tip-jar checkout
 * create hosted-only sessions), so their money moments remain
 * the marked transfer — pinned as such in
 * money-desks-components / money-desks-2-components — until the
 * rails gain an embedded mode. See stack800-lane06-report.md.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const rooms = read("../../components/world/native/CreatorRooms.tsx");
const stands = read("../../components/world/native/ShopStands.tsx");
const bell = read("../../components/world/WorldNotificationsBell.tsx");

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("lane 6 — CreatorRooms: the room store pays in the room", () => {
  it("mounts the shared embedded session checkout in the panel", () => {
    expect(rooms).toContain('from "@/components/checkout/EmbeddedCheckout"');
    expect(rooms).toContain("EmbeddedSessionCheckout, hasStripePublishableKey");
    expect(rooms).toContain("<EmbeddedSessionCheckout clientSecret={embeddedSecret} />");
    expect(rooms).toContain('data-testid="world-room-store-embedded-checkout"');
  });

  it("asks all three buy rails for the embedded presentation", () => {
    /* cart (storefronts) + single store + single storefront. */
    expect(count(rooms, 'uiMode: hasStripePublishableKey() ? "embedded" : undefined')).toBe(3);
    expect(count(rooms, "setEmbeddedSecret(data.clientSecret)")).toBe(3);
  });

  it("cart checkout: the clientSecret branch lands before the tab fallback", () => {
    const slice = rooms.slice(rooms.indexOf("const checkoutCart"), rooms.indexOf("const buySingle"));
    expect(slice).toContain('fetch("/api/storefronts/checkout"');
    expect(slice.indexOf("data.clientSecret")).toBeGreaterThan(-1);
    expect(slice.indexOf("data.clientSecret")).toBeLessThan(slice.indexOf("openCheckoutTab(url)"));
    /* the pending session is stashed so verify-on-return settles it */
    expect(slice).toContain("marketPendingKey(handle), data.sessionId");
  });

  it("single buys: both rails check clientSecret before any tab opens", () => {
    const slice = rooms.slice(rooms.indexOf("const buySingle"), rooms.indexOf("const mutedCls"));
    expect(count(slice, 'typeof data.clientSecret === "string"')).toBe(2);
    expect(count(slice, "openCheckoutTab(url)")).toBe(2);
    expect(slice.indexOf("data.clientSecret")).toBeLessThan(slice.indexOf("openCheckoutTab(url)"));
    expect(slice.lastIndexOf("data.clientSecret")).toBeLessThan(slice.lastIndexOf("openCheckoutTab(url)"));
    /* the store rail's gift-card full-payment answer completes in-world */
    expect(slice).toContain("data.paid === true");
  });

  it("keeps the hosted tab ONLY as the fallback seam", () => {
    expect(rooms).toContain("function openCheckoutTab(url: string)");
    expect(rooms).toContain('window.open(url, "_blank", "noopener,noreferrer")');
    expect(rooms).not.toContain("window.location.href = ");
    /* the panel's own footer no longer promises a new tab */
    expect(rooms).not.toContain("Buying finishes at the hosted checkout, in a new tab");
    expect(rooms).toContain("Buying finishes right here in the room");
  });
});

describe("lane 6 — the World bell never spawns a tab", () => {
  it("website targets navigate in-app via the router", () => {
    expect(bell).not.toContain("window.open");
    expect(bell).not.toContain('"_blank"');
    expect(bell).toContain('import { useLocation } from "wouter"');
    expect(bell).toContain("setLocation(target.href)");
    expect(bell).not.toContain("Opens on the website ↗");
  });

  it("in-world targets still open their stations in-world", () => {
    expect(bell).toContain("prepareNotificationNavigation(target, window.sessionStorage)");
    expect(bell).toContain("onOpenStation(stationId)");
  });
});

describe("lane 6 — ShopStands Marketplace cart stays embedded-first (JOIN2 state)", () => {
  it("the cart checkout mounts the embedded session before any tab fallback", () => {
    const fetchAt = stands.indexOf('fetch("/api/storefronts/checkout"');
    expect(fetchAt).toBeGreaterThan(-1);
    const secretAt = stands.indexOf("setEmbeddedSecret(data.clientSecret)", fetchAt);
    const tabAt = stands.indexOf("openCheckoutTab(url)", fetchAt);
    expect(secretAt).toBeGreaterThan(fetchAt);
    expect(tabAt).toBeGreaterThan(secretAt);
    expect(stands).toContain("<EmbeddedSessionCheckout clientSecret={embeddedSecret} />");
    expect(stands).toContain('data-testid="world-shop-embedded-checkout"');
  });
});
