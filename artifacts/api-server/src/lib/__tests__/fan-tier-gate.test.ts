/**
 * Pure-logic tests for the tier gate (lib/fan-tier-gate.ts, #19):
 * ladder ordering, effective-status mirroring, the three knock-door
 * viewer states, staff exemption, and the fail-closed vanished tier.
 */
import { describe, it, expect } from "vitest";
import {
  orderFanTiers, fanTierRank, effectiveFanMemberStatus, fanMembershipAdmits,
  evaluateTierGate, buildTierGateKnock,
  type FanTierLike, type FanMemberLike,
} from "../fan-tier-gate";

const T0 = new Date("2026-01-01T00:00:00Z");
const NOW = new Date("2026-10-23T00:00:00Z");
const FUTURE = new Date("2027-01-01T00:00:00Z");
const PAST = new Date("2026-01-15T00:00:00Z");
const CREATOR = "creator-user";

const BRONZE: FanTierLike = { id: "tier-bronze", name: "Bronze", sort_order: 0, created_at: T0 };
const SILVER: FanTierLike = { id: "tier-silver", name: "Silver", sort_order: 1, created_at: T0 };
const GOLD: FanTierLike = { id: "tier-gold", name: "Gold", sort_order: 2, created_at: T0 };
const LADDER = orderFanTiers([GOLD, BRONZE, SILVER]); // deliberately shuffled input

function member(tier_id: string, over: Partial<FanMemberLike> = {}): FanMemberLike {
  return {
    tier_id, status: "active", fan_user_id: "fan-user",
    trial_ends_at: null, current_period_end: FUTURE, ...over,
  };
}

describe("tier ladder", () => {
  it("orders by sort_order regardless of input order", () => {
    expect(LADDER.map((t) => t.name)).toEqual(["Bronze", "Silver", "Gold"]);
    expect(fanTierRank(LADDER, "tier-silver")).toBe(1);
    expect(fanTierRank(LADDER, "tier-nope")).toBe(-1);
  });

  it("breaks sort_order ties by created_at, like the tiers list", () => {
    const a = { id: "t-a", name: "A", sort_order: 0, created_at: new Date("2026-02-01") };
    const b = { id: "t-b", name: "B", sort_order: 0, created_at: new Date("2026-01-01") };
    expect(orderFanTiers([a, b]).map((t) => t.id)).toEqual(["t-b", "t-a"]);
  });
});

describe("effective status mirrors the memberships rail", () => {
  it("an unconverted trial past its end reads expired and does not admit", () => {
    const m = member("tier-gold", { status: "trialing", trial_ends_at: PAST, current_period_end: PAST });
    expect(effectiveFanMemberStatus(m, NOW)).toBe("expired");
    expect(fanMembershipAdmits(m, NOW)).toBe(false);
  });

  it("a live trial admits; a paid period that ran out does not", () => {
    expect(fanMembershipAdmits(member("tier-gold", { status: "trialing", trial_ends_at: FUTURE, current_period_end: FUTURE }), NOW)).toBe(true);
    expect(fanMembershipAdmits(member("tier-gold", { current_period_end: PAST }), NOW)).toBe(false);
    expect(fanMembershipAdmits(member("tier-gold"), NOW)).toBe(true);
  });

  it("past_due / canceled / refunded never admit", () => {
    for (const status of ["past_due", "canceled", "expired", "refunded"]) {
      expect(fanMembershipAdmits(member("tier-gold", { status }), NOW)).toBe(false);
    }
  });

  it("a manual tracking row (fan_user_id null, no period end) keeps its stored status", () => {
    // Mirrors memberships.ts: the period-end expiry only applies to
    // real fan rows; manual rows are the creator's own bookkeeping.
    expect(effectiveFanMemberStatus(member("tier-gold", { fan_user_id: null, current_period_end: PAST }), NOW)).toBe("active");
  });
});

