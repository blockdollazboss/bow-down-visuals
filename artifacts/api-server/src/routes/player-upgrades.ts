import { Router } from "express";
import { createHash } from "crypto";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../lib/credits";
import {
  db,
  showcaseItemsTable,
  videoAutoChaptersTable,
  thumbnailDuelsTable,
  thumbnailDuelClicksTable,
  karaokeSingalongsTable,
  songsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { mirrorExternalMediaUrl } from "../lib/mirrorMedia";
import {
  transcribeAudioUrl,
  detectTimedChapters,
  sanitizeTimedChapters,
  generateSummaryFromTranscript,
  type AutoChapter,
} from "./generate/auto-chapters";
import {
  pickDuelCover,
  duelOutcome,
  duelResultsView,
  clampDuelTargetViews,
  type DuelCover,
} from "../lib/thumbnail-duels";
import { parseLrc, validateTimedLyrics } from "../lib/karaoke-lyrics";

const router = Router();

/* ═══ Player-surface upgrades (upg-player lane) ═══════════════════════════
   #174 Thumbnail Duels · N5 Auto Chapters (watch surface) · N9 Karaoke Mode.
   Each delta docks into its home surface: the public showcase watch pages
   (chapters + duels) and the song library player (karaoke). */

const AUTO_CHAPTERS_COST = Number(process.env["AUTO_CHAPTERS_CREDITS"]) || 150;

function voterKey(req: { ip?: string; headers: Record<string, string | string[] | undefined> }): string {
  const ip = req.ip ?? "unknown";
  const ua = req.headers["user-agent"] ?? "unknown";
  return createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 32);
}

async function ownedShowcaseItem(itemId: string, userId: string) {
  const [item] = await db
    .select()
    .from(showcaseItemsTable)
    .where(and(eq(showcaseItemsTable.id, itemId), eq(showcaseItemsTable.user_id, userId)))
    .limit(1);
  return item ?? null;
}

async function showcaseItemBySlug(slug: string) {
  const [item] = await db
    .select()
    .from(showcaseItemsTable)
    .where(eq(showcaseItemsTable.slug, slug))
    .limit(1);
  return item ?? null;
}

/* ═══ N5 — Auto Chapters on the watch surface ═════════════════════════════
   Generate → DRAFT (invisible to the audience) → creator edits → APPROVE →
   chapters + summary show on /showcase/:slug. Status "off" is the off
   switch. Editing an approved set returns it to draft: nothing unreviewed
   ever shows. */

