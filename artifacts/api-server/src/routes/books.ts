import { Router, json } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { db, booksTable, bookChaptersTable } from "@workspace/db";
import { eq, asc, desc, and } from "drizzle-orm";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { deductCredits } from "../lib/credits.js";

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

export default router;
