import { describe, it, expect } from "vitest";
import { lastStreamSetup, type MineStreamRow } from "./studio-setup";

/* ─── lastStreamSetup (EVERYTHING-SMART, stack900 K1) ─────────────────
   The Go Live studio opens on the setup of the creator's most recent
   finished show — title, ticket price, class flag — instead of a
   blank form every session. */

const row = (over: Partial<MineStreamRow> = {}): MineStreamRow => ({
  title: "Friday Night Live",
  status: "ended",
  is_class: false,
  ticket_price_vb: null,
  ...over,
});

describe("lastStreamSetup", () => {
  it("takes the newest finished show's full setup", () => {
    expect(
      lastStreamSetup([
        row({ title: "New Show", ticket_price_vb: 500, is_class: true }),
        row({ title: "Old Show" }),
      ]),
    ).toEqual({ title: "New Show", ticketPriceVb: 500, isClass: true });
  });

  it("skips a still-live row (that is the leftover flow's stream, not a prefill source)", () => {
    expect(
      lastStreamSetup([
        row({ title: "Still Live", status: "live" }),
        row({ title: "Last Finished" }),
      ])?.title,
    ).toBe("Last Finished");
  });

  it("skips untitled rows and trims the title it takes", () => {
    expect(
      lastStreamSetup([row({ title: "   " }), row({ title: "  Real Title " })])?.title,
    ).toBe("Real Title");
  });

  it("reads a free show as no ticket price and no class", () => {
    expect(lastStreamSetup([row({ ticket_price_vb: 0, is_class: null })])).toEqual({
      title: "Friday Night Live",
      ticketPriceVb: null,
      isClass: false,
    });
  });

  it("returns null when there is nothing to remember", () => {
    expect(lastStreamSetup([])).toBeNull();
    expect(lastStreamSetup(undefined)).toBeNull();
    expect(lastStreamSetup(null)).toBeNull();
    expect(lastStreamSetup([row({ status: "live" })])).toBeNull();
  });
});
