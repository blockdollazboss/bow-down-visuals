import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Stack-28 #54 (A5-M2) — pinch zoom must not be disabled site-wide. */
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

describe("viewport zoom (Stack-28 #54)", () => {
  it("no maximum-scale / user-scalable cap; viewport-fit kept", () => {
    expect(html).not.toContain("maximum-scale");
    expect(html).not.toContain("user-scalable");
    expect(html).toContain('content="width=device-width, initial-scale=1.0, viewport-fit=cover"');
  });
});
