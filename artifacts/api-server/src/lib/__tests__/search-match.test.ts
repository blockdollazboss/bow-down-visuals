/**
 * The shared in-page search matcher (lib/search-match) — Stack1100 Y5.
 *
 * Pins the rule every in-page search now shares with the FE twin
 * (Stack1000 N5): every meaningful word of the query must appear
 * somewhere in the haystack, folded (case + accents). Before this lib
 * each surface matched the whole typed string as one substring, so
 * multi-word queries could only match an exact contiguous phrase.
 *
 * The SQL half is pinned by flattening the built condition with the
 * real PgDialect: per-token AND groups, folded ILIKE patterns, LIKE
 * wildcards escaped — and NEVER one %whole phrase% parameter.
 */
import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  SEARCH_FOLD_FROM,
  SEARCH_FOLD_TO,
  foldSearchText,
  queryTokens,
  matchesSearchText,
  effectiveSearchTokens,
  escapeLikeToken,
  searchTextCondition,
} from "../search-match";

const dialect = new PgDialect();
function flatten(cond: unknown): { text: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { text: q.sql, params: q.params as unknown[] };
}

describe("fold map integrity", () => {
  it("FROM and TO are equal length with no duplicate FROM chars", () => {
    expect(SEARCH_FOLD_FROM.length).toBe(SEARCH_FOLD_TO.length);
    expect(new Set(SEARCH_FOLD_FROM).size).toBe(SEARCH_FOLD_FROM.length);
  });

  it("the JS fold and the SQL map agree on every mapped char", () => {
    for (let i = 0; i < SEARCH_FOLD_FROM.length; i++) {
      expect(foldSearchText(SEARCH_FOLD_FROM[i]!)).toBe(SEARCH_FOLD_TO[i]);
    }
  });
});

describe("foldSearchText", () => {
  it("lowercases and strips accents, composed and decomposed", () => {
    expect(foldSearchText("Beyoncé")).toBe("beyonce");
    expect(foldSearchText("Beyonce\u0301")).toBe("beyonce"); // e + combining acute
    expect(foldSearchText("JOSÉ Ñengo")).toBe("jose nengo");
    expect(foldSearchText("Łukasz")).toBe("lukasz"); // atomic letter, post-map
  });
});

describe("queryTokens", () => {
  it("drops filler words and punctuation, keeps order", () => {
    expect(queryTokens("how do I get paid")).toEqual(["get", "paid"]);
    expect(queryTokens("dark, trap!")).toEqual(["dark", "trap"]);
    expect(queryTokens("the a an")).toEqual([]);
  });

  it("folds tokens so accented queries meet folded columns", () => {
    expect(queryTokens("Beyoncé live")).toEqual(["beyonce", "live"]);
  });
});

describe("matchesSearchText", () => {
  it("matches words split across fields and out of order", () => {
    const haystack = "Trap Nights\ndark moody\n140 BPM";
    expect(matchesSearchText(haystack, "dark trap")).toBe(true);
    expect(matchesSearchText(haystack, "trap dark")).toBe(true);
    expect(matchesSearchText(haystack, "dark house")).toBe(false);
  });

  it("single-word behaviour is the old substring match", () => {
    expect(matchesSearchText("King Shark", "king")).toBe(true);
    expect(matchesSearchText("King Shark", "queen")).toBe(false);
  });

  it("folds accents on both sides", () => {
    expect(matchesSearchText("Rosalía — La Fama", "rosalia fama")).toBe(true);
    expect(matchesSearchText("Jose Feliciano", "josé")).toBe(true);
  });

  it("an all-filler query falls back to whole-string matching", () => {
    expect(matchesSearchText("The Crown", "the")).toBe(true);
    expect(matchesSearchText("Crown", "the")).toBe(false);
  });
});

describe("effectiveSearchTokens", () => {
  it("meaningful words, the all-filler fallback, and the empty case", () => {
    expect(effectiveSearchTokens("dark trap")).toEqual(["dark", "trap"]);
    expect(effectiveSearchTokens("the")).toEqual(["the"]);
    expect(effectiveSearchTokens("")).toEqual([]);
    expect(effectiveSearchTokens("   ")).toEqual([]);
    expect(effectiveSearchTokens("Beyoncé")).toEqual(["beyonce"]);
  });
});

describe("escapeLikeToken", () => {
  it("escapes %, _ and backslash so typed wildcards stay literal", () => {
    expect(escapeLikeToken("100%")).toBe("100\\%");
    expect(escapeLikeToken("a_b")).toBe("a\\_b");
    expect(escapeLikeToken("a\\b")).toBe("a\\\\b");
  });
});

describe("searchTextCondition (SQL shape)", () => {
  const fields = [sql`title`, sql`description`];

  it("builds one AND group per token, OR across fields — never one phrase param", () => {
    const cond = searchTextCondition(fields, "dark trap");
    expect(cond).toBeDefined();
    const { text, params } = flatten(cond);
    expect(params).toEqual(["%dark%", "%dark%", "%trap%", "%trap%"]);
    expect(params).not.toContain("%dark trap%");
    expect(text).toContain(" AND ");
    expect(text).toContain(" OR ");
    expect(text).toContain("translate(lower(");
    expect(text).toContain("ilike");
  });

  it("escapes wildcards inside token patterns", () => {
    // In the token path a typed % is a separator (tokens are
    // alphanumeric), so "100%" searches the token 100 — it can never
    // become a match-everything pattern.
    const tok = flatten(searchTextCondition(fields, "100% legit"));
    expect(tok.params).toContain("%100%");
    expect(tok.params).not.toContain("%100%%");
    // The whole-string fallback CAN carry wildcards — there they are
    // escaped to literals.
    const fb = flatten(searchTextCondition(fields, "%_"));
    expect(fb.params).toEqual(["%\\%\\_%", "%\\%\\_%"]);
  });

  it("folds the query before patterning it", () => {
    const { params } = flatten(searchTextCondition(fields, "Beyoncé"));
    expect(params).toEqual(["%beyonce%", "%beyonce%"]);
  });

  it("returns undefined for empty / whitespace queries (no text filter)", () => {
    expect(searchTextCondition(fields, "")).toBeUndefined();
    expect(searchTextCondition(fields, "   ")).toBeUndefined();
  });

  it("an all-filler query becomes one whole-string condition", () => {
    const { params } = flatten(searchTextCondition(fields, "the"));
    expect(params).toEqual(["%the%", "%the%"]);
  });
});
