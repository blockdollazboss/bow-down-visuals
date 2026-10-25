/**
 * Membership pause (wave-4 #39) — the pure core (lib/membership-pause)
 * and its honor at every gate that consults membership status:
 *
 *  - pause math: 1–3 calendar months, the resume date stated before
 *    the fan confirms, Jan-31 clamping, the elapsed-shift cap;
 *  - effective status: resting seats read "paused", a seat whose
 *    stated resume date arrived reads "active" on its shifted period,
 *    and one whose shifted period also ran out reads "expired";
 *  - gates: the tier-gated room gate (lib/fan-tier-gate) and the
 *    members-only post gate (lib/close-friends) both refuse a paused
 *    member and label them "paused" — never "ended";
 *  - dunning separation: a paused member produces ZERO dunning
 *    triggers — the failed-PAYMENT rescue never chases a resting fan.
 */
import { describe, it, expect } from "vitest";
import {
  addMonths,
  pauseResumeDate,
  isValidPauseMonths,
  pauseElapsedMs,
  pausedPeriodEnd,
  pausedEffectiveStatus,
  isResting,
  PAUSE_MIN_MONTHS,
  PAUSE_MAX_MONTHS,
  type PausableMemberLike,
} from "../membership-pause";
import { effectiveFanMemberStatus, fanMembershipAdmits, evaluateTierGate, buildTierGateKnock, orderFanTiers } from "../fan-tier-gate";
import { evaluateMemberPost } from "../close-friends";
import { dunningTriggersForMember } from "../dunning";

const DAY = 24 * 3600 * 1000;
const START = new Date("2026-10-01T12:00:00Z");
const NOW = new Date("2026-10-25T12:00:00Z"); // 24 days into a pause begun Oct 1

function pausedMember(over: Partial<PausableMemberLike> = {}): PausableMemberLike {
  return {
    status: "paused",
    fan_user_id: "fan-1",
    trial_ends_at: null,
    current_period_end: new Date(START.getTime() + 30 * DAY), // Oct 31 stored end
    paused_at: START,
    paused_until: pauseResumeDate(START, 2), // Dec 1
    ...over,
  };
}

describe("pause math", () => {
  it("adds calendar months and clamps to the target month's last day", () => {
    expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(addMonths(new Date("2026-10-25T00:00:00Z"), 3).toISOString()).toBe("2027-01-25T00:00:00.000Z");
    expect(pauseResumeDate(START, 1).toISOString()).toBe("2026-11-01T12:00:00.000Z");
    expect(pauseResumeDate(START, 3).toISOString()).toBe("2027-01-01T12:00:00.000Z");
  });

  it("only 1–3 whole months are a pause", () => {
    expect(PAUSE_MIN_MONTHS).toBe(1);
    expect(PAUSE_MAX_MONTHS).toBe(3);
    for (const ok of [1, 2, 3]) expect(isValidPauseMonths(ok)).toBe(true);
    for (const bad of [0, 4, -1, 1.5, "2", null, undefined, NaN]) {
      expect(isValidPauseMonths(bad)).toBe(false);
    }
  });

  it("elapsed time is capped at the stated resume date — a late resume never over-shifts", () => {
    const m = pausedMember();
    expect(pauseElapsedMs(m, NOW)).toBe(NOW.getTime() - START.getTime());
    const afterUntil = new Date(m.paused_until!.getTime() + 10 * DAY);
    expect(pauseElapsedMs(m, afterUntil)).toBe(m.paused_until!.getTime() - START.getTime());
    expect(pauseElapsedMs(pausedMember({ paused_at: null }), NOW)).toBe(0);
  });

  it("the period end the fan comes back to is the stored end plus the rest", () => {
    const m = pausedMember();
    const shifted = pausedPeriodEnd(m, new Date(m.paused_until!))!;
    expect(shifted.getTime()).toBe(
      new Date(START.getTime() + 30 * DAY).getTime() + (m.paused_until!.getTime() - START.getTime()),
    );
  });
});

