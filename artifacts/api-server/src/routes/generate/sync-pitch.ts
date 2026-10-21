import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
} from "../../lib/credits";
import {
  db,
  syncOneSheetsTable,
  syncBriefsTable,
  syncPitchesTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

/* ─── Sync Pitch Kit ──────────────────────────────────────────────────────
   DistroKid-style sync licensing pitching: an AI-written one-sheet per song
   (mood tags, BPM, key, comparable artists, "sounds like" descriptors,
   instrumental/stems availability flags, contact info), a sync brief board
   (TV/film/ad/game briefs matched against the creator's catalog), and a
   pitch tracker (sent -> pending -> placed).

   Pricing: 150 VB per generated one-sheet (AI compute). Briefs, matching,
   and the tracker are free — pure data, no compute. */

export const SYNC_ONE_SHEET_CREDIT_COST =
  Number(process.env["SYNC_ONE_SHEET_CREDIT_COST"]) || 150;

export const SYNC_PROJECT_TYPES = ["tv", "film", "ad", "game"] as const;
export const SYNC_PITCH_STATUSES = ["sent", "pending", "placed", "dead"] as const;

export const SYNC_DISCLAIMER =
  "Sync pitching improves your odds — it never guarantees a placement. " +
  "Music supervisors say yes based on fit, timing, and taste; no AI can promise a slot. " +
  "Always confirm you own (or control) 100% of the master and publishing before pitching.";

const router = Router();

/* ── One-sheet generation ────────────────────────────────────────────────── */

const oneSheetInputSchema = z.object({
  songTitle: z.string().min(1, "Song title is required.").max(200),
  artistName: z.string().max(200).optional().default(""),
  songLibraryId: z.string().uuid().optional(),
  genre: z.string().max(100).optional().default(""),
  mood: z.string().max(200).optional().default(""),
  bpm: z.string().max(20).optional().default(""),
  musicalKey: z.string().max(20).optional().default(""),
  energy: z.number().min(0).max(100).optional(),
  description: z.string().max(1000).optional().default(""),
  lyrics: z.string().max(5000).optional().default(""),
  instrumentalAvailable: z.boolean().optional().default(false),
  stemsAvailable: z.boolean().optional().default(false),
  contactName: z.string().max(200).optional().default(""),
  contactEmail: z.string().max(200).optional().default(""),
});

export type SyncOneSheetContent = {
  logline: string;
  moodTags: string[];
  soundsLike: string;
  comparableArtists: string[];
  syncUses: string[];
  pitchEmail: { subject: string; body: string };
  licensingNotes: string;
  disclaimer: string;
};

export function buildSyncOneSheetPrompt(input: z.infer<typeof oneSheetInputSchema>): string {
  const lines: string[] = [`Song title: "${input.songTitle}"`];
  if (input.artistName.trim()) lines.push(`Artist: "${input.artistName.trim()}"`);
  if (input.genre.trim()) lines.push(`Genre: "${input.genre.trim()}"`);
  if (input.mood.trim()) lines.push(`Mood hints: "${input.mood.trim()}"`);
  if (input.bpm.trim()) lines.push(`BPM: "${input.bpm.trim()}"`);
  if (input.musicalKey.trim()) lines.push(`Key: "${input.musicalKey.trim()}"`);
  if (typeof input.energy === "number") lines.push(`Energy: ${input.energy}/100`);
  if (input.description.trim()) lines.push(`Creator's description: "${input.description.trim()}"`);
  if (input.lyrics.trim()) lines.push(`Lyrics (analyze themes): """${input.lyrics.trim().slice(0, 3000)}"""`);

  return (
    `Write a sync licensing one-sheet for this independent artist's song — the kind of document a music ` +
    `supervisor for TV, film, ads, or games would scan in 30 seconds and remember.\n\n` +
    lines.join("\n") + `\n\n` +
    `Return ONLY JSON with this shape:\n` +
    `{\n` +
    `  "logline": "<one publicist-grade sentence selling the song for sync — no hype slang>",\n` +
    `  "moodTags": ["<4-6 single-word mood tags, e.g. 'brooding', 'triumphant', 'late-night'>"],\n` +
    `  "soundsLike": "<one 'sounds like X meets Y in a Z' style descriptor supervisors instantly get>",\n` +
    `  "comparableArtists": ["<3 well-known artists this actually sounds like>"],\n` +
    `  "syncUses": ["<4-6 concrete placement ideas, e.g. 'closing-credits ballad for a prestige drama', 'underdog sports-montage build', 'luxury car ad — night drive', 'boss-fight ramp in an action game'>"],\n` +
    `  "pitchEmail": {\n` +
    `    "subject": "<under 60 chars, specific — include the mood angle, never 'Check out my song'>",\n` +
    `    "body": "<120-180 words. Short greeting to a music supervisor, the logline, 2-3 sentences on sync fit with a concrete scene example, versions available placeholder [Instrumental/Stems], one-line artist bio, polite sign-off. Confident, never begging. No hype words like 'fire', 'banger', 'smash hit'.>"\n` +
    `  },\n` +
    `  "licensingNotes": "<2-3 sentences on clearance: one-stop vs split, instrumental/stems availability wording, and the 100% control reminder — honest, not legal advice>"\n` +
    `}\n\n` +
    `Rules: be specific, never generic. Never promise a placement. Write like a real sync agent, not a template.`
  );
}

function clampNum(n: unknown, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n)
    ? Math.max(0, Math.min(100, Math.round(n)))
    : fallback;
}

function cleanStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function cleanStrArr(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, max);
}

export function parseSyncOneSheetResponse(raw: string): Omit<SyncOneSheetContent, "disclaimer"> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Model returned invalid JSON");
  }
  const p = parsed as Record<string, unknown>;
  const e = (p["pitchEmail"] ?? {}) as Record<string, unknown>;

  const logline = cleanStr(p["logline"]);
  const subject = cleanStr(e["subject"]);
  const body = cleanStr(e["body"]);

  if (!logline || !subject || !body) {
    throw new Error("Model returned an incomplete one-sheet");
  }

  return {
    logline,
    moodTags: cleanStrArr(p["moodTags"], 6),
    soundsLike: cleanStr(p["soundsLike"]),
    comparableArtists: cleanStrArr(p["comparableArtists"], 3),
    syncUses: cleanStrArr(p["syncUses"], 6),
    pitchEmail: { subject, body },
    licensingNotes: cleanStr(p["licensingNotes"]),
  };
}

/* POST /api/sync-pitch/one-sheet — 150 VB.
   Body: song details + availability flags + contact info.
   Returns: { oneSheet, creditsUsed, creditsRemaining } */
router.post(
  "/sync-pitch/one-sheet",
  publicApiLimiter,
  requireAuth,
  async (req, res) => {
    const parsed = oneSheetInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid one-sheet request.",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }

    const balance = req.userCredits ?? 0;
    if (balance < SYNC_ONE_SHEET_CREDIT_COST) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to generate a sync one-sheet.",
      });
      return;
    }

    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, SYNC_ONE_SHEET_CREDIT_COST, {
        action: "Sync One-Sheet",
      });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You're out of Visual Bucs — top up to generate a sync one-sheet.",
        });
        return;
      }
      throw err;
    }

    const refundOnFailure = async () => {
      try {
        await refundCredits(req.userId!, SYNC_ONE_SHEET_CREDIT_COST, {
          action: "Sync One-Sheet — Refund (generation failed)",
        });
      } catch (refundErr) {
        logger.error(
          { err: refundErr, userId: req.userId },
          "[sync-pitch] refund failed after generation error",
        );
      }
    };

    try {
      const completion = await getOpenAI().chat.completions.create({
        model: getTextModel(),
        messages: [
          {
            role: "system",
            content:
              "You are a sync licensing agent who has placed independent artists in " +
              "TV, film, ads, and games. You write one-sheets that make a music " +
              "supervisor hit reply: specific, confident, respectful of their time. " +
              "You never use hype slang, never beg, and never promise a placement.",
          },
          { role: "user", content: buildSyncOneSheetPrompt(parsed.data) },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 1500,
        temperature: 0.7,
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      const generated = parseSyncOneSheetResponse(raw);
      const d = parsed.data;

      const content: SyncOneSheetContent = { ...generated, disclaimer: SYNC_DISCLAIMER };

      const [row] = await db
        .insert(syncOneSheetsTable)
        .values({
          user_id: req.userId!,
          song_title: d.songTitle.trim(),
          artist_name: d.artistName.trim() || null,
          song_library_id: d.songLibraryId ?? null,
          content,
          mood_tags: generated.moodTags,
          bpm: d.bpm.trim() || null,
          musical_key: d.musicalKey.trim() || null,
          comparable_artists: generated.comparableArtists,
          sounds_like: generated.soundsLike || null,
          instrumental_available: d.instrumentalAvailable,
          stems_available: d.stemsAvailable,
          contact_name: d.contactName.trim() || null,
          contact_email: d.contactEmail.trim() || null,
          share_token: crypto.randomBytes(16).toString("hex"),
          updated_at: new Date(),
        })
        .returning();

      res.json({
        oneSheet: toOneSheetApiRow(row!),
        creditsUsed: SYNC_ONE_SHEET_CREDIT_COST,
        creditsRemaining,
      });
    } catch (err) {
      await refundOnFailure();
      if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
        logger.warn({ err }, "[sync-pitch] OpenAI rate limit / quota");
        res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
        return;
      }
      logger.error({ err }, "[sync-pitch] one-sheet generation failed");
      res.status(502).json({ error: "The one-sheet didn't come together — Visual Bucs refunded. Try again." });
    }
  },
);

