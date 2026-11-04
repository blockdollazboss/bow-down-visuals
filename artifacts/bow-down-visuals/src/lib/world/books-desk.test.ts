import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BOOK_AI_ASSIST_COST_VB,
  BOOK_COVER_COST_VB,
  BOOK_PRINT_ORDERS_PATH,
  assistActionChapterOnly,
  assistResultInsertable,
  bookChapterPath,
  bookChaptersPath,
  bookCoverPath,
  bookExportPath,
  bookExportReady,
  bookFormReady,
  bookPath,
  bookPrintOrderCancelPath,
  bookPrintOrderPath,
  bookPrintOrderStatusPath,
  bookPrintQuotePath,
  buildAssistBody,
  buildBookBody,
  buildChapterContentBody,
  buildChapterCreateBody,
  buildCoverBody,
  buildPrintOrderBody,
  buildPrintQuoteBody,
  chapterTitleReady,
  countBookWords,
  normalizeAssistResult,
  normalizeBookDetail,
  normalizeBooks,
  normalizeCoverResult,
  normalizeCreatedChapter,
  normalizePrintOrderPlaced,
  normalizePrintOrders,
  normalizePrintQuote,
  printAddressReady,
  printQuantityReady,
  printTotalVb,
  totalBookWords,
  BOOK_ASSIST_ACTIONS,
  EMPTY_PRINT_ADDRESS,
  type BookForm,
  type BookPrintQuote,
} from "./books-desk";

/* ─── Books desk (stack1400 world parity wave 2) ───────────────────
   Thy Books native at My Studio, on the books router's own rails.
   These tests pin the seam: the camelCase DTOs normalized once,
   the raw snake_case chapter row the POST returns, the assist +
   cover prices against the registry, the print price as the
   SERVER's quote (never the desk's invention), and the form rules
   against the rail's zod schemas. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const BOOK = {
  id: "bk-1",
  title: "Shark Fin Memoirs",
  subtitle: "A palace tale",
  authorName: "Thy Author",
  genre: "Memoir",
  description: "From the tank to the throne.",
  metadata: {},
  coverUrl: "https://cdn.example/cover.png",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
};

const CHAPTER = {
  id: "ch-1",
  title: "The First Fin",
  content: "It began in shallow water.",
  position: 0,
  aiNotes: null,
  wordCount: 5,
  updatedAt: "2026-10-02T00:00:00.000Z",
};

describe("rails + prices", () => {
  it("the paths are the books page's own endpoints", () => {
    expect(bookPath("bk-1")).toBe("/api/books/bk-1");
    expect(bookChaptersPath("bk-1")).toBe("/api/books/bk-1/chapters");
    expect(bookChapterPath("bk-1", "ch-1")).toBe("/api/books/bk-1/chapters/ch-1");
    expect(bookCoverPath("bk-1")).toBe("/api/books/bk-1/cover/generate");
    expect(bookExportPath("bk-1", "epub")).toBe("/api/books/bk-1/export/epub");
    expect(bookExportPath("bk-1", "pdf")).toBe("/api/books/bk-1/export/pdf");
    expect(bookPrintQuotePath("bk-1")).toBe("/api/books/bk-1/print/quote");
    expect(bookPrintOrderPath("bk-1")).toBe("/api/books/bk-1/print/order");
    expect(BOOK_PRINT_ORDERS_PATH).toBe("/api/books/print/orders");
    expect(bookPrintOrderStatusPath("ord-1")).toBe("/api/books/print/orders/ord-1/status");
    expect(bookPrintOrderCancelPath("ord-1")).toBe("/api/books/print/orders/ord-1/cancel");
  });

  it("assist is the registry's pinned 100 and cover the pinned 200 — print has NO pinned price", () => {
    expect(BOOK_AI_ASSIST_COST_VB).toBe(100);
    expect(BOOK_COVER_COST_VB).toBe(200);
    const costs = read("../credit-costs.ts");
    expect(costs).toContain('"/api/books/ai/assist": { cost: 100, feature: "Thy Books AI Writing Assist" }');
    expect(costs).toContain(
      '"/api/books/:id/cover/generate": { cost: 200, feature: "Thy Books AI Cover Generation" }',
    );
    /* The server charges the assist/cover at exactly these numbers. */
    const rail = read("../../../../api-server/src/routes/books.ts");
    expect(rail).toContain('"books_ai_assist"');
    expect(rail).toContain('"books_cover_generate"');
    /* Print: the quote rail computes priceVb server-side. */
    expect(rail).toContain("priceVb: Math.ceil(printCostUsd * 100 * USD_CENTS_TO_VB * LULU_MARKUP)");
  });
});

