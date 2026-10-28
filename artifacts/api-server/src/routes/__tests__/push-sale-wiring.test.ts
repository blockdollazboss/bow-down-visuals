/**
 * Sale → device-push wiring pin (Stack500 push foundation).
 * The shop sale finale in routes/store.ts must fire notifyUserEvent
 * (category "money", kind "sale") for the seller ONLY when the
 * exactly-once job_notifications row actually landed — a duplicate
 * verify returns landed=false and must never re-ping. The behavioral
 * halves are proven in push-prefs.test.ts (event service) and the
 * job-notifications suites (exactly-once landing); this pin keeps the
 * composition from silently unwiring.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const storeSrc = readFileSync(join(here, "..", "store.ts"), "utf8");

describe("store sale → push wiring", () => {
  it("imports the event service", () => {
    expect(storeSrc).toContain('import { notifyUserEvent } from "../lib/push-events";');
  });

  it("captures the exactly-once landing and gates the event on it", () => {
    expect(storeSrc).toContain("const landed = await createJobNotification({");
    const gateAt = storeSrc.indexOf("if (landed) {");
    const eventAt = storeSrc.indexOf("await notifyUserEvent({", gateAt);
    expect(gateAt).toBeGreaterThan(-1);
    expect(eventAt).toBeGreaterThan(gateAt);
  });

  it("fires the money/sale event for the seller with the dashboard deep link", () => {
    const eventAt = storeSrc.indexOf("await notifyUserEvent({");
    const block = storeSrc.slice(eventAt, eventAt + 400);
    expect(block).toContain("userId: sellerId");
    expect(block).toContain('category: "money"');
    expect(block).toContain('kind: "sale"');
    expect(block).toContain('link: "/store/dashboard"');
  });
});
