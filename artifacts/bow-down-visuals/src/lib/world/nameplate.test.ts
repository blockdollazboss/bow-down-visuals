/**
 * Nameplate label logic (lib/world/nameplate) — THE-GAME §5 Q1:
 * stars live on the nameplate beside the name, never on the
 * character. These tests pin the WORDING the scene paints.
 */
import { describe, it, expect } from "vitest";
import { nameplateSub, nameplateTitle, starsMark, type NameplatePeer } from "./nameplate";

const peer = (over: Partial<NameplatePeer> = {}): NameplatePeer => ({
  displayName: "Nova Vale",
  guest: false,
  voiceOff: false,
  voiceDeaf: false,
  profileSlug: "nova",
  ...over,
});

describe("starsMark", () => {
  it("one mark per star, 1 through 6", () => {
    expect(starsMark(1)).toBe("★");
    expect(starsMark(3)).toBe("★★★");
    expect(starsMark(6)).toBe("★★★★★★");
  });

  it("no record, no marks — never a fake zero", () => {
    expect(starsMark(undefined)).toBe("");
    expect(starsMark(null)).toBe("");
    expect(starsMark(0)).toBe("");
    expect(starsMark(2.5)).toBe("");
  });
});

describe("nameplateTitle", () => {
  it("stars ride beside the name", () => {
    expect(nameplateTitle(peer({ stars: 4 }))).toBe("Nova Vale ★★★★");
  });

  it("a starless peer's plate is just the name", () => {
    expect(nameplateTitle(peer())).toBe("Nova Vale");
    expect(nameplateTitle(peer({ guest: true, profileSlug: null }))).toBe("Nova Vale");
  });

  it("the name is clipped to the plate's 24 chars before stars are added", () => {
    const long = peer({ displayName: "A".repeat(40), stars: 1 });
    expect(nameplateTitle(long)).toBe(`${"A".repeat(24)} ★`);
  });
});

describe("nameplateSub", () => {
  it("voice states outrank identity lines", () => {
    expect(nameplateSub(peer({ voiceOff: true }))).toBe("voice off");
    expect(nameplateSub(peer({ voiceOff: true, voiceDeaf: true }))).toBe("voice off");
    expect(nameplateSub(peer({ voiceDeaf: true }))).toBe("deafened");
  });

  it("guests read as guests; members read as their slug / Front Row honor", () => {
    expect(nameplateSub(peer({ guest: true, profileSlug: null }))).toBe("guest");
    expect(nameplateSub(peer())).toBe("@nova");
    expect(nameplateSub(peer(), true)).toBe("Front Row · @nova");
    expect(nameplateSub(peer({ profileSlug: null }), true)).toBe("Front Row");
    expect(nameplateSub(peer({ profileSlug: null }))).toBe("");
  });
});
