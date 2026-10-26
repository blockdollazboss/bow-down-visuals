import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  assertCanSubmit,
  buildPostTerms,
  cancelPost,
  closePost,
  derivePostState,
  isMissingOpenVerseTable,
  pickWinner,
  viewerActions,
  withdrawSubmission,
  OpenVerseError,
  OPEN_VERSE_COPY,
  OPEN_VERSE_CURRENCY,
  OPEN_VERSE_NOT_READY,
  type OpenVersePost,
  type OpenVerseSubmission,
} from "../lib/open-verse";
import {
  countOpenVerseSubmissions,
  findSubmissionByUser,
  insertOpenVersePost,
  insertOpenVerseSubmission,
  listOpenVerseForUser,
  listOpenVersePosts,
  loadLedgerForPost,
  loadOpenVerseDetail,
  persistWinnerPick,
  probeOpenVerseTables,
  saveOpenVersePostStatus,
  saveOpenVerseSubmissionStatus,
} from "../lib/open-verse-db";
import { isUniqueViolation } from "../lib/pg-errors";

/* ─── Open Verse (Stack-200 Wave 2, idea #176) ───────────────────────────
   A song posted with an open verse slot. Creators submit verses in-app;
   the song's creator picks the winner; the winner's verse goes onto
   the track under split terms shown UP FRONT.

   POST   /api/open-verse                    post MY song with an open
                                             verse slot + split terms
   GET    /api/open-verse/open               posts still taking verses
   GET    /api/open-verse/mine               my posts + my submissions
   GET    /api/open-verse/:id                one post + its verses
                                             (verses: owner sees all,
                                             everyone else sees the
                                             winner + their own)
   POST   /api/open-verse/:id/submit         submit MY verse (free)
   POST   /api/open-verse/:id/close          owner closes submissions
   POST   /api/open-verse/:id/cancel         owner cancels the post
   POST   /api/open-verse/:id/pick-winner    owner picks the winner —
                                             writes the split ledger
                                             row EXACTLY ONCE
   POST   /api/open-verse/:id/withdraw       withdraw MY verse

   Split terms reuse the existing splits rail: buildPostTerms →
   buildSplitTerms → validateWriterSplits (publishing-splits lib) —
   sum = 100, creator-entered winner share, no invented rates, and the
   terms are frozen on the post before the first submission exists.
   Money: TEST MODE, Visual Bucs only, never cash; posting and
   submitting are free; the ledger records percentage terms only.
   Creator approval gates every step — nothing auto-picks or
   auto-posts a winner.

   Until the provisional migration (9999-open-verse.sql) lands, writes
   answer 503 open_verse_not_ready BEFORE creating anything, and reads
   degrade to an honest empty list. */

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createSchema = z.object({
  song_kind: z.enum(["release", "song"]),
  song_id: z.string().uuid(),
  brief: z.string().max(2000).optional().default(""),
  slot_label: z.string().max(200).optional().default(""),
  winner_share_pct: z.number(),
  closes_at: z.string().datetime().optional().nullable(),
});

const submitSchema = z.object({
  audio_url: z.string().trim().min(1).max(2000),
  lyrics: z.string().max(10000).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});

const pickSchema = z.object({
  submission_id: z.string().uuid(),
});

function notReady(res: Response) {
  return res.status(503).json({ ...OPEN_VERSE_NOT_READY });
}

function machineError(res: Response, err: unknown): Response | null {
  if (err instanceof OpenVerseError) {
    return res.status(400).json({ error: err.code, message: err.message });
  }
  return null;
}

