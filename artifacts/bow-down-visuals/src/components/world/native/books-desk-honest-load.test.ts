/**
 * BooksDesk (the World books desk) — honest load states
 * (Stack-400 C-28 components residual, deep-pins tranche 2).
 *
 * - THE BOOKSHELF: a non-ok read throws, and a payload that
 *   fails to normalize throws too ("books shape") — a malformed
 *   answer is a failed load (loadFailed), never an empty shelf.
 * - THE BOOK DETAIL (openBook): the same discipline — non-ok or
 *   unparseable lands on detailFailed; the detail and its
 *   chapter seed record only from a proven payload, and the
 *   previous detail is cleared before the attempt so a failed
 *   open can never show the last book as this one.
 * - PRINT ORDERS ride along quietly BY DESIGN (written on the
 *   code): they record only from an ok, parseable response, and
 *   their failure leaves the strip absent — it never takes the
 *   bookshelf down and never paints an empty-orders state.
 *
 * NO FIX in this lane — every family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./BooksDesk.tsx");

describe("the bookshelf: non-ok and unparseable are both failures", () => {
  it("the read throws on non-ok and on a shape failure before recording", () => {
    expect(desk).toContain("if (!res.ok) throw new Error(`books ${res.status}`);");
    expect(desk).toContain('if (!parsed) throw new Error("books shape");');
    expect(desk).toContain("if (!cancelled) setBooks(parsed);");
    expect(desk.indexOf('throw new Error("books shape")')).toBeLessThan(desk.indexOf("setBooks(parsed);"));
    expect(desk).toContain("if (!cancelled) setLoadFailed(true);");
  });
});

describe("the book detail: a failed open shows no book, not the last book", () => {
  it("openBook clears the detail first, then records only from a proven payload", () => {
    const open = desk.slice(desk.indexOf("async function openBook(id: string)"), desk.indexOf("async function create()"));
    expect(open).toContain("setDetail(null);");
    expect(open).toContain("setDetailFailed(false);");
    expect(open).toContain("if (!res.ok) throw new Error(`book ${res.status}`);");
    expect(open).toContain('if (!parsed) throw new Error("book shape");');
    expect(open).toContain("setDetail(parsed);");
    expect(open).toContain("setDetailFailed(true);");
    expect(open.indexOf("setDetail(null);")).toBeLessThan(open.indexOf("setDetail(parsed);"));
  });
});

describe("print orders: the documented quiet rider", () => {
  it("orders record only from an ok parseable response; failure leaves the strip absent", () => {
    expect(desk).toContain("if (!res.ok) return;");
    expect(desk).toContain("if (!cancelled && parsed) setOrders(parsed);");
    expect(desk).toContain("their failure never takes the\n     bookshelf down (the section just stays hidden)");
  });
});
