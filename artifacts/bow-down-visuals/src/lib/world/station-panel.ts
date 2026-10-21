/**
 * station-panel.ts — the pure seam between a door-station
 * (lib/world/stations) and its panel: who may actually open a
 * door, and what opening it resolves to under registry v2.
 *
 * Registry v2 (NATIVE-PLAN §3.0): a station NEVER resolves to a
 * website page component. `resolveStationPanel` below is the one
 * resolution the panel host renders from, and its union has no
 * page variant — that absence is the law, pinned by the tests.
 * The in-panel router table that once served bare-page targets
 * was deleted at the plan's Step 8, together with the router
 * itself: nothing in the palace can mount a website page anymore.
 */
import type { NativePattern, PalaceStation } from "./stations";

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

/* ─── The standing switch — the OTHER outbound door ─────────────────
   Owner addendum (Oct 17, 14:29 EDT): "vice versa, I should be in
   the VR world and have an option to switch [to] the actual
   website." Alongside the per-panel footer peeks there is a
   STANDING exit in the world page's chrome: "Switch to the
   website", always reachable in the room header, both themes,
   guests included. The two doors are deliberately distinct:
   - the footer (above) is a PEEK — a station's exact page, deep
     link included, in a NEW TAB; the palace stays where it was.
   - the switch is the plain EXIT — a same-tab navigation to the
     site root; you leave the palace for the 2D website.
   The labels are exact and never interchangeable. */
export const SWITCH_TO_WEBSITE_LABEL = "Switch to the website";

/** The standing switch's destination: the website's root — the
 *  simple way out, not any station's deep link. */
export const WEBSITE_HOME_PATH = "/";

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
