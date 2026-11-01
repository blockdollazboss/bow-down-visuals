/**
 * Booking fan-out seam (stack1100 Y3): notifyBookingEvent hands the
 * landed booking tell to the one event door verbatim — money category,
 * the job_type as kind — and a failing notifier never throws back into
 * a booking write path. The door's own preference gate (a silenced
 * money category still lands the bell, sends no ping) is proven in the
 * push suites (push-prefs.test.ts); the landing gates at each call
 * site are pinned in storefront-booking-fanout.test.ts and in
 * booking-reminders.test.ts.
 */
import { describe, it, expect, afterEach } from "vitest";
import { __setBookingEventNotifier, notifyBookingEvent } from "../booking-notify";
import type { UserEventInput } from "../push-events";

afterEach(() => {
  __setBookingEventNotifier(null);
});

describe("notifyBookingEvent", () => {
  it("hands the tell to the door as a money event with the booking kind", async () => {
    const seen: UserEventInput[] = [];
    __setBookingEventNotifier(async (input) => {
      seen.push(input);
    });
    await notifyBookingEvent({
      userId: "user-1",
      kind: "storefront_booking_cancelled",
      title: "Booking cancelled: Coaching",
      body: "The creator cancelled.",
      link: "/store/purchases",
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      userId: "user-1",
      category: "money",
      kind: "storefront_booking_cancelled",
      title: "Booking cancelled: Coaching",
      body: "The creator cancelled.",
      link: "/store/purchases",
    });
  });

  it("swallows a failing notifier — the booking path never breaks", async () => {
    __setBookingEventNotifier(async () => {
      throw new Error("door exploded");
    });
    await expect(
      notifyBookingEvent({ userId: "u", kind: "k", title: "t", body: "b", link: "/x" }),
    ).resolves.toBeUndefined();
  });
});
