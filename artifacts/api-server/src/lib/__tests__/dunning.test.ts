/**
 * Dunning — the pure recovery core (lib/dunning).
 *
 * Pins the grace honesty law:
 *  - the sequence is 4 steps on a fixed timeline (notice at failure,
 *    reminder +3d, card nudge +5d, final warning +6d) and access ends
 *    at +7d — the final warning always lands BEFORE access ends;
 *  - grace applies only to paid rows (fan_user_id set): manual
 *    tracking rows never auto-expire, because no payment rail exists
 *    for them and inventing an end date would fabricate a state;
 *  - a member not in past_due produces no triggers — the chase stops
 *    the moment payment reality changes;
 *  - trigger refs are per-episode: a new failure after a recovery
 *    re-arms the sequence, and one episode's sends never inflate
 *    another episode's recovery picture;
 *  - "recovered" is derived only from the row being active again —
 *    sends alone never claim a recovery.
 */
import { describe, it, expect } from "vitest";
import {
  DUNNING_GRACE_DAYS,
  DUNNING_STEPS,
  dunningDaysLeft,
  dunningGraceEndsAt,
  dunningTriggersForMember,
  episodeStartFromDunningRef,
  isDunningExpired,
  memberIdFromDunningRef,
  pastDueSince,
  recoveryForMember,
  type DunningMemberLike,
} from "../dunning";

const FAILED_AT = new Date("2026-10-01T12:00:00.000Z");
const MEMBER_ID = "55555555-5555-4555-8555-555555555555";

function member(over: Partial<DunningMemberLike> = {}): DunningMemberLike {
  return {
    id: MEMBER_ID,
    status: "past_due",
    fan_user_id: "22222222-2222-4222-8222-222222222222",
    updated_at: FAILED_AT,
    created_at: new Date("2026-09-01T12:00:00.000Z"),
    ...over,
  };
}

describe("the sequence timeline", () => {
  it("is notice → reminder → card nudge → final warning, in order", () => {
    expect(DUNNING_STEPS.map((s) => s.key)).toEqual([
      "payment_failed_notice",
      "payment_reminder",
      "card_update_nudge",
      "final_warning",
    ]);
    expect(DUNNING_STEPS.map((s) => s.offsetHours)).toEqual([0, 72, 120, 144]);
  });

  it("every step's copy is distinct and points at the membership page door", () => {
    const subjects = new Set(DUNNING_STEPS.map((s) => s.subject));
    expect(subjects.size).toBe(DUNNING_STEPS.length);
    for (const s of DUNNING_STEPS) {
      expect(s.body).toContain("/memberships");
      expect(s.subject.length).toBeGreaterThan(0);
    }
  });

  it("the final warning lands before access ends — always", () => {
    const last = DUNNING_STEPS[DUNNING_STEPS.length - 1]!;
    expect(last.offsetHours).toBeLessThan(DUNNING_GRACE_DAYS * 24);
    expect(DUNNING_GRACE_DAYS).toBe(7);
  });
});

describe("grace math", () => {
  it("access ends exactly 7 days after the failure", () => {
    expect(dunningGraceEndsAt(member())?.toISOString()).toBe("2026-10-08T12:00:00.000Z");
    expect(pastDueSince(member())).toEqual(FAILED_AT);
  });

  it("is not expired inside grace, and is expired at the grace end", () => {
    expect(isDunningExpired(member(), new Date("2026-10-08T11:59:59.000Z"))).toBe(false);
    expect(isDunningExpired(member(), new Date("2026-10-08T12:00:00.000Z"))).toBe(true);
  });

  it("days left counts whole days, 0 on the final day", () => {
    expect(dunningDaysLeft(member(), FAILED_AT)).toBe(7);
    expect(dunningDaysLeft(member(), new Date("2026-10-07T12:00:01.000Z"))).toBe(1);
    expect(dunningDaysLeft(member(), new Date("2026-10-08T12:00:00.000Z"))).toBe(0);
  });

  it("manual rows (fan_user_id null) have no grace end and never expire", () => {
    const manual = member({ fan_user_id: null });
    expect(dunningGraceEndsAt(manual)).toBeNull();
    expect(isDunningExpired(manual, new Date("2030-01-01T00:00:00.000Z"))).toBe(false);
    expect(dunningDaysLeft(manual)).toBeNull();
  });

  it("rows not in past_due have no grace end", () => {
    expect(dunningGraceEndsAt(member({ status: "active" }))).toBeNull();
    expect(dunningGraceEndsAt(member({ status: "canceled" }))).toBeNull();
  });
});