function postDto(
  post: OpenVersePost,
  viewerUserId: string,
  opts: { submissionCount?: number; mySubmission?: OpenVerseSubmission | null } = {},
) {
  return {
    id: post.id,
    song_kind: post.songKind,
    song_id: post.songId,
    song_title: post.songTitle,
    brief: post.brief,
    slot_label: post.slotLabel,
    /* The up-front split terms — shown BEFORE anyone submits. */
    split_terms: post.splitTerms,
    winner_share_pct: post.winnerSharePct,
    currency: OPEN_VERSE_CURRENCY,
    money_note: OPEN_VERSE_COPY.moneyNote,
    terms_note: OPEN_VERSE_COPY.termsUpFront,
    status: post.status,
    state: derivePostState(post),
    closes_at: post.closesAt,
    is_owner: post.ownerUserId === viewerUserId,
    submission_count: opts.submissionCount ?? null,
    my_submission_id: opts.mySubmission ? opts.mySubmission.id : null,
    my_submission_status: opts.mySubmission ? opts.mySubmission.status : null,
    winner_submission_id: post.winnerSubmissionId,
    winner_user_id: post.winnerUserId,
    is_winner: post.winnerUserId !== null && post.winnerUserId === viewerUserId,
    winner_picked_at: post.winnerPickedAt,
    viewer_actions: viewerActions(post, viewerUserId, opts.mySubmission ?? null),
    created_at: post.createdAt,
    updated_at: post.updatedAt,
  };
}

function submissionDto(s: OpenVerseSubmission, viewerUserId: string) {
  return {
    id: s.id,
    post_id: s.postId,
    submitter_name: s.submitterName,
    is_mine: s.submitterUserId === viewerUserId,
    audio_url: s.audioUrl,
    lyrics: s.lyrics,
    note: s.note,
    status: s.status,
    created_at: s.createdAt,
  };
}

async function notifyUser(userId: string, title: string, body: string) {
  try {
    await db.execute(sql`
      INSERT INTO notifications (id, user_id, kind, title, body, link)
      VALUES (${randomUUID()}, ${userId}, 'open_verse', ${title}, ${body}, '/songs')
    `);
  } catch {
    /* best-effort — never break the write path over a notification */
  }
}

/** The song must be the CALLER's — a release or a library song they own
 *  (same ownership rule as the publishing-splits registry). */
async function ownedSongTitle(
  userId: string,
  kind: "release" | "song",
  songId: string,
): Promise<string | null> {
  const rows =
    kind === "release"
      ? await db.execute(sql`SELECT title FROM distribution_releases WHERE id = ${songId} AND user_id = ${userId} LIMIT 1`)
      : await db.execute(sql`SELECT title FROM songs WHERE id = ${songId} AND user_id = ${userId} LIMIT 1`);
  const row = rows.rows[0] as { title: string } | undefined;
  return row ? row.title : null;
}

async function submitterDisplayName(userId: string): Promise<string> {
  try {
    const rows = await db.execute(sql`
      SELECT display_name FROM creator_profiles WHERE user_id = ${userId} LIMIT 1
    `);
    const row = rows.rows[0] as { display_name: string } | undefined;
    return row?.display_name?.trim() ? row.display_name : "Creator";
  } catch {
    return "Creator";
  }
}

async function requirePost(req: Request, res: Response): Promise<{ post: OpenVersePost; submissions: OpenVerseSubmission[] } | null> {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(404).json({ error: "Open verse not found." });
    return null;
  }
  const detail = await loadOpenVerseDetail(id);
  if (!detail) {
    res.status(404).json({ error: "Open verse not found." });
    return null;
  }
  return detail;
}

