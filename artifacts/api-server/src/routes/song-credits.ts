import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  buildCreditsSheet,
  isMissingSongCreditTable,
  publicCreditsDto,
  validateCreditEntries,
  validateWriterSplits,
  PublishingSplitError,
  SongCreditError,
  SONG_CREDIT_ROLES,
  SONG_CREDITS_COPY,
  SONG_CREDITS_NOT_READY,
  type SongCreditKind,
} from "../lib/song-credits";
import {
  loadCanonicalCredits,
  loadCreditRevisions,
  probeSongCreditTables,
  resolveCreditLink,
  saveCanonicalCredits,
} from "../lib/song-credits-db";
import { isMissingPublishingTable } from "../lib/publishing-splits";

/* ─── Song credits that travel with the song (Stack-200 N1) ─────────────
   The canonical credits layer's HTTP face. ONE read + ONE write for a
   song's full credits, anchored exactly like the publishing registry
   (song_kind 'song' → songs.id, 'release' → distribution_releases.id):

   GET  /api/song-credits/:kind/:id           PUBLIC — the credits every
                                              play/share/profile surface
                                              renders; tappable profile
                                              links included, account
                                              ids never exposed.
   GET  /api/song-credits/:kind/:id/sheet     PUBLIC — the same credits
                                              as a plain-text sheet for
                                              exports/shares.
   PUT  /api/song-credits/:kind/:id           OWNER — one save for the
                                              whole credits picture:
                                              entries (producers,
                                              features, samples…) are
                                              stored on the song;
                                              writers (when sent) are
                                              validated by the EXISTING
                                              validateWriterSplits and
                                              written into the EXISTING
                                              publishing registry.
                                              Every save appends an
                                              audit revision.
   GET  /api/song-credits/:kind/:id/history   OWNER — the audit trail.

   Master royalty splits and co-release agreed splits are READ here
   (they travel with the song) but keep their own write doors — this
   layer never rewrites a versioned or consented agreement.

   Pre-migration honesty: writes probe first and answer 503
   song_credits_not_ready with nothing created; reads degrade to the
   splits rails alone (entries contribute nothing yet). */

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const entrySchema = z.object({
  role: z.enum(SONG_CREDIT_ROLES),
  name: z.string().trim().min(1).max(120),
  user_id: z.string().uuid().optional().nullable(),
  profile_id: z.string().uuid().optional().nullable(),
  detail: z.string().trim().max(300).optional().nullable(),
});

const writerSchema = z.object({
  name: z.string().trim().min(1, "Each songwriter needs a name.").max(120),
  user_id: z.string().uuid().optional().nullable(),
  profile_id: z.string().uuid().optional().nullable(),
  share_pct: z.number(),
});

const saveSchema = z.object({
  entries: z.array(entrySchema).max(40).optional(),
  writers: z.array(writerSchema).min(1).max(20).optional(),
});

function parseAnchor(req: Request): { kind: SongCreditKind; id: string } | null {
  const kind = String(req.params.kind ?? "");
  const id = String(req.params.id ?? "");
  if ((kind !== "song" && kind !== "release") || !UUID_RE.test(id)) return null;
  return { kind, id };
}

function notReady(res: Response) {
  return res.status(503).json({ ...SONG_CREDITS_NOT_READY });
}

/** Ownership is resolved against the anchor table itself — a song or
 *  release that isn't the caller's is a 404, exactly like the
 *  publishing registry, so existence never leaks. */
async function ownedAnchorTitle(userId: string, kind: SongCreditKind, id: string): Promise<string | null> {
  const table = kind === "release" ? "distribution_releases" : "songs";
  const rows = await db.execute(sql`
    SELECT title FROM ${sql.raw(table)} WHERE id = ${id} AND user_id = ${userId} LIMIT 1
  `);
  const row = rows.rows[0] as { title: string } | undefined;
  return row ? row.title : null;
}

/* GET /api/song-credits/:kind/:id — public canonical read */
router.get("/song-credits/:kind/:id", async (req: Request, res: Response) => {
  const anchor = parseAnchor(req);
  if (!anchor) return res.status(404).json({ error: "Song not found." });
  try {
    const credits = await loadCanonicalCredits(anchor.kind, anchor.id);
    if (!credits) return res.status(404).json({ error: "Song not found." });
    return res.json({
      credits: publicCreditsDto(credits),
      sheet_text: buildCreditsSheet(credits),
    });
  } catch (err) {
    logger.error({ err }, "[song-credits] read failed");
    return res.status(500).json({ error: "Could not load this song's credits." });
  }
});

