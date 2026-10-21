import { describe, it, expect } from "vitest";
import { REMOVAL_REASONS, removalReasonLabel, parseContentId } from "./content-removal";

/* Stack-4 — pins for the content-removal client helpers: the reason
   vocabulary the admin panel offers (mirrors the server's
   POST_REMOVAL_REASONS), the labels an author sees on a removed
   post, and the paste parser behind the admin lookup box. */

const ID = "33333333-3333-4333-8333-333333333333";

describe("removal reasons", () => {
  it("the vocabulary is the server's eight categories", () => {
    expect([...REMOVAL_REASONS]).toEqual([
      "spam",
      "harassment",
      "hate_speech",
      "violence",
      "sexual_content",
      "copyright",
      "impersonation",
      "other",
    ]);
  });

  it("every category has a human label", () => {
    for (const r of REMOVAL_REASONS) {
      expect(removalReasonLabel(r)).toBeTruthy();
      expect(removalReasonLabel(r)).not.toBe(r);
    }
    expect(removalReasonLabel("harassment")).toBe("Harassment");
    expect(removalReasonLabel("hate_speech")).toBe("Hate speech");
  });

  it("unknown or missing reasons fall back to the generic label", () => {
    expect(removalReasonLabel("made_up_code")).toBe("Other policy violation");
    expect(removalReasonLabel(null)).toBe("Other policy violation");
    expect(removalReasonLabel(undefined)).toBe("Other policy violation");
  });
});

describe("parseContentId", () => {
  it("accepts a bare ID, with or without surrounding space", () => {
    expect(parseContentId(ID)).toBe(ID);
    expect(parseContentId(`  ${ID}  `)).toBe(ID);
  });

  it("pulls the ID out of a post link", () => {
    expect(parseContentId(`https://bowdownvisuals.com/post/${ID}`)).toBe(ID);
    expect(parseContentId(`/post/${ID}`)).toBe(ID);
  });

  it("normalizes case", () => {
    expect(parseContentId(ID.toUpperCase())).toBe(ID);
  });

  it("returns null when there is no ID to act on", () => {
    expect(parseContentId("")).toBeNull();
    expect(parseContentId("not an id")).toBeNull();
    expect(parseContentId("https://bowdownvisuals.com/feed")).toBeNull();
  });
});