/* POST /api/open-verse — post my song with an open verse slot */
router.post("/open-verse", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }
  const d = parsed.data;
  let terms;
  try {
    terms = buildPostTerms({
      brief: d.brief,
      slotLabel: d.slot_label,
      winnerSharePct: d.winner_share_pct,
      closesAt: d.closes_at ? new Date(d.closes_at) : null,
    });
  } catch (err) {
    const r = machineError(res, err);
    if (r) return r;
    throw err;
  }
  try {
    await probeOpenVerseTables();
  } catch (err) {
    if (isMissingOpenVerseTable(err)) return notReady(res);
    throw err;
  }
  try {
    const title = await ownedSongTitle(req.userId!, d.song_kind, d.song_id);
    if (title === null) {
      return res.status(404).json({
        error: "song_not_found",
        message: "That song isn't yours (or doesn't exist) — you can only open a verse on your own songs.",
      });
    }
    const id = randomUUID();
    try {
      await insertOpenVersePost({
        id,
        ownerUserId: req.userId!,
        songKind: d.song_kind,
        songId: d.song_id,
        songTitle: title,
        brief: terms.brief,
        slotLabel: terms.slotLabel,
        splitTerms: terms.splitTerms,
        winnerSharePct: terms.winnerSharePct,
        closesAt: terms.closesAt,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({
          error: "already_open",
          message: "That song already has a live open verse — close or finish it before opening another.",
        });
      }
      throw err;
    }
    const detail = await loadOpenVerseDetail(id);
    if (!detail) return res.status(500).json({ error: "Could not load the open verse — try again." });
    return res.status(201).json({ post: postDto(detail.post, req.userId!, { submissionCount: 0 }) });
  } catch (err) {
    if (isMissingOpenVerseTable(err)) return notReady(res);
    logger.error({ err }, "[open-verse] create failed");
    return res.status(500).json({ error: "Could not post the open verse — try again." });
  }
});

/* GET /api/open-verse/open — posts still taking verses (guarded) */
router.get("/open-verse/open", requireAuth, async (req: Request, res: Response) => {
  try {
    const { ready, posts } = await listOpenVersePosts();
    const counts = ready ? await countOpenVerseSubmissions(posts.map((p) => p.id)).catch(() => new Map<string, number>()) : new Map<string, number>();
    return res.json({
      posts: posts.map((p) => postDto(p, req.userId!, { submissionCount: counts.get(p.id) ?? 0 })),
      open_verse_ready: ready,
      money_note: OPEN_VERSE_COPY.moneyNote,
      creator_gate: OPEN_VERSE_COPY.creatorGate,
    });
  } catch (err) {
    logger.error({ err }, "[open-verse] open list failed");
    return res.status(500).json({ error: "Could not load open verses." });
  }
});

/* GET /api/open-verse/mine — my posts + posts I submitted to (guarded) */
router.get("/open-verse/mine", requireAuth, async (req: Request, res: Response) => {
  try {
    const { ready, posts, mySubmissions } = await listOpenVerseForUser(req.userId!);
    const byPost = new Map(mySubmissions.map((s) => [s.postId, s]));
    return res.json({
      posts: posts.map((p) => postDto(p, req.userId!, { mySubmission: byPost.get(p.id) ?? null })),
      my_submissions: mySubmissions.map((s) => submissionDto(s, req.userId!)),
      open_verse_ready: ready,
      money_note: OPEN_VERSE_COPY.moneyNote,
    });
  } catch (err) {
    logger.error({ err }, "[open-verse] mine failed");
    return res.status(500).json({ error: "Could not load your open verses." });
  }
});

/* GET /api/open-verse/:id — one post; verses visible to the owner (all),
   to a submitter (their own), and the winner (public outcome). Lyrics
   and audio of non-winning verses never leak to other submitters. */
router.get("/open-verse/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const detail = await requirePost(req, res);
    if (!detail) return;
    const { post, submissions } = detail;
    const isOwner = post.ownerUserId === req.userId!;
    const visible = submissions.filter(
      (s) => isOwner || s.submitterUserId === req.userId! || s.status === "winner",
    );
    const mine = submissions.find((s) => s.submitterUserId === req.userId!) ?? null;
    const ledger = post.status === "winner_picked" ? await loadLedgerForPost(post.id).catch(() => null) : null;
    return res.json({
      post: postDto(post, req.userId!, {
        submissionCount: submissions.filter((s) => s.status !== "withdrawn").length,
        mySubmission: mine,
      }),
      submissions: visible.map((s) => submissionDto(s, req.userId!)),
      split_ledger: ledger
        ? {
            id: String(ledger.id),
            winner_share_pct: Number(ledger.winner_share_pct),
            split_terms: ledger.split_terms,
            currency: String(ledger.currency ?? OPEN_VERSE_CURRENCY),
            idempotency_key: String(ledger.idempotency_key),
            created_at: ledger.created_at ?? null,
          }
        : null,
      winner_note: post.status === "winner_picked" ? OPEN_VERSE_COPY.winnerApplied : null,
    });
  } catch (err) {
    if (isMissingOpenVerseTable(err)) return notReady(res);
    logger.error({ err }, "[open-verse] get failed");
    return res.status(500).json({ error: "Could not load the open verse." });
  }
});

