import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── AI karaoke video maker ───
   Takes an audio URL + LRC lyrics (line timestamps) and renders a karaoke
   video: 720p canvas, title card, and word-by-word highlighting burned in
   with ffmpeg/libass.

   Honesty note: LRC only carries LINE-level timestamps, so per-word timing
   is estimated by distributing each line's duration across its words
   proportionally to word length. The result feels like real karaoke but is
   an approximation, not true syllable-synced timing. */

const KARAOKE_COST = Number(process.env["KARAOKE_CREDITS"]) || 300;
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const MAX_LRC_CHARS = 100_000;
const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;

const THEMES = {
  "gold-luxury": {
    label: "Gold Luxury",
    blurb: "Black canvas, gold sung words, white unsung words — Bow Down Visuals house style",
    sung: "&H0000D7FF", // gold
    unsung: "&H00FFFFFF", // white
    outline: "&H00000000",
    bg: "0x0a0a0a",
  },
  neon: {
    label: "Neon",
    blurb: "Dark club canvas, cyan sung words with neon glow",
    sung: "&H00FFFF00",
    unsung: "&H00BBBBBB",
    outline: "&H00993300",
    bg: "0x050510",
  },
  minimal: {
    label: "Minimal",
    blurb: "Clean white on charcoal, subtle highlight",
    sung: "&H00FFFFFF",
    unsung: "&H00999999",
    outline: "&H00000000",
    bg: "0x1a1a1a",
  },
} as const;

type ThemeKey = keyof typeof THEMES;

interface LrcLine {
  /** start time in seconds */
  start: number;
  text: string;
}

/** Parse LRC: [mm:ss.cc]text lines. Ignores metadata tags like [ti:...]. */
function parseLrc(lrc: string): LrcLine[] {
  const lines: LrcLine[] = [];
  const re = /^\s*\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/;
  for (const raw of lrc.split(/\r?\n/)) {
    const m = re.exec(raw);
    if (!m) continue;
    const min = Number(m[1]);
    const sec = Number(m[2]);
    const fracRaw = m[3] ?? "0";
    // centiseconds or milliseconds -> seconds
    const frac = fracRaw.length >= 3 ? Number(fracRaw) / 1000 : Number(fracRaw) / 100;
    const text = (m[4] ?? "").trim();
    if (!text) continue;
    lines.push({ start: min * 60 + sec + frac, text });
  }
  lines.sort((a, b) => a.start - b.start);
  // Drop duplicates at the same timestamp, keep first.
  return lines.filter((l, i) => i === 0 || Math.abs(l.start - lines[i - 1]!.start) > 0.001);
}

/** Escape ASS dialogue text: backslash and braces are special in ASS. */
function escapeAssText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

