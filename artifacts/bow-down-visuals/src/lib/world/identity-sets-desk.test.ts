/**
 * identity-sets-desk — stack1500 world parity wave #4b item 38 pins.
 *
 * The Identity Sets desk is a vault character's photo set, native.
 * These pins hold: the set guard reads the rail's exact answer
 * (photos / mainPhoto / coverage items + summary / maxPhotos) and
 * treats a non-state body as failure; the selection guard reads
 * the pick answer whole (chosen may be null with the rail's own
 * reason); the vocabularies mirror lib/identity-set.ts exactly;
 * the registry pin uses the LITERAL ":id" pattern key (a concrete
 * path can never match it) and proves the family is free; the
 * payload builders mirror the route schemas.
 */
import { describe, expect, it } from "vitest";
import { getCreditCost } from "@/lib/credit-costs";
import {
  IDENTITY_ANGLES,
  IDENTITY_EXPRESSIONS,
  IDENTITY_PHOTO_SOURCES,
  IDENTITY_PHOTOS_REGISTRY_KEY,
  IDENTITY_REMOVE_COPY,
  MAX_IDENTITY_PHOTOS,
  buildIdentityAddPayload,
  buildIdentityRelabelPayload,
  buildIdentitySelectPayload,
  identityAddReady,
  identityAngleLabel,
  identityExpressionLabel,
  identityPhotoPath,
  identityPhotosCost,
  identityPhotosPath,
  identitySelectPath,
  identitySelectionOfResponse,
  identitySetOfResponse,
} from "./identity-sets-desk";

const SET_BODY = {
  photos: [
    { id: "p1", image_url: "https://cdn/x1.jpg", angle: "front", expression: "smile", wardrobe: "gold robe", source: "upload" },
    { id: "p2", image_url: "https://cdn/x2.jpg", angle: "left_profile", expression: "serious", wardrobe: null, source: "generated" },
    { id: "", image_url: "https://cdn/bad.jpg", angle: "front", expression: "neutral", wardrobe: null, source: "upload" },
  ],
  mainPhoto: { image_url: "https://cdn/main.jpg" },
  coverage: {
    items: [
      { key: "front", label: "Front view", covered: true, missingMessage: "No front photo yet…" },
      { key: "close_up", label: "Close-up", covered: false, missingMessage: "No close-up yet — tight shots hold the face better with one." },
      { key: 7, label: "Drift", covered: false, missingMessage: "" },
    ],
    coveredCount: 1,
    totalCount: 6,
    missingMessages: ["No close-up yet — tight shots hold the face better with one."],
    summary: "Identity set covers 1 of 6 basics.",
  },
  maxPhotos: 12,
};

