import { describe, it, expect } from "vitest";
import { dropCountdown, dropTargetMs, formatDropLocal, pad2 } from "../product-drop";

/* The drop instant is a UTC ISO string; the countdown is pure distance
   math, identical in every timezone. Local-time rendering goes through
   Intl — pinned here only for shape (the exact wall-clock text is the
   viewer's locale, by design). */

const DROP = "2026-11-14T00:00:00.000Z";
const DROP_MS = Date.UTC(2026, 10, 14);

describe("dropTargetMs", () => {
  it("parses the UTC instant and rejects junk", () => {
    expect(dropTargetMs(DROP)).toBe(DROP_MS);
    expect(dropTargetMs("2026-11-13T19:00:00-05:00")).toBe(DROP_MS); // same instant, offset form
    expect(dropTargetMs("not-a-date")).toBeNull();
    expect(dropTargetMs(null)).toBeNull();
    expect(dropTargetMs(undefined)).toBeNull();
    expect(dropTargetMs("")).toBeNull();
  });
});

describe("dropCountdown", () => {
  it("breaks the distance into days/hours/minutes/seconds", () => {
    const now = DROP_MS - ((2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000);
    expect(dropCountdown(DROP, now)).toEqual({
      totalMs: (2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000,
      isLive: false, days: 2, hours: 3, minutes: 4, seconds: 5,
    });
  });

  it("is live at and after the instant — never a second early", () => {
    expect(dropCountdown(DROP, DROP_MS - 1)?.isLive).toBe(false);
    expect(dropCountdown(DROP, DROP_MS - 1)?.seconds).toBe(0);
    expect(dropCountdown(DROP, DROP_MS)?.isLive).toBe(true);
    expect(dropCountdown(DROP, DROP_MS + 60_000)).toMatchObject({ isLive: true, days: 0, seconds: 0 });
  });

  it("returns null without a parseable moment", () => {
    expect(dropCountdown(null, DROP_MS)).toBeNull();
    expect(dropCountdown("junk", DROP_MS)).toBeNull();
  });
});

describe("formatDropLocal + pad2", () => {
  it("renders a local date/time string for the instant", () => {
    const s = formatDropLocal(DROP);
    expect(typeof s).toBe("string");
    expect(s).toContain("2026");
    expect(formatDropLocal("junk")).toBeNull();
    expect(formatDropLocal(null)).toBeNull();
  });

  it("pads countdown units", () => {
    expect(pad2(0)).toBe("00");
    expect(pad2(7)).toBe("07");
    expect(pad2(42)).toBe("42");
  });
});
