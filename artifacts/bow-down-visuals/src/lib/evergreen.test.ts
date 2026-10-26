import { describe, expect, it } from "vitest";
import {
  DAY_LABELS,
  EVERGREEN_COPY,
  evergreenProposalActionPath,
  proposalStatusLabel,
  settingsValidationError,
  skipReasonLabel,
  type EvergreenSettingsDto,
} from "./evergreen";

const VALID: EvergreenSettingsDto = {
  enabled: true,
  windows: { days: [2, 4], startHour: 17, endHour: 21, timezone: "America/New_York" },
  base_spacing_days: 7,
  max_cycles: 3,
};

describe("evergreen client contract", () => {
  it("carries the never-auto-post copy, sentence-identical to the server", () => {
    expect(EVERGREEN_COPY.neverAutoPosts).toContain("never posts on its own");
    expect(EVERGREEN_COPY.approvalGate).toContain("approval first");
    expect(EVERGREEN_COPY.decayStop).toContain("doubles every cycle");
  });

  it("explains every skip reason in plain words", () => {
    expect(skipReasonLabel(null)).toBe("Ready to resurface");
    expect(skipReasonLabel("too_new")).toContain("14 days");
    expect(skipReasonLabel("max_cycles")).toContain("cycle cap");
    expect(skipReasonLabel("spacing")).toContain("Resting");
    expect(skipReasonLabel("pending_proposal")).toContain("waiting on you");
  });

  it("labels proposal states honestly — approved means a draft, not a post", () => {
    expect(proposalStatusLabel("pending_approval")).toContain("approval");
    expect(proposalStatusLabel("approved")).toContain("draft created");
  });

  it("validates settings like the server", () => {
    expect(settingsValidationError(VALID)).toBeNull();
    expect(settingsValidationError({ ...VALID, windows: { ...VALID.windows, days: [] } })).toContain("at least one day");
    expect(settingsValidationError({ ...VALID, max_cycles: 9 })).toContain("1–6");
  });

  it("builds action paths and day labels", () => {
    expect(evergreenProposalActionPath("a b", "approve")).toBe("/api/evergreen/proposals/a%20b/approve");
    expect(DAY_LABELS).toHaveLength(7);
  });
});