describe("triggers", () => {
  it("builds one trigger per step, due on the step timeline", () => {
    const triggers = dunningTriggersForMember(member(), "fan@example.test");
    expect(triggers).toHaveLength(4);
    expect(triggers.map((t) => t.eventAt.toISOString())).toEqual([
      "2026-10-01T12:00:00.000Z",
      "2026-10-04T12:00:00.000Z",
      "2026-10-06T12:00:00.000Z",
      "2026-10-07T12:00:00.000Z",
    ]);
    for (const t of triggers) {
      expect(t.email).toBe("fan@example.test");
      expect(t.subject.length).toBeGreaterThan(0);
      expect(memberIdFromDunningRef(t.ref)).toBe(MEMBER_ID);
      expect(episodeStartFromDunningRef(t.ref)).toEqual(FAILED_AT);
    }
  });

  it("step subjects travel with the trigger (per-step copy, not one blast)", () => {
    const triggers = dunningTriggersForMember(member(), "fan@example.test");
    expect(new Set(triggers.map((t) => t.subject)).size).toBe(4);
    expect(triggers[0]!.ref).toContain("payment_failed_notice");
    expect(triggers[3]!.ref).toContain("final_warning");
  });

  it("a new episode re-arms: refs differ when the failure moment differs", () => {
    const a = dunningTriggersForMember(member(), "fan@example.test");
    const b = dunningTriggersForMember(
      member({ updated_at: new Date("2026-11-01T12:00:00.000Z") }),
      "fan@example.test",
    );
    expect(a.map((t) => t.ref)).not.toEqual(b.map((t) => t.ref));
  });

  it("no triggers once the member is not past_due — the chase stops", () => {
    expect(dunningTriggersForMember(member({ status: "active" }), "fan@example.test")).toEqual([]);
    expect(dunningTriggersForMember(member({ status: "canceled" }), "fan@example.test")).toEqual([]);
    expect(dunningTriggersForMember(member({ status: "expired" }), "fan@example.test")).toEqual([]);
  });

  it("non-dunning refs parse to null", () => {
    expect(memberIdFromDunningRef(`member:${MEMBER_ID}`)).toBeNull();
    expect(episodeStartFromDunningRef(`member:${MEMBER_ID}`)).toBeNull();
  });
});

describe("recovery derivation", () => {
  const episode = `member:${MEMBER_ID}:past_due:${FAILED_AT.toISOString()}`;
  const sends = [
    { triggerRef: `${episode}:payment_failed_notice`, status: "sent", sentAt: FAILED_AT },
    { triggerRef: `${episode}:payment_reminder`, status: "sent", sentAt: new Date("2026-10-04T12:00:00.000Z") },
    { triggerRef: `${episode}:card_update_nudge`, status: "no_provider", sentAt: null },
  ];

  it("in grace: counts only SENT steps, names the last one", () => {
    const r = recoveryForMember(member(), sends, "past_due", new Date("2026-10-05T12:00:00.000Z"));
    expect(r.state).toBe("in_grace");
    expect(r.stepsSent).toBe(2);
    expect(r.stepCount).toBe(4);
    expect(r.lastStepKey).toBe("payment_reminder");
    expect(r.graceEndsAt).toBe("2026-10-08T12:00:00.000Z");
    expect(r.daysLeft).toBe(3);
  });

  it("recovered only when the row is active again — and the episode start survives the recovery write", () => {
    const recovered = member({ status: "active", updated_at: new Date("2026-10-05T09:00:00.000Z") });
    const r = recoveryForMember(recovered, sends, "active", new Date("2026-10-05T12:00:00.000Z"));
    expect(r.state).toBe("recovered");
    expect(r.pastDueSince).toBe(FAILED_AT.toISOString());
    expect(r.graceEndsAt).toBeNull();
  });

  it("access_ended when the row reads expired; ended_other when canceled", () => {
    const expired = member({ status: "past_due", updated_at: FAILED_AT });
    expect(recoveryForMember(expired, sends, "expired").state).toBe("access_ended");
    const canceled = member({ status: "canceled", updated_at: new Date("2026-10-03T00:00:00.000Z") });
    expect(recoveryForMember(canceled, sends, "canceled").state).toBe("ended_other");
  });

  it("a previous episode's sends never inflate the current chase", () => {
    const oldEpisode = `member:${MEMBER_ID}:past_due:2026-08-01T12:00:00.000Z`;
    const mixed = [
      ...sends,
      { triggerRef: `${oldEpisode}:payment_failed_notice`, status: "sent", sentAt: new Date("2026-08-01T12:00:00.000Z") },
      { triggerRef: `${oldEpisode}:final_warning`, status: "sent", sentAt: new Date("2026-08-07T12:00:00.000Z") },
    ];
    const r = recoveryForMember(member(), mixed, "past_due", new Date("2026-10-05T12:00:00.000Z"));
    expect(r.stepsSent).toBe(2);
    expect(r.lastStepKey).toBe("payment_reminder");
  });

  it("no sends yet reads as an honest zero, not a placeholder", () => {
    const r = recoveryForMember(member(), [], "past_due", FAILED_AT);
    expect(r.stepsSent).toBe(0);
    expect(r.lastStepKey).toBeNull();
    expect(r.lastSentAt).toBeNull();
    expect(r.state).toBe("in_grace");
  });
});