/* GET /api/song-credits/:kind/:id/sheet — plain-text export sheet */
router.get("/song-credits/:kind/:id/sheet", async (req: Request, res: Response) => {
  const anchor = parseAnchor(req);
  if (!anchor) return res.status(404).json({ error: "Song not found." });
  try {
    const credits = await loadCanonicalCredits(anchor.kind, anchor.id);
    if (!credits) return res.status(404).json({ error: "Song not found." });
    return res.json({
      song_title: credits.songTitle,
      version: credits.version,
      sheet_text: buildCreditsSheet(credits),
    });
  } catch (err) {
    logger.error({ err }, "[song-credits] sheet failed");
    return res.status(500).json({ error: "Could not build the credits sheet." });
  }
});

/* PUT /api/song-credits/:kind/:id — owner-only canonical write */
router.put("/song-credits/:kind/:id", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  const anchor = parseAnchor(req);
  if (!anchor) return res.status(404).json({ error: "Song not found." });
  const parsed = saveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }
  const { entries, writers } = parsed.data;
  if (entries === undefined && writers === undefined) {
    return res.status(400).json({
      error: "nothing_to_save",
      message: "Send entries, writers, or both — an empty save changes nothing and records nothing.",
    });
  }
  /* Validate BEFORE probing/writing: split sums go through the existing
     validator, entries through the canonical entry validator. */
  try {
    if (entries) {
      validateCreditEntries(entries.map((e) => ({ role: e.role, name: e.name, userId: e.user_id, profileId: e.profile_id, detail: e.detail })));
    }
    if (writers) {
      validateWriterSplits(writers.map((w) => ({ name: w.name, userId: w.user_id, profileId: w.profile_id, sharePct: w.share_pct })));
    }
  } catch (err) {
    if (err instanceof PublishingSplitError || err instanceof SongCreditError) {
      return res.status(400).json({ error: err.code, message: err.message });
    }
    throw err;
  }
  try {
    await probeSongCreditTables();
  } catch (err) {
    if (isMissingSongCreditTable(err)) return notReady(res);
    throw err;
  }
  try {
    const title = await ownedAnchorTitle(req.userId!, anchor.kind, anchor.id);
    if (title === null) return res.status(404).json({ error: "Song not found." });

    let resolvedEntries: Array<{ role: (typeof SONG_CREDIT_ROLES)[number]; displayName: string; creditUserId: string | null; creditProfileId: string | null; detail: string | null; sortOrder: number }> | undefined;
    if (entries) {
      resolvedEntries = [];
      for (const [i, e] of entries.entries()) {
        const link = await resolveCreditLink({ name: e.name, userId: e.user_id, profileId: e.profile_id });
        if ("error" in link) return res.status(400).json({ error: "credit_not_found", message: link.error });
        resolvedEntries.push({
          role: e.role,
          displayName: e.name,
          creditUserId: link.userId,
          creditProfileId: link.profileId,
          detail: e.detail ?? null,
          sortOrder: i,
        });
      }
    }
    let resolvedWriters: Array<{ name: string; userId?: string | null; profileId?: string | null; sharePct: number }> | undefined;
    if (writers) {
      resolvedWriters = [];
      for (const w of writers) {
        const link = await resolveCreditLink({ name: w.name, userId: w.user_id, profileId: w.profile_id });
        if ("error" in link) return res.status(400).json({ error: "writer_not_found", message: link.error });
        resolvedWriters.push({ name: w.name, userId: link.userId, profileId: link.profileId, sharePct: w.share_pct });
      }
    }

    const saved = await saveCanonicalCredits({
      ownerUserId: req.userId!,
      anchor,
      songTitle: title,
      entries: resolvedEntries ? resolvedEntries.map((e) => ({ id: null, ...e })) : undefined,
      writers: resolvedWriters,
    });
    return res.json({
      credits: publicCreditsDto(saved.credits),
      version: saved.version,
      sheet_text: buildCreditsSheet(saved.credits),
    });
  } catch (err) {
    if (isMissingSongCreditTable(err) || isMissingPublishingTable(err)) return notReady(res);
    if (err instanceof PublishingSplitError || err instanceof SongCreditError) {
      return res.status(400).json({ error: err.code, message: err.message });
    }
    logger.error({ err }, "[song-credits] save failed");
    return res.status(500).json({ error: "Could not save this song's credits — try again." });
  }
});

/* GET /api/song-credits/:kind/:id/history — owner-only audit trail */
router.get("/song-credits/:kind/:id/history", requireAuth, async (req: Request, res: Response) => {
  const anchor = parseAnchor(req);
  if (!anchor) return res.status(404).json({ error: "Song not found." });
  try {
    const title = await ownedAnchorTitle(req.userId!, anchor.kind, anchor.id);
    if (title === null) return res.status(404).json({ error: "Song not found." });
    const revisions = await loadCreditRevisions(anchor);
    return res.json({ revisions, follows_song: SONG_CREDITS_COPY.followsSong });
  } catch (err) {
    if (isMissingSongCreditTable(err)) {
      return res.json({ revisions: [], follows_song: SONG_CREDITS_COPY.followsSong });
    }
    logger.error({ err }, "[song-credits] history failed");
    return res.status(500).json({ error: "Could not load the credits history." });
  }
});

export default router;
