/**
 * Guest scene-source model tests (stream-kit): the "guest" source
 * type's defaults, label, and duplication behavior.
 */
import { describe, it, expect } from "vitest";
import { createSource, duplicateSource, SOURCE_TYPE_LABELS } from "./scenes";

describe("guest scene source", () => {
  it("has a label and starts as an unassigned corner tile", () => {
    expect(SOURCE_TYPE_LABELS.guest).toBe("Guest");
    const source = createSource("guest");
    expect(source.type).toBe("guest");
    expect(source.guest).toEqual({ sessionId: "", name: "" });
    /* picture-in-picture corner, not a full-frame takeover */
    expect(source.w).toBeLessThan(0.5);
    expect(source.h).toBeLessThan(0.5);
    expect(source.x).toBeGreaterThan(0.5);
  });

  it("duplication carries the guest binding", () => {
    const source = { ...createSource("guest"), guest: { sessionId: "g1", name: "Casey" } };
    const copy = duplicateSource(source);
    expect(copy.guest).toEqual({ sessionId: "g1", name: "Casey" });
    expect(copy.id).not.toBe(source.id);
  });
});
