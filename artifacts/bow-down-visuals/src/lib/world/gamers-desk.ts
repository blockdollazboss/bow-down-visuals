/**
 * gamers-desk.ts — Gamers Hub desk (Live family #96): the pure seam
 * for the Home of Gamers idea engine inside the hall Screen panel.
 *
 * The feature is the 2D Gamers page's AI generator (pages/gamers.tsx):
 * game + niche + content type → 5 stream titles, 5 video ideas and
 * 10 tags, on the page's own rail — POST /api/gamers/ideas
 * (api-server routes/generate/gamers.ts, requireAuth). Nothing here
 * invents an endpoint or a price:
 *
 *  - PRICE: the rail charges GAMERS_CREDIT_COST (default 100) and
 *    the central registry row for /api/gamers/ideas records the
 *    same 100. The desk displays GAMERS_IDEAS_COST from
 *    lib/gamers-prices — the shared seam the fixed 2D page reads —
 *    never a desk-local literal, so a price change moves both
 *    surfaces together.
 *  - SPEND-CONFIRM: the desk rides useConfirmedApi's confirmedFetch
 *    with NO overrideCost — the registry row exists, so the confirm
 *    dialog quotes the registry's own cost/feature, exactly as on
 *    the page. Cancelling the confirm returns null and NO request
 *    is ever sent: one tap, one confirm, one charge.
 *  - EXACTLY-ONCE: the rail charges BEFORE the model call and
 *    auto-refunds when generation fails (the academy refund
 *    pattern), so a failed pack nets zero and a succeeded pack is
 *    charged exactly once. The desk adds no retry of its own.
 *
 * The page's toolkit cards ride along as BROWSE cards (label +
 * blurb, the page's own words). They carry no href in-world: page
 * pull-ups are retired by World law, and their working in-world
 * homes are the palace's own desks (the Live studio desks sit in
 * this same panel; hooks and thumbnails have their own benches).
 * The desk's working surface is the generator itself.
 *
 * The labeled sample pack below mirrors the page's first-load
 * sample (pages/gamers.tsx SAMPLE_*): clearly badged "Sample" in
 * the UI, replaced wholesale by the first real generation —
 * editorial content, kept in step with the page's by the tests.
 *
 * Guest boundary: this desk renders only inside LiveDesksPanel,
 * which the World mounts inside the members-only Screen panel —
 * palace guests never reach it and gain no voice from it.
 */

import { GAMERS_IDEAS_COST } from "../gamers-prices";

/* ── the rail ─────────────────────────────────────────────────────── */

export const GAMERS_IDEAS_PATH = "/api/gamers/ideas";

/** The displayed price, re-exported from the shared seam so the
 *  desk's consumers read one name. The value lives in
 *  lib/gamers-prices (derived from the credit-costs registry) —
 *  it is never restated here. */
export const GAMERS_DESK_COST = GAMERS_IDEAS_COST;

/* ── the form ─────────────────────────────────────────────────────── */

export const GAMERS_CONTENT_TYPES = [
  { key: "stream", label: "Stream", blurb: "Clickable Twitch / YouTube / Kick titles" },
  { key: "video", label: "Video", blurb: "Long-form YouTube gaming concepts" },
  { key: "shorts", label: "Shorts", blurb: "Vertical clips under 60 seconds" },
] as const;

export type GamersContentType = (typeof GAMERS_CONTENT_TYPES)[number]["key"];

/** gamersIdeasSchema's gates, mirrored for the form: game 1–120
 *  trimmed characters; niche optional, ≤120. */
export const GAMERS_GAME_MAX = 120;
export const GAMERS_NICHE_MAX = 120;

export function gamersDraftReady(game: string, niche: string): boolean {
  const g = game.trim();
  return g.length >= 1 && g.length <= GAMERS_GAME_MAX && niche.trim().length <= GAMERS_NICHE_MAX;
}

/** The rail's body, exactly: { game, niche, contentType } with the
 *  strings trimmed the way the page trims them. */
export function buildGamersIdeasBody(draft: {
  game: string;
  niche: string;
  contentType: GamersContentType;
}): { game: string; niche: string; contentType: GamersContentType } {
  return {
    game: draft.game.trim(),
    niche: draft.niche.trim(),
    contentType: draft.contentType,
  };
}

/** The page's trending shelf — a tap fills the game box. */
export const GAMERS_TRENDING_GAMES = [
  { name: "Valorant", tag: "Tactical FPS" },
  { name: "Fortnite", tag: "Battle Royale" },
  { name: "Call of Duty", tag: "FPS" },
  { name: "Minecraft", tag: "Sandbox" },
  { name: "GTA VI", tag: "Open World" },
  { name: "League of Legends", tag: "MOBA" },
  { name: "Apex Legends", tag: "Battle Royale" },
  { name: "Roblox", tag: "UGC Platform" },
  { name: "Elden Ring", tag: "Soulslike" },
  { name: "Rocket League", tag: "Sports" },
] as const;

