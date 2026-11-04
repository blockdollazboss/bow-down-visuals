/**
 * shoutouts-desk — stack1500 world parity wave #4b item 27 pins.
 *
 * The Shoutouts desk is the marketplace's buy-side native form.
 * These pins hold: the creators guard reads the rail's exact row
 * shape and drops drift; money-moment payment truth never comes
 * from the creators list's rail-level `paymentsLive` flag (the
 * desk takes it from the request + checkout + verify answers); the
 * checkout outcome helpers read the rail's own branches
 * (clientSecret vs checkoutUrl); the payload builders mirror the
 * route schemas' bounds; the fee is the flat 5% the route charges,
 * out of the creator's side.
 */
import { describe, expect, it } from "vitest";
import {
  SHOUTOUTS_CREATORS_PATH,
  SHOUTOUTS_SETTINGS_PATH,
  SHOUTOUT_PENDING_KEY,
  SHOUTOUT_PLATFORM_FEE_PCT,
  buildShoutoutCheckoutPayload,
  buildShoutoutRequestPayload,
  buildShoutoutSettingsPayload,
  buildShoutoutVerifyPayload,
  parseShoutoutPending,
  shoutoutCheckoutPath,
  shoutoutCreatorsOfResponse,
  shoutoutEmbeddedSecret,
  shoutoutHostedUrl,
  shoutoutRequestDraftReady,
  shoutoutRequestOfResponse,
  shoutoutSessionId,
  shoutoutSettingsDraftOf,
  shoutoutSettingsDraftReady,
  shoutoutSettingsOfResponse,
  shoutoutVerifyConfirmed,
  shoutoutVerifyPath,
} from "./shoutouts-desk";

const CREATORS = {
  creators: [
    { id: "s1", displayName: "Thy Cheat Code", priceDollars: 25, turnaroundDays: 3, guidelines: "Family friendly only." },
    { id: "s2", displayName: "Free Friend", priceDollars: 0, turnaroundDays: 7, guidelines: "" },
    { id: "", displayName: "No Id", priceDollars: 10, turnaroundDays: 2, guidelines: "" },
    { id: "s4", displayName: "Drifty", priceDollars: "10", turnaroundDays: 2, guidelines: "" },
    "not-a-row",
  ],
  /* The rail-level flag the desk must never read money-moment
     payment truth from (its value is ignored either way). */
  paymentsLive: false,
};

describe("the creators guard — the rail's row shape", () => {
  it("reads the board and drops drifted rows", () => {
    const creators = shoutoutCreatorsOfResponse(CREATORS)!;
    expect(creators.map((c) => c.id)).toEqual(["s1", "s2"]);
    expect(creators[0]).toMatchObject({ displayName: "Thy Cheat Code", priceDollars: 25, turnaroundDays: 3 });
    expect(creators[1]!.priceDollars).toBe(0);
  });

  it("a non-state body is failure, never an empty board", () => {
    expect(shoutoutCreatorsOfResponse({})).toBeNull();
    expect(shoutoutCreatorsOfResponse(null)).toBeNull();
    expect(shoutoutCreatorsOfResponse({ creators: "all" })).toBeNull();
  });

  it("the paths are the rails' own", () => {
    expect(SHOUTOUTS_CREATORS_PATH).toBe("/api/shoutouts/creators");
    expect(SHOUTOUTS_SETTINGS_PATH).toBe("/api/shoutouts/settings");
    expect(shoutoutCheckoutPath("r 1")).toBe("/api/shoutouts/requests/r%201/checkout");
    expect(shoutoutVerifyPath("r1")).toBe("/api/shoutouts/requests/r1/checkout/verify");
  });
});

describe("the fee — flat 5%, the creator's side", () => {
  it("pins the route's SHOUTOUT_PLATFORM_FEE_PCT default", () => {
    expect(SHOUTOUT_PLATFORM_FEE_PCT).toBe(5);
  });
});

describe("the request answer — payment truth from the answer, not the list flag", () => {
  it("a priced request reads paymentsLive from its own answer", () => {
    const made = shoutoutRequestOfResponse({
      request: { id: "r1", status: "pending_payment", priceCents: 2500, priceDollars: 25 },
      paymentsLive: true,
    })!;
    expect(made).toMatchObject({ id: "r1", priceCents: 2500, paymentsLive: true });
  });

  it("a free request answers paymentsLive false and skips checkout", () => {
    const made = shoutoutRequestOfResponse({
      request: { id: "r2", status: "pending_payment", priceCents: 0, priceDollars: 0 },
      paymentsLive: false,
    })!;
    expect(made.priceCents).toBe(0);
    expect(made.paymentsLive).toBe(false);
  });

  it("a request-less answer is failure", () => {
    expect(shoutoutRequestOfResponse({ paymentsLive: true })).toBeNull();
    expect(shoutoutRequestOfResponse(null)).toBeNull();
  });
});

