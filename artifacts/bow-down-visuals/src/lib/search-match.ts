/* ─── Plain-words search matching (search-truth, Stack1000 lane N5) ────
   Both page indexes — the sidebar's "Search pages" filter and the
   /features registry search — used to match the WHOLE typed string as
   one substring of a label or tagline. That works for one exact word
   ("live", "thumbnail") and fails the way newcomers actually type:
   "get paid", "book a show", "sell beats", "translate my video" are
   substrings of nothing, so the real feature never surfaced.

   The matcher now splits the query into words and requires every
   meaningful word to appear SOMEWHERE in the entry's haystack (its
   real name + its alias/keyword words + its route). Word order is
   free and filler words ("a", "my", "the", "how do I"…) don't gate
   the match. Single-word queries behave exactly as before — a word
   still matches as a substring, so the Oct-18 findability wins
   ("live" → Go Live, in every locale via the English alias terms)
   are untouched. */

const STOPWORDS = new Set([
  "a", "an", "the", "my", "i", "me", "you", "your",
  "to", "for", "of", "in", "on", "at",
  "how", "do", "does", "can", "is", "it",
]);

/* Letters Unicode decomposition cannot fold to ASCII — mapped by
   hand so "beyonce" finds Beyoncé and "lukasz" finds Łukasz. This is
   the same fold the server matcher applies (api-server
   lib/search-match): the two implementations are twins, one rule. */
const ATOMIC_FOLD: Record<string, string> = {
  "ı": "i", "ø": "o", "ŋ": "n", "đ": "d",
  "ħ": "h", "ŀ": "l", "ł": "l", "ŧ": "t",
};

/**
 * Search-fold a string: strip accents/diacritics and lowercase, so
 * matching never depends on how a name was typed. (Extended by
 * Stack1100 lane Y5 — the in-page searches adopt the same matcher.)
 */
export function foldSearchText(s: string): string {
  const stripped = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return stripped.replace(/[ıøŋđħŀłŧ]/g, (c) => ATOMIC_FOLD[c] ?? c);
}

/** The meaningful words of a query, folded, in order. */
export function queryTokens(query: string): string[] {
  return foldSearchText(query)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
}

/**
 * True when every meaningful word of `query` appears in `haystack`
 * (accent-folded substring per word). A query with no meaningful
 * words falls back to the old whole-string substring match, folded.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const hay = foldSearchText(haystack);
  const tokens = queryTokens(query);
  if (tokens.length === 0) return hay.includes(foldSearchText(query.trim()));
  return tokens.every((tok) => hay.includes(tok));
}