/** Format seconds as ASS timestamp H:MM:SS.cc */
function assTime(t: number): string {
  const clamped = Math.max(0, t);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.floor((clamped - Math.floor(clamped)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

const karaokeSchema = z.object({
  audioUrl: z.string().url("audioUrl must be a valid URL."),
  lrc: z.string().trim().min(1, "LRC lyrics are required.").max(MAX_LRC_CHARS),
  title: z.string().trim().max(120).optional(),
  artist: z.string().trim().max(120).optional(),
  theme: z.string().refine((v): v is ThemeKey => v in THEMES, {
    message: `theme must be one of: ${Object.keys(THEMES).join(", ")}`,
  }).default("gold-luxury"),
});

router.get("/karaoke-themes", requireAuth, (_req, res) => {
  res.json({
    themes: Object.entries(THEMES).map(([key, v]) => ({
      key,
      label: v.label,
      blurb: v.blurb,
    })),
    cost: KARAOKE_COST,
  });
});

async function downloadTo(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download audio (HTTP ${res.status}).`);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_AUDIO_BYTES) {
      throw new Error("Audio is larger than the 100 MB limit.");
    }
    chunks.push(Buffer.from(value));
  }
  await writeFile(destPath, Buffer.concat(chunks));
}

async function probeDuration(mediaPath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      mediaPath,
    ],
    { timeout: 30_000 },
  );
  const d = Number(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error("Could not determine audio duration.");
  return d;
}

/** Escape the subtitle file path for the ffmpeg subtitles filter. */
function escapeSubPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

/** Escape text for ffmpeg drawtext (colon, quotes, backslash). */
function escapeDrawtext(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");
}

/**
 * Build an ASS subtitle file with word-by-word karaoke (\kf) tags.
 * Word durations within a line are estimated proportionally to word length.
 */
function buildAss(lines: LrcLine[], audioDuration: number, theme: ThemeKey): string {
  const t = THEMES[theme];
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${WIDTH}
PlayResY: ${HEIGHT}
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,DejaVu Sans,64,${t.sung},${t.unsung},${t.outline},&H99000000,-1,0,0,0,100,100,0,0,1,2,1,5,40,40,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const nextStart = i + 1 < lines.length ? lines[i + 1]!.start : audioDuration;
    // Each line shows until the next line starts (minus a small gap), capped at 12s.
    const end = Math.min(nextStart - 0.15, line.start + 12);
    if (end <= line.start + 0.2) continue;

    const words = line.text.split(/\s+/).filter(Boolean);
    const totalChars = words.reduce((sum, w) => sum + w.length, 0) || 1;
    const lineCs = Math.max(1, Math.round((end - line.start) * 100));

    let text = "";
    let used = 0;
    words.forEach((w, wi) => {
      const cs = wi === words.length - 1
        ? lineCs - used
        : Math.max(1, Math.round((lineCs * w.length) / totalChars));
      used += cs;
      text += `{\\kf${cs}}${escapeAssText(w)}`;
      if (wi < words.length - 1) text += " ";
    });
    events.push(
      `Dialogue: 0,${assTime(line.start)},${assTime(end)},Karaoke,,0,0,0,,${text}`,
    );
  }
  return header + events.join("\n") + "\n";
}

router.post("/karaoke-video", requireAuth, async (req, res) => {
  const parsed = karaokeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const { audioUrl, lrc, title, artist, theme } = parsed.data;
  const lyricLines = parseLrc(lrc);
  if (lyricLines.length === 0) {
    res.status(400).json({ error: "No usable lyric lines found. Use LRC format: [mm:ss.cc]lyrics" });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < KARAOKE_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, KARAOKE_COST, {
      action: "Karaoke Video",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "karaoke-"));
  const audioPath = join(workDir, "audio");
  const assPath = join(workDir, "lyrics.ass");
  const outputPath = join(workDir, "karaoke.mp4");

  try {
    await downloadTo(audioUrl, audioPath);
    const duration = await probeDuration(audioPath);

    await writeFile(assPath, buildAss(lyricLines, duration, theme), "utf8");

    const vfParts = [`subtitles='${escapeSubPath(assPath)}'`];
    const TITLE_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
    const BODY_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
    if (title) {
      vfParts.push(
        `drawtext=fontfile=${TITLE_FONT}:text='${escapeDrawtext(title)}':fontsize=44:fontcolor=0xC9A84C:x=(w-text_w)/2:y=48`,
      );
      if (artist) {
        vfParts.push(
          `drawtext=fontfile=${BODY_FONT}:text='${escapeDrawtext(artist)}':fontsize=28:fontcolor=white:x=(w-text_w)/2:y=104`,
        );
      }
    }

    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-f", "lavfi",
        "-i", `color=c=${THEMES[theme].bg}:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${duration.toFixed(2)}`,
        "-i", audioPath,
        "-vf", vfParts.join(","),
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        "-movflags", "+faststart",
        outputPath,
      ],
      { timeout: 600_000 },
    );

    const buffer = await readFile(outputPath);
    const objectName = `karaoke/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      theme,
      lineCount: lyricLines.length,
      durationSeconds: Math.round(duration),
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Karaoke video generation failed.";
    req.log.error({ err: message }, "[karaoke] failed");
    await refundCredits(req.userId!, KARAOKE_COST, {
      action: "Karaoke Video — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
