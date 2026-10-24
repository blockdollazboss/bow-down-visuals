/**
 * sound-fit.ts — "Sounds that fit this" + starter-stack builder, docked
 * in CREATE (Audio Studio / Sound Library + the beats catalog).
 *
 *  POST /api/sound-fit/fit    { source, limit? } — catalog sounds ranked
 *                             by key + tempo + tag fit against the source
 *  POST /api/sound-fit/stack  { source } — one starter stack: drums /
 *                             bass / melodic layers that mutually fit,
 *                             plus a fitting full beat as foundation
 *  GET  /api/sound-fit/coverage — how much of the catalog is analysed
 *
 * Sources: a catalog beat ({kind:"beat", id}), one of the caller's own
 * songs ({kind:"song", id} — read through its DJ analysis), or explicit
 * metadata the creator is working with right now, e.g. a sample pack
 * they just generated ({kind:"custom", bpm, musicalKey, genre?, tags?}).
 *
 * METADATA HONESTY:
 *  - Fit uses ONLY listed/analysed metadata (beat bpm + musical_key,
 *    song DJ analysis). Items missing BPM or a readable key are
 *    UNANALYSED: excluded from results, counted in `coverage`, and the
 *    counts ride every response so the UI can state them plainly
 *    ("X of Y sounds analysed").
 *  - A source song with no DJ analysis is refused with
 *    code "source_unanalysed" — the creator can run the existing free
 *    DJ analysis (/api/dj/analyze) first. Nothing is estimated here.
 *  - This is metadata fit, NOT audio similarity; responses say so in
 *    `method` so no surface can present it as listening-based.
 *  - Discovery is free: no charge rail exists in this file. Beat prices
 *    are returned exactly as listed; buying stays on the beats rail.
 *
 * Raw SQL (house pattern, same as routes/dj.ts): the drizzle builder's
 * rowMode breaks the pg-mem test harness; raw SQL behaves identically.
 */
import { Router } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { refreshSupabaseStorageUrl } from "../lib/objectStorage";
import {
  buildStarterStack,
  coverageOf,
  parseMusicalKey,
  rankFits,
  type FitCandidate,
  type FitProfile,
} from "../lib/sound-fit";

const router = Router();

const METHOD =
  "Metadata fit only — key, tempo and tags from the listing or DJ analysis. Nothing here listens to the audio.";

interface BeatRow {
  id: string;
  user_id: string;
  title: string;
  audio_url: string;
  audio_path: string | null;
  preview_url: string | null;
  genre: string;
  bpm: number | null;
  musical_key: string | null;
  mood_tags: string[] | null;
  basic_price_cents: number;
  exclusive_sold: boolean;
}

interface SongRow {
  id: string;
  title: string;
  audio_url: string;
  audio_path: string | null;
  genre: string | null;
  bpm: number | null;
  camelot: string | null;
  key_label: string | null;
}

const BEAT_COLUMNS = sql`id, user_id, title, audio_url, audio_path, preview_url, genre, bpm, musical_key, mood_tags, basic_price_cents, exclusive_sold`;

function beatProfile(b: BeatRow): FitProfile {
  const key = parseMusicalKey(b.musical_key);
  return {
    bpm: b.bpm,
    camelot: key?.camelot ?? null,
    keyLabel: key?.label ?? null,
    genre: b.genre || null,
    tags: Array.isArray(b.mood_tags) ? b.mood_tags : [],
  };
}

function songProfile(s: SongRow): FitProfile {
  return {
    bpm: s.bpm,
    camelot: s.camelot,
    keyLabel: s.key_label,
    genre: s.genre,
    tags: [],
  };
}

async function presentAudio(audioUrl: string, audioPath: string | null): Promise<string> {
  if (!audioPath) return audioUrl;
  try {
    return await refreshSupabaseStorageUrl(audioPath);
  } catch {
    return audioUrl;
  }
}

async function loadBeats(): Promise<BeatRow[]> {
  const r = await db.execute(sql`SELECT ${BEAT_COLUMNS} FROM beats ORDER BY created_at DESC LIMIT 900`);
  return r.rows as unknown as BeatRow[];
}

