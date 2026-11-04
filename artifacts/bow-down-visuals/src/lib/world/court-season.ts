/* ─── Court seasons — the Season Marks Wall's read ────────────────────
   The client seam for GET /api/world/court-season (World / THE-GAME
   Ring 4, migration 0153): the current court season with its live
   standings, and every settled season's frozen standings — the
   marks on the wall in the Royal Court Chamber.

   A season is one UTC calendar month, named in sequence (Season I
   = October 2026) with a courtly subtitle; season standing is the
   earned-rank ladder's points over the season's window. The server
   derives, ranks, freezes and heralds; this module only carries the
   read across the wire, parsing defensively — a malformed payload
   degrades to an empty wall (which the panel reports honestly as a
   load failure only when the fetch itself fails). Standings are
   public spectacle: the endpoint needs no sign-in, guests read the
   wall exactly as members do. */

export interface CourtSeasonStanding {
  place: number;
  userId: string;
  displayName: string;
  slug: string;
  /** Season points — the ladder's points over the season window. */
  points: number;
  /** The creator's earned rank (lifetime ladder) at the read/turn. */
  stars: number;
  title: string;
}

interface CourtSeasonCurrent {
  seasonKey: string;
  ordinal: number;
  name: string;
  subtitle: string;
  startsAt: string;
  endsAt: string;
  /** The live top of the court for the running season. */
  standings: CourtSeasonStanding[];
}

interface CourtSeasonSettled {
  seasonKey: string;
  ordinal: number;
  name: string;
  subtitle: string;
  startsAt: string;
  endsAt: string;
  settledAt: string;
  standings: CourtSeasonStanding[];
  heraldText: string;
}

export interface CourtSeasonWall {
  current: CourtSeasonCurrent;
  /** Settled seasons, newest first — the wall's frozen record. */
  seasons: CourtSeasonSettled[];
}

/* ─── Locale strings (stack1600 locale unit 50) ────────────────────
   Optional string bundle for the display words this seam speaks:
   the parse fallbacks (a standing's rank title, a season's name)
   and the turn label. Defaults are the current English literals
   VERBATIM, so existing callers and tests see byte-identical
   output; a localized caller (SeasonMarksWall) passes its
   catalog's words through, plus its locale for the turn date. */

export interface CourtSeasonStrings {
  fallbackTitle: string;
  fallbackSeasonName: string;
  /** The turn line — a function because the date is data. */
  turn: (date: string) => string;
}

export const DEFAULT_COURT_SEASON_STRINGS: CourtSeasonStrings = {
  fallbackTitle: "Street Punk",
  fallbackSeasonName: "Season I",
  turn: (date: string) => `Turns ${date}`,
};

function seasonStrings(strings?: Partial<CourtSeasonStrings>): CourtSeasonStrings {
  return { ...DEFAULT_COURT_SEASON_STRINGS, ...strings };
}

/* ─── Parsing ─────────────────────────────────────────────────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function parseStanding(
  raw: unknown,
  strings: CourtSeasonStrings,
): CourtSeasonStanding | null {
  if (!isRecord(raw)) return null;
  const userId = str(raw["userId"]);
  const displayName = str(raw["displayName"]);
  if (!userId || !displayName) return null;
  return {
    place: Math.max(1, Math.floor(num(raw["place"], 1))),
    userId,
    displayName,
    slug: str(raw["slug"]),
    points: Math.max(0, Math.floor(num(raw["points"]))),
    stars: Math.min(6, Math.max(1, Math.floor(num(raw["stars"], 1)))),
    title: str(raw["title"], strings.fallbackTitle),
  };
}

function parseStandings(
  raw: unknown,
  strings: CourtSeasonStrings,
): CourtSeasonStanding[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => parseStanding(row, strings))
    .filter((s): s is CourtSeasonStanding => s !== null)
    .sort((a, b) => a.place - b.place);
}

function parseSeasonBase(raw: Record<string, unknown>, strings: CourtSeasonStrings) {
  return {
    seasonKey: str(raw["seasonKey"]),
    ordinal: Math.max(1, Math.floor(num(raw["ordinal"], 1))),
    name: str(raw["name"], strings.fallbackSeasonName),
    subtitle: str(raw["subtitle"]),
    startsAt: str(raw["startsAt"]),
    endsAt: str(raw["endsAt"]),
  };
}

export function parseCourtSeasonWall(
  payload: unknown,
  strings?: Partial<CourtSeasonStrings>,
): CourtSeasonWall | null {
  const lbl = seasonStrings(strings);
  if (!isRecord(payload)) return null;
  const currentRaw = payload["current"];
  if (!isRecord(currentRaw)) return null;
  const seasonsRaw = Array.isArray(payload["seasons"]) ? payload["seasons"] : [];
  const seasons: CourtSeasonSettled[] = [];
  for (const raw of seasonsRaw) {
    if (!isRecord(raw)) continue;
    seasons.push({
      ...parseSeasonBase(raw, lbl),
      settledAt: str(raw["settledAt"]),
      standings: parseStandings(raw["standings"], lbl),
      heraldText: str(raw["heraldText"]),
    });
  }
  seasons.sort((a, b) => b.ordinal - a.ordinal);
  return {
    current: {
      ...parseSeasonBase(currentRaw, lbl),
      standings: parseStandings(currentRaw["standings"], lbl),
    },
    seasons,
  };
}

/* ─── Endpoint ────────────────────────────────────────────────────── */

export function courtSeasonPath(): string {
  return "/api/world/court-season";
}

/** The wall's whole read. Throws on a failed fetch — the panel
 *  shows its honest error + retry, never a fake empty wall. */
export async function fetchCourtSeasonWall(
  signal?: AbortSignal,
  strings?: Partial<CourtSeasonStrings>,
): Promise<CourtSeasonWall | null> {
  const res = await fetch(courtSeasonPath(), { signal });
  if (!res.ok) throw new Error(`court season ${res.status}`);
  return parseCourtSeasonWall(await res.json(), strings);
}

/* ─── Display ─────────────────────────────────────────────────────── */

/** "Season IV · of the Winter Hearth" — the season's full style. */
export function seasonDisplayName(s: { name: string; subtitle: string }): string {
  return s.subtitle ? `${s.name} · ${s.subtitle}` : s.name;
}

/** The day a season turns, in the reader's own words: "Turns Nov 1".
 *  `locale` defaults to undefined (the runtime's own locale — the
 *  seam's historical behaviour, pinned by its tests); a localized
 *  caller passes i18n.language so the date speaks its language. */
export function seasonTurnLabel(
  endsAtIso: string,
  locale?: string,
  strings?: Partial<CourtSeasonStrings>,
): string {
  const d = new Date(endsAtIso);
  if (Number.isNaN(d.getTime())) return "";
  return seasonStrings(strings).turn(
    d.toLocaleDateString(locale, { month: "short", day: "numeric" }),
  );
}
