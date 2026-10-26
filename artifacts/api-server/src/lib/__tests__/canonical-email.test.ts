import { describe, expect, it } from "vitest";
import { canonicalEmail } from "../canonical-email";

describe("canonicalEmail", () => {
  it("lowercases and trims", () => {
    expect(canonicalEmail("  Fan@Example.COM ")).toBe("fan@example.com");
  });

  it("strips a +tag on any domain", () => {
    expect(canonicalEmail("fan+promo@example.com")).toBe("fan@example.com");
    expect(canonicalEmail("fan+a+b@example.com")).toBe("fan@example.com");
  });

  it("strips dots for gmail and folds googlemail onto gmail", () => {
    expect(canonicalEmail("f.a.n@gmail.com")).toBe("fan@gmail.com");
    expect(canonicalEmail("fan@googlemail.com")).toBe("fan@gmail.com");
    expect(canonicalEmail("f.a.n+promo@googlemail.com")).toBe("fan@gmail.com");
  });

  it("keeps dots for non-gmail domains", () => {
    expect(canonicalEmail("f.a.n@example.com")).toBe("f.a.n@example.com");
  });

  it("plus-alias and gmail-dot variants of one inbox canonicalize equal", () => {
    const base = canonicalEmail("bowdownvisuals+testb@gmail.com");
    expect(canonicalEmail("bowdownvisuals@gmail.com")).toBe(base);
    expect(canonicalEmail("bow.down.visuals@gmail.com")).toBe(base);
    expect(canonicalEmail("bowdownvisuals+testc@gmail.com")).toBe(base);
  });

  it("genuinely different mailboxes stay different", () => {
    expect(canonicalEmail("fan@example.com")).not.toBe(
      canonicalEmail("other@example.com"),
    );
    expect(canonicalEmail("fan@gmail.com")).not.toBe(
      canonicalEmail("fan@example.com"),
    );
  });

  it("returns null for unusable input", () => {
    expect(canonicalEmail(null)).toBeNull();
    expect(canonicalEmail(undefined)).toBeNull();
    expect(canonicalEmail("")).toBeNull();
    expect(canonicalEmail("not-an-email")).toBeNull();
    expect(canonicalEmail("@gmail.com")).toBeNull();
    expect(canonicalEmail("fan@gmail")).toBeNull();
  });
});
