/* ─── The Crowns — the yearly house awards' read ─────────────────────
   The client seam for GET /api/crowns (N8): the published award
   categories, the year in progress with its live leader boards,
   and every decided year's frozen record. The server derives,
   decides at the year's turn, freezes and heralds; this module
   only carries the read across the wire, parsing defensively —
   a malformed payload degrades to no read (which the surface
   reports honestly), never to invented crowns. The awards are
   public spectacle: the endpoint needs no sign-in. Winners wear
   their crowns on their profiles for the year after the win —
   the profile badge reads /api/crowns/worn/:userId directly. */

export interface CrownCategory {
  key: string;
  title: string;
  blurb: string;
  metricLabel: string;
}

export interface CrownLeader {
  userId: string;
  displayName: string;
  slug: string;
  metric: number;
  points: number;
}

export interface CrownCategoryLeaders extends CrownCategory {
  leaders: CrownLeader[];
}

export interface CrownStanding {
  place: number;
  userId: string;
  displayName: string;
  slug: string;
  metric: number;
  points: number;
}

export interface CrownAward {
  category: string;
  categoryTitle: string;
  metricLabel: string;
  metricValue: number;
  /** Null when the category scored zero all year — an honest
   *  absence, never an invented winner. */
  winnerUserId: string | null;
  displayName: string;
  slug: string;
  stars: number;
  title: string;
  /** When the winner's profile crown comes off (Jan 1 of year+2). */
  expiresAt: string;
  standings: CrownStanding[];
}

export interface CrownYear {
  year: number;
  crownKey: string;
  name: string;
  startsAt: string;
  endsAt: string;
  decidedAt: string;
  awards: CrownAward[];
  heraldText: string;
}

export interface CrownsCurrent {
  year: number;
  crownKey: string;
  name: string;
  startsAt: string;
  endsAt: string;
  leaders: CrownCategoryLeaders[];
}

export interface CrownsRead {
  categories: CrownCategory[];
  current: CrownsCurrent;
  /** Decided years, newest first — the frozen record. */
  years: CrownYear[];
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

function parseCategory(raw: unknown): CrownCategory | null {
  if (!isRecord(raw)) return null;
  const key = str(raw["key"]);
  const title = str(raw["title"]);
  if (!key || !title) return null;
  return { key, title, blurb: str(raw["blurb"]), metricLabel: str(raw["metricLabel"]) };
}

function parseLeader(raw: unknown): CrownLeader | null {
  if (!isRecord(raw)) return null;
  const userId = str(raw["userId"]);
  const displayName = str(raw["displayName"]);
  if (!userId || !displayName) return null;
  return {
    userId,
    displayName,
    slug: str(raw["slug"]),
    metric: Math.max(0, Math.floor(num(raw["metric"]))),
    points: Math.max(0, Math.floor(num(raw["points"]))),
  };
}

function parseStanding(raw: unknown): CrownStanding | null {
  const leader = parseLeader(raw);
  if (!leader || !isRecord(raw)) return null;
  return { ...leader, place: Math.max(1, Math.floor(num(raw["place"], 1))) };
}

function parseAward(raw: unknown): CrownAward | null {
  if (!isRecord(raw)) return null;
  const category = str(raw["category"]);
  if (!category) return null;
  const winnerUserId = typeof raw["winnerUserId"] === "string" ? raw["winnerUserId"] : null;
  const standingsRaw = Array.isArray(raw["standings"]) ? raw["standings"] : [];
  return {
    category,
    categoryTitle: str(raw["categoryTitle"]),
    metricLabel: str(raw["metricLabel"]),
    metricValue: Math.max(0, Math.floor(num(raw["metricValue"]))),
    winnerUserId,
    displayName: str(raw["displayName"]),
    slug: str(raw["slug"]),
    stars: Math.min(6, Math.max(0, Math.floor(num(raw["stars"])))),
    title: str(raw["title"]),
    expiresAt: str(raw["expiresAt"]),
    standings: standingsRaw
      .map(parseStanding)
      .filter((s): s is CrownStanding => s !== null)
      .sort((a, b) => a.place - b.place),
  };
}

function parseYear(raw: unknown): CrownYear | null {
  if (!isRecord(raw)) return null;
  const year = Math.floor(num(raw["year"]));
  if (!year) return null;
  const awardsRaw = Array.isArray(raw["awards"]) ? raw["awards"] : [];
  return {
    year,
    crownKey: str(raw["crownKey"], `crowns-${year}`),
    name: str(raw["name"], `The Crowns of ${year}`),
    startsAt: str(raw["startsAt"]),
    endsAt: str(raw["endsAt"]),
    decidedAt: str(raw["decidedAt"]),
    awards: awardsRaw.map(parseAward).filter((a): a is CrownAward => a !== null),
    heraldText: str(raw["heraldText"]),
  };
}

export function parseCrownsRead(payload: unknown): CrownsRead | null {
  if (!isRecord(payload)) return null;
  const currentRaw = payload["current"];
  if (!isRecord(currentRaw)) return null;
  const year = Math.floor(num(currentRaw["year"]));
  if (!year) return null;

  const categoriesRaw = Array.isArray(payload["categories"]) ? payload["categories"] : [];
  const categories = categoriesRaw
    .map(parseCategory)
    .filter((c): c is CrownCategory => c !== null);

  const leadersRaw = Array.isArray(currentRaw["leaders"]) ? currentRaw["leaders"] : [];
  const leaders: CrownCategoryLeaders[] = [];
  for (const raw of leadersRaw) {
    const cat = parseCategory(raw);
    if (!cat || !isRecord(raw)) continue;
    const rows = Array.isArray(raw["leaders"]) ? raw["leaders"] : [];
    leaders.push({
      ...cat,
      leaders: rows.map(parseLeader).filter((l): l is CrownLeader => l !== null),
    });
  }

  const yearsRaw = Array.isArray(payload["years"]) ? payload["years"] : [];
  const years = yearsRaw
    .map(parseYear)
    .filter((y): y is CrownYear => y !== null)
    .sort((a, b) => b.year - a.year);

  return {
    categories,
    current: {
      year,
      crownKey: str(currentRaw["crownKey"], `crowns-${year}`),
      name: str(currentRaw["name"], `The Crowns of ${year}`),
      startsAt: str(currentRaw["startsAt"]),
      endsAt: str(currentRaw["endsAt"]),
      leaders,
    },
    years,
  };
}

/* ─── Endpoint ────────────────────────────────────────────────────── */

export function crownsPath(): string {
  return "/api/crowns";
}

/** The awards' whole read. Throws on a failed fetch — the
 *  surface shows its honest error + retry, never a fake record. */
export async function fetchCrownsRead(signal?: AbortSignal): Promise<CrownsRead | null> {
  const res = await fetch(crownsPath(), { signal });
  if (!res.ok) throw new Error(`crowns ${res.status}`);
  return parseCrownsRead(await res.json());
}

/* ─── Display ─────────────────────────────────────────────────────── */

/** The crowned awards of a decided year — winner-less categories
 *  are part of the record but wear no crown. */
export function crownedAwards(year: CrownYear): CrownAward[] {
  return year.awards.filter((a) => a.winnerUserId !== null);
}

/** "12 sales" — the deciding number with its published unit. */
export function crownMetricLabel(award: CrownAward): string {
  return `${award.metricValue.toLocaleString("en-US")} ${award.metricLabel}`;
}
