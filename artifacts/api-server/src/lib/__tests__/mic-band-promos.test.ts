import { describe, expect, it } from "vitest";
import {
  buildMicBandPromos,
  formatMicBandDate,
  type MicBandPromoSources,
} from "../mic-band-promos";

const NOW = new Date("2026-10-25T12:00:00.000Z");

function sources(over: Partial<MicBandPromoSources> = {}): MicBandPromoSources {
  return {
    now: NOW,
    launch: {
      name: "Bow Down Visuals Launch",
      launchAt: "2027-01-01T05:00:00.000Z",
      href: "/signup",
    },
    spotlight: { name: "Spotlight Takeover", priceDollars: 1000, durationDays: 7 },
    loadingScreen: { name: "Loading Screen Takeover", priceDollars: 2500, durationDays: 7 },
    jackpot: null,
    ...over,
  };
}

describe("buildMicBandPromos — launch", () => {
  it("leads with the launch, its source date and a derived countdown", () => {
    const promos = buildMicBandPromos(sources());
    expect(promos[0]).toEqual({
      id: "launch",
      kicker: "Grand opening",
      headline: "Jan 1, 2027",
      // Oct 25 12:00Z → Jan 1 05:00Z is 67 days + 17h → ceil = 68.
      detail: "68 days away — be first in the door",
      href: "/signup",
    });
  });

  it("says Tomorrow on the last full day and omits the launch once it has passed", () => {
    const eve = buildMicBandPromos(
      sources({ now: new Date("2026-12-31T12:00:00.000Z") }),
    );
    expect(eve.find((p) => p.id === "launch")?.detail).toContain("Tomorrow");
    const after = buildMicBandPromos(
      sources({ now: new Date("2027-01-02T00:00:00.000Z") }),
    );
    expect(after.find((p) => p.id === "launch")).toBeUndefined();
  });

  it("follows a changed launch source instead of a hard-coded date", () => {
    const promos = buildMicBandPromos(
      sources({
        launch: { name: "Other Launch", launchAt: "2027-03-05T05:00:00.000Z", href: "/join" },
      }),
    );
    const launch = promos.find((p) => p.id === "launch");
    expect(launch?.headline).toBe("Mar 5, 2027");
    expect(launch?.href).toBe("/join");
  });
});

describe("buildMicBandPromos — jackpot (live source only)", () => {
  it("promotes a live jackpot with its real prize and end date", () => {
    const promos = buildMicBandPromos(
      sources({
        jackpot: {
          phase: "live",
          prizeCredits: 10000,
          endsAt: "2026-11-01T00:00:00.000Z",
        },
      }),
    );
    expect(promos.find((p) => p.id === "jackpot")).toEqual({
      id: "jackpot",
      kicker: "Cheat Code Jackpot",
      headline: "10,000 VB",
      detail: "Unclaimed — ends Nov 1, 2026",
      href: null,
    });
  });

  it("shows the real winner for a claimed jackpot, and nothing for none/ended", () => {
    const claimed = buildMicBandPromos(
      sources({ jackpot: { phase: "claimed", prizeCredits: 10000, winnerDisplayName: "Sharp Player" } }),
    );
    expect(claimed.find((p) => p.id === "jackpot")?.detail).toBe("Won by Sharp Player");

    for (const phase of ["none", "ended"] as const) {
      const promos = buildMicBandPromos(sources({ jackpot: { phase, prizeCredits: 10000 } }));
      expect(promos.find((p) => p.id === "jackpot")).toBeUndefined();
    }
    const noEvent = buildMicBandPromos(sources({ jackpot: null }));
    expect(noEvent.find((p) => p.id === "jackpot")).toBeUndefined();
  });

  it("never invents a prize: a live event without prizeCredits is not promoted", () => {
    const promos = buildMicBandPromos(sources({ jackpot: { phase: "live" } }));
    expect(promos.find((p) => p.id === "jackpot")).toBeUndefined();
  });
});

describe("buildMicBandPromos — takeover offers are data-driven", () => {
  it("renders name, price and duration from the offer sources", () => {
    const promos = buildMicBandPromos(sources());
    expect(promos.find((p) => p.id === "spotlight")).toMatchObject({
      headline: "Spotlight Takeover",
      detail: "$1,000 · 7 days",
    });
    expect(promos.find((p) => p.id === "loading-screen")).toMatchObject({
      headline: "Loading Screen Takeover",
      detail: "$2,500 · 7 days",
    });
  });

  it("follows changed offer prices — proving nothing is hard-coded", () => {
    const promos = buildMicBandPromos(
      sources({
        spotlight: { name: "Spotlight Takeover", priceDollars: 1234, durationDays: 3 },
      }),
    );
    expect(promos.find((p) => p.id === "spotlight")?.detail).toBe("$1,234 · 3 days");
  });

  it("always carries the two takeovers even with no launch and no jackpot", () => {
    const promos = buildMicBandPromos(
      sources({ now: new Date("2027-06-01T00:00:00.000Z"), jackpot: null }),
    );
    expect(promos.map((p) => p.id)).toEqual(["spotlight", "loading-screen"]);
  });
});

describe("formatMicBandDate", () => {
  it("formats ISO in UTC and rejects junk", () => {
    expect(formatMicBandDate("2027-01-01T05:00:00.000Z")).toBe("Jan 1, 2027");
    expect(formatMicBandDate(null)).toBeNull();
    expect(formatMicBandDate("nope")).toBeNull();
  });
});
