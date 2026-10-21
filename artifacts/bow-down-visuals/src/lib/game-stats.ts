/* ── Profile game record (DE-15) ───────────────────────────────────────────
   The Trophy Shelf's game group reads GET
   /api/creator-profiles/:slug/game-stats — the profile OWNER's arcade
   bests + party record, aggregated server-side by the same helpers
   behind /arcade/me and /party/me. This module owns the client DTO and
   the pure derivation from stats → shelf cards: only games actually
   played earn a card, and a creator who opted out of leaderboards
   (visible: false) shows no game record at all. Aggregates only —
   scores and wins are status, never currency. */

export interface ArcadeGameStatDto {
  game: string;
  best: number | null;
  plays: number;
}

export interface PartyGameStatDto {
  game: string;
  matches: number;
  wins: number;
  points: number;
  bestScore: number;
}

export interface ProfileGameStatsDto {
  profile: { slug: string; displayName: string };
  visible: boolean;
  arcade: ArcadeGameStatDto[];
  party: { games: PartyGameStatDto[]; totalMatches: number };
}

export interface GameCard {
  key: string;
  title: string;
  href: string;
  headline: string;
  headlineLabel: string;
  detail: string;
}

export const ARCADE_GAME_TITLES: Record<string, string> = {
  runner: "Shark King Endless Runner",
  skeet: "Royal Skeet",
};

export const PARTY_GAME_TITLES: Record<string, string> = {
  trivia: "Party Trivia",
  duel: "Court Battle",
};

const fmt = (n: number) => n.toLocaleString("en-US");

export function gameCardsFromStats(stats: ProfileGameStatsDto | null | undefined): GameCard[] {
  if (!stats || !stats.visible) return [];
  const cards: GameCard[] = [];
  for (const g of stats.arcade ?? []) {
    if (g.plays <= 0 || g.best == null) continue;
    cards.push({
      key: `arcade-${g.game}`,
      title: ARCADE_GAME_TITLES[g.game] ?? g.game,
      href: "/arcade",
      headline: fmt(g.best),
      headlineLabel: "Best run",
      detail: `${fmt(g.plays)} ${g.plays === 1 ? "run" : "runs"} in the Arcade`,
    });
  }
  for (const g of stats.party?.games ?? []) {
    if (g.matches <= 0) continue;
    cards.push({
      key: `party-${g.game}`,
      title: PARTY_GAME_TITLES[g.game] ?? g.game,
      href: "/party",
      headline: fmt(g.wins),
      headlineLabel: g.wins === 1 ? "Party win" : "Party wins",
      detail: `${fmt(g.matches)} ${g.matches === 1 ? "match" : "matches"} · ${fmt(g.points)} points`,
    });
  }
  return cards;
}
