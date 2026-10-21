import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeShortItem, normalizeShortsFeed } from "./shorts-data";

const shortsSource = readFileSync(
  new URL("../pages/shorts.tsx", import.meta.url),
  "utf8",
);

const goodItem = {
  id: "s1",
  profile_id: "p1",
  title: "Golden hour hook",
  video_url: "https://cdn.example.com/short1.mp4",
  thumbnail_url: null,
  description: "desc",
  tags: ["gold"],
  duration_sec: 12,
  view_count: 100,
  like_count: 9,
  repost_count: 1,
  comment_count: 2,
  download_price_cents: 0,
  duet_with: null,
  stitch_with: null,
  sound: null,
  score: 3.5,
  creator: { id: "c1", slug: "thy-cheat-code", display_name: "Thy Cheat Code", avatar_url: null },
  duet_parent: null,
  stitch_parent: null,
  duet_count: 0,
  stitch_count: 0,
  challenges: [],
  viewer_liked: false,
  viewer_following: true,
  created_at: "2026-10-01T00:00:00Z",
};

describe("Shorts feed payload guards (Lane V4 item 1)", () => {
  it("an empty/missing payload normalizes to the designed empty feed — no boundary trip", () => {
    expect(normalizeShortsFeed({})).toEqual({ items: [], next_cursor: null });
    expect(normalizeShortsFeed(null)).toEqual({ items: [], next_cursor: null });
    expect(normalizeShortsFeed(undefined)).toEqual({ items: [], next_cursor: null });
    expect(normalizeShortsFeed("nope")).toEqual({ items: [], next_cursor: null });
  });

  it("a payload whose items field is not an array degrades to empty, keeping a valid cursor", () => {
    expect(normalizeShortsFeed({ items: "broken", next_cursor: "c2" })).toEqual({
      items: [],
      next_cursor: "c2",
    });
    expect(normalizeShortsFeed({ items: null, next_cursor: 42 })).toEqual({
      items: [],
      next_cursor: null,
    });
  });

  it("a well-formed feed passes through with every field intact", () => {
    const out = normalizeShortsFeed({ items: [goodItem], next_cursor: "next" });
    expect(out.next_cursor).toBe("next");
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toEqual(goodItem);
  });

  it("rows that cannot render an honest slide are dropped, not rendered broken", () => {
    const noVideo = { ...goodItem, id: "s2", video_url: undefined };
    const noCreator = { ...goodItem, id: "s3", creator: { id: "c1" } };
    const notAnObject = "garbage";
    const out = normalizeShortsFeed({ items: [goodItem, noVideo, noCreator, notAnObject, null] });
    expect(out.items.map((i) => i.id)).toEqual(["s1"]);
  });

  it("partial rows are coerced to the full render shape (counts, tags, challenges)", () => {
    const partial = {
      id: "s9",
      video_url: "https://cdn.example.com/x.mp4",
      creator: { id: "c9", slug: "fan", display_name: "Fan" },
      like_count: "lots",
      tags: "not-an-array",
      challenges: [{ slug: "goldrush" }, { nope: true }],
    };
    const item = normalizeShortItem(partial);
    expect(item).not.toBeNull();
    expect(item!.like_count).toBe(0);
    expect(item!.view_count).toBe(0);
    expect(item!.tags).toEqual([]);
    expect(item!.challenges).toEqual([{ slug: "goldrush", title: "", hashtag: "" }]);
    expect(item!.creator.avatar_url).toBeNull();
    expect(item!.sound).toBeNull();
  });

  it("the page normalizes at every fetch boundary (no raw FeedResponse casts remain)", () => {
    expect(shortsSource).not.toContain("as FeedResponse");
    expect(shortsSource).toContain("normalizeShortsFeed(await apiGet(url))");
    expect(shortsSource).toContain("normalizeShortsFeed(await res.json())");
  });
});
