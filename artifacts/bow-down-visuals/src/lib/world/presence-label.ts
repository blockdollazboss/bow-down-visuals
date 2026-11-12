/**
 * presence-label.ts — B-25 (owner ruling, Nov 11, 2026): a World
 * presence count is a CONNECTION count, and it is never labeled
 * "people" whole.
 *
 * Member peers are exact people — one peer per account, and a
 * rejoin replaces the old peer, so a member can never stand in a
 * room twice. A guest peer is one open tab: the guest key is the
 * per-tab session id (world-room.ts), so one guest with three
 * tabs is three guest peers. The honest label therefore splits
 * the count: the member part is people, the guest part is
 * "connections."
 *
 * The server sends the breakdown with every presence read
 * (guestConnections on the palace directory entries and the
 * Creator Rooms reads — a slice of the same presentPeers() set
 * the count itself reads; the counting is unchanged). These
 * helpers turn (count, guestConnections) into the label the
 * directory surfaces render.
 */

export interface PresenceBreakdown {
  /** Present member peers — exact people. */
  people: number;
  /** Present guest peers — open connections, never people. */
  connections: number;
}

/** Split a presence count into its people part and its guest
 *  connections part. Defensive by construction: the connections
 *  part is clamped into [0, count], so a stale or malformed
 *  breakdown can never make the people part negative or the
 *  parts disagree with the count they break down. */
export function presenceBreakdown(
  count: number,
  guestConnections?: number | null,
): PresenceBreakdown {
  const total =
    typeof count === "number" && Number.isFinite(count) && count > 0
      ? Math.floor(count)
      : 0;
  const raw =
    typeof guestConnections === "number" && Number.isFinite(guestConnections)
      ? Math.floor(guestConnections)
      : 0;
  const connections = Math.min(Math.max(raw, 0), total);
  return { people: total - connections, connections };
}

/** The directory label for a presence count, in plain words:
 *  members as people, guest connections as connections.
 *  "3 people" · "1 person" · "2 connections" · "1 connection" ·
 *  "3 people · 2 connections" · "0 people" for an empty room. */
export function presenceCountText(
  count: number,
  guestConnections?: number | null,
): string {
  const { people, connections } = presenceBreakdown(count, guestConnections);
  const peopleText = `${people} ${people === 1 ? "person" : "people"}`;
  if (connections === 0) return peopleText;
  const connectionsText = `${connections} ${connections === 1 ? "connection" : "connections"}`;
  if (people === 0) return connectionsText;
  return `${peopleText} · ${connectionsText}`;
}
