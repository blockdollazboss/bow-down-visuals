/**
 * business-benches — Stack 400 world parity (Lane B items
 * 10, 13, 14, 22) seam pins. Every bench must ride its 2D
 * twin's own rail at the registry's price, shape its post
 * exactly as the twin posts it, enforce the twin's own gates,
 * and hold every answer to the twin's real shape — a drifted
 * payload parses to null, never to a dressed-up success.
 */
import { describe, expect, it } from "vitest";
import {
  CALENDAR_PLATFORMS,
  CONTENT_CALENDAR_PATH,
  DEAL_MATCH_MAX_PLATFORMS,
  DEAL_MATCH_PATH,
  INVOICE_CURRENCIES,
  INVOICE_GENERATE_PATH,
  INVOICES_PATH,
  ONE_SHEET_DEFAULT_ENERGY,
  ONE_SHEET_PATH,
  SPONSOR_READ_LENGTHS,
  SPONSOR_READ_MAX_POINTS,
  SPONSOR_READ_PATH,
  SPONSOR_READ_TONE_LABEL_KEYS,
  SPONSOR_READ_TONES,
  STOCK_IMPORT_PATH,
  STOCK_PER_PAGE,
  STOCK_SEARCH_PATH,
  STOCK_TYPES,
  calendarDaysOf,
  calendarTodayISO,
  contentCalendarCost,
  contentCalendarPayload,
  dealMatchCanRun,
  dealMatchCost,
  dealMatchPayload,
  dealMatchesOf,
  formatInvoiceDate,
  formatInvoiceMoney,
  invoiceCanRun,
  invoiceCost,
  invoiceDefaultDueDate,
  invoiceGeneratedOf,
  invoiceLineItemsOf,
  invoiceListOf,
  invoicePayload,
  invoiceStatusPath,
  invoiceTotalCentsOf,
  invoiceUpdatedOf,
  oneSheetCanRun,
  oneSheetCost,
  oneSheetOf,
  oneSheetPayload,
  oneSheetShareUrl,
  sponsorReadAddPoint,
  sponsorReadCanRun,
  sponsorReadCost,
  sponsorReadOf,
  sponsorReadPayload,
  stockImportCost,
  stockImportPayload,
  stockImportedOf,
  stockNotConfigured,
  stockSearchCost,
  stockSearchOf,
  stockSearchUrl,
} from "./business-benches";
import { getCreditCost } from "../credit-costs";

describe("the rails + the prices — 400-wave test obligations", () => {
  it("pins every rail at its registry price (100 / 100 / 50 / 150 / 150 / 0 / 50)", () => {
    expect(DEAL_MATCH_PATH).toBe("/api/sponsors/match");
    expect(getCreditCost(DEAL_MATCH_PATH)?.cost).toBe(100);
    expect(dealMatchCost()).toBe(100);

    expect(SPONSOR_READ_PATH).toBe("/api/sponsor-read");
    expect(getCreditCost(SPONSOR_READ_PATH)?.cost).toBe(100);
    expect(sponsorReadCost()).toBe(100);

    expect(INVOICE_GENERATE_PATH).toBe("/api/generate-invoice");
    expect(getCreditCost(INVOICE_GENERATE_PATH)?.cost).toBe(50);
    expect(invoiceCost()).toBe(50);

    expect(ONE_SHEET_PATH).toBe("/api/sync-pitch/one-sheet");
    expect(getCreditCost(ONE_SHEET_PATH)?.cost).toBe(150);
    expect(oneSheetCost()).toBe(150);

    expect(CONTENT_CALENDAR_PATH).toBe("/api/content-calendar");
    expect(getCreditCost(CONTENT_CALENDAR_PATH)?.cost).toBe(150);
    expect(contentCalendarCost()).toBe(150);

    expect(STOCK_SEARCH_PATH).toBe("/api/stock/search");
    expect(getCreditCost(STOCK_SEARCH_PATH)?.cost).toBe(0);
    expect(stockSearchCost()).toBe(0);

    expect(STOCK_IMPORT_PATH).toBe("/api/stock/import");
    expect(getCreditCost(STOCK_IMPORT_PATH)?.cost).toBe(50);
    expect(stockImportCost()).toBe(50);

    expect(INVOICES_PATH).toBe("/api/invoices");
    expect(invoiceStatusPath("inv 1")).toBe("/api/invoices/inv%201");
  });
});

