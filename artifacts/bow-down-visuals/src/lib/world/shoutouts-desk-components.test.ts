/**
 * shoutouts-desk-components — stack1500 world parity wave #4b
 * item 27 source-contract pins. The Shoutouts desk must sit at
 * the marketplace square ({ isLight, isGuest }) with:
 * - the board + request form in-panel on the seam's rails;
 * - the money moment in the house shape: embedded first via the
 *   shared EmbeddedSessionCheckout, the hosted page in a NEW TAB
 *   only as the fallback, verify-on-return from server truth;
 * - the flat-5% fee told honestly (the creator's side, never on
 *   top of the listed price);
 * - the member's own selling settings on the settings rail;
 * - no Visual Buc spend anywhere (the buy-side moves dollars via
 *   the checkout rail only);
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/ShoutoutsDesk.tsx");
const stands = read("../../components/world/native/ShopStands.tsx");
const route = read("../../../../api-server/src/routes/generate/shoutouts.ts");

describe("the square mount", () => {
  it("is a named square desk rooted at its testid, stacked at the marketplace", () => {
    expect(desk).toContain("export function ShoutoutsDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean })");
    expect(desk).toContain('data-testid="world-shoutouts-desk"');
    expect(stands).toContain('import { ShoutoutsDesk } from "./ShoutoutsDesk";');
    expect(stands).toContain("<ShoutoutsDesk isLight={isLight} isGuest={isGuest} />");
  });
});

describe("the board + the request form", () => {
  it("browses the public creators rail and composes on the seam's payload", () => {
    expect(desk).toContain("fetch(SHOUTOUTS_CREATORS_PATH");
    expect(desk).toContain("shoutoutCreatorsOfResponse");
    expect(desk).toContain("fetch(SHOUTOUTS_REQUESTS_PATH");
    expect(desk).toContain("buildShoutoutRequestPayload(selected.id, draft)");
    expect(desk).toContain("shoutoutRequestDraftReady(draft)");
    expect(desk).toContain('data-testid="world-shoutouts-form"');
  });

  it("a free request lands without touching checkout", () => {
    expect(desk).toContain("!made.paymentsLive || made.priceCents === 0");
    expect(desk).toContain("worldSponsorPress.soNoteSentOne"); // the "Request sent — …" note — via the catalog (unit 47)
    expect(desk).toContain("worldSponsorPress.soNoteSentOther");
  });
});

describe("the money moment — embedded first, new tab only as fallback", () => {
  it("asks embedded when a publishable key exists and mounts the shared checkout", () => {
    expect(desk).toContain("buildShoutoutCheckoutPayload(hasStripePublishableKey())");
    expect(desk).toContain("shoutoutEmbeddedSecret(coData)");
    expect(desk).toContain("<EmbeddedSessionCheckout clientSecret={buySecret} />");
    expect(desk).toContain('testId="world-shoutouts-embedded-checkout"');
  });

  it("the hosted URL opens in a new tab at the money moment, nowhere else", () => {
    expect(desk).toContain('window.open(url, "_blank", "noopener,noreferrer")');
    expect(desk).not.toContain("window.location");
  });

  it("verify-on-return reads the pending marker and trusts only the server's paid", () => {
    expect(desk).toContain("localStorage.getItem(SHOUTOUT_PENDING_KEY)");
    expect(desk).toContain("shoutoutVerifyPath(pending.requestId)");
    expect(desk).toContain("shoutoutVerifyConfirmed(data)");
    expect(desk).toContain('"focus"');
  });

  it("the route's own branches match the desk's reading (embedded secret / hosted URL / verify paid)", () => {
    expect(route).toContain('ui_mode: "embedded_page"');
    expect(route).toContain("clientSecret: session.client_secret");
    expect(route).toContain("res.json({ checkoutUrl: session.url })");
    expect(route).toContain("paid: true");
    expect(route).toContain("paid: false");
  });
});

describe("the fee + the settings section", () => {
  it("the desk quotes the flat 5% and the route charges the flat 5%", () => {
    expect(desk).toContain("SHOUTOUT_PLATFORM_FEE_PCT");
    expect(desk).toContain("comes out of the creator");
    expect(route).toContain("SHOUTOUT_PLATFORM_FEE_PCT");
    expect(route).toContain("|| 5");
  });

  it("settings load + save on the settings rail, guests get the honest sign-in line", () => {
    expect(desk).toContain("fetch(SHOUTOUTS_SETTINGS_PATH");
    expect(desk).toContain('method: "PUT"');
    expect(desk).toContain("buildShoutoutSettingsPayload(settingsDraft)");
    expect(desk).toContain('testId="world-shoutouts-settings"');
    expect(desk).toContain("isGuest");
  });

  it("no credit spend anywhere in the desk", () => {
    expect(desk).not.toContain("confirmedFetch");
    expect(desk).not.toContain("Visual Bucs");
    expect(desk).not.toContain("useConfirmedApi");
  });
});

describe("the honest states", () => {
  it("loading, empty, and failed-with-retry render as themselves", () => {
    expect(desk).toContain("NativeLoadingState");
    expect(desk).toContain("NativeEmptyState");
    expect(desk).toContain("NativeErrorState");
    expect(desk).toContain("worldSponsorPress.soEmptyMessage"); // "No creators are taking shoutout requests right now" — via the catalog (unit 47)
  });
});
