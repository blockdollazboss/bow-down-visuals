/**
 * Unit tests for the profile-website client helpers (Stack 3 + the
 * Grand Stage visual layer): the spotlight-pin and fan-collection
 * view-state decisions, the Grand Stage default order + fallback, the
 * layout editor ops, and the store / memberships view states and price
 * labels. These pin the honest-state contract: load errors are never
 * fake-empty, a private collection is its own state (not "empty", not
 * "missing"), and owner-only invitations never show to visitors.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  spotlightViewState,
  collectionViewState,
  collectionMoney,
  GRAND_STAGE_SEQUENCE,
  grandStageFallbackBlocks,
  visibleBlocks,
  moveBlock,
  toggleBlockVisibility,
  retitleBlock,
  removeBlock,
  addBlock,
  addableBlockTypes,
  layoutSummary,
  themeSettingsPatch,
  storeViewState,
  membershipsViewState,
  activeTiers,
  membershipPriceLabel,
  membershipAnnualLabel,
  type SpotlightPin,
  type FanCollection,
  type ProfileBlockDto,
  type ProfileBlockTypeDef,
  type MembershipTierDto,
  fetchMyPinnableItems,
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

/* ── The Grand Stage composition (the owner's picks, Oct 16) ─────────── */

const block = (type: string, title = type, visible = true): ProfileBlockDto => ({
  type, title, visible, config: {},
});

describe("Grand Stage fallback (layout read failed — the page still composes)", () => {
  it("the picked sequence is exactly The Stage → The Front Row → Music → Videos → Store → Memberships", () => {
    expect(GRAND_STAGE_SEQUENCE.map((b) => b.type)).toEqual([
      "spotlight", "court", "tracks", "videos", "store", "memberships",
    ]);
    expect(GRAND_STAGE_SEQUENCE.map((b) => b.title)).toEqual([
      "The Stage", "The Front Row", "Music", "Videos", "Store", "Memberships",
    ]);
  });

  it("an untouched profile falls back to the picked order under the masthead", () => {
    const blocks = grandStageFallbackBlocks([]);
    expect(blocks.map((b) => b.type)).toEqual([
      "hero", "spotlight", "court", "tracks", "videos", "store", "memberships",
      "achievements", "links",
    ]);
    expect(blocks.find((b) => b.type === "court")!.title).toBe("The Front Row");
    expect(blocks.find((b) => b.type === "spotlight")!.title).toBe("The Stage");
  });

  it("stored sections keep their own titles and order inside their Grand Stage slots", () => {
    const blocks = grandStageFallbackBlocks([
      { type: "hero", title: "Featured Track", visible: true },
      { type: "tracks", title: "Music", visible: true },
      { type: "bio", title: "About", visible: true },
      { type: "videos", title: "Clips", visible: true },
    ]);
    expect(blocks.map((b) => b.type)).toEqual([
      "hero", "spotlight", "court", "tracks", "videos", "store", "memberships",
      "bio", "achievements", "links",
    ]);
    expect(blocks.find((b) => b.type === "videos")!.title).toBe("Clips");
    expect(blocks.find((b) => b.type === "tracks")!.title).toBe("Music");
  });

  it("hidden sections stay hidden in the fallback", () => {
    const blocks = grandStageFallbackBlocks([
      { type: "bio", title: "About", visible: false },
    ]);
    expect(blocks.map((b) => b.type)).not.toContain("bio");
  });
});

describe("layout editor ops", () => {
  const start: ProfileBlockDto[] = [
    block("spotlight", "The Stage"),
    block("court", "The Front Row"),
    block("tracks", "Music"),
  ];

  it("moves a block up and down, and stops at the edges", () => {
    expect(moveBlock(start, "tracks", -1).map((b) => b.type)).toEqual(["spotlight", "tracks", "court"]);
    expect(moveBlock(start, "spotlight", 1).map((b) => b.type)).toEqual(["court", "spotlight", "tracks"]);
    expect(moveBlock(start, "spotlight", -1)).toBe(start);
    expect(moveBlock(start, "tracks", 1)).toBe(start);
  });

  it("toggles visibility without touching the order", () => {
    const next = toggleBlockVisibility(start, "court");
    expect(next.map((b) => b.type)).toEqual(["spotlight", "court", "tracks"]);
    expect(next[1]!.visible).toBe(false);
    expect(visibleBlocks(next).map((b) => b.type)).toEqual(["spotlight", "tracks"]);
  });

  it("retitles within the 80-char cap and removes blocks", () => {
    expect(retitleBlock(start, "court", "My People")[1]!.title).toBe("My People");
    expect(retitleBlock(start, "court", "x".repeat(120))[1]!.title).toHaveLength(80);
    expect(removeBlock(start, "court").map((b) => b.type)).toEqual(["spotlight", "tracks"]);
  });

  it("adds only registry blocks the layout doesn't already carry", () => {
    const defs: ProfileBlockTypeDef[] = [
      { type: "tracks", label: "Music", source: "section" },
      { type: "store", label: "Store", source: "page" },
    ];
    expect(addableBlockTypes(start, defs).map((d) => d.type)).toEqual(["store"]);
    const added = addBlock(start, defs[1]!);
    expect(added.map((b) => b.type)).toEqual(["spotlight", "court", "tracks", "store"]);
    expect(added[3]).toEqual({ type: "store", title: "Store", visible: true, config: {} });
    expect(addBlock(start, defs[0]!)).toBe(start);
  });

  it("the save read-back summary lists the visible blocks in order", () => {
    expect(layoutSummary(start)).toBe("The Stage · The Front Row · Music");
    expect(layoutSummary(toggleBlockVisibility(start, "court"))).toBe("The Stage · Music");
  });
});