function toOneSheetApiRow(row: typeof syncOneSheetsTable.$inferSelect) {
  return {
    id: row.id,
    songTitle: row.song_title,
    artistName: row.artist_name,
    songLibraryId: row.song_library_id,
    content: row.content,
    moodTags: row.mood_tags,
    bpm: row.bpm,
    musicalKey: row.musical_key,
    comparableArtists: row.comparable_artists,
    soundsLike: row.sounds_like,
    instrumentalAvailable: row.instrumental_available,
    stemsAvailable: row.stems_available,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    shareToken: row.share_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* GET /api/sync-pitch/one-sheets — list mine, newest first */
router.get("/sync-pitch/one-sheets", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(syncOneSheetsTable)
    .where(eq(syncOneSheetsTable.user_id, req.userId!))
    .orderBy(desc(syncOneSheetsTable.created_at))
    .limit(100);
  res.json({ oneSheets: rows.map(toOneSheetApiRow) });
});

/* GET /api/sync-pitch/one-sheets/:id — one of mine */
router.get("/sync-pitch/one-sheets/:id", requireAuth, async (req, res) => {
  const [row] = await db
    .select()
    .from(syncOneSheetsTable)
    .where(
      and(
        eq(syncOneSheetsTable.id, req.params["id"] as string),
        eq(syncOneSheetsTable.user_id, req.userId!),
      ),
    )
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "One-sheet not found." });
    return;
  }
  res.json({ oneSheet: toOneSheetApiRow(row) });
});

/* DELETE /api/sync-pitch/one-sheets/:id */
router.delete("/sync-pitch/one-sheets/:id", requireAuth, async (req, res) => {
  const [row] = await db
    .delete(syncOneSheetsTable)
    .where(
      and(
        eq(syncOneSheetsTable.id, req.params["id"] as string),
        eq(syncOneSheetsTable.user_id, req.userId!),
      ),
    )
    .returning({ id: syncOneSheetsTable.id });
  if (!row) {
    res.status(404).json({ error: "One-sheet not found." });
    return;
  }
  res.json({ deleted: row.id });
});

/* GET /api/sync-pitch/public/:token — PUBLIC one-sheet page for the
   shareable link (?ref=CODE rides along for the referral loop). No auth.
   Contact name/email are intentionally public here: this is a pitch sheet,
   its whole purpose is letting sync supervisors reach the artist. Everything
   else is limited to the song's pitch fields — no internal IDs or user data. */
router.get("/sync-pitch/public/:token", async (req, res) => {
  const [row] = await db
    .select()
    .from(syncOneSheetsTable)
    .where(eq(syncOneSheetsTable.share_token, req.params["token"] as string))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "One-sheet not found." });
    return;
  }
  res.json({
    oneSheet: {
      songTitle: row.song_title,
      artistName: row.artist_name,
      content: row.content,
      moodTags: row.mood_tags,
      bpm: row.bpm,
      musicalKey: row.musical_key,
      comparableArtists: row.comparable_artists,
      soundsLike: row.sounds_like,
      instrumentalAvailable: row.instrumental_available,
      stemsAvailable: row.stems_available,
      contactName: row.contact_name,
      contactEmail: row.contact_email,
    },
  });
});