describe("normalizers", () => {
  it("the list rows map field-for-field; a broken row fails the read", () => {
    const [b] = normalizeBooks({ books: [BOOK] })!;
    expect(b).toEqual({
      id: "bk-1",
      title: "Shark Fin Memoirs",
      subtitle: "A palace tale",
      authorName: "Thy Author",
      genre: "Memoir",
      description: "From the tank to the throne.",
      coverUrl: "https://cdn.example/cover.png",
      updatedAt: "2026-10-02T00:00:00.000Z",
    });
    expect(normalizeBooks({ books: [{ id: "x" }] })).toBeNull();
    expect(normalizeBooks({})).toBeNull();
    expect(normalizeBooks({ books: [] })).toEqual([]);
  });

  it("the detail carries the book + its ordered chapters", () => {
    const detail = normalizeBookDetail({ book: BOOK, chapters: [CHAPTER] });
    expect(detail?.book.id).toBe("bk-1");
    expect(detail?.chapters).toEqual([
      {
        id: "ch-1",
        title: "The First Fin",
        content: "It began in shallow water.",
        position: 0,
        aiNotes: null,
        wordCount: 5,
        updatedAt: "2026-10-02T00:00:00.000Z",
      },
    ]);
    expect(normalizeBookDetail({ book: BOOK, chapters: [{ id: "c" }] })).toBeNull();
    expect(normalizeBookDetail({})).toBeNull();
  });

  it("POST /chapters answers the RAW snake_case row — the desk reads that shape too", () => {
    const ch = normalizeCreatedChapter({
      chapter: {
        id: "ch-2",
        book_id: "bk-1",
        user_id: "u-1",
        title: "Second Fin",
        content: "",
        position: 1,
        ai_notes: null,
        word_count: 0,
        created_at: "2026-10-02T00:00:00.000Z",
        updated_at: "2026-10-02T00:00:00.000Z",
      },
    });
    expect(ch).toEqual({
      id: "ch-2",
      title: "Second Fin",
      content: "",
      position: 1,
      aiNotes: null,
      wordCount: 0,
      updatedAt: "2026-10-02T00:00:00.000Z",
    });
    expect(normalizeCreatedChapter({ chapter: { title: "no id" } })).toBeNull();
  });

  it("assist + cover results read their rail shapes", () => {
    expect(normalizeAssistResult({ ok: true, action: "continue", result: "And then…" })).toBe("And then…");
    expect(normalizeAssistResult({ ok: true, result: "" })).toBeNull();
    expect(normalizeCoverResult({ ok: true, cover_url: "https://cdn.example/c2.png" })).toBe(
      "https://cdn.example/c2.png",
    );
    expect(normalizeCoverResult({})).toBeNull();
  });
});