router.post("/showcase-items/:itemId/auto-chapters/generate", requireAuth, async (req, res) => {
  const { itemId } = req.params as { itemId: string };
  const item = await ownedShowcaseItem(itemId, req.userId!);
  if (!item) { res.status(404).json({ error: "Showcase item not found." }); return; }
  if (item.media_type !== "video") {
    res.status(400).json({ error: "Auto Chapters are for videos." });
    return;
  }
  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < AUTO_CHAPTERS_COST) {
    res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating." });
    return;
  }
  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, AUTO_CHAPTERS_COST, { action: "Auto Chapters" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }
  try {
    const segments = await transcribeAudioUrl(item.media_url);
    const fullText = segments.map((s) => s.text).join(" ");
    if (!fullText.trim()) throw new Error("No speech detected in this video — chapters need spoken content.");
    const lastEnd = segments.length > 0 ? Math.ceil(segments[segments.length - 1]!.start + 30) : 0;
    const chapters = await detectTimedChapters(segments, 10, item.title, lastEnd);
    const summary = await generateSummaryFromTranscript(fullText, item.title);
    const [row] = await db
      .insert(videoAutoChaptersTable)
      .values({
        showcase_item_id: item.id,
        user_id: req.userId!,
        chapters,
        summary,
        status: "draft",
      })
      .onConflictDoUpdate({
        target: videoAutoChaptersTable.showcase_item_id,
        set: { chapters, summary, status: "draft", updated_at: new Date() },
      })
      .returning();
    res.json({ autoChapters: row, creditsRemaining: creditsAfter });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auto chapter generation failed.";
    req.log.error({ err: message }, "[auto-chapters-watch] generate failed");
    await refundCredits(req.userId!, AUTO_CHAPTERS_COST, { action: "Auto Chapters — Refund" }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

/* Public watch view: APPROVED sets only. Anything else reads as "none". */
router.get("/showcase/:slug/auto-chapters", async (req, res) => {
  const { slug } = req.params as { slug: string };
  const item = await showcaseItemBySlug(slug);
  if (!item) { res.status(404).json({ error: "Showcase item not found." }); return; }
  const [row] = await db
    .select()
    .from(videoAutoChaptersTable)
    .where(eq(videoAutoChaptersTable.showcase_item_id, item.id))
    .limit(1);
  if (!row || row.status !== "approved") {
    res.json({ autoChapters: null });
    return;
  }
  res.json({ autoChapters: { chapters: row.chapters, summary: row.summary } });
});

/* Owner view: the full record in any status. */
router.get("/showcase-items/:itemId/auto-chapters", requireAuth, async (req, res) => {
  const { itemId } = req.params as { itemId: string };
  const item = await ownedShowcaseItem(itemId, req.userId!);
  if (!item) { res.status(404).json({ error: "Showcase item not found." }); return; }
  const [row] = await db
    .select()
    .from(videoAutoChaptersTable)
    .where(eq(videoAutoChaptersTable.showcase_item_id, item.id))
    .limit(1);
  res.json({ autoChapters: row ?? null });
});

const chaptersEditSchema = z.object({
  chapters: z.array(z.object({
    title: z.string().trim().min(1).max(80),
    startSec: z.number().min(0).max(8 * 3600),
  })).min(1).max(20),
  summary: z.string().trim().max(600).optional(),
});

router.patch("/showcase-items/:itemId/auto-chapters", requireAuth, async (req, res) => {
  const { itemId } = req.params as { itemId: string };
  const item = await ownedShowcaseItem(itemId, req.userId!);
  if (!item) { res.status(404).json({ error: "Showcase item not found." }); return; }
  const parsed = chaptersEditSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid chapters.", details: parsed.error.issues });
    return;
  }
  const [existing] = await db
    .select()
    .from(videoAutoChaptersTable)
    .where(eq(videoAutoChaptersTable.showcase_item_id, item.id))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "No auto chapters yet — generate them first." }); return; }
  const lastEnd = Math.max(...existing.chapters.map((c) => c.endSec), ...parsed.data.chapters.map((c) => c.startSec + 1));
  const chapters: AutoChapter[] = sanitizeTimedChapters(parsed.data.chapters, 20, lastEnd);
  const [row] = await db
    .update(videoAutoChaptersTable)
    .set({
      chapters,
      ...(parsed.data.summary !== undefined ? { summary: parsed.data.summary } : {}),
      /* An edit un-approves: the creator reviews before it shows again. */
      status: existing.status === "off" ? "off" : "draft",
      updated_at: new Date(),
    })
    .where(eq(videoAutoChaptersTable.id, existing.id))
    .returning();
  res.json({ autoChapters: row });
});

async function setChaptersStatus(req: any, res: any, status: "approved" | "off" | "draft") {
  const { itemId } = req.params as { itemId: string };
  const item = await ownedShowcaseItem(itemId, req.userId!);
  if (!item) { res.status(404).json({ error: "Showcase item not found." }); return; }
  const [row] = await db
    .update(videoAutoChaptersTable)
    .set({ status, updated_at: new Date() })
    .where(eq(videoAutoChaptersTable.showcase_item_id, item.id))
    .returning();
  if (!row) { res.status(404).json({ error: "No auto chapters yet — generate them first." }); return; }
  res.json({ autoChapters: row });
}

router.post("/showcase-items/:itemId/auto-chapters/approve", requireAuth, (req, res) => setChaptersStatus(req, res, "approved"));
router.post("/showcase-items/:itemId/auto-chapters/off", requireAuth, (req, res) => setChaptersStatus(req, res, "off"));
router.post("/showcase-items/:itemId/auto-chapters/on", requireAuth, (req, res) => setChaptersStatus(req, res, "draft"));

/* ═══ #174 — Thumbnail Duels ══════════════════════════════════════════════
   Audience-served rotation over the real video's covers, real counts,
   automatic winner takeover (the winner becomes the item's thumbnail). */

const duelCreateSchema = z.object({
  coverBUrl: z.string().trim().min(1).max(2048),
  coverAUrl: z.string().trim().min(1).max(2048).optional(),
  targetViews: z.number().optional(),
});