describe("themeSettingsPatch (a null pick is never sent as a value)", () => {
  it("keeps real picks and drops null ones", () => {
    expect(
      themeSettingsPatch({ colorway: null, headingFont: "Space Grotesk", bodyFont: null }),
    ).toEqual({ headingFont: "Space Grotesk" });
    expect(
      themeSettingsPatch({ colorway: "royal-gold", headingFont: null, bodyFont: "Inter" }),
    ).toEqual({ colorway: "royal-gold", bodyFont: "Inter" });
  });

  it("an unpicked look patches to nothing — the save has nothing to send", () => {
    expect(themeSettingsPatch({ colorway: null, headingFont: null, bodyFont: null })).toEqual({});
    expect(themeSettingsPatch({})).toEqual({});
  });
});

describe("profile store view state", () => {
  it("loading and error are their own states — an error is never a fake-empty store", () => {
    expect(storeViewState({ status: "loading", count: 0, isOwner: false })).toBe("loading");
    expect(storeViewState({ status: "error", count: 0, isOwner: false })).toBe("error");
    expect(storeViewState({ status: "error", count: 0, isOwner: true })).toBe("error");
  });

  it("an empty store hides from visitors and invites the owner", () => {
    expect(storeViewState({ status: "ready", count: 0, isOwner: false })).toBe("hidden");
    expect(storeViewState({ status: "ready", count: 0, isOwner: true })).toBe("owner-empty");
    expect(storeViewState({ status: "ready", count: 3, isOwner: false })).toBe("items");
  });
});

const tier = (over: Partial<MembershipTierDto> = {}): MembershipTierDto => ({
  id: "tier-1",
  creatorUserId: "user-1",
  name: "Inner Circle",
  priceDollars: "25.00",
  priceCents: 2500,
  description: "",
  perks: [],
  isActive: true,
  trialEnabled: false,
  annualDiscountPct: 0,
  annualPriceCents: 30000,
  annualPriceDollars: "300.00",
  createdAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

describe("memberships view state + price labels", () => {
  it("loading and error are their own states", () => {
    expect(membershipsViewState({ status: "loading", tiers: [], isOwner: false })).toBe("loading");
    expect(membershipsViewState({ status: "error", tiers: [], isOwner: true })).toBe("error");
  });

  it("no active tiers hides the block for visitors and invites the owner", () => {
    expect(membershipsViewState({ status: "ready", tiers: [], isOwner: false })).toBe("hidden");
    expect(membershipsViewState({ status: "ready", tiers: [], isOwner: true })).toBe("owner-empty");
    expect(membershipsViewState({ status: "ready", tiers: [tier({ isActive: false })], isOwner: false })).toBe("hidden");
    expect(membershipsViewState({ status: "ready", tiers: [tier()], isOwner: false })).toBe("tiers");
  });

  it("inactive tiers never render", () => {
    expect(activeTiers([tier(), tier({ id: "t2", isActive: false })]).map((t) => t.id)).toEqual(["tier-1"]);
  });

  it("price labels come straight from the tier DTO — shown price is charged price", () => {
    expect(membershipPriceLabel(tier())).toBe("$25.00 / month");
    expect(membershipPriceLabel(tier({ priceCents: 0, priceDollars: "0.00" }))).toBe("Free");
  });

  it("the annual label appears only with a real annual discount", () => {
    expect(membershipAnnualLabel(tier())).toBeNull();
    expect(membershipAnnualLabel(tier({ annualDiscountPct: 20, annualPriceDollars: "240.00" })))
      .toBe("$240.00 / year — save 20%");
    expect(membershipAnnualLabel(tier({ priceCents: 0, annualDiscountPct: 20 }))).toBeNull();
  });
});

describe("fetchMyPinnableItems — per-kind settle (S27-46)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(byKind: Record<string, { ok: boolean; items?: unknown[] } | "reject">) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const kind = url.includes("kind=video") ? "video" : "track";
        const entry = byKind[kind];
        if (entry === "reject") throw new Error("network down");
        if (!entry) throw new Error(`unexpected ${url}`);
        return {
          ok: entry.ok,
          status: entry.ok ? 200 : 500,
          json: async () => (entry.ok ? { items: entry.items ?? [] } : { error: "server boom" }),
        };
      }),
    );
  }

  it("returns both kinds when both load", async () => {
    stubFetch({
      track: { ok: true, items: [{ id: "t1", title: "Song", artwork_url: "a.png" }] },
      video: { ok: true, items: [{ id: "v1", title: "Clip", thumbnail_url: "t.png" }] },
    });
    const items = await fetchMyPinnableItems("some-slug");
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual(["track:t1", "video:v1"]);
  });

  it("a rejected track fetch still returns the videos", async () => {
    stubFetch({
      track: "reject",
      video: { ok: true, items: [{ id: "v1", title: "Clip", thumbnail_url: "t.png" }] },
    });
    const items = await fetchMyPinnableItems("some-slug");
    expect(items).toEqual([{ kind: "video", id: "v1", title: "Clip", artworkUrl: "t.png" }]);
  });

  it("an HTTP-failed video source still returns the tracks", async () => {
    stubFetch({
      track: { ok: true, items: [{ id: "t1", title: "Song", artwork_url: null }] },
      video: { ok: false },
    });
    const items = await fetchMyPinnableItems("some-slug");
    expect(items).toEqual([{ kind: "track", id: "t1", title: "Song", artworkUrl: null }]);
  });

  it("throws only when BOTH kinds fail, so the picker error state still shows", async () => {
    stubFetch({ track: "reject", video: { ok: false } });
    await expect(fetchMyPinnableItems("some-slug")).rejects.toThrow();
  });
});
