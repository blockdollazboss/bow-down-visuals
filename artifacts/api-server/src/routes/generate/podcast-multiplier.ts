/**
 * podcast-multiplier.ts — Podcast Multiplier (#163 upgrade delta).
 *
 *  POST /api/podcast/multiply   turn ONE finished podcast episode into a
 *                               one-tap publish kit.
 *
 * The Podcast desk (routes/generate/podcast.ts) makes the episode; the
 * Repurpose / AI Clip Maker only accepts VIDEO sources. This is the
 * missing bridge the dedupe audit scoped: an existing podcast EPISODE as
 * the source of a publish kit derived from the episode's actual audio /
 * transcript —
 *
 *   - shorts:     up to 3 audio clips (~45 s) cut from real moments of
 *                 the episode (chapter starts when chapters exist,
 *                 otherwise evenly-spaced strongest transcript segments)
 *   - audiograms: a 1080×1080 waveform video per short, using the kit's
 *                 own cover art as the canvas
 *   - show notes: markdown notes assembled from the episode title,
 *                 description, chapters and the picked moments, with an
 *                 AI summary when the text model answers (the notes are
 *                 still delivered, honestly without a summary, if not)
 *   - cover art:  a generated square cover for the episode
 *
 * Transcript source: the client passes the episode script when it has
 * one (script/topic modes of the Podcast desk); otherwise the episode
 * audio is transcribed with the house timed seam. Segment timings from
 * a passed script are word-rate estimates and are labeled as such.
 *
 * Pricing: PODCAST_MULTIPLIER_CREDITS (default 300 Visual Bucs — one kit
 * for roughly one 10-minute episode block on the Podcast desk's own
 * rate). Charge-after-transcript, auto-refund on any render failure —
 * the creator never pays for a kit they didn't get.
 */
import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
} from "../../lib/credits";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import {
  refreshSupabaseStorageUrl,
  uploadMediaToSupabaseStorage,
} from "../../lib/objectStorage";
import { transcribeAudioTimed, type TimedSegment } from "../../lib/transcription";
import { probeDurationSeconds, formatTimestamp, type Chapter } from "./podcast";

const router = Router();
const execFileAsync = promisify(execFile);

/* ── Pricing + shape constants ───────────────────────────────────────── */

export const PODCAST_MULTIPLIER_CREDITS =
  Number(process.env["PODCAST_MULTIPLIER_CREDITS"]) || 300;

export const MULTIPLIER_MAX_SHORTS = 3;
export const MULTIPLIER_SHORT_SECONDS = 45;
const MAX_EPISODE_BYTES = 120 * 1024 * 1024;
const IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL_25"] || "gpt-image-2.5-sunburst";

/* ── Types ───────────────────────────────────────────────────────────── */

export interface MultiplierSegment {
  startSec: number;
  endSec: number;
  text: string;
}

export interface ShortMoment {
  startSec: number;
  endSec: number;
  title: string;
  quote: string;
}

/* ── Pure: moment picking ────────────────────────────────────────────── */

function clipWindow(startSec: number, durationSec: number): { startSec: number; endSec: number } {
  const start = Math.max(0, Math.min(startSec, Math.max(0, durationSec - 5)));
  const end = Math.min(durationSec, start + MULTIPLIER_SHORT_SECONDS);
  return { startSec: Math.round(start), endSec: Math.round(end) };
}

function overlaps(a: { startSec: number; endSec: number }, b: { startSec: number; endSec: number }): boolean {
  return a.startSec < b.endSec && b.startSec < a.endSec;
}

/**
 * Pick up to MULTIPLIER_MAX_SHORTS short windows from the episode.
 * Chapter starts win (they are the episode's own structure); when there
 * are fewer chapters than shorts, remaining slots come from the
 * transcript segments nearest each unfilled third of the episode,
 * preferring the longest (most substantial) segment text. Windows never
 * overlap and never run past the episode end.
 */
