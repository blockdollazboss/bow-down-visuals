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

/* ─── The in-panel router's reach ───────────────────────────────────
   The paths the palace's panels can open WITHOUT leaving the
   palace: every station's page target, the profile door the Court
   portraits open, and the deeper hub destinations the panels'
   pages link to most — a post, a track, a watch page, a creator's
   shop (the Marketplace's whole point), the coach, the project
   list, the credit ledger, the release desk, the scheduler.
   StationPanel builds its Switch from this table; anything not
   matched here lands on the honest miss card. Deliberately NOT
   here: /video-editor (a working surface, not a panel page — the
   palace's way in is the Create Wing's step-through door),
   /shorts (a full-viewport snap feed a panel frame breaks),
   /my-shop (the owner's manager chrome), and /login + /signup
   (sign-in never renders inside a panel — phishing hygiene). */
export const PANEL_ROUTE_PATHS = [
  /* The doors' own targets. */
  "/messages",
  "/my-music",
  "/charts",
  "/arcade",
  "/party",
  "/dashboard",
  "/create",
  "/audio-studio",
  "/thumbnail-studio",
  "/memberships",
  "/branding-kit",
  "/press-kit",
  "/storefronts",
  "/community",
  "/promote",
  "/earnings",
  /* The deeper links those pages make. */
  "/post/:id",
  "/track/:id",
  "/watch/:id",
  "/shop/:slug",
  "/coach",
  "/my-projects",
  "/credit-history",
  "/distribute",
  "/scheduler",
  /* The Court portraits' door. */
  "/artist/:slug",
] as const;

export type PanelRoutePath = (typeof PANEL_ROUTE_PATHS)[number];

/** The panel route covering a pathname, or null when the palace
 *  doesn't reach it (the miss card's whole job). ":param" segments
 *  match exactly one non-empty segment; everything else is exact. */
export function panelRouteFor(pathname: string): PanelRoutePath | null {
  const parts = pathname.split("/").filter((s) => s.length > 0);
  for (const route of PANEL_ROUTE_PATHS) {
    const routeParts = route.split("/").filter((s) => s.length > 0);
    if (routeParts.length !== parts.length) continue;
    let ok = true;
    for (let i = 0; i < routeParts.length; i++) {
      const rp = routeParts[i]!;
      if (rp.startsWith(":")) continue;
      if (rp !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return route;
  }
  return null;
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
