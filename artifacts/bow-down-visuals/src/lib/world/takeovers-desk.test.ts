/**
 * takeovers-desk — stack1500 world parity wave #3 item 33
 * pins. The Takeovers desk is the two placements' native
 * form. These pins hold: both families are FREE (no registry
 * rows — these are inquiry rails, not purchases); the offer
 * guard reads the db constants' shape (name, priceDollars,
 * durationDays, surfaces, specs) and refuses a partial
 * offer; the inquiry builder mirrors the shared schema
 * (name 1–200, a valid email ≤320, a real video URL ≤2000,
 * the target link optional but a URL when present); the
 * success guard needs the rail's exact { success: true }.
 */
import { describe, expect, it } from "vitest";
import {
  LOADING_INQUIRE_PATH,
  SPOTLIGHT_INQUIRE_PATH,
  TAKEOVERS_FREE,
  buildTakeoverInquiryPayload,
  takeoverInquiryOk,
  takeoverOfferOf,
  type TakeoverInquiryForm,
} from "./takeovers-desk";

const OFFER = {
  offer: {
    name: "Spotlight Takeover",
    priceDollars: 1000,
    durationDays: 7,
    surfaces: ["Sign-in screen", "Sign-up screen"],
    specs: ["Full-screen muted looping video background", "1080p MP4, up to 30 seconds"],
  },
};

const FORM: TakeoverInquiryForm = {
  name: "Big Brand",
  email: "ads@brand.com",
  videoUrl: "https://cdn.brand.com/spot.mp4",
  targetUrl: "",
};

describe("free inquiry rails", () => {
  it("no registry rows exist for either family", () => {
    expect(TAKEOVERS_FREE).toBe(true);
    expect(SPOTLIGHT_INQUIRE_PATH).toBe("/api/spotlight/inquire");
    expect(LOADING_INQUIRE_PATH).toBe("/api/loading-screen/inquire");
  });
});

describe("the offer guard", () => {
  it("reads the offer whole; a partial offer is refused", () => {
    expect(takeoverOfferOf(OFFER)).toEqual(OFFER.offer);
    expect(takeoverOfferOf({ offer: { name: "X" } })).toBeNull();
    expect(takeoverOfferOf({})).toBeNull();
    expect(takeoverOfferOf(null)).toBeNull();
  });
});

describe("the inquiry builder — the shared schema mirrored", () => {
  it("a good form builds the body; the optional link rides only when given", () => {
    expect(buildTakeoverInquiryPayload(FORM)).toEqual({
      name: "Big Brand",
      email: "ads@brand.com",
      videoUrl: "https://cdn.brand.com/spot.mp4",
    });
    expect(buildTakeoverInquiryPayload({ ...FORM, targetUrl: "https://brand.com" })?.targetUrl).toBe("https://brand.com");
  });

  it("bad inputs are refused in-desk", () => {
    expect(buildTakeoverInquiryPayload({ ...FORM, name: " " })).toBeNull();
    expect(buildTakeoverInquiryPayload({ ...FORM, email: "not-an-email" })).toBeNull();
    expect(buildTakeoverInquiryPayload({ ...FORM, videoUrl: "brand.com/spot.mp4" })).toBeNull();
    expect(buildTakeoverInquiryPayload({ ...FORM, targetUrl: "also-not-a-url" })).toBeNull();
  });

  it("success needs the rail's exact answer", () => {
    expect(takeoverInquiryOk({ success: true })).toBe(true);
    expect(takeoverInquiryOk({ success: false })).toBe(false);
    expect(takeoverInquiryOk({})).toBe(false);
  });
});