/* ── Sync brief board (free — pure data) ─────────────────────────────────── */

const briefCreateSchema = z.object({
  title: z.string().min(1, "Brief title is required.").max(200),
  projectType: z.enum(SYNC_PROJECT_TYPES).optional().default("tv"),
  mood: z.string().max(200).optional().default(""),
  budgetRange: z.string().max(100).optional().default(""),
  deadline: z.string().max(50).optional(),
  notes: z.string().max(1000).optional().default(""),
});

const briefUpdateSchema = briefCreateSchema.partial();

function toBriefApiRow(row: typeof syncBriefsTable.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    projectType: row.project_type,
    mood: row.mood,
    budgetRange: row.budget_range,
    deadline: row.deadline,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get("/sync-pitch/briefs", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(syncBriefsTable)
    .where(eq(syncBriefsTable.user_id, req.userId!))
    .orderBy(desc(syncBriefsTable.updated_at))
    .limit(200);
  res.json({ briefs: rows.map(toBriefApiRow) });
});

router.post("/sync-pitch/briefs", requireAuth, async (req, res) => {
  const parsed = briefCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid brief.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .insert(syncBriefsTable)
    .values({
      user_id: req.userId!,
      title: d.title.trim(),
      project_type: d.projectType,
      mood: d.mood.trim(),
      budget_range: d.budgetRange.trim(),
      deadline: d.deadline ? d.deadline : null,
      notes: d.notes.trim() || null,
    })
    .returning();
  res.status(201).json({ brief: toBriefApiRow(row!) });
});

router.patch("/sync-pitch/briefs/:id", requireAuth, async (req, res) => {
  const parsed = briefUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid brief update." });
    return;
  }
  const d = parsed.data;
  const updates: Partial<typeof syncBriefsTable.$inferInsert> = { updated_at: new Date() };
  if (d.title !== undefined) updates.title = d.title.trim();
  if (d.projectType !== undefined) updates.project_type = d.projectType;
  if (d.mood !== undefined) updates.mood = d.mood.trim();
  if (d.budgetRange !== undefined) updates.budget_range = d.budgetRange.trim();
  if (d.deadline !== undefined) updates.deadline = d.deadline ? d.deadline : null;
  if (d.notes !== undefined) updates.notes = d.notes.trim() || null;

  const [row] = await db
    .update(syncBriefsTable)
    .set(updates)
    .where(
      and(
        eq(syncBriefsTable.id, req.params["id"] as string),
        eq(syncBriefsTable.user_id, req.userId!),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Brief not found." });
    return;
  }
  res.json({ brief: toBriefApiRow(row) });
});

router.delete("/sync-pitch/briefs/:id", requireAuth, async (req, res) => {
  const [row] = await db
    .delete(syncBriefsTable)
    .where(
      and(
        eq(syncBriefsTable.id, req.params["id"] as string),
        eq(syncBriefsTable.user_id, req.userId!),
      ),
    )
    .returning({ id: syncBriefsTable.id });
  if (!row) {
    res.status(404).json({ error: "Brief not found." });
    return;
  }
  res.json({ deleted: row.id });
});

/* GET /api/sync-pitch/briefs/:id/matches — match my one-sheeted songs
   against a brief (free, heuristic). Score = mood-token overlap between
   the brief's mood words and each one-sheet's mood tags, plus a bonus
   when instrumental/stems are available (supervisors ask for them first). */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s,-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);
}

router.get("/sync-pitch/briefs/:id/matches", requireAuth, async (req, res) => {
  const [brief] = await db
    .select()
    .from(syncBriefsTable)
    .where(
      and(
        eq(syncBriefsTable.id, req.params["id"] as string),
        eq(syncBriefsTable.user_id, req.userId!),
      ),
    )
    .limit(1);
  if (!brief) {
    res.status(404).json({ error: "Brief not found." });
    return;
  }

  const sheets = await db
    .select()
    .from(syncOneSheetsTable)
    .where(eq(syncOneSheetsTable.user_id, req.userId!))
    .orderBy(desc(syncOneSheetsTable.created_at))
    .limit(200);

  const briefTokens = new Set(tokenize(brief.mood));
  const scored = sheets.map((s) => {
    const sheetTokens = s.mood_tags.flatMap((t) => tokenize(t));
    let overlap = 0;
    for (const t of new Set(sheetTokens)) {
      if (briefTokens.has(t)) overlap += 1;
    }
    const versionBonus = (s.instrumental_available ? 1 : 0) + (s.stems_available ? 1 : 0);
    const score = overlap * 3 + versionBonus;
    return { oneSheet: toOneSheetApiRow(s), score, overlap };
  });
  scored.sort((a, b) => b.score - a.score);

  res.json({ brief: toBriefApiRow(brief), matches: scored });
});

