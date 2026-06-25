/**
 * Smart lyric → caption-line splitter.
 *
 * Handles the most common case: Whisper or pasted lyrics arrive as one
 * long paragraph with no newlines. Produces short, readable caption lines.
 */

export type CaptionSplitStyle = "short" | "medium" | "long";

const MAX_WORDS: Record<CaptionSplitStyle, number> = {
  short: 6,
  medium: 8,
  long: 12,
};

const SECTION_LABEL_RE =
  /^\s*[\[\(]?\s*(verse|chorus|hook|bridge|outro|intro|pre-chorus|post-chorus|refrain|breakdown|drop|skit|outro|interlude)[\s\d]*[\]\)]?\s*$/i;

/**
 * Strip section labels like [Verse 1], (Hook), ## Bridge, "CHORUS:" etc.
 * from a line. Returns null when the entire line is a label.
 */
function stripSectionLabel(line: string): string | null {
  if (SECTION_LABEL_RE.test(line)) return null;
  return line
    .replace(/\[[\w\s\d]*?\]/g, " ")
    .replace(/^\([\w\s\d]*?\)\s*/g, " ")
    .replace(/^#+\s*/g, "")
    .trim();
}

/**
 * Split a single "phrase" (no punctuation inside) into ≤ maxWords chunks.
 */
function chunkByWordCount(phrase: string, maxWords: number): string[] {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(" "));
  }
  return chunks;
}

/**
 * Split `text` into individual lyric phrases, respecting punctuation, then
 * enforcing `maxWords`. Returns an array of clean, short strings ready to
 * become caption lines.
 */
export function smartSplitLyrics(text: string, style: CaptionSplitStyle = "short"): string[] {
  const maxWords = MAX_WORDS[style];

  /* ── 1. Split on newlines; strip section labels ── */
  const byLine = text.split(/\r?\n/);
  const lines: string[] = [];
  for (const raw of byLine) {
    const line = stripSectionLabel(raw.trim());
    if (line && line.length > 0) lines.push(line);
  }

  /* If the whole lyric block is one line (common with Whisper output),
     work with that single line directly. */
  const source = lines.length > 0 ? lines : [text.trim()];

  const result: string[] = [];

  for (const line of source) {
    if (!line) continue;

    /* ── 2. Split on sentence-ending punctuation (.!?) + commas ── */
    /* We split *after* the punctuation character so it stays with its word. */
    const byPunct = line.split(/(?<=[.!?,])\s+/).map((p) => p.trim()).filter(Boolean);

    for (const phrase of byPunct) {
      const words = phrase.split(/\s+/).filter(Boolean);

      if (words.length <= maxWords) {
        /* Fits in one caption as-is */
        if (words.length > 0) result.push(words.join(" "));
      } else {
        /* ── 3. Still too long — split at common lyric "breath" boundaries ── */
        /* Patterns that signal a new phrase start in rap/pop/R&B:
           - start-of-phrase pronouns & interjections after a word boundary
           - common conjunctions/adverbs that start a new thought */
        const BREATH_RE =
          /\b(I|You|We|They|He|She|Yeah|Yea|Aye|Ay|Oh|Ooh|Ah|And I|But I|So I|When I|Cause|Because|Now|Like|With|From|On|In|If|Baby|Girl|Boy|My|Your|This|That|These|Those|All|Every|Never|Always|Still|Back|Down|Up)\b/i;

        /* We'll walk word by word, cutting when we hit a breath word after
           ≥ 4 words OR when we've accumulated maxWords. */
        const chunks: string[] = [];
        let current: string[] = [];

        for (let i = 0; i < words.length; i++) {
          const word = words[i]!;

          /* Cut before a breath word (but only if we have enough words already) */
          if (
            i > 0 &&
            current.length >= 3 &&
            BREATH_RE.test(word) &&
            current.length + (words.length - i) > maxWords
          ) {
            chunks.push(current.join(" "));
            current = [];
          }

          current.push(word);

          /* Hard cut at maxWords */
          if (current.length === maxWords) {
            chunks.push(current.join(" "));
            current = [];
          }
        }
        if (current.length > 0) chunks.push(current.join(" "));

        for (const chunk of chunks) {
          if (chunk.trim()) result.push(chunk.trim());
        }
      }
    }
  }

  return result.filter((s) => s.length > 0);
}
