import { sql, type SQL } from "drizzle-orm";

/* ─── In-page search matching (search-truth, Stack1100 lane Y5) ───────
   The server twin of the FE lib/search-match.ts (Stack1000 lane N5),
   with the same token rule, extended with accent folding. Before this
   lib, every in-page search on the server matched the WHOLE typed
   string as one substring — one ILIKE '%king shark%' or one
   .includes("king shark") — so a multi-word query could only match a
   field that happened to contain the exact phrase in the exact order.
   "dark trap" found nothing on a beat titled "Trap Nights" tagged
   dark; "get paid" found nothing anywhere. N5 fixed the two page
   indexes (sidebar + /features); this lib is the shared matcher for
   the searches INSIDE pages: discovery /search, beats, storefronts,
   groups, the member pickers, the fan graph, the tutorial catalog.

   THE RULE (identical on both twins): split the query into meaningful
   words (filler words dropped); a row matches when EVERY word appears
   SOMEWHERE in its haystack — any field, any order. Text is folded
   first: lowercased, accents stripped (Beyoncé == beyonce, José ==
   jose). Single-word queries behave exactly like the old substring
   match, so nothing that used to be found is lost.

   SQL surfaces use searchTextCondition(): per token, an ILIKE over
   translate(lower(field)) — the fold map below covers the precomposed
   Latin letters; foldSearchText() (NFD) covers the same set in JS, so
   a query folded in JS and a column folded in SQL meet in the middle.
   LIKE wildcards in the query are escaped — a typed "%" is a literal
   percent, never a match-everything. NOTE for pg-mem suites: pg-mem
   does not implement translate(); a suite that drives a search path
   over pg-mem must register it (the registerFunction pattern the
   catalog-import / affiliates suites already use). */

/** Accent-fold map for SQL translate(): precomposed Latin letters →
 *  their base letter, positionally paired (84 chars each, no dupes —
 *  pinned by search-match.test.ts). Lowercase forms only; callers
 *  lower() first. */
export const SEARCH_FOLD_FROM =
  "àáâãäåāăąèéêëēĕėęěìíîïĩīĭįıòóôõöøōŏőùúûüũūŭůűųýÿŷñńňŋçćĉċčďđĝğġĥħĵķĺļľŀłŕřśŝşšţťŧźżž";
export const SEARCH_FOLD_TO =
  "aaaaaaaaaeeeeeeeeeiiiiiiiiiooooooooouuuuuuuuuuyyynnnncccccddggghhjklllllrrsssstttzzz";

/* Letters that have no NFD decomposition (they are atomic, not a base
   letter + combining mark), so the JS fold maps them explicitly —
   the same pairs the SQL translate map carries. */
const ATOMIC_FOLD: Record<string, string> = {
  "ı": "i", "ø": "o", "ŋ": "n", "đ": "d",
  "ħ": "h", "ŀ": "l", "ł": "l", "ŧ": "t",
};

/** Fold text for search: lowercase + accents stripped. */
export function foldSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u0131\u00f8\u014b\u0111\u0127\u0140\u0142\u0167]/g, (c) => ATOMIC_FOLD[c] ?? c);
}

/* The same filler words the FE matcher drops (N5's list, verbatim). */
const STOPWORDS = new Set([
  "a", "an", "the", "my", "i", "me", "you", "your",
  "to", "for", "of", "in", "on", "at",
  "how", "do", "does", "can", "is", "it",
]);

/** The meaningful words of a query, folded, in order. */
export function queryTokens(query: string): string[] {
  return foldSearchText(query)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
}

/**
 * JS matcher: true when every meaningful word of `query` appears in
 * `haystack` (folded, substring per word). A query with no meaningful
 * words falls back to the old whole-string substring match.
 */
export function matchesSearchText(haystack: string, query: string): boolean {
  const hay = foldSearchText(haystack);
  const tokens = queryTokens(query);
  if (tokens.length === 0) return hay.includes(foldSearchText(query).trim());
  return tokens.every((tok) => hay.includes(tok));
}

/** Escape LIKE wildcards in one token: a typed %, _ or \ is literal. */
export function escapeLikeToken(token: string): string {
  return token.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The %…% ILIKE pattern for one already-folded token. */
export function likeTokenPattern(token: string): string {
  return `%${escapeLikeToken(token)}%`;
}

/** One field expression folded for SQL search. The fold maps are
 *  module constants made only of letters (pinned by the test suite),
 *  so they are inlined as SQL literals, never bound parameters. */
export function foldedField(field: SQL): SQL {
  return sql`translate(lower(${field}), ${sql.raw(`'${SEARCH_FOLD_FROM}'`)}, ${sql.raw(`'${SEARCH_FOLD_TO}'`)})`;
}

/**
 * The SQL form of the matcher: for every query token, an OR of folded
 * ILIKEs across `fields`; the token groups are ANDed. Returns
 * undefined when the query carries no searchable text (empty /
 * whitespace) — callers treat that as "no text filter". A query whose
 * words are all filler falls back to one whole-string condition,
 * mirroring the JS matcher.
 */
export function searchTextCondition(fields: SQL[], query: string): SQL | undefined {
  const folded = foldSearchText(query).trim();
  if (!folded) return undefined;
  const tokens = queryTokens(query);
  const effective = tokens.length > 0 ? tokens : [folded];
  const perToken = effective.map((tok) => {
    const pattern = likeTokenPattern(tok);
    const ors = fields.map((f) => sql`${foldedField(f)} ILIKE ${pattern}`);
    return sql`(${sql.join(ors, sql` OR `)})`;
  });
  return sql`(${sql.join(perToken, sql` AND `)})`;
}
