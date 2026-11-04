/**
 * book-starter-templates.test.ts — Thy Books starter templates
 * (STACK100 wave 2, item 14: the Books desk started every book from
 * blank while every sibling surface had starters).
 *
 * Pins:
 *  (a) registry completeness — every template carries a full outline:
 *      front matter, chapters, and back matter, in that order, every
 *      entry with a title and real guidance;
 *  (b) the shapes fit the REAL rails, read from the api-server source:
 *      genre within CreateBookSchema, chapter titles within
 *      CreateChapterSchema (which accepts the seed's position), and
 *      guidance within UpdateChapterSchema's ai_notes bound;
 *  (c) the seed is exact — applying a template creates precisely its
 *      outline, in order, positions 0..n-1, guidance verbatim;
 *  (d) the page renders the shelf from the registry (no page-local
 *      copies), pre-fills the genre, and its create flow posts the
 *      seed chapters + ai_notes on the ordinary rails with
 *      skipConfirm — structure only, FREE: the file's one and only
 *      overrideCost remains the pre-existing AI assist's;
 *  (e) the editor surfaces the seeded guidance as the chapter plan.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  BOOK_TEMPLATES,
  bookTemplateById,
  bookTemplateSeed,
} from "./book-templates";

const pageSrc = readFileSync(new URL("../pages/books.tsx", import.meta.url), "utf8");
const registrySrc = readFileSync(new URL("./book-templates.ts", import.meta.url), "utf8");
const apiSrc = readFileSync(
  new URL("../../../api-server/src/routes/books.ts", import.meta.url),
  "utf8",
);

const KINDS = ["front", "chapter", "back"] as const;

describe("registry completeness — every template carries a full outline", () => {
  it("has at least six templates with unique ids", () => {
    expect(BOOK_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    const ids = BOOK_TEMPLATES.map((tp) => tp.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every template is fully described", () => {
    for (const tp of BOOK_TEMPLATES) {
      expect(tp.id, tp.id).toMatch(/^[a-z0-9-]+$/);
      expect(tp.name.trim().length, tp.id).toBeGreaterThan(0);
      expect(tp.genre.trim().length, tp.id).toBeGreaterThan(0);
      expect(tp.blurb.trim().length, tp.id).toBeGreaterThan(0);
      expect(tp.audience.trim().length, tp.id).toBeGreaterThan(0);
      expect(bookTemplateById(tp.id)).toBe(tp);
    }
    expect(bookTemplateById("no-such-template")).toBeUndefined();
  });

  it("every outline runs front matter → chapters → back matter, each entry guided", () => {
    for (const tp of BOOK_TEMPLATES) {
      expect(tp.chapters.length, tp.id).toBeGreaterThanOrEqual(6);
      const kinds = tp.chapters.map((c) => c.kind);
      expect(kinds.filter((k) => k === "front").length, tp.id).toBeGreaterThanOrEqual(1);
      expect(kinds.filter((k) => k === "back").length, tp.id).toBeGreaterThanOrEqual(1);
      expect(kinds.filter((k) => k === "chapter").length, tp.id).toBeGreaterThanOrEqual(4);
      /* Kinds never go backwards: no front entry after a chapter, no
         chapter after a back entry. */
      const order = kinds.map((k) => KINDS.indexOf(k));
      expect([...order].sort((a, b) => a - b), tp.id).toEqual(order);
      const titles = tp.chapters.map((c) => c.title);
      expect(new Set(titles).size, tp.id).toBe(titles.length);
      for (const c of tp.chapters) {
        expect(c.title.trim().length, `${tp.id}: ${c.title}`).toBeGreaterThan(0);
        expect(c.guidance.trim().length, `${tp.id}: ${c.title}`).toBeGreaterThan(40);
      }
    }
  });
});

