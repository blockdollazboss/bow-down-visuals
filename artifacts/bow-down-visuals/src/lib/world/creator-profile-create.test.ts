/**
 * creator-profile-create — Stack-100 #48.
 * In-world creator-profile creation on the real rails
 * (GET /creator-profiles/me, GET /creator-profiles/check-slug,
 * POST /creator-profiles). Pins: slug rules mirror the rail's
 * slugSchema, the live-check states, the form gate (no create
 * until the handle is confirmed available), the create payload's
 * field names, and the already-has-a-profile parse.
 */
import { describe, expect, it } from "vitest";
import {
  buildCreatorProfilePayload,
  creatorProfileErrorLine,
  creatorProfileFormProblem,
  creatorSlugProblem,
  normalizeCreatorSlug,
  parseMyCreatorProfile,
  parseSlugCheck,
  slugCheckLine,
  slugifyCreatorSlug,
  type SlugCheckState,
} from "./creator-profile-create";

const AVAILABLE: SlugCheckState = { kind: "available", slug: "king-shark" };

describe("slug rules — the rail's slugSchema, mirrored locally", () => {
  it("slugifies a display name into the slug alphabet", () => {
    expect(slugifyCreatorSlug("King Shark!")).toBe("king-shark");
    expect(slugifyCreatorSlug("  TRGDY   TRBLZ ")).toBe("trgdy-trblz");
    expect(slugifyCreatorSlug("---")).toBe("");
  });

  it("accepts good handles and names the problem with bad ones", () => {
    expect(creatorSlugProblem("king-shark")).toBeNull();
    expect(creatorSlugProblem("ks2")).toBeNull();
    expect(creatorSlugProblem("ab")).toContain("at least 3");
    expect(creatorSlugProblem("King Shark")).toContain("lowercase letters");
    expect(creatorSlugProblem("-king-")).toContain("lowercase letters");
    expect(creatorSlugProblem("a".repeat(41))).toContain("at most 40");
    expect(normalizeCreatorSlug("  King-Shark ")).toBe("king-shark");
  });
});

describe("check-slug — live availability states", () => {
  it("parses available / taken / invalid exactly as the rail answers", () => {
    expect(parseSlugCheck({ available: true, valid: true, slug: "king-shark" }, "king-shark")).toEqual(AVAILABLE);
    expect(parseSlugCheck({ available: false, valid: true, slug: "taken-one" }, "taken-one")).toEqual({
      kind: "taken",
      slug: "taken-one",
    });
    const invalid = parseSlugCheck({ available: false, valid: false, error: "Slug must be 3-40 chars…" }, "x");
    expect(invalid.kind).toBe("invalid");
    expect(slugCheckLine(invalid)).toContain("3-40");
    expect(slugCheckLine(AVAILABLE)).toContain("yours to claim");
    expect(slugCheckLine({ kind: "taken", slug: "taken-one" })).toContain("already claimed");
    expect(slugCheckLine({ kind: "idle" })).toBeNull();
    expect(slugCheckLine({ kind: "checking" })).toContain("Checking");
  });
});

describe("the create form gate + payload (success path)", () => {
  it("refuses until the name is set and THIS slug checked available", () => {
    expect(creatorProfileFormProblem({ displayName: "", slug: "king-shark", slugCheck: AVAILABLE })).toContain("display name");
    expect(creatorProfileFormProblem({ displayName: "King", slug: "king-shark", slugCheck: { kind: "idle" } })).toContain("handle check");
    expect(
      creatorProfileFormProblem({ displayName: "King", slug: "king-shark", slugCheck: { kind: "taken", slug: "king-shark" } }),
    ).toContain("already claimed");
    // A check for a DIFFERENT slug never unlocks this one.
    expect(
      creatorProfileFormProblem({ displayName: "King", slug: "king-shark-2", slugCheck: AVAILABLE }),
    ).toContain("handle check");
    expect(creatorProfileFormProblem({ displayName: "King", slug: "king-shark", slugCheck: AVAILABLE })).toBeNull();
  });

  it("builds the rail's own field names, with a known vertical or the music default", () => {
    expect(
      buildCreatorProfilePayload({ displayName: " King Shark ", slug: "King-Shark", bio: " I make waves. ", vertical: "gaming" }),
    ).toEqual({
      slug: "king-shark",
      display_name: "King Shark",
      bio: "I make waves.",
      vertical: "gaming",
      is_public: true,
    });
    expect(buildCreatorProfilePayload({ displayName: "K", slug: "king-shark", bio: "", vertical: "nope" }).vertical).toBe("music");
  });

  it("the created profile parses from the POST answer's wrapped shape", () => {
    const created = parseMyCreatorProfile({
      created: true,
      profile: { id: "p1", slug: "king-shark", display_name: "King Shark", vertical: "gaming", bio: "waves" },
    });
    expect(created).toEqual({ id: "p1", slug: "king-shark", displayName: "King Shark", vertical: "gaming", bio: "waves" });
  });

  it("server errors surface in the rail's own words", () => {
    expect(creatorProfileErrorLine({ error: "That handle's already claimed." }, "fallback")).toBe(
      "That handle's already claimed.",
    );
    expect(creatorProfileErrorLine({}, "fallback")).toBe("fallback");
    expect(creatorProfileErrorLine(null, "fallback")).toBe("fallback");
  });
});

describe("already-has-a-profile path", () => {
  it("the /me payload (top-level snake_case) parses to the member's profile", () => {
    const mine = parseMyCreatorProfile({
      id: "p9",
      slug: "trgdy-trblz",
      display_name: "TRGDY TRBLZ",
      vertical: "music",
      bio: "",
      referral_code: "abc",
    });
    expect(mine?.slug).toBe("trgdy-trblz");
    expect(mine?.displayName).toBe("TRGDY TRBLZ");
  });

  it("an empty or profile-less answer parses to null — the create form's cue", () => {
    expect(parseMyCreatorProfile({ error: "No profile yet" })).toBeNull();
    expect(parseMyCreatorProfile(null)).toBeNull();
    expect(parseMyCreatorProfile({})).toBeNull();
  });
});
