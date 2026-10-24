import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  applyWriterAction,
  buildSplitSheet,
  deriveRegistrationState,
  initialWriters,
  isMissingPublishingTable,
  isRegistrationParticipant,
  publishingSheetCode,
  reviseWriters,
  validateWriterSplits,
  writerForUser,
  PublishingSplitError,
  PUBLISHING_COLLECTION_STATUS,
  PUBLISHING_COPY,
  PUBLISHING_SPLITS_NOT_READY,
  type PublishingRegistration,
  type WriterInput,
} from "../lib/publishing-splits";
import {
  listPublishingForUser,
  loadPublishingRegistration,
  probePublishingTables,
  saveWriterAction,
} from "../lib/publishing-splits-db";

/* ─── Publishing splits registry (Stack-100 #3 Wave 3, #22) ──────────────
   The SONGWRITER (publishing) splits for a song — who wrote what share
   of the composition. Distinct from the master-side royalty splits on
   a release (distribution_royalty_splits) and from free-form wave8
   split sheets: this registry links writers to on-platform accounts
   and records each linked writer's confirmation or dispute.

   POST   /api/publishing-splits              register MY song with its
                                              writer splits (sum = 100)
   GET    /api/publishing-splits/mine         songs I registered + songs
                                              I'm a writer on, with my
                                              share and every state
   GET    /api/publishing-splits/:id          one registration (owner or
                                              a listed writer only)
   POST   /api/publishing-splits/:id/confirm  confirm MY share
   POST   /api/publishing-splits/:id/dispute  dispute MY share (flags
                                              the record; never rewrites
                                              any share)
   POST   /api/publishing-splits/:id/amend    owner revises the splits
                                              (resets confirmations)
   GET    /api/publishing-splits/:id/sheet    the shareable split sheet

   Money rules (no invented rates/fees/defaults anywhere):
   - Shares are creator-entered percentages, validated server-side to
     sum to 100 (lib/publishing-splits validateWriterSplits).
   - This is a RECORDS layer: it collects nothing and pays nobody.
     Every response carries collectionStatus "not_connected" and the
     notice "Registered — collection activates when publishing
     administration is connected."

   Until the held migration (publishing_split_registrations +
   publishing_split_writers — see .lane/MIGRATION-NEEDED.md) lands,
   writes answer 503 publishing_splits_not_ready BEFORE creating
   anything, and /mine degrades to an honest empty registry. */

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const writerSchema = z.object({
  name: z.string().trim().min(1, "Each songwriter needs a name.").max(120),
  user_id: z.string().uuid().optional().nullable(),
  profile_id: z.string().uuid().optional().nullable(),
  share_pct: z.number(),
});

const createSchema = z.object({
  song_kind: z.enum(["release", "song"]),
  song_id: z.string().uuid(),
  writers: z.array(writerSchema).min(1).max(20),
});

const amendSchema = z.object({
  writers: z.array(writerSchema).min(1).max(20),
});

const disputeSchema = z.object({
  note: z.string().trim().max(500).optional().default(""),
});

function notReady(res: Response) {
  return res.status(503).json({ ...PUBLISHING_SPLITS_NOT_READY });
}

function machineError(res: Response, err: unknown): Response | null {
  if (err instanceof PublishingSplitError) {
    return res.status(400).json({ error: err.code, message: err.message });
  }
  return null;
}

function dto(reg: PublishingRegistration, viewerUserId: string) {
  const mine = writerForUser(reg, viewerUserId);
  return {
    id: reg.id,
    song_kind: reg.songKind,
    song_id: reg.songId,
    song_title: reg.songTitle,
    is_owner: reg.ownerUserId === viewerUserId,
    state: deriveRegistrationState(reg),
    has_dispute: reg.hasDispute,
    collection_status: PUBLISHING_COLLECTION_STATUS,
    collection_notice: PUBLISHING_COPY.collectionNotice,
    my_share_pct: mine ? mine.sharePct : null,
    my_writer_status: mine ? mine.confirmationStatus : null,
    writers: reg.writers.map((w) => ({
      name: w.writerName,
      /* Profile ids are public identifiers (profiles are public pages)
         and ride along so the owner's revise form can re-link the same
         writers. Raw account (user) ids are exposed only to the owner
         (who entered them) and to the writer themselves. */
      profile_id: w.writerProfileId,
      user_id:
        reg.ownerUserId === viewerUserId || (w.writerUserId !== null && w.writerUserId === viewerUserId)
          ? w.writerUserId
          : null,
      is_linked: w.writerUserId !== null,
      is_me: w.writerUserId !== null && w.writerUserId === viewerUserId,
      share_pct: w.sharePct,
      confirmation_status: w.confirmationStatus,
      dispute_note: w.confirmationStatus === "disputed" ? w.disputeNote : null,
      confirmed_at: w.confirmedAt,
      disputed_at: w.disputedAt,
    })),
    created_at: reg.createdAt,
    updated_at: reg.updatedAt,
  };
}