export function pickShortMoments(
  segments: MultiplierSegment[],
  chapters: Chapter[],
  durationSec: number,
): ShortMoment[] {
  // A non-positive duration means "no readable episode" — never invent
  // one from the segments; the route resolves a real duration (probe, or
  // the transcription's own span) before calling.
  const duration = durationSec;
  if (duration <= 0 || segments.length === 0) return [];

  const picked: ShortMoment[] = [];
  const textAt = (sec: number): MultiplierSegment | undefined =>
    segments.find((s) => sec >= s.startSec && sec < s.endSec) ??
    segments.reduce<MultiplierSegment | undefined>(
      (best, s) => (best === undefined || Math.abs(s.startSec - sec) < Math.abs(best.startSec - sec) ? s : best),
      undefined,
    );

  const tryAdd = (startSec: number, titleHint?: string) => {
    if (picked.length >= MULTIPLIER_MAX_SHORTS) return;
    const win = clipWindow(startSec, duration);
    if (win.endSec - win.startSec < 10) return;
    if (picked.some((p) => overlaps(p, win))) return;
    const seg = textAt(win.startSec);
    const quote = (seg?.text ?? "").trim().slice(0, 220);
    const title =
      (titleHint ?? "").trim().slice(0, 80) ||
      (quote ? quote.split(/\s+/).slice(0, 7).join(" ") : `Moment at ${formatTimestamp(win.startSec)}`);
    picked.push({ ...win, title, quote });
  };

  for (const ch of chapters) {
    tryAdd(ch.startSeconds, ch.title);
  }
  if (picked.length < MULTIPLIER_MAX_SHORTS) {
    const zones = MULTIPLIER_MAX_SHORTS;
    for (let z = 0; z < zones && picked.length < MULTIPLIER_MAX_SHORTS; z++) {
      const zoneStart = (duration / zones) * z;
      const zoneEnd = (duration / zones) * (z + 1);
      const inZone = segments
        .filter((s) => s.startSec >= zoneStart && s.startSec < zoneEnd)
        .sort((a, b) => b.text.length - a.text.length);
      if (inZone[0]) tryAdd(inZone[0].startSec);
    }
  }
  // Last resort: the single strongest segment overall.
  if (picked.length === 0) {
    const strongest = [...segments].sort((a, b) => b.text.length - a.text.length)[0];
    if (strongest) tryAdd(strongest.startSec);
  }
  return picked.sort((a, b) => a.startSec - b.startSec);
}

/* ── Pure: segments from a provided script ───────────────────────────── */

/**
 * Distribute a provided episode script across the episode duration.
 * Timings are word-rate estimates (150 wpm, the Podcast desk's own
 * estimate rate) — callers label them as estimates, never as measured.
 */
export function segmentsFromScript(script: string, durationSec: number): MultiplierSegment[] {
  const sentences = script
    .replace(/^#{1,3}\s+.+$/gm, " ") // chapter headings are structure, not speech
    .match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g)
    ?.map((s) => s.trim())
    .filter(Boolean) ?? [];
  if (sentences.length === 0 || durationSec <= 0) return [];
  const totalWords = sentences.reduce((n, s) => n + s.split(/\s+/).filter(Boolean).length, 0);
  if (totalWords === 0) return [];
  const segments: MultiplierSegment[] = [];
  let wordCursor = 0;
  for (const text of sentences) {
    const words = text.split(/\s+/).filter(Boolean).length;
    const startSec = (wordCursor / totalWords) * durationSec;
    wordCursor += words;
    const endSec = (wordCursor / totalWords) * durationSec;
    segments.push({ startSec: Math.round(startSec), endSec: Math.round(endSec), text });
  }
  return segments;
}

/* ── Pure: show notes + cover prompt ─────────────────────────────────── */

export interface ShowNotesInput {
  title: string;
  description: string;
  summary: string;
  chapters: Chapter[];
  moments: ShortMoment[];
}

export function buildShowNotesText(input: ShowNotesInput): string {
  const lines: string[] = [`# ${input.title}`, ""];
  if (input.description.trim()) lines.push(input.description.trim(), "");
  if (input.summary.trim()) lines.push("## About this episode", "", input.summary.trim(), "");
  if (input.chapters.length > 0) {
    lines.push("## Chapters", "");
    for (const ch of input.chapters) {
      lines.push(`- ${formatTimestamp(ch.startSeconds)} — ${ch.title}`);
    }
    lines.push("");
  }
  if (input.moments.length > 0) {
    lines.push("## Moments worth sharing", "");
    for (const m of input.moments) {
      lines.push(`- ${formatTimestamp(m.startSec)} — ${m.title}`);
      if (m.quote) lines.push(`  > ${m.quote}`);
    }
    lines.push("");
  }
  lines.push("---", "Made with Bow Down Visuals — Podcast Multiplier");
  return lines.join("\n");
}

export function coverArtPrompt(title: string, description: string): string {
  return (
    `Podcast cover art, square, bold and premium: "${title}". ` +
    `${description.trim().slice(0, 300)} ` +
    `Rich gold and black marble palette, cinematic lighting, no text, no words, no letters.`
  ).slice(0, 1000);
}

/* ── Request validation ──────────────────────────────────────────────── */

