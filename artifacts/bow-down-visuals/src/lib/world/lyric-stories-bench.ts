/* ─── Lyric Stories bench in-world (Stack 300 world parity,
   census Lane B item 10 / manifest item 103) ───────────────────
   The Hooks page's "lyrics" tab (LyricStoriesSection), native
   at the Hook Desk: paste song lyrics, the AI splits them
   into story-card moments and paints a 9:16 image for each
   through the site's image pipeline, on the section's rail:

     POST /api/lyric-stories/generate
       { lyrics, count (3–5), style }
       → { cards[{ lyricExcerpt, imageUrl, visualDescription }],
           partial? }

   Price: PER CARD — the credit registry's
   "/api/lyric-stories/generate" entry (200; the route's
   CREDITS_PER_CARD agrees). The confirmation total is the
   per-card price × the chosen card count, passed as the
   override exactly as the 2D section computes its own
   totalCost. A partial run (some cards failed) refunds the
   failed cards server-side — the section's copy says so and
   the bench renders that same note.

   Confirmation law: confirmedFetch shows the spend
   confirmation BEFORE the run; a decline runs nothing.

   Copy rides the lyricStories.* catalog namespace — new to
   the catalogs with this bench, its en values the section's
   own literal strings, so bench and page can never drift. */
import { getCreditCost } from "../credit-costs";

export const LYRIC_STORIES_PATH = "/api/lyric-stories/generate";
export const LYRIC_STORIES_FEATURE = "Lyric Stories";

/** POST /api/lyric-stories/generate — registry 200 PER CARD. */
export function lyricStoryCardCost(): number {
  const entry = getCreditCost(LYRIC_STORIES_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${LYRIC_STORIES_PATH}`);
  return entry.cost;
}

/** The section's card-count choices: 3, 4 or 5 cards. */
export const LYRIC_STORY_CARD_COUNTS = [3, 4, 5] as const;
export const LYRIC_STORIES_DEFAULT_COUNT = 4;
/** The section's input caps: lyrics ≤ 3000 chars, style ≤ 120. */
export const LYRIC_STORIES_LYRICS_MAX = 3000;
export const LYRIC_STORIES_STYLE_MAX = 120;

/** The section's clamp: any count lands inside 3–5, junk
 *  input lands on the default 4. */
export function clampLyricStoryCount(n: number): number {
  if (!Number.isFinite(n)) return LYRIC_STORIES_DEFAULT_COUNT;
  return Math.max(3, Math.min(5, Math.trunc(n)));
}

/** The confirmation total for a run: per-card × count. */
export function lyricStoriesTotalCost(count: number): number {
  return lyricStoryCardCost() * clampLyricStoryCount(count);
}

/** The section's post body: trimmed lyrics + style, clamped
 *  count. */
export function buildLyricStoriesPayload(input: {
  lyrics: string;
  count: number;
  style: string;
}): Record<string, unknown> {
  return {
    lyrics: input.lyrics.trim(),
    count: clampLyricStoryCount(input.count),
    style: input.style.trim(),
  };
}

/** The run stays shut (and uncharged) with no lyrics — the
 *  section's own gate. */
export function lyricStoriesInputReady(lyrics: string): boolean {
  return lyrics.trim().length > 0;
}

export interface LyricStoryCard {
  lyricExcerpt: string;
  imageUrl: string;
  visualDescription: string;
}

export interface LyricStoriesResult {
  cards: LyricStoryCard[];
  partial: boolean;
}

/** The answer guard: every card whole (excerpt + image URL as
 *  strings) or the run reads as failed. Cards with no image
 *  are dropped by the guard — a card that didn't paint is a
 *  refunded card, never a blank frame on the bench. */
export function lyricStoriesResultOf(data: unknown): LyricStoriesResult | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.cards) || d.cards.length === 0) return null;
  const cards: LyricStoryCard[] = [];
  for (const c of d.cards) {
    if (!c || typeof c !== "object") return null;
    const r = c as Record<string, unknown>;
    if (typeof r.lyricExcerpt !== "string" || typeof r.imageUrl !== "string") return null;
    if (r.imageUrl.length === 0) continue;
    cards.push({
      lyricExcerpt: r.lyricExcerpt,
      imageUrl: r.imageUrl,
      visualDescription: typeof r.visualDescription === "string" ? r.visualDescription : "",
    });
  }
  if (cards.length === 0) return null;
  return { cards, partial: d.partial === true };
}