describe("shapes fit the real rails (read from the api-server source)", () => {
  it("the rails the seed rides exist with the bounds the registry respects", () => {
    /* CreateBookSchema: genre max 100. CreateChapterSchema: title
       max 200 and an optional position (the seed's order rides it).
       UpdateChapterSchema: ai_notes max 50,000 (the guidance rides it). */
    expect(apiSrc).toContain("genre: z.string().trim().max(100)");
    expect(apiSrc).toContain("title: z.string().trim().min(1).max(200)");
    expect(apiSrc).toContain("position: z.number().int().min(0).optional()");
    expect(apiSrc).toContain("ai_notes: z.string().max(50_000).nullable().optional()");
    for (const tp of BOOK_TEMPLATES) {
      expect(tp.genre.length, tp.id).toBeLessThanOrEqual(100);
      for (const c of tp.chapters) {
        expect(c.title.length, `${tp.id}: ${c.title}`).toBeLessThanOrEqual(200);
        expect(c.guidance.length, `${tp.id}: ${c.title}`).toBeLessThanOrEqual(50_000);
      }
    }
  });

  it("the chapter rail starts content empty — the seed never writes manuscript", () => {
    expect(apiSrc).toContain('content: ""');
  });
});

describe("the seed is exact", () => {
  it("seed = the template's outline verbatim, positions 0..n-1, genre carried", () => {
    for (const tp of BOOK_TEMPLATES) {
      const seed = bookTemplateSeed(tp);
      expect(seed.genre).toBe(tp.genre);
      expect(seed.chapters.length).toBe(tp.chapters.length);
      seed.chapters.forEach((s, i) => {
        expect(s.position).toBe(i);
        expect(s.title).toBe(tp.chapters[i].title);
        expect(s.kind).toBe(tp.chapters[i].kind);
        expect(s.aiNotes).toBe(tp.chapters[i].guidance);
      });
    }
  });

  it("the registry itself calls nothing and charges nothing", () => {
    expect(registrySrc).not.toContain("fetch(");
    expect(registrySrc).not.toContain("overrideCost");
    expect(registrySrc).not.toContain("/api/");
  });
});

describe("the books page wires the shelf and the seed", () => {
  it("renders the shelf from the registry — no page-local template copies", () => {
    expect(pageSrc).toContain('from "../lib/book-templates"');
    expect(pageSrc).toContain("BOOK_TEMPLATES.map(");
    expect(pageSrc).toContain('data-testid="book-template-shelf"');
    for (const tp of BOOK_TEMPLATES) {
      expect(pageSrc).not.toContain(tp.blurb);
    }
  });

  it("picking a template pre-fills the genre and records the pick on the book", () => {
    expect(pageSrc).toContain("setGenre(tp.genre)");
    expect(pageSrc).toContain("starter_template: selectedTemplate.id");
  });

  it("create seeds exactly the seed's chapters, in order, guidance as ai_notes", () => {
    expect(pageSrc).toContain("bookTemplateSeed(selectedTemplate)");
    expect(pageSrc).toContain("`/api/books/${book.id}/chapters`");
    expect(pageSrc).toContain("body: JSON.stringify({ title: chSeed.title, position: chSeed.position })");
    expect(pageSrc).toContain("`/api/books/${book.id}/chapters/${chapterId}`");
    expect(pageSrc).toContain("body: JSON.stringify({ ai_notes: chSeed.aiNotes })");
  });

  it("structure stays free — the only overrideCost in the file is still the AI assist's", () => {
    expect(pageSrc.match(/overrideCost/g)?.length).toBe(1);
    expect(pageSrc).toContain("overrideCost: 100");
    expect(pageSrc).toContain('"/api/books/ai/assist"');
    /* Every seeding call skips the spend confirm — nothing is charged.
       The block is bounded by the missed-count report that follows it,
       so the assist panel later in the file stays out of the slice. */
    const seedStart = pageSrc.indexOf("const seed = bookTemplateSeed(selectedTemplate);");
    const seedBlock = pageSrc.slice(seedStart, pageSrc.indexOf("if (missed > 0)", seedStart));
    expect(seedBlock).toContain("skipConfirm: true");
    expect(seedBlock).not.toContain("overrideCost");
  });

  it("the blank-book path is untouched (title/genre/description/author_name)", () => {
    expect(pageSrc).toContain("title: title.trim()");
    expect(pageSrc).toContain("genre: genre.trim()");
    expect(pageSrc).toContain("description: description.trim()");
    expect(pageSrc).toContain("author_name: authorName.trim()");
  });

  it("the editor shows the seeded guidance as the chapter plan", () => {
    expect(pageSrc).toContain('data-testid="chapter-plan"');
    expect(pageSrc).toContain("activeChapter.aiNotes");
  });
});
