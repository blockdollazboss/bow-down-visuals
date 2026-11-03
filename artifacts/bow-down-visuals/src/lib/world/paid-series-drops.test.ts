/**
 * paid-series-drops — Paid Series + Product Drops at the
 * Marketplace stand (World parity wave 1; census items
 * `paid-series` + `product-drops`, both ABSENT in-World before
 * this desk). Pins:
 * (a) the series price gate mirrors the server's own discipline
 *     (normalizeSeriesPrice: blank/0 = free, $0.50 card floor,
 *     $100,000 ceiling) and every payload is the rail's exact
 *     body — the creator's typed price is the only price;
 * (b) /api/playlists/mine parses to series ONLY, junk rows drop,
 *     a playlists-less payload is no shelf (null);
 * (c) the fan unlock reads its price from GET
 *     /api/store/item/series/:id (never guessed), the checkout
 *     body is the store-buy page's { kind: "series", id } plus
 *     the embedded ask, verify speaks the rail's three honest
 *     states, and a series id parses from a bare id or the
 *     creator's shared links — never from anything else;
 * (d) drops: the owner's products parse with their
 *     server-computed drop, the schedule payload is the
 *     dashboard's { dropAt } ISO instant under the rail's own
 *     future gate, the capture payload is the drop page's shape,
 *     and local-time conversion round-trips through the UTC
 *     instant end to end;
 * (e) source pins: the desk wires every endpoint above, mounts
 *     the embedded checkout in-world, and the ShopStands
 *     composition renders it at the Marketplace stand — with no
 *     navigation to the 2D buy/drop pages anywhere.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SERIES_PRICE_MIN_CENTS,
  SERIES_PRICE_MAX_CENTS,
  seriesPriceProblem,
  seriesPriceCents,
  parseMySeries,
  parseSavedSeries,
  emptySeriesCreateForm,
  seriesCreateProblem,
  buildSeriesCreatePayload,
  buildSeriesPricePatch,
  buildSeriesPreviewPatch,
  parseSeriesStoreItem,
  parseSeriesIdInput,
  seriesCheckoutPayload,
  seriesPendingKey,
  parseSeriesPending,
  seriesVerifyState,
  seriesUnlockedFromVerify,
  parseSeriesBuyers,
  parseDroppableProducts,
  parseMyProfileRef,
  parseDropDetail,
  dropAtIsoFromLocalInput,
  dropScheduleProblem,
  buildDropSchedulePayload,
  parseDropAnswer,
  buildDropCapturePayload,
  dropLocalInputValue,
} from "./paid-series-drops";

const SERIES_ID = "11111111-1111-4111-8111-111111111111";
const EP_A = "22222222-2222-4222-8222-222222222222";
const EP_B = "33333333-3333-4333-8333-333333333333";

const seriesRow = {
  id: SERIES_ID,
  title: "Golden Season",
  description: "Eight episodes.",
  is_public: true,
  kind: "series",
  price_cents: 1999,
  preview_item: { kind: "video", id: EP_A },
  items: [
    { kind: "video", id: EP_A },
    { kind: "track", id: EP_B },
    { kind: "bogus", id: "x" },
  ],
  series_access: "owner",
  is_paid_series: true,
  is_owner: true,
};

describe("series price discipline — the server's own gate", () => {
  it("blank and zero are free; the floor and ceiling are the rail's constants", () => {
    expect(SERIES_PRICE_MIN_CENTS).toBe(50);
    expect(SERIES_PRICE_MAX_CENTS).toBe(100_000_00);
    expect(seriesPriceProblem("")).toBeNull();
    expect(seriesPriceProblem("0")).toBeNull();
    expect(seriesPriceProblem("0.00")).toBeNull();
    expect(seriesPriceCents("")).toBeNull();
    expect(seriesPriceCents("0")).toBeNull();
  });

  it("a typed price converts to the creator's cents, verbatim", () => {
    expect(seriesPriceProblem("19.99")).toBeNull();
    expect(seriesPriceCents("19.99")).toBe(1999);
    expect(seriesPriceCents("$25")).toBe(2500);
  });

  it("under the card floor and over the ceiling are refused in plain words", () => {
    expect(seriesPriceProblem("0.25")).toContain("$0.50");
    expect(seriesPriceProblem("100000.01")).toContain("ceiling");
    expect(seriesPriceProblem("abc")).toContain("valid price");
    expect(buildSeriesPricePatch("0.25")).toBeNull();
  });

  it("the price patch is the rail's exact body — null clears to free", () => {
    expect(buildSeriesPricePatch("19.99")).toEqual({ price_cents: 1999 });
    expect(buildSeriesPricePatch("")).toEqual({ price_cents: null });
  });

  it("the preview patch carries the marked episode, or null to clear", () => {
    expect(buildSeriesPreviewPatch({ kind: "video", id: EP_A })).toEqual({
      preview_item: { kind: "video", id: EP_A },
    });
    expect(buildSeriesPreviewPatch(null)).toEqual({ preview_item: null });
  });
});

describe("series create — POST /api/playlists body", () => {
  it("a priced series rides kind series with the creator's price_cents", () => {
    expect(buildSeriesCreatePayload({ title: "  Golden Season ", description: " Eight. ", price: "19.99" })).toEqual({
      title: "Golden Season",
      description: "Eight.",
      kind: "series",
      is_public: true,
      price_cents: 1999,
    });
  });

  it("a free series carries price_cents null", () => {
    expect(buildSeriesCreatePayload({ title: "Open Diaries", description: "", price: "" })?.price_cents).toBeNull();
  });

  it("no title or a doomed price means no payload at all", () => {
    expect(seriesCreateProblem(emptySeriesCreateForm())).toContain("title");
    expect(buildSeriesCreatePayload({ title: "", description: "", price: "5" })).toBeNull();
    expect(buildSeriesCreatePayload({ title: "X", description: "", price: "0.10" })).toBeNull();
  });
});

describe("series parsers — honest narrowing only", () => {
  it("mine keeps ONLY series rows, fully shaped; junk drops out", () => {
    const parsed = parseMySeries({
      playlists: [
        seriesRow,
        { ...seriesRow, id: "x", kind: "playlist" },
        { title: "no id" },
        null,
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed![0]).toMatchObject({
      id: SERIES_ID,
      title: "Golden Season",
      priceCents: 1999,
      access: "owner",
      isPaidSeries: true,
      isOwner: true,
      previewItem: { kind: "video", id: EP_A },
    });
    /* The bogus episode ref drops; the two real episodes stay. */
    expect(parsed![0]!.items).toEqual([
      { kind: "video", id: EP_A },
      { kind: "track", id: EP_B },
    ]);
  });

  it("a payload without a playlists array is no shelf at all", () => {
    expect(parseMySeries({})).toBeNull();
    expect(parseMySeries(null)).toBeNull();
    expect(parseMySeries({ playlists: "nope" })).toBeNull();
  });

  it("a free series reads priceCents null and access free", () => {
    const parsed = parseMySeries({
      playlists: [{ ...seriesRow, price_cents: null, is_paid_series: false, series_access: undefined }],
    });
    expect(parsed![0]!.priceCents).toBeNull();
    expect(parsed![0]!.access).toBe("free");
    expect(parsed![0]!.isPaidSeries).toBe(false);
  });

  it("the saved-series answer parses from { playlist }", () => {
    expect(parseSavedSeries({ playlist: seriesRow })?.id).toBe(SERIES_ID);
    expect(parseSavedSeries({})).toBeNull();
    expect(parseSavedSeries({ playlist: { ...seriesRow, kind: "playlist" } })).toBeNull();
  });

  it("the buyer list carries the rail's totals verbatim", () => {
    const parsed = parseSeriesBuyers({
      buyers: [
        { display_name: "Fan One", amount_cents: 1999, status: "completed" },
        { display_name: null, amount_cents: 1999, status: "refunded" },
      ],
      totals: { buyers: 1, gross_cents: 1999 },
    });
    expect(parsed).toEqual({
      buyers: [
        { displayName: "Fan One", amountCents: 1999, status: "completed" },
        { displayName: "Fan", amountCents: 1999, status: "refunded" },
      ],
      buyerCount: 1,
      grossCents: 1999,
    });
    expect(parseSeriesBuyers({ buyers: [] })).toBeNull();
  });
});

