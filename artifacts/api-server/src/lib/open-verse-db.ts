/* ─── Open Verse — DB-facing helpers ─────────────────────────────────────
   Raw-SQL translation between the open_verse_* tables and the pure
   machine (lib/open-verse.ts), following the publishing-splits-db
   discipline:
   - WRITE paths probe first (probeOpenVerseTables): a missing table
     (42P01, held migration 9999) becomes the honest 503
     OPEN_VERSE_NOT_READY before anything is created.
   - READ paths are GUARDED where they feed a list: a missing table
     degrades to "no open verses yet" so one un-migrated section can
     never take the Songs desk down (resilience law).
   - The winner pick persists in ONE pass and the split ledger insert
     is ON CONFLICT DO NOTHING on its unique keys — exactly once. */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";
import {
  isMissingOpenVerseTable,
  type OpenVerseLedgerDraft,
  type OpenVersePost,
  type OpenVerseSongKind,
  type OpenVerseSplitTerm,
  type OpenVerseSubmission,
} from "./open-verse";

type Row = Record<string, unknown>;

function toPost(r: Row): OpenVersePost {
  return {
    id: String(r.id),
    ownerUserId: String(r.owner_user_id),
    songKind: (r.song_kind === "release" ? "release" : "song") as OpenVerseSongKind,
    songId: String(r.song_id),
    songTitle: String(r.song_title ?? ""),
    brief: String(r.brief ?? ""),
    slotLabel: String(r.slot_label ?? "Open verse"),
    splitTerms: (Array.isArray(r.split_terms) ? r.split_terms : []) as OpenVerseSplitTerm[],
    winnerSharePct: Number(r.winner_share_pct),
    status: String(r.status ?? "open") as OpenVersePost["status"],
    closesAt: (r.closes_at as string | null) ?? null,
    winnerSubmissionId: (r.winner_submission_id as string | null) ?? null,
    winnerUserId: (r.winner_user_id as string | null) ?? null,
    winnerPickedAt: (r.winner_picked_at as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
    updatedAt: (r.updated_at as string | null) ?? null,
  };
}

function toSubmission(r: Row): OpenVerseSubmission {
  return {
    id: String(r.id),
    postId: String(r.post_id),
    submitterUserId: String(r.submitter_user_id),
    submitterName: String(r.submitter_name ?? "Creator"),
    audioUrl: String(r.audio_url ?? ""),
    lyrics: (r.lyrics as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    status: String(r.status ?? "submitted") as OpenVerseSubmission["status"],
    createdAt: (r.created_at as string | null) ?? null,
    updatedAt: (r.updated_at as string | null) ?? null,
  };
}

export async function probeOpenVerseTables(): Promise<void> {
  await db.execute(sql`SELECT id FROM open_verse_posts LIMIT 1`);
  await db.execute(sql`SELECT id FROM open_verse_submissions LIMIT 1`);
  await db.execute(sql`SELECT id FROM open_verse_split_ledger LIMIT 1`);
}

export async function loadOpenVersePost(id: string): Promise<OpenVersePost | null> {
  const rows = await db.execute(sql`SELECT * FROM open_verse_posts WHERE id = ${id} LIMIT 1`);
  const row = rows.rows[0] as Row | undefined;
  return row ? toPost(row) : null;
}

export async function loadOpenVerseSubmissions(postId: string): Promise<OpenVerseSubmission[]> {
  const rows = await db.execute(sql`
    SELECT * FROM open_verse_submissions WHERE post_id = ${postId} ORDER BY created_at ASC LIMIT 500
  `);
  return (rows.rows as Row[]).map(toSubmission);
}

export async function loadOpenVerseDetail(
  id: string,
): Promise<{ post: OpenVersePost; submissions: OpenVerseSubmission[] } | null> {
  const post = await loadOpenVersePost(id);
  if (!post) return null;
  const submissions = await loadOpenVerseSubmissions(id);
  return { post, submissions };
}

/** Guarded public list: posts still taking verses (status 'open'),
 *  newest first. Degrades to { ready: false } pre-migration. */
export async function listOpenVersePosts(): Promise<{ ready: boolean; posts: OpenVersePost[] }> {
  try {
    const rows = await db.execute(sql`
      SELECT * FROM open_verse_posts
      WHERE status = 'open' AND (closes_at IS NULL OR closes_at > now())
      ORDER BY created_at DESC LIMIT 200
    `);
    return { ready: true, posts: (rows.rows as Row[]).map(toPost) };
  } catch (err) {
    if (isMissingOpenVerseTable(err)) {
      logger.debug("[open-verse] tables not present yet — serving without open verse data");
      return { ready: false, posts: [] };
    }
    throw err;
  }
}

/** Guarded "mine": posts I own + posts I submitted to (with my verse). */
export async function listOpenVerseForUser(
  userId: string,
): Promise<{ ready: boolean; posts: OpenVersePost[]; mySubmissions: OpenVerseSubmission[] }> {
  try {
    const postRows = await db.execute(sql`
      SELECT DISTINCT p.* FROM open_verse_posts p
      LEFT JOIN open_verse_submissions s ON s.post_id = p.id
      WHERE p.owner_user_id = ${userId} OR s.submitter_user_id = ${userId}
      ORDER BY p.created_at DESC LIMIT 200
    `);
    const subRows = await db.execute(sql`
      SELECT * FROM open_verse_submissions WHERE submitter_user_id = ${userId} ORDER BY created_at DESC LIMIT 200
    `);
    return {
      ready: true,
      posts: (postRows.rows as Row[]).map(toPost),
      mySubmissions: (subRows.rows as Row[]).map(toSubmission),
    };
  } catch (err) {
    if (isMissingOpenVerseTable(err)) {
      logger.debug("[open-verse] tables not present yet — serving mine without open verse data");
      return { ready: false, posts: [], mySubmissions: [] };
    }
    throw err;
  }
}

/** Submission counts per post (guarded by caller). */
export async function countOpenVerseSubmissions(postIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (postIds.length === 0) return out;
  const rows = await db.execute(sql`
    SELECT post_id, COUNT(*)::int AS n FROM open_verse_submissions
    WHERE post_id IN (${sql.join(postIds.map((i) => sql`${i}`), sql`, `)}) AND status != 'withdrawn'
    GROUP BY post_id
  `);
  for (const r of rows.rows as Row[]) out.set(String(r.post_id), Number(r.n));
  return out;
}

export async function insertOpenVersePost(post: {
  id: string;
  ownerUserId: string;
  songKind: OpenVerseSongKind;
  songId: string;
  songTitle: string;
  brief: string;
  slotLabel: string;
  splitTerms: OpenVerseSplitTerm[];
  winnerSharePct: number;
  closesAt: Date | null;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO open_verse_posts
      (id, owner_user_id, song_kind, song_id, song_title, brief, slot_label,
       split_terms, winner_share_pct, status, closes_at)
    VALUES (${post.id}, ${post.ownerUserId}, ${post.songKind}, ${post.songId}, ${post.songTitle},
      ${post.brief}, ${post.slotLabel}, ${JSON.stringify(post.splitTerms)}::jsonb,
      ${post.winnerSharePct}, 'open', ${post.closesAt})
  `);
}

export async function findSubmissionByUser(postId: string, userId: string): Promise<OpenVerseSubmission | null> {
  const rows = await db.execute(sql`
    SELECT * FROM open_verse_submissions WHERE post_id = ${postId} AND submitter_user_id = ${userId} LIMIT 1
  `);
  const row = rows.rows[0] as Row | undefined;
  return row ? toSubmission(row) : null;
}

export async function insertOpenVerseSubmission(sub: {
  id: string;
  postId: string;
  submitterUserId: string;
  submitterName: string;
  audioUrl: string;
  lyrics: string | null;
  note: string | null;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO open_verse_submissions
      (id, post_id, submitter_user_id, submitter_name, audio_url, lyrics, note, status)
    VALUES (${sub.id}, ${sub.postId}, ${sub.submitterUserId}, ${sub.submitterName},
      ${sub.audioUrl}, ${sub.lyrics}, ${sub.note}, 'submitted')
  `);
}

export async function saveOpenVersePostStatus(post: OpenVersePost): Promise<void> {
  await db.execute(sql`
    UPDATE open_verse_posts
    SET status = ${post.status},
        winner_submission_id = ${post.winnerSubmissionId},
        winner_user_id = ${post.winnerUserId},
        winner_picked_at = ${post.winnerPickedAt ? new Date(post.winnerPickedAt as string) : null},
        updated_at = now()
    WHERE id = ${post.id}
  `);
}

export async function saveOpenVerseSubmissionStatus(sub: OpenVerseSubmission): Promise<void> {
  await db.execute(sql`
    UPDATE open_verse_submissions SET status = ${sub.status}, updated_at = now() WHERE id = ${sub.id}
  `);
}

/** Persist a winner pick: post + every changed submission + the ONE
 *  split ledger row. The ledger insert is conflict-proof on both of
 *  its unique keys (post_id, idempotency_key): a retried pick after a
 *  crash resolves to the existing row — exactly once, always. Returns
 *  the ledger row id (existing or new). */
export async function persistWinnerPick(
  post: OpenVersePost,
  submissions: OpenVerseSubmission[],
  ledger: OpenVerseLedgerDraft,
): Promise<string | null> {
  await saveOpenVersePostStatus(post);
  for (const s of submissions) await saveOpenVerseSubmissionStatus(s);
  const rows = await db.execute(sql`
    INSERT INTO open_verse_split_ledger
      (post_id, winner_submission_id, owner_user_id, winner_user_id,
       winner_share_pct, split_terms, currency, idempotency_key)
    VALUES (${ledger.postId}, ${ledger.winnerSubmissionId}, ${ledger.ownerUserId}, ${ledger.winnerUserId},
      ${ledger.winnerSharePct}, ${JSON.stringify(ledger.splitTerms)}::jsonb, ${ledger.currency}, ${ledger.idempotencyKey})
    ON CONFLICT (post_id) DO NOTHING
    RETURNING id
  `);
  const inserted = rows.rows[0] as Row | undefined;
  if (inserted) return String(inserted.id);
  const existing = await db.execute(sql`
    SELECT id FROM open_verse_split_ledger WHERE post_id = ${ledger.postId} LIMIT 1
  `);
  const row = existing.rows[0] as Row | undefined;
  return row ? String(row.id) : null;
}

export async function loadLedgerForPost(postId: string): Promise<Row | null> {
  const rows = await db.execute(sql`
    SELECT * FROM open_verse_split_ledger WHERE post_id = ${postId} LIMIT 1
  `);
  return (rows.rows[0] as Row | undefined) ?? null;
}
