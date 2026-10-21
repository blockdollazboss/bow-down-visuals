/**
 * dj.ts — DJ Set-Prep Pack, docked in the song library.
 *
 *  GET    /api/dj/library                 my songs + their DJ analysis
 *  POST   /api/dj/analyze                 { songIds, force? } — BPM + key
 *                                         + Camelot per owned song (free:
 *                                         prep work on your own tracks)
 *  GET    /api/dj/crates                  my crates, tracks in play order
 *  POST   /api/dj/crates                  { name }
 *  PATCH  /api/dj/crates/:id              { name?, songIds? } — rename
 *                                         and/or replace membership+order
 *  DELETE /api/dj/crates/:id
 *  POST   /api/dj/crates/:id/propose-order  Thy Cheat Code's harmonic
 *                                         draft order — a PROPOSAL only;
 *                                         the crate changes when the
 *                                         creator saves it via PATCH
 *  GET    /api/dj/crates/:id/export?format=rekordbox|m3u
 *
 * Owner-scoping is absolute: analysis, crates, and exports only ever
 * touch the caller's own songs. A crate PATCH naming anyone else's
 * song is refused whole — never partially applied.
 *
 * Analysis is an estimate and is labeled as one end-to-end:
 * key_confidence / bpm_confidence are stored (migration 0195) and
 * returned with every number, so the UI can say "rough guess" when
 * that's what it is.
 *
 * Raw-SQL route (house pattern): the drizzle query builder emits
 * rowMode:'array', which the pg-mem test harness cannot drive — raw
 * SQL behaves identically on both.
 */
import { Router } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import {
  parseSupabaseStorageRefBucketed,
  downloadStorageObjectBuffer,
  refreshSupabaseStorageUrl,
} from "../lib/objectStorage";
import { analyzeTrackAudio, tonalityFor, ANALYZER_VERSION } from "../lib/track-analysis";
import {
  proposeSetOrder,
  buildRekordboxXml,
  buildM3u,
  type DjTrackMeta,
} from "../lib/dj-set";

const router = Router();

interface SongRow {
  id: string;
  user_id: string;
  title: string;
  audio_url: string;
  audio_path: string | null;
  source: string;
  duration_sec: string | null;
  created_at: Date | string;
}

interface AnalysisRow {
  song_id: string;
  user_id: string;
  bpm: number | null;
  bpm_confidence: string | null;
  key_root: number | null;
  key_mode: string | null;
  key_label: string | null;
  camelot: string | null;
  key_score: number | null;
  key_confidence: string | null;
  duration_sec: number | null;
  analyzed_at: Date | string;
  analyzer_version: number;
}

interface CrateRow {
  id: string;
  user_id: string;
  name: string;
  created_at: Date | string;
  updated_at: Date | string;
}

const SONG_COLUMNS = sql`s.id, s.user_id, s.title, s.audio_url, s.audio_path, s.source, s.duration_sec, s.created_at`;
const ANALYSIS_COLUMNS = sql`song_id, user_id, bpm, bpm_confidence, key_root, key_mode, key_label, camelot, key_score, key_confidence, duration_sec, analyzed_at, analyzer_version`;
const CRATE_COLUMNS = sql`id, user_id, name, created_at, updated_at`;

function inList(ids: string[]) {
  return sql.join(ids.map((id) => sql`${id}`), sql`, `);
}

function analysisDto(a: AnalysisRow | null) {
  if (!a) return null;
  return {
    bpm: a.bpm,
    bpmConfidence: a.bpm_confidence,
    keyLabel: a.key_label,
    camelot: a.camelot,
    keyConfidence: a.key_confidence,
    keyScore: a.key_score,
    durationSec: a.duration_sec,
    analyzedAt: a.analyzed_at,
  };
}

function trackMeta(song: SongRow, a: AnalysisRow | null): DjTrackMeta {
  const songDur = song.duration_sec ? Number.parseInt(song.duration_sec, 10) : NaN;
  return {
    songId: song.id,
    title: song.title,
    audioUrl: song.audio_url,
    durationSec: a?.duration_sec ?? (Number.isFinite(songDur) ? songDur : null),
    bpm: a?.bpm ?? null,
    keyLabel: a?.key_label ?? null,
    camelot: a?.camelot ?? null,
    tonality:
      a?.key_root != null && (a.key_mode === "major" || a.key_mode === "minor")
        ? tonalityFor(a.key_root, a.key_mode)
        : null,
    keyConfidence: (a?.key_confidence as DjTrackMeta["keyConfidence"]) ?? null,
  };
}

