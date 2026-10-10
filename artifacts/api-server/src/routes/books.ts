import { Router, json } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { db, booksTable, bookChaptersTable, bookPrintOrdersTable } from "@workspace/db";
import { eq, asc, desc, and } from "drizzle-orm";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { deductCredits } from "../lib/credits.js";
import { generateEpub, generatePdf, generateCoverPdf, bookFilename, type BookExportData } from "../lib/book-export";
import { r2Upload, r2PublicUrl } from "../lib/r2-client";
import {
  isLuluConfigured,
  getCoverDimensions,
  getPrintQuote,
  getShippingOptions,
  validateInterior,
  validateCover,
  createPrintOrder,
  getOrderStatus,
  getPrintJob,
  LULU_SKU_6X9_BW_PAPERBACK,
  LULU_SKU_6X9_COLOR_PAPERBACK,
  type ShippingAddressInput,
} from "../lib/lulu-print";

const IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL"] || "gpt-image-2.5-sunburst";

/* $1 USD = 200 Visual Bucs. Markup on Lulu cost — configurable. */
const USD_CENTS_TO_VB = 2;
const LULU_MARKUP = Number(process.env["LULU_MARKUP_MULTIPLIER"] ?? "1.5");

const router = Router();

/* Chapter bodies can be long — allow a roomy (but bounded) body. */
router.use(json({ limit: "2mb" }));

/* ── Schemas ── */

const CreateBookSchema = z.object({
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(200).optional().default(""),
  author_name: z.string().trim().max(200).optional().default(""),
  genre: z.string().trim().max(100).optional().default(""),
  description: z.string().trim().max(2000).optional().default(""),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

const UpdateBookSchema = CreateBookSchema.partial();

const CreateChapterSchema = z.object({
  title: z.string().trim().min(1).max(200),
  position: z.number().int().min(0).optional(),
});

const UpdateChapterSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(500_000).optional(),
  position: z.number().int().min(0).optional(),
  ai_notes: z.string().max(50_000).nullable().optional(),
});

const AiAssistSchema = z.object({
  bookId: z.string().uuid(),
  chapterId: z.string().uuid().optional(),
  action: z.enum(["continue", "rewrite", "expand", "outline", "title-ideas", "blurb"]),
  /* The text to work on (chapter content, or book description for outline/blurb). */
  text: z.string().max(100_000).optional().default(""),
  /* Extra instruction from the user, e.g. "make it funnier". */
  instruction: z.string().max(2000).optional().default(""),
});

/* ── Helpers ── */

function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return text.trim() ? words.length : 0;
}

