/* Publish/Scheduler provenance bridge (Stack-100 #3, wave 3) — pure pins:
   asset-id parsing, the schedule-time snapshot, the honest per-platform
   disclosure channels, and caption delivery that never fakes a channel
   the destination doesn't have (TikTok drafts take no caption/label). */
import { describe, it, expect } from "vitest";
import {
  parseProvenanceAssetId,
  snapshotProvenanceForPublish,
  disclosureChannelFor,
  disclosurePlanFor,
  captionWithDisclosure,
} from "../publish-provenance";
import { buildProvenanceRecord } from "../provenance";
import type { ScheduledPostProvenance } from "@workspace/db";

const genRecord = buildProvenanceRecord({
  assetId: "gen:abc-123",
  title: "Shark Anthem",
  mediaKind: "video",
  origin: "generation",
  creatorId: "user-1",
  creatorName: "TRGDY",
  createdAt: "2026-10-20T00:00:00.000Z",
  generationType: "runway_video_clip",
  prompt: "a shark in a crown",
  creditsUsed: 4,
  saveStatus: "saved",
  storedLicence: "cc-by-4.0",
});

const hubRecord = buildProvenanceRecord({
  assetId: "hub:entry-9",
  title: "Uploaded cover",
  mediaKind: "image",
  origin: "project",
  creatorId: "user-1",
  creatorName: null,
  createdAt: "2026-10-21T00:00:00.000Z",
  hubKind: "thumbnail",
});

describe("parseProvenanceAssetId", () => {
  it("accepts gen: and hub: library ids", () => {
    expect(parseProvenanceAssetId("gen:abc-123")).toEqual({ kind: "gen", id: "abc-123", assetId: "gen:abc-123" });
    expect(parseProvenanceAssetId(" hub:entry-9 ")).toEqual({ kind: "hub", id: "entry-9", assetId: "hub:entry-9" });
  });
  it("rejects urls, bare ids, unknown kinds and non-strings", () => {
    expect(parseProvenanceAssetId("https://cdn.example.com/x.mp4")).toBeNull();
    expect(parseProvenanceAssetId("abc-123")).toBeNull();
    expect(parseProvenanceAssetId("xyz:abc")).toBeNull();
    expect(parseProvenanceAssetId("gen:")).toBeNull();
    expect(parseProvenanceAssetId(42)).toBeNull();
    expect(parseProvenanceAssetId(null)).toBeNull();
  });
});

describe("snapshotProvenanceForPublish", () => {
  it("snapshots only what the record proves — tool, pinned model, licence, disclosure line", () => {
    const snap = snapshotProvenanceForPublish(genRecord, new Date("2026-10-24T12:00:00.000Z"));
    expect(snap).toEqual({
      assetId: "gen:abc-123",
      title: "Shark Anthem",
      tool: "AI Video Clip",
      model: "Runway",
      aiGenerated: true,
      licence: "cc-by-4.0",
      disclosureLine:
        "This video was created with AI assistance using AI Video Clip (Runway) on Bow Down Visuals.",
      linkedAt: "2026-10-24T12:00:00.000Z",
    });
  });
  it("a hub upload records no AI generation and an empty disclosure line", () => {
    const snap = snapshotProvenanceForPublish(hubRecord);
    expect(snap.aiGenerated).toBe(false);
    expect(snap.disclosureLine).toBe("");
    expect(snap.licence).toBe("all-rights-reserved");
  });
});

const aiSnap: ScheduledPostProvenance = snapshotProvenanceForPublish(genRecord);
const plainSnap: ScheduledPostProvenance = snapshotProvenanceForPublish(hubRecord);

describe("disclosureChannelFor / disclosurePlanFor — the honest matrix", () => {
  it("AI asset: caption for Instagram/Facebook, record_only for TikTok", () => {
    expect(disclosureChannelFor("instagram", aiSnap)).toBe("caption");
    expect(disclosureChannelFor("facebook", aiSnap)).toBe("caption");
    expect(disclosureChannelFor("tiktok", aiSnap)).toBe("record_only");
    expect(disclosurePlanFor(["instagram", "tiktok", "facebook"], aiSnap)).toEqual({
      instagram: "caption",
      tiktok: "record_only",
      facebook: "caption",
    });
  });
  it("no snapshot or no AI generation → not_applicable everywhere", () => {
    for (const p of ["instagram", "tiktok", "facebook"] as const) {
      expect(disclosureChannelFor(p, null)).toBe("not_applicable");
      expect(disclosureChannelFor(p, undefined)).toBe("not_applicable");
      expect(disclosureChannelFor(p, plainSnap)).toBe("not_applicable");
    }
  });
});

describe("captionWithDisclosure", () => {
  it("appends the disclosure line to Instagram/Facebook captions", () => {
    const out = captionWithDisclosure("New drop 🔥", aiSnap, "instagram");
    expect(out).toBe(`New drop 🔥\n\n${aiSnap.disclosureLine}`);
    expect(captionWithDisclosure("New drop 🔥", aiSnap, "facebook")).toBe(out);
  });
  it("never touches the TikTok caption — nothing is faked for a channel TikTok doesn't have", () => {
    expect(captionWithDisclosure("New drop 🔥", aiSnap, "tiktok")).toBe("New drop 🔥");
  });
  it("is idempotent and leaves non-AI / unlinked captions untouched", () => {
    const once = captionWithDisclosure("New drop 🔥", aiSnap, "instagram");
    expect(captionWithDisclosure(once, aiSnap, "instagram")).toBe(once);
    expect(captionWithDisclosure("plain", plainSnap, "instagram")).toBe("plain");
    expect(captionWithDisclosure("plain", null, "instagram")).toBe("plain");
  });
});
