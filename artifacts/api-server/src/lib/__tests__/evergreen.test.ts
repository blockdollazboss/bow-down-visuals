import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVERGREEN_SETTINGS,
  EVERGREEN_COPY,
  buildEvergreenProposals,
  evergreenSkipReason,
  isEvergreenEligible,
  nextEvergreenSlot,
  normalizeEvergreenSettings,
  spacingDaysForCycle,
  type EvergreenCandidateInput,
  type EvergreenSettings,
} from "../evergreen";

const ON: EvergreenSettings = { ...DEFAULT_EVERGREEN_SETTINGS, enabled: true };
const NOW = new Date("2026-10-25T12:00:00Z"); // a Sunday

function candidate(over: Partial<EvergreenCandidateInput> = {}): EvergreenCandidateInput {
  return {
    postId: "post-1",
    status: "posted",
    postedAt: new Date(NOW.getTime() - 40 * 86_400_000),
    platforms: ["instagram"],
    cyclesUsed: 0,
    lastRecycledAt: null,
    hasPendingProposal: false,
    ...over,
  };
}

describe("evergreen settings", () => {
  it("defaults to OFF — nothing queues for a creator who never opted in", () => {
    expect(DEFAULT_EVERGREEN_SETTINGS.enabled).toBe(false);
    expect(isEvergreenEligible(candidate(), DEFAULT_EVERGREEN_SETTINGS, NOW)).toBe(false);
  });

  it("normalizes valid settings and rejects bad windows", () => {
    const ok = normalizeEvergreenSettings({
      enabled: true,
      windows: { days: [5, 3, 3], startHour: 18, endHour: 20, timezone: "America/Chicago" },
      baseSpacingDays: 10,
      maxCycles: 2,
    });
    expect("settings" in ok && ok.settings.windows.days).toEqual([3, 5]);
    expect("settings" in ok && ok.settings.baseSpacingDays).toBe(10);
    const bad = normalizeEvergreenSettings({ windows: { days: [], startHour: 18, endHour: 20, timezone: "UTC" } });
    expect("error" in bad).toBe(true);
    const badTz = normalizeEvergreenSettings({ windows: { days: [1], startHour: 1, endHour: 2, timezone: "Not/AZone" } });
    expect("error" in badTz).toBe(true);
    const badHours = normalizeEvergreenSettings({ windows: { days: [1], startHour: 20, endHour: 20, timezone: "UTC" } });
    expect("error" in badHours).toBe(true);
  });
});

describe("evergreen eligibility — proven posts, spacing, decay stop", () => {
  it("accepts a rested, posted back-catalog post", () => {
    expect(evergreenSkipReason(candidate(), ON, NOW)).toBeNull();
    expect(isEvergreenEligible(candidate(), ON, NOW)).toBe(true);
  });

  it("rejects drafts, fresh posts, and posts that never posted", () => {
    expect(evergreenSkipReason(candidate({ status: "draft" }), ON, NOW)).toBe("not_posted");
    expect(evergreenSkipReason(candidate({ postedAt: new Date(NOW.getTime() - 3 * 86_400_000) }), ON, NOW)).toBe("too_new");
  });

  it("spacing doubles each cycle and max cycles is a hard stop", () => {
    expect(spacingDaysForCycle(7, 1)).toBe(7);
    expect(spacingDaysForCycle(7, 2)).toBe(14);
    expect(spacingDaysForCycle(7, 3)).toBe(28);
    // Cycle 2 needs 14 days since the last resurfacing; 10 is too soon.
    const tooSoon = candidate({ cyclesUsed: 1, lastRecycledAt: new Date(NOW.getTime() - 10 * 86_400_000) });
    expect(evergreenSkipReason(tooSoon, ON, NOW)).toBe("spacing");
    const rested = candidate({ cyclesUsed: 1, lastRecycledAt: new Date(NOW.getTime() - 20 * 86_400_000) });
    expect(evergreenSkipReason(rested, ON, NOW)).toBeNull();
    expect(evergreenSkipReason(candidate({ cyclesUsed: 3 }), ON, NOW)).toBe("max_cycles");
  });

  it("never proposes a post twice while a proposal is pending", () => {
    expect(evergreenSkipReason(candidate({ hasPendingProposal: true }), ON, NOW)).toBe("pending_proposal");
  });
});

describe("evergreen slots + proposals", () => {
  it("next slot lands inside the creator's windows, after now", () => {
    const slot = nextEvergreenSlot(ON.windows, NOW); // windows: Tue/Thu 17–21 ET
    expect(slot).not.toBeNull();
    expect(slot!.getTime()).toBeGreaterThan(NOW.getTime());
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(slot!);
    const wd = parts.find((p) => p.type === "weekday")?.value;
    const hr = Number(parts.find((p) => p.type === "hour")?.value);
    expect(["Tue", "Thu"]).toContain(wd);
    expect(hr).toBeGreaterThanOrEqual(17);
    expect(hr).toBeLessThan(21);
  });

  it("builds one staggered proposal per eligible post and counts skips honestly", () => {
    const { proposals, skipped } = buildEvergreenProposals(
      [
        candidate({ postId: "a" }),
        candidate({ postId: "b" }),
        candidate({ postId: "c", status: "draft" }),
        candidate({ postId: "d", cyclesUsed: 3 }),
      ],
      ON,
      NOW,
    );
    expect(proposals.map((p) => p.sourcePostId)).toEqual(["a", "b"]);
    expect(proposals[0]!.cycle).toBe(1);
    expect(proposals[1]!.proposedSlot.getTime()).toBeGreaterThan(proposals[0]!.proposedSlot.getTime());
    expect(skipped.not_posted).toBe(1);
    expect(skipped.max_cycles).toBe(1);
  });

  it("builds nothing while the creator's switch is off", () => {
    const { proposals } = buildEvergreenProposals([candidate()], DEFAULT_EVERGREEN_SETTINGS, NOW);
    expect(proposals).toEqual([]);
  });

  it("carries the never-auto-post honesty copy", () => {
    expect(EVERGREEN_COPY.neverAutoPosts).toContain("never posts on its own");
  });
});
