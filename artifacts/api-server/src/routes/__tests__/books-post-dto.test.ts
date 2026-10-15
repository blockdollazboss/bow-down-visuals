/**
 * Route test for POST /api/books (routes/books).
 *
 * THE REGRESSION: POST /books responded `res.json({ book: row })` with the
 * raw Drizzle row, whose keys are snake_case (user_id, author_name,
 * cover_url, created_at, updated_at — lib/db/src/schema/thy-books.ts).
 * Both GET siblings in the same file map explicitly to camelCase, and the
 * client (pages/books.tsx) types Book in camelCase and consumes data.book
 * from the create flow as that type — so a freshly created book came back
 * with authorName / coverUrl / createdAt / updatedAt all undefined.
 * This test pins the POST response to the exact GET detail shape.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const AUTH_USER_ID = "00000000-0000-4000-8000-000000000099";
const BOOK_ID = "33333333-3333-4333-8333-333333333333";
const CREATED = new Date("2026-10-14T15:04:05.000Z");

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = AUTH_USER_ID;
    next();
  },
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: { completions: { create: async () => ({ choices: [] }) } },
    images: { generate: async () => ({ data: [] }) },
  }),
  getTextModel: () => "test-model",
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: async () => undefined,
  refundCredits: async () => undefined,
}));
vi.mock("../../lib/credits.js", () => ({
  chargeCredits: async () => undefined,
  refundCredits: async () => undefined,
}));

vi.mock("../../lib/book-export", () => ({
  generateEpub: async () => Buffer.from(""),
  generatePdf: async () => ({ pdf: Buffer.from(""), pageCount: 1 }),
  generateCoverPdf: async () => Buffer.from(""),
  bookFilename: (title: string, ext: string) => `${title}.${ext}`,
}));

vi.mock("../../lib/r2-client", () => ({
  r2Upload: async (key: string) => key,
  r2PublicUrl: (key: string) => `https://cdn.example.com/${key}`,
}));

vi.mock("../../lib/lulu-print", () => ({
  isLuluConfigured: () => false,
  getCoverDimensions: async () => ({}),
  getPrintQuote: async () => ({}),
  getShippingOptions: async () => [],
  validateInterior: async () => undefined,
  validateCover: async () => undefined,
  createPrintOrder: async () => ({}),
  getOrderStatus: async () => ({}),
  getPrintJob: async () => ({}),
  LULU_SKU_6X9_BW_PAPERBACK: "bw-sku",
  LULU_SKU_6X9_COLOR_PAPERBACK: "color-sku",
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();

  /** The row the DB returns for an insert: snake_case keys, server fields set. */
  function insertedRow(values: Record<string, unknown>): Record<string, unknown> {
    return {
      id: BOOK_ID,
      cover_url: "https://cdn.example.com/covers/my-book.png",
      created_at: CREATED,
      updated_at: CREATED,
      ...values,
    };
  }

  const fakeDb: any = {
    insert: (_table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => [insertedRow(values)],
      }),
    }),
  };

  return { ...actual, db: fakeDb };
});

import router from "../books";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/books — create response DTO", () => {
  it("returns the book in the GET camelCase shape, with no snake_case leaks", async () => {
    const r = await realFetch(`${baseUrl}/books`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "My Book",
        subtitle: "A subtitle",
        author_name: "Jane Author",
        genre: "fiction",
        description: "A book about things.",
        metadata: { audience: "creators" },
      }),
    });

    expect(r.status).toBe(200);
    const json = (await r.json()) as any;
    const book = json.book;

    expect(book.id).toBe(BOOK_ID);
    expect(book.title).toBe("My Book");
    expect(book.subtitle).toBe("A subtitle");
    expect(book.authorName).toBe("Jane Author");
    expect(book.genre).toBe("fiction");
    expect(book.description).toBe("A book about things.");
    expect(book.metadata).toEqual({ audience: "creators" });
    expect(book.coverUrl).toBe("https://cdn.example.com/covers/my-book.png");
    expect(book.createdAt).toBe(CREATED.toISOString());
    expect(book.updatedAt).toBe(CREATED.toISOString());

    // The raw row's snake_case keys must not leak — and user_id, which the
    // GET mapping omits, must not leak either.
    for (const k of ["user_id", "author_name", "cover_url", "created_at", "updated_at"]) {
      expect(book, `snake_case key ${k} must not leak`).not.toHaveProperty(k);
    }
    // Exactly the GET detail shape, nothing more.
    expect(Object.keys(book).sort()).toEqual(
      [
        "id", "title", "subtitle", "authorName", "genre", "description",
        "metadata", "coverUrl", "createdAt", "updatedAt",
      ].sort(),
    );
  });
});