router.post("/showcase-items/:itemId/duel", requireAuth, async (req, res) => {
  const { itemId } = req.params as { itemId: string };
  const item = await ownedShowcaseItem(itemId, req.userId!);
  if (!item) { res.status(404).json({ error: "Showcase item not found." }); return; }
  if (item.media_type !== "video") {
    res.status(400).json({ error: "Thumbnail Duels are for videos." });
    return;
  }
  const parsed = duelCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid duel.", details: parsed.error.issues });
    return;
  }
  const coverA = parsed.data.coverAUrl ?? item.thumbnail_url;
  if (!coverA) {
    res.status(400).json({ error: "Cover A needs a thumbnail — set the video's thumbnail first or pass coverAUrl." });
    return;
  }
  const [running] = await db
    .select({ id: thumbnailDuelsTable.id })
    .from(thumbnailDuelsTable)
    .where(and(eq(thumbnailDuelsTable.showcase_item_id, item.id), eq(thumbnailDuelsTable.status, "running")))
    .limit(1);
  if (running) {
    res.status(409).json({ error: "A duel is already running for this video." });
    return;
  }
  const coverAUrl = (await mirrorExternalMediaUrl(coverA, { kind: "image", ownerKey: req.userId! })) ?? coverA;
  const coverBUrl = (await mirrorExternalMediaUrl(parsed.data.coverBUrl, { kind: "image", ownerKey: req.userId! })) ?? parsed.data.coverBUrl;
  const [duel] = await db
    .insert(thumbnailDuelsTable)
    .values({
      showcase_item_id: item.id,
      user_id: req.userId!,
      cover_a_url: coverAUrl,
      cover_b_url: coverBUrl,
      target_views: clampDuelTargetViews(parsed.data.targetViews),
    })
    .returning();
  res.json({ duel, results: duelResultsView({ viewsA: 0, viewsB: 0, clicksA: 0, clicksB: 0, targetViews: duel.target_views }) });
});

/* Which published items currently have a running duel (grid rotation). */
router.get("/showcase/duels/running", async (_req, res) => {
  const rows = await db
    .select({ showcase_item_id: thumbnailDuelsTable.showcase_item_id })
    .from(thumbnailDuelsTable)
    .where(eq(thumbnailDuelsTable.status, "running"));
  res.json({ itemIds: rows.map((r) => r.showcase_item_id) });
});

/* Serve the next cover in rotation; the serve itself is the counted view. */
router.get("/showcase/:slug/duel-cover", async (req, res) => {
  const { slug } = req.params as { slug: string };
  const item = await showcaseItemBySlug(slug);
  if (!item) { res.status(404).json({ error: "Showcase item not found." }); return; }
  const [duel] = await db
    .select()
    .from(thumbnailDuelsTable)
    .where(and(eq(thumbnailDuelsTable.showcase_item_id, item.id), eq(thumbnailDuelsTable.status, "running")))
    .orderBy(desc(thumbnailDuelsTable.created_at))
    .limit(1);
  if (!duel) { res.json({ duel: null }); return; }
  const cover = pickDuelCover({ viewsA: duel.views_a, viewsB: duel.views_b });
  const [updated] = await db
    .update(thumbnailDuelsTable)
    .set(cover === "a" ? { views_a: sql`${thumbnailDuelsTable.views_a} + 1` } : { views_b: sql`${thumbnailDuelsTable.views_b} + 1` })
    .where(eq(thumbnailDuelsTable.id, duel.id))
    .returning();
  res.json({
    duel: {
      id: duel.id,
      cover,
      coverUrl: cover === "a" ? duel.cover_a_url : duel.cover_b_url,
      results: duelResultsView({
        viewsA: updated.views_a, viewsB: updated.views_b,
        clicksA: updated.clicks_a, clicksB: updated.clicks_b,
        targetViews: updated.target_views,
      }),
    },
  });
});

/* A click-through on a served cover. Deduped per audience member per cover;
   the click that crosses the line resolves the duel and the winner takes
   over as the video's thumbnail automatically. */
