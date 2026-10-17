/**
 * portrait-card — the Portrait Card's pure seam (NATIVE-PLAN §3.4).
 *
 * Pins:
 * - THE LEAK IS DEAD: StationPanel's Front Row gallery no longer
 *   calls onOpenPage with a /artist/ path (or at all) — a portrait
 *   click selects the member and renders the Portrait Card;
 * - the card's own transfer is /artist/<slug> through the shared
 *   TransferFooter (the gallery station's websitePath is null, so
 *   this footer is the card's, rendered exactly once by the card);
 * - follow rides the profile rails exactly (POST follow, DELETE
 *   unfollow, :id = profile id; state via /api/discovery/following);
 * - Play builds the jukebox catalog pick form (track:<id>) and the
 *   host wires the card's Play to onJukeboxAdd — the flagged seam;
 * - the wire normalizer keeps the gallery's seat and falls back to
 *   the gallery identity, and the summary rows honour the house
 *   rules (inactive membership tiers never render).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  portraitWebsitePath, portraitProfilePath, portraitFollowPath,
  portraitUnfollowPath, portraitFollowingPath, portraitMembershipsPath,
  portraitStoreCatalogPath, jukeboxPickId, nextFollowerCount,
  portraitCardFromWire, membershipSummaryRows, shopSummaryRows,
} from "./portrait-card";
import { STATION_BY_ID } from "./stations";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const panelSrc = read("../../components/world/StationPanel.tsx");
const cardSrc = read("../../components/world/native/PortraitCard.tsx");

const member = {
  profileId: "prof-1",
  slug: "queen-bee",
  displayName: "Queen Bee",
  avatarUrl: "https://x/bee.png",
  position: 2,
};

describe("portrait endpoints — the profile rails, verbatim", () => {
  it("pins every path", () => {
    expect(portraitWebsitePath("queen-bee")).toBe("/artist/queen-bee");
    expect(portraitProfilePath("queen-bee")).toBe("/api/creator-profiles/queen-bee");
    expect(portraitFollowPath("prof-1")).toBe("/api/creator-profiles/prof-1/follow");
    expect(portraitUnfollowPath("prof-1")).toBe("/api/creator-profiles/prof-1/unfollow");
    expect(portraitFollowingPath(["b", "a", "a"])).toBe("/api/discovery/following?ids=a%2Cb");
    expect(portraitMembershipsPath("user-9")).toBe("/api/memberships/public/user-9");
    expect(portraitStoreCatalogPath("queen-bee")).toBe("/api/creator-profiles/queen-bee/store-catalog");
  });

  it("the gallery station itself carries no transfer target (websitePath null)", () => {
    const gallery = STATION_BY_ID.get("front-row-gallery")!;
    expect(gallery.panel).toEqual({ kind: "custom", id: "front-row" });
    expect(gallery.websitePath).toBeNull();
  });
});

describe("the Front Row leak is dead (source pins)", () => {
  it("the gallery never calls onOpenPage — no /artist page mount from a portrait", () => {
    const galleryStart = panelSrc.indexOf("function FrontRowGallery");
    const galleryEnd = panelSrc.indexOf("/* ─── The Treasury", galleryStart);
    const gallerySrc = panelSrc.slice(galleryStart, galleryEnd);
    expect(gallerySrc).not.toContain("onOpenPage(");
    expect(gallerySrc).not.toContain("`/artist/${");
    expect(gallerySrc).toContain("setSelected(m)");
    expect(gallerySrc).toContain("<PortraitCard");
    expect(gallerySrc).toContain('data-testid="world-court-portrait"');
  });

  it("the host wires the gallery's Play seam to the jukebox intent", () => {
    expect(panelSrc).toContain("onPlayTrack={props.onJukeboxAdd}");
  });

  it("the card renders its own transfer through the shared TransferFooter", () => {
    expect(cardSrc).toContain("TransferFooter");
    expect(cardSrc).toContain("portraitWebsitePath(member.slug)");
    expect(cardSrc).toContain('data-testid="world-portrait-card"');
    expect(cardSrc).toContain('data-testid="world-portrait-follow"');
    expect(cardSrc).toContain('data-testid="world-portrait-play"');
    // Exactly one footer in the card — its own.
    expect(cardSrc.split("<TransferFooter").length - 1).toBe(1);
  });
});

describe("the Play seam", () => {
  it("builds the jukebox catalog pick form, idempotently", () => {
    expect(jukeboxPickId("abc-123")).toBe("track:abc-123");
    expect(jukeboxPickId("track:abc-123")).toBe("track:abc-123");
    expect(cardSrc).toContain("onPlayTrack(jukeboxPickId(t.id))");
  });
});

describe("follow math", () => {
  it("moves with the confirmed state and never below zero", () => {
    expect(nextFollowerCount(10, true)).toBe(11);
    expect(nextFollowerCount(10, false)).toBe(9);
    expect(nextFollowerCount(0, false)).toBe(0);
    // The component uses DELETE for unfollow, POST for follow.
    expect(cardSrc).toContain('method: following ? "DELETE" : "POST"');
    expect(cardSrc).toContain("portraitUnfollowPath(card.profileId)");
    expect(cardSrc).toContain("portraitFollowPath(card.profileId)");
  });
});

describe("the wire normalizer", () => {
  it("builds the card from the public profile wire, keeping the seat", () => {
    const card = portraitCardFromWire(member, {
      profile: {
        id: "prof-1",
        user_id: "user-9",
        slug: "queen-bee",
        display_name: "Queen Bee",
        bio: "First line\nsecond line",
        avatar_url: "https://x/new.png",
        follower_count: 42,
      },
      top_tracks: [
        { id: "t1", title: "Anthem", artwork_url: "https://x/a.png", duration_sec: 187, play_count: 900 },
        { id: "", title: "ghost" },
        { title: "no id" },
      ],
    });
    expect(card.profileId).toBe("prof-1");
    expect(card.userId).toBe("user-9");
    expect(card.seat).toBe(2);
    expect(card.bioLine).toBe("First line");
    expect(card.avatarUrl).toBe("https://x/new.png");
    expect(card.followerCount).toBe(42);
    expect(card.topTracks).toEqual([
      { id: "t1", title: "Anthem", artworkUrl: "https://x/a.png", durationSec: 187, plays: 900 },
    ]);
  });

  it("falls back to the gallery identity when the wire is thin", () => {
    const card = portraitCardFromWire(member, { profile: {}, top_tracks: null });
    expect(card.displayName).toBe("Queen Bee");
    expect(card.slug).toBe("queen-bee");
    expect(card.avatarUrl).toBe("https://x/bee.png");
    expect(card.topTracks).toEqual([]);
    expect(card.followerCount).toBe(0);
  });
});

describe("summary rows — memberships and shop, house rules", () => {
  it("inactive membership tiers never render; prices ride the DTO", () => {
    const rows = membershipSummaryRows({
      tiers: [
        { name: "Gold Circle", priceDollars: "25.00", priceCents: 2500, isActive: true },
        { name: "Retired", priceDollars: "5.00", priceCents: 500, isActive: false },
        { name: "Open Door", priceDollars: "0.00", priceCents: 0, isActive: true },
      ],
    });
    expect(rows).toEqual([
      { label: "Gold Circle", detail: "$25.00 / month" },
      { label: "Open Door", detail: "Free" },
    ]);
    expect(membershipSummaryRows(null)).toEqual([]);
    expect(membershipSummaryRows({})).toEqual([]);
  });

  it("shop rows carry the catalog's own price strings", () => {
    const rows = shopSummaryRows({
      items: [
        { title: "Anthem (download)", price: "$4.99" },
        { title: "Hoodie", price: "$60.00" },
      ],
    });
    expect(rows).toEqual([
      { label: "Anthem (download)", detail: "$4.99" },
      { label: "Hoodie", detail: "$60.00" },
    ]);
    expect(shopSummaryRows({ items: "nope" })).toEqual([]);
  });
});
