/**
 * song-remix.ts — Song Remix + Replace Section (Suno parity).
 *
 *  POST /api/song-remix            new arrangement of a song: same lyrics,
 *                                  same vibe, fresh production. Body:
 *                                  { songId?, audioUrl?, title?, lyrics?,
 *                                    genre?, mood?, vocalGender?,
 *                                    instrumental?, styleTweak?,
 *                                    lengthSeconds? }
 *  POST /api/song-replace-section  regenerate ONE tagged section
 *                                  ([Verse 2], [Chorus], …) and splice it
 *                                  back into the original with an ffmpeg
 *                                  crossfade (same acrossfade pattern as the
 *                                  song-extend pipeline). Body:
 *                                  { songId?, audioUrl?, section?,
 *                                    sectionIndex?, totalSections?,
 *                                    startSec?, endSec?, sectionLyrics?,
 *                                    styleTweak?, title?, genre?, mood?,
 *                                    vocalGender?, instrumental? }
 *
 * Pricing: 400 Visual Bucs (remix) / 300 Visual Bucs (replace section).
 * 402 pre-check -> charge upfront -> automatic refund on failure, same
 * ledger pattern as the song-library remix in songs.ts.
 *
 * Music comes from the ElevenLabs music API (music_v2_5, env-overridable
 * via ELEVENLABS_MUSIC_MODEL). Without ELEVENLABS_API_KEY both routes
 * fail with a clear 503 naming the missing env var — no silent fallback.
 */
import { Router, type Response } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { db, songsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
  OutOfCreditsError,
  LedgerWriteError,
} from "../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../lib/generation-stored-results";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
  parseSupabaseStorageRefBucketed,
  downloadStorageObjectBuffer,
} from "../lib/objectStorage";

const router = Router();
const execFileAsync = promisify(execFile);

/** Site credits for a full-song remix (fresh arrangement, same lyrics). */
const REMIX_CREDIT_COST = 400;
/** Site credits for regenerating a single song section. */
const REPLACE_CREDIT_COST = 300;
/** Crossfade length (seconds) at each splice point — matches the song-extend pipeline. */
const SPLICE_FADE_SEC = 3;
/** New-segment bounds for section replacement (ElevenLabs music API). */
const MIN_SEG_MS = 10_000;
const MAX_SEG_MS = 120_000;
/** Full-song remix bounds. */
const MIN_SONG_MS = 10_000;
const MAX_SONG_MS = 300_000;

/* ─── helpers ─────────────────────────────────────────────────────────── */

function missingAudioKey(res: Response): string | null {
  const apiKey = process.env["ELEVENLABS_API_KEY"];
  if (!apiKey) {
    res.status(503).json({
      error: "Song remix is unavailable: ELEVENLABS_API_KEY is not set on this server.",
      code: "audio_gen_unavailable",
    });
    return null;
  }
  return apiKey;
}

const songRefSchema = z.object({
  songId: z.string().uuid().optional(),
  audioUrl: z.string().url().max(2000).optional(),
});

const remixSchema = songRefSchema.extend({
  title: z.string().max(200).optional(),
  lyrics: z.string().max(8000).optional(),
  genre: z.string().max(100).optional(),
  mood: z.string().max(100).optional(),
  vocalGender: z.string().max(20).optional(),
  instrumental: z.boolean().optional(),
  styleTweak: z.string().max(500).optional(),
  lengthSeconds: z.number().optional(),
});

const replaceSchema = songRefSchema.extend({
  section: z.string().max(80).optional(),
  /** Even-split estimate: which tagged section (0-based) out of how many. */
  sectionIndex: z.number().int().min(0).max(40).optional(),
  totalSections: z.number().int().min(1).max(40).optional(),
  /** Explicit splice bounds (seconds) — take precedence over the estimate. */
  startSec: z.number().min(0).max(36000).optional(),
  endSec: z.number().min(0).max(36000).optional(),
  sectionLyrics: z.string().max(4000).optional(),
  styleTweak: z.string().max(500).optional(),
  title: z.string().max(200).optional(),
  genre: z.string().max(100).optional(),
  mood: z.string().max(100).optional(),
  vocalGender: z.string().max(20).optional(),
  instrumental: z.boolean().optional(),
});

async function findSong(userId: string, songId: string) {
  const [song] = await db
    .select()
    .from(songsTable)
    .where(and(eq(songsTable.id, songId), eq(songsTable.user_id, userId)))
    .limit(1);
  return song ?? null;
}

