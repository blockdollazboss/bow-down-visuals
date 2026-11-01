/**
 * Storefront booking → fan-out wiring pins (stack1100 Y3).
 * Every booking tell in routes/storefront.ts records its exactly-once
 * job_notifications row AND, only when that row lands, fires the door
 * event (lib/booking-notify) to the booking party. Before this, the
 * rows' only consumer was the owner's chat relay — the parties were
 * never belled or pinged. The behavioral halves live in
 * booking-notify.test.ts (the seam), booking-reminders.test.ts (the
 * buyer reminder firing), push-prefs.test.ts (the door's gate), and
 * the storefront-bookings suites (the rows themselves); these pins
 * keep the composition from silently unwiring.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "storefront.ts"), "utf8");

describe("storefront booking fan-out wiring", () => {
  it("imports the booking fan-out seam", () => {
    expect(src).toContain('import { notifyBookingEvent } from "../lib/booking-notify";');
  });

  it("notifyBookingParty captures the landing and gates the event on it", () => {
    const fnAt = src.indexOf("async function notifyBookingParty(");
    const block = src.slice(fnAt, fnAt + 1400);
    expect(block).toContain("RETURNING id");
    expect(block).toContain("if (landed.rows.length > 0) {");
    expect(block).toContain("await notifyBookingEvent({");
    expect(block).toContain("kind: args.jobType");
  });

  it("every notifyBookingParty caller passes a party-correct link", () => {
    expect(src).toContain('link: "/store/dashboard",');
    expect(src).toContain('link: isBuyer ? "/store/dashboard" : "/store/purchases",');
    const callers = src.match(/notifyBookingParty\(db, \{/g) ?? [];
    expect(callers.length).toBe(4);
  });

  it("the four direct job_notifications booking inserts fire on landing with the dashboard link", () => {
    const events = src.match(/await notifyBookingEvent\(\{/g) ?? [];
    /* 1 inside notifyBookingParty + 4 direct sites. */
    expect(events.length).toBe(5);
    const landings = src.match(/if \(landed\.rows\.length > 0\) \{/g) ?? [];
    expect(landings.length).toBe(5);
    const kinds = src.match(/kind: "storefront_service_booking",/g) ?? [];
    expect(kinds.length).toBe(4);
  });
});