/* ── the pack ─────────────────────────────────────────────────────── */

export interface GamersIdeaPack {
  titles: string[];
  videoIdeas: string[];
  tags: string[];
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

function stringList(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, cap);
}

/** The page's success rule, verbatim: a pack exists only when the
 *  rail returned non-empty titles AND video ideas (the page throws
 *  otherwise). Caps are the rail's own shapes: 5 / 5 / 10. */
export function normalizeGamersPack(raw: unknown): GamersIdeaPack | null {
  const d = (raw ?? {}) as Record<string, unknown>;
  const titles = stringList(d["titles"], 5);
  const videoIdeas = stringList(d["videoIdeas"], 5);
  if (titles.length === 0 || videoIdeas.length === 0) return null;
  return {
    titles,
    videoIdeas,
    tags: stringList(d["tags"], 10),
    creditsUsed: typeof d["creditsUsed"] === "number" ? d["creditsUsed"] : null,
    creditsRemaining: typeof d["creditsRemaining"] === "number" ? d["creditsRemaining"] : null,
  };
}

/** The page's out-of-credits read, verbatim: HTTP 402 or the body's
 *  out_of_credits error marker. */
export function gamersOutOfCredits(status: number, raw: unknown): boolean {
  const d = (raw ?? {}) as Record<string, unknown>;
  return status === 402 || d["error"] === "out_of_credits";
}

/** The rail's own 402 words (routes/generate/gamers.ts) — the desk
 *  speaks them plainly instead of dressing a balance failure up as
 *  a generator error. */
export const GAMERS_OUT_OF_CREDITS_LINE =
  "You're out of Visual Bucs — top up to keep generating stream ideas.";

/* ── the labeled sample (the page's first-load pack) ──────────────── */

export const GAMERS_SAMPLE_PACK: GamersIdeaPack = {
  titles: [
    "RADIANT GRIND DAY 12 — no breaks, no mercy",
    "I 1v5 clutched with 1HP and my chat lost it",
    "Iron to Immortal: the comeback arc starts NOW",
    "Pro coach reviews my VOD live — roast incoming",
    "Ranked but every death = 10 pushups",
  ],
  videoIdeas: [
    "I hired a Radiant coach for 7 days — here's what actually changed",
    "Testing the WORST ranked agent combos so you don't have to",
    "1v1ing viewers until I lose — winner gets a skin",
    "Breaking down a pro aim routine frame by frame",
    "Ranked with randoms, zero comms, full chaos",
  ],
  tags: [
    "valorant", "valorantclips", "rankedgrind", "fps", "pcgaming",
    "clutch", "gaming", "twitch", "radiant", "aimtraining",
  ],
  creditsUsed: null,
  creditsRemaining: null,
};

/* ── the toolkit (browse cards — the page's own words) ────────────── */

export interface GamersToolCard {
  label: string;
  blurb: string;
}

export const GAMERS_TOOL_CARDS: GamersToolCard[] = [
  {
    label: "Stream Overlays & Alerts",
    blurb: "Animated overlays, alerts, and panels that make your stream look pro on day one.",
  },
  {
    label: "Gaming Thumbnails",
    blurb: "AI thumbnails built for the click — bold faces, big plays, zero Photoshop needed.",
  },
  {
    label: "Clip Highlights",
    blurb: "Turn full VODs into viral highlight clips ready for TikTok, Shorts, and Reels.",
  },
  {
    label: "Gaming Intros & Outros",
    blurb: "Esports-grade intro stingers and end cards with your branding baked in.",
  },
  {
    label: "Gaming Hook Generator",
    blurb: "First-3-second openers for gaming content — stop the scroll before they swipe.",
  },
  {
    label: "Go Live Multistream",
    blurb: "Push your stream to Twitch, YouTube, and Kick from one dashboard — no restream juggling.",
  },
];

/* ── the board ────────────────────────────────────────────────────── */

export const GAMERS_DESK_PROMOTION =
  "#96 Gamers Hub in the hall Screen panel: the Home of Gamers idea engine on the 2D page's own rail (POST /api/gamers/ideas via confirmedFetch — the registry-priced confirm, no override), the displayed price derived from lib/gamers-prices exactly as the fixed page derives it, the toolkit carried as browse cards (no page pull-ups), and the labeled sample pack until the first real generation";

export const GAMERS_DESK_FOLLOW_ONS = [
  "The toolkit cards' working in-world homes are the palace's own desks and benches (Live studio in this panel, Hook desk, thumbnail benches) — the cards here are the browse shelf, by World law they never link out to the 2D pages",
  "The rail's price is env-overridable on the server (GAMERS_CREDIT_COST); the registry row the confirm quotes is the standing 100 — if the env ever moves the rail, the registry row must move with it, on both surfaces at once",
] as const;
