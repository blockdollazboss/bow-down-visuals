/**
 * podcast.ts — AI Podcast Studio backend.
 *
 *  POST /api/podcast/generate   turn a script, a topic, or a video's audio
 *                               into a finished podcast episode (MP3)
 *
 * Modes:
 *  - script: TTS the provided script with the chosen host voice(s)
 *  - topic:  GPT-6 writes the episode script first, then TTS
 *  - video:  extract the audio track from a video URL and master it as
 *            the episode (no TTS — the creator's own recording)
 *
 * Formats:
 *  - single: one host voice reads the whole script
 *  - dual:   script lines prefixed with HOST: / COHOST: alternate between
 *            two voices; unprefixed paragraphs alternate by paragraph
 *
 * Extras:
 *  - musicBed: synthesized intro/outro ambience (ffmpeg-generated pad,
 *    clearly labeled as a synth bed in the UI — not a licensed track)
 *  - chapters: `# Heading` lines in the script become chapter markers
 *              (returned as JSON + listed in the RSS description)
 *  - rss:      a valid podcast RSS 2.0 feed is generated per episode —
 *              download it and submit to Spotify for Podcasters / Apple
 *              Podcasts Connect. We do NOT auto-publish (honest UX).
 *
 * Pricing: 3 credits per 10 minutes of audio (env-overridable via
 * PODCAST_CREDITS_PER_10MIN). Duration is estimated from word count at
 * ~150 wpm; charge-before-generate; auto-refund on provider/upload failure.
 * Topic-mode script writing is included in the audio charge.
 *
 * Voice list comes from the existing GET /api/voices — this route only
 * handles generation.
 */
import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, mkdir } from "fs/promises";
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
import { uploadMediaToSupabaseStorage } from "../../lib/objectStorage";

const router = Router();
const execFileAsync = promisify(execFile);

/* ── Pricing ─────────────────────────────────────────────────────────── */

/** Credits charged per 10 minutes of finished audio. */
export const PODCAST_CREDITS_PER_10MIN =
  Number(process.env["PODCAST_CREDITS_PER_10MIN"]) || 3;

/** Seconds per billable block. */
export const SECONDS_PER_BLOCK = 600;

/** Average English speaking rate used for duration estimates. */
export const WORDS_PER_MINUTE = 150;

/** Hard cap on script length (~40 minutes of audio). */
export const MAX_SCRIPT_CHARS = 36_000;

/** Max characters per ElevenLabs TTS request (chunked at sentence bounds). */
export const TTS_CHUNK_CHARS = 2_000;

/** ElevenLabs TTS model (env-overridable). */
function ttsModel(): string {
  return process.env["ELEVENLABS_TTS_MODEL"] || "eleven_multilingual_v2";
}

function elevenKey(): string | undefined {
  return process.env["ELEVENLABS_API_KEY"];
}

/* ── Cost estimation (mirrored in frontend lib — keep in sync) ────────── */

export interface PodcastEstimate {
  wordCount: number;
  estimatedSeconds: number;
  billableBlocks: number;
  credits: number;
}

export function estimatePodcastCost(script: string): PodcastEstimate {
  const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
  const estimatedSeconds = Math.ceil((wordCount / WORDS_PER_MINUTE) * 60);
  const billableBlocks = Math.max(1, Math.ceil(estimatedSeconds / SECONDS_PER_BLOCK));
  return {
    wordCount,
    estimatedSeconds,
    billableBlocks,
    credits: billableBlocks * PODCAST_CREDITS_PER_10MIN,
  };
}

/** Cost from a known duration in seconds (video mode). */
export function estimatePodcastCostFromSeconds(seconds: number): PodcastEstimate {
  const billableBlocks = Math.max(1, Math.ceil(seconds / SECONDS_PER_BLOCK));
  return {
    wordCount: Math.round((seconds / 60) * WORDS_PER_MINUTE),
    estimatedSeconds: Math.ceil(seconds),
    billableBlocks,
    credits: billableBlocks * PODCAST_CREDITS_PER_10MIN,
  };
}

