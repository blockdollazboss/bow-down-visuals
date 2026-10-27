import { describe, it, expect } from "vitest";
import { formatJarAmount, jarAbsoluteUrl, jarPath } from "./one-tip-jar";

describe("one tip jar (FE)", () => {
  it("builds the one canonical address for handles and slugs alike", () => {
    expect(jarPath("sharkking")).toBe("/tips/sharkking");
    expect(jarPath("shark king")).toBe("/tips/shark%20king");
  });

  it("QR targets are the absolute canonical address", () => {
    expect(jarAbsoluteUrl("sharkking", "https://bowdownvisuals.com")).toBe(
      "https://bowdownvisuals.com/tips/sharkking",
    );
    expect(jarAbsoluteUrl("sharkking", "https://bowdownvisuals.com/")).toBe(
      "https://bowdownvisuals.com/tips/sharkking",
    );
  });

  it("formats each unit in its own lane", () => {
    expect(formatJarAmount({ unit: "USD", amount: 2500 })).toBe("$25.00");
    expect(formatJarAmount({ unit: "VB", amount: 1300 })).toBe("1,300 VB");
  });
});
