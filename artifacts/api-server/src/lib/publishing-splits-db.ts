/* ─── Publishing splits registry — DB-facing helpers ─────────────────────
   Raw-SQL translation between the registry tables and the pure machine
   (lib/publishing-splits.ts), following the splits-overview style in
   routes/money.ts (raw SQL over @workspace/db) and the co-release
   probe/guard discipline:
   - WRITE paths probe first (probePublishingTables): a missing table
     (42P01) becomes the honest 503 PUBLISHING_SPLITS_NOT_READY before
     anything is created or anyone is notified.
   - READ paths are GUARDED where they feed a list: a missing table
     degrades to "no registrations yet" so one un-migrated section can
     never take the Money desk down (resilience law). */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";
import {
  isMissingPublishingTable,
  type PublishingRegistration,
  type PublishingWriter,
  type PublishingWriterStatus,
} from "./publishing-splits";

type Row = Record<string, unknown>;

function toWriter(r: Row): PublishingWriter {
  return {
    id: String(r.id),
    writerName: String(r.writer_name ?? ""),
    writerUserId: (r.writer_user_id as string | null) ?? null,
    writerProfileId: (r.writer_profile_id as string | null) ?? null,
    sharePct: Number(r.share_pct),
    confirmationStatus: String(r.confirmation_status ?? "pending") as PublishingWriterStatus,
    disputeNote: (r.dispute_note as string | null) ?? null,
    confirmedAt: (r.confirmed_at as string | null) ?? null,
    disputedAt: (r.disputed_at as string | null) ?? null,
  };
}

function toRegistration(head: Row, writerRows: Row[]): PublishingRegistration {
  return {
    id: String(head.id),
    ownerUserId: String(head.owner_user_id),
    songKind: head.song_kind === "song" ? "song" : "release",
    songId: String(head.song_id),
    songTitle: String(head.song_title ?? ""),
    hasDispute: head.has_dispute === true,
    createdAt: (head.created_at as string | null) ?? null,
    updatedAt: (head.updated_at as string | null) ?? null,
    writers: writerRows.filter((w) => String(w.registration_id) === String(head.id)).map(toWriter),
  };
}

/** Probe used by WRITE routes BEFORE any row is written. Throws on a
 *  missing table so the route can answer 503 with nothing created. */
export async function probePublishingTables(): Promise<void> {
  await db.execute(sql`SELECT id FROM publishing_split_registrations LIMIT 1`);
  await db.execute(sql`SELECT id FROM publishing_split_writers LIMIT 1`);
}

/** Unguarded single load (write paths + single-record reads). Null =
 *  no such registration. Throws on a missing table. */
export async function loadPublishingRegistration(id: string): Promise<PublishingRegistration | null> {
  const heads = await db.execute(sql`
    SELECT * FROM publishing_split_registrations WHERE id = ${id} LIMIT 1
  `);
  const head = heads.rows[0] as Row | undefined;
  if (!head) return null;
  const writers = await db.execute(sql`
    SELECT * FROM publishing_split_writers
    WHERE registration_id = ${id}
    ORDER BY share_pct DESC, writer_name ASC
  `);
  return toRegistration(head, writers.rows as Row[]);
}

/** Guarded list for /mine: every registration the user owns OR is a
 *  linked writer on. Degrades to { ready: false } on a missing table. */
export async function listPublishingForUser(
  userId: string,
): Promise<{ ready: boolean; registrations: PublishingRegistration[] }> {
  try {
    const heads = await db.execute(sql`
      SELECT DISTINCT r.*
      FROM publishing_split_registrations r
      LEFT JOIN publishing_split_writers w ON w.registration_id = r.id
      WHERE r.owner_user_id = ${userId} OR w.writer_user_id = ${userId}
      ORDER BY r.created_at DESC
      LIMIT 200
    `);
    const headRows = heads.rows as Row[];
    if (headRows.length === 0) return { ready: true, registrations: [] };
    const ids = headRows.map((h) => String(h.id));
    const writers = await db.execute(sql`
      SELECT * FROM publishing_split_writers
      WHERE registration_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      ORDER BY share_pct DESC, writer_name ASC
    `);
    const writerRows = writers.rows as Row[];
    return { ready: true, registrations: headRows.map((h) => toRegistration(h, writerRows)) };
  } catch (err) {
    if (isMissingPublishingTable(err)) {
      logger.debug("[publishing-splits] tables not present yet — serving without registry data");
      return { ready: false, registrations: [] };
    }
    throw err;
  }
}

/** Persist one writer row after a confirm/dispute (the route saves the
 *  machine's output for the acting writer only, plus the head flag). */
export async function saveWriterAction(reg: PublishingRegistration, writer: PublishingWriter): Promise<void> {
  await db.execute(sql`
    UPDATE publishing_split_writers
    SET confirmation_status = ${writer.confirmationStatus},
        dispute_note = ${writer.disputeNote},
        confirmed_at = ${writer.confirmedAt ? new Date(writer.confirmedAt as string) : null},
        disputed_at = ${writer.disputedAt ? new Date(writer.disputedAt as string) : null},
        updated_at = now()
    WHERE id = ${writer.id}
  `);
  await db.execute(sql`
    UPDATE publishing_split_registrations
    SET has_dispute = ${reg.hasDispute}, updated_at = now()
    WHERE id = ${reg.id}
  `);
}
