/* ─── Publishing splits registry (Stack-100 #3 Wave 3, #22) — client contract ─
   Per-song SONGWRITER (publishing) splits: who wrote what share of a
   song, registered by the song's creator, confirmed or disputed by
   writers who are on the platform. The server (api-server
   lib/publishing-splits.ts) owns the machine; this module mirrors its
   vocabulary: paths, labels, viewer actions, split validation for
   instant form feedback (the server re-validates — this mirror never
   substitutes for it), and the exact no-collection copy every
   publishing-splits surface must carry. */

interface PublishingWriterSummary {
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

export function publishingActionPath(id: string, action: "confirm" | "dispute" | "amend"): string {
  return `/api/publishing-splits/${encodeURIComponent(id)}/${action}`;
}
export function publishingSheetPath(id: string): string {
  return `/api/publishing-splits/${encodeURIComponent(id)}/sheet`;
}

/* ─── Locale strings (Stack 200 Lane E1, item E-2) ───────────────────
   Optional string bundle for the display words this seam speaks —
   the state / writer-status labels and the split validator's
   messages. Defaults are the English literals VERBATIM, so existing
   callers and tests see byte-identical output; a localized caller
   passes its catalog's words through (the publishingSplits.*
   catalog keys). PUBLISHING_COPY above is NOT part of this bundle:
   it is server-owned copy, sentence-identical to the API's
   PUBLISHING_COPY, and stays English by the money-copy rule. */

export interface PublishingSplitsStrings {
  stateConfirmed: string;
  stateAwaitingConfirmations: string;
  stateDisputed: string;
  stateRegistered: string;
  writerConfirmed: string;
  writerDisputed: string;
  writerPending: string;
  writerUnlinked: string;
  validationEmpty: string;
  validationTooMany: string;
  validationNameRequired: string;
  validationShareNotNumber: string;
  validationShareRange: string;
  validationShareDecimals: string;
  validationDuplicateAccount: string;
  /** The total-mismatch message — a function because the total is data. */
  validationTotalMismatch: (total: string) => string;
}

export const DEFAULT_PUBLISHING_SPLITS_STRINGS: PublishingSplitsStrings = {
  stateConfirmed: "All writers confirmed",
  stateAwaitingConfirmations: "Awaiting writer confirmations",
  stateDisputed: "Disputed — flagged for review (shares unchanged)",
  stateRegistered: "Registered",
  writerConfirmed: "Confirmed",
  writerDisputed: "Disputed",
  writerPending: "Awaiting confirmation",
  writerUnlinked: "Not on Bow Down Visuals",
  validationEmpty: "Add at least one songwriter.",
  validationTooMany: "A song can list at most 20 songwriters.",
  validationNameRequired: "Each songwriter needs a name.",
  validationShareNotNumber: "Each songwriter's share must be a number.",
  validationShareRange: "Each songwriter's share must be more than 0% and no more than 100%.",
  validationShareDecimals: "Shares can have at most two decimal places.",
  validationDuplicateAccount: "The same account can't be listed twice on one song — combine their shares into one entry.",
  validationTotalMismatch: (total: string) => `Songwriter shares must total 100% — yours total ${total}%.`,
};

function publishingStrings(strings?: Partial<PublishingSplitsStrings>): PublishingSplitsStrings {
  return { ...DEFAULT_PUBLISHING_SPLITS_STRINGS, ...strings };
}

export function publishingStateLabel(state: string, strings?: Partial<PublishingSplitsStrings>): string {
  const s = publishingStrings(strings);
  switch (state) {
    case "confirmed":
      return s.stateConfirmed;
    case "awaiting_confirmations":
      return s.stateAwaitingConfirmations;
    case "disputed":
      return s.stateDisputed;
    case "registered":
      return s.stateRegistered;
    default:
      return state;
  }
}

export function writerStatusLabel(status: string, strings?: Partial<PublishingSplitsStrings>): string {
  const s = publishingStrings(strings);
  switch (status) {
    case "confirmed":
      return s.writerConfirmed;
    case "disputed":
      return s.writerDisputed;
    case "pending":
      return s.writerPending;
    case "unlinked":
      return s.writerUnlinked;
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
  strings?: Partial<PublishingSplitsStrings>,
): string | null {
  const s = publishingStrings(strings);
  if (writers.length === 0) return s.validationEmpty;
  if (writers.length > 20) return s.validationTooMany;
  const seen = new Set<string>();
  for (const w of writers) {
    if (!w.name || w.name.trim() === "") return s.validationNameRequired;
    if (typeof w.sharePct !== "number" || !Number.isFinite(w.sharePct)) return s.validationShareNotNumber;
    if (w.sharePct <= 0 || w.sharePct > 100) return s.validationShareRange;
    if (Math.abs(w.sharePct * 100 - Math.round(w.sharePct * 100)) > 1e-9) return s.validationShareDecimals;
    if (w.userId) {
      if (seen.has(w.userId)) return s.validationDuplicateAccount;
      seen.add(w.userId);
    }
  }
  const total = writers.reduce((sum, w) => sum + w.sharePct, 0);
  if (Math.abs(total - 100) > 0.01) return s.validationTotalMismatch(total.toFixed(2));
  return null;
}

type PublishingViewerAction = "confirm" | "dispute" | "amend" | "sheet";

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
