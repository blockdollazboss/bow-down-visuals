/**
 * studio-board.ts — the data shaping behind the Studio Board
 * (NATIVE-PLAN §3.1: My Studio, the Create Wing's board).
 *
 * The station used to pull up the /dashboard hub. In-world it is a
 * board: the creator's projects as rows with one action —
 * Continue, which steps through into the Visual Vibes editor
 * seeded with that project (the step-through machinery the palace
 * already has; the seeding seam is lib/world/station-panel's
 * editorStepthroughSearch, used by the panel host). The old
 * /my-projects list folds in as this board's full project list.
 * Alongside the rows: a balance + streak strip, and the vault
 * characters as a portrait row (shaped by lib/world/characters —
 * reused, not re-derived).
 *
 * Endpoints (the dashboard's own, plan §1):
 *   GET /api/projects         (project rows, newest first)
 *   GET /api/credits/history  (recent VB activity for the strip)
 *   GET /api/bonus/status     (streak + bonus balance)
 *   GET /api/artist-vaults    (vault characters — characters.ts)
 */

/* ─── Project rows ────────────────────────────────────────────────── */

export interface StudioProjectRow {
  id: string;
  /** Display label: the dashboard's own fallback chain — the
   *  project's title, else "artist — song", else its type. */
  label: string;
  projectType: string;
  createdAt: string | null;
  creditsUsed: number | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The dashboard's project label, verbatim: title first, then the
 *  artist/song pair, then the project type — never an empty row. */
export function studioProjectLabel(row: {
  title?: unknown;
  artist_name?: unknown;
  artistName?: unknown;
  song_title?: unknown;
  songTitle?: unknown;
  project_type?: unknown;
  projectType?: unknown;
}): string {
  const title = str(row.title);
  if (title) return title;
  const pair = [str(row.artist_name ?? row.artistName), str(row.song_title ?? row.songTitle)]
    .filter(Boolean)
    .join(" — ");
  if (pair) return pair;
  return str(row.project_type ?? row.projectType) ?? "Untitled project";
}

/** Shape GET /api/projects into board rows. Server order is
 *  newest-first and is preserved; rows without a usable id are
 *  skipped (Continue needs the id to seed the editor). */
export function normalizeStudioProjects(payload: unknown): StudioProjectRow[] {
  if (!isObj(payload) || !Array.isArray(payload["projects"])) return [];
  const out: StudioProjectRow[] = [];
  for (const row of payload["projects"]) {
    if (!isObj(row)) continue;
    const id = str(row["id"]);
    if (!id) continue;
    out.push({
      id,
      label: studioProjectLabel(row),
      projectType: str(row["project_type"] ?? row["projectType"]) ?? "",
      createdAt: str(row["created_at"] ?? row["createdAt"]),
      creditsUsed: num(row["credits_used"] ?? row["creditsUsed"]),
    });
  }
  return out;
}

/* ─── The balance + streak strip ──────────────────────────────────── */

export interface StudioStrip {
  streak: number;
  bonusCredits: number;
  canClaimDaily: boolean;
}

/** Shape GET /api/bonus/status into the strip's streak half. Null
 *  when the payload carries no real streak — the strip then shows
 *  the balance alone rather than a guessed flame count. */
export function normalizeStudioStrip(payload: unknown): StudioStrip | null {
  if (!isObj(payload)) return null;
  const streak = num(payload["streak"]);
  if (streak === null) return null;
  return {
    streak,
    bonusCredits: num(payload["bonusCredits"]) ?? 0,
    canClaimDaily: payload["canClaimDaily"] === true,
  };
}

/** The strip's recent-activity line: the newest VB usage entry,
 *  in words ("Latest: Song generation · −400 VB"). Null when the
 *  history is empty or unreadable — the strip just omits it. */
export function latestActivityLine(creditsPayload: unknown): string | null {
  if (!isObj(creditsPayload) || !Array.isArray(creditsPayload["usage"])) return null;
  for (const row of creditsPayload["usage"]) {
    if (!isObj(row)) continue;
    const action = str(row["action"]);
    const used = num(row["creditsUsed"]);
    if (!action || used === null) continue;
    const amount =
      used < 0 ? `+${Math.abs(used).toLocaleString("en-US")}` : used === 0 ? "0" : `−${used.toLocaleString("en-US")}`;
    return `Latest: ${action} · ${amount} VB`;
  }
  return null;
}
