/**
 * storefront-office-hours-wiring.test.ts — stack1300 #167: source
 * contracts for the Office Hours 2D door.
 *
 * What this family protects: the server rail (VB-priced slots + book
 * endpoint + Messages door) shipped with NO front-end door at all,
 * and the two old doors actively mishandled the shape — the product
 * page read priceCents 0 as "FREE, claim it by email" and the
 * dashboard read it as "FREE / Lead magnet". These pins keep:
 *  - the buyer panel wired to the rail's slots read + book endpoint,
 *    taking precedence over the free claim, with failure ≠ empty;
 *  - the seller create + row editors writing the rail's exact
 *    service_details shape (flag, VB price, booking on, weekly grid),
 *    with the row price cell telling the VB truth;
 *  - the API client carrying the two rail calls and nothing else new.
 * Behavior is pinned separately: lib/office-hours.test.ts (pure
 * helpers), the api-server storefront-office-hours-door suite (the
 * claim/checkout refusals + the book contract), and the locale split
 * lane in lib/locale-completeness.test.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const productPage = read("pages/storefront-product.tsx");
const dashboard = read("pages/store-dashboard.tsx");
const storefrontApi = read("lib/storefront-api.ts");

/* The OfficeHoursPanel body only — the page also mentions the shape
   in comments and the chain that mounts it. */
const panelStart = productPage.indexOf("function OfficeHoursPanel(");
const panelEnd = productPage.indexOf("export default function StorefrontProduct()", panelStart);
const panel = productPage.slice(panelStart, panelEnd);

describe("office hours — API client (lib/storefront-api.ts)", () => {
  it("reads the rail's slots endpoint and posts to its book endpoint", () => {
    expect(storefrontApi).toContain("export const getProductSlots");
    expect(storefrontApi).toContain("`/product/${id}/slots`");
    expect(storefrontApi).toContain("export const bookOfficeHours");
    expect(storefrontApi).toContain("`/product/${id}/office-hours/book`");
  });

  it("carries the rail's availability shape on ServiceDetails", () => {
    expect(storefrontApi).toContain("availability?: BookingAvailabilityDTO");
    expect(storefrontApi).toContain("messagesUrl: string");
  });
});

describe("office hours — buyer panel (storefront-product.tsx)", () => {
  it("is a named, findable panel with pickable slots", () => {
    expect(panel).toContain('data-testid="office-hours-panel"');
    expect(panel).toContain('data-testid="office-hours-slot"');
  });

  it("loads times from the rail and books through it — never claim, never checkout", () => {
    expect(panel).toContain("getProductSlots(productId)");
    expect(panel).toContain("bookOfficeHours(token, productId, selected, viewerTz)");
    expect(panel).not.toContain("claimProduct");
    expect(panel).not.toContain("checkout");
  });

  it("failure is its own state with a working Retry — not the empty state", () => {
    expect(panel).toContain('t("officeHours.loadError"');
    expect(panel).toContain('t("common.retry"');
    expect(panel).toContain("setRetryTick((n) => n + 1)");
    /* The genuine-empty copy is a different string in a different branch. */
    expect(panel).toContain('t("officeHours.noTimesTitle"');
  });

  it("the booked card hands the buyer the rail's Messages door + balance truth", () => {
    expect(panel).toContain("booked.messagesUrl");
    expect(panel).toContain('t("officeHours.balanceAfterLine"');
    expect(panel).toContain('t("officeHours.bookButton"');
  });

  it("guests get the sign-in door back to this page, members get the book button", () => {
    expect(panel).toContain("loginPathWithNext(location, search)");
    expect(panel).toContain('t("officeHours.signInToBook"');
  });

  it("the panel takes the action slot BEFORE the free claim, and the price box leads with the VB price", () => {
    expect(productPage).toContain("isDropUpcoming ? null : isOfficeHours ? (");
    const chainIdx = productPage.indexOf("isDropUpcoming ? null : isOfficeHours ? (");
    const claimIdx = productPage.indexOf(") : isFree ? (", chainIdx);
    expect(claimIdx).toBeGreaterThan(chainIdx);
    expect(productPage).toContain("officeHoursPriceVb(data.product.serviceDetails)");
    const priceBoxIdx = productPage.indexOf('isOfficeHours ? (\n                      <span className="text-3xl font-bold text-amber-300">{t("officeHours.priceLine"');
    expect(priceBoxIdx).toBeGreaterThan(0);
  });

  it("a failed booking reloads the grid instead of leaving a stale pick", () => {
    const bookFn = panel.slice(panel.indexOf("async function book()"));
    expect(bookFn).toContain("setSelected(null)");
    expect(bookFn).toContain("setRetryTick((n) => n + 1)");
  });
});

/* ProductsTab body only (create form + product rows live there). */
const tabStart = dashboard.indexOf("function ProductsTab(");
const tabEnd = dashboard.indexOf("/* ── Orders tab", tabStart);
const tab = dashboard.slice(tabStart, tabEnd);

describe("office hours — seller door (store-dashboard.tsx ProductsTab)", () => {
  it("one shared availability editor serves both the create form and the row editor", () => {
    expect(dashboard).toContain("function AvailabilityWindowsEditor(");
    expect(tab.match(/<AvailabilityWindowsEditor/g)).toHaveLength(2);
  });

  it("create writes the rail's exact shape and prices the listing in VB only", () => {
    expect(tab).toContain("office_hours: true");
    expect(tab).toContain("price_vb: Number(form.ohPriceVb)");
    expect(tab).toContain("booking_enabled: true");
    expect(tab).toContain("availability: availabilityFromForm(ohAvailability) ?? undefined");
    expect(tab).toContain('priceCents: ohOn || form.kind === "gift_card" ? 0 : cents');
  });

  it("create validates duration, VB price and grid before anything is sent", () => {
    expect(tab).toContain('t("officeHours.needDuration"');
    expect(tab).toContain('t("officeHours.needPrice"');
    expect(tab).toContain('t("officeHours.needAvailability"');
    expect(tab).toContain("if (!availabilityFromForm(ohAvailability))");
  });

  it("the row editor PATCHes the full merged service_details (wholesale-replace safe)", () => {
    expect(tab).toContain("const base: ServiceDetails = { ...(p.serviceDetails ?? {}) }");
    expect(tab).toContain("merged = { ...base, office_hours: false }");
    expect(tab).toContain("merged = { ...base, duration_min: dur, office_hours: true, price_vb: vb, booking_enabled: true, availability }");
    expect(tab).toContain("updateProduct(token, p.id, { serviceDetails: merged } as Partial<CreateProductInput>)");
  });

  it("the row editor seeds from the product's stored service_details", () => {
    expect(tab).toContain("availabilityFormFrom(sd?.availability, browserTimeZone())");
    expect(tab).toContain("setOhEnabled(isOfficeHoursFlagged(sd))");
  });

  it("the price cell tells the VB truth for Office Hours rows — never FREE / Lead magnet", () => {
    const ohCell = tab.indexOf("isOfficeHoursFlagged(p.serviceDetails) ? (");
    const freeCell = tab.indexOf('p.priceCents === 0 ? (', ohCell);
    expect(ohCell).toBeGreaterThan(0);
    expect(freeCell).toBeGreaterThan(ohCell);
    expect(tab).toContain('t("officeHours.rowBadge"');
  });

  it("only service rows get the Office Hours toggle", () => {
    expect(tab).toContain('p.kind === "service" && (');
    expect(tab).toContain('t("officeHours.editButton"');
  });
});