/* POST /api/open-verse/:id/submit — submit my verse (free, in-app) */
router.post("/open-verse/:id/submit", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  const parsed = submitSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }
  try {
    await probeOpenVerseTables();
  } catch (err) {
    if (isMissingOpenVerseTable(err)) return notReady(res);
    throw err;
  }
  try {
    const detail = await requirePost(req, res);
    if (!detail) return;
    const { post } = detail;
    let cleaned;
    try {
      cleaned = assertCanSubmit(post, req.userId!, {
        audioUrl: parsed.data.audio_url,
        lyrics: parsed.data.lyrics,
        note: parsed.data.note,
      });
    } catch (err) {
      const r = machineError(res, err);
      if (r) return r;
      throw err;
    }
    const existing = await findSubmissionByUser(post.id, req.userId!);
    if (existing && existing.status !== "withdrawn") {
      return res.status(409).json({
        error: "already_submitted",
        message: "You've already submitted a verse to this song — withdraw it before submitting a new one.",
      });
    }
    const name = await submitterDisplayName(req.userId!);
    if (existing) {
      /* A withdrawn verse can be replaced: revive the same row so the
         one-submission-per-creator rule still holds exactly. */
      await db.execute(sql`
        UPDATE open_verse_submissions
        SET audio_url = ${cleaned.audioUrl}, lyrics = ${cleaned.lyrics}, note = ${cleaned.note},
            submitter_name = ${name}, status = 'submitted', updated_at = now()
        WHERE id = ${existing.id}
      `);
    } else {
      await insertOpenVerseSubmission({
        id: randomUUID(),
        postId: post.id,
        submitterUserId: req.userId!,
        submitterName: name,
        audioUrl: cleaned.audioUrl,
        lyrics: cleaned.lyrics,
        note: cleaned.note,
      });
    }
    await notifyUser(
      post.ownerUserId,
      "A verse was submitted to your open verse",
      `"${post.songTitle}" got a new verse submission. Split terms were shown up front: the winning verse earns ${post.winnerSharePct}% (Visual Bucs, test mode). Only you can pick the winner.`,
    );
    const saved = await loadOpenVerseDetail(post.id);
    const mine = saved?.submissions.find((s) => s.submitterUserId === req.userId!) ?? null;
    return res.status(201).json({
      submission: mine ? submissionDto(mine, req.userId!) : null,
      split_terms: post.splitTerms,
      winner_share_pct: post.winnerSharePct,
    });
  } catch (err) {
    if (isMissingOpenVerseTable(err)) return notReady(res);
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: "already_submitted", message: "You've already submitted a verse to this song." });
    }
    const r = machineError(res, err);
    if (r) return r;
    logger.error({ err }, "[open-verse] submit failed");
    return res.status(500).json({ error: "Could not submit your verse — try again." });
  }
});

