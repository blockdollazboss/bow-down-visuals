/**
 * Gamers idea-generator price — derived, never a second literal.
 *
 * QC-200 fix queue #5: the Gamers page argued with itself over price —
 * the hero stat read "1 Visual Buc per idea pack" (a leftover from the
 * pre-×100 price era, matching the rail file's stale "1 credit"
 * comments) while the Generate button and the charging rail both said
 * 100. The rail (GAMERS_CREDIT_COST in api-server
 * routes/generate/gamers.ts, default 100) is the truth; the central
 * credit-cost registry row for /api/gamers/ideas records the same 100
 * and is what the confirmation dialog quotes.
 *
 * This module derives the page's displayed figure from that registry
 * row — the page carries no price literal of its own, so a future
 * price change moves the display with the registry instead of leaving
 * a stale stat behind. gamers-prices.test.ts pins the chain:
 * displayed == registry == rail constant re-derived from API source.
 */
import { getCreditCost } from "./credit-costs";

const GAMERS_IDEAS_ROW = getCreditCost("/api/gamers/ideas");

/** Visual Bucs charged per Gamers idea-pack generation. */
export const GAMERS_IDEAS_COST: number = GAMERS_IDEAS_ROW?.cost ?? 0;
