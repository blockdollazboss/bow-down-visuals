import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Priority DM price copy — platform-price truth pins.
 *
 * Owner FINAL ruling (2026-11-02): Priority DM prices stay PLATFORM-SET
 * at 100 VB — no creator-price feature. The rail charges the platform
 * price via priorityDmPriceVb() (env-or-100) in the api-server's
 * lib/priority-dms.ts, and the creator's stored min_price_vb is a legacy
 * value that is never charged. The settings card copy must say exactly
 * that — the price is set by the platform, the same for everyone — and
 * must never again claim a creator may set their own price (the
 * stack1400 price-honest-copy lane wrote that claim from a contested
 * audit premise; this lane reverts it).
 */
const panel = readFileSync(new URL("./PriorityDmPanel.tsx", import.meta.url), "utf8");

describe("PriorityDmPanel platform-price copy", () => {
  it("states the platform price wording at the price line", () => {
    expect(panel).toContain("Platform price");
    expect(panel).toContain("Visual Bucs per priority message — set by the platform, the same for every creator.");
    expect(panel).toContain("Fans pay the platform price to land in your priority lane.");
    expect(panel).toContain("fans see the 100 VB price and your reply window before they pay.");
  });

  it("never claims a creator-set price anywhere in the panel", () => {
    expect(panel).not.toContain("set their own price");
    expect(panel).not.toContain("may set their own");
    expect(panel).not.toContain("Fans pay your price");
    expect(panel).not.toContain("fans see your price");
    expect(panel).not.toContain("platform default");
  });

  it("pins the displayed fallback price to the rail price (100)", () => {
    /* The card falls back to 100 when settings carry no price, and the
       error-path settings seed 100 too — both must stay the rail's
       platform price (PRIORITY_DM_PRICE_VB / priorityDmPriceVb). */
    expect(panel).toContain("settings?.price_vb ?? 100");
    expect(panel).toContain("price_vb: 100");
  });
});
