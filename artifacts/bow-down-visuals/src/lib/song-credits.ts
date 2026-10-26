/* ─── Song credits that travel with the song (Stack-200 N1) — client ────
   The client contract for the canonical credits layer. The server
   (api-server lib/song-credits.ts) owns the merge of the four rails
   (publishing writers, master royalty splits, co-release agreed
   shares, credit entries); every surface renders THIS shape — the
   song library (play), the pre-save/smartlink page (share), profiles
   and exports — so a song's credits are identical everywhere and are
   never re-entered per surface.

   Display rules pinned here so no surface drifts:
   - shares are labelled by rail (publishing / master / co-release) —
     different rights, never blended into one number;
   - a credit with a profile_path is TAPPABLE to that creator's
     profile; a name-only credit renders as plain text, never a
     dead link;
   - a song with no credits shows the honest empty line, never an
     invented name. */

export interface SongCreditShare {
  source: "publishing" | "master" | "co_release";
  pct: number;
  frozen?: boolean;
}

export interface SongCreditPerson {
  name: string;
  profile_id: string | null;
  profile_slug: string | null;
  profile_path: string | null;
  roles: string[];
  role_labels: string[];
  shares: SongCreditShare[];
  writer_status: string | null;
  detail: string | null;
  sources: Array<"publishing" | "master" | "co_release" | "credit_entry" | "owner">;
  inherited: boolean;
}

export interface PublicSongCredits {
  song_kind: "song" | "release";
  song_id: string;
  song_title: string;
  has_credits: boolean;
  empty_message: string | null;
  credits: SongCreditPerson[];
  writer_splits_valid: boolean | null;
  version: number;
  follows_song: string;
}

export const SONG_CREDITS_EMPTY = "No credits recorded yet.";

export const SHARE_SOURCE_LABELS: Record<SongCreditShare["source"], string> = {
  publishing: "publishing",
  master: "master",
  co_release: "co-release",
};

/** "60% publishing · 70% master · 50% co-release (agreed)" — per-rail,
 *  whole numbers without a trailing .0, two decimals otherwise. */
export function formatCreditShares(shares: SongCreditShare[]): string {
  return shares
    .map((s) => {
      const pct = Number.isInteger(s.pct) ? String(s.pct) : s.pct.toFixed(2);
      return `${pct}% ${SHARE_SOURCE_LABELS[s.source]}${s.frozen ? " (agreed)" : ""}`;
    })
    .join(" · ");
}

/** One line per person for compact surfaces: "Co Writer — Songwriter,
 *  Producer — 40% publishing". */
export function formatCreditLine(person: SongCreditPerson): string {
  const shares = formatCreditShares(person.shares);
  const parts = [person.name, person.role_labels.join(", ")];
  if (shares) parts.push(shares);
  if (person.detail) parts.push(person.detail);
  return parts.join(" — ");
}

/** Should the credits block render at all? Yes whenever the server sent
 *  a credits object — including the honest empty state (a play surface
 *  that silently drops the block hides that credits were never
 *  recorded). Null/undefined (older payloads) renders nothing. */
export function shouldShowCredits(credits: PublicSongCredits | null | undefined): credits is PublicSongCredits {
  return credits != null && typeof credits === "object" && Array.isArray(credits.credits);
}
