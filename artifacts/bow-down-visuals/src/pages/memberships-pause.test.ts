/**
 * Membership pause (wave-4 #39) — the fan's manage page wiring.
 *
 * Pins the visible surface on pages/memberships.tsx:
 *  1. an active member whose tier offers pause gets a Pause button and
 *     a 1–3 month picker, and the resume date for the chosen length is
 *     stated on the picker BEFORE the fan confirms (the confirm dialog
 *     repeats it — the date is never a surprise after the tap);
 *  2. confirming posts to the pause door with the chosen months;
 *  3. a paused membership renders its paused panel — access asleep,
 *     nothing charging, the resume date and the post-pause period end
 *     stated — with a one-tap Resume that posts to the resume door;
 *  4. the creator tier form carries the per-tier pause toggle and the
 *     save body sends it; the tier card states the offer honestly.
 *
 * Behavior (statuses, billing skip, gate honoring, dunning exclusion)
 * is pinned server-side in the api-server pause suites.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./memberships.tsx", import.meta.url), "utf8");

describe("fan pause door", () => {
  it("an active, pause-offered membership gets a Pause button", () => {
    expect(src).toContain('m.status === "active" && m.pauseOffered !== false');
    expect(src).toContain("setPausePickId(pausePickId === m.id ? null : m.id)");
  });

  it("the picker offers exactly 1–3 months and states the resume date before confirming", () => {
    expect(src).toContain("[1, 2, 3].map((n) =>");
    expect(src).toContain("Access sleeps now and comes back on");
    expect(src).toContain("addMonthsClamped(new Date(), pauseMonths)");
    expect(src).toContain("nothing charges while you rest");
  });

  it("the confirm repeats the resume date plainly and posts the chosen months", () => {
    expect(src).toContain("comes back on ${when}");
    expect(src).toContain("your paid time doesn't burn");
    expect(src).toContain("`/memberships/mine/${m.id}/pause`");
    expect(src).toContain("body: JSON.stringify({ months })");
  });
});

describe("paused panel + one-tap resume", () => {
  it("the paused panel states the sleep, the resume date, and the shifted period end", () => {
    expect(src).toContain("Paused — your access is asleep and nothing is charging.");
    expect(src).toContain("m.pauseResumesAt");
    expect(src).toContain("your paid period will then run to");
    expect(src).toContain("m.pauseNewPeriodEnd");
  });

  it("resume is one tap to the resume door", () => {
    expect(src).toContain("`/memberships/mine/${m.id}/resume`");
    expect(src).toContain("Resume now");
    expect(src).toContain('m.status === "paused"');
  });
});

describe("creator per-tier toggle", () => {
  it("the tier form carries the pause-offer checkbox and the save body sends it", () => {
    expect(src).toContain("Let members pause (1–3 months)");
    expect(src).toContain("pauseEnabled: pauseOfferEnabled");
    expect(src).toContain("setPauseOfferEnabled(t.pauseEnabled !== false)");
  });

  it("the tier card states the offer honestly, on or off", () => {
    expect(src).toContain('tier.pauseEnabled === false ? "Member pause off" : "Members can pause 1–3 months"');
  });
});