describe("forms + bodies — the rail's zod rules", () => {
  const form: BookForm = {
    title: "Shark Fin Memoirs",
    subtitle: "",
    authorName: "Thy Author",
    genre: "Memoir",
    description: "From the tank.",
  };

  it("readiness mirrors CreateBookSchema (title 1–200, subtitle/author ≤200, genre ≤100, description ≤2000)", () => {
    expect(bookFormReady(form)).toBe(true);
    expect(bookFormReady({ ...form, title: " " })).toBe(false);
    expect(bookFormReady({ ...form, title: "t".repeat(201) })).toBe(false);
    expect(bookFormReady({ ...form, genre: "g".repeat(101) })).toBe(false);
    expect(bookFormReady({ ...form, description: "d".repeat(2001) })).toBe(false);
    expect(chapterTitleReady("Chapter 1")).toBe(true);
    expect(chapterTitleReady(" ")).toBe(false);
  });

  it("the book body rides author as author_name; chapter bodies are minimal", () => {
    expect(buildBookBody({ ...form, title: "  Shark Fin Memoirs " })).toEqual({
      title: "Shark Fin Memoirs",
      subtitle: "",
      author_name: "Thy Author",
      genre: "Memoir",
      description: "From the tank.",
    });
    expect(buildChapterCreateBody("  Chapter 1 ")).toEqual({ title: "Chapter 1" });
    expect(buildChapterContentBody("Words here.")).toEqual({ content: "Words here." });
  });

  it("word counts follow the page's counter; the active chapter counts its draft", () => {
    expect(countBookWords("")).toBe(0);
    expect(countBookWords("one two  three")).toBe(3);
    const chapters = [
      { ...CHAPTER, id: "a", wordCount: 10 },
      { ...CHAPTER, id: "b", wordCount: 20 },
    ];
    expect(totalBookWords(chapters, "b", "five words in this draft now")).toBe(10 + 6);
    expect(totalBookWords(chapters, null, "")).toBe(30);
  });

  it("exports arm at one chapter, exactly the rail's refusal rule", () => {
    expect(bookExportReady(0)).toBe(false);
    expect(bookExportReady(1)).toBe(true);
  });
});

describe("the ghostwriter", () => {
  it("the six actions match the page's set, with its chapter-only split", () => {
    expect(BOOK_ASSIST_ACTIONS.map((a) => a.id)).toEqual([
      "continue",
      "rewrite",
      "expand",
      "outline",
      "title-ideas",
      "blurb",
    ]);
    expect(assistActionChapterOnly("continue")).toBe(true);
    expect(assistActionChapterOnly("outline")).toBe(false);
    /* Only chapter actions insert into a chapter (the page's rule). */
    expect(assistResultInsertable("expand")).toBe(true);
    expect(assistResultInsertable("blurb")).toBe(false);
  });

  it("the assist body is the rail's AiAssistSchema shape", () => {
    expect(
      buildAssistBody({ bookId: "bk-1", chapterId: "ch-1", action: "continue", text: "…", instruction: "funnier" }),
    ).toEqual({ bookId: "bk-1", chapterId: "ch-1", action: "continue", text: "…", instruction: "funnier" });
    expect(buildAssistBody({ bookId: "bk-1", action: "blurb", text: "premise", instruction: "" })).toEqual({
      bookId: "bk-1",
      action: "blurb",
      text: "premise",
      instruction: "",
    });
    expect(buildCoverBody("  noir ")).toEqual({ style: "noir" });
  });
});