async function notifyUser(userId: string, title: string, body: string) {
  try {
    await db.execute(sql`
      INSERT INTO notifications (id, user_id, kind, title, body, link)
      VALUES (${randomUUID()}, ${userId}, 'publishing_split', ${title}, ${body}, '/coach?tab=money')
    `);
  } catch {
    /* best-effort — never break the write path over a notification */
  }
}

/** Resolve writer inputs: a supplied profile_id resolves to its account
 *  (and vice versa) so a writer is linked by account either way. An id
 *  that names nobody is a 400 — never silently downgrade to unlinked. */
async function resolveWriters(
  raw: Array<{ name: string; user_id?: string | null; profile_id?: string | null; share_pct: number }>,
): Promise<WriterInput[] | { error: string }> {
  const out: WriterInput[] = [];
  for (const w of raw) {
    let userId = w.user_id ?? null;
    let profileId = w.profile_id ?? null;
    if (profileId && !userId) {
      const rows = await db.execute(sql`
        SELECT user_id FROM creator_profiles WHERE id = ${profileId} LIMIT 1
      `);
      const row = rows.rows[0] as { user_id: string } | undefined;
      if (!row) return { error: `No creator profile found for songwriter "${w.name}".` };
      userId = row.user_id;
    } else if (userId && !profileId) {
      /* Creator profiles are the platform's creator-account index: a
         user id with no profile can't be verified as an account here,
         so refuse rather than link a ghost. */
      const rows = await db.execute(sql`
        SELECT id FROM creator_profiles WHERE user_id = ${userId} LIMIT 1
      `);
      const row = rows.rows[0] as { id: string } | undefined;
      if (!row) {
        return { error: `No creator account found for songwriter "${w.name}" — link writers by their creator profile, or list them by name only.` };
      }
      profileId = row.id;
    }
    out.push({ name: w.name, userId, profileId, sharePct: w.share_pct });
  }
  return out;
}

/** The song must be the CALLER's — a release or a library song they own. */
async function ownedSongTitle(
  userId: string,
  kind: "release" | "song",
  songId: string,
): Promise<string | null> {
  if (kind === "release") {
    const rows = await db.execute(sql`
      SELECT title FROM distribution_releases WHERE id = ${songId} AND user_id = ${userId} LIMIT 1
    `);
    const row = rows.rows[0] as { title: string } | undefined;
    return row ? row.title : null;
  }
  const rows = await db.execute(sql`
    SELECT title FROM songs WHERE id = ${songId} AND user_id = ${userId} LIMIT 1
  `);
  const row = rows.rows[0] as { title: string } | undefined;
  return row ? row.title : null;
}

async function insertRegistration(
  ownerUserId: string,
  kind: "release" | "song",
  songId: string,
  songTitle: string,
  writers: ReturnType<typeof initialWriters>,
): Promise<string> {
  const id = randomUUID();
  await db.execute(sql`
    INSERT INTO publishing_split_registrations (id, owner_user_id, song_kind, song_id, song_title, has_dispute)
    VALUES (${id}, ${ownerUserId}, ${kind}, ${songId}, ${songTitle}, false)
  `);
  for (const w of writers) {
    await db.execute(sql`
      INSERT INTO publishing_split_writers
        (id, registration_id, writer_name, writer_user_id, writer_profile_id,
         share_pct, confirmation_status, dispute_note, confirmed_at, disputed_at)
      VALUES (${randomUUID()}, ${id}, ${w.writerName}, ${w.writerUserId}, ${w.writerProfileId},
        ${w.sharePct}, ${w.confirmationStatus}, ${w.disputeNote},
        ${w.confirmedAt ? new Date(w.confirmedAt as string) : null},
        ${w.disputedAt ? new Date(w.disputedAt as string) : null})
    `);
  }
  return id;
}