describe("the checkout outcome — the rail's branches", () => {
  it("embedded answers carry the secret + session, hosted answers the URL", () => {
    const embedded = { checkoutUrl: null, clientSecret: "cs_1", uiMode: "embedded", sessionId: "sess_1" };
    expect(shoutoutEmbeddedSecret(embedded)).toBe("cs_1");
    expect(shoutoutHostedUrl(embedded)).toBeNull();
    expect(shoutoutSessionId(embedded)).toBe("sess_1");
    const hosted = { checkoutUrl: "https://checkout.stripe.com/c/pay/cs_2" };
    expect(shoutoutEmbeddedSecret(hosted)).toBeNull();
    expect(shoutoutHostedUrl(hosted)).toContain("checkout.stripe.com");
    expect(shoutoutSessionId(hosted)).toBeNull();
  });

  it("verify counts only when the server says paid", () => {
    expect(shoutoutVerifyConfirmed({ status: "accepted", paid: true })).toBe(true);
    expect(shoutoutVerifyConfirmed({ status: "pending_payment", paid: false })).toBe(false);
    expect(shoutoutVerifyConfirmed({})).toBe(false);
  });

  it("the checkout ask is embedded-first, the verify body is the session id", () => {
    expect(buildShoutoutCheckoutPayload(true)).toEqual({ uiMode: "embedded" });
    expect(buildShoutoutCheckoutPayload(false)).toEqual({});
    expect(buildShoutoutVerifyPayload("sess_1")).toEqual({ sessionId: "sess_1" });
  });

  it("the pending marker round-trips and refuses drift", () => {
    const raw = JSON.stringify({ requestId: "r1", sessionId: "sess_1" });
    expect(parseShoutoutPending(raw)).toEqual({ requestId: "r1", sessionId: "sess_1" });
    expect(parseShoutoutPending(null)).toBeNull();
    expect(parseShoutoutPending("{nope")).toBeNull();
    expect(parseShoutoutPending(JSON.stringify({ requestId: "r1" }))).toBeNull();
    expect(SHOUTOUT_PENDING_KEY).toContain("shoutout");
  });
});

describe("the payload builders — the route schemas' bounds", () => {
  it("the request payload trims and omits an empty email", () => {
    expect(
      buildShoutoutRequestPayload("s1", { fanName: " Jo ", fanEmail: " ", occasion: " Birthday ", message: " Say hi " }),
    ).toEqual({ creatorId: "s1", fanName: "Jo", fanEmail: undefined, occasion: "Birthday", message: "Say hi" });
    expect(
      buildShoutoutRequestPayload("s1", { fanName: "Jo", fanEmail: "jo@x.com", occasion: "Birthday", message: "Hi" }).fanEmail,
    ).toBe("jo@x.com");
  });

  it("draft readiness mirrors the request schema", () => {
    const ok = { fanName: "Jo", fanEmail: "", occasion: "Birthday", message: "Say hi" };
    expect(shoutoutRequestDraftReady(ok)).toBe(true);
    expect(shoutoutRequestDraftReady({ ...ok, fanName: " " })).toBe(false);
    expect(shoutoutRequestDraftReady({ ...ok, message: "" })).toBe(false);
    expect(shoutoutRequestDraftReady({ ...ok, fanEmail: "not-an-email" })).toBe(false);
    expect(shoutoutRequestDraftReady({ ...ok, fanEmail: "jo@x.com" })).toBe(true);
    expect(shoutoutRequestDraftReady({ ...ok, occasion: "x".repeat(121) })).toBe(false);
  });

  it("settings payload + readiness mirror the settings schema", () => {
    const draft = { displayName: " Thy ", priceDollars: "25.5", turnaroundDays: "3", guidelines: " Be kind ", accepting: true };
    expect(buildShoutoutSettingsPayload(draft)).toEqual({
      displayName: "Thy",
      priceDollars: 25.5,
      turnaroundDays: 3,
      guidelines: "Be kind",
      accepting: true,
    });
    expect(shoutoutSettingsDraftReady(draft)).toBe(true);
    expect(shoutoutSettingsDraftReady({ ...draft, priceDollars: "1000" })).toBe(false);
    expect(shoutoutSettingsDraftReady({ ...draft, priceDollars: "-1" })).toBe(false);
    expect(shoutoutSettingsDraftReady({ ...draft, turnaroundDays: "0" })).toBe(false);
    expect(shoutoutSettingsDraftReady({ ...draft, turnaroundDays: "2.5" })).toBe(false);
    expect(shoutoutSettingsDraftReady({ ...draft, displayName: "" })).toBe(false);
  });

  it("the settings guard reads null as not-selling and drift as failure", () => {
    expect(shoutoutSettingsOfResponse({ settings: null })).toBeNull();
    expect(shoutoutSettingsOfResponse({})).toBeUndefined();
    const s = shoutoutSettingsOfResponse({
      settings: { id: "s1", displayName: "Thy", priceDollars: 25, priceCents: 2500, turnaroundDays: 3, guidelines: "", accepting: true },
    })!;
    expect(s).toMatchObject({ id: "s1", priceCents: 2500, accepting: true });
    expect(shoutoutSettingsDraftOf(s)).toMatchObject({ displayName: "Thy", priceDollars: "25", turnaroundDays: "3" });
    expect(shoutoutSettingsDraftOf(null).accepting).toBe(true);
  });
});