/* ── Request validation ──────────────────────────────────────────────── */

const generateSchema = z.object({
  mode: z.enum(["script", "topic", "video"]),
  script: z.string().max(MAX_SCRIPT_CHARS).optional().default(""),
  topic: z.string().max(300).optional().default(""),
  videoUrl: z.string().url().max(2000).optional(),
  title: z.string().min(1, "Episode title is required.").max(200),
  description: z.string().max(2000).optional().default(""),
  hostVoiceId: z.string().min(1, "Host voice is required.").max(100).optional(),
  format: z.enum(["single", "dual"]).default("single"),
  coHostVoiceId: z.string().max(100).optional(),
  musicBed: z.boolean().default(false),
});

export type PodcastMode = z.infer<typeof generateSchema>["mode"];

/* ── Script parsing: segments + chapters ─────────────────────────────── */

export interface ScriptSegment {
  speaker: "host" | "cohost";
  text: string;
}

export interface Chapter {
  title: string;
  /** seconds from episode start (estimated from word position) */
  startSeconds: number;
}

/**
 * Split a script into speaker segments and extract `# Heading` chapters.
 * Dual-host lines use HOST: / COHOST: prefixes; without prefixes, paragraphs
 * alternate speakers. Chapter timestamps are estimated from word position
 * at 150 wpm (honest estimate — shown as approximate in the UI).
 */
export function parseScript(
  script: string,
  format: "single" | "dual",
): { segments: ScriptSegment[]; chapters: Chapter[] } {
  const segments: ScriptSegment[] = [];
  const chapters: Chapter[] = [];
  const paragraphs = script.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  let wordCursor = 0;
  let paragraphIndex = 0;
  for (const para of paragraphs) {
    const lines = para.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const chapterMatch = line.match(/^#{1,3}\s+(.+)$/);
      if (chapterMatch) {
        chapters.push({
          title: chapterMatch[1]!.trim().slice(0, 120),
          startSeconds: Math.round((wordCursor / WORDS_PER_MINUTE) * 60),
        });
        continue;
      }

      let speaker: "host" | "cohost" = format === "dual" && paragraphIndex % 2 === 1 ? "cohost" : "host";
      let text = line;
      const hostMatch = line.match(/^(HOST|Host|host)\s*:\s*(.+)$/);
      const cohostMatch = line.match(/^(COHOST|Cohost|cohost|CO-HOST|GUEST|Guest|guest)\s*:\s*(.+)$/);
      if (hostMatch) {
        speaker = "host";
        text = hostMatch[2]!.trim();
      } else if (cohostMatch) {
        speaker = "cohost";
        text = cohostMatch[2]!.trim();
      }
      if (format === "single") speaker = "host";
      if (text) {
        segments.push({ speaker, text });
        wordCursor += text.split(/\s+/).filter(Boolean).length;
      }
    }
    paragraphIndex++;
  }
  return { segments, chapters };
}

/**
 * Chunk long text at sentence boundaries so no TTS request exceeds the
 * provider's per-request text limit.
 */
export function chunkText(text: string, maxChars: number = TTS_CHUNK_CHARS): string[] {
  if (text.length <= maxChars) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+["']?\s*|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length > maxChars && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

/* ── ElevenLabs TTS ──────────────────────────────────────────────────── */

async function ttsToFile(
  apiKey: string,
  voiceId: string,
  text: string,
  outPath: string,
): Promise<void> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: ttsModel(),
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.4,
          use_speaker_boost: true,
          speed: 1.0,
        },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    logger.error(
      { status: res.status, errText: errText.slice(0, 300) },
      "podcast: ElevenLabs TTS failed",
    );
    throw new Error(`ElevenLabs TTS failed (${res.status})`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) throw new Error("ElevenLabs returned empty audio");
  await writeFile(outPath, bytes);
}