describe("effective status of a paused seat", () => {
  it("rests while the resume date is ahead — and admits nowhere", () => {
    const m = pausedMember();
    expect(pausedEffectiveStatus(m, NOW)).toBe("paused");
    expect(isResting(m, NOW)).toBe(true);
  });

  it("auto-resumes on the stated date, running to the shifted period end", () => {
    const m = pausedMember();
    const after = new Date(m.paused_until!.getTime() + DAY);
    expect(pausedEffectiveStatus(m, after)).toBe("active");
    expect(isResting(m, after)).toBe(false);
  });

  it("reads expired once the shifted period has also run out unpaid", () => {
    const m = pausedMember({ current_period_end: new Date(START.getTime() + 10 * DAY) });
    const late = new Date(m.paused_until!.getTime() + 20 * DAY); // shifted end = start+10d+61d < late
    expect(pausedEffectiveStatus(m, late)).toBe("expired");
  });

  it("a manual row (no fan account, no period) never expires off a pause", () => {
    const m = pausedMember({ fan_user_id: null, current_period_end: null });
    expect(pausedEffectiveStatus(m, new Date("2028-01-01T00:00:00Z"))).toBe("active");
  });

  it("a paused row with no stated resume date stays asleep — no date is invented", () => {
    const m = pausedMember({ paused_until: null });
    expect(pausedEffectiveStatus(m, new Date("2028-01-01T00:00:00Z"))).toBe("paused");
  });

  it("non-paused rows are not this module's business", () => {
    expect(pausedEffectiveStatus(pausedMember({ status: "active" }), NOW)).toBeNull();
    expect(pausedEffectiveStatus(pausedMember({ status: "past_due" }), NOW)).toBeNull();
  });
});

describe("the gates honor pause", () => {
  const tiers = orderFanTiers([
    { id: "tier-gold", name: "Gold", sort_order: 0, created_at: START },
  ]);
  const gateMember = (over: Record<string, unknown> = {}) => ({
    tier_id: "tier-gold",
    status: "paused",
    fan_user_id: "fan-1",
    trial_ends_at: null,
    current_period_end: new Date(START.getTime() + 30 * DAY),
    paused_at: START,
    paused_until: pauseResumeDate(START, 2),
    ...over,
  });

  it("fan-tier gate: a resting member does not admit, before or after fan-tier mirroring", () => {
    const m = gateMember();
    expect(effectiveFanMemberStatus(m, NOW)).toBe("paused");
    expect(fanMembershipAdmits(m, NOW)).toBe(false);
  });

  it("tier-gated room: closed to a paused member, labelled paused — never 'ended'", () => {
    const ev = evaluateTierGate({
      orderedTiers: tiers, gateTierId: "tier-gold", members: [gateMember()], isStaff: false, now: NOW,
    });
    expect(ev.hasAccess).toBe(false);
    expect(ev.viewerStatus).toBe("paused");
    const knock = buildTierGateKnock({
      channel: { id: "c1", name: "Inner Circle", description: "" },
      group: { slug: "g", name: "Group" },
      evaluation: ev,
      creatorUserId: "creator-1",
    });
    expect(knock.message).toContain("paused");
    expect(knock.message).not.toContain("has ended");
  });

  it("tier-gated room: the same member is back in once the resume date passes", () => {
    const after = new Date(pauseResumeDate(START, 2).getTime() + DAY);
    const ev = evaluateTierGate({
      orderedTiers: tiers, gateTierId: "tier-gold", members: [gateMember()], isStaff: false, now: after,
    });
    expect(ev.hasAccess).toBe(true);
    expect(ev.viewerStatus).toBeNull();
  });

  it("members-only posts: a paused member gets the locked teaser, labelled paused", () => {
    const ev = evaluateMemberPost({ tiers, members: [gateMember()] }, null, NOW);
    expect(ev.hasAccess).toBe(false);
    expect(ev.viewerStatus).toBe("paused");
  });
});

describe("dunning never chases a paused fan", () => {
  it("a paused member produces zero recovery triggers", () => {
    const triggers = dunningTriggersForMember(
      { id: "m1", status: "paused", fan_user_id: "fan-1", updated_at: START },
      "fan@example.test",
    );
    expect(triggers).toEqual([]);
  });

  it("and the chase still fires for a genuinely past-due member (control)", () => {
    const triggers = dunningTriggersForMember(
      { id: "m2", status: "past_due", fan_user_id: "fan-1", updated_at: START },
      "fan@example.test",
    );
    expect(triggers.length).toBeGreaterThan(0);
  });
});