const multiplySchema = z.object({
  episodeAudioUrl: z.string().url().max(2000),
  title: z.string().min(1, "Episode title is required.").max(200),
  description: z.string().max(2000).optional().default(""),
  transcript: z.string().max(60_000).optional(),
  chapters: z
    .array(
      z.object({
        title: z.string().max(120),
        startSeconds: z.number().min(0).max(24 * 3600),
      }),
    )
    .max(50)
    .optional()
    .default([]),
});

/* ── ffmpeg helpers ──────────────────────────────────────────────────── */

async function cutShort(
  episodePath: string,
  moment: ShortMoment,
  outPath: string,
): Promise<void> {
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-ss", String(moment.startSec),
      "-i", episodePath,
      "-t", String(Math.max(5, moment.endSec - moment.startSec)),
      "-vn", "-c:a", "libmp3lame", "-b:a", "160k",
      outPath,
    ],
    { timeout: 120_000 },
  );
}

async function renderAudiogram(
  coverPath: string,
  shortPath: string,
  outPath: string,
): Promise<void> {
  const filter =
    `[0:v]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,boxblur=24:6[bg];` +
    `[0:v]scale=720:720[fg];` +
    `[1:a]showwaves=s=1080x220:mode=cline:rate=30,format=rgba,colorkey=0x000000:0.12:0.08[waves];` +
    `[bg][fg]overlay=(W-w)/2:70[tmp];` +
    `[tmp][waves]overlay=0:H-h-36[vout]`;
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-loop", "1", "-i", coverPath,
      "-i", shortPath,
      "-filter_complex", filter,
      "-map", "[vout]", "-map", "1:a",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
      "-c:a", "aac", "-b:a", "160k",
      "-shortest",
      outPath,
    ],
    { timeout: 300_000 },
  );
}

