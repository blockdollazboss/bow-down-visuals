/* Stack 11 (in-house half) — pure helpers for Distribution & Legacy.
   No I/O here: every function is unit-testable and the routes stay thin.
   Honesty rules baked in:
   - An account pre-save exists only when the platform API confirms it.
   - Split statements allocate ONLY recorded royalty entries, using the
     split agreement version effective on each entry's period end; entries
     with no effective agreement are reported unallocated, never assigned.
   - Unlock gates verify against recorded graph/action rows, never claims. */

/* ── Money: integer cents, decimal strings at the edges ────────────────── */
export function legacyToCents(amount: string): number {
  const neg = amount.trim().startsWith("-");
  const [whole = "0", frac = ""] = amount.replace("-", "").split(".");
  const cents = parseInt(whole || "0", 10) * 100 + parseInt((frac + "00").slice(0, 2), 10);
  return neg ? -cents : cents;
}
export function legacyFromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/* ── #2 Spotify account pre-save ─────────────────────────────────────────
   The platform's library API honestly supports saving tracks and albums
   to a fan's own library (PUT /v1/me/tracks, PUT /v1/me/albums) — that is
   the real pre-save action. Playlists/EPs-as-playlist and other platforms
   have no equivalent public save, so they stay on follow/email capture. */
export interface SpotifyItem { kind: "track" | "album"; id: string }

export function parseSpotifyItem(link: string | null | undefined): SpotifyItem | null {
  if (!link) return null;
  const v = link.trim();
  const uri = v.match(/^spotify:(track|album):([A-Za-z0-9]{10,})$/);
  if (uri) return { kind: uri[1] as "track" | "album", id: uri[2]! };
  const url = v.match(/open\.spotify\.com\/(track|album)\/([A-Za-z0-9]{10,})/);
  if (url) return { kind: url[1] as "track" | "album", id: url[2]! };
  return null;
}

export function spotifyLibrarySaveUrl(item: SpotifyItem): string {
  const bucket = item.kind === "album" ? "albums" : "tracks";
  return `https://api.spotify.com/v1/me/${bucket}?ids=${encodeURIComponent(item.id)}`;
}