describe("the fan unlock — price from the rail, verify in three states", () => {
  const itemPayload = {
    item: { kind: "series", id: SERIES_ID, title: "Golden Season", artistName: "King", priceCents: 1999 },
    feeSplit: { platformFeeCents: 100, platformFeePct: 5, creatorCents: 1899 },
  };

  it("the store item parses with its fee split — the rail's numbers", () => {
    expect(parseSeriesStoreItem(itemPayload)).toEqual({
      id: SERIES_ID,
      title: "Golden Season",
      artistName: "King",
      priceCents: 1999,
      platformFeeCents: 100,
      platformFeePct: 5,
      creatorCents: 1899,
    });
  });

  it("a priceless or wrong-kind payload is no item at all", () => {
    expect(parseSeriesStoreItem({ item: { ...itemPayload.item, kind: "track" } })).toBeNull();
    expect(parseSeriesStoreItem({ item: { ...itemPayload.item, priceCents: "1999" } })).toBeNull();
    expect(parseSeriesStoreItem(null)).toBeNull();
  });

  it("a series id parses from a bare id or the shared links — never junk", () => {
    expect(parseSeriesIdInput(SERIES_ID)).toBe(SERIES_ID);
    expect(parseSeriesIdInput(`https://bowdownvisuals.com/store/buy/series/${SERIES_ID}`)).toBe(SERIES_ID);
    expect(parseSeriesIdInput(`/playlist/${SERIES_ID}`)).toBe(SERIES_ID);
    expect(parseSeriesIdInput("golden-season")).toBeNull();
    expect(parseSeriesIdInput(`/store/buy/track/${SERIES_ID}`)).toBeNull();
    expect(parseSeriesIdInput("")).toBeNull();
  });

  it("the checkout body is the store-buy page's, plus the embedded ask only when asked", () => {
    expect(seriesCheckoutPayload(SERIES_ID, true)).toEqual({ kind: "series", id: SERIES_ID, uiMode: "embedded" });
    expect(seriesCheckoutPayload(SERIES_ID, false)).toEqual({ kind: "series", id: SERIES_ID });
  });

  it("the pending stash round-trips and refuses junk", () => {
    expect(seriesPendingKey(SERIES_ID)).toBe(`bdv-series-pending-${SERIES_ID}`);
    const raw = JSON.stringify({ sessionId: "cs_1", seriesId: SERIES_ID, title: "Golden Season" });
    expect(parseSeriesPending(raw)).toEqual({ sessionId: "cs_1", seriesId: SERIES_ID, title: "Golden Season" });
    expect(parseSeriesPending(null)).toBeNull();
    expect(parseSeriesPending("{")).toBeNull();
    expect(parseSeriesPending(JSON.stringify({ sessionId: "cs_1" }))).toBeNull();
  });

  it("verify: success confirms, the rail's not-paid words pend, anything else is dead", () => {
    expect(seriesVerifyState(200, { success: true })).toBe("confirmed");
    expect(seriesVerifyState(400, { error: "Payment has not been completed." })).toBe("pending");
    expect(seriesVerifyState(400, { error: "Something else." })).toBe("dead");
    expect(seriesVerifyState(200, { success: false })).toBe("dead");
    expect(seriesVerifyState(500, {})).toBe("dead");
  });

  it("the unlock claim reads the verify body's access half", () => {
    expect(seriesUnlockedFromVerify({ success: true, access: { unlocked: true, watchUrl: `/playlist/${SERIES_ID}` } })).toBe(true);
    expect(seriesUnlockedFromVerify({ success: true, access: null })).toBe(false);
    expect(seriesUnlockedFromVerify({})).toBe(false);
  });
});

