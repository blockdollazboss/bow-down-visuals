/**
 * Unit tests for the profile-website client helpers (Stack 3):
 * the spotlight-pin and fan-collection view-state decisions. These pin
 * the honest-state contract: load errors are never fake-empty, a
 * private collection is its own state (not "empty", not "missing"),
 * and the pin section hides for visitors while inviting the owner.
 */
import { describe, it, expect } from "vitest";
import {
  spotlightViewState,
  collectionViewState,
  collectionMoney,
  type SpotlightPin,
  type FanCollection,
} from "./profile-website";

const PIN: SpotlightPin = {
  kind: "track",
  itemId: "t1",
  title: "Golden Hour",
  mediaUrl: "https://cdn.example/t.mp3",
  artworkUrl: null,
  durationSec: 180,
  creatorSlug: "owner",
  creatorName: "Owner",
  pageUrl: "/artist/owner",
};

const COLLECTION: FanCollection = {
  fan: { slug: "fan", displayName: "Fan", avatarUrl: null, profileUrl: "/artist/fan" },
  visibility: "public",
  items: [
    {
      kind: "track", itemId: "t1", title: "Golden Hour", artworkUrl: null,
      creatorName: "Owner", creatorSlug: "owner", creatorUrl: "/artist/owner",
      amountCents: 499, purchasedAt: "2026-10-01T00:00:00.000Z",
    },
  ],
};

describe("spotlightViewState", () => {
  it("shows the pin to everyone when one is set", () => {
    expect(spotlightViewState({ status: "ready", pin: PIN, isOwner: false })).toBe("pin");
    expect(spotlightViewState({ status: "ready", pin: PIN, isOwner: true })).toBe("pin");
  });

  it("hides for visitors with no pin, invites the owner", () => {
    expect(spotlightViewState({ status: "ready", pin: null, isOwner: false })).toBe("hidden");
    expect(spotlightViewState({ status: "ready", pin: null, isOwner: true })).toBe("owner-empty");
  });

  it("loading and error are their own states — never fake-empty", () => {
    expect(spotlightViewState({ status: "loading", pin: null, isOwner: true })).toBe("loading");
    expect(spotlightViewState({ status: "error", pin: null, isOwner: true })).toBe("error");
    expect(spotlightViewState({ status: "error", pin: PIN, isOwner: false })).toBe("error");
  });
});

describe("collectionViewState", () => {
  it("renders items for a public collection with purchases", () => {
    expect(collectionViewState({ status: "ready", collection: COLLECTION })).toBe("items");
  });

  it("an empty public collection is 'empty', not an error", () => {
    expect(collectionViewState({ status: "ready", collection: { ...COLLECTION, items: [] } })).toBe("empty");
  });

  it("a private collection is its own honest state", () => {
    expect(
      collectionViewState({ status: "ready", collection: { ...COLLECTION, visibility: "private", isPrivate: true, items: [] } }),
    ).toBe("private");
  });

  it("missing and failed loads are distinct states", () => {
    expect(collectionViewState({ status: "not-found", collection: null })).toBe("not-found");
    expect(collectionViewState({ status: "error", collection: null })).toBe("error");
    expect(collectionViewState({ status: "loading", collection: null })).toBe("loading");
  });
});

describe("collectionMoney", () => {
  it("formats real-money cents as USD", () => {
    expect(collectionMoney(499)).toBe("$4.99");
    expect(collectionMoney(4500)).toBe("$45.00");
    expect(collectionMoney(0)).toBe("$0.00");
  });
});