async function getOwnedBook(bookId: string, userId: string) {
  const rows = await db
    .select()
    .from(booksTable)
    .where(and(eq(booksTable.id, bookId), eq(booksTable.user_id, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/* Express types req.params values as string | string[] — coerce. */
function param(req: { params: Record<string, string | string[]> }, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : v;
}

/* ── Book CRUD ── */

/* List the user's books. */
router.get("/api/books", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(booksTable)
      .where(eq(booksTable.user_id, req.userId!))
      .orderBy(desc(booksTable.updated_at));
    res.json({
      books: rows.map((b) => ({
        id: b.id,
        title: b.title,
        subtitle: b.subtitle,
        authorName: b.author_name,
        genre: b.genre,
        description: b.description,
        metadata: b.metadata ?? {},
        coverUrl: b.cover_url,
        createdAt: b.created_at,
        updatedAt: b.updated_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list books" });
  }
});

/* Create a book project. */
router.post("/api/books", requireAuth, async (req, res) => {
  const parsed = CreateBookSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid book data" });
    return;
  }
  try {
    const [row] = await db
      .insert(booksTable)
      .values({
        user_id: req.userId!,
        title: parsed.data.title,
        subtitle: parsed.data.subtitle || null,
        author_name: parsed.data.author_name || null,
        genre: parsed.data.genre || null,
        description: parsed.data.description || null,
        metadata: parsed.data.metadata,
      })
      .returning();
    res.json({ book: row });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create book" });
  }
});

/* Get a book with its chapters. */
router.get("/api/books/:id", requireAuth, async (req, res) => {
  try {
    const book = await getOwnedBook(param(req, "id"), req.userId!);
    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    const chapters = await db
      .select()
      .from(bookChaptersTable)
      .where(eq(bookChaptersTable.book_id, book.id))
      .orderBy(asc(bookChaptersTable.position));
    res.json({
      book: {
        id: book.id,
        title: book.title,
        subtitle: book.subtitle,
        authorName: book.author_name,
        genre: book.genre,
        description: book.description,
        metadata: book.metadata ?? {},
        coverUrl: book.cover_url,
        createdAt: book.created_at,
        updatedAt: book.updated_at,
      },
      chapters: chapters.map((c) => ({
        id: c.id,
        title: c.title,
        content: c.content,
        position: c.position,
        aiNotes: c.ai_notes,
        wordCount: c.word_count,
        updatedAt: c.updated_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load book" });
  }
});

/* Update a book. */
router.put("/api/books/:id", requireAuth, async (req, res) => {
  const parsed = UpdateBookSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid book data" });
    return;
  }
  try {
    const book = await getOwnedBook(param(req, "id"), req.userId!);
    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.subtitle !== undefined) patch.subtitle = parsed.data.subtitle || null;
    if (parsed.data.author_name !== undefined) patch.author_name = parsed.data.author_name || null;
    if (parsed.data.genre !== undefined) patch.genre = parsed.data.genre || null;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description || null;
    if (parsed.data.metadata !== undefined) patch.metadata = parsed.data.metadata;
    await db.update(booksTable).set(patch).where(eq(booksTable.id, book.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update book" });
  }
});

/* Delete a book (chapters cascade). */
router.delete("/api/books/:id", requireAuth, async (req, res) => {
  try {
    const book = await getOwnedBook(param(req, "id"), req.userId!);
    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    await db.delete(booksTable).where(eq(booksTable.id, book.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete book" });
  }
});

/* ── Chapter CRUD ── */

/* Add a chapter. */
router.post("/api/books/:id/chapters", requireAuth, async (req, res) => {
  const parsed = CreateChapterSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid chapter data" });
    return;
  }
  try {
    const book = await getOwnedBook(param(req, "id"), req.userId!);
    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    const existing = await db
      .select({ position: bookChaptersTable.position })
      .from(bookChaptersTable)
      .where(eq(bookChaptersTable.book_id, book.id))
      .orderBy(desc(bookChaptersTable.position))
      .limit(1);
    const position = parsed.data.position ?? (existing[0] ? existing[0].position + 1 : 0);
    const [chapter] = await db
      .insert(bookChaptersTable)
      .values({
        book_id: book.id,
        user_id: req.userId!,
        title: parsed.data.title,
        content: "",
        position,
        word_count: 0,
      })
      .returning();
    await db.update(booksTable).set({ updated_at: new Date() }).where(eq(booksTable.id, book.id));
    res.json({ chapter });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to add chapter" });
  }
});

/* Update a chapter. */
router.put("/api/books/:id/chapters/:chapterId", requireAuth, async (req, res) => {
  const parsed = UpdateChapterSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid chapter data" });
    return;
  }
  try {
    const book = await getOwnedBook(param(req, "id"), req.userId!);
    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    const rows = await db
      .select()
      .from(bookChaptersTable)
      .where(
        and(
          eq(bookChaptersTable.id, param(req, "chapterId")),
          eq(bookChaptersTable.book_id, book.id)
        )
      )
      .limit(1);
    if (!rows[0]) {
      res.status(404).json({ error: "Chapter not found" });
      return;
    }
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.position !== undefined) patch.position = parsed.data.position;
    if (parsed.data.ai_notes !== undefined) patch.ai_notes = parsed.data.ai_notes;
    if (parsed.data.content !== undefined) {
      patch.content = parsed.data.content;
      patch.word_count = countWords(parsed.data.content);
    }
    await db.update(bookChaptersTable).set(patch).where(eq(bookChaptersTable.id, rows[0].id));
    await db.update(booksTable).set({ updated_at: new Date() }).where(eq(booksTable.id, book.id));
    res.json({ ok: true, wordCount: patch.word_count ?? rows[0].word_count });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update chapter" });
  }
});

/* Delete a chapter. */
router.delete("/api/books/:id/chapters/:chapterId", requireAuth, async (req, res) => {
  try {
    const book = await getOwnedBook(param(req, "id"), req.userId!);
    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    await db
      .delete(bookChaptersTable)
      .where(
        and(
          eq(bookChaptersTable.id, param(req, "chapterId")),
          eq(bookChaptersTable.book_id, book.id)
        )
      );
    await db.update(booksTable).set({ updated_at: new Date() }).where(eq(booksTable.id, book.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete chapter" });
  }
});

/* ── AI writing assistance ──
   1 credit (100 Visual Bucs) per assist. Each action maps to a prompt. */

const ASSIST_SYSTEM = `You are Thy Books' ghostwriter — a bestselling book coach built into Bow Down Visuals.
Write in the author's voice, match the genre and tone, and never break character.
Return ONLY the requested writing. No preamble, no meta-commentary, no quotes around it.`;

function buildAssistPrompt(
  action: z.infer<typeof AiAssistSchema>["action"],
  text: string,
  instruction: string,
  book: { title: string; genre: string | null; description: string | null }
): string {
  const ctx = `Book: "${book.title}"${book.genre ? ` (${book.genre})` : ""}${
    book.description ? `\nPremise: ${book.description}` : ""
  }${instruction ? `\nAuthor instruction: ${instruction}` : ""}`;
  switch (action) {
    case "continue":
      return `${ctx}\n\nContinue writing from where this leaves off. Write 300-500 words that flow naturally from the last paragraph:\n\n${text.slice(-4000)}`;
    case "rewrite":
      return `${ctx}\n\nRewrite the following passage — same meaning and events, but stronger prose, better rhythm, more vivid:\n\n${text.slice(0, 8000)}`;
    case "expand":
      return `${ctx}\n\nExpand the following into a fuller scene — add sensory detail, interiority, and tension. 400-600 words:\n\n${text.slice(0, 6000)}`;
    case "outline":
      return `${ctx}\n\nWrite a chapter-by-chapter outline for this book. For each chapter give a title and 2-3 sentences on what happens. Aim for 10-15 chapters. Format as a numbered list.`;
    case "title-ideas":
      return `${ctx}\n\nSuggest 10 compelling book titles for this book. One per line, numbered. Make them marketable for the genre.`;
    case "blurb":
      return `${ctx}\n\nWrite a compelling back-cover blurb (150-200 words) that sells this book without spoiling the ending.`;
  }
}

router.post("/api/books/ai/assist", requireAuth, async (req, res) => {
  const parsed = AiAssistSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { bookId, action, text, instruction } = parsed.data;
  try {
    const book = await getOwnedBook(bookId, req.userId!);
    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    /* Charge 1 credit (100 Visual Bucs) per AI assist. */
    try {
      await deductCredits(req.userId!, 100);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Insufficient credits";
      res.status(402).json({ error: message });
      return;
    }
    const prompt = buildAssistPrompt(action, text, instruction, {
      title: book.title,
      genre: book.genre,
      description: book.description,
    });
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: ASSIST_SYSTEM },
        { role: "user", content: prompt },
      ],
      max_tokens: 2500,
      temperature: 0.8,
    });
    const result = completion.choices[0]?.message?.content?.trim() ?? "";
    res.json({ ok: true, action, result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "AI assist failed" });
  }
});

/* ── Export helpers ── */

async function getBookExportData(bookId: string, userId: string): Promise<BookExportData | null> {
  const book = await getOwnedBook(bookId, userId);
  if (!book) return null;
  const chapters = await db
    .select()
    .from(bookChaptersTable)
    .where(and(eq(bookChaptersTable.book_id, bookId), eq(bookChaptersTable.user_id, userId)))
    .orderBy(asc(bookChaptersTable.position));
  return {
    title: book.title,
    subtitle: book.subtitle,
    author_name: book.author_name,
    genre: book.genre,
    description: book.description,
    cover_url: book.cover_url,
    chapters: chapters.map((c) => ({ title: c.title, content: c.content, position: c.position })),
  };
}

/* ── EPUB export ── */

router.get("/api/books/:id/export/epub", requireAuth, async (req, res) => {
  try {
    const bookId = param(req, "id");
    const data = await getBookExportData(bookId, req.userId!);
    if (!data) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    if (data.chapters.length === 0) {
      res.status(400).json({ error: "Add at least one chapter before exporting." });
      return;
    }
    const epub = await generateEpub(data);
    res.setHeader("Content-Type", "application/epub+zip");
    res.setHeader("Content-Disposition", `attachment; filename="${bookFilename(data.title, "epub")}"`);
    res.setHeader("Content-Length", String(epub.length));
    res.send(epub);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "EPUB export failed" });
  }
});

/* ── PDF export (print-ready interior) ── */

router.get("/api/books/:id/export/pdf", requireAuth, async (req, res) => {
  try {
    const bookId = param(req, "id");
    const data = await getBookExportData(bookId, req.userId!);
    if (!data) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    if (data.chapters.length === 0) {
      res.status(400).json({ error: "Add at least one chapter before exporting." });
      return;
    }
    const { pdf } = await generatePdf(data);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${bookFilename(data.title, "pdf")}"`);
    res.setHeader("Content-Length", String(pdf.length));
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "PDF export failed" });
  }
});

/* ── Cover generation ── */

const CoverGenerateSchema = z.object({
  style: z.string().trim().max(200).optional().default(""),
});

router.post("/api/books/:id/cover/generate", requireAuth, async (req, res) => {
  const parsed = CoverGenerateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const bookId = param(req, "id");
    const book = await getOwnedBook(bookId, req.userId!);
    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    /* Charge 2 credits (200 Visual Bucs) for cover generation. */
    try {
      await deductCredits(req.userId!, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Insufficient credits";
      res.status(402).json({ error: message });
      return;
    }

    const styleHint = parsed.data.style ? ` in ${parsed.data.style} style` : "";
    const prompt = `Professional book cover art for "${book.title}"${book.subtitle ? `: ${book.subtitle}` : ""} by ${book.author_name || "Unknown Author"}. Genre: ${book.genre || "general fiction"}. ${book.description ? `About the book: ${book.description.slice(0, 500)}. ` : ""}Striking, marketable cover design${styleHint}. No text on the cover — pure artwork, the title will be added separately. Vertical 2:3 book cover composition.`;

    const imageResp = await getOpenAI().images.generate({
      model: IMAGE_MODEL,
      prompt: prompt.slice(0, 4000),
      size: "1024x1536",
      quality: "high",
      n: 1,
    });
    const b64 = imageResp.data?.[0]?.b64_json;
    if (!b64) {
      res.status(500).json({ error: "Cover generation returned no image." });
      return;
    }

    /* Upload to R2 under the book's namespace. */
    const key = `book-covers/${req.userId}/${bookId}/${Date.now()}.png`;
    const coverUrl = await r2Upload(key, Buffer.from(b64, "base64"), "image/png");
    const publicUrl = r2PublicUrl(key);

    await db
      .update(booksTable)
      .set({ cover_url: publicUrl || coverUrl, updated_at: new Date() })
      .where(and(eq(booksTable.id, bookId), eq(booksTable.user_id, req.userId!)));

    res.json({ ok: true, cover_url: publicUrl || coverUrl });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Cover generation failed" });
  }
});

/* ── Print on demand (Lulu) ── */

const QuoteSchema = z.object({
  countryCode: z.string().trim().length(2).default("US"),
  stateCode: z.string().trim().max(10).optional(),
  postcode: z.string().trim().max(20).optional(),
  quantity: z.number().int().min(1).max(100).default(1),
  color: z.enum(["bw", "color"]).default("bw"),
});

const ShippingAddressSchema = z.object({
  name: z.string().trim().min(1).max(200),
  street1: z.string().trim().min(1).max(200),
  street2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  state_code: z.string().trim().max(10).optional(),
  country_code: z.string().trim().length(2),
  postcode: z.string().trim().min(1).max(20),
  phone_number: z.string().trim().min(1).max(30),
});

const OrderSchema = z.object({
  shippingAddress: ShippingAddressSchema,
  shippingLevel: z.enum(["MAIL", "PRIORITY_MAIL", "GROUND", "EXPEDITED", "EXPRESS"]).default("MAIL"),
  quantity: z.number().int().min(1).max(100).default(1),
  color: z.enum(["bw", "color"]).default("bw"),
  contactEmail: z.string().trim().email(),
});

/* Build the print-ready PDFs and upload to R2. Returns URLs + page count. */
async function buildPrintFiles(
  bookId: string,
  userId: string,
  data: BookExportData,
  podPackageId: string
): Promise<{ interiorUrl: string; coverUrl: string; pageCount: number; spineWidthInches: number }> {
  const { pdf: interiorPdf, pageCount } = await generatePdf(data);
  /* Lulu needs a minimum page count for perfect binding — pad if needed. */
  const effectivePages = Math.max(32, pageCount);

  const dims = await getCoverDimensions(podPackageId, effectivePages);
  const spineWidthInches =
    typeof dims.spineWidth === "number" ? dims.spineWidth : typeof (dims as any)["spine_width"] === "number" ? (dims as any)["spine_width"] : 0.5;

  /* Fetch cover art if the book has one. */
  let coverArt: Buffer | null = null;
  if (data.cover_url) {
    try {
      const artRes = await fetch(data.cover_url);
      if (artRes.ok) coverArt = Buffer.from(await artRes.arrayBuffer());
    } catch {
      coverArt = null;
    }
  }

  const coverPdf = await generateCoverPdf({
    title: data.title,
    subtitle: data.subtitle,
    author_name: data.author_name,
    description: data.description,
    spineWidthInches,
    coverArt,
  });

  const ts = Date.now();
  const interiorKey = `book-print/${userId}/${bookId}/${ts}-interior.pdf`;
  const coverKey = `book-print/${userId}/${bookId}/${ts}-cover.pdf`;
  await r2Upload(interiorKey, interiorPdf, "application/pdf");
  await r2Upload(coverKey, coverPdf, "application/pdf");

  return {
    interiorUrl: r2PublicUrl(interiorKey),
    coverUrl: r2PublicUrl(coverKey),
    pageCount: effectivePages,
    spineWidthInches,
  };
}

/* POST /api/books/:id/print/quote — print cost + shipping estimate. */
router.post("/api/books/:id/print/quote", requireAuth, async (req, res) => {
  const parsed = QuoteSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  if (!isLuluConfigured()) {
    res.status(501).json({ error: "Print-on-demand is not configured yet." });
    return;
  }
  try {
    const bookId = param(req, "id");
    const data = await getBookExportData(bookId, req.userId!);
    if (!data || data.chapters.length === 0) {
      res.status(400).json({ error: "Add at least one chapter before printing." });
      return;
    }
    const podPackageId = parsed.data.color === "color" ? LULU_SKU_6X9_COLOR_PAPERBACK : LULU_SKU_6X9_BW_PAPERBACK;

    /* Page count from the real interior PDF. */
    const { pageCount } = await generatePdf(data);
    const effectivePages = Math.max(32, pageCount);

    const [quote, shippingOptions, dims] = await Promise.all([
      getPrintQuote([{ pod_package_id: podPackageId, page_count: effectivePages, quantity: parsed.data.quantity }]),
      getShippingOptions({
        countryCode: parsed.data.countryCode,
        stateCode: parsed.data.stateCode,
        postcode: parsed.data.postcode,
      }),
      getCoverDimensions(podPackageId, effectivePages),
    ]);

    /* Normalize the quote into something the frontend can display. */
    const lineItem = quote?.line_items?.[0] ?? quote?.[0] ?? {};
    const printCostUsd = Number(lineItem.total_cost_excl_tax ?? lineItem.cost_excl_tax ?? 0);

    res.json({
      ok: true,
      podPackageId,
      pageCount: effectivePages,
      quantity: parsed.data.quantity,
      printCostUsd,
      currency: lineItem.currency ?? "USD",
      shippingOptions: (shippingOptions as any[]).map((s: any) => ({
        id: s.id ?? s.level ?? s.shipping_level,
        label: s.label ?? s.description ?? s.id,
        costUsd: Number(s.cost_excl_tax ?? s.cost ?? 0),
        currency: s.currency ?? "USD",
        deliveryEstimate: s.delivery_time ?? s.estimated_delivery ?? null,
      })),
      coverDimensions: dims,
      /* Visual Bucs price (print cost × markup). Shipping added at order time. */
      priceVb: Math.ceil(printCostUsd * 100 * USD_CENTS_TO_VB * LULU_MARKUP),
      markup: LULU_MARKUP,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Quote failed" });
  }
});

/* POST /api/books/:id/print/order — charge VB, submit the print job to Lulu. */
router.post("/api/books/:id/print/order", requireAuth, async (req, res) => {
  const parsed = OrderSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request — check the shipping address." });
    return;
  }
  if (!isLuluConfigured()) {
    res.status(501).json({ error: "Print-on-demand is not configured yet." });
    return;
  }
  try {
    const bookId = param(req, "id");
    const data = await getBookExportData(bookId, req.userId!);
    if (!data || data.chapters.length === 0) {
      res.status(400).json({ error: "Add at least one chapter before printing." });
      return;
    }
    const podPackageId = parsed.data.color === "color" ? LULU_SKU_6X9_COLOR_PAPERBACK : LULU_SKU_6X9_BW_PAPERBACK;
    const { quantity, shippingLevel, contactEmail } = parsed.data;
    const shippingAddress = parsed.data.shippingAddress as ShippingAddressInput;

    /* Build + upload the print files. */
    const files = await buildPrintFiles(bookId, req.userId!, data, podPackageId);

    /* Validate with Lulu before charging. */
    try {
      await validateInterior(files.interiorUrl);
      await validateCover(files.coverUrl, files.pageCount);
    } catch (vErr) {
      res.status(400).json({
        error: `Print file validation failed: ${vErr instanceof Error ? vErr.message : "unknown"}`,
      });
      return;
    }

    /* Fresh quote for the final charge. */
    const quote = await getPrintQuote([
      { pod_package_id: podPackageId, page_count: files.pageCount, quantity },
    ]);
    const lineItem = quote?.line_items?.[0] ?? quote?.[0] ?? {};
    const printCostUsd = Number(lineItem.total_cost_excl_tax ?? lineItem.cost_excl_tax ?? 0);

    const shippingOptions = await getShippingOptions({
      countryCode: shippingAddress.country_code,
      stateCode: shippingAddress.state_code,
      postcode: shippingAddress.postcode,
    });
    const chosenShipping = (shippingOptions as any[]).find(
      (s: any) => (s.id ?? s.level ?? s.shipping_level) === shippingLevel
    );
    const shippingUsd = chosenShipping ? Number(chosenShipping.cost_excl_tax ?? chosenShipping.cost ?? 0) : 0;

    const totalUsd = printCostUsd + shippingUsd;
    const priceVb = Math.ceil(totalUsd * 100 * USD_CENTS_TO_VB * LULU_MARKUP);

    /* Charge Visual Bucs. */
    try {
      await deductCredits(req.userId!, priceVb);
    } catch (err) {
      res.status(402).json({ error: err instanceof Error ? err.message : "Insufficient Visual Bucs" });
      return;
    }

    /* Submit to Lulu. */
    const externalId = `bdv-book-${bookId}-${Date.now()}`;
    let luluJob: any;
    try {
      luluJob = await createPrintOrder({
        contactEmail,
        externalId,
        title: data.title,
        quantity,
        podPackageId,
        coverUrl: files.coverUrl,
        interiorUrl: files.interiorUrl,
        shippingAddress,
        shippingLevel,
      });
    } catch (orderErr) {
      /* Lulu rejected it — refund the VB. */
      const { refundCredits } = await import("../lib/credits.js").catch(() => ({ refundCredits: null as any }));
      if (refundCredits) {
        try { await refundCredits(req.userId!, priceVb); } catch { /* best effort */ }
      }
      res.status(502).json({
        error: `Lulu rejected the print order: ${orderErr instanceof Error ? orderErr.message : "unknown"}`,
      });
      return;
    }

    /* Record the order. */
    const [order] = await db
      .insert(bookPrintOrdersTable)
      .values({
        book_id: bookId,
        user_id: req.userId!,
        lulu_print_job_id: String(luluJob.id ?? luluJob.print_job_id ?? ""),
        external_id: externalId,
        status: "submitted",
        pod_package_id: podPackageId,
        quantity,
        page_count: files.pageCount,
        quote: { printCostUsd, shippingUsd, totalUsd, priceVb, markup: LULU_MARKUP },
        shipping_address: shippingAddress as unknown as Record<string, unknown>,
        shipping_level: shippingLevel,
        contact_email: contactEmail,
        interior_pdf_url: files.interiorUrl,
        cover_pdf_url: files.coverUrl,
        amount_cents: Math.round(totalUsd * 100),
        payment_method: "visual_bucs",
      })
      .returning();

    res.json({
      ok: true,
      orderId: order.id,
      luluPrintJobId: order.lulu_print_job_id,
      status: order.status,
      priceVb,
      totalUsd,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Print order failed" });
  }
});

/* GET /api/books/print/orders — list the user's print orders. */
router.get("/api/books/print/orders", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(bookPrintOrdersTable)
      .where(eq(bookPrintOrdersTable.user_id, req.userId!))
      .orderBy(desc(bookPrintOrdersTable.created_at));
    res.json({
      orders: rows.map((o) => ({
        id: o.id,
        bookId: o.book_id,
        luluPrintJobId: o.lulu_print_job_id,
        status: o.status,
        quantity: o.quantity,
        pageCount: o.page_count,
        amountCents: o.amount_cents,
        tracking: o.tracking ?? {},
        error: o.error,
        createdAt: o.created_at,
        updatedAt: o.updated_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to list print orders" });
  }
});

/* GET /api/books/print/orders/:orderId/status — refresh from Lulu. */
router.get("/api/books/print/orders/:orderId/status", requireAuth, async (req, res) => {
  try {
    const orderId = param(req, "orderId");
    const rows = await db
      .select()
      .from(bookPrintOrdersTable)
      .where(and(eq(bookPrintOrdersTable.id, orderId), eq(bookPrintOrdersTable.user_id, req.userId!)))
      .limit(1);
    const order = rows[0];
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (!order.lulu_print_job_id || !isLuluConfigured()) {
      res.json({ ok: true, status: order.status, tracking: order.tracking ?? {} });
      return;
    }
    const status = await getOrderStatus(order.lulu_print_job_id);
    const jobStatus = status?.status ?? status?.name ?? order.status;
    const tracking = {
      status: jobStatus,
      trackingId: status?.tracking_id ?? status?.trackingId ?? null,
      trackingUrl: status?.tracking_url ?? status?.trackingUrl ?? null,
      estimatedDelivery: status?.estimated_delivery ?? null,
      raw: status,
    };
    await db
      .update(bookPrintOrdersTable)
      .set({ status: String(jobStatus).toLowerCase(), tracking: tracking as unknown as Record<string, unknown>, updated_at: new Date() })
      .where(eq(bookPrintOrdersTable.id, orderId));
    res.json({ ok: true, status: jobStatus, tracking });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Status check failed" });
  }
});

/* POST /api/books/print/orders/:orderId/cancel — cancel before production. */
router.post("/api/books/print/orders/:orderId/cancel", requireAuth, async (req, res) => {
  try {
    const orderId = param(req, "orderId");
    const rows = await db
      .select()
      .from(bookPrintOrdersTable)
      .where(and(eq(bookPrintOrdersTable.id, orderId), eq(bookPrintOrdersTable.user_id, req.userId!)))
      .limit(1);
    const order = rows[0];
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (!order.lulu_print_job_id || !isLuluConfigured()) {
      res.status(400).json({ error: "Nothing to cancel." });
      return;
    }
    const { cancelPrintOrder } = await import("../lib/lulu-print");
    await cancelPrintOrder(order.lulu_print_job_id);
    await db
      .update(bookPrintOrdersTable)
      .set({ status: "canceled", updated_at: new Date() })
      .where(eq(bookPrintOrdersTable.id, orderId));
    res.json({ ok: true, status: "canceled" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Cancel failed" });
  }
});

/* POST /api/books/print/webhook — Lulu status webhooks (no auth; Lulu calls this). */
router.post("/api/books/print/webhook", async (req, res) => {
  try {
    const body = req.body as any;
    /* Lulu posts { print_job_id, status, ... } — shapes vary, be lenient. */
    const luluJobId = String(body?.print_job_id ?? body?.printJobId ?? body?.id ?? "");
    const status = String(body?.status ?? body?.name ?? "").toLowerCase();
    if (!luluJobId) {
      res.status(400).json({ error: "Missing print_job_id" });
      return;
    }
    const rows = await db
      .select()
      .from(bookPrintOrdersTable)
      .where(eq(bookPrintOrdersTable.lulu_print_job_id, luluJobId))
      .limit(1);
    if (rows[0]) {
      await db
        .update(bookPrintOrdersTable)
        .set({
          status: status || rows[0].status,
          tracking: { ...(rows[0].tracking as object ?? {}), lastWebhook: body },
          updated_at: new Date(),
        })
        .where(eq(bookPrintOrdersTable.id, rows[0].id));
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Webhook failed" });
  }
});

export default router;
