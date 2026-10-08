import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, asc, desc } from "drizzle-orm";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../lib/credits";
import { db, wave9aSongStructuresTable, wave9aSongVersionsTable } from "@workspace/db";

/* ─── Wave 9A — Music / Suno side ───────────────────────────────────────────
   1. Song Structure Builder: drag-drop section blocks → AI arrangement plan.
      POST /wave9a/structure/generate        200 VB (paid: text model)
      GET  /wave9a/structures                free — list saved structures
      POST /wave9a/structures                free — persist a structure
      DELETE /wave9a/structures/:id          free
   2. Lyrics-to-Timeline: AI-estimated per-line lyric timings (no audio needed).
      POST /wave9a/lyrics/timing             50 VB (paid: text model)
   3. Remix Chain: version bookkeeping on top of generated songs (free UI).
      GET    /wave9a/versions?song_id=       free — version list for a song
      POST   /wave9a/versions                free — register a version
      PATCH  /wave9a/versions/:id            free — label/notes/promote
      DELETE /wave9a/versions/:id            free

   Credit discipline (standing): AI availability check BEFORE charging →
   charge BEFORE the model call → refund on ANY failure. No charge without
   delivery, ever.

   Dedup note: Remix Chain does NOT duplicate SongReworkPanel (paid remix /
   section-replace regeneration). Rework generates new audio; this route family
   is the free metadata layer that names, compares, and promotes the outputs
   those paid flows produce. Lyrics-to-Timeline does NOT duplicate
   CaptionsSection's Whisper sync (audio → measured timing); it estimates
   musical line timings from lyrics text alone before audio exists, for the
   video-editor caption handoff.

   Endpoints: router mounted at /api — coordinator wires routes/index.ts. */

const router = Router();

const STRUCTURE_GENERATE_CREDITS = 200;
const LYRICS_TIMING_CREDITS = 50;

/* ─── shared shapes ─── */

const sectionInputSchema = z.object({
  type: z.string().trim().min(1).max(40),
  bars: z.number().int().min(1).max(64),
  label: z.string().trim().max(120).optional().default(""),
});

const arrangementSectionSchema = z.object({
  type: z.string().trim().min(1).max(40),
  bars: z.number().int().min(1).max(64),
  startsAtBar: z.number().int().min(1),
  energy: z.string().trim().min(1).max(120),
  direction: z.string().trim().min(1).max(400),
  lyricMap: z.string().trim().max(400).optional().default(""),
});

const arrangementSchema = z.object({
  arrangement: z.array(arrangementSectionSchema).min(1).max(24),
  totalBars: z.number().int().min(1),
  notes: z.string().trim().max(800).optional().default(""),
});

const timingLineSchema = z.object({
  text: z.string().trim().min(1).max(280),
  start: z.number().min(0),
  end: z.number().min(0),
});

const timingResponseSchema = z.object({
  lines: z.array(timingLineSchema).min(1).max(200),
});

const uuidParam = z.string().uuid("Invalid id.");

function aiUnavailable(res: Response, feature: string): boolean {
  try {
    getOpenAI();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(503).json({
      error: "ai_unavailable",
      message: msg.includes("OPENAI_API_KEY")
        ? `OPENAI_API_KEY is not configured — ${feature} is unavailable.`
        : `${feature} is unavailable right now.`,
    });
    return true;
  }
  return false;
}

async function chargeOr402(res: Response, userId: string, amount: number, action: string): Promise<number | null> {
  let remaining: number;
  try {
    remaining = await chargeCredits(userId, amount, { action });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "Not enough Visual Bucs — top up to continue.",
      });
      return null;
    }
    throw err;
  }
  return remaining;
}

async function refund(userId: string, amount: number, action: string, tag: string) {
  try {
    await refundCredits(userId, amount, { action });
  } catch (refundErr) {
    logger.error({ userId, refundErr }, `[wave9a-music] CRITICAL: refund failed (${tag})`);
  }
}

