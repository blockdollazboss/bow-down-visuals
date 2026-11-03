/**
 * catalog-desk — stack1500 world parity wave #3 item 11 pins.
 *
 * The Catalog Import desk is the bring-it-home pipeline's
 * native form. These pins hold: the scan rail is FREE in the
 * registry (cost 0); the state guard reads the rail's exact
 * shape and drops items outside the lifecycle rather than
 * dressing them up; the groups are the page's arrangement
 * (platform side incl. blocked/fetching, waiting, home); the
 * approve body follows the page's rule ({} untouched — the
 * rail takes the draft; edits ride trimmed with tags split
 * and capped at the schema's 8); upload keys stay under the
 * caller's own prefix.
 */
import { describe, expect, it } from "vitest";
import {
  CATALOG_SCAN_COST,
  CATALOG_SCAN_PATH,
  CATALOG_STATUSES,
  CATALOG_STATUS_LABELS,
  approvedItems,
  batchApprovedCount,
  buildApprovePayload,
  buildFetchPayload,
  buildScanPayload,
  buildUploadsPayload,
  catalogItemPath,
  catalogStateOf,
  catalogUploadKey,
  catalogUploadKind,
  editsFromDraft,
  listedItems,
  platformItems,
  readyItems,
  waitingItems,
  type CatalogState,
} from "./catalog-desk";
import { getCreditCost } from "../credit-costs";

const ITEM = {
  id: "i1",
  sourceKind: "connected",
  platform: "instagram",
  socialAccountId: "a1",
  kind: "video",
  title: "Rooftop freestyle",
  originalUrl: "https://instagram.com/reel/x",
  mediaUrl: null,
  thumbnailUrl: null,
  durationSec: 62,
  status: "ready",
  statusNote: null,
  draft: {
    title: "Rooftop Freestyle (Official)",
    description: "Shot above the city.",
    tags: ["freestyle", "rooftop"],
    captions: "Yeah, we up…",
    chapters: [{ atSec: 0, label: "Intro" }],
    series: { name: "Rooftop Sessions", season: 1, episode: 2 },
    notes: [],
    source: "ai",
  },
  targetKind: "profile_video",
};

const STATE = {
  accounts: [
    { accountId: "a1", platform: "instagram", username: "thycheatcode", state: "ready", note: null, itemCount: 3 },
    { accountId: null, platform: "tiktok", username: null, state: "link-only", note: "Link only.", itemCount: 0 },
  ],
  items: [
    ITEM,
    { ...ITEM, id: "i2", title: "Listed one", status: "listed", draft: null },
    { ...ITEM, id: "i3", title: "Blocked one", status: "blocked", statusNote: "The platform kept the file.", draft: null },
    { ...ITEM, id: "i4", title: "Home one", status: "approved", draft: null },
    { ...ITEM, id: "i5", title: "Waiting one", status: "here", draft: null },
    { ...ITEM, id: "i6", title: "Gone", status: "vanished", draft: null },
  ],
  honesty: { movesLine: "Your posts move. Your followers don't.", tiktokBlocked: "t", linkOnly: "l", noFileUrl: "n" },
};

describe("free rail + paths", () => {
  it("the scan registry row is cost 0 (Catalog Import (free))", () => {
    expect(getCreditCost(CATALOG_SCAN_PATH)?.cost).toBe(0);
    expect(getCreditCost(CATALOG_SCAN_PATH)?.feature).toBe("Catalog Import (free)");
    expect(CATALOG_SCAN_COST).toBe(0);
    expect(catalogItemPath("i 1", "approve")).toBe("/api/catalog-import/items/i%201/approve");
    expect(buildScanPayload("a1")).toEqual({ accountId: "a1" });
    expect(buildFetchPayload(["a", "b"])).toEqual({ itemIds: ["a", "b"] });
  });
});

describe("the state guard", () => {
  it("reads accounts, items and the honesty lines whole", () => {
    const s = catalogStateOf(STATE)!;
    expect(s.accounts).toHaveLength(2);
    expect(s.accounts[1]!.state).toBe("link-only");
    expect(s.honesty.movesLine).toContain("followers don't");
    const ready = s.items.find((i) => i.id === "i1")!;
    expect(ready.draft?.source).toBe("ai");
    expect(ready.draft?.series).toEqual({ name: "Rooftop Sessions", season: 1, episode: 2 });
    expect(ready.draft?.chapters).toEqual([{ atSec: 0, label: "Intro" }]);
  });

  it("an item outside the lifecycle drops — never dressed up", () => {
    const s = catalogStateOf(STATE)!;
    expect(s.items.some((i) => i.id === "i6")).toBe(false);
    expect(catalogStateOf({ accounts: [] })).toBeNull();
    expect(catalogStateOf(null)).toBeNull();
  });

  it("the status labels are the website's own words for all eight", () => {
    expect(Object.keys(CATALOG_STATUS_LABELS).sort()).toEqual([...CATALOG_STATUSES].sort());
    expect(CATALOG_STATUS_LABELS.ready).toBe("Draft ready for your word");
    expect(CATALOG_STATUS_LABELS.blocked).toBe("Platform won't hand it over");
  });
});

describe("the groups — the page's arrangement", () => {
  it("platform side keeps blocked + fetching visible; waiting and home split", () => {
    const s = catalogStateOf(STATE) as CatalogState;
    expect(platformItems(s).map((i) => i.id)).toEqual(["i2", "i3"]);
    expect(listedItems(s).map((i) => i.id)).toEqual(["i2"]);
    expect(waitingItems(s).map((i) => i.id)).toEqual(["i1", "i5"]);
    expect(readyItems(s).map((i) => i.id)).toEqual(["i1"]);
    expect(approvedItems(s).map((i) => i.id)).toEqual(["i4"]);
  });
});

describe("approve + uploads payloads", () => {
  it("untouched approves with {} — the rail takes the draft as-is", () => {
    expect(buildApprovePayload(null)).toEqual({});
  });

  it("edits ride trimmed; tags split, cleaned and capped at the schema's 8", () => {
    const body = buildApprovePayload({
      title: "  New title ",
      description: "Desc",
      tagsInput: " one, two ,, three, four, five, six, seven, eight, nine ",
    });
    expect(body).toEqual({
      title: "New title",
      description: "Desc",
      tags: ["one", "two", "three", "four", "five", "six", "seven", "eight"],
    });
    const edits = editsFromDraft({
      title: "T",
      description: "D",
      tags: ["a", "b"],
      captions: null,
      chapters: [],
      series: null,
      source: "assembled",
    });
    expect(edits).toEqual({ title: "T", description: "D", tagsInput: "a, b" });
  });

  it("upload keys stay under the caller's own prefix, filename sanitized", () => {
    const key = catalogUploadKey("user-1", "uuid-9", "my video!.mp4");
    expect(key.startsWith("user-1/catalog-import/uuid-9-")).toBe(true);
    expect(key.endsWith("my-video-.mp4")).toBe(true);
    expect(catalogUploadKind("audio/mpeg")).toBe("audio");
    expect(catalogUploadKind("video/mp4")).toBe("video");
    expect(catalogUploadKind("")).toBe("video");
    expect(buildUploadsPayload([{ key: "k", filename: "f", kind: "video", contentType: "video/mp4" }])).toEqual({
      files: [{ key: "k", filename: "f", kind: "video", contentType: "video/mp4" }],
    });
  });

  it("batch approve counts only the ok rows", () => {
    expect(batchApprovedCount({ results: [{ ok: true }, { ok: false }, { ok: true }, {}] })).toBe(2);
    expect(batchApprovedCount({})).toBeNull();
  });
});