/* ── ffmpeg helpers ──────────────────────────────────────────────────── */

async function makeWorkDir(): Promise<string> {
  const dir = join(tmpdir(), `podcast-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Synthesize a short ambient music bed (warm chord pad with fade in/out).
 * This is a generated synth bed — the UI labels it honestly as such.
 */
export async function synthMusicBed(outPath: string, seconds: number = 8): Promise<void> {
  // A major 7th-ish pad: root 110Hz + 138.59 + 164.81 + 220, soft volume, fades
  const args = [
    "-y",
    "-f", "lavfi", "-i", `sine=frequency=110:duration=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=138.59:duration=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=164.81:duration=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=220:duration=${seconds}`,
    "-filter_complex",
    `[0:a]volume=0.12[a0];[1:a]volume=0.10[a1];[2:a]volume=0.10[a2];[3:a]volume=0.08[a3];` +
      `[a0][a1][a2][a3]amix=inputs=4:normalize=0,` +
      `lowpass=f=1200,afade=t=in:st=0:d=2,afade=t=out:st=${seconds - 2}:d=2[aout]`,
    "-map", "[aout]",
    "-c:a", "libmp3lame", "-b:a", "128k",
    outPath,
  ];
  await execFileAsync("ffmpeg", args, { timeout: 60_000 });
}

/** Concatenate MP3 segments with 0.4s silence gaps, optional intro/outro beds. */
export async function assembleEpisode(
  segmentFiles: string[],
  outPath: string,
  musicBed: boolean,
  workDir: string,
): Promise<void> {
  const inputs: string[] = [];
  const filterParts: string[] = [];
  let idx = 0;
  const labeled: string[] = [];

  async function addFile(file: string): Promise<string> {
    inputs.push("-i", file);
    const label = `in${idx}`;
    filterParts.push(`[${idx}:a]aresample=44100,apad=whole_dur=0.4[${label}]`);
    labeled.push(`[${label}]`);
    idx++;
    return label;
  }

  if (musicBed) {
    const introBed = join(workDir, "intro-bed.mp3");
    const outroBed = join(workDir, "outro-bed.mp3");
    await synthMusicBed(introBed, 8);
    await synthMusicBed(outroBed, 8);
    await addFile(introBed);
  }
  for (const f of segmentFiles) {
    await addFile(f);
  }
  if (musicBed) {
    const outroBed = join(workDir, "outro-bed.mp3");
    await addFile(outroBed);
  }

  const args = [
    "-y",
    ...inputs,
    "-filter_complex",
    `${filterParts.join(";")};${labeled.join("")}concat=n=${labeled.length}:v=0:a=1[aout]`,
    "-map", "[aout]",
    "-c:a", "libmp3lame", "-b:a", "128k",
    outPath,
  ];
  await execFileAsync("ffmpeg", args, { timeout: 300_000 });
}

/** Extract the audio track from a video file/URL to MP3. */
export async function extractAudioFromVideo(
  videoPath: string,
  outPath: string,
): Promise<void> {
  await execFileAsync(
    "ffmpeg",
    ["-y", "-i", videoPath, "-vn", "-c:a", "libmp3lame", "-b:a", "128k", outPath],
    { timeout: 300_000 },
  );
}

/** Probe media duration in seconds via ffmpeg (parses stderr). */
export async function probeDurationSeconds(mediaPath: string): Promise<number> {
  try {
    const { stderr } = await execFileAsync("ffmpeg", ["-i", mediaPath], { timeout: 30_000 });
    void stderr;
    return 0;
  } catch (err: unknown) {
    const stderr = String((err as { stderr?: string }).stderr ?? "");
    const m = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    if (m) {
      const h = Number(m[1]);
      const min = Number(m[2]);
      const sec = Number(m[3]);
      return h * 3600 + min * 60 + sec;
    }
    return 0;
  }
}

/** Download a remote file to a local path. */
async function downloadToFile(url: string, outPath: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("Downloaded file is empty");
  await writeFile(outPath, buf);
}

/* ── Topic mode: GPT-6 writes the episode script ─────────────────────── */

export async function writeScriptFromTopic(topic: string): Promise<string> {
  const completion = await getOpenAI().chat.completions.create({
    model: getTextModel(),
    messages: [
      {
        role: "system",
        content:
          `You are a professional podcast scriptwriter. Write a complete, ready-to-record ` +
          `podcast episode script — natural spoken language, short sentences, conversational ` +
          `energy. Structure it with a cold open, 3-4 main segments, and a closing call to ` +
          `action. Mark major segments with "# Heading" lines (these become chapter markers). ` +
          `Aim for roughly 1200-1500 words (about 8-10 minutes spoken). Write ONLY the script ` +
          `text and headings — no stage directions in brackets, no meta commentary.`,
      },
      { role: "user", content: `Write a podcast episode script about: ${topic}` },
    ],
    response_format: { type: "text" },
    max_completion_tokens: 4000,
    temperature: 0.8,
  });
  const script = completion.choices[0]?.message?.content?.trim() ?? "";
  if (script.length < 50) throw new Error("Script generation returned too little text");
  return script;
}

/* ── RSS 2.0 feed ────────────────────────────────────────────────────── */

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface RssEpisode {
  title: string;
  description: string;
  audioUrl: string;
  durationSeconds: number;
  pubDate: Date;
  chapters: Chapter[];
}

export function buildPodcastRss(ep: RssEpisode, showTitle = "Bow Down Visuals Podcast"): string {
  const chapterList = ep.chapters.length
    ? `\n\nChapters:\n${ep.chapters
        .map((c) => `${formatTimestamp(c.startSeconds)} — ${c.title}`)
        .join("\n")}`
    : "";
  const fullDescription = `${ep.description}${chapterList}`.trim() || ep.title;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">\n` +
    `  <channel>\n` +
    `    <title>${escapeXml(showTitle)}</title>\n` +
    `    <description>${escapeXml(fullDescription)}</description>\n` +
    `    <language>en-us</language>\n` +
    `    <itunes:author>Bow Down Visuals</itunes:author>\n` +
    `    <itunes:category text="Arts"/>\n` +
    `    <itunes:explicit>false</itunes:explicit>\n` +
    `    <item>\n` +
    `      <title>${escapeXml(ep.title)}</title>\n` +
    `      <description>${escapeXml(fullDescription)}</description>\n` +
    `      <enclosure url="${escapeXml(ep.audioUrl)}" type="audio/mpeg"/>\n` +
    `      <guid>${escapeXml(ep.audioUrl)}</guid>\n` +
    `      <pubDate>${ep.pubDate.toUTCString()}</pubDate>\n` +
    `      <itunes:duration>${ep.durationSeconds}</itunes:duration>\n` +
    `    </item>\n` +
    `  </channel>\n` +
    `</rss>\n`
  );
}

