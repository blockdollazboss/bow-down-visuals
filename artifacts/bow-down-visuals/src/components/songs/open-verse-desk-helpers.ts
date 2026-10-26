/* Open Verse desk — pure helpers + DTO shapes (#176), split out of the
   .tsx so tests and other surfaces can import them without JSX. */

export interface OpenVerseSplitTerm {
  name: string;
  role: "creator" | "winner";
  sharePct: number;
}

export interface OpenVersePostDto {
  id: string;
  song_kind: "release" | "song";
  song_id: string;
  song_title: string;
  brief: string;
  slot_label: string;
  split_terms: OpenVerseSplitTerm[];
  winner_share_pct: number;
  currency: string;
  money_note: string;
  terms_note: string;
  status: "open" | "closed" | "winner_picked" | "cancelled";
  state: string;
  closes_at: string | null;
  is_owner: boolean;
  submission_count: number | null;
  my_submission_id: string | null;
  my_submission_status: string | null;
  winner_submission_id: string | null;
  is_winner: boolean;
  viewer_actions: string[];
}

export interface OpenVerseSubmissionDto {
  id: string;
  post_id: string;
  submitter_name: string;
  is_mine: boolean;
  audio_url: string;
  lyrics: string | null;
  note: string | null;
  status: string;
  created_at: string | null;
}

/** The two-line preview of the up-front terms, mirroring the server's
 *  buildSplitTerms shape: creator remainder + winner share = 100. The
 *  names are slot labels, never invented people. */
export function splitPreview(winnerSharePct: number): OpenVerseSplitTerm[] {
  const winner = Number.isFinite(winnerSharePct) ? winnerSharePct : 0;
  const creator = Math.round((100 - winner) * 100) / 100;
  return [
    { name: "Song creator", role: "creator", sharePct: creator },
    { name: "Winning verse creator", role: "winner", sharePct: winner },
  ];
}

export function postStateLabel(post: OpenVersePostDto): string {
  if (post.status === "winner_picked") return "Winner picked — verse on the track";
  if (post.status === "cancelled") return "Cancelled";
  if (post.state === "closed_time" || post.status === "closed") return "Submissions closed — awaiting the creator's pick";
  return "Taking verses now";
}