/* ─── Product drops ────────────────────────────────────────────── */

const DROP_AT = "2026-12-01T00:00:00.000Z";
const dropDto = { id: "drop-1", state: "upcoming", isUpcoming: true, dropAt: DROP_AT, notifiedAt: null };

describe("drops — owner products + schedule rails", () => {
  it("the owner's products parse with their server-computed drop", () => {
    const parsed = parseDroppableProducts({
      products: [
        { id: "p1", title: "Gold Tee", priceCents: 4999, isActive: true, drop: dropDto },
        { id: "p2", title: "Plain Hoodie", priceCents: 8999, isActive: true, drop: null },
        { title: "no id" },
      ],
    });
    expect(parsed).toHaveLength(2);
    expect(parsed![0]!.drop).toEqual({ id: "drop-1", state: "upcoming", isUpcoming: true, dropAt: DROP_AT, captureCount: undefined });
    expect(parsed![1]!.drop).toBeNull();
    expect(parseDroppableProducts({})).toBeNull();
  });

  it("my profile ref is the ownership anchor — id + slug or nothing", () => {
    expect(parseMyProfileRef({ id: "prof-1", slug: "king" })).toEqual({ id: "prof-1", slug: "king" });
    expect(parseMyProfileRef({ id: "prof-1" })).toBeNull();
  });

  it("the schedule payload is ONE UTC instant under the rail's future gate", () => {
    const now = new Date("2026-11-03T12:00:00Z").getTime();
    const local = dropLocalInputValue(new Date(now + 3_600_000).toISOString())!;
    const payload = buildDropSchedulePayload(local, now);
    expect(payload).not.toBeNull();
    expect(new Date(payload!.dropAt).getTime()).toBe(now + 3_600_000);
    expect(dropScheduleProblem(local, now)).toBeNull();
  });

  it("past and empty moments are refused in the form first", () => {
    const now = new Date("2026-11-03T12:00:00Z").getTime();
    expect(dropScheduleProblem("", now)).toContain("Pick the drop date");
    expect(dropScheduleProblem("2020-01-01T00:00", now)).toContain("in the future");
    expect(buildDropSchedulePayload("2020-01-01T00:00", now)).toBeNull();
    expect(dropAtIsoFromLocalInput("junk")).toBeNull();
    expect(dropAtIsoFromLocalInput("")).toBeNull();
  });

  it("the drop answer distinguishes a scheduled drop, a cancel (null), and junk (undefined)", () => {
    expect(parseDropAnswer({ drop: dropDto })?.state).toBe("upcoming");
    expect(parseDropAnswer({ ok: true, drop: null })).toBeNull();
    expect(parseDropAnswer({})).toBeUndefined();
    expect(parseDropAnswer(null)).toBeUndefined();
  });

  it("the owner drop read carries the capture list", () => {
    const parsed = parseDropDetail({
      drop: { ...dropDto, captureCount: 2 },
      captures: [
        { email: "fan@example.com", name: "Fan", capturedAt: "2026-11-01T00:00:00.000Z" },
        { email: "two@example.com", name: null, capturedAt: "2026-11-02T00:00:00.000Z" },
        { name: "no email" },
      ],
      captureCount: 2,
    });
    expect(parsed!.captureCount).toBe(2);
    expect(parsed!.drop?.captureCount).toBe(2);
    expect(parsed!.captures).toHaveLength(2);
    expect(parseDropDetail({ drop: null })).toBeNull();
  });

  it("the fan capture payload is the drop page's shape — a real email or nothing", () => {
    expect(buildDropCapturePayload("  Fan@Example.com ", " Fan ")).toEqual({ email: "fan@example.com", name: "Fan" });
    expect(buildDropCapturePayload("not-an-email", "")).toBeNull();
    expect(buildDropCapturePayload("", "")).toBeNull();
  });

  it("local input prefill round-trips the UTC instant in local time", () => {
    const local = dropLocalInputValue(DROP_AT);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(dropAtIsoFromLocalInput(local!)).toBe(DROP_AT);
    expect(dropLocalInputValue(null)).toBeNull();
    expect(dropLocalInputValue("junk")).toBeNull();
  });
});