describe("B-10 · the Deal Matcher shaping — the page's runMatcher post", () => {
  it("posts digits-only followers and the comma platforms capped at five", () => {
    expect(
      dealMatchPayload({
        niche: " Music ",
        followers: "25,000 fans",
        platforms: "tiktok, instagram , , youtube, x, twitch, extra",
      }),
    ).toEqual({
      niche: "Music",
      followers: 25000,
      platforms: ["tiktok", "instagram", "youtube", "x", "twitch"],
    });
    expect(DEAL_MATCH_MAX_PLATFORMS).toBe(5);
    expect(dealMatchPayload({ niche: "n", followers: "", platforms: "" }).followers).toBe(0);
  });

  it("gates on the niche exactly as the page does", () => {
    expect(dealMatchCanRun({ niche: "Music", followers: "", platforms: "" })).toBe(true);
    expect(dealMatchCanRun({ niche: "  ", followers: "10", platforms: "" })).toBe(false);
  });

  it("parses matches, note and credits; an empty list is an honest empty", () => {
    expect(
      dealMatchesOf({
        matches: [{ dealId: "d1", brandName: "Wave", score: 92, why: "fit" }],
        note: "2 deals",
        creditsRemaining: 800,
      }),
    ).toEqual({
      matches: [{ dealId: "d1", brandName: "Wave", score: 92, why: "fit" }],
      note: "2 deals",
      creditsRemaining: 800,
    });
    expect(dealMatchesOf({ matches: [] })).toEqual({ matches: [], note: "", creditsRemaining: null });
    expect(dealMatchesOf({ matches: [{ brandName: "Wave" }] })).toBeNull();
    expect(dealMatchesOf({})).toBeNull();
    expect(dealMatchesOf(null)).toBeNull();
  });
});

describe("B-22 · the Sponsor Read shaping — the panel's generate post", () => {
  it("carries the panel's enums + tone label keys verbatim", () => {
    expect(SPONSOR_READ_LENGTHS).toEqual(["30", "60", "90"]);
    expect(SPONSOR_READ_TONES).toEqual(["energetic", "casual", "luxury", "humorous"]);
    expect(SPONSOR_READ_TONE_LABEL_KEYS.luxury).toBe("outreach.sponsorReadToneLuxury");
    expect(SPONSOR_READ_MAX_POINTS).toBe(10);
  });

  it("posts trimmed fields and applies the panel's add-point rule", () => {
    expect(
      sponsorReadPayload({
        brandName: " Wave ",
        productDescription: " drink ",
        readLength: "60",
        tone: "casual",
        keyPoints: ["zero sugar"],
      }),
    ).toEqual({
      brandName: "Wave",
      productDescription: "drink",
      readLength: "60",
      tone: "casual",
      keyPoints: ["zero sugar"],
    });
    expect(sponsorReadAddPoint(["a"], " b ")).toEqual(["a", "b"]);
    expect(sponsorReadAddPoint(["a"], "a")).toEqual(["a"]);
    expect(sponsorReadAddPoint(["a"], "  ")).toEqual(["a"]);
    const ten = Array.from({ length: 10 }, (_, i) => `p${i}`);
    expect(sponsorReadAddPoint(ten, "p11")).toEqual(ten);
  });

  it("gates on brand + one point, and a read needs its script", () => {
    const base = { brandName: "Wave", productDescription: "", readLength: "30" as const, tone: "energetic" as const, keyPoints: ["x"] };
    expect(sponsorReadCanRun(base)).toBe(true);
    expect(sponsorReadCanRun({ ...base, keyPoints: [] })).toBe(false);
    expect(sponsorReadCanRun({ ...base, brandName: " " })).toBe(false);
    expect(
      sponsorReadOf({ read: { script: "Say it.", hookLine: "H", ctaLine: "C", estimatedSeconds: 31 } }),
    ).toEqual({ script: "Say it.", hookLine: "H", ctaLine: "C", estimatedSeconds: 31 });
    expect(sponsorReadOf({ read: { hookLine: "H" } })).toBeNull();
    expect(sponsorReadOf({})).toBeNull();
  });
});