async function downloadToFile(url: string, outPath: string): Promise<number> {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`Could not download the episode audio (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("The episode audio came back empty");
  if (buf.length > MAX_EPISODE_BYTES) throw new Error("That episode file is too large to multiply (120 MB max).");
  await writeFile(outPath, buf);
  return buf.length;
}

/* ── AI summary (best-effort — the kit ships without it if it fails) ── */

async function summarizeEpisode(title: string, transcriptText: string): Promise<string> {
  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            "You write podcast show-note summaries. In 2-3 short paragraphs, " +
            "summarize the episode for a listener deciding whether to press play. " +
            "Plain words, no hype, no invented facts — only what the transcript says.",
        },
        {
          role: "user",
          content: `Episode: ${title}\n\nTranscript:\n${transcriptText.slice(0, 12_000)}`,
        },
      ],
      response_format: { type: "text" },
      max_completion_tokens: 500,
      temperature: 0.6,
    });
    return completion.choices[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    logger.warn({ err }, "podcast-multiplier: summary failed — kit ships without it");
    return "";
  }
}

/* ── POST /api/podcast/multiply ──────────────────────────────────────── */

router.post(
  "/podcast/multiply",
  publicApiLimiter,
  requireAuth,
  async (req, res) => {
    const parsed = multiplySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid multiply request.",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }
    const { episodeAudioUrl, title, description, transcript, chapters } = parsed.data;

    const balance = req.userCredits ?? 0;
    if (balance < PODCAST_MULTIPLIER_CREDITS) {
      res.status(402).json({
        error: "out_of_credits",
        message: `A publish kit needs ${PODCAST_MULTIPLIER_CREDITS} Visual Bucs — top up to keep creating.`,
        creditsRequired: PODCAST_MULTIPLIER_CREDITS,
      });
      return;
    }

    const workDir = join(tmpdir(), `podcast-multiply-${randomUUID()}`);
    await mkdir(workDir, { recursive: true });
    const cleanup = async () => {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    };

    /* ── Resolve transcript + duration BEFORE charging ── */
    let segments: MultiplierSegment[] = [];
    let transcriptText = transcript?.trim() ?? "";
    let timingsEstimated = false;
    let durationSec = 0;
    const episodePath = join(workDir, "episode.mp3");
    try {
      const bytes = await downloadToFile(episodeAudioUrl, episodePath);
      durationSec = await probeDurationSeconds(episodePath);
      if (transcriptText) {
        if (durationSec <= 0) {
          res.status(422).json({ error: "We couldn't read that episode's length — try again with the original episode file." });
          await cleanup();
          return;
        }
        segments = segmentsFromScript(transcriptText, durationSec);
        timingsEstimated = true;
      } else {
        const episodeBytes = await readFile(episodePath);
        void bytes;
        const timed = await transcribeAudioTimed({
          buffer: episodeBytes,
          filename: "episode.mp3",
          mimeType: "audio/mpeg",
        });
        segments = timed.segments.map((s: TimedSegment) => ({
          startSec: s.start,
          endSec: s.end,
          text: s.text,
        }));
        transcriptText = timed.text;
        if (durationSec <= 0) durationSec = timed.duration ?? segments.reduce((m, s) => Math.max(m, s.endSec), 0);
      }
    } catch (err) {
      logger.error({ err }, "podcast-multiplier: transcript resolution failed");
      await cleanup();
      res.status(422).json({
        error: err instanceof Error ? err.message : "We couldn't read that episode — nothing was charged.",
      });
      return;
    }

    const moments = pickShortMoments(segments, chapters, durationSec);
    if (moments.length === 0) {
      await cleanup();
      res.status(422).json({
        error: "No speech moments could be found in that episode — nothing was charged.",
      });
      return;
    }

    /* ── Charge, then build the kit; refund on any failure ── */
    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, PODCAST_MULTIPLIER_CREDITS, {
        action: "Podcast Multiplier",
      });
    } catch (err) {
      await cleanup();
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs.", creditsRequired: PODCAST_MULTIPLIER_CREDITS });
        return;
      }
      throw err;
    }

    const failWithRefund = async (message: string): Promise<void> => {
      await refundCredits(req.userId!, PODCAST_MULTIPLIER_CREDITS, {
        action: "Podcast Multiplier — Refund (kit failed)",
      }).catch((refundErr) => logger.error({ refundErr }, "podcast-multiplier: refund failed"));
      await cleanup();
      res.status(502).json({ error: message });
    };

    try {
      const kitId = randomUUID();

      /* Cover art first — the audiograms are built on it. */
      const imageResp = await getOpenAI().images.generate({
        model: IMAGE_MODEL,
        prompt: coverArtPrompt(title, description),
        size: "1024x1024",
        quality: "high",
        n: 1,
      });
      const coverB64 = imageResp.data?.[0]?.b64_json;
      if (!coverB64) throw new Error("Cover art generation returned no image.");
      const coverBytes = Buffer.from(coverB64, "base64");
      const coverRef = await uploadMediaToSupabaseStorage(
        `${req.userId}/podcast-multiplier/${kitId}-cover.png`,
        coverBytes,
        "image/png",
      );
      const coverArtUrl = await refreshSupabaseStorageUrl(coverRef);
      const coverPath = join(workDir, "cover.png");
      await writeFile(coverPath, coverBytes);

      /* Shorts + audiograms per moment. */
      const shorts: Array<ShortMoment & { audioUrl: string; audiogramUrl: string }> = [];
      for (const [i, moment] of moments.entries()) {
        const shortPath = join(workDir, `short-${i}.mp3`);
        await cutShort(episodePath, moment, shortPath);
        const shortBytes = await readFile(shortPath);
        const shortRef = await uploadMediaToSupabaseStorage(
          `${req.userId}/podcast-multiplier/${kitId}-short-${i}.mp3`,
          shortBytes,
          "audio/mpeg",
        );
        const audioUrl = await refreshSupabaseStorageUrl(shortRef);

        const audiogramPath = join(workDir, `audiogram-${i}.mp4`);
        await renderAudiogram(coverPath, shortPath, audiogramPath);
        const audiogramBytes = await readFile(audiogramPath);
        const audiogramRef = await uploadMediaToSupabaseStorage(
          `${req.userId}/podcast-multiplier/${kitId}-audiogram-${i}.mp4`,
          audiogramBytes,
          "video/mp4",
        );
        const audiogramUrl = await refreshSupabaseStorageUrl(audiogramRef);

        shorts.push({ ...moment, audioUrl, audiogramUrl });
      }

      const summary = await summarizeEpisode(title, transcriptText);
      const showNotes = buildShowNotesText({
        title,
        description,
        summary,
        chapters,
        moments,
      });

      await cleanup();
      res.json({
        kitId,
        title,
        shorts,
        coverArtUrl,
        showNotes,
        summaryIncluded: summary.length > 0,
        timingsEstimated,
        durationSeconds: Math.round(durationSec),
        creditsUsed: PODCAST_MULTIPLIER_CREDITS,
        creditsRemaining,
      });
    } catch (err) {
      logger.error({ err }, "podcast-multiplier: kit build failed");
      await failWithRefund("The publish kit couldn't be built — your Visual Bucs were refunded. Please try again.");
    }
  },
);

export default router;
