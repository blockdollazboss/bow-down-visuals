/* ─── Open Verse (Stack-200 Wave 2, idea #176) — pure machine ────────────
   A song posted with an open verse slot; other creators submit verses
   in-app; the song's creator picks the winner and the winner's verse
   goes onto the track.

   Rules this module is the single source for:
   1. SPLIT TERMS UP FRONT, ON THE EXISTING RAIL. The terms are built
      and validated HERE by calling the publishing-splits rail's
      `validateWriterSplits` (sum = 100, >0 and ≤100 per share, ≤2dp) —
      there is no second splits machine and no invented rate: the song
      creator enters the winning verse's share at post time; their own
      share is the remainder. The validated two-line terms snapshot is
      stored on the post and shown to every submitter BEFORE they
      submit; picking a winner can never change them.
   2. CREATOR APPROVAL GATES EVERY STEP (smart law). A post exists only
      because its creator created it. A winner exists only because the
      creator picked one — `pickWinner` refuses every other actor, and
      there is no auto-pick, auto-post, or auto-apply path anywhere.
   3. EXACTLY-ONCE SPLIT LEDGER. Picking a winner drafts ONE ledger
      entry keyed `open-verse-split:<post_id>` (the DB row is unique on
      both post_id and that key). Re-picking the SAME winner is an
      idempotent no-op that returns the same draft; picking a DIFFERENT
      winner after a pick is refused — the split is recorded once.
   4. MONEY LAW: test mode, Visual Bucs only, never cash. The ledger
      records percentage terms for future Visual Bucs earnings; it
      charges nothing and pays nobody cash. */

import { pgErrorCode, pgErrorText } from "./pg-errors";
import { validateWriterSplits, PublishingSplitError } from "./publishing-splits";

export const OPEN_VERSE_SONG_KINDS = ["release", "song"] as const;
export type OpenVerseSongKind = (typeof OPEN_VERSE_SONG_KINDS)[number];

export const OPEN_VERSE_POST_STATUSES = ["open", "closed", "winner_picked", "cancelled"] as const;
export type OpenVersePostStatus = (typeof OPEN_VERSE_POST_STATUSES)[number];

export const OPEN_VERSE_SUBMISSION_STATUSES = ["submitted", "winner", "not_selected", "withdrawn"] as const;
export type OpenVerseSubmissionStatus = (typeof OPEN_VERSE_SUBMISSION_STATUSES)[number];

export const OPEN_VERSE_CURRENCY = "VB" as const;

export const OPEN_VERSE_COPY = {
  termsUpFront:
    "Split terms are set by the song's creator before any verse is submitted and never change after a winner is picked.",
  creatorGate:
    "Only the song's creator can close this post or pick the winning verse. Nothing is picked, posted, or applied automatically.",
  moneyNote:
    "Test mode — splits are percentages of this track's future Visual Bucs earnings. Visual Bucs only, never cash, and submitting a verse is free.",
  winnerApplied:
    "The winning verse is the verse on this track — the creator picked it, and the split below is recorded exactly once.",
} as const;

export const OPEN_VERSE_NOT_READY = {
  error: "open_verse_not_ready",
  message:
    "Open Verse isn't switched on yet — your song is safe, and posting an open verse opens as soon as the Open Verse storage lands.",
} as const;

/** Postgres "undefined table" (42P01) scoped to OUR tables (the
 *  publishing-splits lane's detector pattern). */
export function isMissingOpenVerseTable(err: unknown): boolean {
  if (pgErrorCode(err) === "42P01") return true;
  const text = pgErrorText(err);
  return /open_verse_/.test(text) && /(does not exist|undefined table|no such table)/i.test(text);
}

export class OpenVerseError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/* ── Domain shapes ─────────────────────────────────────────────────────── */

export interface OpenVerseSplitTerm {
  name: string;
  role: "creator" | "winner";
  sharePct: number;
}

export interface OpenVersePost {
  id: string;
  ownerUserId: string;
  songKind: OpenVerseSongKind;
  songId: string;
  songTitle: string;
  brief: string;
  slotLabel: string;
  splitTerms: OpenVerseSplitTerm[];
  winnerSharePct: number;
  status: OpenVersePostStatus;
  closesAt: string | Date | null;
  winnerSubmissionId: string | null;
  winnerUserId: string | null;
  winnerPickedAt: string | Date | null;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
}

export interface OpenVerseSubmission {
  id: string;
  postId: string;
  submitterUserId: string;
  submitterName: string;
  audioUrl: string;
  lyrics: string | null;
  note: string | null;
  status: OpenVerseSubmissionStatus;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
}