async function downloadAudio(song: typeof songsTable.$inferSelect | null, audioUrl?: string): Promise<Buffer> {
  if (song?.audio_path) {
    const parsed = parseSupabaseStorageRefBucketed(song.audio_path);
    if (parsed) {
      const buf = await downloadStorageObjectBuffer(parsed);
      if (buf) return buf;
    }
  }
  const url = song?.audio_url || audioUrl;
  if (!url) throw new Error("No audio to work from — pass songId or audioUrl.");
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`Could not download song audio (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

async function probeDurationSec(buf: Buffer): Promise<number> {
  const id = randomUUID();
  const p = join(tmpdir(), `${id}-probe.mp3`);
  try {
    await writeFile(p, buf);
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", p,
    ], { timeout: 30_000 });
    const d = Number(String(stdout).trim());
    if (!Number.isFinite(d) || d <= 0) throw new Error("unreadable duration");
    return d;
  } finally {
    await unlink(p).catch(() => {});
  }
}

interface MusicGenOpts {
  prompt: string;
  lengthMs: number;
  instrumental?: boolean;
  vocalGender?: string;
  apiKey: string;
}

/** One ElevenLabs music generation, returned as an MP3 buffer. */
async function generateMusicSegment({ prompt, lengthMs, instrumental, vocalGender, apiKey }: MusicGenOpts): Promise<Buffer> {
  const musicModel = process.env["ELEVENLABS_MUSIC_MODEL"] ?? "music_v2_5";
  let fullPrompt = prompt.slice(0, 2000);
  if (!instrumental && (vocalGender === "male" || vocalGender === "female")) {
    fullPrompt += ` ${vocalGender} vocals.`;
  }
  const res = await fetch("https://api.elevenlabs.io/v1/music", {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: fullPrompt,
      music_length_ms: lengthMs,
      model_id: musicModel,
      force_instrumental: instrumental === true,
    }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Music provider error (${res.status}): ${errText.slice(0, 200)}`);
  }
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length === 0) throw new Error("Music provider returned empty audio.");
  return audio;
}

async function saveSongAudio(
  userId: string,
  audio: Buffer,
  title: string,
  opts: { source: "song-remix" | "section-replace"; parentSongId?: string },
): Promise<typeof songsTable.$inferSelect> {
  const objectName = `songs/${userId}/${randomUUID()}.mp3`;
  const storageRef = await uploadMediaToSupabaseStorage(objectName, audio, "audio/mpeg");
  const url = await refreshSupabaseStorageUrl(storageRef);
  const [song] = await db
    .insert(songsTable)
    .values({
      user_id: userId,
      title: title.slice(0, 200),
      audio_url: url,
      audio_path: storageRef,
      source: opts.source,
      parent_song_id: opts.parentSongId ?? null,
    })
    .returning();
  return song;
}

/**
 * Splice a regenerated segment into the original song: A=[0,start+fade],
 * B=segment (exactly section length), C=[end-fade,dur]. acrossfade joins
 * with the same 3s triangular crossfade the extend pipeline uses, so the
 * total duration is preserved.
 */