/* POST /api/publishing-splits — register my song + its writer splits */
router.post("/publishing-splits", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }
  const d = parsed.data;
  try {
    validateWriterSplits(d.writers.map((w) => ({ name: w.name, userId: w.user_id, profileId: w.profile_id, sharePct: w.share_pct })));
  } catch (err) {
    const r = machineError(res, err);
    if (r) return r;
    throw err;
  }
  try {
    await probePublishingTables();
  } catch (err) {
    if (isMissingPublishingTable(err)) return notReady(res);
    throw err;
  }
  try {
    const title = await ownedSongTitle(req.userId!, d.song_kind, d.song_id);
    if (title === null) {
      return res.status(404).json({
        error: "song_not_found",
        message: "That song isn't yours (or doesn't exist) — you can only register splits for your own songs.",
      });
    }
    const resolved = await resolveWriters(d.writers);
    if (!Array.isArray(resolved)) {
      return res.status(400).json({ error: "writer_not_found", message: resolved.error });
    }
    const writers = initialWriters(req.userId!, resolved);
    const id = await insertRegistration(req.userId!, d.song_kind, d.song_id, title, writers);
    const reg = await loadPublishingRegistration(id);
    if (!reg) return res.status(500).json({ error: "Could not load the registration — try again." });
    for (const w of writers) {
      if (w.writerUserId && w.writerUserId !== req.userId) {
        await notifyUser(
          w.writerUserId,
          "You're listed as a songwriter",
          `"${title}" was registered with you as a songwriter at ${w.sharePct}%. Confirm or dispute your share in Money → Splits. ${PUBLISHING_COPY.collectionNotice}`,
        );
      }
    }
    return res.status(201).json({
      registration: dto(reg, req.userId!),
      collection_status: PUBLISHING_COLLECTION_STATUS,
      collection_notice: PUBLISHING_COPY.collectionNotice,
    });
  } catch (err) {
    if (isMissingPublishingTable(err)) return notReady(res);
    const r = machineError(res, err);
    if (r) return r;
    logger.error({ err }, "[publishing-splits] register failed");
    return res.status(500).json({ error: "Could not register the splits — try again." });
  }
});

/* GET /api/publishing-splits/mine — registered by me + written on by me.
   Guarded: pre-migration this is an honest empty registry, never a 500. */
router.get("/publishing-splits/mine", requireAuth, async (req: Request, res: Response) => {
  try {
    const { ready, registrations } = await listPublishingForUser(req.userId!);
    return res.json({
      registrations: registrations.map((r) => dto(r, req.userId!)),
      registry_ready: ready,
      collection_status: PUBLISHING_COLLECTION_STATUS,
      collection_notice: PUBLISHING_COPY.collectionNotice,
      registry_note: PUBLISHING_COPY.registryOnly,
    });
  } catch (err) {
    logger.error({ err }, "[publishing-splits] mine failed");
    return res.status(500).json({ error: "Could not load your publishing splits." });
  }
});

/* GET /api/publishing-splits/:id — participants only (404 otherwise,
   so a registration's existence never leaks to non-participants). */
router.get("/publishing-splits/:id", requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Registration not found." });
  try {
    const reg = await loadPublishingRegistration(id);
    if (!reg || !isRegistrationParticipant(reg, req.userId!)) {
      return res.status(404).json({ error: "Registration not found." });
    }
    return res.json({
      registration: dto(reg, req.userId!),
      collection_status: PUBLISHING_COLLECTION_STATUS,
      collection_notice: PUBLISHING_COPY.collectionNotice,
    });
  } catch (err) {
    if (isMissingPublishingTable(err)) return notReady(res);
    logger.error({ err }, "[publishing-splits] get failed");
    return res.status(500).json({ error: "Could not load the registration." });
  }
});