/* ─── Source pins — the desk + the stand composition ───────────── */

const deskSrc = readFileSync(
  fileURLToPath(new URL("../../components/world/native/PaidSeriesDropsDesk.tsx", import.meta.url)),
  "utf8",
);
const standsSrc = readFileSync(
  fileURLToPath(new URL("../../components/world/native/ShopStands.tsx", import.meta.url)),
  "utf8",
);

describe("source pins — Paid Series + Product Drops desk", () => {
  it("the ShopStands composition renders the desk at the Marketplace stand", () => {
    expect(standsSrc).toContain('import { PaidSeriesDropsDesk } from "./PaidSeriesDropsDesk";');
    expect(standsSrc).toContain("<PaidSeriesDropsDesk isLight={isLight} isGuest={isGuest} />");
    const deskAt = standsSrc.indexOf("<PaidSeriesDropsDesk");
    const squareAt = standsSrc.indexOf('data-testid="world-shop-marketplace"');
    expect(squareAt).toBeGreaterThan(-1);
    expect(deskAt).toBeGreaterThan(squareAt);
  });

  it("series create/manage ride the playlists rails with their exact shapes", () => {
    expect(deskSrc).toContain('fetch("/api/playlists/mine"');
    expect(deskSrc).toContain('fetch("/api/playlists", {');
    expect(deskSrc).toContain("`/api/playlists/${s.id}`");
    expect(deskSrc).toContain('method: "PATCH"');
    expect(deskSrc).toContain("`/api/playlists/${s.id}/buyers`");
    expect(deskSrc).toContain("buildSeriesCreatePayload(");
    expect(deskSrc).toContain("buildSeriesPricePatch(");
    expect(deskSrc).toContain("buildSeriesPreviewPatch(");
  });

  it("the fan unlock rides the store rail embedded-first and verifies from the payment record", () => {
    expect(deskSrc).toContain("`/api/store/item/series/${id}`");
    expect(deskSrc).toContain('fetch("/api/store/checkout", {');
    expect(deskSrc).toContain("seriesCheckoutPayload(");
    expect(deskSrc).toContain('fetch("/api/store/verify", {');
    expect(deskSrc).toContain("seriesVerifyState(");
    expect(deskSrc).toContain("<EmbeddedSessionCheckout clientSecret={embedded.clientSecret} />");
    expect(deskSrc).toContain('data-testid="world-series-unlocked"');
  });

  it("drops ride the storefront drop rails — schedule, cancel, owner read", () => {
    expect(deskSrc).toContain('fetch("/api/creator-profiles/me"');
    expect(deskSrc).toContain("`/api/storefront/products?profileId=${encodeURIComponent(me.id)}`");
    expect(deskSrc).toContain("`/api/storefront/products/${p.id}/drop`");
    expect(deskSrc).toContain('method: "PUT"');
    expect(deskSrc).toContain('method: "DELETE"');
    expect(deskSrc).toContain("buildDropSchedulePayload(");
    expect(deskSrc).toContain("parseDropDetail(");
  });

  it("no 2D page is pulled up: the buy/drop pages are never navigated to", () => {
    expect(deskSrc).not.toContain('"/store/buy/series/');
    expect(deskSrc).not.toContain("window.location");
    expect(deskSrc).not.toContain("/storefront/product/");
    /* The shared buy link is only PARSED (a fan pastes it), in the lib. */
    expect(deskSrc).not.toContain("store/buy/series");
  });

  it("guests get honest member wording, never doomed owner buttons", () => {
    expect(deskSrc).toContain('data-testid="world-drops-guest"');
    expect(deskSrc).toContain('data-testid="world-series-desk"');
    expect(deskSrc).toContain('data-testid="world-drops-desk"');
  });
});