async function loadOwnSongs(userId: string): Promise<SongRow[]> {
  const r = await db.execute(sql`
    SELECT s.id, s.title, s.audio_url, s.audio_path, s.genre,
           a.bpm AS bpm, a.camelot AS camelot, a.key_label AS key_label
    FROM songs s
    LEFT JOIN song_dj_analysis a ON a.song_id = s.id
    WHERE s.user_id = ${userId}
    ORDER BY s.created_at DESC
    LIMIT 300
  `);
  return r.rows as unknown as SongRow[];
}

async function candidatesFor(
  userId: string,
  exclude: { kind: string; id?: string },
): Promise<{ candidates: FitCandidate[]; coverage: ReturnType<typeof coverageOf> & { beats: ReturnType<typeof coverageOf>; ownSongs: ReturnType<typeof coverageOf> } }> {
  const [beats, songs] = await Promise.all([loadBeats(), loadOwnSongs(userId)]);
  const candidates: FitCandidate[] = [];
  for (const b of beats) {
    if (b.exclusive_sold) continue; // sold-exclusive beats are not buyable sounds anymore
    if (exclude.kind === "beat" && exclude.id === b.id) continue;
    candidates.push({
      kind: "beat",
      id: b.id,
      title: b.title,
      audioUrl: await presentAudio(b.preview_url ?? b.audio_url, b.audio_path),
      basicPriceCents: b.basic_price_cents,
      ...beatProfile(b),
    });
  }
  for (const s of songs) {
    if (exclude.kind === "song" && exclude.id === s.id) continue;
    candidates.push({
      kind: "song",
      id: s.id,
      title: s.title,
      audioUrl: await presentAudio(s.audio_url, s.audio_path),
      basicPriceCents: null,
      ...songProfile(s),
    });
  }
  const beatCov = coverageOf(beats.filter((b) => !b.exclusive_sold).map(beatProfile));
  const songCov = coverageOf(songs.map(songProfile));
  return {
    candidates,
    coverage: {
      total: beatCov.total + songCov.total,
      analysed: beatCov.analysed + songCov.analysed,
      unanalysed: beatCov.unanalysed + songCov.unanalysed,
      beats: beatCov,
      ownSongs: songCov,
    },
  };
}

/* ── Source resolution ────────────────────────────────────────────────── */

const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("beat"), id: z.string().uuid() }),
  z.object({ kind: z.literal("song"), id: z.string().uuid() }),
  z.object({
    kind: z.literal("custom"),
    title: z.string().trim().max(120).optional(),
    bpm: z.number().int().min(40).max(260),
    musicalKey: z.string().trim().min(1).max(24),
    genre: z.string().trim().max(60).optional(),
    tags: z.array(z.string().trim().max(40)).max(12).optional(),
  }),
]);

type SourceInput = z.infer<typeof sourceSchema>;

async function resolveSource(
  userId: string,
  input: SourceInput,
): Promise<
  | { ok: true; profile: FitProfile; label: string; excludeId?: string }
  | { ok: false; status: number; error: string; code?: string }
> {
  if (input.kind === "custom") {
    const key = parseMusicalKey(input.musicalKey);
    if (!key) {
      return {
        ok: false, status: 400, code: "source_key_unreadable",
        error: `We couldn't read "${input.musicalKey}" as a musical key, so no fit can be computed — nothing was guessed.`,
      };
    }
    return {
      ok: true,
      label: input.title ?? "Your sound",
      profile: { bpm: input.bpm, camelot: key.camelot, keyLabel: key.label, genre: input.genre ?? null, tags: input.tags ?? [] },
    };
  }
  if (input.kind === "beat") {
    const r = await db.execute(sql`SELECT ${BEAT_COLUMNS} FROM beats WHERE id = ${input.id} LIMIT 1`);
    const beat = (r.rows[0] as unknown as BeatRow) ?? null;
    if (!beat) return { ok: false, status: 404, error: "That beat isn't in the catalog." };
    const profile = beatProfile(beat);
    if (profile.bpm == null || profile.camelot == null) {
      return {
        ok: false, status: 422, code: "source_unanalysed",
        error: "This beat's listing has no BPM or no readable key, so sounds that fit it can't be computed honestly. Pick a sound with both, or add the BPM and key to the listing.",
      };
    }
    return { ok: true, profile, label: beat.title, excludeId: beat.id };
  }
  // kind === "song": the caller's own song, through its DJ analysis.
  const r = await db.execute(sql`
    SELECT s.id, s.title, s.audio_url, s.audio_path, s.genre,
           a.bpm AS bpm, a.camelot AS camelot, a.key_label AS key_label
    FROM songs s
    LEFT JOIN song_dj_analysis a ON a.song_id = s.id
    WHERE s.id = ${input.id} AND s.user_id = ${userId}
    LIMIT 1
  `);
  const song = (r.rows[0] as unknown as SongRow) ?? null;
  if (!song) return { ok: false, status: 404, error: "That song isn't in your library." };
  const profile = songProfile(song);
  if (profile.bpm == null || profile.camelot == null) {
    return {
      ok: false, status: 422, code: "source_unanalysed",
      error: "This song has no DJ analysis yet, so its key and tempo aren't known and no fit can be computed. Run the free DJ analysis on it first (Song Library → DJ Sets), then come back.",
    };
  }
  return { ok: true, profile, label: song.title, excludeId: song.id };
}

