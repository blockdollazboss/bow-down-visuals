/* ─── Publishing splits registry (Stack-100 #3 Wave 3, #22) — client contract ─
   Per-song SONGWRITER (publishing) splits: who wrote what share of a
   song, registered by the song's creator, confirmed or disputed by
   writers who are on the platform. The server (api-server
   lib/publishing-splits.ts) owns the machine; this module mirrors its
   vocabulary: paths, labels, viewer actions, split validation for
   instant form feedback (the server re-validates — this mirror never
   substitutes for it), and the exact no-collection copy every
   publishing-splits surface must carry. */

export interface PublishingWriterSummary {
  name: string;
  profile_id: string | null;
  user_id: string | null;
  is_linked: boolean;
  is_me: boolean;
  share_pct: number;
  confirmation_status: string; // 'pending' | 'confirmed' | 'disputed' | 'unlinked'
  dispute_note: string | null;
  confirmed_at: string | null;
  disputed_at: string | null;
}

export type PublishingRegistrationState =
  | "disputed"
  | "awaiting_confirmations"
  | "confirmed"
  | "registered";

export interface PublishingRegistrationItem {
  id: string;
  song_kind: "release" | "song";
  song_id: string;
  song_title: string;
  is_owner: boolean;
  state: PublishingRegistrationState;
  has_dispute: boolean;
  collection_status: string;
  collection_notice: string;
  my_share_pct: number | null;
  my_writer_status: string | null;
  writers: PublishingWriterSummary[];
  created_at: string | null;
  updated_at: string | null;
}

/* Collection copy — MUST stay sentence-identical to the API's
   PUBLISHING_COPY (api-server src/lib/publishing-splits.ts). This
   registry records splits; it collects and pays nothing until a
   publishing administration partner is connected. */
export const PUBLISHING_COPY = {
  collectionNotice:
    "Registered — collection activates when publishing administration is connected.",
  registryOnly:
    "This registry records songwriter (publishing) splits for a song. It does not collect or pay royalties — songwriter royalties are collected by a publishing administrator, and none is connected yet.",
  disputeRule:
    "Disputing flags this registration for review. It never changes anyone's share — only the creator who registered the song can revise the splits, and a revision asks every writer to confirm again.",
} as const;

export const PUBLISHING_SPLITS_PATH = "/api/publishing-splits";
export const PUBLISHING_SPLITS_MINE_PATH = "/api/publishing-splits/mine";

export function publishingRegistrationPath(id: string): string {
  return `/api/publishing-splits/${encodeURIComponent(id)}`;
}
export function publishingActionPath(id: string, action: "confirm" | "dispute" | "amend"): string {
  return `/api/publishing-splits/${encodeURIComponent(id)}/${action}`;
}
export function publishingSheetPath(id: string): string {
  return `/api/publishing-splits/${encodeURIComponent(id)}/sheet`;
}

export function publishingStateLabel(state: string): string {
  switch (state) {
    case "confirmed":
      return "All writers confirmed";
    case "awaiting_confirmations":
      return "Awaiting writer confirmations";
    case "disputed":
      return "Disputed — flagged for review (shares unchanged)";
    case "registered":
      return "Registered";
    default:
      return state;
  }
}

export function writerStatusLabel(status: string): string {
  switch (status) {
    case "confirmed":
      return "Confirmed";
    case "disputed":
      return "Disputed";
    case "pending":
      return "Awaiting confirmation";
    case "unlinked":
      return "Not on Bow Down Visuals";
    default:
      return status;
  }
}

/** Client-side mirror of the server split rule, for instant feedback:
 *  1–20 writers, each share > 0 and ≤ 100 with at most 2 decimal
 *  places, the same account never listed twice, and the shares total
 *  100 (within the rail's 0.01 tolerance). Returns the error message,
 *  or null when the split is valid. The server re-validates with the
 *  identical rule — displays equal rails. */
export function writerSplitValidationError(
  writers: Array<{ name: string; userId?: string | null; sharePct: number }>,
): string | null {
  if (writers.length === 0) return "Add at least one songwriter.";
  if (writers.length > 20) return "A song can list at most 20 songwriters.";
  const seen = new Set<string>();
  for (const w of writers) {
    if (!w.name || w.name.trim() === "") return "Each songwriter needs a name.";
    if (typeof w.sharePct !== "number" || !Number.isFinite(w.sharePct)) return "Each songwriter's share must be a number.";
    if (w.sharePct <= 0 || w.sharePct > 100) return "Each songwriter's share must be more than 0% and no more than 100%.";
    if (Math.abs(w.sharePct * 100 - Math.round(w.sharePct * 100)) > 1e-9) return "Shares can have at most two decimal places.";
    if (w.userId) {
      if (seen.has(w.userId)) return "The same account can't be listed twice on one song — combine their shares into one entry.";
      seen.add(w.userId);
    }
  }
  const total = writers.reduce((sum, w) => sum + w.sharePct, 0);
  if (Math.abs(total - 100) > 0.01) return `Songwriter shares must total 100% — yours total ${total.toFixed(2)}%.`;
  return null;
}

export type PublishingViewerAction = "confirm" | "dispute" | "amend" | "sheet";

/** Actions the VIEWER may take, mirroring the server machine: a linked
 *  writer whose share is pending or disputed may confirm; pending or
 *  confirmed may dispute; the owner may amend (revise) at any time;
 *  any participant may open the split sheet. */
export function publishingViewerActions(
  item: Pick<PublishingRegistrationItem, "is_owner" | "my_writer_status">,
): PublishingViewerAction[] {
  const actions: PublishingViewerAction[] = ["sheet"];
  if (item.my_writer_status === "pending" || item.my_writer_status === "disputed") actions.push("confirm");
  if (item.my_writer_status === "pending" || item.my_writer_status === "confirmed") actions.push("dispute");
  if (item.is_owner) actions.push("amend");
  return actions;
}
