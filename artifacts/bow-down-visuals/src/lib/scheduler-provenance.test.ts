/* Provenance in Publish/Scheduler (Stack-100 #3, wave 3) — FE pins:
   the tolerant snapshot reader never invents a record, and the
   pre-publish disclosure plan matches the API's honest matrix
   (caption for Instagram/Facebook, record-page-only for TikTok,
   nothing claimed when no AI generation is recorded). */
import { describe, it, expect } from "vitest";
import {
  postProvenance,
  disclosureChannelFor,
  type ScheduledPostProvenanceShape,
} from "./scheduler";

const snap: ScheduledPostProvenanceShape = {
  assetId: "gen:abc-123",
  title: "Shark Anthem",
  tool: "AI Video Clip",
  model: "Runway",
  aiGenerated: true,
  licence: "cc-by-4.0",
  disclosureLine: "This video was created with AI assistance using AI Video Clip (Runway) on Bow Down Visuals.",
  linkedAt: "2026-10-24T12:00:00.000Z",
};

describe("postProvenance", () => {
  it("reads a well-formed snapshot verbatim", () => {
    expect(postProvenance({ provenance: snap } as never)).toEqual(snap);
  });
  it("returns null for absent, null, or malformed provenance — never derives one from a URL", () => {
    expect(postProvenance({} as never)).toBeNull();
    expect(postProvenance({ provenance: null } as never)).toBeNull();
    expect(postProvenance({ provenance: { assetId: 42 } } as never)).toBeNull();
    expect(postProvenance({ mediaUrl: "https://cdn.example.com/x.mp4" } as never)).toBeNull();
    expect(postProvenance(null)).toBeNull();
    expect(postProvenance(undefined)).toBeNull();
  });
  it("fills honest defaults for optional fields instead of dropping the record", () => {
    const got = postProvenance({ provenance: { assetId: "hub:e1", tool: "Video studio" } } as never);
    expect(got).toMatchObject({ assetId: "hub:e1", aiGenerated: false, licence: "all-rights-reserved", model: null });
  });
});

describe("disclosureChannelFor (FE mirror of the API plan)", () => {
  it("AI record: caption on instagram/facebook, record_only on tiktok", () => {
    expect(disclosureChannelFor("instagram", snap)).toBe("caption");
    expect(disclosureChannelFor("facebook", snap)).toBe("caption");
    expect(disclosureChannelFor("tiktok", snap)).toBe("record_only");
  });
  it("no record or non-AI record → not_applicable on every platform", () => {
    for (const p of ["instagram", "facebook", "tiktok"] as const) {
      expect(disclosureChannelFor(p, null)).toBe("not_applicable");
      expect(disclosureChannelFor(p, { aiGenerated: false })).toBe("not_applicable");
    }
  });
});