function fitDto(item: ReturnType<typeof rankFits>[number]) {
  return {
    kind: item.kind,
    id: item.id,
    title: item.title,
    audioUrl: item.audioUrl,
    bpm: item.bpm,
    keyLabel: item.keyLabel,
    camelot: item.camelot,
    genre: item.genre,
    tags: item.tags,
    basicPriceCents: item.basicPriceCents,
    role: item.role,
    fit: item.fit,
  };
}

/* ── POST /api/sound-fit/fit ──────────────────────────────────────────── */
const fitSchema = z.object({
  source: sourceSchema,
  limit: z.number().int().min(1).max(48).optional(),
});

router.post("/sound-fit/fit", requireAuth, async (req, res) => {
  const parsed = fitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Give a source: a beat id, one of your song ids, or custom bpm + musicalKey." });
    return;
  }
  try {
    const source = await resolveSource(req.userId!, parsed.data.source);
    if (!source.ok) {
      res.status(source.status).json({ error: source.error, ...(source.code ? { code: source.code } : {}) });
      return;
    }
    const { candidates, coverage } = await candidatesFor(req.userId!, {
      kind: parsed.data.source.kind,
      ...(source.excludeId ? { id: source.excludeId } : {}),
    });
    const results = rankFits(source.profile, candidates, parsed.data.limit ?? 24);
    res.json({
      source: { label: source.label, ...source.profile },
      method: METHOD,
      coverage,
      results: results.map(fitDto),
    });
  } catch (err) {
    req.log.error({ err }, "sound-fit: fit failed");
    res.status(500).json({ error: "Could not find fitting sounds. Please try again." });
  }
});

/* ── POST /api/sound-fit/stack ────────────────────────────────────────── */
const stackSchema = z.object({ source: sourceSchema });

router.post("/sound-fit/stack", requireAuth, async (req, res) => {
  const parsed = stackSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Give a source: a beat id, one of your song ids, or custom bpm + musicalKey." });
    return;
  }
  try {
    const source = await resolveSource(req.userId!, parsed.data.source);
    if (!source.ok) {
      res.status(source.status).json({ error: source.error, ...(source.code ? { code: source.code } : {}) });
      return;
    }
    const { candidates, coverage } = await candidatesFor(req.userId!, {
      kind: parsed.data.source.kind,
      ...(source.excludeId ? { id: source.excludeId } : {}),
    });
    const stack = buildStarterStack(source.profile, candidates);
    res.json({
      source: { label: source.label, ...source.profile },
      method: METHOD,
      coverage,
      stack: {
        slots: stack.slots.map((s) => ({ role: s.role, item: fitDto(s.item) })),
        missing: stack.missing,
        fillSuggestion: stack.fillSuggestion,
      },
    });
  } catch (err) {
    req.log.error({ err }, "sound-fit: stack failed");
    res.status(500).json({ error: "Could not build a stack. Please try again." });
  }
});

/* ── GET /api/sound-fit/coverage ──────────────────────────────────────── */
router.get("/sound-fit/coverage", requireAuth, async (req, res) => {
  try {
    const { coverage } = await candidatesFor(req.userId!, { kind: "none" });
    res.json({ method: METHOD, coverage });
  } catch (err) {
    req.log.error({ err }, "sound-fit: coverage failed");
    res.status(500).json({ error: "Could not load catalog coverage. Please try again." });
  }
});

export default router;
