import { describe, expect, it } from "vitest";
import { formatVb, monthLabel } from "./community-grants";

describe("community grants — frontend helpers", () => {
  it("monthLabel renders the round's month key as a plain label", () => {
    expect(monthLabel("2026-11")).toBe("November 2026");
    expect(monthLabel("2027-01")).toBe("January 2027");
    expect(monthLabel("not-a-month")).toBe("not-a-month");
  });

  it("formatVb formats whatever amount the API recorded — no local figure", () => {
    expect(formatVb(5000)).toBe("5,000 VB");
    expect(formatVb(1)).toBe("1 VB");
  });
});