async function downloadSongAudio(song: SongRow): Promise<Buffer> {
  // Same read path as routes/songs.ts: stable storage ref first (R2-first
  // dual-stack), stored URL as fallback.
  if (song.audio_path) {
    const parsed = parseSupabaseStorageRefBucketed(song.audio_path);
    if (parsed) {
      const buf = await downloadStorageObjectBuffer(parsed);
      if (buf) return buf;
    }
  }
  const r = await fetch(song.audio_url);
  if (!r.ok) throw new Error(`Could not download song audio (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

async function getOwnedSong(userId: string, songId: string): Promise<SongRow | null> {
  const r = await db.execute(sql`
    SELECT ${SONG_COLUMNS} FROM songs s
    WHERE s.id = ${songId} AND s.user_id = ${userId}
    LIMIT 1
  `);
  return (r.rows[0] as unknown as SongRow) ?? null;
}

async function getOwnedCrate(userId: string, crateId: string): Promise<CrateRow | null> {
  const r = await db.execute(sql`
    SELECT ${CRATE_COLUMNS} FROM dj_crates
    WHERE id = ${crateId} AND user_id = ${userId}
    LIMIT 1
  `);
  return (r.rows[0] as unknown as CrateRow) ?? null;
}

/** Full crate DTO: crate + its tracks in play order, with DJ metadata. */
async function crateDto(crate: CrateRow) {
  const itemsRes = await db.execute(sql`
    SELECT song_id, position FROM dj_crate_items
    WHERE crate_id = ${crate.id}
    ORDER BY position ASC
  `);
  const items = itemsRes.rows as unknown as Array<{ song_id: string; position: number }>;
  const songIds = items.map((i) => i.song_id);
  const songById = new Map<string, SongRow>();
  const analysisById = new Map<string, AnalysisRow>();
  if (songIds.length > 0) {
    const songsRes = await db.execute(sql`
      SELECT ${SONG_COLUMNS} FROM songs s
      WHERE s.id IN (${inList(songIds)})
    `);
    for (const s of songsRes.rows as unknown as SongRow[]) songById.set(s.id, s);
    const analysesRes = await db.execute(sql`
      SELECT ${ANALYSIS_COLUMNS} FROM song_dj_analysis
      WHERE song_id IN (${inList(songIds)})
    `);
    for (const a of analysesRes.rows as unknown as AnalysisRow[]) analysisById.set(a.song_id, a);
  }
  return {
    id: crate.id,
    name: crate.name,
    createdAt: crate.created_at,
    updatedAt: crate.updated_at,
    tracks: items
      .filter((i) => songById.has(i.song_id))
      .map((i) => {
        const song = songById.get(i.song_id)!;
        const a = analysisById.get(i.song_id) ?? null;
        return {
          ...trackMeta(song, a),
          position: i.position,
          analysis: analysisDto(a),
        };
      }),
  };
}

/* ── GET /api/dj/library ──────────────────────────────────────────────── */
router.get("/dj/library", requireAuth, async (req, res) => {
  try {
    const r = await db.execute(sql`
      SELECT s.id, s.title, s.audio_url, s.audio_path, s.source, s.duration_sec, s.created_at,
             a.bpm, a.bpm_confidence, a.key_label, a.camelot, a.key_confidence,
             a.key_score, a.duration_sec AS a_duration_sec, a.analyzed_at, a.song_id AS a_song_id,
             a.user_id AS a_user_id, a.key_root, a.key_mode, a.analyzer_version
      FROM songs s
      LEFT JOIN song_dj_analysis a ON a.song_id = s.id
      WHERE s.user_id = ${req.userId!}
      ORDER BY s.created_at DESC
      LIMIT 100
    `);
    const tracks = await Promise.all(
      (r.rows as unknown as Array<Record<string, unknown>>).map(async (row) => {
        let audioUrl = row["audio_url"] as string;
        const audioPath = row["audio_path"] as string | null;
        if (audioPath) {
          try {
            audioUrl = await refreshSupabaseStorageUrl(audioPath);
          } catch {
            /* keep the stored URL */
          }
        }
        const analysis: AnalysisRow | null = row["a_song_id"]
          ? {
              song_id: row["a_song_id"] as string,
              user_id: row["a_user_id"] as string,
              bpm: row["bpm"] as number | null,
              bpm_confidence: row["bpm_confidence"] as string | null,
              key_root: row["key_root"] as number | null,
              key_mode: row["key_mode"] as string | null,
              key_label: row["key_label"] as string | null,
              camelot: row["camelot"] as string | null,
              key_score: row["key_score"] as number | null,
              key_confidence: row["key_confidence"] as string | null,
              duration_sec: row["a_duration_sec"] as number | null,
              analyzed_at: row["analyzed_at"] as Date,
              analyzer_version: row["analyzer_version"] as number,
            }
          : null;
        return {
          id: row["id"] as string,
          title: row["title"] as string,
          audioUrl,
          source: row["source"] as string,
          durationSec: row["duration_sec"] as string | null,
          createdAt: row["created_at"] as Date,
          analysis: analysisDto(analysis),
        };
      }),
    );
    res.json({ tracks });
  } catch (err) {
    req.log.error({ err }, "dj: library failed");
    res.status(500).json({ error: "Could not load your tracks. Please try again." });
  }
});

/* ── POST /api/dj/analyze ─────────────────────────────────────────────── */
const analyzeSchema = z.object({
  songIds: z.array(z.string().uuid()).min(1).max(20),
  force: z.boolean().optional(),
});

router.post("/dj/analyze", requireAuth, async (req, res) => {
  const parsed = analyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "songIds must be 1–20 of your song ids." });
    return;
  }
  const { songIds, force } = parsed.data;
  const results: Array<Record<string, unknown>> = [];
  for (const songId of songIds) {
    const song = await getOwnedSong(req.userId!, songId);
    if (!song) {
      results.push({ songId, status: "not_found" });
      continue;
    }
    const existingRes = await db.execute(sql`
      SELECT ${ANALYSIS_COLUMNS} FROM song_dj_analysis
      WHERE song_id = ${songId}
      LIMIT 1
    `);
    const existing = (existingRes.rows[0] as unknown as AnalysisRow) ?? null;
    if (existing && !force && existing.analyzer_version === ANALYZER_VERSION) {
      results.push({ songId, status: "cached", analysis: analysisDto(existing) });
      continue;
    }
    try {
      const audio = await downloadSongAudio(song);
      const result = await analyzeTrackAudio(audio);
      const upsert = await db.execute(sql`
        INSERT INTO song_dj_analysis (
          song_id, user_id, bpm, bpm_confidence, key_root, key_mode,
          key_label, camelot, key_score, key_confidence, duration_sec,
          analyzed_at, analyzer_version
        ) VALUES (
          ${songId}, ${req.userId!}, ${result.bpm}, ${result.bpmConfidence},
          ${result.key?.root ?? null}, ${result.key?.mode ?? null},
          ${result.key?.label ?? null}, ${result.key?.camelot ?? null},
          ${result.key?.score ?? null}, ${result.key?.confidence ?? null},
          ${Math.round(result.durationSec)}, now(), ${ANALYZER_VERSION}
        )
        ON CONFLICT (song_id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          bpm = EXCLUDED.bpm,
          bpm_confidence = EXCLUDED.bpm_confidence,
          key_root = EXCLUDED.key_root,
          key_mode = EXCLUDED.key_mode,
          key_label = EXCLUDED.key_label,
          camelot = EXCLUDED.camelot,
          key_score = EXCLUDED.key_score,
          key_confidence = EXCLUDED.key_confidence,
          duration_sec = EXCLUDED.duration_sec,
          analyzed_at = EXCLUDED.analyzed_at,
          analyzer_version = EXCLUDED.analyzer_version
        RETURNING ${ANALYSIS_COLUMNS}
      `);
      const row = upsert.rows[0] as unknown as AnalysisRow;
      results.push({ songId, status: "analyzed", analysis: analysisDto(row) });
    } catch (err) {
      req.log.error({ err, songId }, "dj: analysis failed");
      results.push({
        songId,
        status: "failed",
        error: err instanceof Error ? err.message : "Analysis failed.",
      });
    }
  }
  res.json({ results });
});

/* ── Crates ───────────────────────────────────────────────────────────── */
router.get("/dj/crates", requireAuth, async (req, res) => {
  try {
    const r = await db.execute(sql`
      SELECT ${CRATE_COLUMNS} FROM dj_crates
      WHERE user_id = ${req.userId!}
      ORDER BY created_at DESC
    `);
    const crates = r.rows as unknown as CrateRow[];
    res.json({ crates: await Promise.all(crates.map(crateDto)) });
  } catch (err) {
    req.log.error({ err }, "dj: list crates failed");
    res.status(500).json({ error: "Could not load your crates. Please try again." });
  }
});

const crateNameSchema = z.object({ name: z.string().trim().min(1).max(80) });

router.post("/dj/crates", requireAuth, async (req, res) => {
  const parsed = crateNameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Give the crate a name (1–80 characters)." });
    return;
  }
  try {
    const r = await db.execute(sql`
      INSERT INTO dj_crates (user_id, name)
      VALUES (${req.userId!}, ${parsed.data.name})
      RETURNING ${CRATE_COLUMNS}
    `);
    const crate = r.rows[0] as unknown as CrateRow;
    res.json({ crate: await crateDto(crate) });
  } catch (err) {
    req.log.error({ err }, "dj: create crate failed");
    res.status(500).json({ error: "Could not create the crate. Please try again." });
  }
});

const cratePatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  songIds: z.array(z.string().uuid()).max(200).optional(),
});

router.patch("/dj/crates/:id", requireAuth, async (req, res) => {
  const parsed = cratePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "name must be 1–80 characters; songIds must be your song ids." });
    return;
  }
  const crate = await getOwnedCrate(req.userId!, String(req.params["id"]));
  if (!crate) {
    res.status(404).json({ error: "Crate not found." });
    return;
  }
  try {
    if (parsed.data.songIds) {
      // Dedupe, preserving the creator's order — position IS the order.
      const ordered = [...new Set(parsed.data.songIds)];
      if (ordered.length > 0) {
        const ownedRes = await db.execute(sql`
          SELECT id FROM songs
          WHERE user_id = ${req.userId!} AND id IN (${inList(ordered)})
        `);
        if (ownedRes.rows.length !== ordered.length) {
          res.status(400).json({
            error: "A crate can only hold your own tracks — one of those songs isn't in your library.",
            code: "foreign_song",
          });
          return;
        }
      }
      await db.execute(sql`DELETE FROM dj_crate_items WHERE crate_id = ${crate.id}`);
      if (ordered.length > 0) {
        const tuples = ordered.map((songId, i) => sql`(${crate.id}, ${songId}, ${i})`);
        await db.execute(sql`
          INSERT INTO dj_crate_items (crate_id, song_id, position)
          VALUES ${sql.join(tuples, sql`, `)}
        `);
      }
    }
    if (parsed.data.name) {
      await db.execute(sql`
        UPDATE dj_crates SET name = ${parsed.data.name}, updated_at = now()
        WHERE id = ${crate.id}
      `);
    } else if (parsed.data.songIds) {
      await db.execute(sql`
        UPDATE dj_crates SET updated_at = now()
        WHERE id = ${crate.id}
      `);
    }
    const fresh = await getOwnedCrate(req.userId!, crate.id);
    res.json({ crate: await crateDto(fresh!) });
  } catch (err) {
    req.log.error({ err }, "dj: update crate failed");
    res.status(500).json({ error: "Could not save the crate. Please try again." });
  }
});

router.delete("/dj/crates/:id", requireAuth, async (req, res) => {
  const crate = await getOwnedCrate(req.userId!, String(req.params["id"]));
  if (!crate) {
    res.status(404).json({ error: "Crate not found." });
    return;
  }
  try {
    await db.execute(sql`DELETE FROM dj_crate_items WHERE crate_id = ${crate.id}`);
    await db.execute(sql`DELETE FROM dj_crates WHERE id = ${crate.id}`);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "dj: delete crate failed");
    res.status(500).json({ error: "Could not delete the crate. Please try again." });
  }
});

/* ── POST /api/dj/crates/:id/propose-order ────────────────────────────── */
router.post("/dj/crates/:id/propose-order", requireAuth, async (req, res) => {
  const crate = await getOwnedCrate(req.userId!, String(req.params["id"]));
  if (!crate) {
    res.status(404).json({ error: "Crate not found." });
    return;
  }
  try {
    const dto = await crateDto(crate);
    const proposal = proposeSetOrder(dto.tracks);
    res.json({ proposal });
  } catch (err) {
    req.log.error({ err }, "dj: propose order failed");
    res.status(500).json({ error: "Could not work out an order. Please try again." });
  }
});

/* ── GET /api/dj/crates/:id/export ────────────────────────────────────── */
router.get("/dj/crates/:id/export", requireAuth, async (req, res) => {
  const format = String(req.query["format"] ?? "");
  if (format !== "rekordbox" && format !== "m3u") {
    res.status(400).json({ error: "format must be rekordbox or m3u." });
    return;
  }
  const crate = await getOwnedCrate(req.userId!, String(req.params["id"]));
  if (!crate) {
    res.status(404).json({ error: "Crate not found." });
    return;
  }
  try {
    const dto = await crateDto(crate);
    if (dto.tracks.length === 0) {
      res.status(400).json({ error: "This crate is empty — add tracks before exporting." });
      return;
    }
    const safeName = crate.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "crate";
    if (format === "rekordbox") {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.rekordbox.xml"`);
      res.send(buildRekordboxXml(crate.name, dto.tracks));
    } else {
      res.setHeader("Content-Type", "audio/x-mpegurl; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.m3u"`);
      res.send(buildM3u(crate.name, dto.tracks));
    }
  } catch (err) {
    req.log.error({ err }, "dj: export failed");
    res.status(500).json({ error: "Export failed. Please try again." });
  }
});

export default router;
