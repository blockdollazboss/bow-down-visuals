import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middlewares/require-auth";
import {
  db,
  beatSamplesTable,
  beatSampleExtensionForContentType,
  beatSampleSoundId,
  BEAT_SAMPLE_KINDS,
  BEAT_SAMPLE_MAX_BYTES,
  type BeatSample,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  isR2Configured,
  r2GetPresignedPutUrl,
  r2PublicUrl,
  r2ObjectSize,
  r2Delete,
} from "../lib/r2-client";
import { logger } from "../lib/logger";

const router = Router();

/* ─── Beat Samples — the durable Beat Studio sample library ──────────────
   A sound a creator loads onto a sequencer track used to live only in
   the browser session (the project kept the id + name; the bytes were
   memory-only, so a reload fell back to the synth voice). This rail
   makes uploads durable on the site's EXISTING storage layer (R2 via
   lib/r2-client — the same client behind /api/r2/*), with a metadata
   row per sample in beat_samples:

     POST   /api/beat-samples            — declare a sample { name, kind,
                                           contentType, sizeBytes } →
                                           row (pending) + presigned PUT
     POST   /api/beat-samples/:id/complete — confirm the bytes landed
                                           (HEAD size check) → ready
     GET    /api/beat-samples            — my ready samples
     GET    /api/beat-samples/:id        — one of my ready samples
     DELETE /api/beat-samples/:id        — remove mine (row + object)

   House rules, fail-closed: every route is requireAuth; every query
   is scoped to req.userId, so another account's sample reads as "not
   found", never as data. Format/size validation mirrors the Beat
   Studio loader's acceptance (BEAT_SAMPLE_CONTENT_TYPES /
   BEAT_SAMPLE_MAX_BYTES in the schema module). No charges anywhere —
   loading your own sounds is a free manual tool, and nothing here
   touches the 300 VB AI beat rail. */

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(BEAT_SAMPLE_KINDS),
  contentType: z.string().trim().min(1).max(100),
  sizeBytes: z.number().int().positive().max(BEAT_SAMPLE_MAX_BYTES),
});