function parseJsonOrThrow(raw: string, tag: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Model returned unusable JSON (${tag})`);
  }
}

/* ─── POST /wave9a/structure/generate — 200 VB ─── */
const structureRequestSchema = z.object({
  sections: z.array(sectionInputSchema).min(1).max(24),
  lyrics: z.string().trim().max(8000).optional().default(""),
  vibe: z.string().trim().max(300).optional().default(""),
  title: z.string().trim().max(200).optional().default(""),
});

router.post("/wave9a/structure/generate", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = structureRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid structure request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  /* 1) AI availability check BEFORE charging. */
  if (aiUnavailable(res, "the Song Structure Builder")) return;

  /* 2) Charge BEFORE the model call. */
  const remaining = await chargeOr402(res, req.userId!, STRUCTURE_GENERATE_CREDITS, "Song Structure Builder");
  if (remaining === null) return;

  const { sections, lyrics, vibe, title } = parsed.data;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            "You are the arrangement coach for Bow Down Visuals — the cheat code for " +
            "content creators. A creator gives you their song's section layout (each section " +
            "with a bar count) plus lyrics and a vibe. You return an ordered arrangement plan: " +
            "which bar each section starts on (cumulative), how the ENERGY of each section " +
            "should feel (build, drop, strip back, etc.), and concrete musical DIRECTION per " +
            "section (instrumentation, dynamics, vocal delivery — practical, not fluffy). If " +
            "lyrics are provided, map which lyric chunk each section carries. " +
            "Return ONLY valid JSON with this exact shape:\n" +
            '{ "arrangement": [ { "type": "<section type, same as input>", "bars": <bars, same as input>, ' +
            '"startsAtBar": <1-based bar number where this section begins>, "energy": "<e.g. 3/10 low simmer>", ' +
            '"direction": "<2-3 sentences of musical direction>", "lyricMap": "<which lyrics this section covers, or empty>" } ], ' +
            '"totalBars": <sum of all bars>, "notes": "<1-2 sentence overall arc note>" }\n' +
            "Rules: preserve the input section order and bar counts exactly; startsAtBar is " +
            "cumulative; no fields outside this shape; plain text, no markdown.",
        },
        {
          role: "user",
          content:
            (title ? `Song: "${title}"\n` : "") +
            (vibe ? `Vibe: ${vibe}\n` : "") +
            `Sections: ${sections.map((s) => `${s.type}${s.label ? ` (${s.label})` : ""} — ${s.bars} bars`).join(" → ")}\n` +
            (lyrics
              ? `Lyrics:\n${lyrics}\n`
              : "No lyrics provided — plan the arrangement arc from the section layout and vibe.\n") +
            "Write the arrangement plan.",
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1800,
      temperature: 0.7,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const arrangement = arrangementSchema.parse(parseJsonOrThrow(raw, "structure"));

    res.json({
      ...arrangement,
      creditsUsed: STRUCTURE_GENERATE_CREDITS,
      creditsRemaining: remaining,
    });
  } catch (err) {
    /* 3) Refund on ANY failure — no charge without delivery. */
    logger.error({ err, userId: req.userId }, "[wave9a-music] structure generate failed — refunding");
    await refund(req.userId!, STRUCTURE_GENERATE_CREDITS, "Song Structure Builder — Refund", "structure");
    res.status(500).json({
      error: "The structure studio hiccupped — your Visual Bucs were refunded.",
      refunded: true,
    });
  }
});

/* ─── POST /wave9a/lyrics/timing — 50 VB ───
   Estimates per-line start/end times from lyrics text alone (no audio needed)
   so creators can draft a caption plan before audio exists. Distinct from
   CaptionsSection's Whisper audio sync — this is an AI estimate, editable in
   the UI. */
const timingRequestSchema = z.object({
  lyrics: z.string().trim().min(1).max(8000),
  durationSec: z.number().min(5).max(3600),
  title: z.string().trim().max(200).optional().default(""),
});

router.post("/wave9a/lyrics/timing", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = timingRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid lyric timing request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  if (aiUnavailable(res, "the Lyrics-to-Timeline tool")) return;

  const remaining = await chargeOr402(res, req.userId!, LYRICS_TIMING_CREDITS, "Lyrics-to-Timeline");
  if (remaining === null) return;

  const { lyrics, durationSec, title } = parsed.data;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            "You are the timing assistant for Bow Down Visuals — the cheat code for " +
            "content creators. A creator gives you song lyrics and the song's total " +
            "duration in seconds. You estimate sensible per-line start/end times (in " +
            "seconds) as if you were a vocal producer spotting a vocal: respect natural " +
            "breathing gaps, give section breaks (verse/chorus transitions) a beat of " +
            "space, let choruses land with tighter line spacing, and weight longer " +
            "sections with more time. The LAST line's end must be within the total " +
            "duration, and lines must be sequential with no overlaps (small gaps are " +
            "fine). Every line of the provided lyrics must appear exactly once, in " +
            "order, with its original text intact (keep [Verse]/[Chorus] markers as " +
            "their own lines where present). " +
            "Return ONLY valid JSON with this exact shape:\n" +
            '{ "lines": [ { "text": "<lyric line>", "start": <seconds, 1 decimal>, ' +
            '"end": <seconds, 1 decimal> } ] }\n' +
            "Rules: sequential, no overlaps; end > start; plain text, no markdown.",
        },
        {
          role: "user",
          content:
            (title ? `Song: "${title}"\n` : "") +
            `Total duration: ${durationSec} seconds\n` +
            `Lyrics:\n${lyrics}\n\n` +
            "Estimate per-line timings.",
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 2400,
      temperature: 0.4,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const timed = timingResponseSchema.parse(parseJsonOrThrow(raw, "timing"));

    /* Sanitize: clamp to duration, enforce sequential non-overlapping. */
    let cursor = 0;
    const lines = timed.lines.map((l) => {
      const start = Math.max(cursor, Math.min(l.start, durationSec));
      const end = Math.max(start + 0.4, Math.min(l.end, durationSec));
      cursor = end;
      return { text: l.text, start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10 };
    });

    res.json({
      lines,
      durationSec,
      creditsUsed: LYRICS_TIMING_CREDITS,
      creditsRemaining: remaining,
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[wave9a-music] lyric timing failed — refunding");
    await refund(req.userId!, LYRICS_TIMING_CREDITS, "Lyrics-to-Timeline — Refund", "timing");
    res.status(500).json({
      error: "The timing studio hiccupped — your Visual Bucs were refunded.",
      refunded: true,
    });
  }
});

/* ─── Song structures — free CRUD ─── */

const saveStructureSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sections: z.array(sectionInputSchema).min(1).max(24),
  song_id: z.string().uuid().nullable().optional(),
});

router.get("/wave9a/structures", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(wave9aSongStructuresTable)
      .where(eq(wave9aSongStructuresTable.user_id, req.userId!))
      .orderBy(desc(wave9aSongStructuresTable.created_at));
    res.json({ structures: rows });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[wave9a-music] list structures failed");
    res.status(500).json({ error: "Could not load your saved structures." });
  }
});

router.post("/wave9a/structures", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = saveStructureSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid structure.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  try {
    const [row] = await db
      .insert(wave9aSongStructuresTable)
      .values({
        user_id: req.userId!,
        song_id: parsed.data.song_id ?? null,
        name: parsed.data.name,
        sections: parsed.data.sections,
      })
      .returning();
    res.json({ structure: row });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[wave9a-music] save structure failed");
    res.status(500).json({ error: "Could not save this structure." });
  }
});

router.delete("/wave9a/structures/:id", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = uuidParam.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid structure id." });
    return;
  }
  try {
    await db
      .delete(wave9aSongStructuresTable)
      .where(and(eq(wave9aSongStructuresTable.id, parsed.data), eq(wave9aSongStructuresTable.user_id, req.userId!)));
    res.json({ deleted: true });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[wave9a-music] delete structure failed");
    res.status(500).json({ error: "Could not delete this structure." });
  }
});

/* ─── Remix chain versions — free CRUD + promote ─── */

const createVersionSchema = z.object({
  song_id: z.string().uuid().nullable().optional(),
  parent_version_id: z.string().uuid().nullable().optional(),
  label: z.string().trim().min(1).max(60),
  notes: z.string().trim().max(800).optional().default(""),
  audio_url: z.string().trim().max(2000).optional().default(""),
});

const patchVersionSchema = z
  .object({
    label: z.string().trim().min(1).max(60).optional(),
    notes: z.string().trim().max(800).optional(),
    audio_url: z.string().trim().max(2000).optional(),
    promoted: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "Nothing to update.");

router.get("/wave9a/versions", publicApiLimiter, requireAuth, async (req, res) => {
  const songId = typeof req.query.song_id === "string" ? req.query.song_id : "";
  if (songId && !uuidParam.safeParse(songId).success) {
    res.status(400).json({ error: "Invalid song_id." });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(wave9aSongVersionsTable)
      .where(
        songId
          ? and(eq(wave9aSongVersionsTable.user_id, req.userId!), eq(wave9aSongVersionsTable.song_id, songId))
          : eq(wave9aSongVersionsTable.user_id, req.userId!)
      )
      .orderBy(asc(wave9aSongVersionsTable.created_at));
    res.json({ versions: rows });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[wave9a-music] list versions failed");
    res.status(500).json({ error: "Could not load versions." });
  }
});

router.post("/wave9a/versions", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = createVersionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid version.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  try {
    /* Guard: parent must belong to the same user. */
    if (parsed.data.parent_version_id) {
      const [parent] = await db
        .select()
        .from(wave9aSongVersionsTable)
        .where(and(eq(wave9aSongVersionsTable.id, parsed.data.parent_version_id), eq(wave9aSongVersionsTable.user_id, req.userId!)));
      if (!parent) {
        res.status(400).json({ error: "Parent version not found." });
        return;
      }
    }
    const [row] = await db
      .insert(wave9aSongVersionsTable)
      .values({
        user_id: req.userId!,
        song_id: parsed.data.song_id ?? null,
        parent_version_id: parsed.data.parent_version_id ?? null,
        label: parsed.data.label,
        notes: parsed.data.notes ?? "",
        audio_url: parsed.data.audio_url ?? "",
      })
      .returning();
    res.json({ version: row });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[wave9a-music] create version failed");
    res.status(500).json({ error: "Could not create this version." });
  }
});

router.patch("/wave9a/versions/:id", publicApiLimiter, requireAuth, async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  const bodyParsed = patchVersionSchema.safeParse(req.body ?? {});
  if (!idParsed.success || !bodyParsed.success) {
    res.status(400).json({ error: "Invalid version update." });
    return;
  }
  try {
    const [existing] = await db
      .select()
      .from(wave9aSongVersionsTable)
      .where(and(eq(wave9aSongVersionsTable.id, idParsed.data), eq(wave9aSongVersionsTable.user_id, req.userId!)));
    if (!existing) {
      res.status(404).json({ error: "Version not found." });
      return;
    }
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (bodyParsed.data.label !== undefined) patch.label = bodyParsed.data.label;
    if (bodyParsed.data.notes !== undefined) patch.notes = bodyParsed.data.notes;
    if (bodyParsed.data.audio_url !== undefined) patch.audio_url = bodyParsed.data.audio_url;

    /* Promote to master: clear the flag on sibling versions of the same song
       first, so exactly one master exists per song. */
    if (bodyParsed.data.promoted === true) {
      if (existing.song_id) {
        await db
          .update(wave9aSongVersionsTable)
          .set({ promoted: false, updated_at: new Date() })
          .where(and(eq(wave9aSongVersionsTable.user_id, req.userId!), eq(wave9aSongVersionsTable.song_id, existing.song_id)));
      }
      patch.promoted = true;
    } else if (bodyParsed.data.promoted === false) {
      patch.promoted = false;
    }

    const [updated] = await db
      .update(wave9aSongVersionsTable)
      .set(patch)
      .where(and(eq(wave9aSongVersionsTable.id, idParsed.data), eq(wave9aSongVersionsTable.user_id, req.userId!)))
      .returning();
    res.json({ version: updated });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[wave9a-music] update version failed");
    res.status(500).json({ error: "Could not update this version." });
  }
});

router.delete("/wave9a/versions/:id", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = uuidParam.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid version id." });
    return;
  }
  try {
    await db
      .delete(wave9aSongVersionsTable)
      .where(and(eq(wave9aSongVersionsTable.id, parsed.data), eq(wave9aSongVersionsTable.user_id, req.userId!)));
    res.json({ deleted: true });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[wave9a-music] delete version failed");
    res.status(500).json({ error: "Could not delete this version." });
  }
});

export default router;