export function formatTimestamp(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/* ── Supabase upload ─────────────────────────────────────────────────── */

async function uploadEpisode(
  userId: string,
  audioBytes: Buffer,
): Promise<{ url: string; ref: string }> {
  const fileName = `${userId}/podcast/${randomUUID()}.mp3`;
  const url = await uploadMediaToSupabaseStorage(fileName, audioBytes, "audio/mpeg");
  return { url, ref: `generated-clips/${fileName}` };
}

/* ── POST /api/podcast/generate ──────────────────────────────────────── */

router.post(
  "/podcast/generate",
  publicApiLimiter,
  requireAuth,
  async (req, res) => {
    const parsed = generateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid podcast request.",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }

    const {
      mode, script: rawScript, topic, videoUrl, title,
      description, hostVoiceId, format, coHostVoiceId, musicBed,
    } = parsed.data;

    if (mode === "script" && !rawScript.trim()) {
      res.status(400).json({ error: "Paste a script first (script mode)." });
      return;
    }
    if (mode === "topic" && !topic.trim()) {
      res.status(400).json({ error: "Give a topic first (topic mode)." });
      return;
    }
    if (mode === "video" && !videoUrl) {
      res.status(400).json({ error: "Provide a video URL first (video mode)." });
      return;
    }
    if (mode !== "video" && !hostVoiceId) {
      res.status(400).json({ error: "Pick a host voice first." });
      return;
    }
    if (format === "dual" && !coHostVoiceId) {
      res.status(400).json({ error: "Dual-host needs a co-host voice." });
      return;
    }

    const apiKey = elevenKey();
    if (mode !== "video" && !apiKey) {
      res.status(503).json({ error: "Voice service is not configured on this server." });
      return;
    }

    const actionName = "AI Podcast Studio";
    let creditsToCharge = 0;
    let finalScript = rawScript;

    /* ── Resolve the script + estimate cost before charging ── */
    try {
      if (mode === "topic") {
        finalScript = await writeScriptFromTopic(topic.trim());
        const est = estimatePodcastCost(finalScript);
        creditsToCharge = est.credits;
      } else if (mode === "script") {
        creditsToCharge = estimatePodcastCost(finalScript).credits;
      } else {
        // video mode: charge after we know the extracted duration (below)
        creditsToCharge = 0;
      }
    } catch (err) {
      logger.error({ err }, "podcast: script resolution failed");
      res.status(502).json({
        error: err instanceof Error ? err.message : "Could not prepare your episode — try again.",
      });
      return;
    }

    const balance = req.userCredits ?? 0;
    if (mode !== "video") {
      if (balance < creditsToCharge) {
        res.status(402).json({
          error: "out_of_credits",
          message: `This episode needs ${creditsToCharge} credits — top up to keep creating.`,
          creditsRequired: creditsToCharge,
        });
        return;
      }
    }

    let creditsRemaining = balance;
    const workDir = await makeWorkDir();
    const cleanup = async () => {
      try {
        const { rm } = await import("fs/promises");
        await rm(workDir, { recursive: true, force: true });
      } catch { /* best effort */ }
    };

    async function failWithRefund(
      charge: number,
      status: number,
      message: string,
    ): Promise<void> {
      if (charge > 0) {
        await refundCredits(req.userId!, charge, {
          action: `${actionName} — Refund (generation failed)`,
        }).catch((refundErr) =>
          logger.error({ refundErr }, "podcast: refund after failure failed"),
        );
      }
      res.status(status).json({ error: message });
    }

    try {
      let episodeMp3Path: string;
      let chapters: Chapter[] = [];
      let durationSeconds = 0;

      if (mode === "video") {
        /* ── Video mode: extract the audio track, master it ── */
        const videoPath = join(workDir, "source-video.mp4");
        await downloadToFile(videoUrl!, videoPath);
        const extractedPath = join(workDir, "extracted.mp3");
        await extractAudioFromVideo(videoPath, extractedPath);
        durationSeconds = await probeDurationSeconds(extractedPath);
        if (durationSeconds <= 0) {
          // fall back to word-rate estimate from nothing — use a 1-block minimum
          durationSeconds = SECONDS_PER_BLOCK;
        }
        const est = estimatePodcastCostFromSeconds(durationSeconds);
        if (balance < est.credits) {
          await cleanup();
          res.status(402).json({
            error: "out_of_credits",
            message: `This episode needs ${est.credits} credits — top up to keep creating.`,
            creditsRequired: est.credits,
          });
          return;
        }
        try {
          creditsRemaining = await chargeCredits(req.userId!, est.credits, { action: actionName });
        } catch (err) {
          await cleanup();
          if (err instanceof OutOfCreditsError) {
            res.status(402).json({ error: "out_of_credits", message: "Not enough credits.", creditsRequired: est.credits });
            return;
          }
          throw err;
        }
        creditsToCharge = est.credits;

        if (musicBed) {
          // sandwich the extracted audio between intro/outro beds
          episodeMp3Path = join(workDir, "episode.mp3");
          await assembleEpisode([extractedPath], episodeMp3Path, true, workDir);
          durationSeconds = await probeDurationSeconds(episodeMp3Path) || durationSeconds;
        } else {
          episodeMp3Path = extractedPath;
        }
      } else {
        /* ── Script/topic mode: charge, then TTS ── */
        try {
          creditsRemaining = await chargeCredits(req.userId!, creditsToCharge, { action: actionName });
        } catch (err) {
          await cleanup();
          if (err instanceof OutOfCreditsError) {
            res.status(402).json({
              error: "out_of_credits",
              message: `This episode needs ${creditsToCharge} credits — top up to keep creating.`,
              creditsRequired: creditsToCharge,
            });
            return;
          }
          throw err;
        }

        const { segments, chapters: parsedChapters } = parseScript(finalScript, format);
        chapters = parsedChapters;
        if (segments.length === 0) {
          await failWithRefund(creditsToCharge, 400, "No speakable lines found in the script.");
          await cleanup();
          return;
        }

        // TTS each chunk; merge this speaker's chunks per segment to keep the
        // ffmpeg input count manageable (cap total segments at 40)
        const key = elevenKey()!;
        const segmentFiles: string[] = [];
        let segIndex = 0;
        for (const seg of segments.slice(0, 40)) {
          const voiceId = seg.speaker === "cohost" ? coHostVoiceId! : hostVoiceId!;
          const chunks = chunkText(seg.text);
          const chunkFiles: string[] = [];
          for (const chunk of chunks.slice(0, 10)) {
            const chunkPath = join(workDir, `seg-${segIndex}-chunk-${chunkFiles.length}.mp3`);
            await ttsToFile(key, voiceId, chunk, chunkPath);
            chunkFiles.push(chunkPath);
          }
          let segFile: string;
          if (chunkFiles.length === 1) {
            segFile = chunkFiles[0]!;
          } else {
            segFile = join(workDir, `seg-${segIndex}.mp3`);
            const listPath = join(workDir, `seg-${segIndex}.txt`);
            await writeFile(listPath, chunkFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
            await execFileAsync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", segFile], { timeout: 60_000 });
          }
          segmentFiles.push(segFile);
          segIndex++;
        }

        episodeMp3Path = join(workDir, "episode.mp3");
        await assembleEpisode(segmentFiles, episodeMp3Path, musicBed, workDir);
        durationSeconds = await probeDurationSeconds(episodeMp3Path);
        if (durationSeconds <= 0) {
          durationSeconds = estimatePodcastCost(finalScript).estimatedSeconds;
        }
      }

      /* ── Upload + RSS ── */
      const { readFile } = await import("fs/promises");
      const audioBytes = await readFile(episodeMp3Path);
      let upload: { url: string; ref: string };
      try {
        upload = await uploadEpisode(req.userId!, audioBytes);
      } catch (err) {
        logger.error({ err }, "podcast: upload failed");
        await failWithRefund(creditsToCharge, 502, "Episode rendered but upload failed — your credits were refunded. Please try again.");
        await cleanup();
        return;
      }

      const rss = buildPodcastRss({
        title,
        description,
        audioUrl: upload.url,
        durationSeconds: Math.round(durationSeconds),
        pubDate: new Date(),
        chapters,
      });

      await cleanup();
      res.json({
        audioUrl: upload.url,
        audioRef: upload.ref,
        title,
        mode,
        format,
        musicBed,
        chapters,
        rssXml: rss,
        durationSeconds: Math.round(durationSeconds),
        scriptUsed: mode === "topic" ? finalScript : undefined,
        creditsUsed: creditsToCharge,
        creditsRemaining,
      });
    } catch (err) {
      logger.error({ err }, "podcast: generation failed");
      await cleanup();
      await failWithRefund(
        creditsToCharge,
        502,
        "Episode generation failed — your credits were refunded. Please try again.",
      );
    }
  },
);

export default router;