/* POST /api/open-verse/:id/close + /cancel — owner only */
async function ownerPostAction(req: Request, res: Response, action: "close" | "cancel") {
  try {
    await probeOpenVerseTables();
  } catch (err) {
    if (isMissingOpenVerseTable(err)) return notReady(res);
    throw err;
  }
  try {
    const detail = await requirePost(req, res);
    if (!detail) return;
    let next;
    try {
      next = action === "close" ? closePost(detail.post, req.userId!) : cancelPost(detail.post, req.userId!);
    } catch (err) {
      const r = machineError(res, err);
      if (r) return r;
      throw err;
    }
    await saveOpenVersePostStatus(next);
    return res.json({ post: postDto(next, req.userId!) });
  } catch (err) {
    if (isMissingOpenVerseTable(err)) return notReady(res);
    logger.error({ err }, `[open-verse] ${action} failed`);
    return res.status(500).json({ error: `Could not ${action} the open verse — try again.` });
  }
}
router.post("/open-verse/:id/close", publicApiLimiter, requireAuth, (req, res) => ownerPostAction(req, res, "close"));
router.post("/open-verse/:id/cancel", publicApiLimiter, requireAuth, (req, res) => ownerPostAction(req, res, "cancel"));

/* POST /api/open-verse/:id/pick-winner — owner only; the winner's verse
   goes onto the track and the split agreement is ledgered EXACTLY ONCE
   (unique post_id + idempotency key; a same-winner retry replays). */
router.post("/open-verse/:id/pick-winner", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  const parsed = pickSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid", message: "Pick a verse to crown." });
  }
  try {
    await probeOpenVerseTables();
  } catch (err) {
    if (isMissingOpenVerseTable(err)) return notReady(res);
    throw err;
  }
  try {
    const detail = await requirePost(req, res);
    if (!detail) return;
    let result;
    try {
      result = pickWinner(detail.post, detail.submissions, req.userId!, parsed.data.submission_id);
    } catch (err) {
      const r = machineError(res, err);
      if (r) return r;
      throw err;
    }
    const ledgerId = await persistWinnerPick(result.post, result.submissions, result.ledger);
    if (result.applied) {
      const winner = result.submissions.find((s) => s.id === parsed.data.submission_id);
      if (winner) {
        await notifyUser(
          winner.submitterUserId,
          "Your verse won — it's on the track",
          `Your verse for "${detail.post.songTitle}" was picked by the song's creator. Your split is ${result.ledger.winnerSharePct}% of the track's future Visual Bucs earnings (test mode) — recorded exactly once.`,
        );
      }
    }
    return res.json({
      post: postDto(result.post, req.userId!),
      applied: result.applied,
      split_ledger: {
        id: ledgerId,
        winner_share_pct: result.ledger.winnerSharePct,
        split_terms: result.ledger.splitTerms,
        currency: result.ledger.currency,
        idempotency_key: result.ledger.idempotencyKey,
      },
      winner_note: OPEN_VERSE_COPY.winnerApplied,
    });
  } catch (err) {
    if (isMissingOpenVerseTable(err)) return notReady(res);
    const r = machineError(res, err);
    if (r) return r;
    logger.error({ err }, "[open-verse] pick-winner failed");
    return res.status(500).json({ error: "Could not pick the winner — try again." });
  }
});

/* POST /api/open-verse/:id/withdraw — withdraw MY verse */
router.post("/open-verse/:id/withdraw", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  try {
    await probeOpenVerseTables();
  } catch (err) {
    if (isMissingOpenVerseTable(err)) return notReady(res);
    throw err;
  }
  try {
    const detail = await requirePost(req, res);
    if (!detail) return;
    const mine = detail.submissions.find((s) => s.submitterUserId === req.userId!);
    if (!mine) return res.status(404).json({ error: "You haven't submitted a verse to this song." });
    let next;
    try {
      next = withdrawSubmission(detail.post, mine, req.userId!);
    } catch (err) {
      const r = machineError(res, err);
      if (r) return r;
      throw err;
    }
    await saveOpenVerseSubmissionStatus(next);
    return res.json({ submission: submissionDto(next, req.userId!) });
  } catch (err) {
    if (isMissingOpenVerseTable(err)) return notReady(res);
    logger.error({ err }, "[open-verse] withdraw failed");
    return res.status(500).json({ error: "Could not withdraw your verse — try again." });
  }
});

export default router;