export function spotifyConfigured(): boolean {
  return Boolean(process.env["SPOTIFY_CLIENT_ID"] && process.env["SPOTIFY_CLIENT_SECRET"]);
}
export function spotifyRedirectUri(): string {
  return process.env["SPOTIFY_REDIRECT_URI"] ?? "https://bowdownvisuals.com/api/distribution/spotify/callback";
}
export function buildSpotifyAuthUrl(clientId: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: "user-library-modify user-library-read",
    redirect_uri: spotifyRedirectUri(),
    state,
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

/* ── #4a Lyrics package: synced timing → .lrc ──────────────────────────── */
export interface TimedLyricLine { text: string; start: number; end: number }

export function formatLegacyLrcTime(sec: number): string {
  const s = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(Math.floor(s % 60)).padStart(2, "0");
  const xx = String(Math.floor((s * 100) % 100)).padStart(2, "0");
  return `[${mm}:${ss}.${xx}]`;
}

export function buildLrc(lines: TimedLyricLine[], meta: { title?: string; artist?: string } = {}): string {
  const head: string[] = [];
  if (meta.title) head.push(`[ti:${meta.title}]`);
  if (meta.artist) head.push(`[ar:${meta.artist}]`);
  const body = [...lines]
    .filter((l) => typeof l?.text === "string")
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
    .map((l) => `${formatLegacyLrcTime(l.start ?? 0)}${l.text}`);
  return [...head, ...body].join("\n") + "\n";
}

export function validTimedLines(v: unknown): TimedLyricLine[] {
  if (!Array.isArray(v)) return [];
  const out: TimedLyricLine[] = [];
  for (const raw of v.slice(0, 500)) {
    const l = raw as { text?: unknown; start?: unknown; end?: unknown };
    if (typeof l?.text !== "string" || !l.text.trim()) continue;
    const start = Number(l.start); const end = Number(l.end);
    if (!Number.isFinite(start) || start < 0) continue;
    out.push({ text: l.text, start, end: Number.isFinite(end) && end >= start ? end : start });
  }
  return out;
}

/* ── #3 Splits accounting: per-payee statements from recorded royalties ── */
export interface StatementEntryInput { songTitle: string; platform: string; periodStart: string; periodEnd: string; grossAmount: string }
export interface StatementSplitInput { releaseId: string; payeeName: string; sharePct: number; effectiveFrom: string; supersededAt: string | null }
export interface StatementReleaseInput { id: string; title: string }
export interface PayeeStatementLine { songTitle: string; platform: string; periodStart: string; periodEnd: string; grossAmount: string; sharePct: number; amount: string }
export interface PayeeStatement { payeeName: string; releaseId: string; releaseTitle: string; totalAmount: string; entryCount: number; lines: PayeeStatementLine[] }
export interface UnallocatedEntry { songTitle: string; platform: string; periodStart: string; periodEnd: string; grossAmount: string; releaseId: string; releaseTitle: string; reason: string }

function timeOf(v: string): number {
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

/** Allocate recorded entries to payees via the agreement version effective
 *  on each entry's period end. Entries are matched to releases by title
 *  (royalty entries carry song titles, not release ids — that is the data
 *  the house actually records). Unmatched songs are ignored here (they are
 *  not this release set's earnings); matched songs with no effective
 *  agreement come back as unallocated, never silently given to anyone. */
export function computeSplitStatements(
  releases: StatementReleaseInput[],
  entries: StatementEntryInput[],
  splits: StatementSplitInput[],
  filter: { periodStart?: string; periodEnd?: string } = {},
): { statements: PayeeStatement[]; unallocated: UnallocatedEntry[]; matchedEntryCount: number } {
  const byTitle = new Map<string, StatementReleaseInput>();
  for (const r of releases) byTitle.set(r.title.trim().toLowerCase(), r);
  const inPeriod = (e: StatementEntryInput) =>
    (!filter.periodStart || e.periodEnd >= filter.periodStart) &&
    (!filter.periodEnd || e.periodStart <= filter.periodEnd);

  const stmtMap = new Map<string, PayeeStatement & { cents: number }>();
  const unallocated: UnallocatedEntry[] = [];
  let matchedEntryCount = 0;

  for (const e of entries) {
    if (!inPeriod(e)) continue;
    const release = byTitle.get(e.songTitle.trim().toLowerCase());
    if (!release) continue;
    matchedEntryCount++;
    const effective = splits.filter((s) =>
      s.releaseId === release.id &&
      timeOf(s.effectiveFrom) <= timeOf(e.periodEnd) &&
      (s.supersededAt === null || timeOf(s.supersededAt) > timeOf(e.periodEnd)));
    if (effective.length === 0) {
      unallocated.push({ songTitle: e.songTitle, platform: e.platform, periodStart: e.periodStart, periodEnd: e.periodEnd, grossAmount: e.grossAmount, releaseId: release.id, releaseTitle: release.title, reason: "No split agreement was in effect for this entry's period — the earnings are recorded but not allocated to anyone." });
      continue;
    }
    const grossCents = legacyToCents(e.grossAmount);
    for (const s of effective) {
      const key = `${s.releaseId}::${s.payeeName.trim().toLowerCase()}`;
      const stmt = stmtMap.get(key) ?? { payeeName: s.payeeName, releaseId: release.id, releaseTitle: release.title, totalAmount: "0.00", entryCount: 0, lines: [] as PayeeStatementLine[], cents: 0 };
      const amountCents = Math.round((grossCents * s.sharePct) / 100);
      stmt.cents += amountCents;
      stmt.entryCount++;
      stmt.lines.push({ songTitle: e.songTitle, platform: e.platform, periodStart: e.periodStart, periodEnd: e.periodEnd, grossAmount: e.grossAmount, sharePct: s.sharePct, amount: legacyFromCents(amountCents) });
      stmtMap.set(key, stmt);
    }
  }
  const statements = [...stmtMap.values()]
    .map(({ cents, ...rest }) => ({ ...rest, totalAmount: legacyFromCents(cents) }))
    .sort((a, b) => a.releaseTitle.localeCompare(b.releaseTitle) || a.payeeName.localeCompare(b.payeeName));
  return { statements, unallocated, matchedEntryCount };
}

/* ── #5 Permanence: what the on-platform guarantee honestly covers ─────── */
export const PERMANENCE_COVERS = [
  "Your release page and its smartlink stay live on this platform for as long as the platform operates.",
  "Your catalog listing, release metadata, and splits history stay attached to your account.",
  "No plan lapse takes your catalog down — there is no subscription lease on your releases here.",
  "Your recorded permanence election itself is kept with your catalog records.",
] as const;
export const PERMANENCE_EXCLUDES = [
  "Stores and streaming services outside this platform — their catalog rules are theirs.",
  "Content removed for legal reasons or rights disputes.",
  "Files you delete yourself.",
] as const;

/* ── #7 Roster permission rule ───────────────────────────────────────────
   Manager sees an artist's releases ONLY when the artist accepted the
   roster invite AND granted distribution access — and then read-only. */
export function rosterCanViewReleases(member: { status: string; distributionAccess: boolean } | null | undefined): boolean {
  return Boolean(member && member.status === "accepted" && member.distributionAccess);
}

/* ── #8 Unlock gate verification ─────────────────────────────────────────
   follow → a real row in the follows graph for the gate's target profile.
   share  → a share action we recorded for this signed-in fan on this gate.
   Anything else (anonymous, claimed, unrecorded) does not unlock. */
export function gateUnlocked(action: string, proof: { isFollowing: boolean; hasRecordedShare: boolean }): boolean {
  if (action === "follow") return proof.isFollowing;
  if (action === "share") return proof.hasRecordedShare;
  return false;
}