describe("print on demand — the server's price, the page's forms", () => {
  const address = {
    ...EMPTY_PRINT_ADDRESS,
    name: "Thy Author",
    street1: "1 Palace Way",
    city: "Fin City",
    postcode: "12345",
    phoneNumber: "555-0100",
    contactEmail: "author@example.com",
  };

  it("address + quantity readiness mirrors the page's gate and the order schema", () => {
    expect(printAddressReady(address)).toBe(true);
    expect(printAddressReady({ ...address, contactEmail: "nope" })).toBe(false);
    expect(printAddressReady({ ...address, countryCode: "USA" })).toBe(false);
    expect(printAddressReady({ ...address, phoneNumber: "" })).toBe(false);
    expect(printQuantityReady(1)).toBe(true);
    expect(printQuantityReady(0)).toBe(false);
    expect(printQuantityReady(101)).toBe(false);
  });

  it("quote + order bodies are the rail's shapes (snake_case address, level + email out)", () => {
    expect(buildPrintQuoteBody({ form: address, quantity: 2, color: "bw" })).toEqual({
      countryCode: "US",
      postcode: "12345",
      quantity: 2,
      color: "bw",
    });
    expect(
      buildPrintOrderBody({ form: { ...address, stateCode: "CA" }, shippingLevel: "GROUND", quantity: 2, color: "color" }),
    ).toEqual({
      shippingAddress: {
        name: "Thy Author",
        street1: "1 Palace Way",
        city: "Fin City",
        state_code: "CA",
        country_code: "US",
        postcode: "12345",
        phone_number: "555-0100",
      },
      shippingLevel: "GROUND",
      quantity: 2,
      color: "color",
      contactEmail: "author@example.com",
    });
  });

  it("the quote normalizes with the SERVER's priceVb; the total follows the page's formula", () => {
    const quote = normalizePrintQuote({
      ok: true,
      pageCount: 120,
      quantity: 2,
      printCostUsd: 10,
      priceVb: 3000,
      markup: 1.5,
      shippingOptions: [{ id: "MAIL", label: "Mail", costUsd: 5, currency: "USD", deliveryEstimate: null }],
    });
    expect(quote).toEqual({
      pageCount: 120,
      quantity: 2,
      printCostUsd: 10,
      priceVb: 3000,
      markup: 1.5,
      shippingOptions: [{ id: "MAIL", label: "Mail", costUsd: 5 }],
    });
    /* (10 + 5) × 100 × 2 × 1.5 = 4500 — naming the confirmation only;
       the order rail recomputes and charges its own number. */
    expect(printTotalVb(quote as BookPrintQuote, 5)).toBe(4500);
    expect(normalizePrintQuote({})).toBeNull();
  });

  it("orders list + placed order read their rail shapes", () => {
    expect(
      normalizePrintOrders({
        orders: [
          {
            id: "ord-1",
            bookId: "bk-1",
            luluPrintJobId: "lj-1",
            status: "submitted",
            quantity: 2,
            pageCount: 120,
            amountCents: 1500,
            createdAt: "2026-10-03T00:00:00.000Z",
            updatedAt: "2026-10-03T00:00:00.000Z",
          },
        ],
      }),
    ).toEqual([
      {
        id: "ord-1",
        bookId: "bk-1",
        status: "submitted",
        quantity: 2,
        pageCount: 120,
        amountCents: 1500,
        createdAt: "2026-10-03T00:00:00.000Z",
      },
    ]);
    expect(normalizePrintOrders({})).toBeNull();
    expect(normalizePrintOrderPlaced({ ok: true, orderId: "ord-1", priceVb: 4500 })).toEqual({
      orderId: "ord-1",
      priceVb: 4500,
    });
  });
});

describe("the desk stands in My Studio and rides the confirmations", () => {
  const deskSrc = read("../../components/world/native/BooksDesk.tsx");
  const boardSrc = read("../../components/world/native/boards/StudioBoard.tsx");

  it("StudioBoard mounts it (the controller path: my-studio → board → desk)", () => {
    expect(boardSrc).toContain('import { BooksDesk } from "@/components/world/native/BooksDesk"');
    expect(boardSrc).toContain("<BooksDesk isLight={isLight} />");
  });

  it("charged actions ride confirmedFetch with the pinned costs; print names the quoted total", () => {
    expect(deskSrc).toContain('data-testid="world-books-desk"');
    expect(deskSrc).toContain("confirmedFetch(BOOK_AI_ASSIST_PATH");
    expect(deskSrc).toContain("overrideCost: BOOK_AI_ASSIST_COST_VB");
    expect(deskSrc).toContain("confirmedFetch(bookCoverPath(detail.book.id)");
    expect(deskSrc).toContain("overrideCost: BOOK_COVER_COST_VB");
    expect(deskSrc).toContain("confirmedFetch(bookPrintOrderPath(detail.book.id)");
    expect(deskSrc).toContain("overrideCost: totalVb");
  });

  it("the whole flow completes in-world: no page pull-up, no exit to /books or /storefronts", () => {
    expect(deskSrc).not.toContain("/storefronts");
    expect(deskSrc).not.toContain('"/books"');
    expect(deskSrc).not.toContain("useLocation");
    expect(deskSrc).not.toContain("window.location");
    /* Deletes are two-step, spoken in-world. */
    expect(deskSrc).toContain("worldCatalogLibrary.sharedDeleteConfirm");
    /* A failed load is never dressed as an empty shelf. */
    expect(deskSrc).toContain("worldCatalogLibrary.booksLoadErrorMessage");
  });
});