/** The exactly-once ledger draft a winner pick produces. */
export interface OpenVerseLedgerDraft {
  postId: string;
  winnerSubmissionId: string;
  ownerUserId: string;
  winnerUserId: string;
  winnerSharePct: number;
  splitTerms: OpenVerseSplitTerm[];
  currency: typeof OPEN_VERSE_CURRENCY;
  idempotencyKey: string;
}

export function openVerseLedgerKey(postId: string): string {
  return `open-verse-split:${postId}`;
}

/* ── Split terms — built ON the existing publishing-splits rail ──────────
   The creator enters ONLY the winning verse's share; the creator's own
   share is the remainder. Both lines go through validateWriterSplits,
   the same validator the Money desk's publishing registry uses, so the
   sum/precision/range rules are identical site-wide. The winner line's
   name is a slot label, never an invented person. */

export const OPEN_VERSE_CREATOR_TERM_NAME = "Song creator";
export const OPEN_VERSE_WINNER_TERM_NAME = "Winning verse creator";

export function buildSplitTerms(winnerSharePct: number): OpenVerseSplitTerm[] {
  if (typeof winnerSharePct !== "number" || !Number.isFinite(winnerSharePct)) {
    throw new OpenVerseError("split_invalid", "The winning verse's share must be a number.");
  }
  if (winnerSharePct <= 0 || winnerSharePct >= 100) {
    throw new OpenVerseError(
      "split_range",
      "The winning verse's share must be more than 0% and less than 100% — the song's creator keeps the rest.",
    );
  }
  const creatorSharePct = Math.round((100 - winnerSharePct) * 100) / 100;
  const terms: OpenVerseSplitTerm[] = [
    { name: OPEN_VERSE_CREATOR_TERM_NAME, role: "creator", sharePct: creatorSharePct },
    { name: OPEN_VERSE_WINNER_TERM_NAME, role: "winner", sharePct: winnerSharePct },
  ];
  try {
    validateWriterSplits(terms.map((t) => ({ name: t.name, sharePct: t.sharePct })));
  } catch (err) {
    if (err instanceof PublishingSplitError) throw new OpenVerseError(err.code, err.message);
    throw err;
  }
  return terms;
}

/** Re-validate a stored terms snapshot (defense in depth on reads and
 *  before the ledger write): exactly the creator line + winner line,
 *  summing to 100 on the existing rail. */
export function validateSplitTerms(terms: OpenVerseSplitTerm[]): void {
  if (!Array.isArray(terms) || terms.length !== 2) {
    throw new OpenVerseError("split_terms", "Split terms must be exactly two lines: the song creator and the winning verse creator.");
  }
  const roles = terms.map((t) => t.role).sort();
  if (roles[0] !== "creator" || roles[1] !== "winner") {
    throw new OpenVerseError("split_terms", "Split terms must carry one creator line and one winning-verse line.");
  }
  try {
    validateWriterSplits(terms.map((t) => ({ name: t.name, sharePct: t.sharePct })));
  } catch (err) {
    if (err instanceof PublishingSplitError) throw new OpenVerseError(err.code, err.message);
    throw err;
  }
}

export function winnerShareFromTerms(terms: OpenVerseSplitTerm[]): number {
  validateSplitTerms(terms);
  return terms.find((t) => t.role === "winner")!.sharePct;
}

/* ── Post creation ─────────────────────────────────────────────────────── */

export const MAX_BRIEF_CHARS = 1000;
export const MAX_SLOT_LABEL_CHARS = 80;

export interface CreateOpenVerseInput {
  brief?: string;
  slotLabel?: string;
  winnerSharePct: number;
  closesAt?: Date | null;
}

export function buildPostTerms(input: CreateOpenVerseInput, now: Date = new Date()): {
  brief: string;
  slotLabel: string;
  splitTerms: OpenVerseSplitTerm[];
  winnerSharePct: number;
  closesAt: Date | null;
} {
  const brief = (input.brief ?? "").trim();
  if (brief.length > MAX_BRIEF_CHARS) {
    throw new OpenVerseError("brief_too_long", `The brief can be at most ${MAX_BRIEF_CHARS} characters.`);
  }
  const slotLabel = (input.slotLabel ?? "").trim() || "Open verse";
  if (slotLabel.length > MAX_SLOT_LABEL_CHARS) {
    throw new OpenVerseError("slot_label_too_long", `The slot label can be at most ${MAX_SLOT_LABEL_CHARS} characters.`);
  }
  const splitTerms = buildSplitTerms(input.winnerSharePct);
  const closesAt = input.closesAt ?? null;
  if (closesAt !== null && closesAt.getTime() <= now.getTime()) {
    throw new OpenVerseError("closes_at_past", "The closing time must be in the future.");
  }
  return { brief, slotLabel, splitTerms, winnerSharePct: input.winnerSharePct, closesAt };
}