describe("the set guard — the rail's answer shape", () => {
  it("reads photos, the main photo, coverage and the cap; drift drops", () => {
    const view = identitySetOfResponse(SET_BODY)!;
    expect(view.photos.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(view.photos[1]).toMatchObject({ source: "generated", wardrobe: null });
    expect(view.mainPhotoUrl).toBe("https://cdn/main.jpg");
    expect(view.maxPhotos).toBe(12);
    expect(view.coverage.map((c) => c.key)).toEqual(["front", "close_up"]);
    expect(view.coverage[1]).toMatchObject({ covered: false });
    expect(view.coverageSummary).toBe("Identity set covers 1 of 6 basics.");
  });

  it("a non-state body is failure, never an empty set", () => {
    expect(identitySetOfResponse({})).toBeNull();
    expect(identitySetOfResponse(null)).toBeNull();
    expect(identitySetOfResponse({ photos: "all" })).toBeNull();
  });

  it("no main photo reads as null", () => {
    const view = identitySetOfResponse({ ...SET_BODY, mainPhoto: null })!;
    expect(view.mainPhotoUrl).toBeNull();
  });
});

describe("the selection guard — the pick, whole", () => {
  it("reads the chosen photo, the reason, and the scored pool", () => {
    const sel = identitySelectionOfResponse({
      chosen: { id: "p1", imageUrl: "https://cdn/x1.jpg", angle: "front", expression: "smile", wardrobe: "gold robe", source: "upload", isMain: false },
      reason: "Picked the front photo (smiling) — this shot wants a front angle and that expression.",
      overridden: false,
      setCount: 2,
      poolSize: 3,
      pool: [
        { id: "p1", imageUrl: "https://cdn/x1.jpg", angle: "front", expression: "smile", wardrobe: "gold robe", source: "upload", isMain: false, score: 80 },
        { id: "main", imageUrl: "https://cdn/main.jpg", angle: "front", expression: "neutral", wardrobe: null, source: "upload", isMain: true, score: 50 },
      ],
      coverage: SET_BODY.coverage,
    })!;
    expect(sel.chosen).toMatchObject({ id: "p1", score: null });
    expect(sel.reason).toContain("Picked the front photo");
    expect(sel.pool.map((c) => c.id)).toEqual(["p1", "main"]);
    expect(sel.pool[0]!.score).toBe(80);
    expect(sel.pool[1]!.isMain).toBe(true);
  });

  it("an empty set answers chosen null with the rail's own reason", () => {
    const sel = identitySelectionOfResponse({
      chosen: null,
      reason: "This character has no identity photo yet — add one in the Artist Vault.",
      overridden: false,
      setCount: 0,
      poolSize: 0,
      pool: [],
      coverage: SET_BODY.coverage,
    })!;
    expect(sel.chosen).toBeNull();
    expect(sel.reason).toContain("no identity photo yet");
  });

  it("a reason-less body is failure", () => {
    expect(identitySelectionOfResponse({ chosen: null })).toBeNull();
    expect(identitySelectionOfResponse(null)).toBeNull();
  });
});

describe("the vocabularies — lib/identity-set.ts, mirrored exactly", () => {
  it("angles, expressions, sources and the cap match the rail", () => {
    expect(IDENTITY_ANGLES).toEqual([
      "front", "three_quarter_left", "three_quarter_right", "left_profile",
      "right_profile", "back", "full_body", "close_up",
    ]);
    expect(IDENTITY_EXPRESSIONS).toEqual([
      "neutral", "smile", "laughing", "serious", "intense", "singing", "sad", "surprised",
    ]);
    expect(IDENTITY_PHOTO_SOURCES).toEqual(["upload", "generated"]);
    expect(MAX_IDENTITY_PHOTOS).toBe(12);
  });

  it("labels use the rail's words, with the underscore fallback", () => {
    expect(identityAngleLabel("three_quarter_left")).toBe("three-quarter (left)");
    expect(identityAngleLabel("full_body")).toBe("full-body");
    expect(identityExpressionLabel("smile")).toBe("smiling");
    expect(identityAngleLabel("some_new_angle")).toBe("some new angle");
  });
});

describe("the free pin — the literal pattern key", () => {
  it("the registry row is pinned by its ':id' pattern key and costs 0", () => {
    expect(IDENTITY_PHOTOS_REGISTRY_KEY).toBe("/api/artist-vaults/:id/identity-photos");
    expect(getCreditCost(IDENTITY_PHOTOS_REGISTRY_KEY)?.cost).toBe(0);
    expect(identityPhotosCost()).toBe(0);
    /* And the subtlety itself: a concrete path does NOT resolve
       the pattern row — which is why the pin is literal. */
    expect(getCreditCost("/api/artist-vaults/some-uuid/identity-photos")).toBeNull();
  });

  it("the paths substitute the vault + photo ids", () => {
    expect(identityPhotosPath("v 1")).toBe("/api/artist-vaults/v%201/identity-photos");
    expect(identityPhotoPath("v1", "p1")).toBe("/api/artist-vaults/v1/identity-photos/p1");
    expect(identitySelectPath("v1")).toBe("/api/artist-vaults/v1/identity-photos/select");
  });
});

describe("the payload builders — the route schemas", () => {
  it("add: http(s) URL required, a real angle, blanks ride absent", () => {
    const draft = { imageUrl: " https://cdn/x.jpg ", angle: "front", expression: "smile", wardrobe: " ", source: "upload" };
    expect(buildIdentityAddPayload(draft)).toEqual({
      image_url: "https://cdn/x.jpg",
      angle: "front",
      expression: "smile",
      wardrobe: undefined,
      source: "upload",
    });
    expect(identityAddReady(draft)).toBe(true);
    expect(identityAddReady({ ...draft, imageUrl: "ftp://cdn/x.jpg" })).toBe(false);
    expect(identityAddReady({ ...draft, imageUrl: "" })).toBe(false);
    expect(identityAddReady({ ...draft, angle: "diagonal" })).toBe(false);
  });

  it("relabel: wardrobe blank clears (null), angle/expression optional", () => {
    expect(buildIdentityRelabelPayload({ angle: "back", expression: "", wardrobe: " " })).toEqual({
      angle: "back",
      expression: undefined,
      wardrobe: null,
    });
    expect(buildIdentityRelabelPayload({ angle: "back", expression: "sad", wardrobe: "suit" }).wardrobe).toBe("suit");
  });

  it("select: context capped at the schema's bounds; override rides only when named", () => {
    const payload = buildIdentitySelectPayload({
      cameraMovement: "x".repeat(600),
      promptText: " a scene ",
      actionText: "",
      mood: "joyful",
      wardrobeHint: "",
    });
    expect(payload.cameraMovement).toHaveLength(500);
    expect(payload.promptText).toBe("a scene");
    expect(payload.actionText).toBeUndefined();
    expect(payload.overridePhotoId).toBeUndefined();
    expect(buildIdentitySelectPayload(
      { cameraMovement: "", promptText: "", actionText: "", mood: "", wardrobeHint: "" },
      "main",
    ).overridePhotoId).toBe("main");
  });

  it("the remove copy tells the soft-delete truth", () => {
    expect(IDENTITY_REMOVE_COPY).toContain("kept in storage");
  });
});
