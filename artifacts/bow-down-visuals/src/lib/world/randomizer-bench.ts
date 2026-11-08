/* ─── Randomizer (Dice) bench in-world (Stack 300 world parity,
   census Lane B item 8 / manifest item 101) ────────────────────
   The Hooks page's "dice" tab (RandomizerDice in pages/hooks.tsx),
   native at the Hook Desk beside the desk's other benches. NOT
   the TailDesks Dices button — that one is the giveaway-contest
   provably-fair draw, a different feature on a different rail.

   Two rolls, exactly like the page:
     FREE roll — 100% client-side from the page's own idea lists
       below (zero server cost, roll as much as you want).
     AI roll — POST /api/randomizer { category } → { ideas[5],
       creditsUsed, creditsRemaining } at 100 Visual Bucs, the
       credit registry's "/api/randomizer" entry (the route's
       charge and the page's AI_CREDIT_COST agree); the bench
       reads the registry so the shown price can never drift
       from the confirmation's price.

   Confirmation law: the AI roll rides useConfirmedApi's
   confirmedFetch — the spend confirmation shows BEFORE the
   roll, a declined confirmation rolls nothing, and a failed
   roll is refunded server-side. The free roll never touches
   the seam.

   The category keys are the backend route's CATEGORIES enum
   (routes/generate/randomizer.ts) verbatim — the page's header
   carries the same warning. The free-idea lists are the page's
   own lists, carried here so the bench rolls the same dice;
   the lane's tests pin every list against pages/hooks.tsx so
   the two can never silently drift. Copy rides the page's
   catalog namespace (randomizer.*). */
import { getCreditCost } from "../credit-costs";

export const RANDOMIZER_PATH = "/api/randomizer";

/** The registry's feature name for the rail — the words the
 *  spend confirmation and the out-of-Bucs line speak. */
export const RANDOMIZER_FEATURE = "Content Randomizer";

/** POST /api/randomizer — registry 100, the route's charge and
 *  the page's AI_CREDIT_COST agree. */
export function randomizerCost(): number {
  const entry = getCreditCost(RANDOMIZER_PATH);
  if (!entry) throw new Error(`No registered credit cost for ${RANDOMIZER_PATH}`);
  return entry.cost;
}

/* ─── The route's CATEGORIES enum (verbatim) ─────────────────── */

export const RANDOMIZER_CATEGORIES = [
  "video-ideas",
  "hooks",
  "thumbnails",
  "song-concepts",
  "niche-picker",
  "challenges",
] as const;
export type RandomizerCategory = (typeof RANDOMIZER_CATEGORIES)[number];

/* ─── The page's free-idea lists (verbatim from hooks.tsx) ───── */