describe("B-13 · the Invoice shaping — the panel's generate post", () => {
  const drafts = [
    { description: " Sponsored post ", quantity: "2", rate: "150.50" },
    { description: "", quantity: "1", rate: "10" },
    { description: "Story", quantity: "0", rate: "10" },
    { description: "Reel", quantity: "1", rate: "abc" },
  ];

  it("carries the panel's currencies verbatim", () => {
    expect(INVOICE_CURRENCIES).toEqual(["USD", "EUR", "GBP", "CAD", "AUD"]);
  });

  it("shapes dollars to rateCents and drops blank/invalid rows", () => {
    expect(invoiceLineItemsOf(drafts)).toEqual([
      { description: "Sponsored post", quantity: 2, rateCents: 15050 },
    ]);
    /* The panel's TOTAL is looser than its posted items: it
       counts every finite qty>0 / rate>=0 row — including the
       blank-description one (1 × $10) — so 30100 + 1000. */
    expect(invoiceTotalCentsOf(drafts)).toBe(31100);
  });

  it("posts every field trimmed with the shaped items", () => {
    const input = {
      brandName: " Wave ",
      brandEmail: " b@x.com ",
      creatorName: " Thy ",
      creatorEmail: " ",
      paymentDetails: " Zelle ",
      items: drafts,
      currency: "EUR" as const,
      dueDate: "2026-12-01",
      notes: " thanks ",
    };
    expect(invoicePayload(input)).toEqual({
      brandName: "Wave",
      brandEmail: "b@x.com",
      creatorName: "Thy",
      creatorEmail: "",
      paymentDetails: "Zelle",
      lineItems: [{ description: "Sponsored post", quantity: 2, rateCents: 15050 }],
      currency: "EUR",
      dueDate: "2026-12-01",
      notes: "thanks",
    });
    expect(invoiceCanRun(input)).toBe(true);
    expect(invoiceCanRun({ ...input, brandName: " " })).toBe(false);
    expect(invoiceCanRun({ ...input, items: [{ description: "", quantity: "1", rate: "1" }] })).toBe(false);
  });

  it("defaults the due date 30 days out, ISO", () => {
    expect(invoiceDefaultDueDate(new Date("2026-11-08T12:00:00Z"))).toBe("2026-12-08");
  });

  it("a generate answer needs the invoice AND its PDF", () => {
    const invoice = {
      id: "i1", invoiceNumber: "INV-1", brandName: "Wave", brandEmail: null,
      creatorName: "Thy", creatorEmail: null, paymentDetails: null,
      lineItems: [{ description: "Post", quantity: 1, rateCents: 10000 }],
      totalCents: 10000, currency: "USD", dueDate: "2026-12-01", notes: null,
      status: "unpaid", paidAt: null, createdAt: "2026-11-08T00:00:00Z",
    };
    const got = invoiceGeneratedOf({ invoice, pdfBase64: "QUJD", creditsRemaining: 42 });
    expect(got?.invoice.invoiceNumber).toBe("INV-1");
    expect(got?.pdfFilename).toBe("INV-1.pdf");
    expect(got?.creditsRemaining).toBe(42);
    expect(invoiceGeneratedOf({ invoice })).toBeNull();
    expect(invoiceGeneratedOf({ pdfBase64: "QUJD" })).toBeNull();
    expect(invoiceListOf({ invoices: [invoice] })?.[0]?.status).toBe("unpaid");
    expect(invoiceListOf({})).toBeNull();
    expect(invoiceUpdatedOf({ invoice: { ...invoice, status: "paid" } })?.status).toBe("paid");
  });

  it("renders money + dates the panel's way", () => {
    expect(formatInvoiceMoney(30100, "USD")).toBe("$301.00");
    /* "XXX" is a real (unused) ISO code in this runtime's Intl
       data, so it formats with the generic ¤ sign instead of
       throwing into the panel's fallback — pin the fallback
       path with a code Intl genuinely rejects. */
    expect(formatInvoiceMoney(100, "ZZ")).toBe("ZZ 1.00");
    expect(formatInvoiceDate("not-a-date")).toBe("not-a-date");
  });
});

describe("B-14 · the One-Sheet shaping — the tab's generateSheet post", () => {
  const input = {
    songTitle: " Midnight ",
    artistName: " Thy ",
    genre: " dark pop ",
    mood: " brooding ",
    bpm: " 92 ",
    musicalKey: " A minor ",
    energy: 60,
    description: " a song ",
    instrumentalAvailable: true,
    stemsAvailable: false,
    contactName: " Me ",
    contactEmail: " me@x.com ",
  };

  it("posts trimmed fields, energy as the number, no library id in-World", () => {
    const payload = oneSheetPayload(input);
    expect(payload).toEqual({
      songTitle: "Midnight",
      artistName: "Thy",
      genre: "dark pop",
      mood: "brooding",
      bpm: "92",
      musicalKey: "A minor",
      energy: 60,
      description: "a song",
      instrumentalAvailable: true,
      stemsAvailable: false,
      contactName: "Me",
      contactEmail: "me@x.com",
    });
    expect("songLibraryId" in payload).toBe(false);
    expect(ONE_SHEET_DEFAULT_ENERGY).toBe(60);
  });

  it("gates on the title and parses a full sheet; drift is null", () => {
    expect(oneSheetCanRun(input)).toBe(true);
    expect(oneSheetCanRun({ ...input, songTitle: " " })).toBe(false);
    const sheet = {
      id: "s1", songTitle: "Midnight", artistName: "Thy", songLibraryId: null,
      content: {
        logline: "A midnight anthem.", moodTags: ["brooding"], soundsLike: "Billie",
        comparableArtists: ["Billie Eilish"], syncUses: ["Trailer"],
        pitchEmail: { subject: "Midnight", body: "Hi" },
        licensingNotes: "One-stop.", disclaimer: "AI-drafted.",
      },
      moodTags: ["brooding"], bpm: "92", musicalKey: "A minor",
      comparableArtists: ["Billie Eilish"], soundsLike: "Billie",
      instrumentalAvailable: true, stemsAvailable: false,
      contactName: "Me", contactEmail: "me@x.com", shareToken: "tok1",
      createdAt: "2026-11-08T00:00:00Z",
    };
    const parsed = oneSheetOf({ oneSheet: sheet });
    expect(parsed?.content.logline).toBe("A midnight anthem.");
    expect(parsed?.shareToken).toBe("tok1");
    expect(oneSheetShareUrl("https://bowdownvisuals.com", parsed!)).toBe(
      "https://bowdownvisuals.com/sync-one-sheet/tok1",
    );
    expect(oneSheetOf({ oneSheet: { id: "s1", songTitle: "x" } })).toBeNull();
    expect(oneSheetOf({})).toBeNull();
  });
});

