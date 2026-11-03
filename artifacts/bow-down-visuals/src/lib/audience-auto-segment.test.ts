/**
 * audience-auto-segment.test.ts — org wave #2, rank 6b.
 *
 * Pins the Promote step's auto-attached audience segment: the pick is
 * the live fan-segment preset with the most fans (server order breaks
 * ties), an all-empty graph attaches nothing (no invented segment),
 * the response parser tolerates junk, and the Promote page actually
 * mounts the card fed by the pick.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pickAutoSegment, presetsFromFanSegmentsResponse } from "./audience-auto-segment";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const seg = (id: string, count: number) => ({ id, name: id, count });

describe("pickAutoSegment — the attach rule", () => {
  it("picks the preset reaching the most fans", () => {
    expect(pickAutoSegment([seg("buyers", 12), seg("everyone", 340), seg("members", 40)])?.id).toBe("everyone");
  });

  it("keeps server order on a tie", () => {
    expect(pickAutoSegment([seg("a", 50), seg("b", 50)])?.id).toBe("a");
  });

  it("attaches nothing when every preset is empty", () => {
    expect(pickAutoSegment([seg("a", 0), seg("b", 0)])).toBeNull();
    expect(pickAutoSegment([])).toBeNull();
  });

  it("skips malformed entries instead of crashing the promote page", () => {
    const junk = [{ id: "x", name: "x", count: Number.NaN }, seg("ok", 3)] as never[];
    expect(pickAutoSegment(junk)?.id).toBe("ok");
  });
});

describe("presetsFromFanSegmentsResponse — the tolerant read", () => {
  it("extracts well-formed presets", () => {
    const out = presetsFromFanSegmentsResponse({ presets: [seg("a", 1), { id: 7, name: "bad", count: 2 }, null] });
    expect(out.map((p) => p.id)).toEqual(["a"]);
  });

  it("returns [] for anything that isn't the fan-segments shape", () => {
    expect(presetsFromFanSegmentsResponse(null)).toEqual([]);
    expect(presetsFromFanSegmentsResponse({})).toEqual([]);
    expect(presetsFromFanSegmentsResponse({ presets: "nope" })).toEqual([]);
  });
});

describe("promote wiring — the segment is attached in the promote step", () => {
  it("promote.tsx mounts the auto-segment card", () => {
    const src = read("../pages/promote.tsx");
    expect(src).toContain('import { AudienceAutoSegment } from "@/components/promote/AudienceAutoSegment"');
    expect(src).toContain("<AudienceAutoSegment />");
  });

  it("the card reads the fan-segments rail and attaches via the pick", () => {
    const src = read("../components/promote/AudienceAutoSegment.tsx");
    expect(src).toContain("/api/email-list/fan-segments");
    expect(src).toContain("pickAutoSegment(presetsFromFanSegmentsResponse(data))");
    expect(src).toContain('data-testid="audience-auto-segment"');
    // Both themes designed.
    expect(src).toContain("useIsLightTheme");
  });
});
