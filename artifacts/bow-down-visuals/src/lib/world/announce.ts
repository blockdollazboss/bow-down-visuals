/**
 * announce.ts — the palace announce channel's presentation rules
 * (Ring 3, THE-GAME §5(b)), pure and unit-tested.
 *
 * The channel itself lives on the socket (WorldClient.announce);
 * this module owns how the page treats an announcement:
 * - how long the banner stands before it fades (ANNOUNCE_TTL_MS),
 * - who the room log says spoke (a herald is the host's own voice;
 *   every other kind is the palace — or the King — speaking),
 * - the herald compose box's text rule (the client's courtesy copy
 *   of the server's cap — the server enforces it regardless),
 * - and the mute: palace announcements are an automated behavior,
 *   so they ship with a user-facing on/off (the standing rule).
 *   The mute is PRESENTATION only and lives on this device: the
 *   socket keeps receiving announcements (the room log keeps the
 *   line), the banner simply doesn't rise. Default is ON (unmuted)
 *   — the palace speaking is the feature; silence is the choice.
 */
import { HERALD_MAX_CHARS, type WorldAnnouncement } from "./world-client";

/** How long an announcement banner stands before it fades. Long
 *  enough to read a headline and decide to walk; short enough that
 *  the palace never nags. */
export const ANNOUNCE_TTL_MS = 9_000;

/** The banner's line: the server built the headline from its own
 *  records, so the page prints it as it stands. */
export function announceLine(announce: WorldAnnouncement): string {
  return announce.text;
}

/** Who the room log credits with the line. A herald is the host
 *  speaking in their own words, so their name stands; the King's
 *  daily moment is the King's; everything else is the palace
 *  itself (a drop, a show, a level rising — the building's news). */
export function announceSpeaker(announce: WorldAnnouncement): string {
  if (announce.kind === "herald") return announce.name ?? "The Host";
  if (announce.kind === "king") return "The King";
  return "The Palace";
}

/** Is this announcement still banner-fresh at `nowMs`? A stale one
 *  (a slow render, a tab that slept) never rises late — the room
 *  log already kept its line. */
export function isAnnounceFresh(announce: WorldAnnouncement, nowMs: number): boolean {
  return nowMs - announce.at < ANNOUNCE_TTL_MS;
}

/** The herald compose rule: trim, cap at the herald limit. An
 *  empty result means there's nothing to send. */
export function cleanHeraldText(raw: string): string {
  return raw.trim().slice(0, HERALD_MAX_CHARS);
}

/* ── The mute (this device only) ────────────────────────────────── */

export const ANNOUNCE_MUTED_KEY = "bdv.world.announceMuted";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Are palace announcements muted on this device? Absent/garbled
 *  storage reads as unmuted — the palace speaks unless the user
 *  chose silence. */
export function loadAnnounceMuted(storage: StorageLike | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(ANNOUNCE_MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function storeAnnounceMuted(muted: boolean, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(ANNOUNCE_MUTED_KEY, muted ? "1" : "0");
  } catch {
    /* private modes etc. — the choice lasts the session, in state */
  }
}