/* ── Pitch tracker (free — pure data) ────────────────────────────────────── */

const trackerCreateSchema = z.object({
  songTitle: z.string().min(1, "Song title is required.").max(200),
  targetName: z.string().max(200).optional().default(""),
  oneSheetId: z.string().uuid().optional(),
  briefId: z.string().uuid().optional(),
  status: z.enum(SYNC_PITCH_STATUSES).optional().default("sent"),
  notes: z.string().max(1000).optional().default(""),
  contactedAt: z.string().max(50).optional(),
});

const trackerUpdateSchema = z.object({
  status: z.enum(SYNC_PITCH_STATUSES).optional(),
  notes: z.string().max(1000).optional(),
  targetName: z.string().max(200).optional(),
  songTitle: z.string().min(1).max(200).optional(),
  contactedAt: z.string().max(50).optional().nullable(),
});

function toPitchApiRow(row: typeof syncPitchesTable.$inferSelect) {
  return {
    id: row.id,
    oneSheetId: row.one_sheet_id,
    briefId: row.brief_id,
    songTitle: row.song_title,
    targetName: row.target_name,
    status: row.status,
    notes: row.notes,
    contactedAt: row.contacted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get("/sync-pitch/tracker", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(syncPitchesTable)
    .where(eq(syncPitchesTable.user_id, req.userId!))
    .orderBy(desc(syncPitchesTable.updated_at))
    .limit(200);
  res.json({ pitches: rows.map(toPitchApiRow) });
});

router.post("/sync-pitch/tracker", requireAuth, async (req, res) => {
  const parsed = trackerCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid pitch entry.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .insert(syncPitchesTable)
    .values({
      user_id: req.userId!,
      one_sheet_id: d.oneSheetId ?? null,
      brief_id: d.briefId ?? null,
      song_title: d.songTitle.trim(),
      target_name: d.targetName.trim(),
      status: d.status,
      notes: d.notes.trim() || null,
      contacted_at: d.contactedAt ? new Date(d.contactedAt) : new Date(),
    })
    .returning();
  res.status(201).json({ pitch: toPitchApiRow(row!) });
});

router.patch("/sync-pitch/tracker/:id", requireAuth, async (req, res) => {
  const parsed = trackerUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid pitch update." });
    return;
  }
  const d = parsed.data;
  const updates: Partial<typeof syncPitchesTable.$inferInsert> = { updated_at: new Date() };
  if (d.status) updates.status = d.status;
  if (d.notes !== undefined) updates.notes = d.notes.trim() || null;
  if (d.targetName !== undefined) updates.target_name = d.targetName.trim();
  if (d.songTitle !== undefined) updates.song_title = d.songTitle.trim();
  if (d.contactedAt !== undefined) updates.contacted_at = d.contactedAt ? new Date(d.contactedAt) : null;

  const [row] = await db
    .update(syncPitchesTable)
    .set(updates)
    .where(
      and(
        eq(syncPitchesTable.id, req.params["id"] as string),
        eq(syncPitchesTable.user_id, req.userId!),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Pitch not found." });
    return;
  }
  res.json({ pitch: toPitchApiRow(row) });
});

router.delete("/sync-pitch/tracker/:id", requireAuth, async (req, res) => {
  const [row] = await db
    .delete(syncPitchesTable)
    .where(
      and(
        eq(syncPitchesTable.id, req.params["id"] as string),
        eq(syncPitchesTable.user_id, req.userId!),
      ),
    )
    .returning({ id: syncPitchesTable.id });
  if (!row) {
    res.status(404).json({ error: "Pitch not found." });
    return;
  }
  res.json({ deleted: row.id });
});

export default router;
