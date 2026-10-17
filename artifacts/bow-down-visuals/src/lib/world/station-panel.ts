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
