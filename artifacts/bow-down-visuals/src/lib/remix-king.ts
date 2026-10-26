/* ─── Remix the King — shared frontend vocabulary (#152) ───────────
   Mirrors lib/db/src/schema/remix-king.ts + the API wire shapes. The
   API is the authority; these types + pure helpers exist so the
   Contests-page section and its tests speak the same words. The event
   is a monthly house event docked inside Contests (CREATE → PROMOTE):
   the King drops a track, members remix it, the winning remix becomes
   an official release under splits published in writing up front.
   Visual Bucs only — no cash amounts appear anywhere in this surface. */

export type RemixKingSplitRole = "winner" | "king" | "house";

export interface RemixKingSplit {
  role: RemixKingSplitRole;
  payeeName: string;
  payeeUserId: string | null;
  sharePct: number;
}

export type RemixKingEventStatus = "draft" | "open" | "judging" | "decided" | "released" | "cancelled";

export interface RemixKingEvent {
  id: string;
  monthKey: string;
  title: string;
  kingTrackTitle: string;
  kingTrackAudioUrl: string | null;
  kingTrackStemsUrl: string | null;
  description: string;
  splits: RemixKingSplit[];
  status: RemixKingEventStatus;
  entriesOpenAt: string | null;
  entriesCloseAt: string | null;
  winnerEntryId: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface RemixKingEntry {
  id: string;
  eventId: string;
  userId: string;
  entrantName: string;
  remixTitle: string;
  audioUrl: string;
  note: string;
  status: "submitted" | "shortlisted" | "winner" | "not_selected";
  voteCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RemixKingRelease {
  id: string;
  eventId: string;
  entryId: string;
  winnerUserId: string;
  winnerName: string;
  releaseTitle: string;
  splits: RemixKingSplit[];
  distributionReleaseId: string | null;
  status: "pending_release" | "released";
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RemixKingView {
  event: RemixKingEvent;
  entries: RemixKingEntry[];
  release: RemixKingRelease | null;
  viewerVotedIds: string[];
  viewerEntry: RemixKingEntry | null;
}

export const REMIX_KING_STATUS_LABELS: Record<string, string> = {
  open: "Entries open",
  judging: "Judging",
  decided: "Winner picked",
  released: "Officially released",
};

/** The published splits are a contract: they only render as terms
 *  when they add up to exactly 100. Anything else is shown as
 *  unpublished rather than presented as terms. */
export function splitsArePublished(splits: RemixKingSplit[]): boolean {
  return splits.length > 0 && splits.reduce((a, s) => a + s.sharePct, 0) === 100;
}

/** Preview a period total against the published splits — same
 *  floor + leftover rule as the API, so what the page shows is what
 *  the rail pays. */
export function previewSplitAmounts(totalVb: number, splits: RemixKingSplit[]): number[] {
  const amounts = splits.map((s) => Math.floor((totalVb * s.sharePct) / 100));
  let left = totalVb - amounts.reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0 && amounts.length > 0; i = (i + 1) % amounts.length) {
    amounts[i]! += 1;
    left -= 1;
  }
  return amounts;
}
