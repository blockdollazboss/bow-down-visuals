import { describe, expect, it } from "vitest";
import { formatJackpotDate, rollBuffer } from "../cheat-code-jackpot-logic";

describe("rollBuffer", () => {
  it("accumulates directions up to the code length", () => {
    let buf: ("up" | "down" | "left" | "right")[] = [];
    buf = rollBuffer(buf, "up", 3);
    buf = rollBuffer(buf, "down", 3);
    expect(buf).toEqual(["up", "down"]);
  });

  it("drops the oldest move once full (rolling window)", () => {
    const buf = rollBuffer(["up", "up", "down"], "left", 3);
    expect(buf).toEqual(["up", "down", "left"]);
  });

  it("never exceeds the max even with many presses", () => {
    let buf: ("up" | "down")[] = [];
    for (let i = 0; i < 20; i++) buf = rollBuffer(buf, "up", 4);
    expect(buf).toHaveLength(4);
  });
});

describe("formatJackpotDate", () => {
  it("formats an ISO date as 'Mon D, YYYY'", () => {
    /* The label renders the instant on the VIEWER's clock, so the
     * expected date is derived from the instant's local components —
     * a literal only holds in zones where 14:32Z stays on Mar 24
     * (under UTC+14 it is already Mar 25). The short month name, the
     * unpadded day and the ", YYYY" shape stay pinned. */
    const d = new Date("2027-03-24T14:32:00.000Z");
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    expect(formatJackpotDate("2027-03-24T14:32:00.000Z")).toBe(`${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`);
  });

  it("returns an em dash for missing/invalid input", () => {
    expect(formatJackpotDate(null)).toBe("—");
    expect(formatJackpotDate(undefined)).toBe("—");
    expect(formatJackpotDate("not-a-date")).toBe("—");
  });
});
