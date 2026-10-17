/**
 * station-panel.ts — the pure seam between a door-station
 * (lib/world/stations) and its panel: who may actually open a
 * door, and what opening it resolves to under registry v2.
 *
 * Registry v2 (NATIVE-PLAN §3.0): a station NEVER resolves to a
 * website page component. `resolveStationPanel` below is the one
 * resolution the panel host renders from, and its union has no
 * page variant — that absence is the law, pinned by the tests.
 * The in-panel router table further down now serves ONLY the
 * bare-page target a custom panel can still point at (a Front Row
 * portrait → a creator profile); it is unreachable from the
 * station-open path and is deleted at the plan's Step 8.
 */
import type { NativePattern, PalaceStation } from "./stations";

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

/* ─── Registry v2 resolution ────────────────────────────────────────
   What opening a station yields. There is deliberately NO page
   variant: a station can never resolve to a mounted website page
   component again. Native stations resolve to their pattern —
   until that pattern's surface ships, the host renders the honest
   "being rebuilt" placeholder for the pattern (the placeholder IS
   the native resolution's rendered form in this framework step). */

/** The transfer footer's exact label — one quiet button, learned
 *  once, trusted everywhere (NATIVE-PLAN §3.0, owner ruling Q3). */
export const TRANSFER_BUTTON_LABEL = "Open on the website ↗";

export type StationPanelResolution =
  | { type: "guest-pitch"; station: PalaceStation }
  | {
      type: "native";
      station: PalaceStation;
      pattern: NativePattern;
      /** The transfer footer's href: the station's exact former
       *  website path. Registry tests pin a non-null websitePath
       *  for every native station, so the "/" fallback is
       *  unreachable in practice. */
      websitePath: string;
    }
  | { type: "custom"; station: PalaceStation; id: string }
  | { type: "stepthrough"; station: PalaceStation; path: string };

/** Resolve a station open for this walker. Guests at members-only
 *  doors resolve to the guest pitch for EVERY kind — the pitch is
 *  checked before the kind, exactly as the host has always done. */
export function resolveStationPanel(
  station: PalaceStation,
  isGuest: boolean,
): StationPanelResolution {
  if (stationGuestBlocked(station, isGuest)) {
    return { type: "guest-pitch", station };
  }
  switch (station.panel.kind) {
    case "native":
      return {
        type: "native",
        station,
        pattern: station.panel.pattern,
        websitePath: station.websitePath ?? "/",
      };
    case "custom":
      return { type: "custom", station, id: station.panel.id };
    case "stepthrough":
      return { type: "stepthrough", station, path: station.panel.path };
  }
}

/* ─── The in-panel router's reach (LEGACY — Step 8 deletes this) ────
   Registry v2 note: NO station routes through this table anymore —
   stations resolve natively (above). This table remains ONLY for
   the bare-page target a custom panel can still point at (the
   Court portraits' profile door) and the deeper links inside such
   a page. StationPanel builds its page-target Switch from it;
   anything not matched here lands on the honest miss card.
   Deliberately NOT
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
