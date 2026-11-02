/**
 * The stage shoutout offer mapper (routes/world, Ring 3, 3.3).
 *
 * GET /api/world/shoutout-offer/:slug answers the seat's question
 * — does this performer take shoutouts, at what price — off the
 * SAME shoutout_settings row the purchase charges from. The
 * mapper carries the honesty contract:
 *  - no settings row, or accepting off → not offered, price null
 *    (never an invented figure, never a stale price);
 *  - accepting on → offered at the row's price, at face value:
 *    the number the performer set is the number of Visual Bucs
 *    the seat shows and the purchase charges (lib/world-stage-
 *    shoutouts re-reads the same row at buy time);
 *  - a price of 0 is a real offer — the performer's free shoutout.
 */
import { describe, it, expect } from "vitest";
import { shoutoutOfferFromSettings } from "../world";

describe("shoutoutOfferFromSettings", () => {
  it("no settings row → not offered, no price", () => {
    expect(shoutoutOfferFromSettings(null)).toEqual({ offered: false, priceVb: null });
  });

  it("accepting off → not offered, and the stored price is NOT leaked", () => {
    expect(shoutoutOfferFromSettings({ price_cents: 500, accepting: "false" })).toEqual({
      offered: false,
      priceVb: null,
    });
  });

  it("accepting on → offered at the row's price, face value", () => {
    expect(shoutoutOfferFromSettings({ price_cents: 500, accepting: "true" })).toEqual({
      offered: true,
      priceVb: 500,
    });
  });

  it("a price of 0 is a real (free) offer, not 'not offered'", () => {
    expect(shoutoutOfferFromSettings({ price_cents: 0, accepting: "true" })).toEqual({
      offered: true,
      priceVb: 0,
    });
  });
});
