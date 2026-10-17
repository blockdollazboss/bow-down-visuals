/**
 * station-panel.ts — the pure seam between a door-station
 * (lib/world/stations) and its panel: how a panel path splits for
 * the in-panel router, and who may actually open a door.
 */
import type { PalaceStation } from "./stations";

/** Split a station's panel path into the pathname the in-panel
 *  router matches and the search its pages read (the Create house's
 *  ?panel= deep links ride the search). */
export function splitPanelPath(path: string): { pathname: string; search: string } {
  const q = path.indexOf("?");
  if (q < 0) return { pathname: path, search: "" };
  return { pathname: path.slice(0, q), search: path.slice(q + 1) };
}

/** A members-only door, met by a guest: the station still shows —
 *  its name, its pitch, and the sign-in ask — it just doesn't open.
 *  Never a dead button (the palace's guest rule). */
export function stationGuestBlocked(station: PalaceStation, isGuest: boolean): boolean {
  return station.membersOnly && isGuest;
}

/* ─── The editor step-through's deep link ───────────────────────────
   Stepping through the Create Wing's editor door should land where
   the creator left off: the editor opens a project from its
   ?project= search param (the site-wide convention — dashboard's
   Continue button, My Projects, the review links all build
   /video-editor?project=<id>). Inside the palace there is no real
   URL to carry it, so the step-through seeds the editor's router
   location with the search instead. */

/** One row of GET /api/projects as the client reads it (the route
 *  orders newest-first and selects created_at — there is no
 *  updated_at on the wire). */
export interface EditorProjectRow {
  id: string;
  created_at?: string | null;
  createdAt?: string | null;
}

/** The creator's most recent editor project: the greatest
 *  created_at wins (the dashboard's Continue notion, made
 *  order-independent); ties and unreadable stamps keep list order.
 *  No projects — or none with an id — means null: the step-through
 *  opens the editor fresh, exactly as it always has. */
export function newestEditorProjectId(projects: ReadonlyArray<EditorProjectRow>): string | null {
  let bestId: string | null = null;
  let bestAt = -Infinity;
  for (const p of projects) {
    if (!p || typeof p.id !== "string" || p.id.length === 0) continue;
    const stamp = Date.parse(p.created_at ?? p.createdAt ?? "");
    const at = Number.isFinite(stamp) ? stamp : -Infinity;
    if (bestId === null || at > bestAt) {
      bestId = p.id;
      bestAt = at;
    }
  }
  return bestId;
}

/** The search the step-through seeds for the editor: the project
 *  deep link when one exists, empty (a fresh editor) when not. */
export function editorStepthroughSearch(projectId: string | null): string {
  return projectId ? `project=${encodeURIComponent(projectId)}` : "";
}