/* POST /api/publishing-splits/:id/confirm + /dispute — MY writer row only */
async function writerAction(req: Request, res: Response, action: "confirm" | "dispute") {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Registration not found." });
  let note = "";
  if (action === "dispute") {
    const parsed = disputeSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid", message: "Dispute note is too long." });
    note = parsed.data.note;
  }
  try {
    await probePublishingTables();
  } catch (err) {
    if (isMissingPublishingTable(err)) return notReady(res);
    throw err;
  }
  try {
    const reg = await loadPublishingRegistration(id);
    if (!reg || !writerForUser(reg, req.userId!)) {
      return res.status(404).json({ error: "Registration not found." });
    }
    const next = applyWriterAction(reg, req.userId!, action, { note });
    const updated = writerForUser(next, req.userId!)!;
    await saveWriterAction(next, { ...updated, id: writerForUser(reg, req.userId!)!.id });
    const saved = await loadPublishingRegistration(id);
    if (reg.ownerUserId !== req.userId) {
      await notifyUser(
        reg.ownerUserId,
        action === "confirm" ? "A songwriter confirmed their share" : "A songwriter disputed their share",
        `On "${reg.songTitle}", a writer ${action === "confirm" ? "confirmed" : "disputed"} their publishing share. ${action === "dispute" ? PUBLISHING_COPY.disputeRule : ""}`,
      );
    }
    return res.json({
      registration: dto(saved ?? next, req.userId!),
      collection_status: PUBLISHING_COLLECTION_STATUS,
      collection_notice: PUBLISHING_COPY.collectionNotice,
    });
  } catch (err) {
    if (isMissingPublishingTable(err)) return notReady(res);
    const r = machineError(res, err);
    if (r) return r;
    logger.error({ err }, `[publishing-splits] ${action} failed`);
    return res.status(500).json({ error: `Could not ${action} the share — try again.` });
  }
}
router.post("/publishing-splits/:id/confirm", publicApiLimiter, requireAuth, (req, res) => writerAction(req, res, "confirm"));
router.post("/publishing-splits/:id/dispute", publicApiLimiter, requireAuth, (req, res) => writerAction(req, res, "dispute"));

/* POST /api/publishing-splits/:id/amend — owner revises the whole split.
   Re-validates the sum; confirmations reset (fresh consent for new
   shares) and the dispute flag clears. Non-owners get a 404. */
router.post("/publishing-splits/:id/amend", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Registration not found." });
  const parsed = amendSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }
  try {
    await probePublishingTables();
  } catch (err) {
    if (isMissingPublishingTable(err)) return notReady(res);
    throw err;
  }
  try {
    const reg = await loadPublishingRegistration(id);
    if (!reg || reg.ownerUserId !== req.userId) {
      return res.status(404).json({ error: "Registration not found." });
    }
    const resolved = await resolveWriters(parsed.data.writers);
    if (!Array.isArray(resolved)) {
      return res.status(400).json({ error: "writer_not_found", message: resolved.error });
    }
    const next = reviseWriters(reg, req.userId!, resolved);
    await db.execute(sql`DELETE FROM publishing_split_writers WHERE registration_id = ${id}`);
    for (const w of next.writers) {
      await db.execute(sql`
        INSERT INTO publishing_split_writers
          (id, registration_id, writer_name, writer_user_id, writer_profile_id,
           share_pct, confirmation_status, dispute_note, confirmed_at, disputed_at)
        VALUES (${randomUUID()}, ${id}, ${w.writerName}, ${w.writerUserId}, ${w.writerProfileId},
          ${w.sharePct}, ${w.confirmationStatus}, ${w.disputeNote},
          ${w.confirmedAt ? new Date(w.confirmedAt as string) : null}, NULL)
      `);
    }
    await db.execute(sql`
      UPDATE publishing_split_registrations SET has_dispute = false, updated_at = now() WHERE id = ${id}
    `);
    const saved = await loadPublishingRegistration(id);
    return res.json({
      registration: dto(saved ?? next, req.userId!),
      collection_status: PUBLISHING_COLLECTION_STATUS,
      collection_notice: PUBLISHING_COPY.collectionNotice,
    });
  } catch (err) {
    if (isMissingPublishingTable(err)) return notReady(res);
    const r = machineError(res, err);
    if (r) return r;
    logger.error({ err }, "[publishing-splits] amend failed");
    return res.status(500).json({ error: "Could not revise the splits — try again." });
  }
});

/* GET /api/publishing-splits/:id/sheet — the shareable split sheet.
   The record in plain text (paste it anywhere, save it as a file),
   always closing with the collection notice. Participants only. */
router.get("/publishing-splits/:id/sheet", requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Registration not found." });
  try {
    const reg = await loadPublishingRegistration(id);
    if (!reg || !isRegistrationParticipant(reg, req.userId!)) {
      return res.status(404).json({ error: "Registration not found." });
    }
    return res.json({
      sheet_code: publishingSheetCode(reg.id),
      song_title: reg.songTitle,
      sheet_text: buildSplitSheet(reg),
      collection_status: PUBLISHING_COLLECTION_STATUS,
      collection_notice: PUBLISHING_COPY.collectionNotice,
    });
  } catch (err) {
    if (isMissingPublishingTable(err)) return notReady(res);
    logger.error({ err }, "[publishing-splits] sheet failed");
    return res.status(500).json({ error: "Could not build the split sheet." });
  }
});

export default router;