/* ── Submissions ───────────────────────────────────────────────────────── */

export const MAX_LYRICS_CHARS = 5000;
export const MAX_NOTE_CHARS = 500;

export function isPostOpenForSubmissions(post: OpenVersePost, now: Date = new Date()): boolean {
  if (post.status !== "open") return false;
  if (post.closesAt && new Date(post.closesAt).getTime() <= now.getTime()) return false;
  return true;
}

/** May this user submit a verse to this post right now? Pure gate —
 *  the route re-runs it; the one-submission-per-creator rule is the
 *  DB unique index plus the route's existing-row check. */
export function assertCanSubmit(
  post: OpenVersePost,
  submitterUserId: string,
  input: { audioUrl?: string; lyrics?: string | null; note?: string | null },
  now: Date = new Date(),
): { audioUrl: string; lyrics: string | null; note: string | null } {
  if (post.ownerUserId === submitterUserId) {
    throw new OpenVerseError("own_post", "You can't submit a verse to your own open verse — you're the one picking the winner.");
  }
  if (post.status === "winner_picked") {
    throw new OpenVerseError("winner_picked", "A winning verse has already been picked for this song.");
  }
  if (post.status !== "open") {
    throw new OpenVerseError("post_not_open", "This open verse isn't taking submissions right now.");
  }
  if (post.closesAt && new Date(post.closesAt).getTime() <= now.getTime()) {
    throw new OpenVerseError("submissions_closed", "Submissions for this open verse have closed.");
  }
  const audioUrl = (input.audioUrl ?? "").trim();
  if (!audioUrl) {
    throw new OpenVerseError("audio_required", "Add your verse's audio — pick one of your songs or paste its audio link.");
  }
  if (audioUrl.length > 2000) {
    throw new OpenVerseError("audio_too_long", "That audio link is too long.");
  }
  const lyrics = (input.lyrics ?? "").trim();
  if (lyrics.length > MAX_LYRICS_CHARS) {
    throw new OpenVerseError("lyrics_too_long", `Lyrics can be at most ${MAX_LYRICS_CHARS} characters.`);
  }
  const note = (input.note ?? "").trim();
  if (note.length > MAX_NOTE_CHARS) {
    throw new OpenVerseError("note_too_long", `A note can be at most ${MAX_NOTE_CHARS} characters.`);
  }
  return { audioUrl, lyrics: lyrics || null, note: note || null };
}

/* ── Winner pick — the creator-gated, exactly-once heart ───────────────── */

export interface PickWinnerResult {
  post: OpenVersePost;
  submissions: OpenVerseSubmission[];
  ledger: OpenVerseLedgerDraft;
  /** True when this call made the pick; false when the same winner was
   *  already picked and the call is an idempotent replay. */
  applied: boolean;
}

export function ledgerDraftFor(post: OpenVersePost, winner: OpenVerseSubmission): OpenVerseLedgerDraft {
  validateSplitTerms(post.splitTerms);
  return {
    postId: post.id,
    winnerSubmissionId: winner.id,
    ownerUserId: post.ownerUserId,
    winnerUserId: winner.submitterUserId,
    winnerSharePct: winnerShareFromTerms(post.splitTerms),
    splitTerms: post.splitTerms.map((t) => ({ ...t })),
    currency: OPEN_VERSE_CURRENCY,
    idempotencyKey: openVerseLedgerKey(post.id),
  };
}

/** Pick the winner. ONLY the post's creator, ONLY from an open/closed
 *  post, ONLY a live ('submitted') verse on THIS post. The winner's
 *  verse goes onto the track: the winner submission becomes 'winner',
 *  every other live submission becomes 'not_selected', withdrawn rows
 *  stay withdrawn. Re-picking the same winner replays idempotently
 *  (same ledger draft, applied=false); a different second pick is
 *  refused — the split is recorded exactly once. */