function paramId(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function sampleDto(row: BeatSample) {
  return {
    id: row.id,
    soundId: beatSampleSoundId(row.id),
    name: row.name,
    kind: row.kind,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    // Only a ready sample's URL is handed out — a pending row's object
    // may not exist yet, and a URL that 404s would read as a broken
    // promise in the picker.
    ...(row.status === "ready" ? { url: r2PublicUrl(row.storageKey) } : {}),
    createdAt: row.createdAt,
  };
}

/** One of the CALLER's rows by id (any status), or null. */
async function findOwnSample(userId: string, id: string): Promise<BeatSample | null> {
  const rows = await db
    .select()
    .from(beatSamplesTable)
    .where(and(eq(beatSamplesTable.id, id), eq(beatSamplesTable.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/* POST /api/beat-samples — declare + mint the presigned PUT */
router.post("/beat-samples", requireAuth, async (req, res) => {
  try {
    if (!isR2Configured()) {
      res.status(503).json({ error: "Sample storage isn't available right now — your sound still loads for this session." });
      return;
    }
    const parsed = CreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "A sample needs a name, a track kind, an audio file type, and a size within the limit." });
      return;
    }
    const { name, kind, sizeBytes } = parsed.data;
    const contentType = parsed.data.contentType.toLowerCase();
    const ext = beatSampleExtensionForContentType(contentType);
    if (!ext) {
      res.status(400).json({ error: "That file type can't be saved as a sound — use a WAV, MP3, OGG, FLAC, M4A, AAC, WebM, or AIFF file." });
      return;
    }
    const userId = req.userId!;
    const id = randomUUID();
    const storageKey = `${userId}/beat-samples/${id}.${ext}`;
    await db.insert(beatSamplesTable).values({
      id,
      userId,
      name,
      kind,
      storageKey,
      contentType,
      sizeBytes,
      status: "pending",
    });
    let uploadUrl: string;
    try {
      uploadUrl = await r2GetPresignedPutUrl(storageKey, contentType);
    } catch (err) {
      // No orphan pending row for a PUT the client can never make.
      await db.delete(beatSamplesTable).where(eq(beatSamplesTable.id, id)).catch(() => {});
      throw err;
    }
    const row = await findOwnSample(userId, id);
    res.status(201).json({ sample: row ? sampleDto(row) : null, uploadUrl });
  } catch (err) {
    logger.error("beat-samples create failed");
    res.status(500).json({ error: "Couldn't start saving that sound — please try again." });
  }
});

/* POST /api/beat-samples/:id/complete — verify the bytes, turn ready */
router.post("/beat-samples/:id/complete", requireAuth, async (req, res) => {
  try {
    if (!isR2Configured()) {
      res.status(503).json({ error: "Sample storage isn't available right now." });
      return;
    }
    const userId = req.userId!;
    const row = await findOwnSample(userId, paramId(req.params.id));
    if (!row) {
      res.status(404).json({ error: "That sound wasn't found in your library." });
      return;
    }
    if (row.status === "ready") {
      res.json({ sample: sampleDto(row) });
      return;
    }
    const head = await r2ObjectSize(row.storageKey);
    if (!head) {
      res.status(409).json({ error: "We couldn't find the uploaded file — please upload that sound again." });
      return;
    }
    if (head.size !== row.sizeBytes) {
      // The landed object is not the file that was declared — remove
      // both so the library never carries a mismatched sample.
      await r2Delete(row.storageKey).catch(() => {});
      await db.delete(beatSamplesTable).where(eq(beatSamplesTable.id, row.id));
      res.status(409).json({ error: "The file that arrived doesn't match the one you picked — please upload that sound again." });
      return;
    }
    const updated = await db
      .update(beatSamplesTable)
      .set({ status: "ready", updatedAt: new Date() })
      .where(and(eq(beatSamplesTable.id, row.id), eq(beatSamplesTable.userId, userId)))
      .returning();
    res.json({ sample: updated[0] ? sampleDto(updated[0]) : null });
  } catch (err) {
    logger.error("beat-samples complete failed");
    res.status(500).json({ error: "Couldn't finish saving that sound — please try again." });
  }
});

/* GET /api/beat-samples — my ready samples, newest first */
router.get("/beat-samples", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(beatSamplesTable)
      .where(
        and(
          eq(beatSamplesTable.userId, req.userId!),
          eq(beatSamplesTable.status, "ready"),
        ),
      )
      .orderBy(desc(beatSamplesTable.createdAt));
    res.json({ samples: rows.map(sampleDto) });
  } catch (err) {
    logger.error("beat-samples list failed");
    res.status(500).json({ error: "Couldn't load your sound library — please try again." });
  }
});

/* GET /api/beat-samples/:id — one of my ready samples */
router.get("/beat-samples/:id", requireAuth, async (req, res) => {
  try {
    const row = await findOwnSample(req.userId!, paramId(req.params.id));
    if (!row || row.status !== "ready") {
      res.status(404).json({ error: "That sound wasn't found in your library." });
      return;
    }
    res.json({ sample: sampleDto(row) });
  } catch (err) {
    logger.error("beat-samples get failed");
    res.status(500).json({ error: "Couldn't load that sound — please try again." });
  }
});

/* DELETE /api/beat-samples/:id — remove mine (row + stored object) */
router.delete("/beat-samples/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const row = await findOwnSample(userId, paramId(req.params.id));
    if (!row) {
      res.status(404).json({ error: "That sound wasn't found in your library." });
      return;
    }
    try {
      await r2Delete(row.storageKey);
    } catch (err) {
      // The library row still goes: a stranded object with no row is
      // invisible storage waste, while a row pointing at a deleted
      // object would be a broken sound in the picker.
      logger.error("beat-samples object delete failed; removing row anyway");
    }
    await db
      .delete(beatSamplesTable)
      .where(and(eq(beatSamplesTable.id, row.id), eq(beatSamplesTable.userId, userId)));
    res.json({ ok: true });
  } catch (err) {
    logger.error("beat-samples delete failed");
    res.status(500).json({ error: "Couldn't remove that sound — please try again." });
  }
});

export default router;