export const RANDOMIZER_FREE_IDEAS: Record<RandomizerCategory, readonly string[]> = {
  "video-ideas": [
    "Day in the life of your artist persona — but every scene is a different music video set",
    "React to your own old songs and roast your past self",
    "Turn your song's lyrics into a 30-second movie trailer",
    "Film the same chorus in 5 wildly different locations, cut on the beat",
    "Behind-the-scenes of your AI video generation — show the prompts, show the magic",
    "POV: your song plays as the villain walks in slow motion",
    "Teach one bar of your verse, then challenge fans to flip it",
    "Green-screen yourself into famous album covers while your track plays",
    "Speedrun: write, record, and shoot a hook in 60 minutes",
    "Your song + a trending meme format = instant promo clip",
    "Acoustic-to-anthem: start stripped down, drop into the full mix",
    "Ask fans to pick your next single's cover art — then reveal the AI options",
  ],
  hooks: [
    "Stop scrolling — this took 47 tries to get right",
    "POV: you just found your new favorite artist",
    "I bet you can't name this sample",
    "This song was made entirely by AI… or was it?",
    "Wait for the drop at 0:07",
    "Nobody talks about this part of being an independent artist",
    "I asked AI to finish my verse — here's what happened",
    "Your playlist is missing this",
    "This is what heartbreak sounds like in 2026",
    "One take. No edits. Full song.",
    "The label said no, so I did it myself",
    "Comment 'FIRE' and I'll drop the full version",
  ],
  thumbnails: [
    "Split face: calm on the left, full performance energy on the right",
    "Giant gold text over a dark stage — 3 words max",
    "Your artist portrait with a glowing crown, black background",
    "Before/after: rough demo vs. final master waveform",
    "Close-up of hands on the mic, dramatic side lighting",
    "Red circle + arrow pointing at the wildest frame of your video",
    "You vs. the AI: side-by-side portrait showdown",
    "Neon city backdrop, you silhouetted in the center",
    "Freeze the exact frame the beat drops — add shockwave lines",
    "Stacked polaroids of every look from the shoot",
    "Dark room, single spotlight, gold jewelry catching the light",
    "Big shocked expression + the song title in bold condensed type",
  ],
  "song-concepts": [
    "An anthem about quitting your 9-to-5 to chase the dream",
    "A late-night R&B confession recorded like a voicemail",
    "Trap banger about your hometown finally getting its shine",
    "A diss track aimed at your own self-doubt",
    "Love song for the grind — romance between you and the hustle",
    "Drill track narrated like a nature documentary",
    "Gospel-tinged hook about making it out, verses pure street poetry",
    "A breakup song where the 'ex' is your old sound",
    "Party starter built around a viral dance challenge",
    "Storytelling rap: one verse, one night, one decision that changed everything",
    "Afrobeats fusion celebrating your roots",
    "Cinematic intro track for your alter ego's origin story",
  ],
  "niche-picker": [
    "AI music video director — you make other artists' visuals",
    "The sample detective — you find and flip obscure samples on camera",
    "One-song-a-day challenger — relentless output niche",
    "Genre-blender — you fuse two genres nobody combined before",
    "The hook doctor — you fix weak choruses live",
    "Behind-the-beat educator — you teach production with personality",
    "Character artist — every release is a new persona with lore",
    "Hometown hero documentarian — you put your city on the map",
    "AI vs. human collaborator — every song is a man-vs-machine duel",
    "The remix royalty — you flip trending sounds weekly",
    "Lyric breakdown analyst — you decode bars like film theory",
    "Tiny-desk-style intimate performer — raw, no production hiding",
  ],
  challenges: [
    "Post one clip every day for 30 days — no excuses",
    "Make a song using only sounds from your kitchen",
    "Let your comments pick your next beat — then deliver in 48 hours",
    "Recreate a viral video shot-for-shot with your own twist",
    "Go live and write a verse with chat voting on every bar",
    "Drop a 15-second teaser every day for a week before release",
    "Collab with a creator you've never met — full song in one stream",
    "Perform your song in the weirdest location you can find",
    "Flip the same sample 3 different ways in 3 videos",
    "Teach a fan your chorus over video call, post their attempt",
    "No-face challenge: promote a song for a week without showing your face",
    "Speedrun your entire release rollout in 24 hours",
  ],
};

/** The page's pickRandom: a fresh pick, never the current one
 *  twice when the list has more than one idea. `roll` is the
 *  randomness source (Math.random in the bench; pinned in
 *  tests). */
export function pickRandomIdea(
  items: readonly string[],
  except?: string,
  roll: () => number = Math.random,
): string {
  if (items.length === 1) return items[0];
  let pick = items[Math.floor(roll() * items.length)];
  let guard = 0;
  while (pick === except && guard++ < 10) {
    pick = items[Math.floor(roll() * items.length)];
  }
  return pick;
}

/** One free roll in a category. */
export function freeRollIdea(category: RandomizerCategory, except?: string): string {
  return pickRandomIdea(RANDOMIZER_FREE_IDEAS[category], except);
}

/* ─── Payload + response guards ──────────────────────────────── */

/** hooks.tsx aiRoll's body: { category }. */
export function buildRandomizerPayload(category: RandomizerCategory): Record<string, unknown> {
  return { category };
}

/** The AI roll's answer: a non-empty list of idea strings, or
 *  the roll didn't happen — a drifted payload parses to null
 *  and the bench shows its error copy. */
export function randomizerIdeasOf(data: unknown): string[] | null {
  if (!data || typeof data !== "object") return null;
  const ideas = (data as Record<string, unknown>).ideas;
  if (!Array.isArray(ideas) || ideas.length === 0) return null;
  const out = ideas.filter((i): i is string => typeof i === "string" && i.length > 0);
  return out.length > 0 ? out : null;
}