async function spliceSection(
  original: Buffer,
  segment: Buffer,
  startSec: number,
  endSec: number,
): Promise<Buffer> {
  const id = randomUUID();
  const origPath = join(tmpdir(), `${id}-orig.mp3`);
  const segPath = join(tmpdir(), `${id}-seg.mp3`);
  const outPath = join(tmpdir(), `${id}-out.mp3`);
  const fade = SPLICE_FADE_SEC;
  const sectionDur = endSec - startSec;
  try {
    await writeFile(origPath, original);
    await writeFile(segPath, segment);
    // Probe the original duration from the buffer we already have.
    const dur = await probeDurationSec(original);
    const aEnd = Math.min(startSec + fade, dur);
    const cStart = Math.max(endSec - fade, 0);
    const hasC = endSec < dur - 0.5;

    const args: string[] = [
      "-y",
      "-ss", "0", "-t", String(aEnd), "-i", origPath,
      "-i", segPath,
    ];
    if (hasC) args.push("-ss", String(cStart), "-i", origPath);

    // Force the replacement segment to exactly the section length so the
    // song's total duration is preserved through both crossfades.
    const segFilter = `[1:a]atrim=0:${sectionDur},asetpts=PTS-STARTPTS,apad=whole_dur=${sectionDur},atrim=0:${sectionDur}[b]`;
    let filter: string;
    if (hasC) {
      filter =
        `${segFilter};` +
        `[0:a][b]acrossfade=d=${fade}:c1=tri:c2=tri[x];` +
        `[x][2:a]acrossfade=d=${fade}:c1=tri:c2=tri[out]`;
    } else {
      filter = `${segFilter};[0:a][b]acrossfade=d=${fade}:c1=tri:c2=tri[out]`;
    }
    args.push(
      "-filter_complex", filter,
      "-map", "[out]",
      "-c:a", "libmp3lame", "-b:a", "192k",
      outPath,
    );
    await execFileAsync("ffmpeg", args, { timeout: 180_000 });
    return await readFile(outPath);
  } finally {
    await unlink(origPath).catch(() => {});
    await unlink(segPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

function buildRemixPrompt(d: {
  title: string; lyrics?: string; genre?: string; mood?: string; styleTweak?: string;
}): string {
  let p = `Remix of the song "${d.title || "Untitled"}". Keep the SAME lyrics, the same vocal melody, and the same overall vibe`;
  const vibe: string[] = [];
  if (d.genre) vibe.push(d.genre);
  if (d.mood) vibe.push(d.mood);
  if (vibe.length) p += ` (${vibe.join(", ")})`;
  p += `, but produce a completely FRESH arrangement — new instrumentation, new groove, new production ear candy. It must still feel like the same song, just reimagined.`;
  if (d.styleTweak?.trim()) p += ` Remix direction: ${d.styleTweak.trim().slice(0, 500)}.`;
  if (d.lyrics?.trim()) p += `\n\nLyrics (keep these words):\n${d.lyrics.trim().slice(0, 3000)}`;
  return p.slice(0, 2000);
}

function buildSectionPrompt(d: {
  section: string; startSec: number; endSec: number;
  sectionLyrics?: string; genre?: string; mood?: string; styleTweak?: string; title?: string;
}): string {
  let p = `Regenerate ONLY the [${d.section}] section of the song "${d.title || "Untitled"}" ` +
    `(this section spans seconds ${d.startSec.toFixed(1)}–${d.endSec.toFixed(1)} of the full song). ` +
    `Match the original's key, tempo, energy, and production style`;
  const vibe: string[] = [];
  if (d.genre) vibe.push(d.genre);
  if (d.mood) vibe.push(d.mood);
  if (vibe.length) p += ` (${vibe.join(", ")})`;
  p += ` so the new section splices back in seamlessly. Same lyrics, fresh delivery and arrangement for this section.`;
  if (d.styleTweak?.trim()) p += ` Direction: ${d.styleTweak.trim().slice(0, 500)}.`;
  if (d.sectionLyrics?.trim()) p += `\n\nLyrics for [${d.section}]:\n${d.sectionLyrics.trim().slice(0, 2000)}`;
  return p.slice(0, 2000);
}

/* Replay safety (CA-7): both charges in this file key on a
   server-derived idempotency key over the parsed request intent, so
   a re-ask of the same request (double-tap, retry, timeout resend)
   is answered from the stored result instead of charging again and
   re-generating. Dev mode (no charge) skips keying entirely. The
   refund paths VOID their key (only when the refund landed), so a
   refunded request always runs fresh on retry. Fresh responses are
   byte-identical to before; stored lookups fail open. */
const REMIX_SCOPE = "song-remix";
const REPLACE_SCOPE = "song-replace-section";
const REPLAY_STORE_MAX = 500;
const storedRemixResults = new Map<string, Record<string, unknown>>();
const inFlightRemixes = new Map<string, Promise<Record<string, unknown>>>();

function storeRemixInProcess(store: Map<string, Record<string, unknown>>, key: string, body: Record<string, unknown>): void {
  if (store.size >= REPLAY_STORE_MAX) {
    const first = store.keys().next().value;
    if (first !== undefined) store.delete(first);
  }
  store.set(key, body);
}

export function __resetSongRemixReplayCache(): void {
  storedRemixResults.clear();
  inFlightRemixes.clear();
}

/** Shared replay pre-check for this file's two rails: serves the
 *  stored body (+ `replayed: true`) and returns true when the request
 *  has been answered — durable store, in-process store, or a twin
 *  still in flight. A failed twin falls through to a fresh run. */
async function serveRemixReplayIfAny(
  scope: string,
  key: string,
  userId: string,
  res: { json: (b: unknown) => void },
): Promise<boolean> {
  const durable = await findStoredGenerationResult(scope, key, userId);
  if (durable) {
    res.json({ ...durable, replayed: true });
    return true;
  }
  const local = storedRemixResults.get(key);
  if (local) {
    res.json({ ...local, replayed: true });
    return true;
  }
  const pending = inFlightRemixes.get(key);
  if (pending) {
    try {
      const twinBody = await pending;
      const stored = storedRemixResults.get(key) ?? twinBody;
      res.json({ ...stored, replayed: true });
      return true;
    } catch {
      /* The twin failed and refunded (voiding the key) — run fresh. */
    }
  }
  return false;
}

/** Register an in-flight run for same-key twins; returns the finishers. */
function beginRemixFlight(key: string): {
  flight: Promise<Record<string, unknown>>;
  resolve: (body: Record<string, unknown>) => void;
  reject: (err: unknown) => void;
  cleanup: () => void;
} {
  let resolve: (body: Record<string, unknown>) => void = () => {};
  let reject: (err: unknown) => void = () => {};
  const flight = new Promise<Record<string, unknown>>((res, rej) => { resolve = res; reject = rej; });
  flight.catch(() => {});
  inFlightRemixes.set(key, flight);
  return {
    flight,
    resolve,
    reject,
    cleanup: () => { if (inFlightRemixes.get(key) === flight) inFlightRemixes.delete(key); },
  };
}

/** Store a fresh success (in-process + durable) and answer it — or
 *  the stored body, if a twin's store landed first. */
async function serveRemixSuccess(
  scope: string,
  key: string,
  userId: string,
  body: Record<string, unknown>,
  res: { json: (b: unknown) => void },
): Promise<void> {
  storeRemixInProcess(storedRemixResults, key, body);
  await storeGenerationResult(scope, key, userId, body);
  const stored = storedRemixResults.get(key);
  if (stored && stored !== body) {
    res.json({ ...stored, replayed: true });
    return;
  }
  res.json(body);
}

/* ── POST /api/song-remix ───────────────────────────────────────────────── */
router.post("/song-remix", requireAuth, async (req, res) => {
  const parsed = remixSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const d = parsed.data;
  const apiKey = missingAudioKey(res);
  if (!apiKey) return;

  if (!d.songId && !d.audioUrl && !d.lyrics?.trim()) {
    res.status(400).json({
      error: "Pass songId, audioUrl, or lyrics so the remix has something to reimagine.",
      code: "no_source",
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  const isDev = process.env["NODE_ENV"] === "development";
  if (!isDev && currentCredits < REMIX_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: `A song remix costs ${REMIX_CREDIT_COST} Visual Bucs — top up to remix.`,
      required: REMIX_CREDIT_COST,
    });
    return;
  }

  let song = d.songId ? await findSong(req.userId!, d.songId) : null;
  if (d.songId && !song) {
    res.status(404).json({ error: "Song not found." });
    return;
  }
  const title = (d.title?.trim() || song?.title || "Untitled Song").slice(0, 200);

  /* Replay safety (CA-7): key from the parsed intent; a re-ask is
     answered from the stored remix — no second charge, no second
     generation, no second song row. */
  let remixKey: string | null = null;
  if (!isDev) {
    remixKey = buildChargeIdempotencyKey(REMIX_SCOPE, req.userId!, undefined, {
      songId: d.songId ?? null,
      audioUrl: d.audioUrl ?? null,
      lyrics: d.lyrics ?? null,
      title: d.title ?? null,
      genre: d.genre ?? null,
      mood: d.mood ?? null,
      styleTweak: d.styleTweak ?? null,
      instrumental: d.instrumental ?? null,
      vocalGender: d.vocalGender ?? null,
      lengthSeconds: d.lengthSeconds ?? null,
    });
    if (await serveRemixReplayIfAny(REMIX_SCOPE, remixKey, req.userId!, res)) return;
  }

  // Charge upfront: the music generation starts immediately.
  if (!isDev) {
    try {
      await chargeCredits(req.userId!, REMIX_CREDIT_COST, { action: "Song Remix (new arrangement)" }, { idempotencyKey: remixKey ?? undefined });
    } catch (chargeErr) {
      if (chargeErr instanceof OutOfCreditsError) {
        res.status(402).json({ error: "out_of_credits", message: `A song remix costs ${REMIX_CREDIT_COST} Visual Bucs — top up to remix.` });
        return;
      }
      if (chargeErr instanceof LedgerWriteError) {
        res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed — no Visual Bucs were charged. Please try again." });
        return;
      }
      throw chargeErr;
    }
  }

  const remixFlight = remixKey ? beginRemixFlight(remixKey) : null;

  try {
    // Remix length: explicit override, else the original song's duration when
    // we can measure it, else a 60s default.
    let lengthMs = 60_000;
    if (Number.isFinite(Number(d.lengthSeconds)) && Number(d.lengthSeconds) > 0) {
      lengthMs = Math.round(Number(d.lengthSeconds) * 1000);
    } else if (song) {
      try {
        const original = await downloadAudio(song);
        const dur = await probeDurationSec(original);
        lengthMs = Math.round(dur * 1000);
      } catch {
        /* fall back to the default */
      }
    }
    lengthMs = Math.min(MAX_SONG_MS, Math.max(MIN_SONG_MS, lengthMs));

    const prompt = buildRemixPrompt({
      title, lyrics: d.lyrics, genre: d.genre, mood: d.mood, styleTweak: d.styleTweak,
    });
    req.log.info({ title, lengthMs }, "song-remix: remix started");
    const remixed = await generateMusicSegment({
      prompt, lengthMs, instrumental: d.instrumental, vocalGender: d.vocalGender, apiKey,
    });

    const saved = await saveSongAudio(req.userId!, remixed, `${title} (Remix)`, {
      source: "song-remix",
      parentSongId: song?.id,
    });

    const remixBody: Record<string, unknown> = {
      song: saved,
      creditsAfter: isDev ? currentCredits : currentCredits - REMIX_CREDIT_COST,
    };
    if (remixKey && remixFlight) {
      await serveRemixSuccess(REMIX_SCOPE, remixKey, req.userId!, remixBody, res);
      remixFlight.resolve(remixBody);
      remixFlight.cleanup();
    } else {
      res.json(remixBody);
    }
  } catch (err) {
    if (remixFlight) {
      remixFlight.reject(err);
      remixFlight.cleanup();
    }
    req.log.error({ err }, "song-remix: failed");
    if (!isDev) {
      let remixRefunded = true;
      await refundCredits(req.userId!, REMIX_CREDIT_COST, { action: "Song Remix — Refund (provider failure)" })
        .catch((refundErr) => {
          remixRefunded = false;
          req.log.error({ userId: req.userId, err: refundErr }, "[song-remix] failed to refund remix credits");
        });
      if (remixRefunded && remixKey) await voidChargeIdempotencyKey(remixKey);
    }
    res.status(500).json({
      error: err instanceof Error ? err.message : "Remix failed — your Visual Bucs were refunded. Please try again.",
      code: "remix_failed",
    });
  }
});

/* ── POST /api/song-replace-section ──────────────────────────────────────── */
router.post("/song-replace-section", requireAuth, async (req, res) => {
  const parsed = replaceSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const d = parsed.data;
  const apiKey = missingAudioKey(res);
  if (!apiKey) return;

  if (!d.songId && !d.audioUrl) {
    res.status(400).json({
      error: "Replacing a section needs the original audio — pass songId or audioUrl.",
      code: "no_source",
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  const isDev = process.env["NODE_ENV"] === "development";
  if (!isDev && currentCredits < REPLACE_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: `Replacing a section costs ${REPLACE_CREDIT_COST} Visual Bucs — top up to continue.`,
      required: REPLACE_CREDIT_COST,
    });
    return;
  }

  const song = d.songId ? await findSong(req.userId!, d.songId) : null;
  if (d.songId && !song) {
    res.status(404).json({ error: "Song not found." });
    return;
  }
  const title = (d.title?.trim() || song?.title || "Untitled Song").slice(0, 200);
  const section = (d.section?.trim() || "Section").slice(0, 80);

  /* Replay safety (CA-7): key from the parsed intent (incl. the
     section identity); a re-ask is answered from the stored result —
     no second charge, no second splice. */
  let replaceKey: string | null = null;
  if (!isDev) {
    replaceKey = buildChargeIdempotencyKey(REPLACE_SCOPE, req.userId!, undefined, {
      songId: d.songId ?? null,
      audioUrl: d.audioUrl ?? null,
      section: d.section ?? null,
      sectionIndex: d.sectionIndex ?? null,
      totalSections: d.totalSections ?? null,
      startSec: d.startSec ?? null,
      endSec: d.endSec ?? null,
      sectionLyrics: d.sectionLyrics ?? null,
      genre: d.genre ?? null,
      mood: d.mood ?? null,
      styleTweak: d.styleTweak ?? null,
      title: d.title ?? null,
      instrumental: d.instrumental ?? null,
      vocalGender: d.vocalGender ?? null,
    });
    if (await serveRemixReplayIfAny(REPLACE_SCOPE, replaceKey, req.userId!, res)) return;
  }

  // Charge upfront: the section generation starts immediately.
  if (!isDev) {
    try {
      await chargeCredits(req.userId!, REPLACE_CREDIT_COST, { action: `Replace Song Section [${section}]` }, { idempotencyKey: replaceKey ?? undefined });
    } catch (chargeErr) {
      if (chargeErr instanceof OutOfCreditsError) {
        res.status(402).json({ error: "out_of_credits", message: `Replacing a section costs ${REPLACE_CREDIT_COST} Visual Bucs — top up to continue.` });
        return;
      }
      if (chargeErr instanceof LedgerWriteError) {
        res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed — no Visual Bucs were charged. Please try again." });
        return;
      }
      throw chargeErr;
    }
  }

  const replaceFlight = replaceKey ? beginRemixFlight(replaceKey) : null;

  try {
    const original = await downloadAudio(song, d.audioUrl);
    const duration = await probeDurationSec(original);

    // Splice bounds: explicit seconds win; otherwise an even split across the
    // tagged sections, marked as estimated in the response.
    let startSec = d.startSec;
    let endSec = d.endSec;
    let estimated = false;
    if (startSec === undefined || endSec === undefined) {
      if (d.sectionIndex === undefined || d.totalSections === undefined || d.totalSections < 1) {
        throw new Error("Pick a section or give explicit start/end seconds.");
      }
      const idx = Math.min(d.sectionIndex, d.totalSections - 1);
      startSec = (idx / d.totalSections) * duration;
      endSec = ((idx + 1) / d.totalSections) * duration;
      estimated = true;
    }
    startSec = Math.max(0, Math.min(startSec, duration - 1));
    endSec = Math.max(startSec + 1, Math.min(endSec, duration));
    const sectionMs = Math.round((endSec - startSec) * 1000);
    if (sectionMs < MIN_SEG_MS || sectionMs > MAX_SEG_MS) {
      throw new Error(
        `That section is ${Math.round(sectionMs / 1000)}s — replaceable sections must be ` +
        `${MIN_SEG_MS / 1000}–${MAX_SEG_MS / 1000}s. Adjust the timing and try again.`,
      );
    }

    const prompt = buildSectionPrompt({
      section, startSec, endSec,
      sectionLyrics: d.sectionLyrics, genre: d.genre, mood: d.mood,
      styleTweak: d.styleTweak, title,
    });
    req.log.info({ title, section, startSec, endSec, estimated }, "song-replace-section: started");
    const replacement = await generateMusicSegment({
      prompt, lengthMs: sectionMs, instrumental: d.instrumental,
      vocalGender: d.vocalGender, apiKey,
    });

    const spliced = await spliceSection(original, replacement, startSec, endSec);

    const saved = await saveSongAudio(req.userId!, spliced, `${title} (${section} replaced)`, {
      source: "section-replace",
      parentSongId: song?.id,
    });

    const replaceBody: Record<string, unknown> = {
      song: saved,
      section,
      startSec: Math.round(startSec * 10) / 10,
      endSec: Math.round(endSec * 10) / 10,
      estimated,
      creditsAfter: isDev ? currentCredits : currentCredits - REPLACE_CREDIT_COST,
    };
    if (replaceKey && replaceFlight) {
      await serveRemixSuccess(REPLACE_SCOPE, replaceKey, req.userId!, replaceBody, res);
      replaceFlight.resolve(replaceBody);
      replaceFlight.cleanup();
    } else {
      res.json(replaceBody);
    }
  } catch (err) {
    if (replaceFlight) {
      replaceFlight.reject(err);
      replaceFlight.cleanup();
    }
    req.log.error({ err }, "song-replace-section: failed");
    if (!isDev) {
      let replaceRefunded = true;
      await refundCredits(req.userId!, REPLACE_CREDIT_COST, { action: "Replace Song Section — Refund (provider failure)" })
        .catch((refundErr) => {
          replaceRefunded = false;
          req.log.error({ userId: req.userId, err: refundErr }, "[song-replace-section] failed to refund credits");
        });
      if (replaceRefunded && replaceKey) await voidChargeIdempotencyKey(replaceKey);
    }
    res.status(500).json({
      error: err instanceof Error ? err.message : "Section replacement failed — your Visual Bucs were refunded. Please try again.",
      code: "replace_failed",
    });
  }
});

export default router;