export function pickWinner(
  post: OpenVersePost,
  submissions: OpenVerseSubmission[],
  actorUserId: string,
  submissionId: string,
  now: Date = new Date(),
): PickWinnerResult {
  if (post.ownerUserId !== actorUserId) {
    throw new OpenVerseError("not_owner", "Only the song's creator can pick the winning verse.");
  }
  if (post.status === "winner_picked") {
    if (post.winnerSubmissionId === submissionId) {
      const winner = submissions.find((s) => s.id === submissionId);
      if (!winner) throw new OpenVerseError("submission_not_found", "That verse isn't on this post.");
      return { post, submissions, ledger: ledgerDraftFor(post, winner), applied: false };
    }
    throw new OpenVerseError(
      "already_picked",
      "A winning verse has already been picked for this song — the split is recorded exactly once and can't be re-picked.",
    );
  }
  if (post.status !== "open" && post.status !== "closed") {
    throw new OpenVerseError("post_not_open", "This open verse can't pick a winner from its current state.");
  }
  const winner = submissions.find((s) => s.id === submissionId && s.postId === post.id);
  if (!winner) {
    throw new OpenVerseError("submission_not_found", "That verse isn't on this post.");
  }
  if (winner.status !== "submitted") {
    throw new OpenVerseError("submission_not_live", "Only a submitted verse can be picked — that one was withdrawn or already decided.");
  }
  const nextPost: OpenVersePost = {
    ...post,
    status: "winner_picked",
    winnerSubmissionId: winner.id,
    winnerUserId: winner.submitterUserId,
    winnerPickedAt: now,
    updatedAt: now,
  };
  const nextSubs = submissions.map((s) => {
    if (s.id === winner.id) return { ...s, status: "winner" as const, updatedAt: now };
    if (s.status === "submitted") return { ...s, status: "not_selected" as const, updatedAt: now };
    return s;
  });
  return { post: nextPost, submissions: nextSubs, ledger: ledgerDraftFor(nextPost, winner), applied: true };
}

/* ── Close / cancel / withdraw ─────────────────────────────────────────── */

export function closePost(post: OpenVersePost, actorUserId: string, now: Date = new Date()): OpenVersePost {
  if (post.ownerUserId !== actorUserId) {
    throw new OpenVerseError("not_owner", "Only the song's creator can close this open verse.");
  }
  if (post.status !== "open") {
    throw new OpenVerseError("post_not_open", "Only an open post can be closed.");
  }
  return { ...post, status: "closed", updatedAt: now };
}

export function cancelPost(post: OpenVersePost, actorUserId: string, now: Date = new Date()): OpenVersePost {
  if (post.ownerUserId !== actorUserId) {
    throw new OpenVerseError("not_owner", "Only the song's creator can cancel this open verse.");
  }
  if (post.status === "winner_picked") {
    throw new OpenVerseError("already_picked", "A winner has already been picked — this open verse is complete and can't be cancelled.");
  }
  if (post.status === "cancelled") return post;
  return { ...post, status: "cancelled", updatedAt: now };
}

export function withdrawSubmission(
  post: OpenVersePost,
  submission: OpenVerseSubmission,
  actorUserId: string,
  now: Date = new Date(),
): OpenVerseSubmission {
  if (submission.submitterUserId !== actorUserId) {
    throw new OpenVerseError("not_submitter", "Only the verse's creator can withdraw it.");
  }
  if (post.status === "winner_picked") {
    throw new OpenVerseError("already_picked", "A winner has already been picked — verses can't be withdrawn now.");
  }
  if (submission.status !== "submitted") {
    throw new OpenVerseError("submission_not_live", "That verse isn't live to withdraw.");
  }
  return { ...submission, status: "withdrawn", updatedAt: now };
}

/* ── Viewer helpers ────────────────────────────────────────────────────── */

export function derivePostState(post: OpenVersePost, now: Date = new Date()): string {
  if (post.status === "open" && post.closesAt && new Date(post.closesAt).getTime() <= now.getTime()) {
    return "closed_time";
  }
  return post.status;
}

export function viewerActions(
  post: OpenVersePost,
  viewerUserId: string,
  mySubmission: OpenVerseSubmission | null,
  now: Date = new Date(),
): string[] {
  const actions: string[] = [];
  if (post.ownerUserId === viewerUserId) {
    if (post.status === "open") actions.push("close", "pick_winner");
    if (post.status === "closed") actions.push("pick_winner");
    if (post.status === "open" || post.status === "closed") actions.push("cancel");
    return actions;
  }
  if (isPostOpenForSubmissions(post, now) && !mySubmission) actions.push("submit");
  if (mySubmission && mySubmission.status === "submitted" && post.status !== "winner_picked") actions.push("withdraw");
  return actions;
}