describe("evaluateTierGate", () => {
  const base = { orderedTiers: LADDER, gateTierId: "tier-silver", isStaff: false, now: NOW };

  it("an ungated channel admits everyone the group admits", () => {
    const ev = evaluateTierGate({ ...base, gateTierId: null, members: [] });
    expect(ev).toMatchObject({ gated: false, hasAccess: true, viewerStatus: null });
  });

  it("tier X admits X and up, refuses below", () => {
    expect(evaluateTierGate({ ...base, members: [member("tier-silver")] }).hasAccess).toBe(true);
    expect(evaluateTierGate({ ...base, members: [member("tier-gold")] }).hasAccess).toBe(true);
    const below = evaluateTierGate({ ...base, members: [member("tier-bronze")] });
    expect(below.hasAccess).toBe(false);
    expect(below.viewerStatus).toBe("below_tier");
    expect(below.viewerTier?.name).toBe("Bronze");
    expect(below.requiredTier?.name).toBe("Silver");
  });

  it("no membership at all is not_member", () => {
    const ev = evaluateTierGate({ ...base, members: [] });
    expect(ev).toMatchObject({ hasAccess: false, viewerStatus: "not_member" });
  });

  it("a lapsed qualifying membership is lapsed — including a period that simply ran out", () => {
    const canceled = evaluateTierGate({ ...base, members: [member("tier-gold", { status: "canceled" })] });
    expect(canceled).toMatchObject({ hasAccess: false, viewerStatus: "lapsed" });
    const ranOut = evaluateTierGate({ ...base, members: [member("tier-silver", { current_period_end: PAST })] });
    expect(ranOut).toMatchObject({ hasAccess: false, viewerStatus: "lapsed" });
  });

  it("a lapsed qualifying seat names the knock 'lapsed' even alongside a live lower tier", () => {
    const ev = evaluateTierGate({
      ...base,
      members: [member("tier-bronze"), member("tier-gold", { status: "canceled" })],
    });
    expect(ev.hasAccess).toBe(false);
    // They hold a live Bronze seat: the honest knock is "upgrade",
    // and the lapsed Gold seat doesn't grant anything.
    expect(ev.viewerStatus).toBe("lapsed");
  });

  it("group staff are exempt — the crew runs the room", () => {
    const ev = evaluateTierGate({ ...base, isStaff: true, members: [] });
    expect(ev).toMatchObject({ gated: true, hasAccess: true, viewerStatus: null });
  });

  it("a vanished gate tier fails closed for fans, stays open for staff", () => {
    const fan = evaluateTierGate({ ...base, gateTierId: "tier-deleted", members: [member("tier-gold")] });
    expect(fan).toMatchObject({ gated: true, hasAccess: false });
    const staff = evaluateTierGate({ ...base, gateTierId: "tier-deleted", isStaff: true, members: [] });
    expect(staff.hasAccess).toBe(true);
  });
});

describe("buildTierGateKnock", () => {
  const channel = { id: "ch-1", name: "VIP Lounge", description: "Members only talk." };
  const group = { slug: "wave-makers", name: "Wave Makers" };

  it("a non-member knock names the room, the tier, and the existing join door", () => {
    const ev = evaluateTierGate({ orderedTiers: LADDER, gateTierId: "tier-silver", members: [], isStaff: false, now: NOW });
    const knock = buildTierGateKnock({ channel, group, evaluation: ev, creatorUserId: CREATOR });
    expect(knock.join_url).toBe(`/memberships?creator=${CREATOR}`);
    expect(knock.required_tier?.name).toBe("Silver");
    expect(knock.message).toContain("VIP Lounge");
    expect(knock.message).toContain("Silver");
    expect(knock.history_note).toContain("never deleted");
  });

  it("a lapsed knock promises the history survives and the rejoin is the same door", () => {
    const ev = evaluateTierGate({
      orderedTiers: LADDER, gateTierId: "tier-silver", isStaff: false, now: NOW,
      members: [member("tier-gold", { status: "expired" })],
    });
    const knock = buildTierGateKnock({ channel, group, evaluation: ev, creatorUserId: CREATOR });
    expect(knock.viewer_status).toBe("lapsed");
    expect(knock.message).toContain("Your membership has ended");
    expect(knock.message).toContain("straight back in");
    expect(knock.join_url).toBe(`/memberships?creator=${CREATOR}`);
  });

  it("without a creator there is no join door to invent — join_url is null", () => {
    const ev = evaluateTierGate({ orderedTiers: LADDER, gateTierId: "tier-silver", members: [], isStaff: false, now: NOW });
    const knock = buildTierGateKnock({ channel, group, evaluation: ev, creatorUserId: null });
    expect(knock.join_url).toBeNull();
  });
});