describe("B-22 · the Content Calendar shaping — Step 5's run post", () => {
  it("carries the step's platforms verbatim", () => {
    expect(CALENDAR_PLATFORMS).toEqual(["tiktok", "youtube", "instagram"]);
  });

  it("slices the niche to 120 and clamps the cadence into 1–14", () => {
    expect(
      contentCalendarPayload({
        niche: ` ${"x".repeat(200)} `,
        platforms: ["tiktok"],
        postsPerWeek: "99",
        startDate: "2026-11-09",
      }),
    ).toEqual({
      niche: "x".repeat(120),
      platforms: ["tiktok"],
      postsPerWeek: 14,
      startDate: "2026-11-09",
    });
    expect(
      contentCalendarPayload({ niche: "n", platforms: [], postsPerWeek: "abc", startDate: "2026-11-09" }).postsPerWeek,
    ).toBe(3);
    /* "0" parses to 0, which the step's `|| 3` treats as unset —
       so the fallback 3 wins over the lower clamp, exactly as
       StepCalendar posts it. */
    expect(
      contentCalendarPayload({ niche: "n", platforms: [], postsPerWeek: "0", startDate: "2026-11-09" }).postsPerWeek,
    ).toBe(3);
  });

  it("today is an ISO date; a calendar needs at least one post day", () => {
    expect(calendarTodayISO(new Date(2026, 10, 8))).toBe("2026-11-08");
    const day = {
      date: "2026-11-09", dayLabel: "Mon Nov 9", post: true, title: "Hook post",
      format: "short", platform: "tiktok", hook: "POV", bestTime: "6 PM",
    };
    expect(calendarDaysOf({ days: [day] })).toEqual([day]);
    expect(calendarDaysOf({ days: [{ ...day, post: false }] })).toBeNull();
    expect(calendarDaysOf({})).toBeNull();
    expect(calendarDaysOf(null)).toBeNull();
  });
});

describe("B-22 · the Stock shaping — the editor panel's rails", () => {
  const item = {
    id: "st1", type: "video" as const, title: "City nights",
    previewUrl: "https://x/p.jpg", fileUrl: "https://x/v.mp4",
    downloadUrl: "https://x/d.mp4", width: 1920, height: 1080,
    durationSec: 12, photographer: "Sam", photographerUrl: "https://x/sam",
    sourceUrl: "https://x/src",
  };

  it("carries the panel's types + page size verbatim", () => {
    expect(STOCK_TYPES).toEqual(["video", "photo"]);
    expect(STOCK_PER_PAGE).toBe(12);
  });

  it("builds the panel's search URL", () => {
    expect(stockSearchUrl("city nights", "video", 2)).toBe(
      "/api/stock/search?q=city%20nights&type=video&page=2&per_page=12",
    );
  });

  it("posts the panel's import body, projectId omitted in-World", () => {
    const payload = stockImportPayload(item);
    expect(payload).toEqual({
      itemId: "st1",
      type: "video",
      title: "City nights",
      previewUrl: "https://x/p.jpg",
      fileUrl: "https://x/v.mp4",
      photographer: "Sam",
      photographerUrl: "https://x/sam",
      width: 1920,
      height: 1080,
      durationSec: 12,
    });
    expect("projectId" in payload).toBe(false);
  });

  it("parses search + import answers; the not-configured verdict is honest", () => {
    expect(stockSearchOf({ items: [item], totalResults: 40 })?.totalResults).toBe(40);
    expect(stockSearchOf({})).toBeNull();
    expect(stockImportedOf({ success: true, item })?.id).toBe("st1");
    expect(stockImportedOf({ success: false, item })).toBeNull();
    expect(stockImportedOf({ item })).toBeNull();
    expect(stockNotConfigured(503, {})).toBe(true);
    expect(stockNotConfigured(200, { error: "stock_not_configured" })).toBe(true);
    expect(stockNotConfigured(200, { items: [] })).toBe(false);
  });
});