router.post("/showcase/:slug/duel-click", async (req, res) => {
  const { slug } = req.params as { slug: string };
  const cover = (req.body?.cover === "b" ? "b" : "a") as DuelCover;
  const item = await showcaseItemBySlug(slug);
  if (!item) { res.status(404).json({ error: "Showcase item not found." }); return; }
  const [duel] = await db
    .select()
    .from(thumbnailDuelsTable)
    .where(and(eq(thumbnailDuelsTable.showcase_item_id, item.id), eq(thumbnailDuelsTable.status, "running")))
    .orderBy(desc(thumbnailDuelsTable.created_at))
    .limit(1);
  if (!duel) { res.json({ duel: null }); return; }
  const inserted = await db
    .insert(thumbnailDuelClicksTable)
    .values({ duel_id: duel.id, cover, voter_key: voterKey(req) })
    .onConflictDoNothing()
    .returning({ id: thumbnailDuelClicksTable.id });
  let current = duel;
  if (inserted.length > 0) {
    const [updated] = await db
      .update(thumbnailDuelsTable)
      .set(cover === "a" ? { clicks_a: sql`${thumbnailDuelsTable.clicks_a} + 1` } : { clicks_b: sql`${thumbnailDuelsTable.clicks_b} + 1` })
      .where(eq(thumbnailDuelsTable.id, duel.id))
      .returning();
    current = updated;
  }
  const outcome = duelOutcome({
    viewsA: current.views_a, viewsB: current.views_b,
    clicksA: current.clicks_a, clicksB: current.clicks_b,
    targetViews: current.target_views,
  });
  if (outcome.resolved && outcome.winner) {
    const winnerUrl = outcome.winner === "a" ? current.cover_a_url : current.cover_b_url;
    const [resolved] = await db
      .update(thumbnailDuelsTable)
      .set({ status: "resolved", winner: outcome.winner, resolved_at: new Date() })
      .where(eq(thumbnailDuelsTable.id, duel.id))
      .returning();
    /* The takeover: the winning cover becomes the video's thumbnail. */
    await db.update(showcaseItemsTable).set({ thumbnail_url: winnerUrl }).where(eq(showcaseItemsTable.id, item.id));
    current = resolved;
  }
  res.json({
    duel: {
      id: current.id,
      status: current.status,
      winner: current.winner,
      results: duelResultsView({
        viewsA: current.views_a, viewsB: current.views_b,
        clicksA: current.clicks_a, clicksB: current.clicks_b,
        targetViews: current.target_views,
      }),
    },
  });
});

/* Owner: latest duel + real-count results + cancel. */
router.get("/showcase-items/:itemId/duel", requireAuth, async (req, res) => {
  const { itemId } = req.params as { itemId: string };
  const item = await ownedShowcaseItem(itemId, req.userId!);
  if (!item) { res.status(404).json({ error: "Showcase item not found." }); return; }
  const [duel] = await db
    .select()
    .from(thumbnailDuelsTable)
    .where(eq(thumbnailDuelsTable.showcase_item_id, item.id))
    .orderBy(desc(thumbnailDuelsTable.created_at))
    .limit(1);
  if (!duel) { res.json({ duel: null }); return; }
  res.json({
    duel,
    results: duelResultsView({
      viewsA: duel.views_a, viewsB: duel.views_b,
      clicksA: duel.clicks_a, clicksB: duel.clicks_b,
      targetViews: duel.target_views,
    }),
  });
});

router.post("/showcase-items/:itemId/duel/cancel", requireAuth, async (req, res) => {
  const { itemId } = req.params as { itemId: string };
  const item = await ownedShowcaseItem(itemId, req.userId!);
  if (!item) { res.status(404).json({ error: "Showcase item not found." }); return; }
  const [row] = await db
    .update(thumbnailDuelsTable)
    .set({ status: "cancelled" })
    .where(and(eq(thumbnailDuelsTable.showcase_item_id, item.id), eq(thumbnailDuelsTable.status, "running")))
    .returning();
  if (!row) { res.status(404).json({ error: "No running duel for this video." }); return; }
  res.json({ duel: row });
});

/* ═══ N9 — Karaoke Mode ═══════════════════════════════════════════════════
   Interactive in-player mode on the song's own track: synced lit lyrics
   (artist-supplied timed lyrics, validated against the song's lyrics),
   the fan sings over it on their own mic, and a sing-along can be recorded
   and shared as a house showcase song ONLY when the creator allows it. */

async function ownedSong(songId: string, userId: string) {
  const [song] = await db
    .select()
    .from(songsTable)
    .where(and(eq(songsTable.id, songId), eq(songsTable.user_id, userId)))
    .limit(1);
  return song ?? null;
}

router.get("/songs/:songId/karaoke", requireAuth, async (req, res) => {
  const { songId } = req.params as { songId: string };
  const [song] = await db.select().from(songsTable).where(eq(songsTable.id, songId)).limit(1);
  if (!song) { res.status(404).json({ error: "Song not found." }); return; }
  const enabled = song.karaoke_enabled === true;
  res.json({
    karaoke: {
      enabled,
      shareEnabled: song.karaoke_share_enabled === true,
      isOwner: song.user_id === req.userId,
      hasTimedLyrics: Boolean(song.timed_lyrics && parseLrc(song.timed_lyrics).length >= 2),
      lines: enabled && song.timed_lyrics ? parseLrc(song.timed_lyrics) : [],
    },
  });
});

const karaokeSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  shareEnabled: z.boolean().optional(),
  timedLyrics: z.string().max(20000).optional(),
});

router.patch("/songs/:songId/karaoke-settings", requireAuth, async (req, res) => {
  const { songId } = req.params as { songId: string };
  const song = await ownedSong(songId, req.userId!);
  if (!song) { res.status(404).json({ error: "Song not found." }); return; }
  const parsed = karaokeSettingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid karaoke settings.", details: parsed.error.issues });
    return;
  }
  const patch: Record<string, unknown> = {};
  if (parsed.data.enabled !== undefined) patch.karaoke_enabled = parsed.data.enabled;
  if (parsed.data.shareEnabled !== undefined) patch.karaoke_share_enabled = parsed.data.shareEnabled;
  if (parsed.data.timedLyrics !== undefined) {
    const validation = validateTimedLyrics(parsed.data.timedLyrics, song.lyrics);
    if (!validation.ok) {
      res.status(400).json({ error: "Timed lyrics failed validation.", errors: validation.errors });
      return;
    }
    patch.timed_lyrics = parsed.data.timedLyrics;
  }
  /* Enabling requires timed lyrics on file — no lit lyrics, no karaoke. */
  const willEnable = parsed.data.enabled ?? song.karaoke_enabled === true;
  const timedLyrics = (patch.timed_lyrics as string | undefined) ?? song.timed_lyrics;
  if (willEnable && !(timedLyrics && parseLrc(timedLyrics).length >= 2)) {
    res.status(400).json({ error: "Add timed lyrics (LRC) before turning Karaoke Mode on." });
    return;
  }
  const [row] = await db.update(songsTable).set(patch).where(eq(songsTable.id, song.id)).returning();
  res.json({
    karaoke: {
      enabled: row.karaoke_enabled === true,
      shareEnabled: row.karaoke_share_enabled === true,
      hasTimedLyrics: Boolean(row.timed_lyrics && parseLrc(row.timed_lyrics).length >= 2),
    },
  });
});

const recordingSchema = z.object({
  audioUrl: z.string().trim().min(1).max(2048),
  share: z.boolean().optional().default(false),
  creatorName: z.string().trim().max(60).optional(),
});

router.post("/songs/:songId/karaoke/recordings", requireAuth, async (req, res) => {
  const { songId } = req.params as { songId: string };
  const [song] = await db.select().from(songsTable).where(eq(songsTable.id, songId)).limit(1);
  if (!song) { res.status(404).json({ error: "Song not found." }); return; }
  if (song.karaoke_enabled !== true) {
    res.status(403).json({ error: "Karaoke Mode is not on for this song." });
    return;
  }
  const parsed = recordingSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid recording.", details: parsed.error.issues });
    return;
  }
  if (parsed.data.share && song.karaoke_share_enabled !== true) {
    res.status(403).json({ error: "This creator hasn't allowed shared sing-alongs for this song." });
    return;
  }
  const audioUrl = (await mirrorExternalMediaUrl(parsed.data.audioUrl, { kind: "audio", ownerKey: req.userId! })) ?? parsed.data.audioUrl;
  let showcaseItemId: string | null = null;
  if (parsed.data.share) {
    const slug = `sing-along-${song.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "song"}-${Math.random().toString(16).slice(2, 8)}`;
    const [item] = await db
      .insert(showcaseItemsTable)
      .values({
        user_id: req.userId!,
        slug,
        title: `${song.title} — sing-along`,
        description: `A fan sing-along over "${song.title}".`,
        media_type: "song",
        media_url: audioUrl,
        thumbnail_url: song.cover_art_url ?? null,
        creator_name: parsed.data.creatorName?.trim() || "A fan",
      })
      .returning();
    showcaseItemId = item.id;
  }
  const [row] = await db
    .insert(karaokeSingalongsTable)
    .values({
      song_id: song.id,
      user_id: req.userId!,
      audio_url: audioUrl,
      status: parsed.data.share ? "shared" : "private",
      showcase_item_id: showcaseItemId,
    })
    .returning();
  res.json({ recording: row });
});

router.get("/songs/:songId/karaoke/recordings", requireAuth, async (req, res) => {
  const { songId } = req.params as { songId: string };
  const rows = await db
    .select()
    .from(karaokeSingalongsTable)
    .where(and(eq(karaokeSingalongsTable.song_id, songId), eq(karaokeSingalongsTable.user_id, req.userId!)))
    .orderBy(desc(karaokeSingalongsTable.created_at))
    .limit(50);
  res.json({ recordings: rows });
});

export default router;
